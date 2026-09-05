/**
 * lykoi-learn 测试夹具。
 *
 * 数据纪律：合成 state 一律 createStateFixture（DDL 单一出处 lykoi-memory/testing，
 * 零她的数据）建在 os.tmpdir；golden devstate 只在 l1 的分类回放测试里以
 * **readOnly** 打开（零写、行内容零输出——断言消息只带 id 不带 content）。
 * 写集对拍用 tableDigests / changedTables（同一出处的逐表逻辑摘要）。
 */
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory, formatPyIso } from 'lykoi-memory/rw'
import type { ChatMessage, PersonaLike } from '../src/index.ts'

export { changedTables, tableDigests } from 'lykoi-memory/testing'

export const T0 = new Date('2026-08-24T10:00:00Z')

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

export function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 3_600_000)
}

export interface EventLog {
  events: [string, Record<string, unknown>][]
  names: () => string[]
  of: (name: string) => Record<string, unknown>[]
  logEvent: (name: string, fields: Record<string, unknown>) => void
}

export function eventLog(): EventLog {
  const events: [string, Record<string, unknown>][] = []
  return {
    events,
    names: () => events.map(([n]) => n),
    of: (name) => events.filter(([n]) => n === name).map(([, f]) => f),
    logEvent: (name, fields) => {
      events.push([name, fields])
    },
  }
}

/** 合成 store（store 层遥测注入同一事件槽——W3 TODO#1 的接法在测试里直接可断言）。 */
export function makeStore(): { store: ReadWriteMemory; path: string; log: EventLog } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-learn-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  const log = eventLog()
  return { store: new ReadWriteMemory(path, { logEvent: log.logEvent }), path, log }
}

export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}

/** 合成测试实例包的 persona TOML（lykoi-decide/test/fixtures/instance；WO-E4-1 一份真相）。 */
export const INSTANCE_PERSONA_TOML = new URL(
  '../../lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url,
).pathname

/** 本包不依赖 lykoi-decide（不引 loadPersona），只从 TOML 正文取两个基本字符串标量。 */
function instanceScalar(section: string, key: string): string {
  const text = readFileSync(INSTANCE_PERSONA_TOML, 'utf8')
  const body = text.split(`\n[${section}]\n`)[1]?.split(/\n\[/)[0]
  const found = body === undefined ? null : new RegExp(`^${key} = "([^"]*)"$`, 'm').exec(body)
  if (found === null) throw new Error(`instance persona fixture: ${section}.${key} not found`)
  return found[1]!
}

/** 身份守卫 fixture 口径（与 lykoi-decide 的 FIXTURE_PERSONA 同名同伴侣：同一份 TOML）。 */
export const PERSONA: PersonaLike = {
  identity: { name: instanceScalar('identity', 'name') },
  relationship: { partner: instanceScalar('relationship', 'partner') },
}

/** 队列式 fake completion：按序吐 replies；耗尽即抛（测试据此钉调用次数上限）。 */
export function fakeCompletion(...replies: (string | Error)[]): {
  completion: (messages: ChatMessage[]) => Promise<{ content: string | null }>
  calls: ChatMessage[][]
} {
  const calls: ChatMessage[][] = []
  return {
    calls,
    completion: async (messages) => {
      calls.push(messages)
      if (replies.length === 0) {
        throw new Error('fakeCompletion: no reply queued (unexpected extra LLM call)')
      }
      const next = replies.shift()!
      if (next instanceof Error) throw next
      return { content: next }
    },
  }
}

/** 直接把一条 working 经验写进库（走 store 写入点 = 分类同事务，SA-88）。 */
export function seedExperience(
  store: ReadWriteMemory,
  source: Parameters<ReadWriteMemory['recordExperience']>[0],
  content: string,
  now: Date,
  opts?: { salience?: number },
): number {
  return store.recordExperience(source, content, {
    ...(opts?.salience !== undefined ? { salience: opts.salience } : {}),
    now,
  })
}

/** 把 regulation load 顶到指定值（early 路红测用；updated_at=now → 零衰减）。 */
export function setLoad(path: string, value: number, now: Date): void {
  const db = rawOpen(path)
  try {
    db.prepare("UPDATE regulation_field SET value = ?, updated_at = ? WHERE name = 'load'")
      .run(value, formatPyIso(now))
  } finally {
    db.close()
  }
}

/** 直接改一条关切的 status（dormant/dimming 场景铺设；触发器允许 concerns 列改）。 */
export function setConcernStatus(path: string, concernId: number, status: string): void {
  const db = rawOpen(path)
  try {
    db.prepare('UPDATE concerns SET status = ? WHERE id = ?').run(status, concernId)
  } finally {
    db.close()
  }
}

/** 给关切登记实体轴作用域（memory_scopes；P2-01 形状）。 */
export function scopeConcern(path: string, concernId: number, subjectUserId: string): void {
  const db = rawOpen(path)
  try {
    db.prepare(
      "INSERT INTO memory_scopes (table_name, row_id, subject_user_id, origin_context) "
      + "VALUES ('concerns', ?, ?, NULL)",
    ).run(concernId, subjectUserId)
  } finally {
    db.close()
  }
}

/** 给经验登记实体轴作用域。 */
export function scopeExperience(path: string, experienceId: number, subjectUserId: string): void {
  const db = rawOpen(path)
  try {
    db.prepare(
      "INSERT INTO memory_scopes (table_name, row_id, subject_user_id, origin_context) "
      + "VALUES ('experiences', ?, ?, NULL)",
    ).run(experienceId, subjectUserId)
  } finally {
    db.close()
  }
}

export { formatPyIso }
