/**
 * WO-PERS-OVERLAY-01：relationship overlay 的**数据面**（rw 层）。
 *
 * 正本：governance/wo/WO-PERS-OVERLAY-01/order.md §2（D-2/D-3/D-4）；上位设计稿
 * governance/docs/persona_layering_design_v1_2026-09-01.md §3.2（D-PERS-2）。
 * 覆盖面：类别常量正本 / scopeInsightSubject（首个 memory_scopes 运行期写者、
 * INSERT OR IGNORE 幂等、形状、FK 真生效）/ 两个读口互斥且并集 = 旧全集 /
 * 键到别人的行查不出来。
 *
 * 时钟纪律：全部 Date 由 T0 派生，零真实时钟读取。
 * 数据纪律：只跑合成 fixture 与临时库，真实 memory.db / devstate 永不触及（R-01）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { RELATIONSHIP_INSIGHT_CATEGORY, ReadWriteMemory, formatPyIso } from '../src/rw.ts'
import { makeWritableFixture, rawOpen } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 8, 2, 0, 0, 0, 0))

/** 层 2 结论类别的本地字面量——正本在 lykoi-learn/src/l4.ts，此处只作对照用。 */
const FOCUS = 'focus'

interface Recorded { name: string; fields: Record<string, unknown> }

function openRw(): { rw: ReadWriteMemory; raw: DatabaseSync; events: Recorded[] } {
  const path = makeWritableFixture()
  const events: Recorded[] = []
  const rw = new ReadWriteMemory(path, {
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  rw.openFocusCycle({ now: T0 }) // 状态行的 FK 目标（PRAGMA foreign_keys=ON）
  return { rw, raw: rawOpen(path), events }
}

/** 播第二个用户（group_member——owner_primary 有部分唯一索引，只能有一行）。 */
function seedSecondUser(raw: DatabaseSync, id = 'user_002'): string {
  raw.prepare(
    "INSERT INTO users (id, display_name, role, created_at) VALUES (?, ?, 'group_member', ?)",
  ).run(id, id, formatPyIso(T0))
  return id
}

/** 落一条结论并推到 active（走真 API，不手写状态 SQL）。 */
function seedActive(rw: ReadWriteMemory, category: string, content: string): number {
  const iid = rw.upsertInsight(category, content, { now: T0 })
  rw.recordFocusInsight(iid, { cycleId: 1, now: T0 })
  rw.setFocusInsightStatus(iid, 'active', { cycleId: 1, now: T0 })
  return iid
}

test('D-2：类别常量正本在 rw.ts，值为 relationship（与 focus 是两个类别）', () => {
  assert.equal(RELATIONSHIP_INSIGHT_CATEGORY, 'relationship')
  assert.notEqual(RELATIONSHIP_INSIGHT_CATEGORY, FOCUS)
})

test('D-3：scopeInsightSubject 落一行 memory_scopes，形状 = (insights, id, subject, NULL, private, content)', () => {
  const { rw, raw } = openRw()
  const iid = rw.upsertInsight(RELATIONSHIP_INSIGHT_CATEGORY, '他忙起来就不爱说话，别追问', { now: T0 })

  assert.equal(rw.scopeInsightSubject(iid, 'user_001'), true, '首次写入返回 true')

  const rows = raw.prepare(
    "SELECT * FROM memory_scopes WHERE table_name = 'insights' AND row_id = ?",
  ).all(iid) as Record<string, unknown>[]
  assert.equal(rows.length, 1)
  assert.deepEqual({ ...rows[0] }, { // node:sqlite 返回 null-prototype 行，摊平再比

    table_name: 'insights', row_id: iid, subject_user_id: 'user_001',
    origin_context: null, visibility: 'private', sensitivity: 'content',
  })
})

test('D-3 幂等：重申同一结论不重复写 scope（二次返回 false、行数不变、键不被改写）', () => {
  const { rw, raw } = openRw()
  const iid = rw.upsertInsight(RELATIONSHIP_INSIGHT_CATEGORY, '他忙起来就不爱说话', { now: T0 })
  seedSecondUser(raw)

  assert.equal(rw.scopeInsightSubject(iid, 'user_001'), true)
  assert.equal(rw.scopeInsightSubject(iid, 'user_001'), false, '第二次是空操作')
  // 键在首次落地时钉死：换一个 subject 再写，也不许改掉已有的键。
  assert.equal(rw.scopeInsightSubject(iid, 'user_002'), false, 'INSERT OR IGNORE，不是 upsert')

  const rows = raw.prepare(
    "SELECT subject_user_id FROM memory_scopes WHERE table_name = 'insights' AND row_id = ?",
  ).all(iid) as { subject_user_id: string }[]
  assert.equal(rows.length, 1, '始终只有一行')
  assert.equal(rows[0]!.subject_user_id, 'user_001', '键不被后来者改写')
})

test('D-3：subject 的 FK 真生效——不存在的 user id 抛，而不是静默落一行指向空气的键', () => {
  const { rw } = openRw()
  const iid = rw.upsertInsight(RELATIONSHIP_INSIGHT_CATEGORY, '一条结论', { now: T0 })
  assert.throws(() => rw.scopeInsightSubject(iid, 'user_does_not_exist'))
})

test('D-4：promotedRelationshipInsights 三条件齐备才可见（active ∧ relationship ∧ 键相符）', () => {
  const { rw, raw } = openRw()

  const keyed = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '和他说话不用铺垫')
  rw.scopeInsightSubject(keyed, 'user_001')

  // 影子期未过的 relationship 行：有键，但不是 active。
  const shadow = rw.upsertInsight(RELATIONSHIP_INSIGHT_CATEGORY, '还没站住的相处结论', { now: T0 })
  rw.recordFocusInsight(shadow, { cycleId: 1, now: T0 })
  rw.scopeInsightSubject(shadow, 'user_001')

  // active 的 relationship 行但**没登记实体轴**：不属于任何人，谁也看不到。
  seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '没有键的相处结论')

  // 键到第二个人的 active 行（⑥ 负例的数据面）。
  const other = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '和另一个人的相处方式')
  seedSecondUser(raw)
  rw.scopeInsightSubject(other, 'user_002')

  const mine = rw.promotedRelationshipInsights('user_001')
  assert.deepEqual(mine.map((r) => r.insight_id), [keyed])
  assert.equal(mine[0]!.content, '和他说话不用铺垫')
  assert.equal(mine[0]!.category, RELATIONSHIP_INSIGHT_CATEGORY)

  const theirs = rw.promotedRelationshipInsights('user_002')
  assert.deepEqual(theirs.map((r) => r.insight_id), [other],
    '不同的人不同的脸：各自只看得见键到自己的那些')
})

