import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { DurableIngress, DurableTurnStore, type InboundPart, type UserTurn } from '../src/index.ts'

const base = Date.parse('2026-09-06T00:00:00Z')
const at = (ms: number) => new Date(base + ms)
const part = (n: number, ms: number, contextId = 'peer'): InboundPart => ({
  inboundId: `in-${n}`, channel: 'telegram', platformMessageId: `${n}`,
  platformUpdateId: `${n}`, contextId, userId: 'owner', isOwner: true,
  text: ` 原文${n}\r\n\n`, receivedAt: at(ms).toISOString(),
  sourceTimestamp: at(-60_000 + n * 1_000).toISOString(), replay: true,
})

test('durable 通知先于审计失败；失败后重投仍只有一条正本', async () => {
  let notified = 0
  const path = join(mkdtempSync(join(tmpdir(), 'ingress-notify-')), 'spool.db')
  const ingress = new DurableIngress({ dbPath: path, autoStart: false,
    audit: { async record() { assert.equal(notified, 1); throw new Error('audit unavailable') } } })
  await assert.rejects(ingress.accept(part(1, 0), () => { notified++ }), /audit unavailable/)
  const store = new DurableTurnStore(path)
  assert.equal(store.accept(part(1, 0), 1500, 4000).duplicate, true)
  store.close()
  await ingress.close()
})

test('spool 自建独立库；误配认知库拒开且不改字节', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingress-isolation-'))
  const mind = join(dir, 'memory.db')
  const db = new DatabaseSync(mind)
  db.exec('CREATE TABLE mind_schema(version INTEGER PRIMARY KEY); INSERT INTO mind_schema VALUES(18)')
  db.close()
  const before = readFileSync(mind)
  assert.throws(() => new DurableTurnStore(mind), /own supported infrastructure/)
  assert.deepEqual(readFileSync(mind), before)
  const path = join(dir, 'spool.db')
  new DurableTurnStore(path).close()
  const spool = new DatabaseSync(path)
  assert.equal(spool.prepare('PRAGMA user_version').get()!.user_version, 2)
  assert.deepEqual(spool.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name), ['inbound_parts', 'user_turns'])
  spool.exec('PRAGMA user_version=3')
  spool.close()
  assert.throws(() => new DurableTurnStore(path), /own supported infrastructure/)
})

test('跨 poll、跨重启、超过 hard window 的积压保持逐字一轮；不同 peer 分开', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'ingress-replay-')), 'spool.db')
  const audit = { async record() {} }
  const one = new DurableIngress({ dbPath: path, audit, autoStart: false, now: () => at(0) })
  await one.accept(part(1, 0))
  await one.close()
  const turns: UserTurn[] = []
  const two = new DurableIngress({ dbPath: path, audit, autoStart: false, now: () => at(30_000) })
  two.registerExecutor(async turn => {
    turns.push(turn)
    return { terminal: { status: 'intentional_silence', reason: null, followup_registered: false,
      ask_sent: false, notice_sent: false, reply_chars: 0, elapsed_ms: 0 } }
  })
  await two.start()
  await two.accept(part(2, 10_000))
  await two.accept(part(3, 20_000))
  await two.accept(part(4, 21_000, 'other-peer'))
  await two.tick(at(30_000))
  await two.drain()
  assert.equal(turns.length, 0, '收齐前不能因重启或计时器切碎积压')
  await two.finishReplay('telegram')
  await two.drain()
  assert.equal(turns.length, 2)
  assert.equal(turns[0]!.commitReason, 'restart_replay')
  assert.deepEqual(turns[0]!.parts.map(p => p.text), [1, 2, 3].map(n => ` 原文${n}\r\n\n`))
  assert.deepEqual(turns[0]!.parts.map(p => p.sourceTimestamp), [1, 2, 3].map(n => part(n, 0).sourceTimestamp))
  await two.close()
})
