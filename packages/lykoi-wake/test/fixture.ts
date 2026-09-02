/**
 * lykoi-wake 测试夹具。
 *
 * - 合成 state：DDL 单一出处 lykoi-memory/testing（零她的数据）。
 * - logicalDigest：学活体 tests/test_cb_deliberation_zero_write._logical_digest
 *   （§3.6）——全库逐表逐行 sha256，表名与列名一并入摘要；按 sqlite_master 表名
 *   排序、按全列排序取行。刻意用逻辑摘要而非文件字节：SQLite 的页布局/journal
 *   会无谓地抖。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import type { BuildMessagesDeps, ChatMessage, PersonaConfig } from 'lykoi-decide'
import type { SnapshotDeps } from 'lykoi-snapshot'
import type { DispatchFn, Observation } from 'lykoi-reflow'
import { VirtualClock } from '../src/clock.ts'
import type { HeartClaim, LlmFn, WakeDeps } from '../src/index.ts'

export const T0 = new Date('2026-08-24T10:00:00Z')

export function makeStore(): { store: ReadWriteMemory; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  return { store: new ReadWriteMemory(path), path }
}

export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}

/** 全库逻辑摘要（G-9/SA-47/48 的常驻断言用；见文件头）。 */
export function logicalDigest(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const hash = createHash('sha256')
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as { name: string }[]
    for (const { name } of tables) {
      const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[])
        .map((c) => c.name)
      hash.update(`table:${name}(${cols.join(',')})\n`)
      const order = cols.map((c) => `"${c}"`).join(', ')
      const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY ${order}`).all()
      hash.update(JSON.stringify(rows))
      hash.update('\n')
    }
    return hash.digest('hex')
  } finally {
    db.close()
  }
}

/**
 * wake 测试用 persona（本地形状件——内核字节对拍的 fixture persona 在 lykoi-decide）。
 *
 * D-FIX-1（WO-M4-FIX-WAKE）后有**两个入口、一份数据**：直接喂对象的纯函数测试
 * （learn-e2e 等）用这个常量；经 Config/apply 走插件全链的测试喂
 * `test/fixtures/persona.toml`（同一份数据的文件形态）。两者的等价由
 * `persona-toml.test.ts` 的等价钉守住 —— 改了一边必须改另一边。
 */
export const TEST_PERSONA: PersonaConfig = {
  identity: {
    name: 'Lykoi',
    self: '我是 Lykoi（wake 测试形状件）。',
    nature_known: true,
    embodiment: 'test VM',
  },
  voice: {
    language: 'zh',
    register: '自然',
    emoji: '克制',
    address_owner: 'Kevin',
    profile_ref: 'default',
  },
  relationship: {
    partner: 'Kevin',
    stance: '测试形状件。',
    evolution_anchor: 'deepen',
    owner_authority: '审批归 Kevin。',
  },
  personality: { traits: ['直接'], evolves: true },
  interests: { seeds: ['测试'] },
}

export function stubSnapshotDeps(
  logEvent?: (name: string, fields: Record<string, unknown>) => void,
): SnapshotDeps {
  return {
    approvalPendingCount: () => 0,
    notificationsRemainingToday: () => 2,
    proactiveRemainingToday: () => 1,
    unprocessedRestartEvent: () => null,
    ...(logEvent === undefined ? {} : { logEvent }),
  }
}

export function stubMessageDeps(): BuildMessagesDeps {
  return {
    persona: TEST_PERSONA,
    acquired: () => '',
    organBlock: () => null,
  }
}

/** 可编程 fake 心脏：claim 队列 + nextAt 可设。 */
export function fakeHeart(beatQueue: number[], nextAt: string | null = null): HeartClaim & {
  nextAt: string | null
} {
  return {
    nextAt,
    claim: () => ({ beats: beatQueue.length > 0 ? beatQueue.shift()! : 0 }),
  }
}

export interface LlmCall {
  messages: ChatMessage[]
  meta: { runId: string; route: string; origin: string; responseFormat?: { type: 'json_object' } }
}

export function fakeLlm(reply: string | (() => string)): LlmFn & { calls: LlmCall[] } {
  const calls: LlmCall[] = []
  const fn = (async (messages: ChatMessage[], meta: LlmCall['meta']) => {
    calls.push({ messages, meta })
    return { content: typeof reply === 'function' ? reply() : reply }
  }) as LlmFn & { calls: LlmCall[] }
  fn.calls = calls
  return fn
}

export interface DispatchCall {
  actionType: string
  params: Record<string, unknown>
  runId: string
}

export function fakeDispatch(...replies: Observation[]): DispatchFn & { calls: DispatchCall[] } {
  const calls: DispatchCall[] = []
  const fn = (async (actionType: string, params: Record<string, unknown>, runId: string) => {
    calls.push({ actionType, params, runId })
    return replies.length > 0 ? replies.shift()! : { success: true, data: { queued: true } }
  }) as DispatchFn & { calls: DispatchCall[] }
  fn.calls = calls
  return fn
}

export function eventLog(): {
  logEvent: (name: string, fields: Record<string, unknown>) => void
  events: [string, Record<string, unknown>][]
  names: () => string[]
} {
  const events: [string, Record<string, unknown>][] = []
  return {
    events,
    names: () => events.map(([n]) => n),
    logEvent: (name, fields) => {
      events.push([name, fields])
    },
  }
}

/** 一套可跑的 WakeDeps（全 fake；按需覆写）。 */
export function makeWakeDeps(opts: {
  store: ReadWriteMemory
  reply: string
  beats?: number[]
  overrides?: Partial<WakeDeps>
}): {
  deps: WakeDeps
  clock: VirtualClock
  llm: ReturnType<typeof fakeLlm>
  dispatch: ReturnType<typeof fakeDispatch>
  log: ReturnType<typeof eventLog>
} {
  const clock = new VirtualClock(T0)
  const llm = fakeLlm(opts.reply)
  const dispatch = fakeDispatch()
  const log = eventLog()
  const deps: WakeDeps = {
    store: opts.store,
    clock,
    heart: fakeHeart(opts.beats ?? [1], new Date(T0.getTime() + 30 * 60_000).toISOString()),
    llm,
    dispatchFn: dispatch,
    snapshotDeps: stubSnapshotDeps(log.logEvent),
    messageDeps: stubMessageDeps(),
    logEvent: log.logEvent,
    runIdFn: () => 'run-wake-test',
    ...opts.overrides,
  }
  return { deps, clock, llm, dispatch, log }
}

/** 一条合法且接地的 contemplate 决策回复（快照注入的 concern id 由调用方插值）。 */
export function contemplateReply(concernId: number, concernTitle: string): string {
  return JSON.stringify({
    meaning_assessment: [
      { item: `关切#${concernId} ${concernTitle}`, meaning: '想向内推进一下', concern_id: concernId, pull: 0.6 },
    ],
    decision: {
      kind: 'contemplate',
      reason: `关切#${concernId} ${concernTitle} 在快照里点亮了我`,
    },
    inner: {
      thoughts: [{ content: '把这条线索想清楚一点', kind: 'intent', charge_hint: 0.8 }],
      resolve: [],
    },
  })
}
