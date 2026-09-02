/**
 * WO-PERS-OVERLAY-01 · relationship overlay 的 **L4 侧**（D-PERS-2）。
 *
 * 钉的是治理定案 D-1..D-4/D-6/D-9 在 L4 的落点：类别判别式 = 关切 kind（不由她
 * 自陈）、KEY 推导序（关切实体轴 → owner_primary → 不键控）、scope 写与事件面、
 * 骨架复用（影子门/衰减/点亮对 relationship 行一视同仁）、summary 账面字段。
 *
 * 时钟纪律：全部 Date 由 T0 派生，**零真实时钟读取**；周期序号用 seedCyclesUpTo 压。
 * 事件纪律：**精确匹配**事件类型与字段，不做子串 grep。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  INSIGHT_STALE_AFTER_CYCLES, RELATIONSHIP_CONCERN_KIND, SHADOW_PERIOD_CYCLES,
  runFocusCycle,
} from '../src/l4.ts'
import { RELATIONSHIP_INSIGHT_CATEGORY } from '../src/shared.ts'
import type { FocusDeps, FocusSummary } from '../src/l4.ts'
import {
  PERSONA, T0, fakeCompletion, formatPyIso, hoursAfter, makeStore, minutesAfter, rawOpen,
  scopeConcern, scopeExperience, seedExperience,
} from './fixture.ts'
import type { EventLog } from './fixture.ts'
import type { ReadWriteMemory } from 'lykoi-memory/rw'

const FOCUS_CATEGORY = 'focus'

function mkDeps(store: ReadWriteMemory, log: EventLog, now: Date,
  ...replies: (string | Error)[]): FocusDeps {
  const { completion } = fakeCompletion(...replies)
  return { store, persona: PERSONA, completion, logEvent: log.logEvent, now }
}

const advanced = (conclusion: string) => JSON.stringify({
  outcome: 'advanced', conclusion, revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note: '有进展',
})

/** 把 focus_cycles 的序号推到 lastId（同 l4-decay 的范式：压周期序号，不跑真周期）。 */
function seedCyclesUpTo(path: string, lastId: number): void {
  const db = rawOpen(path)
  try {
    const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM focus_cycles')
      .get() as { m: number }).m
    const insert = db.prepare(
      "INSERT INTO focus_cycles (id, started_at, outcome) VALUES (?, ?, 'idle')")
    for (let id = max + 1; id <= lastId; id += 1) {
      insert.run(id, formatPyIso(T0))
    }
  } finally {
    db.close()
  }
}

/** 播第二个用户（owner_primary 有部分唯一索引，第二个人只能是 group_member）。 */
function seedSecondUser(path: string, id = 'user_002'): string {
  const db = rawOpen(path)
  try {
    db.prepare(
      "INSERT INTO users (id, display_name, role, created_at) VALUES (?, ?, 'group_member', ?)",
    ).run(id, id, formatPyIso(T0))
  } finally {
    db.close()
  }
  return id
}

/** 把 owner_primary 那行置 archived → ownerPrimaryUserId() 返回 null（④ 的兜底铺设）。 */
function archiveOwner(path: string): void {
  const db = rawOpen(path)
  try {
    db.prepare("UPDATE users SET status = 'archived' WHERE role = 'owner_primary'").run()
  } finally {
    db.close()
  }
}

/**
 * 铺一条关切 + 一条能被它召回的原料（SA-124：召回为空 = 零 LLM 调用的 no_progress，
 * 所以每个走到 LLM 的用例都得有料）。`subject` 给定时同时登记关切与原料的实体轴
 * ——检索按关切的实体轴硬过滤（§3.6），只挂关切不挂原料会召回为空。
 */
function seedConcernWithMaterial(
  store: ReadWriteMemory, path: string, kind: string, title: string,
  opts?: { subject?: string },
): number {
  const cid = store.createConcern(kind, title, {
    weight: 0.6, origin: kind === RELATIONSHIP_CONCERN_KIND ? 'relationship' : 'seed', now: T0,
  })
  const eid = seedExperience(store, 'conversation', `聊${title}`, minutesAfter(T0, 1))
  if (opts?.subject) {
    scopeConcern(path, cid, opts.subject)
    scopeExperience(path, eid, opts.subject)
  }
  return cid
}

