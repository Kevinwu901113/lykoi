/**
 * 交付③：①写层 + ②lykoi-regulation 的端到端闭环。
 *
 * 序列（比照 reflow.py:60-75 的调用序，SA-52/53 —— 联动由调用方发起，本测试即调用方）：
 *   record_experience → apply_regulation_cause('experience_recorded')
 *   → regulation_field.load 精确 +0.04（delta 只来自 CAUSES，SA-75）
 *   → regulation_events append 一行 → 该行 append-only（库层拒 UPDATE/DELETE）。
 *
 * 跑两遍：合成 fixture（必跑）+ golden devstate 的 os.tmpdir 副本（skip-if-absent；
 * 只 copy 不回写；断言零内容输出）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clamp01 } from 'lykoi-regulation'
import { parseStateTimestamp } from '../src/index.ts'
import { formatPyIso, ReadWriteMemory } from '../src/rw.ts'
import { copyDevstate, devstateSkip, makeWritableFixture, rawOpen } from './fixture.ts'

/**
 * 在任意 state 副本上跑一遍闭环并全程断言。
 * now 取 load 行现值的 updated_at（elapsed=0 → 懒衰减为恒等，+0.04 才能"精确"）。
 */
function runLoop(dbPath: string): void {
  const rw = new ReadWriteMemory(dbPath)
  const raw = rawOpen(dbPath)
  const loadRow = () => raw.prepare(
    "SELECT value, updated_at FROM regulation_field WHERE name = 'load'",
  ).get() as { value: number; updated_at: string }

  let field = loadRow()
  let now = parseStateTimestamp(field.updated_at)
  if (field.value > 0.96) {
    // 罕见护栏：load 已近顶会让 +0.04 撞 clamp01；先走一条同样来自 CAUSES 的泄压因。
    rw.applyRegulationCause('integration_digested', { now })
    field = loadRow()
    now = parseStateTimestamp(field.updated_at)
  }
  const before = field.value
  const eventsBefore = (raw.prepare('SELECT COUNT(*) AS n FROM regulation_events').get() as { n: number }).n

  // ① 经验落缓冲（本测试自造内容，不含她的数据）
  const expId = rw.recordExperience('system', 'm2w1-e2e synthetic experience', { now })
  // ② 调用方联动（reflow.py:74 对应位）：每条经验必发 experience_recorded
  const res = rw.applyRegulationCause('experience_recorded', { now })

  // field 值变化精确 +0.04
  assert.equal(res.delta, 0.04)
  assert.equal(res.valueBefore, before)
  // "精确 +0.04" 的口径：value_after 恰为 clamp01(before + 0.04) 这一次 IEEE 加法的
  // 结果（位级相等）；差值层面只差浮点表示误差（< 1e-15）。
  assert.equal(res.valueAfter, clamp01(before + 0.04))
  assert.ok(Math.abs(res.valueAfter - before - 0.04) < 1e-15, 'load 必须精确 +0.04')
  const after = loadRow()
  assert.equal(after.value, res.valueAfter)
  assert.equal(after.updated_at, formatPyIso(now))

  // 经验行：新行、未整合
  const exp = { ...raw.prepare('SELECT source, integrated, integration_id FROM experiences WHERE id = ?').get(expId) } as
    { source: string; integrated: number; integration_id: number | null }
  assert.deepEqual(exp, { source: 'system', integrated: 0, integration_id: null })

  // 事件行 append：恰多一行，且是 experience_recorded
  const eventsAfter = (raw.prepare('SELECT COUNT(*) AS n FROM regulation_events').get() as { n: number }).n
  assert.equal(eventsAfter, eventsBefore + 1)
  const event = raw.prepare(
    'SELECT id, ts, name, delta, value_after, cause FROM regulation_events ORDER BY id DESC LIMIT 1',
  ).get() as { id: number; ts: string; name: string; delta: number; value_after: number; cause: string }
  assert.equal(event.name, 'load')
  assert.equal(event.delta, 0.04)
  assert.equal(event.value_after, res.valueAfter)
  assert.equal(event.cause, 'experience_recorded')
  assert.equal(event.ts, formatPyIso(now))

  // 事件行 append-only：库层拒 UPDATE/DELETE（消息 = 触发器原文）
  assert.throws(
    () => raw.prepare("UPDATE regulation_events SET cause = 'tampered' WHERE id = ?").run(event.id),
    (err: Error) => err.message === 'regulation_events is append-only',
  )
  assert.throws(
    () => raw.prepare('DELETE FROM regulation_events WHERE id = ?').run(event.id),
    (err: Error) => err.message === 'regulation_events is append-only',
  )

  rw.close()
  raw.close()
}

test('e2e(fixture)：record_experience → experience_recorded → load 精确 +0.04 → 事件行 append-only', () => {
  runLoop(makeWritableFixture())
})

test('e2e(devstate 副本)：同一闭环在真 state 副本上成立（copy 进 tmp，不回写）', { skip: devstateSkip }, () => {
  runLoop(copyDevstate())
})
