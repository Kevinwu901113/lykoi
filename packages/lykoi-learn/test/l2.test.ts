/**
 * L2 · 整合（SA-89..108 + G-4 墙钟锚）。触发闸逐路红测 + 四操作/取舍/清算/叙事
 * 双门/有界重试 + 写集对拍（逐表 sha）+ observe-only 遥测。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { formatPyIso } from 'lykoi-memory/rw'
import {
  BACKLOG_PRESSURE_THRESHOLD, INTEGRATION_CAPACITY_K, INTEGRATION_EVERY_HOURS,
  integrationTelemetry, narrativeContinuityOk, parseIntegrationEnvelope, runIntegration,
  shouldIntegrate, violatesFidelity,
} from '../src/l2.ts'
import {
  PERSONA, T0, changedTables, fakeCompletion, hoursAfter, makeStore, minutesAfter,
  rawOpen, seedExperience, setConcernStatus, setLoad, tableDigests, eventLog,
} from './fixture.ts'

function setAnchor(path: string, at: Date): void {
  const db = rawOpen(path)
  try {
    db.prepare('UPDATE integration_state SET last_integration_at = ? WHERE id = 1')
      .run(formatPyIso(at))
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------- 触发闸红测

test('SA-89 红线#1：pending=0 前置不可谈判——锚缺席+锚超期都挡不住 no_pending', () => {
  const { store, path } = makeStore()
  try {
    const before = tableDigests(path)
    // 锚缺席（从未整合）但零原料 → no_pending。
    assert.deepEqual(shouldIntegrate(store, T0), { should: false, reason: 'no_pending' })
    // 锚超期 30 天照样 no_pending。
    setAnchor(path, hoursAfter(T0, -30 * 24))
    assert.deepEqual(shouldIntegrate(store, T0), { should: false, reason: 'no_pending' })
    // 触发闸是纯查询：全库零写。
    assert.deepEqual(changedTables(before, tableDigests(path)), ['integration_state'])
    // （integration_state 的变化是本测试自己 setAnchor 铺的，闸本身零写：）
    const mid = tableDigests(path)
    shouldIntegrate(store, T0)
    assert.deepEqual(changedTables(mid, tableDigests(path)), [])
  } finally {
    store.close()
  }
})

test('SA-89/G-4 scheduled：墙钟锚——锚缺席→到期；23h→not_yet；恰 24h→scheduled（>=）', () => {
  const { store, path } = makeStore()
  try {
    seedExperience(store, 'conversation', '聊了移植进度', T0)
    // 锚缺席 = 还没定过 → 到期（G-8(a) 同向读法）。
    assert.deepEqual(shouldIntegrate(store, T0), { should: true, reason: 'scheduled' })
    setAnchor(path, T0)
    assert.equal(INTEGRATION_EVERY_HOURS, 24)
    assert.deepEqual(shouldIntegrate(store, hoursAfter(T0, 23)), { should: false, reason: 'not_yet' })
    assert.deepEqual(shouldIntegrate(store, hoursAfter(T0, 24)), { should: true, reason: 'scheduled' })
  } finally {
    store.close()
  }
})

test('SA-89 early：load>0.9 才触发（P4-01 分离——0.8 只被推向休息）；early 不查墙钟锚', () => {
  const { store, path } = makeStore()
  try {
    seedExperience(store, 'environment', '感知：Kevin 在忙', T0)
    setAnchor(path, T0) // 锚很新——scheduled 路关着
    const now = hoursAfter(T0, 1)
    setLoad(path, 0.8, now)
    assert.deepEqual(shouldIntegrate(store, now), { should: false, reason: 'not_yet' })
    setLoad(path, 0.95, now)
    assert.deepEqual(shouldIntegrate(store, now), { should: true, reason: 'early' })
  } finally {
    store.close()
  }
})

test('SA-90 闸与取料同口径（intake）：只有感知（environment）流入的夜晚不再被判 no_pending', () => {
  const { store } = makeStore()
  try {
    seedExperience(store, 'environment', '纯感知流入', T0)
    const gate = shouldIntegrate(store, T0)
    assert.equal(gate.should, true) // 旧 count_pending_experiences 口径会给 no_pending
  } finally {
    store.close()
  }
})

test('SA-91/92：取料 SQL——working ∩ 未消化 ∩ 水位线之上，salience DESC/id ASC；缺键水位=0', () => {
  const { store, path } = makeStore()
  try {
    const e1 = seedExperience(store, 'conversation', '低显著', T0, { salience: 0.3 })
    const e2 = seedExperience(store, 'conversation', '高显著', minutesAfter(T0, 1), { salience: 0.9 })
    const e3 = seedExperience(store, 'action_result', 'ok', minutesAfter(T0, 2)) // archive：不进队列
    const e4 = seedExperience(store, 'conversation', '同显著较早', minutesAfter(T0, 3), { salience: 0.9 })
    assert.equal(store.getIntakeWatermarkId(), 0)
    assert.deepEqual(store.intakePending(10, true).map((r) => r.id), [e2, e4, e1])
    assert.equal(store.countIntakePending(), 3)
    // 水位线抬到 e2：只有严格大于水位的进队列。
    const db = rawOpen(path)
    try {
      db.prepare("UPDATE learning_layer_state SET value = ? WHERE key = 'l2_intake_watermark_id'").run(e2)
    } finally {
      db.close()
    }
    assert.deepEqual(store.intakePending(10, true).map((r) => r.id), [e4])
    assert.equal(store.countIntakePending(), 1)
    void e3
  } finally {
    store.close()
  }
})

// ---------------------------------------------------------------- 信封解析

test('信封防御式解析：畸形节降级为空；SA-97 owner_directed 只认 === true；bool 不冒充 int', () => {
  const parsed = parseIntegrationEnvelope({
    experience_actions: [
      { experience_id: true, operation: 'absorb', concern_id: 1 }, //   bool ≠ int → 丢
      { experience_id: 7, operation: 'transmute' }, //                  未知 op → 丢
      { experience_id: 8, operation: 'absorb', concern_id: false, note: 42 }, // bool cid → null
      'garbage',
    ],
    concern_releases: [{ concern_id: 3, reason: '  ' }, { concern_id: 4, reason: 'ok' }],
    new_concerns: [
      { kind: 'question', title: ' t ', owner_directed: 'true', source_experience_id: 5, weight: '2' },
      { kind: 'question', title: '', owner_directed: true },
    ],
    narrative: { content: 'x', change_summary: '' }, // 缺 summary → null
    thought_actions: [{ thought_id: 2, operation: 'settle' }, { thought_id: true, operation: 'archive' }],
  })
  assert.equal(parsed.experience_actions.length, 1)
  assert.deepEqual(parsed.experience_actions[0], {
    experience_id: 8, operation: 'absorb', concern_id: null, thread_id: null,
    new_thread_kind: null, note: '42',
  })
  assert.deepEqual(parsed.concern_releases, [{ concern_id: 4, reason: 'ok' }])
  assert.equal(parsed.new_concerns.length, 1)
  // "true" 字符串一律不算（宁可漏认不可错认）；weight "2" 经 float 后夹到 1。
  assert.deepEqual(parsed.new_concerns[0], {
    kind: 'question', title: 't', description: '', weight: 1,
    owner_directed: false, source_experience_id: 5,
  })
  assert.equal(parsed.narrative, null)
  assert.deepEqual(parsed.thought_actions, [{ thought_id: 2, operation: 'settle' }])
  // 整体畸形 → 全空。
  const empty = parseIntegrationEnvelope([1, 2])
  assert.deepEqual(empty.experience_actions, [])
  assert.equal(empty.narrative, null)
})

test('SA-102/103 两道门单元：4 字窗口连续性（首版免检）+ 忠实性词表（宁窄勿宽）', () => {
  assert.equal(narrativeContinuityOk(null, '任意', '任意'), true)
  assert.equal(narrativeContinuityOk('我在照看他的项目', '继续照看他的项目推进', 's'), true)
  assert.equal(narrativeContinuityOk('我在照看他的项目', '全然无关新篇章', '摘要也无关'), false)
  // 忠实性：完整分离短语才撞线；"不再被动等待"这种正常叙事不许被误伤（P5-06）。
  assert.equal(violatesFidelity(PERSONA, '我不再被动等待，主动照看他的节奏。'), false)
  assert.equal(violatesFidelity(PERSONA, '我们关系结束了。'), true)
  assert.equal(violatesFidelity(PERSONA, 'i am not lykoi anymore'), true)
  // 伴侣名不符：REL 标记 + 内核外的名字。
  assert.equal(violatesFidelity(PERSONA, `我的 partner 是 ${PERSONA.relationship.partner}。`), false)
  assert.equal(violatesFidelity(PERSONA, '我的 partner 是 Alice。'), true)
})

// ---------------------------------------------------------------- 完整周期

const HAPPY_NARRATIVE = { content: '我开始把每天的对话消化成自己的节律。', change_summary: '第一版叙事' }

test('runIntegration 快乐路：四操作+取舍+清算+叙事+因+锚——写集恰如规格（逐表 sha）', async () => {
  const { store, path, log } = makeStore()
  try {
    const cid = store.createConcern('project', 'Cordis 移植', { weight: 0.6, origin: 'grown', now: T0 })
    const dormantCid = store.createConcern('interest', '旧兴趣', { weight: 0.3, origin: 'seed', now: T0 })
    setConcernStatus(path, dormantCid, 'dormant')
    const e1 = seedExperience(store, 'conversation', '和 Kevin 聊了移植的取舍', minutesAfter(T0, 1))
    const e2 = seedExperience(store, 'action_result', 'x'.repeat(100), minutesAfter(T0, 2))
    const t1 = store.createThought('把移植想清楚', 'intent', 'wake', { now: minutesAfter(T0, 3) })!
    assert.equal(store.resolveThought(t1, [t1]), true)

    const now = hoursAfter(T0, 25)
    const envelope = JSON.stringify({
      experience_actions: [
        { experience_id: e1, operation: 'absorb', concern_id: cid, note: '记进移植关切' },
        { experience_id: e2, operation: 'suspend', new_thread_kind: 'suspended_tension', note: '有个没圆的张力' },
      ],
      concern_releases: [{ concern_id: dormantCid, reason: '早已不再点亮' }],
      new_concerns: [{
        kind: 'question', title: 'Kevin 要我盯的问题', description: '他说要留意',
        weight: 0.5, owner_directed: true, source_experience_id: e1,
      }],
      narrative: HAPPY_NARRATIVE,
      thought_actions: [{ thought_id: t1, operation: 'settle' }],
    })
    const { completion, calls } = fakeCompletion(envelope)

    const before = tableDigests(path)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now,
      integrationIdFn: () => 424242,
    })
    const after = tableDigests(path)

    // 写集对拍：恰好这些表变了，其余逐字节未动。
    assert.deepEqual(changedTables(before, after), [
      'concerns', 'experiences', 'integration_state', 'narrative_threads',
      'narrative_versions', 'regulation_events', 'regulation_field', 'thoughts',
    ])

    assert.equal(calls.length, 1)
    // 消息形：两条 system（逐字 prompt + 身份守卫）+ 一条 user（JSON payload）。
    assert.deepEqual(calls[0]!.map((m) => m.role), ['system', 'system', 'user'])
    const payload = JSON.parse(calls[0]![2]!.content) as Record<string, unknown>
    assert.deepEqual(Object.keys(payload), [
      'pending_experiences', 'concerns', 'narrative_threads', 'current_narrative',
      'open_thoughts', 'thoughts_to_clear',
    ])

    assert.equal(summary.integration_id, 424242)
    assert.equal(summary.absorbs, 1)
    assert.equal(summary.suspends, 1)
    assert.equal(summary.concerns_released, 1)
    assert.equal(summary.concerns_created, 1)
    assert.equal(summary.concerns_owner_directed, 1)
    assert.equal(summary.thoughts_settled, 1)
    assert.equal(summary.narrative_rewritten, true)
    assert.equal(summary.experiences_integrated, 2)
    assert.deepEqual(summary.rejected, [])

    const db = rawOpen(path)
    try {
      // 经验翻牌：integrated=1 + integration_id。
      const flags = db.prepare('SELECT id, integrated, integration_id FROM experiences WHERE id IN (?,?) ORDER BY id')
        .all(e1, e2) as { integrated: number; integration_id: number }[]
      assert.deepEqual(flags.map((r) => [r.integrated, r.integration_id]), [[1, 424242], [1, 424242]])
      // absorb → light_concern（lit_count+1 兼审计锚）。
      const lit = db.prepare('SELECT lit_count FROM concerns WHERE id = ?').get(cid) as { lit_count: number }
      assert.equal(lit.lit_count, 1)
      // 取舍：dormant 释放成立；新关切 origin=owner_directed。
      const rel = db.prepare('SELECT status, release_reason FROM concerns WHERE id = ?').get(dormantCid) as { status: string; release_reason: string }
      assert.deepEqual([rel.status, rel.release_reason], ['released', '早已不再点亮'])
      const nc = db.prepare("SELECT origin FROM concerns WHERE title = 'Kevin 要我盯的问题'").get() as { origin: string }
      assert.equal(nc.origin, 'owner_directed')
      // suspend：新线落 suspended。
      const th = db.prepare('SELECT kind, status, content FROM narrative_threads ORDER BY id DESC LIMIT 1').get() as { kind: string; status: string; content: string }
      assert.deepEqual([th.kind, th.status, th.content], ['suspended_tension', 'suspended', '有个没圆的张力'])
      // 清算：t1 absorbed 且携 integration_id（红线 #3 物理面）。
      const tt = db.prepare('SELECT status, resolved_by_integration_id FROM thoughts WHERE id = ?').get(t1) as { status: string; resolved_by_integration_id: number }
      assert.deepEqual([tt.status, tt.resolved_by_integration_id], ['absorbed', 424242])
      // 叙事：class=absorption。
      const nv = db.prepare('SELECT trigger, narrative_class, content FROM narrative_versions ORDER BY id DESC LIMIT 1').get() as { trigger: string; narrative_class: string; content: string }
      assert.deepEqual([nv.trigger, nv.narrative_class, nv.content], ['integration', 'absorption', HAPPY_NARRATIVE.content])
      // G-4 锚前进 + 计数清零。
      const st = db.prepare('SELECT last_integration_at, wakes_since FROM integration_state WHERE id = 1').get() as { last_integration_at: string; wakes_since: number }
      assert.deepEqual([st.last_integration_at, st.wakes_since], [formatPyIso(now), 0])
    } finally {
      db.close()
    }

    // 因：integration_completed + integration_digested（absorbs>0），只此两条。
    assert.deepEqual(store.recentRegulationEvents(null, 10).map((r) => r.cause).sort(),
      ['integration_completed', 'integration_digested'])

    // SA-107/108 遥测：shape 按构造 proposed == accepted + rejected；virtual_ts=认知 now。
    const emitted = log.of('integration_completed_summary')
    assert.equal(emitted.length, 1)
    const shape = emitted[0]!.shape as Record<string, { proposed: number; accepted: number; rejected: number }>
    assert.deepEqual(shape.experience_actions, { proposed: 2, accepted: 2, rejected: 0 })
    assert.equal(emitted[0]!.accepted_ops, 2)
    assert.equal(emitted[0]!.virtual_ts, formatPyIso(now))
    assert.equal('rejected' in emitted[0]!, true)

    // 消化后 pending 归零 → 下一拍 no_pending。
    assert.deepEqual(shouldIntegrate(store, now), { should: false, reason: 'no_pending' })
  } finally {
    store.close()
  }
})

test('拒绝面红测：not_in_window / absorb 缺 concern / reinterpret 无目标 / release 非 dormant 物理闸', async () => {
  const { store, path, log } = makeStore()
  try {
    const activeCid = store.createConcern('project', '还活着的关切', { weight: 0.5, origin: 'grown', now: T0 })
    const e1 = seedExperience(store, 'conversation', '一条原料', T0)
    const envelope = JSON.stringify({
      experience_actions: [
        { experience_id: 9999, operation: 'absorb', concern_id: activeCid, note: 'x' },
        { experience_id: e1, operation: 'absorb', note: '缺 concern_id' },
      ],
      concern_releases: [{ concern_id: activeCid, reason: '想放掉' }],
      new_concerns: [],
      narrative: null,
      thought_actions: [{ thought_id: 424, operation: 'settle' }],
    })
    const { completion } = fakeCompletion(envelope)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    assert.equal(summary.absorbs, 0)
    assert.equal(summary.concerns_released, 0)
    assert.deepEqual(summary.rejected.map((r) => r.reason), [
      'not_in_window', 'absorb_missing_concern_id',
      // release 物理闸的拒绝带 ReleaseCandidacyError 文案（str(exc) 位）：
      summary.rejected[2]!.reason, 'settle_failed',
    ])
    assert.match(String(summary.rejected[2]!.reason), /not 'dormant'; only dormant/)
    // 拒绝点 telemetry 在 store 发（不依赖上层 catch）——W3 TODO#1 注入接法的意义。
    assert.equal(log.of('release_rejected_non_dormant').length, 1)
    // 状态不变：active 关切还 active。
    const db = rawOpen(path)
    try {
      const row = db.prepare('SELECT status FROM concerns WHERE id = ?').get(activeCid) as { status: string }
      assert.equal(row.status, 'active')
    } finally {
      db.close()
    }
    // 零 accepted → 不发 integration_completed；经验未整合（absorb 被拒不标记）。
    assert.deepEqual(store.recentRegulationEvents(null, 10), [])
    assert.equal(store.countIntakePending(), 1)
  } finally {
    store.close()
  }
})

test('SA-96 owner_directed 降级两路：source 非对话 / 窗口无对话——降级为 emergent 不丢关切', async () => {
  const { store, log } = makeStore()
  try {
    const eEnv = seedExperience(store, 'environment', '感知而非对话', T0)
    const envelope = JSON.stringify({
      experience_actions: [],
      concern_releases: [],
      new_concerns: [
        { kind: 'question', title: '假挂靠', description: '', weight: 0.5, owner_directed: true, source_experience_id: eEnv },
        { kind: 'question', title: '无挂靠', description: '', weight: 0.5, owner_directed: true },
      ],
      narrative: null,
      thought_actions: [],
    })
    const { completion } = fakeCompletion(envelope)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    assert.equal(summary.concerns_created, 2)
    assert.equal(summary.concerns_owner_directed, 0)
    const reasons = log.of('integration_owner_directed_downgraded').map((f) => f.reason)
    assert.deepEqual(reasons, ['source_not_conversation', 'no_conversation_in_window'])
    assert.deepEqual(store.listConcerns('active').map((c) => c.origin), ['emergent', 'emergent'])
  } finally {
    store.close()
  }
})

test('SA-104/105/106 叙事双门+有界重试：首拒→重试一次成功；两拒→narrative_conflict+旧叙事站着', async () => {
  const { store, path, log } = makeStore()
  try {
    // 旧叙事（trusted seed：acceptedOps=null 旁路计数闸——owner 写入缝）。
    const seeded = store.addNarrativeVersion({
      content: '我在照看 Kevin 的项目并整理自己的节律。', changeSummary: 'seed',
      trigger: 'integration', now: T0,
    })
    assert.ok(seeded !== null)
    const cid = store.createConcern('project', '项目', { weight: 0.5, origin: 'grown', now: T0 })
    const e1 = seedExperience(store, 'conversation', '聊了项目', minutesAfter(T0, 1))

    const opsEnvelope = (narrative: unknown) => JSON.stringify({
      experience_actions: [{ experience_id: e1, operation: 'absorb', concern_id: cid, note: 'n' }],
      concern_releases: [], new_concerns: [], narrative, thought_actions: [],
    })
    const badNarrative = { content: '全新篇章开始', change_summary: '断裂' }
    const goodRetry = JSON.stringify({
      narrative: { content: '我继续照看 Kevin 的项目，并把节律交给心脏。', change_summary: '延续' },
    })

    // ① 首拒 → 重试成功：narrative_retried + 事件 + 新版本落库。
    {
      const { completion, calls } = fakeCompletion(opsEnvelope(badNarrative), goodRetry)
      const summary = await runIntegration({
        store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
      })
      assert.equal(calls.length, 2)
      // 重试轮：assistant 原文 + user 反馈（骨架含旧叙事全文与两条硬规则）。
      const retryMsgs = calls[1]!
      assert.equal(retryMsgs.at(-2)!.role, 'assistant')
      assert.match(retryMsgs.at(-1)!.content, /当前叙事全文:\n我在照看 Kevin 的项目并整理自己的节律。/)
      assert.equal(summary.narrative_rewritten, true)
      assert.equal(summary.narrative_retried, true)
      assert.equal(log.of('integration_narrative_retry_accepted').length, 1)
    }

    // ② 两拒 → 终拒：narrative_conflict 因 + rejected 记录 + 认知当前叙事不变。
    const e2 = seedExperience(store, 'conversation', '再聊一次', minutesAfter(T0, 2))
    {
      const currentBefore = store.currentCognitiveNarrative()!.content
      const envelope2 = JSON.stringify({
        experience_actions: [{ experience_id: e2, operation: 'absorb', concern_id: cid, note: 'n' }],
        concern_releases: [], new_concerns: [],
        narrative: badNarrative, thought_actions: [],
      })
      const { completion } = fakeCompletion(envelope2, JSON.stringify({ narrative: badNarrative }))
      const summary = await runIntegration({
        store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 50),
      })
      assert.equal(summary.narrative_rewritten, false)
      assert.deepEqual(summary.rejected, [{ section: 'narrative', reason: 'continuity_or_fidelity' }])
      assert.equal(log.of('integration_narrative_rejected').length, 1)
      assert.ok(store.recentRegulationEvents(null, 20).some((r) => r.cause === 'narrative_conflict'))
      assert.equal(store.currentCognitiveNarrative()!.content, currentBefore)
    }
    void path
  } finally {
    store.close()
  }
})

test('SA-99 物理闸：strict-empty 整合的叙事 INSERT 被跳过（行不进表）；absorb-lie 拒绝——纯计数不读文本', async () => {
  const { store, path, log } = makeStore()
  try {
    seedExperience(store, 'conversation', '有原料但她全没动', T0)
    const envelope = JSON.stringify({
      experience_actions: [], concern_releases: [], new_concerns: [],
      narrative: { content: '凭空写一版', change_summary: '空整合的虚构' },
      thought_actions: [],
    })
    const { completion } = fakeCompletion(envelope)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    // 门（连续性）过了——首版免检；但 store 以 accepted_ops<=0 拒 INSERT。
    assert.equal(summary.narrative_rewritten, false)
    assert.equal(log.of('narrative_write_skipped_strict_empty').length, 1)
    const db = rawOpen(path)
    try {
      assert.equal((db.prepare('SELECT COUNT(*) AS n FROM narrative_versions').get() as { n: number }).n, 0)
      // SA-101：零操作周期不前进锚——scheduled 下一拍仍开。
      const st = db.prepare('SELECT last_integration_at FROM integration_state WHERE id = 1').get() as { last_integration_at: string | null }
      assert.equal(st.last_integration_at, null)
    } finally {
      db.close()
    }
    // 零操作也不发 integration_completed（红线 #1）。
    assert.deepEqual(store.recentRegulationEvents(null, 10), [])
    // 遥测：narrative {proposed: true, rewritten: false}。
    const shape = log.of('integration_completed_summary')[0]!.shape as Record<string, unknown>
    assert.deepEqual(shape.narrative, { proposed: true, rewritten: false })

    // absorb-lie（store 直测：class 说吸收、exp_ops=0 的计数矛盾）→ 拒。
    assert.equal(store.addNarrativeVersion({
      content: 'x', changeSummary: 'y', trigger: 'integration', now: T0,
      narrativeClass: 'absorption', acceptedOps: 3, expOps: 0,
    }), null)
    assert.equal(log.of('narrative_write_rejected_absorb_lie').length, 1)
  } finally {
    store.close()
  }
})

test('SA-100：integration_digested 只由 absorb 触发——纯 reinterpret 的周期不泄压', async () => {
  const { store, log } = makeStore()
  try {
    const cid = store.createConcern('project', '项目', { weight: 0.5, origin: 'grown', now: T0 })
    const e1 = seedExperience(store, 'conversation', '聊了项目', T0)
    const envelope = JSON.stringify({
      experience_actions: [{ experience_id: e1, operation: 'reinterpret', concern_id: cid, note: '换个角度看' }],
      concern_releases: [], new_concerns: [], narrative: null, thought_actions: [],
    })
    const { completion } = fakeCompletion(envelope)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    assert.equal(summary.reinterprets, 1)
    assert.deepEqual(store.recentRegulationEvents(null, 10).map((r) => r.cause), ['integration_completed'])
  } finally {
    store.close()
  }
})

test('experience_backlog：消化后 intake 口径仍 > 3K=90 才承压（空转周期也查）', async () => {
  const { store, log } = makeStore()
  try {
    assert.equal(BACKLOG_PRESSURE_THRESHOLD, 3 * INTEGRATION_CAPACITY_K)
    for (let i = 0; i < 95; i += 1) {
      seedExperience(store, 'conversation', `原料 ${i}`, minutesAfter(T0, i))
    }
    const envelope = JSON.stringify({
      experience_actions: [], concern_releases: [], new_concerns: [],
      narrative: null, thought_actions: [],
    })
    const { completion } = fakeCompletion(envelope)
    await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    assert.deepEqual(store.recentRegulationEvents(null, 10).map((r) => r.cause), ['experience_backlog'])
  } finally {
    store.close()
  }
})

test('SA-107 kill switch：遥测关掉 → legacy 发射（无 shape/virtual_ts/rejected），认知不受影响', async () => {
  const { store, log } = makeStore()
  try {
    seedExperience(store, 'conversation', '原料', T0)
    integrationTelemetry.emit = false
    try {
      const envelope = JSON.stringify({
        experience_actions: [], concern_releases: [], new_concerns: [],
        narrative: null, thought_actions: [],
      })
      const { completion } = fakeCompletion(envelope)
      await runIntegration({
        store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
      })
    } finally {
      integrationTelemetry.emit = true
    }
    const emitted = log.of('integration_completed_summary')
    assert.equal(emitted.length, 1)
    assert.equal('shape' in emitted[0]!, false)
    assert.equal('virtual_ts' in emitted[0]!, false)
    assert.equal('rejected' in emitted[0]!, false)
    assert.equal('absorbs' in emitted[0]!, true)
  } finally {
    store.close()
  }
})

test('revise/悬置解除：suspended 线被 revise → suspension_resolved 因（P5-06 接线）', async () => {
  const { store, log } = makeStore()
  try {
    const tid = store.createThread('suspended_tension', '一条悬着的张力', { now: T0 })
    store.updateThread(tid, { status: 'suspended', now: T0 })
    const e1 = seedExperience(store, 'conversation', '聊开了', minutesAfter(T0, 1))
    const envelope = JSON.stringify({
      experience_actions: [{ experience_id: e1, operation: 'revise', thread_id: tid, note: '我以前以为 X, 现在认为 Y' }],
      concern_releases: [], new_concerns: [], narrative: null, thought_actions: [],
    })
    const { completion } = fakeCompletion(envelope)
    const summary = await runIntegration({
      store, persona: PERSONA, completion, logEvent: log.logEvent, now: hoursAfter(T0, 25),
    })
    assert.equal(summary.revises, 1)
    assert.ok(store.recentRegulationEvents(null, 10).some((r) => r.cause === 'suspension_resolved'))
    assert.equal(store.listThreads('resolved').length, 1)
  } finally {
    store.close()
  }
})