function scopeRows(path: string, insightId: number): Record<string, unknown>[] {
  const db = rawOpen(path)
  try {
    return db.prepare(
      "SELECT * FROM memory_scopes WHERE table_name = 'insights' AND row_id = ?",
    ).all(insightId) as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

function insightCategory(path: string, insightId: number): string {
  const db = rawOpen(path)
  try {
    return (db.prepare('SELECT category FROM insights WHERE id = ?')
      .get(insightId) as { category: string }).category
  } finally {
    db.close()
  }
}

/**
 * 事件**精确匹配**：按审计落盘形态 `{type, ...fields}` 序列化再解析回来，
 * 逐字段相等地数，不做子串 grep。
 */
function exactEvents(log: EventLog, type: string): Record<string, unknown>[] {
  return log.events
    .map(([name, fields]) => JSON.parse(JSON.stringify({ type: name, ...fields })) as
      Record<string, unknown>)
    .filter((rec) => rec.type === type)
}

// --- ① relationship_thread + advanced → 键控落地 -------------------------------

test('①：relationship_thread 关切 + advanced → category relationship、一行 shadow、一行 scope、keyed 事件精确', async () => {
  const { store, path, log } = makeStore()
  const cid = seedConcernWithMaterial(store, path, RELATIONSHIP_CONCERN_KIND, '和 Kevin 的相处')
  const summary = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('他忙起来就不爱说话，那不是针对我')))

  assert.equal(summary.outcome, 'advanced')
  assert.equal(summary.concern_id, cid)
  const iid = summary.insight_id!
  assert.equal(insightCategory(path, iid), RELATIONSHIP_INSIGHT_CATEGORY)

  // 影子门照走（骨架复用，零新状态机）。
  const state = store.getFocusInsightState(iid)!
  assert.equal(state.status, 'shadow')

  // memory_scopes 恰一行，键 = owner_primary。
  const rows = scopeRows(path, iid)
  assert.equal(rows.length, 1)
  assert.deepEqual({ ...rows[0] }, {
    table_name: 'insights', row_id: iid, subject_user_id: 'user_001',
    origin_context: null, visibility: 'private', sensitivity: 'content',
  })

  // 事件精确（type + 四个字段全等）。
  assert.deepEqual(exactEvents(log, 'relationship_overlay_keyed'), [{
    type: 'relationship_overlay_keyed',
    insight_id: iid, concern_id: cid, cycle_id: summary.cycle_id, subject_user_id: 'user_001',
  }])
  assert.equal(exactEvents(log, 'relationship_overlay_unkeyed').length, 0)

  // D-9 账面字段。
  assert.equal(summary.overlay_subject_user_id, 'user_001')
})

// --- ② 非 relationship_thread 关切 --------------------------------------------

test('②：interest 关切 → category focus、无 scope 行、无 keyed 事件、summary 字段为 null', async () => {
  const { store, path, log } = makeStore()
  seedConcernWithMaterial(store, path, 'interest', '摄影')
  const summary = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('我在深夜想事情更清楚')))

  const iid = summary.insight_id!
  assert.equal(insightCategory(path, iid), FOCUS_CATEGORY)
  assert.deepEqual(scopeRows(path, iid), [])
  assert.equal(exactEvents(log, 'relationship_overlay_keyed').length, 0)
  assert.equal(exactEvents(log, 'relationship_overlay_unkeyed').length, 0)
  assert.equal(summary.overlay_subject_user_id, null)
})

// --- ③ 关切自带实体轴时 KEY 取关切的 -------------------------------------------

