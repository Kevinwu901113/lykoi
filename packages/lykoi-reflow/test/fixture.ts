/**
 * lykoi-reflow 测试夹具。合成 fixture：DDL 单一出处 `lykoi-memory/testing`
 * （W2 TODO#5 收口后的口径）；不含她的任何数据。golden devstate 相关测试归
 * lykoi-memory（本包全部用合成库，数据纪律自动满足）。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory, formatPyIso } from 'lykoi-memory/rw'
import type { Decision } from 'lykoi-decide'
import type { DispatchFn, NotificationsView, Observation, WakeCounts } from '../src/index.ts'

export const T0 = new Date('2026-08-24T10:00:00Z')

export function minutesAfter(base: Date, minutes: number): Date {
  return new Date(base.getTime() + minutes * 60_000)
}

export function hoursBefore(base: Date, hours: number): Date {
  return new Date(base.getTime() - hours * 3_600_000)
}

export function makeStore(): { store: ReadWriteMemory; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-reflow-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  return { store: new ReadWriteMemory(path), path }
}

/** 裸连接（种线/断言用）。 */
export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}

export function seedThread(path: string, content: string, status = 'open'): number {
  const db = rawOpen(path)
  try {
    const info = db.prepare(
      'INSERT INTO narrative_threads (kind, content, status, created_at, updated_at) '
      + "VALUES ('open_question', ?, ?, ?, ?)",
    ).run(content, status, formatPyIso(T0), formatPyIso(T0))
    return Number(info.lastInsertRowid)
  } finally {
    db.close()
  }
}

/** 全字段可覆写的 Decision 工厂（缺省 = 一个未降级的 rest）。 */
export function makeDecision(partial: Partial<Decision> = {}): Decision {
  return {
    kind: 'rest',
    content: null,
    url: null,
    thread_id: null,
    concern_id: null,
    reason: '',
    meaning_assessment: [],
    grounded_concern_ids: [],
    demoted: false,
    demote_why: null,
    original_kind: null,
    inner: { thoughts: [], resolve: [] },
    injected_thought_ids: [],
    envelope: {},
    ...partial,
  }
}

export function freshCounts(): WakeCounts {
  return { action: 0, external_read: 0, notification: 0 }
}

export interface DispatchCall {
  actionType: string
  params: Record<string, unknown>
  runId: string
}

/** fake kernel：记录调用、按队列回放 Observation（缺省 success + queued）。 */
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
} {
  const events: [string, Record<string, unknown>][] = []
  return {
    events,
    logEvent: (name, fields) => {
      events.push([name, fields])
    },
  }
}

export function fakeNotifications(
  items: readonly { ts?: string | null; origin?: string | null }[],
): NotificationsView {
  return { getNotifications: () => items }
}

/** regulation_events 的 cause 序（oldest-first，便于断言时间线）。 */
export function causeSequence(store: ReadWriteMemory): string[] {
  return store.recentRegulationEvents(null, 100).map((e) => e.cause).reverse()
}
