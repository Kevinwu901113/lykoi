/**
 * WO-MEM-DECAY-01 · 慢变层衰减（D-PERS-3）。
 *
 * 钉的是治理定案 D-1..D-8 在 L4 侧的落点：衰减信号 = L4 触达周期距离（**周期序号，
 * 不是墙钟**）、阈值严格 `>=`、单步无 dimming、随每一种周期结尾结算、因果出口走既
 * 有事件面、dormant 进判冲突喂入集。
 *
 * 时钟纪律：全部 Date 由 T0 派生，零真实时钟读取。周期序号本就不是时钟。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FOCUS_INSIGHT_CATEGORY, INSIGHT_STALE_AFTER_CYCLES, SHADOW_PERIOD_CYCLES,
  runFocusCycle,
} from '../src/l4.ts'
import type { FocusDeps } from '../src/l4.ts'
import {
  PERSONA, T0, fakeCompletion, hoursAfter, makeStore, rawOpen, seedExperience,
} from './fixture.ts'
import type { EventLog } from './fixture.ts'
import type { ReadWriteMemory } from 'lykoi-memory/rw'

function mkDeps(store: ReadWriteMemory, log: EventLog, now: Date,
  ...replies: (string | Error)[]): FocusDeps {
  const { completion } = fakeCompletion(...replies)
  return { store, persona: PERSONA, completion, logEvent: log.logEvent, now }
}

const noProgress = () => JSON.stringify({
  outcome: 'no_progress', conclusion: null, revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note: '想不出来',
})

const advanced = (conclusion: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  outcome: 'advanced', conclusion, revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note: '有进展', ...extra,
})

/**
 * 把 focus_cycles 的序号推到 lastId（补齐中间的台账行，FK 目标要真实存在）。
 * 这是"她跑过很多个周期"的等价物：`openFocusCycle` 用 lastInsertRowid 取号，所以
 * 补到 N 之后下一次开出来的就是 N+1。用它把边界测试压到两三个周期之内跑完，而不是
 * 真跑 33 次——被测的判据是**周期序号的差**，不是跑了多少次的副作用。
 */
function seedCyclesUpTo(path: string, lastId: number): void {
  const db = rawOpen(path)
  try {
    const max = (db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM focus_cycles')
      .get() as { m: number }).m
    const insert = db.prepare(
      "INSERT INTO focus_cycles (id, started_at, outcome) VALUES (?, ?, 'idle')")
    for (let id = max + 1; id <= lastId; id += 1) {
      insert.run(id, '2026-08-24T00:00:00+00:00')
    }
  } finally {
    db.close()
  }
}

/**
 * 铺一条**已转正**的结论：cycle 1 建影子（history 一行 @1），cycle 3 转正
 * （history 一行 @3）。返回 insight_id 与"上次触达周期" = 3。
 * 走的是真 API（recordFocusInsight / promoteDueInsights 的同一条 setFocusInsightStatus），
 * 不手写 SQL 造状态。
 */
function seedActiveInsight(store: ReadWriteMemory, content: string): {
  iid: number; touched: number
} {
  const c1 = store.openFocusCycle({ now: T0 })
  const iid = store.upsertInsight(FOCUS_INSIGHT_CATEGORY, content, { now: T0 })
  store.recordFocusInsight(iid, { cycleId: c1, now: T0 })
  store.finalizeFocusCycle(c1, { outcome: 'idle', now: T0 })
  const c2 = store.openFocusCycle({ now: hoursAfter(T0, 24) })
  store.finalizeFocusCycle(c2, { outcome: 'idle', now: hoursAfter(T0, 24) })
  const c3 = store.openFocusCycle({ now: hoursAfter(T0, 48) })
  assert.equal(c3 - c1, SHADOW_PERIOD_CYCLES) // 影子期到点
  store.setFocusInsightStatus(iid, 'active', {
    cycleId: c3, reason: `shadow period cleared (${SHADOW_PERIOD_CYCLES} cycles)`, now: T0,
  })
  store.finalizeFocusCycle(c3, { outcome: 'idle', now: hoursAfter(T0, 48) })
  assert.equal(store.getFocusInsightState(iid)!.status, 'active')
  return { iid, touched: c3 }
}

/**
 * ⑨ 事件计数：**精确匹配**事件类型与字段，不做子串 grep。审计落盘形态是一行 JSON
 * （lykoi-audit 的 `{type, ...fields}`），这里按同一形态序列化再解析回来数，钉的就是
 * `"type":"focus_insight_status"` 且 `"to":"dormant"` 这条口径。
 */
function countStatusEvents(log: EventLog, to: string): number {
  return log.events
    .map(([type, fields]) => JSON.parse(JSON.stringify({ type, ...fields })) as
      Record<string, unknown>)
    .filter((rec) => rec.type === 'focus_insight_status' && rec.to === to)
    .length
}

test('D-3：阈值常量 = 30，且住在 l4 常量区（非配置项、不读 env）', () => {
  assert.equal(INSIGHT_STALE_AFTER_CYCLES, 30)
})

