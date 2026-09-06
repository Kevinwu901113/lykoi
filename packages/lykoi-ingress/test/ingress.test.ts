import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import {
  DurableIngress, DurableTurnStore, type InboundPart,
  type TurnTerminalPayload, type UserTurn,
} from '../src/index.ts'

const BASE = Date.parse('2026-09-05T00:00:00.000Z')

function at(ms: number): string {
  return new Date(BASE + ms).toISOString()
}

function part(
  n: number,
  receivedMs: number,
  overrides: Partial<InboundPart> = {},
): InboundPart {
  return {
    inboundId: `in:telegram:${n}`,
    channel: 'telegram',
    platformMessageId: String(100 + n),
    platformUpdateId: String(n),
    userId: 'user-1',
    contextId: 'chat-1',
    isOwner: true,
    text: `part-${n}`,
    receivedAt: at(receivedMs),
    ...overrides,
  }
}

function terminal(status = 'replied'): TurnTerminalPayload {
  return {
    status,
    reason: null,
    followup_registered: false,
    ask_sent: false,
    notice_sent: false,
    reply_chars: 2,
    elapsed_ms: 3,
    continuation_id: null,
  }
}

function fixture(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'lykoi-ingress-')), 'ingress.db')
  new DurableTurnStore(path).close()
  return path
}

function audit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { events, async record(event) { events.push(event) } }
}

function service(options: {
  path?: string
  idleMs?: number
  hardMs?: number
  nowMs?: number
} = {}) {
  const sink = audit()
  let nowMs = options.nowMs ?? 0
  const ingress = new DurableIngress({
    dbPath: options.path ?? fixture(),
    audit: sink,
    idleWindowMs: options.idleMs,
    hardWindowMs: options.hardMs,
    autoStart: false,
    now: () => new Date(BASE + nowMs),
  })
  return { ingress, sink, setNow(ms: number) { nowMs = ms } }
}