test('D-4 两口互斥且并集 = 旧全集（= status active 的全部行）', () => {
  const { rw, raw } = openRw()
  seedSecondUser(raw)

  const f1 = seedActive(rw, FOCUS, '我在深夜想事情更清楚')
  const f2 = seedActive(rw, FOCUS, '写下来比想清楚更快')
  const r1 = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '和他说话不用铺垫')
  rw.scopeInsightSubject(r1, 'user_001')
  const r2 = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '和另一个人要客气些')
  rw.scopeInsightSubject(r2, 'user_002')
  // 没有键的 relationship 行：不进 relationship 口，也不该进 focus 口。
  const orphanKey = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '无键的相处结论')

  const focusIds = rw.promotedFocusInsights().map((r) => r.insight_id as number)
  const relIds = [
    ...rw.promotedRelationshipInsights('user_001'),
    ...rw.promotedRelationshipInsights('user_002'),
  ].map((r) => r.insight_id as number)

  assert.deepEqual(focusIds, [f1, f2], 'focus 口不含任何 relationship 行')
  assert.deepEqual(relIds.sort((a, b) => a - b), [r1, r2])
  assert.equal(focusIds.some((id) => relIds.includes(id)), false, '互斥')

  // 并集（含无键那条）= listFocusInsights('active') 全集。
  const all = rw.listFocusInsights('active').map((r) => r.insight_id as number)
  assert.deepEqual(all.sort((a, b) => a - b), [f1, f2, r1, r2, orphanKey].sort((a, b) => a - b))
  assert.equal(
    [...focusIds, ...relIds].includes(orphanKey), false,
    '无键的 relationship 行两个口都不给——一条没有"对谁"的相处结论是坏数据',
  )
})

test('D-4：LEFT JOIN 孤儿状态行（insights 那行不见了 → category NULL）仍归通用层', () => {
  const { rw, raw } = openRw()
  const iid = seedActive(rw, FOCUS, '会被摘掉 insights 行的结论')
  raw.exec('PRAGMA foreign_keys = OFF')
  raw.prepare('DELETE FROM insights WHERE id = ?').run(iid)

  const rows = rw.promotedFocusInsights()
  assert.deepEqual(rows.map((r) => r.insight_id), [iid], 'COALESCE 让 NULL 类别留在通用层')
  assert.equal(rows[0]!.category, null)
})

test('D-4：listFocusInsights 一字不动——relationship 行照旧在它的全集里', () => {
  const { rw } = openRw()
  const iid = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, '一条相处结论')
  rw.scopeInsightSubject(iid, 'user_001')

  assert.deepEqual(rw.listFocusInsights('active').map((r) => r.insight_id), [iid],
    'L4 的 promote/retire/relit/contested 全走这个口，因此自动覆盖 relationship 行')
})

test('顺序：两个读口都按 insight_id 升序（装配顺序确定，不随插入顺序漂）', () => {
  const { rw } = openRw()
  const a = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, 'A')
  const b = seedActive(rw, RELATIONSHIP_INSIGHT_CATEGORY, 'B')
  rw.scopeInsightSubject(b, 'user_001')
  rw.scopeInsightSubject(a, 'user_001')
  assert.deepEqual(rw.promotedRelationshipInsights('user_001').map((r) => r.insight_id), [a, b])
})