test('D-2 边界：触达距离 29 不降、30 降 dormant（严格 >=）；reason 带两个周期号', async () => {
  const { store, path, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')

    // 下一个周期号 = touched + 29 → 距离 29 < 30 → 不降。
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 2)
    const sNear = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    assert.equal(sNear.cycle_id! - touched, INSIGHT_STALE_AFTER_CYCLES - 1)
    assert.deepEqual(sNear.retired, [])
    assert.equal(store.getFocusInsightState(iid)!.status, 'active')

    // 再一个周期 → 距离 30 >= 30 → 降。
    const sDue = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 96)))
    assert.equal(sDue.cycle_id! - touched, INSIGHT_STALE_AFTER_CYCLES)
    assert.deepEqual(sDue.retired, [iid])
    assert.equal(store.getFocusInsightState(iid)!.status, 'dormant')

    // D-6 因果出口：history 末行 + 事件，reason 逐字。
    const reason = `stale: last touched cycle ${touched}, now cycle ${sDue.cycle_id} `
      + `(>= ${INSIGHT_STALE_AFTER_CYCLES})`
    const last = store.focusInsightHistory(iid).at(-1)!
    assert.deepEqual([last.from_status, last.to_status, last.reason, last.cycle_id],
      ['active', 'dormant', reason, sDue.cycle_id])
    assert.equal(countStatusEvents(log, 'dormant'), 1)
    const evt = log.of('focus_insight_status').find((f) => f.to === 'dormant')!
    assert.deepEqual([evt.insight_id, evt.from, evt.to, evt.cycle_id, evt.reason],
      [iid, 'active', 'dormant', sDue.cycle_id, reason])

    // 降完就不再重复降（dormant 不在 active 集里）。
    const sAfter = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 120)))
    assert.deepEqual(sAfter.retired, [])
    assert.equal(countStatusEvents(log, 'dormant'), 1)
  } finally {
    store.close()
  }
})

test('D-2 红测：单位是周期序号不是墙钟——停机三个月、周期没走，一条也不降', async () => {
  const { store, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')
    // 墙钟推 90 天，但只开出下一个周期（距离 1）。
    const s = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 90 * 24)))
    assert.equal(s.cycle_id! - touched, 1)
    assert.deepEqual(s.retired, [])
    assert.equal(store.getFocusInsightState(iid)!.status, 'active')
    assert.equal(countStatusEvents(log, 'dormant'), 0)
  } finally {
    store.close()
  }
})

test('D-7：本周期刚重申的不降（重申先落 history @本周期，衰减排在其后）', async () => {
  const { store, path, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const s1 = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 1), advanced('同一句结论')))
    const iid = s1.insight_id!
    store.setFocusInsightStatus(iid, 'active', { cycleId: s1.cycle_id!, reason: 'seed', now: T0 })

    // 把序号推到"早就该降"的距离，然后在这一周期里重申同一句结论。
    seedCyclesUpTo(path, s1.cycle_id! + INSIGHT_STALE_AFTER_CYCLES + 5)
    const s2 = await runFocusCycle(
      mkDeps(store, log, hoursAfter(T0, 48), advanced('同一句结论')))
    assert.equal(s2.insight_id, iid) //           逐字相同 → 同一 insight_id
    assert.equal(s2.insight_is_new, false) //     重申不是新结论
    assert.ok(s2.cycle_id! - s1.cycle_id! > INSIGHT_STALE_AFTER_CYCLES)
    assert.deepEqual(s2.retired, []) //           本周期刚被触达 → 距离 0
    assert.equal(store.getFocusInsightState(iid)!.status, 'active')
    assert.equal(countStatusEvents(log, 'dormant'), 0)

    // 而下一个周期什么也不做：距离 1，照样不降（重申真的重置了计时）。
    const s3 = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72), noProgress()))
    assert.deepEqual(s3.retired, [])
  } finally {
    store.close()
  }
})

test('D-7 覆盖面：空转周期照样结算衰减（与 promoteDueInsights 同调用位）', async () => {
  const { store, path, log } = makeStore()
  try {
    // 零关切 → 每一次 runFocusCycle 都走 idle 路（零 LLM：fakeCompletion 不排队，
    // 真发出去就会抛"unexpected extra LLM call"）。
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    let finalized = 0
    const finalize = store.finalizeFocusCycle.bind(store)
    store.finalizeFocusCycle = (...args) => {
      assert.equal(store.getFocusInsightState(iid)!.status, 'dormant', '衰减先于周期收尾')
      finalized++
      return finalize(...args)
    }
    const s = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    assert.equal(finalized, 1)
    assert.deepEqual([s.outcome, s.note, s.llm_calls], ['idle', 'no selectable concern', 0])
    assert.equal(s.cycle_id! - touched, INSIGHT_STALE_AFTER_CYCLES)
    assert.deepEqual(s.retired, [iid])
    assert.equal(store.getFocusInsightState(iid)!.status, 'dormant')
  } finally {
    store.close()
  }
})