test('③ KEY 推导序：关切自带实体轴 → 取关切的，不取 owner', async () => {
  const { store, path, log } = makeStore()
  const other = seedSecondUser(path)
  // 关切实体轴指向第二个人（原料同轴，否则检索硬过滤成空集）。
  const cid = seedConcernWithMaterial(
    store, path, RELATIONSHIP_CONCERN_KIND, '和另一个人的线', { subject: other })

  const summary = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('对他要更直接一点')))
  const iid = summary.insight_id!

  assert.equal(scopeRows(path, iid)[0]!.subject_user_id, other, '关切的键优先于 owner 兜底')
  assert.equal(summary.overlay_subject_user_id, other)
  assert.deepEqual(exactEvents(log, 'relationship_overlay_keyed'), [{
    type: 'relationship_overlay_keyed',
    insight_id: iid, concern_id: cid, cycle_id: summary.cycle_id, subject_user_id: other,
  }])
})

// --- ④ 两者皆 null → 兜底路 ----------------------------------------------------

test('④ D-3 兜底：关切无实体轴且 owner 行 archived → category focus + unkeyed 事件，无 scope 行', async () => {
  const { store, path, log } = makeStore()
  const cid = seedConcernWithMaterial(store, path, RELATIONSHIP_CONCERN_KIND, '一条关系线')
  archiveOwner(path)
  assert.equal(store.ownerPrimaryUserId(), null, '前置：owner 不可见')

  const summary = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('这条结论不知道该算谁的')))
  const iid = summary.insight_id!

  assert.equal(insightCategory(path, iid), FOCUS_CATEGORY, '宁可少一条 overlay')
  assert.deepEqual(scopeRows(path, iid), [], '不凭空指一个人')
  assert.deepEqual(exactEvents(log, 'relationship_overlay_unkeyed'), [{
    type: 'relationship_overlay_unkeyed',
    insight_id: iid, concern_id: cid, cycle_id: summary.cycle_id,
  }])
  assert.equal(exactEvents(log, 'relationship_overlay_keyed').length, 0)
  assert.equal(summary.overlay_subject_user_id, null)
  // 结论本身照落——兜底的是键，不是结论。
  assert.equal(summary.outcome, 'advanced')
  assert.equal(store.getFocusInsightState(iid)!.status, 'shadow')
})

// --- ⑤ 影子期后转正，两个读口分流 ----------------------------------------------

test('⑤ 骨架复用：影子期后 promoteDueInsights 转正 relationship 行；两个读口分流', async () => {
  const { store, path, log } = makeStore()
  seedConcernWithMaterial(store, path, RELATIONSHIP_CONCERN_KIND, '和 Kevin 的相处')
  const first = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('和他说话不用铺垫')))
  const iid = first.insight_id!
  assert.equal(store.getFocusInsightState(iid)!.status, 'shadow')
  assert.deepEqual(store.promotedRelationshipInsights('user_001'), [], '影子期内谁也看不到')

  // 熬过影子期（周期序号 + S），跑一个空转周期让结算发生。
  seedCyclesUpTo(path, first.cycle_id! + SHADOW_PERIOD_CYCLES - 1)
  const second = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 48)))
  assert.equal(second.cycle_id! - first.cycle_id!, SHADOW_PERIOD_CYCLES)
  assert.ok(second.promoted.includes(iid), 'promoteDueInsights 对 relationship 行一视同仁')

  const mine = store.promotedRelationshipInsights('user_001')
  assert.deepEqual(mine.map((r) => r.insight_id), [iid])
  assert.equal(mine[0]!.content, '和他说话不用铺垫')
  assert.deepEqual(store.promotedFocusInsights().map((r) => r.insight_id), [],
    'D-4：转正的 relationship 行不进通用层')
})

// --- ⑥ 负例：键到别人的行本人看不见 --------------------------------------------

test('⑥ 负例：键到第二个 user 的 active 行对 promotedRelationshipInsights(user_001) 不可见', async () => {
  const { store, path, log } = makeStore()
  const other = seedSecondUser(path)
  seedConcernWithMaterial(
    store, path, RELATIONSHIP_CONCERN_KIND, '和另一个人的线', { subject: other })

  const first = await runFocusCycle(
    mkDeps(store, log, hoursAfter(T0, 1), advanced('对他要更直接一点')))
  const iid = first.insight_id!
  seedCyclesUpTo(path, first.cycle_id! + SHADOW_PERIOD_CYCLES - 1)
  const second = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 48)))
  assert.ok(second.promoted.includes(iid))

  assert.deepEqual(store.promotedRelationshipInsights('user_001'), [],
    '不同的人不同的脸——这是一条 JOIN，不是一句约定')
  assert.deepEqual(store.promotedRelationshipInsights(other).map((r) => r.insight_id), [iid])
  assert.deepEqual(store.promotedFocusInsights().map((r) => r.insight_id), [])
})