function clockedRuntime(sink: AuditService, path = fixture()) {
  let time = 0
  const timers = new Set<{ due: number; fire: () => void }>()
  const errors: string[] = []
  const ingress = new DurableIngress({
    dbPath: path, audit: sink, now: () => new Date(BASE + time),
    onError: (where) => { errors.push(where) },
    schedule(delay, fire) {
      const item = { due: time + delay, fire }
      timers.add(item)
      return () => { timers.delete(item) }
    },
  })
  return {
    ingress, errors,
    async advance(ms: number) {
      time = ms
      for (const timer of [...timers]) {
        if (timer.due <= time) {
          timers.delete(timer)
          timer.fire()
        }
      }
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
  }
}

test('审计临时失败后自动恢复 queued turn：无需新入站，认知只执行一次', async () => {
  const sink = audit()
  const record = sink.record.bind(sink)
  let fail = true
  sink.record = async (event) => {
    if (fail && event.type === 'turn/committed') {
      fail = false
      throw new Error('temporary audit outage')
    }
    await record(event)
  }
  const h = clockedRuntime(sink)
  let calls = 0
  h.ingress.registerExecutor(async () => {
    calls += 1
    return { terminal: terminal() }
  })
  await h.ingress.start()
  await h.ingress.accept(part(1, 0))
  await h.ingress.kick()
  await h.advance(1_500)
  assert.equal(calls, 0)
  assert.deepEqual(h.errors, ['timer'])
  await h.advance(2_500)
  await h.ingress.drain()
  assert.equal(calls, 1)
  assert.equal(sink.events.filter((event) => event.type === 'turn/terminal').length, 1)
  await h.ingress.close()
})

test('终局审计临时失败自动补账；不会重跑已完成 cognition', async () => {
  const sink = audit()
  const record = sink.record.bind(sink)
  let fail = true
  sink.record = async (event) => {
    if (fail && event.type === 'turn/terminal') {
      fail = false
      throw new Error('temporary terminal projection outage')
    }
    await record(event)
  }
  const h = clockedRuntime(sink)
  let calls = 0
  h.ingress.registerExecutor(async () => {
    calls += 1
    return { terminal: terminal() }
  })
  await h.ingress.start()
  await h.ingress.accept(part(1, 0))
  await h.ingress.kick()
  await h.advance(1_500)
  assert.equal(calls, 1)
  assert.equal(sink.events.filter((event) => event.type === 'turn/terminal').length, 0)
  await h.advance(2_500)
  await h.ingress.drain()
  assert.equal(calls, 1)
  assert.equal(sink.events.filter((event) => event.type === 'turn/terminal').length, 1)
  await h.ingress.close()
})

test('终局 DB 临时拒写只重试持久化结果，不重跑外部动作', async () => {
  const path = fixture()
  const db = new DatabaseSync(path)
  db.exec(`CREATE TRIGGER fail_terminal BEFORE UPDATE OF state ON user_turns
    WHEN NEW.state = 'terminal' BEGIN SELECT RAISE(ABORT, 'temporary write outage'); END`)
  const sink = audit()
  const h = clockedRuntime(sink, path)
  let calls = 0
  h.ingress.registerExecutor(async () => {
    calls += 1
    return { terminal: terminal() }
  })
  await h.ingress.start()
  await h.ingress.accept(part(1, 0))
  await h.ingress.kick()
  await h.advance(1_500)
  assert.equal(calls, 1)
  assert.equal((db.prepare('SELECT state FROM user_turns').get() as { state: string }).state, 'running')
  db.exec('DROP TRIGGER fail_terminal')
  await h.advance(2_500)
  await h.ingress.drain()
  assert.equal(calls, 1)
  assert.equal((db.prepare('SELECT terminal_status FROM user_turns').get() as { terminal_status: string }).terminal_status, 'replied')
  assert.equal(sink.events.filter((event) => event.type === 'turn/terminal').length, 1)
  db.close()
  await h.ingress.close()
})

test('T1/T2：单消息 idle commit；三消息按原边界/原序合成一个 UserTurn', async () => {
  const h = service()
  const turns: UserTurn[] = []
  h.ingress.registerExecutor(async (turn) => {
    turns.push(turn)
    return { terminal: terminal() }
  })

  await h.ingress.accept(part(1, 0))
  await h.ingress.tick(new Date(BASE + 1_499))
  assert.equal(turns.length, 0)
  await h.ingress.tick(new Date(BASE + 1_500))
  await h.ingress.drain()
  assert.equal(turns.length, 1)
  assert.deepEqual(turns[0]!.parts.map((item) => item.text), ['part-1'])
  assert.equal(turns[0]!.commitReason, 'idle_timeout')

  await h.ingress.accept(part(2, 2_000))
  await h.ingress.accept(part(3, 2_500))
  await h.ingress.accept(part(4, 3_000))
  await h.ingress.tick(new Date(BASE + 4_499))
  assert.equal(turns.length, 1)
  await h.ingress.tick(new Date(BASE + 4_500))
  await h.ingress.drain()
  assert.deepEqual(turns[1]!.parts.map((item) => item.text), ['part-2', 'part-3', 'part-4'])
  assert.deepEqual(turns[1]!.parts.map((item) => item.platformMessageId), ['102', '103', '104'])
  await h.ingress.close()
})

test('T3：持续输入不能越过 hard max；4 秒时强制切 turn', async () => {
  const h = service()
  const turns: UserTurn[] = []
  h.ingress.registerExecutor(async (turn) => {
    turns.push(turn)
    return { terminal: terminal() }
  })
  await h.ingress.accept(part(1, 0))
  await h.ingress.accept(part(2, 1_000))
  await h.ingress.accept(part(3, 2_000))
  await h.ingress.accept(part(4, 3_000))
  await h.ingress.tick(new Date(BASE + 3_999))
  assert.equal(turns.length, 0)
  await h.ingress.tick(new Date(BASE + 4_000))
  await h.ingress.drain()
  assert.equal(turns.length, 1)
  assert.equal(turns[0]!.commitReason, 'hard_timeout')
  assert.equal(Date.parse(turns[0]!.committedAt), BASE + 4_000)
  await h.ingress.close()
})

test('相同 received_at 仍以 durable accept 顺序保存 parts 边界', async () => {
  const h = service()
  const turns: UserTurn[] = []
  h.ingress.registerExecutor(async (turn) => {
    turns.push(turn)
    return { terminal: terminal() }
  })
  await h.ingress.accept(part(3, 0))
  await h.ingress.accept(part(1, 0))
  await h.ingress.accept(part(2, 0))
  await h.ingress.tick(new Date(BASE + 1_500))
  await h.ingress.drain()
  assert.deepEqual(turns[0]!.parts.map((item) => item.inboundId), [
    'in:telegram:3', 'in:telegram:1', 'in:telegram:2',
  ])
  await h.ingress.close()
})

test('scope 隔离：channel/context/user/sender 身份任一不同都不合并', async () => {
  const h = service()
  const turns: UserTurn[] = []
  h.ingress.registerExecutor(async (turn) => {
    turns.push(turn)
    return { terminal: terminal() }
  })
  await h.ingress.accept(part(1, 0))
  await h.ingress.accept(part(2, 0, { contextId: 'chat-2' }))
  await h.ingress.accept(part(3, 0, { userId: 'user-2' }))
  await h.ingress.accept(part(4, 0, { channel: 'matrix' }))
  await h.ingress.accept(part(5, 0, { isOwner: false }))
  await h.ingress.tick(new Date(BASE + 1_500))
  await h.ingress.drain()
  assert.equal(turns.length, 5)
  assert.ok(turns.every((turn) => turn.parts.length === 1))
  await h.ingress.close()
})

test('平台 identity 幂等：cursor 前崩溃重放不增 part/turn/terminal', async () => {
  const h = service()
  let calls = 0
  h.ingress.registerExecutor(async () => {
    calls += 1
    return { terminal: terminal() }
  })
  assert.equal((await h.ingress.accept(part(1, 0))).duplicate, false)
  assert.equal((await h.ingress.accept(part(99, 1, {
    platformMessageId: '101', platformUpdateId: '1',
  }))).duplicate, true)
  await h.ingress.tick(new Date(BASE + 1_500))
  await h.ingress.drain()
  assert.equal(calls, 1)
  assert.equal(h.sink.events.filter((event) => event.type === 'turn/terminal').length, 1)
  await h.ingress.close()
})

test('重启恢复 collecting/queued；已 terminal 与中断 running 都不重跑', async () => {
  const path = fixture()

  const first = service({ path })
  await first.ingress.accept(part(1, 0))
  await first.ingress.close()

  const second = service({ path, nowMs: 2_000 })
  const executed: string[] = []
  second.ingress.registerExecutor(async (turn) => {
    executed.push(turn.turnId)
    return { terminal: terminal() }
  })
  await second.ingress.start()
  await second.ingress.drain()
  assert.equal(executed.length, 1, 'collecting 在重启后到期并执行')

  await second.ingress.accept(part(2, 3_000))
  await second.ingress.tick(new Date(BASE + 4_500))
  await second.ingress.drain()
  assert.equal(executed.length, 2)
  await second.ingress.close()

  const third = service({ path, nowMs: 6_000 })
  third.ingress.registerExecutor(async (turn) => {
    executed.push(turn.turnId)
    return { terminal: terminal() }
  })
  await third.ingress.start()
  await third.ingress.drain()
  assert.equal(executed.length, 2, 'terminal 重启不执行')
  await third.ingress.close()

  const store = new DurableTurnStore(path)
  store.accept(part(3, 7_000), 1_500, 4_000)
  store.commitDue(new Date(BASE + 8_500), 1_500, 4_000)
  assert.notEqual(store.claimNext(new Date(BASE + 8_500)), null)
  store.close()

  const fourth = service({ path, nowMs: 9_000 })
  fourth.ingress.registerExecutor(async (turn) => {
    executed.push(turn.turnId)
    return { terminal: terminal() }
  })
  await fourth.ingress.start()
  await fourth.ingress.drain()
  assert.equal(executed.length, 2, 'running 以 interrupted 终态收账，不冒险重放副作用')
  const recovered = fourth.sink.events.find((event) => event.type === 'turn/terminal')!
  assert.equal(recovered.reason, 'interrupted')
  await fourth.ingress.close()
})

test('A 阻塞时 B/C 仍 durable accept，随后只按 A→B→C 串行执行', async () => {
  const path = fixture()
  const h = service({ path })
  const order: string[] = []
  let releaseA!: () => void
  const blocked = new Promise<void>((resolve) => { releaseA = resolve })
  h.ingress.registerExecutor(async (turn) => {
    order.push(turn.parts[0]!.text)
    if (turn.parts[0]!.text === 'part-1') await blocked
    return { terminal: terminal() }
  })

  await h.ingress.accept(part(1, 0))
  await h.ingress.tick(new Date(BASE + 1_500))
  await Promise.resolve()
  assert.deepEqual(order, ['part-1'])

  await h.ingress.accept(part(2, 2_000))
  await h.ingress.tick(new Date(BASE + 3_500))
  await h.ingress.accept(part(3, 4_000))
  await h.ingress.tick(new Date(BASE + 5_500))
  const db = new DatabaseSync(path)
  const queued = db.prepare("SELECT COUNT(*) AS n FROM user_turns WHERE state='queued'").get() as { n: number }
  db.close()
  assert.equal(Number(queued.n), 2, '认知阻塞不阻止 B/C durable commit')

  releaseA()
  await h.ingress.drain()
  assert.deepEqual(order, ['part-1', 'part-2', 'part-3'])
  await h.ingress.close()
})

test('一个合并 turn 恰有一个可反查全 constituent identity 的 terminal', async () => {
  const h = service()
  h.ingress.registerExecutor(async () => ({ terminal: terminal('intentional_silence') }))
  await h.ingress.accept(part(1, 0))
  await h.ingress.accept(part(2, 500))
  await h.ingress.accept(part(3, 1_000))
  await h.ingress.tick(new Date(BASE + 2_500))
  await h.ingress.drain()
  const rows = h.sink.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0]!.inbound_ids, ['in:telegram:1', 'in:telegram:2', 'in:telegram:3'])
  assert.deepEqual(rows[0]!.platform_message_ids, ['101', '102', '103'])
  assert.deepEqual(rows[0]!.platform_update_ids, ['1', '2', '3'])
  assert.equal(rows[0]!.message_id, '103', '回复 attribution 锚定最后 part')
  assert.equal(rows[0]!.reply_anchor_message_id, '103')
  assert.equal(rows[0]!.event_id, `turn-terminal:${rows[0]!.turn_id}`)
  assert.equal(rows[0]!.part_count, 3)
  await h.ingress.close()
})