test('D-7 覆盖面：LLM 失败的周期照样结算衰减（失败不是免结算）', async () => {
  const { store, path, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    const s = await runFocusCycle(
      mkDeps(store, log, hoursAfter(T0, 72), new Error('api down')))
    assert.equal(s.outcome, 'failed')
    assert.deepEqual(s.retired, [iid])
    assert.equal(store.getFocusInsightState(iid)!.status, 'dormant')
  } finally {
    store.close()
  }
})

test('D-8：dormant 自然出局装配——promotedFocusInsights 仍 = active，语义一个字没改', async () => {
  const { store, path, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')
    assert.deepEqual(store.promotedFocusInsights().map((r) => r.insight_id), [iid])
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    assert.deepEqual(store.promotedFocusInsights(), [])
    // 但行还在，内容一个字不动（不销毁，只退出装配）。
    assert.equal(store.listFocusInsights('dormant').length, 1)
    assert.equal(store.getInsights(FOCUS_INSIGHT_CATEGORY)[0]!.content, '一条转正结论')
  } finally {
    store.close()
  }
})

test('D-5：dormant 进判冲突喂入集，被新证据推翻时当场走 contested → withdrawn', async () => {
  const { store, path, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '旧结论')
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    assert.equal(store.getFocusInsightState(iid)!.status, 'dormant')

    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const conflict = () => JSON.stringify({
      outcome: 'no_progress', conclusion: null, revises_insight_id: null,
      conflicts: [{ insight_id: iid, note: '和新证据对不上' }],
      cited_experience_ids: [], new_concern: null, note: '有冲突',
    })

    // 第一次报冲突 → contested（喂入集里看得见它，才报得出这个冲突）。
    const s1 = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 96), conflict()))
    assert.deepEqual(s1.contested, [iid])
    assert.equal(store.getFocusInsightState(iid)!.status, 'contested')
    // 仍冲突 → 当场了结成 withdrawn，而不是留到将来被点亮时带着已被推翻的内容复活。
    const s2 = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 120), conflict()))
    assert.deepEqual(s2.revised, [{ insight_id: iid, to: 'withdrawn' }])
    assert.equal(store.getFocusInsightState(iid)!.status, 'withdrawn')
  } finally {
    store.close()
  }
})

test('D-5 喂入集正断言：dormant 的内容真的进了 prompt（withdrawn/revised 仍然不进）', async () => {
  const { store, path, log } = makeStore()
  try {
    const dormant = seedActiveInsight(store, '会休眠的结论')
    const gone = store.upsertInsight(FOCUS_INSIGHT_CATEGORY, '已撤回的结论', { now: T0 })
    store.recordFocusInsight(gone, { cycleId: dormant.touched, now: T0 })
    store.setFocusInsightStatus(gone, 'withdrawn', {
      cycleId: dormant.touched, reason: 'seed', now: T0,
    })
    seedCyclesUpTo(path, dormant.touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    assert.equal(store.getFocusInsightState(dormant.iid)!.status, 'dormant')

    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const { completion, calls } = fakeCompletion(noProgress())
    await runFocusCycle({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 96),
    })
    const payload = calls[0]!.map((m) => m.content).join('\n')
    assert.ok(payload.includes('会休眠的结论'), 'dormant 结论应当在判冲突的喂入集里')
    assert.ok(!payload.includes('已撤回的结论'), 'withdrawn 是历史，不该再参与推理')
  } finally {
    store.close()
  }
})

test('D-4/D-5 状态机闭合：本单只新增 active→dormant 一条入边，且无 dimming 中间态', async () => {
  const { store, path, log } = makeStore()
  try {
    const { iid, touched } = seedActiveInsight(store, '一条转正结论')
    seedCyclesUpTo(path, touched + INSIGHT_STALE_AFTER_CYCLES - 1)
    await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 72)))
    // 全程只出现过 shadow→active 与 active→dormant 两条边，没有中间态。
    const edges = store.focusInsightHistory(iid)
      .map((r) => `${String(r.from_status)}→${String(r.to_status)}`)
    assert.deepEqual(edges, ['null→shadow', 'shadow→active', 'active→dormant'])
    // 衰减只从 active 出发：一条尚在影子期的结论不会被衰减顺手带走——它要么熬满
    // 影子期由 promoteDueInsights 转正，要么留在 shadow，没有 shadow→dormant 这条边。
    const shadow = store.upsertInsight(FOCUS_INSIGHT_CATEGORY, '一条影子结论', { now: T0 })
    store.recordFocusInsight(shadow, { cycleId: store.currentFocusCycleId(), now: T0 })
    const s = await runFocusCycle(mkDeps(store, log, hoursAfter(T0, 96)))
    assert.deepEqual(s.retired, []) //     衰减一条也没碰
    assert.deepEqual(s.promoted, []) //    影子期也还没到（距离 1 < S=2）
    assert.equal(store.getFocusInsightState(shadow)!.status, 'shadow')
    assert.deepEqual(
      store.focusInsightHistory(shadow).map((r) => String(r.to_status)), ['shadow'])
  } finally {
    store.close()
  }
})
