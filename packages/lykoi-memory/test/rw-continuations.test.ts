/**
 * WO-CONTINUATION-01 D-1：pending_continuations 的数据面（rw 层）。
 * 覆盖：登记 / 到期扫描序 / CAS 租约 / 终局一次性 / CHECK 拒绝非法态 / 启动扫描读面。
 *
 * 时钟纪律：全部 Date 由 T0 派生，零真实时钟读取。
 * 数据纪律：只跑合成 fixture 与临时库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ReadWriteMemory, formatPyIso } from '../src/rw.ts'
import { makeWritableFixture, rawOpen } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 8, 4, 12, 0, 0, 0))
const at = (s: number) => new Date(T0.getTime() + s * 1000)

interface Recorded { name: string; fields: Record<string, unknown> }

function openRw(): { rw: ReadWriteMemory; path: string; events: Recorded[] } {
  const path = makeWritableFixture()
  const events: Recorded[] = []
  const rw = new ReadWriteMemory(path, { logEvent: (name, fields) => events.push({ name, fields }) })
  return { rw, path, events }
}

test('登记：pending 行 + 五个语义字段 + 事件只带 id/字数', () => {
  const { rw, events } = openRw()
  rw.registerContinuation({
    id: 'cont-tg:1-1', originTurnId: 'tg:1', originRunId: 'converse-1-100',
    goal: '把那份对比表整理出来', dueAt: at(0), now: at(0),
  })
  const row = rw.getContinuation('cont-tg:1-1')!
  assert.equal(row.state, 'pending')
  assert.equal(row.origin_turn_id, 'tg:1')
  assert.equal(row.origin_run_id, 'converse-1-100')
  assert.equal(row.goal, '把那份对比表整理出来')
  assert.equal(row.due_at, formatPyIso(at(0)))
  assert.equal(row.created_at, formatPyIso(at(0)))
  assert.equal(row.terminal_reason, null)
  assert.equal(row.run_id, null)
  assert.deepEqual(events.filter((e) => e.name === 'continuation_registered'), [{
    name: 'continuation_registered',
    fields: { continuation_id: 'cont-tg:1-1', goal_chars: 10 },
  }])
  // 同 id 二次登记：撞主键即抛，不静默。
  assert.throws(() => rw.registerContinuation({
    id: 'cont-tg:1-1', originTurnId: 'tg:1', originRunId: null, goal: 'x', dueAt: at(0), now: at(0),
  }), /UNIQUE/)
  // 空 goal 拒绝。
  assert.throws(() => rw.registerContinuation({
    id: 'cont-tg:2-1', originTurnId: 'tg:2', originRunId: null, goal: '  ', dueAt: at(0), now: at(0),
  }), /goal/)
  rw.close()
})

test('到期扫描：只取 pending 且 due_at ≤ now，按 due_at 升序，受 limit', () => {
  const { rw } = openRw()
  rw.registerContinuation({ id: 'c-late', originTurnId: 't1', originRunId: null, goal: 'g', dueAt: at(60), now: at(0) })
  rw.registerContinuation({ id: 'c-b', originTurnId: 't2', originRunId: null, goal: 'g', dueAt: at(10), now: at(0) })
  rw.registerContinuation({ id: 'c-a', originTurnId: 't3', originRunId: null, goal: 'g', dueAt: at(5), now: at(0) })
  rw.registerContinuation({ id: 'c-c', originTurnId: 't4', originRunId: null, goal: 'g', dueAt: at(20), now: at(0) })
  assert.deepEqual(rw.dueContinuations(at(30), 10).map((r) => r.id), ['c-a', 'c-b', 'c-c'])
  assert.deepEqual(rw.dueContinuations(at(30), 2).map((r) => r.id), ['c-a', 'c-b'])
  assert.deepEqual(rw.dueContinuations(at(4), 10).map((r) => r.id), [])
  rw.close()
})

test('CAS 租约：pending → running 恰一次；终局一次性；running 读面', () => {
  const { rw } = openRw()
  rw.registerContinuation({ id: 'c1', originTurnId: 't1', originRunId: null, goal: 'g', dueAt: at(0), now: at(0) })
  assert.equal(rw.claimContinuation('c1', 'continuation-c1', at(1)), true)
  assert.equal(rw.claimContinuation('c1', 'continuation-c1-again', at(2)), false, '第二次 claim 让位')
  const running = rw.getContinuation('c1')!
  assert.equal(running.state, 'running')
  assert.equal(running.run_id, 'continuation-c1')
  assert.equal(running.updated_at, formatPyIso(at(1)))
  assert.deepEqual(rw.runningContinuations().map((r) => r.id), ['c1'])
  assert.deepEqual(rw.dueContinuations(at(100), 10), [], 'running 不再出现在到期扫描里')

  assert.equal(rw.finishContinuation('c1', 'completed', null, at(3)), true)
  assert.equal(rw.finishContinuation('c1', 'failed', 'unknown', at(4)), false, '终局只有一次')
  const done = rw.getContinuation('c1')!
  assert.equal(done.state, 'completed')
  assert.equal(done.terminal_reason, null)
  assert.equal(done.updated_at, formatPyIso(at(3)))
  assert.deepEqual(rw.runningContinuations(), [])

  // pending 直接 expired（扫描时超 TTL）也是合法出发点。
  rw.registerContinuation({ id: 'c2', originTurnId: 't2', originRunId: null, goal: 'g', dueAt: at(0), now: at(0) })
  assert.equal(rw.finishContinuation('c2', 'expired', null, at(5)), true)
  assert.equal(rw.getContinuation('c2')!.state, 'expired')
  // 非法终局态在 API 层拒绝。
  assert.throws(() => rw.finishContinuation('c2', 'pending' as never, null, at(6)), /invalid continuation terminal state/)
  rw.close()
})

test('CHECK：state 枚举在 DDL 层钉死；索引存在', () => {
  const { rw, path } = openRw()
  rw.close()
  const db = rawOpen(path)
  assert.throws(() => db.prepare(
    `INSERT INTO pending_continuations (id, origin_turn_id, goal, due_at, state, created_at, updated_at)
     VALUES ('x', 't', 'g', '2026-09-04T00:00:00+00:00', 'queued', '2026-09-04T00:00:00+00:00', '2026-09-04T00:00:00+00:00')`,
  ).run(), /CHECK constraint failed/)
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_continuations' AND name NOT LIKE 'sqlite_%'",
  ).all() as { name: string }[]
  assert.deepEqual(idx.map((r) => r.name), ['idx_pending_continuations_due'])
  db.close()
})
