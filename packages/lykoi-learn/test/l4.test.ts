/**
 * L4 · 专注思考（SA-117..140）。节律派生/全套门（选择/反刍/影子/血缘）/失败面/
 * SA-130 周期序号例外红测/写集对拍（含"零调节场零叙事"负断言）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { INTEGRATION_EVERY_HOURS } from '../src/l2.ts'
import {
  COOLDOWN_CYCLES, FOCUS_EVERY_HOURS, FOCUS_EVERY_INTEGRATIONS, FOCUS_INSIGHT_CATEGORY,
  NO_PROGRESS_STREAK_LIMIT, SHADOW_PERIOD_CYCLES, maybeRunFocusCycle, parseFocusEnvelope,
  runFocusCycle, selectConcern, shouldFocus,
} from '../src/l4.ts'
import type { FocusDeps } from '../src/l4.ts'
import {
  PERSONA, T0, changedTables, eventLog, fakeCompletion, hoursAfter, makeStore,
  minutesAfter, rawOpen, scopeConcern, seedExperience, setLoad, tableDigests,
} from './fixture.ts'
import type { EventLog } from './fixture.ts'
import type { ReadWriteMemory } from 'lykoi-memory/rw'

function mkDeps(store: ReadWriteMemory, log: EventLog, now: Date,
  ...replies: (string | Error)[]): { deps: FocusDeps; calls: unknown[][] } {
  const { completion, calls } = fakeCompletion(...replies)
  return {
    deps: { store, persona: PERSONA, completion, logEvent: log.logEvent, now },
    calls,
  }
}

const noProgress = (note = '想不出来') => JSON.stringify({
  outcome: 'no_progress', conclusion: null, revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note,
})

const advanced = (conclusion: string, extra: Record<string, unknown> = {}) => JSON.stringify({
  outcome: 'advanced', conclusion, revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note: '有进展', ...extra,
})

test('SA-117：FOCUS_EVERY_HOURS 派生自 INTEGRATION_EVERY_HOURS（G-4 墙钟形态），不是自己写的 24', () => {
  assert.equal(FOCUS_EVERY_INTEGRATIONS, 1)
  assert.equal(FOCUS_EVERY_HOURS, INTEGRATION_EVERY_HOURS * FOCUS_EVERY_INTEGRATIONS)
})

test('SA-118/G-4：无 pending 前置（空库照样 scheduled）、无 early 路（load 0.95 不开闸）；锚=上次周期墙钟', async () => {
  const { store, path, log } = makeStore()
  try {
    // 从未跑过 + 全库零原料零关切 → scheduled（与 L2 的 no_pending 前置刻意不同）。
    assert.deepEqual(shouldFocus(store, T0), { should: true, reason: 'scheduled' })
    // 跑一个（空转）周期 → 锚落在 T0。
    const { deps } = mkDeps(store, log, T0)
    const summary = await runFocusCycle(deps)
    assert.equal(summary.outcome, 'idle')
    assert.deepEqual(shouldFocus(store, hoursAfter(T0, 23)), { should: false, reason: 'not_yet' })
    // 无 early：load 顶到 0.95 也不开（深挖不是泄压手段）。
    setLoad(path, 0.95, hoursAfter(T0, 23))
    assert.deepEqual(shouldFocus(store, hoursAfter(T0, 23)), { should: false, reason: 'not_yet' })
    assert.deepEqual(shouldFocus(store, hoursAfter(T0, 24)), { should: true, reason: 'scheduled' })
  } finally {
    store.close()
  }
})

test('SA-122 空转周期：行先落 outcome=idle、零 LLM、诚实落账；影子期结算照样跑', async () => {
  const { store, path, log } = makeStore()
  try {
    // 铺一条到期影子结论：cycle 1 里创建（先真开一个周期行以满足 FK）。
    const seedCycle = store.openFocusCycle({ now: T0 }) // = 1
    const iid = store.upsertInsight(FOCUS_INSIGHT_CATEGORY, '一条影子结论', { now: T0 })
    store.recordFocusInsight(iid, { cycleId: seedCycle, now: T0 })
    store.finalizeFocusCycle(seedCycle, { outcome: 'idle', now: T0 })

    // 跑到 cycle 3（3-1=2 >= S=2 → 到期）：两个空转周期，全程零 LLM。
    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 24))
    const s2 = await runFocusCycle(d2)
    assert.deepEqual([s2.cycle_id, s2.outcome, s2.note, s2.llm_calls], [2, 'idle', 'no selectable concern', 0])
    assert.deepEqual(s2.promoted, []) // 2-1=1 < 2：还没到
    const { deps: d3 } = mkDeps(store, log, hoursAfter(T0, 48))
    const s3 = await runFocusCycle(d3)
    assert.deepEqual(s3.promoted, [iid]) // 空转周期照样结算影子期
    assert.equal(store.listFocusInsights('active').length, 1)

    // 台账行诚实：idle 不算失败。
    const db = rawOpen(path)
    try {
      const row = db.prepare('SELECT outcome, note, llm_calls FROM focus_cycles WHERE id = 2').get() as Record<string, unknown>
      assert.deepEqual({ ...row }, { outcome: 'idle', note: 'no selectable concern', llm_calls: 0 })
    } finally {
      db.close()
    }
    assert.ok(log.names().includes('focus_cycle_idle'))
  } finally {
    store.close()
  }
})

test('SA-120/121 选择策略：三级排序逐字；owner 轴每 3 周期、捞空退回全体记 owner_axis_empty', () => {
  const { store, path } = makeStore()
  try {
    const cOwner = store.createConcern('question', 'Kevin 指定的', { weight: 0.1, origin: 'owner_directed', now: T0 })
    const cHot = store.createConcern('project', '高热度', { weight: 0.9, origin: 'grown', now: T0 })
    const cCold = store.createConcern('interest', '低热度', { weight: 0.9, origin: 'grown', now: T0 })
    const db = rawOpen(path)
    try {
      db.prepare('UPDATE concerns SET lit_count = 50 WHERE id = ?').run(cHot)
      db.prepare('UPDATE concerns SET lit_count = 3 WHERE id = ?').run(cCold)
    } finally {
      db.close()
    }
    // 非 owner 轴周期（4%3=1）：owner_directed 优先于 lit_count 与 weight。
    let [chosen, reason] = selectConcern(store, 4)
    assert.equal(chosen!.id, cOwner)
    assert.equal(reason.rule, 'owner_directed')
    // owner_directed 移出后按 lit_count 降序。
    const dbb = rawOpen(path)
    try {
      dbb.prepare("UPDATE concerns SET origin = 'grown' WHERE id = ?").run(cOwner)
    } finally {
      dbb.close()
    }
    ;[chosen, reason] = selectConcern(store, 4)
    assert.equal(chosen!.id, cHot)
    assert.equal(reason.rule, 'lit_count')
    // owner 轴周期（3%3=0）：无人有作用域 → owner_axis_empty: 前缀 + 退回全体。
    ;[chosen, reason] = selectConcern(store, 3)
    assert.equal(chosen!.id, cHot)
    assert.equal(reason.rule, 'owner_axis_empty:lit_count')
    // 给低热度那条登记 owner 作用域 → owner 轴周期缩池到它。
    scopeConcern(path, cCold, 'user_001')
    ;[chosen, reason] = selectConcern(store, 3)
    assert.equal(chosen!.id, cCold)
    assert.equal(reason.rule, 'owner_axis:lit_count')
    assert.equal(reason.owner_axis_cycle, true)
  } finally {
    store.close()
  }
})

test('SA-123：候选排除 released、不排除 dormant；冷却中的被跳过并入账 skipped_in_cooldown', () => {
  const { store, path } = makeStore()
  try {
    const cDormant = store.createConcern('interest', '久未点亮', { weight: 0.4, origin: 'grown', now: T0 })
    const cReleased = store.createConcern('interest', '已释放', { weight: 0.4, origin: 'grown', now: T0 })
    const cCooling = store.createConcern('interest', '冷却中', { weight: 0.4, origin: 'grown', now: T0 })
    const db = rawOpen(path)
    try {
      db.prepare("UPDATE concerns SET status = 'dormant' WHERE id = ?").run(cDormant)
      db.prepare("UPDATE concerns SET status = 'released' WHERE id = ?").run(cReleased)
    } finally {
      db.close()
    }
    store.updateConcernFocusState(cCooling, {
      noProgressStreak: 0, cooldownUntilCycle: 9, cooldownCount: 1,
      lastCycleId: 1, releaseSuggestedAtCycle: null, now: T0,
    })
    const [chosen, reason] = selectConcern(store, 5)
    assert.equal(chosen!.id, cDormant) // dormant 在候选内（层 2 的价值恰在于此）
    assert.equal(reason.candidates, 2) // released 根本不进候选
    assert.deepEqual(reason.skipped_in_cooldown, [cCooling])
    // 冷却期满（cycle 9 不再 > 9）回池。
    const [, reason9] = selectConcern(store, 9)
    assert.deepEqual(reason9.skipped_in_cooldown, [])
  } finally {
    store.close()
  }
})

test('SA-124 召回为空 → no_progress、零 LLM；SA-140 outcome 区分 idle 与 no_progress', async () => {
  const { store, path, log } = makeStore()
  try {
    const cid = store.createConcern('question', '哲学之问', { weight: 0.5, origin: 'grown', now: T0 })
    // 库里没有任何能命中"哲学之问"的经验 → empty recall；fakeCompletion 无 reply：被调即炸。
    const { deps } = mkDeps(store, log, hoursAfter(T0, 1))
    const summary = await runFocusCycle(deps)
    assert.deepEqual([summary.outcome, summary.note, summary.llm_calls, summary.retrieved],
      ['no_progress', 'empty recall', 0, 0])
    // 反刍计数如实 +1（这与 idle 是两件事——SA-140 的台账面）。
    assert.equal(store.getConcernFocusState(cid).no_progress_streak, 1)
    const db = rawOpen(path)
    try {
      const row = db.prepare('SELECT outcome FROM focus_cycles WHERE id = 1').get() as { outcome: string }
      assert.equal(row.outcome, 'no_progress')
    } finally {
      db.close()
    }
  } finally {
    store.close()
  }
})

test('SA-125/126 失败面：llm_calls=1 在 await 前计账；LLM 异常/解析失败 → failed、不重试、不动反刍计数', async () => {
  const { store, log } = makeStore()
  try {
    const cid = store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊了睡眠质量', T0)

    // ① LLM 异常。
    const { deps: d1 } = mkDeps(store, log, hoursAfter(T0, 1), new Error('api down'))
    const s1 = await runFocusCycle(d1)
    assert.deepEqual([s1.outcome, s1.llm_calls], ['failed', 1])
    assert.match(s1.note, /api down/)
    assert.equal(log.of('focus_llm_failed').length, 1)
    // 不动反刍计数（touch 只写 last_cycle_id）。
    const st1 = store.getConcernFocusState(cid)
    assert.deepEqual([st1.no_progress_streak, st1.last_cycle_id], [0, 1])

    // ② 解析失败（同路径，note=parse_failed）。
    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 25), '这不是 JSON')
    const s2 = await runFocusCycle(d2)
    assert.deepEqual([s2.outcome, s2.note, s2.llm_calls], ['failed', 'parse_failed', 1])
    assert.equal(store.getConcernFocusState(cid).no_progress_streak, 0)
  } finally {
    store.close()
  }
})

test('快乐路 advanced：结论落影子 + 血缘=关切+全部原料（非自陈）+ 点亮；写集零调节场零叙事（SA-82/137）', async () => {
  const { store, path, log } = makeStore()
  try {
    const cid = store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '最近睡眠质量差', minutesAfter(T0, 1))
    seedExperience(store, 'conversation', '睡眠质量和光照有关', minutesAfter(T0, 2))

    const before = tableDigests(path)
    const { deps } = mkDeps(store, log, hoursAfter(T0, 1),
      advanced('光照可能是睡眠质量的主因', { cited_experience_ids: [1] }))
    const summary = await runFocusCycle(deps)
    const after = tableDigests(path)

    assert.equal(summary.outcome, 'advanced')
    assert.equal(summary.insight_is_new, true)
    assert.ok(summary.insight_id !== null)
    // 血缘 = 1 关切 + 2 原料（她只自陈了 1 条，但入账口径是喂进 prompt 的全部）。
    assert.equal(summary.lineage_rows, 3)
    const lineage = store.lineageForProduct('insight', summary.insight_id!)
    assert.deepEqual(lineage.map((r) => r.source_kind).sort(), ['concern', 'experience', 'experience'])
    // 影子状态 + 点亮。
    assert.equal(store.getFocusInsightState(summary.insight_id!)!.status, 'shadow')
    const db = rawOpen(path)
    try {
      assert.equal((db.prepare('SELECT lit_count FROM concerns WHERE id = ?').get(cid) as { lit_count: number }).lit_count, 1)
    } finally {
      db.close()
    }
    // 写集对拍：层 2 安全边界的物理面——regulation_* 与 narrative_* 一字未动。
    const changed = changedTables(before, after)
    assert.deepEqual(changed, [
      'concern_focus_state', 'concerns', 'focus_cycles', 'focus_insight_history',
      'focus_insight_state', 'insights', 'learning_layer_state', 'product_lineage',
      'sqlite_sequence',
    ])
    assert.ok(!changed.includes('regulation_events') && !changed.includes('regulation_field'))
    assert.ok(!changed.includes('narrative_versions'))
  } finally {
    store.close()
  }
})

test('SA-133 重申不是进展：逐字相同结论 → 同 insight、影子期不重新计时、反刍计数照吃', async () => {
  const { store, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const { deps: d1 } = mkDeps(store, log, hoursAfter(T0, 1), advanced('同一句结论'))
    const s1 = await runFocusCycle(d1)
    assert.equal(s1.insight_is_new, true)
    const created = store.getFocusInsightState(s1.insight_id!)!.created_cycle_id

    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 25), advanced('同一句结论'))
    const s2 = await runFocusCycle(d2)
    assert.equal(s2.insight_id, s1.insight_id)
    assert.equal(s2.insight_is_new, false)
    // 影子期不因重申重新计时。
    assert.equal(store.getFocusInsightState(s1.insight_id!)!.created_cycle_id, created)
    // 重申如实喂进反刍计数（不伪装成进展）。
    assert.equal(store.getConcernFocusState(s1.concern_id!).no_progress_streak, 1)
    assert.equal(log.of('focus_insight_recorded').at(-1)!.reaffirmed, true)
  } finally {
    store.close()
  }
})

test('SA-129 contested 两段式：首报冲突→contested（钉首个起争周期）；仍冲突→withdrawn；内容一字不动', async () => {
  const { store, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const { deps: d1 } = mkDeps(store, log, hoursAfter(T0, 1), advanced('旧结论'))
    const s1 = await runFocusCycle(d1)
    const iid = s1.insight_id!

    // 首报冲突（no_progress + conflicts）。
    const conflictReply = (note: string) => JSON.stringify({
      outcome: 'no_progress', conclusion: null, revises_insight_id: null,
      conflicts: [{ insight_id: iid, note }], cited_experience_ids: [],
      new_concern: null, note: '有矛盾',
    })
    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 25), conflictReply('对不上'))
    const s2 = await runFocusCycle(d2)
    assert.deepEqual(s2.contested, [iid])
    const st = store.getFocusInsightState(iid)!
    assert.deepEqual([st.status, st.contested_since_cycle], ['contested', s2.cycle_id])

    // 仍冲突 → 本周期了结：withdrawn；insights.content 原样。
    const { deps: d3 } = mkDeps(store, log, hoursAfter(T0, 49), conflictReply('还是对不上'))
    const s3 = await runFocusCycle(d3)
    assert.deepEqual(s3.revised, [{ insight_id: iid, to: 'withdrawn' }])
    const final = store.getFocusInsightState(iid)!
    assert.equal(final.status, 'withdrawn')
    assert.equal(final.contested_since_cycle, s2.cycle_id) // 终局保留起争周期
    assert.equal(store.getInsights(FOCUS_INSIGHT_CATEGORY)[0]!.content, '旧结论')
    // 历史追加式全程留痕。
    assert.ok(store.focusInsightHistory(iid).length >= 3)
  } finally {
    store.close()
  }
})

test('SA-129 revised 落法：仍冲突且给了替代结论 → 旧行 revised + superseded_by，outcome=revised', async () => {
  const { store, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const { deps: d1 } = mkDeps(store, log, hoursAfter(T0, 1), advanced('旧结论'))
    const s1 = await runFocusCycle(d1)
    const iid = s1.insight_id!
    store.setFocusInsightStatus(iid, 'contested', { cycleId: s1.cycle_id!, reason: 'seed', now: T0 })

    const reply = JSON.stringify({
      outcome: 'revised', conclusion: '新结论取而代之', revises_insight_id: iid,
      conflicts: [{ insight_id: iid, note: '仍冲突' }], cited_experience_ids: [],
      new_concern: null, note: '修订',
    })
    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 25), reply)
    const s2 = await runFocusCycle(d2)
    assert.equal(s2.outcome, 'revised')
    const old = store.getFocusInsightState(iid)!
    assert.deepEqual([old.status, old.superseded_by], ['revised', s2.insight_id])
    assert.equal(store.getFocusInsightState(s2.insight_id!)!.status, 'shadow')
    // 血缘含被修订的旧结论（"我以前以为 X"里的 X 是 Y 的原料）。
    assert.ok(store.lineageForProduct('insight', s2.insight_id!)
      .some((r) => r.source_kind === 'insight' && r.source_id === String(iid)))
  } finally {
    store.close()
  }
})

test('SA-130 例外红测：影子期按周期序号结算——墙钟走了三周、没有周期就不放行', async () => {
  const { store, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const { deps: d1 } = mkDeps(store, log, hoursAfter(T0, 1), advanced('结论'))
    const s1 = await runFocusCycle(d1) // cycle 1，影子创建
    // 三周后第一个周期（cycle 2）：2-1=1 < S=2 → 不放行，哪怕墙钟走了 21 天。
    const { deps: d2 } = mkDeps(store, log, hoursAfter(T0, 21 * 24), noProgress())
    const s2 = await runFocusCycle(d2)
    assert.deepEqual(s2.promoted, [])
    assert.equal(store.getFocusInsightState(s1.insight_id!)!.status, 'shadow')
    // 再一个周期（cycle 3）：3-1=2 >= 2 → 放行。
    const { deps: d3 } = mkDeps(store, log, hoursAfter(T0, 22 * 24), noProgress())
    const s3 = await runFocusCycle(d3)
    assert.deepEqual(s3.promoted, [s1.insight_id])
    assert.equal(store.getFocusInsightState(s1.insight_id!)!.status, 'active')
    // SA-134：唯一对外消费口只吐 active。
    assert.deepEqual(store.promotedFocusInsights().map((r) => r.insight_id), [s1.insight_id])
  } finally {
    store.close()
  }
})

test('SA-127/128 反刍闸：streak 3→冷却 5 周期+计数；cooldown_count>2 → 建议释放（只建议不执行）', async () => {
  const { store, path, log } = makeStore()
  try {
    const cid = store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    // 铺到"已冷却过 2 次"：下一次冷却就该触发建议释放。
    store.updateConcernFocusState(cid, {
      noProgressStreak: 0, cooldownUntilCycle: null, cooldownCount: 2,
      lastCycleId: null as unknown as number, releaseSuggestedAtCycle: null, now: T0,
    })
    let lastCycle = 0
    for (let i = 0; i < NO_PROGRESS_STREAK_LIMIT; i += 1) {
      const { deps } = mkDeps(store, log, hoursAfter(T0, 1 + i * 24), noProgress())
      const s = await runFocusCycle(deps)
      lastCycle = s.cycle_id!
      if (i < NO_PROGRESS_STREAK_LIMIT - 1) {
        assert.equal(s.cooldown_started, false)
      } else {
        assert.equal(s.cooldown_started, true)
        assert.equal(s.release_suggested, true)
        assert.ok(s.suggestion_id !== null)
      }
    }
    const st = store.getConcernFocusState(cid)
    assert.deepEqual(
      [st.no_progress_streak, st.cooldown_count, st.cooldown_until_cycle, st.release_suggested_at_cycle],
      [0, 3, lastCycle + COOLDOWN_CYCLES, lastCycle])
    // L5 队列真拿到了这条（kind=concern_release，dedup=code 派生）。
    const row = store.ruleSuggestionByDedupKey(`concern_release:${cid}`)!
    assert.equal(row.kind, 'concern_release')
    assert.equal(row.suggestion_text,
      `我在「睡眠质量」上反复想了很多轮都没有新东西 (已经强制冷却 3 次)。要不要把这条关切放掉?`)
    // 只建议不执行：关切一列没动（status 仍 active）。
    const db = rawOpen(path)
    try {
      assert.equal((db.prepare('SELECT status FROM concerns WHERE id = ?').get(cid) as { status: string }).status, 'active')
    } finally {
      db.close()
    }
    // 事件序里有 cooldown 与 release_suggested。
    assert.ok(log.names().includes('focus_concern_cooldown'))
    assert.ok(log.names().includes('focus_release_suggested'))
    // 冷却期内选择策略跳过它 → 下一周期空转。
    const { deps: dIdle } = mkDeps(store, log, hoursAfter(T0, 100 * 24))
    const sIdle = await runFocusCycle(dIdle)
    assert.equal(sIdle.outcome, 'idle')
  } finally {
    store.close()
  }
})

test('SA-145/146：触及权限边界的结论入队 permission_rule，且**照常**走影子期（两路互不相干）', async () => {
  const { store, log } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const conclusion = '这类查询他总是批准, 也许可以申请预授权'
    const { deps } = mkDeps(store, log, hoursAfter(T0, 1), advanced(conclusion))
    const summary = await runFocusCycle(deps)
    assert.ok(summary.permission_suggestion_id !== null)
    const row = store.getRuleSuggestion(summary.permission_suggestion_id!)!
    assert.deepEqual([row.kind, row.suggestion_text, row.dedup_key],
      ['permission_rule', conclusion, `permission_rule:${summary.insight_id}`])
    // 入队不豁免影子期：insight 仍是 shadow，转正只按周期序号走（SA-146）。
    assert.equal(store.getFocusInsightState(summary.insight_id!)!.status, 'shadow')
    assert.equal(log.of('rule_suggestion_permission_gated')[0]!.enqueued, true)
  } finally {
    store.close()
  }
})

test('SA-136 派生关切失败不是周期失败：active 满 12 撞帽 → 主结论照落 + 事件', async () => {
  const { store, log } = makeStore()
  try {
    for (let i = 0; i < 12; i += 1) {
      store.createConcern('interest', `占位 ${i} 睡眠质量`, { weight: 0.5, origin: 'grown', now: T0 })
    }
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const reply = advanced('主结论', {
      new_concern: { kind: 'question', title: '第十三条', description: '', weight: 0.5 },
    })
    const { deps } = mkDeps(store, log, hoursAfter(T0, 1), reply)
    const summary = await runFocusCycle(deps)
    assert.equal(summary.outcome, 'advanced')
    assert.ok(summary.insight_id !== null)
    assert.equal(summary.derived_concern_id, null)
    assert.equal(log.of('focus_derived_concern_rejected').length, 1)
  } finally {
    store.close()
  }
})

test('派生关切成功：origin=derived + parent_id + 自己的血缘行', async () => {
  const { store, path, log } = makeStore()
  try {
    const cid = store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const reply = advanced('主结论', {
      new_concern: { kind: 'question', title: '光照与睡眠', description: '深挖长出来的', weight: 0.4 },
    })
    const { deps } = mkDeps(store, log, hoursAfter(T0, 1), reply)
    const summary = await runFocusCycle(deps)
    assert.ok(summary.derived_concern_id !== null)
    const db = rawOpen(path)
    try {
      const row = db.prepare('SELECT origin, parent_id FROM concerns WHERE id = ?')
        .get(summary.derived_concern_id!) as { origin: string; parent_id: number }
      assert.deepEqual({ ...row }, { origin: 'derived', parent_id: cid })
    } finally {
      db.close()
    }
    assert.ok(store.lineageForProduct('concern', summary.derived_concern_id!).length >= 2)
  } finally {
    store.close()
  }
})

test('SA-139 信封收敛：advanced 无 conclusion → no_progress；防御式解析永不抛', () => {
  assert.equal(parseFocusEnvelope({ outcome: 'advanced', conclusion: null }).outcome, 'no_progress')
  assert.equal(parseFocusEnvelope({ outcome: 'revised', conclusion: '  ' }).outcome, 'no_progress')
  assert.equal(parseFocusEnvelope({ outcome: 'advanced', conclusion: '有' }).outcome, 'advanced')
  assert.equal(parseFocusEnvelope('garbage').outcome, 'no_progress')
  assert.deepEqual(parseFocusEnvelope({ conflicts: [{ insight_id: true }] }).conflicts, [])
  assert.deepEqual(parseFocusEnvelope({ cited_experience_ids: [1, true, 'x', 2] }).cited_experience_ids, [1, 2])
})

test('maybeRunFocusCycle：闸没开 → null 零副作用；闸开 → autonomy_focus 事件带账面字段', async () => {
  const { store, path, log } = makeStore()
  try {
    // 先跑一个周期把锚落下。
    const { deps: d1 } = mkDeps(store, log, T0)
    await runFocusCycle(d1)
    const before = tableDigests(path)
    const { deps: dClosed } = mkDeps(store, log, hoursAfter(T0, 1))
    assert.equal(await maybeRunFocusCycle(dClosed), null)
    assert.deepEqual(changedTables(before, tableDigests(path)), [])
    // 24h 后闸开。
    const { deps: dOpen } = mkDeps(store, log, hoursAfter(T0, 24))
    const summary = await maybeRunFocusCycle(dOpen)
    assert.ok(summary !== null)
    const evt = log.of('autonomy_focus').at(-1)!
    assert.deepEqual([evt.reason, evt.cycle_id, evt.outcome], ['scheduled', summary!.cycle_id, summary!.outcome])
  } finally {
    store.close()
  }
})

test('编排层异常也落诚实失败周期（外层 except）：finalize 有行、finally 清零不缺席', async () => {
  const { store, path } = makeStore()
  try {
    store.createConcern('project', '睡眠质量', { weight: 0.5, origin: 'grown', now: T0 })
    seedExperience(store, 'conversation', '聊睡眠质量', T0)
    const log = eventLog()
    // 让 finalize 之前的路径炸：注入一个 upsertInsight 会抛的 store 包装。
    const broken = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === 'upsertInsight') {
          return () => {
            throw new Error('disk full')
          }
        }
        const v = Reflect.get(target, prop, receiver)
        return typeof v === 'function' ? v.bind(target) : v
      },
    })
    const { completion } = fakeCompletion(advanced('会在落库时炸'))
    const summary = await runFocusCycle({
      store: broken, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 1),
    })
    assert.equal(summary.outcome, 'failed')
    assert.match(summary.note, /disk full/)
    assert.ok(log.names().includes('focus_cycle_error'))
    const db = rawOpen(path)
    try {
      const row = db.prepare('SELECT outcome FROM focus_cycles WHERE id = 1').get() as { outcome: string }
      assert.equal(row.outcome, 'failed')
    } finally {
      db.close()
    }
  } finally {
    store.close()
  }
})