// --- ⑦ 衰减与点亮对 relationship 行一视同仁 ------------------------------------

test('⑦ 骨架复用：relationship 行距离 >= 阈值照降 dormant，重申照点亮回 active', async () => {
  const { store, path, log } = makeStore()
  seedConcernWithMaterial(store, path, RELATIONSHIP_CONCERN_KIND, '和 Kevin 的相处')
  const conclusion = '他忙起来就不爱说话，那不是针对我'
  const first = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 1), advanced(conclusion)))
  const iid = first.insight_id!

  // 转正。
  seedCyclesUpTo(path, first.cycle_id! + SHADOW_PERIOD_CYCLES - 1)
  const promotedCycle = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 48)))
  assert.ok(promotedCycle.promoted.includes(iid))
  const touched = promotedCycle.cycle_id!

  // 距离 = 阈值 → 降 dormant（严格 >=），退出装配。
  seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
  const stale = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
  assert.equal(stale.cycle_id! - touched, INSIGHT_STALE_AFTER_CYCLES)
  assert.ok(stale.retired.includes(iid), 'retireStaleInsights 对 relationship 行一视同仁')
  assert.equal(store.getFocusInsightState(iid)!.status, 'dormant')
  assert.deepEqual(store.promotedRelationshipInsights('user_001'), [], 'dormant 退出装配')

  // 重申同一条结论 → 点亮回 active，键不变、不重复写 scope。
  const relit = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 96), advanced(conclusion)))
  assert.equal(relit.insight_id, iid, '逐字相同 → 同一 insight_id')
  assert.equal(store.getFocusInsightState(iid)!.status, 'active', '点亮')
  assert.deepEqual(store.promotedRelationshipInsights('user_001').map((r) => r.insight_id), [iid])
  assert.equal(scopeRows(path, iid).length, 1, '键在首次落地时钉死，不重复写')
})

// --- ⑧ 重申不重复写 scope，但事件照发 ------------------------------------------

test('⑧ 重申：scope 不重复写（行数不变），keyed 事件两周期各发一次（成功写入或已存在都发）', async () => {
  const { store, path, log } = makeStore()
  const cid = seedConcernWithMaterial(store, path, RELATIONSHIP_CONCERN_KIND, '和 Kevin 的相处')
  const conclusion = '和他说话不用铺垫'
  const first = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 1), advanced(conclusion)))
  const iid = first.insight_id!
  assert.equal(first.insight_is_new, true)

  const second = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 24), advanced(conclusion)))
  assert.equal(second.insight_id, iid)
  assert.equal(second.insight_is_new, false, 'SA-133：重申不是进展')

  assert.equal(scopeRows(path, iid).length, 1, '二次是空操作，行数不变')
  assert.deepEqual(exactEvents(log, 'relationship_overlay_keyed'), [
    {
      type: 'relationship_overlay_keyed', insight_id: iid, concern_id: cid,
      cycle_id: first.cycle_id, subject_user_id: 'user_001',
    },
    {
      type: 'relationship_overlay_keyed', insight_id: iid, concern_id: cid,
      cycle_id: second.cycle_id, subject_user_id: 'user_001',
    },
  ])
})

// --- D-9 默认值 ----------------------------------------------------------------

test('D-9：空转周期的 summary.overlay_subject_user_id 默认 null', async () => {
  const { store, log } = makeStore()
  const summary: FocusSummary = await runFocusCycle(mkDeps(store, log, T0))
  assert.equal(summary.outcome, 'idle')
  assert.equal(summary.overlay_subject_user_id, null)
})
