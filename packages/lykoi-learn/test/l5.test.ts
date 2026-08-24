/**
 * L5 · 建议队列入队侧（SA-141..147/152）+ store 状态机（_V14）。
 * 铁律的动态面在这里；静态钉死在 boundary.test.ts。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  KIND_CONCERN_RELEASE, KIND_PERMISSION_RULE, KIND_STANDING_GRANT, PERMISSION_MARKERS,
  SUGGESTION_TEXT_CHARS, dedupKey, isPermissionBoundary, stagedInstructions,
  suggestConcernRelease, suggestPermissionRule,
} from '../src/l5.ts'
import type { SuggestStore } from '../src/l5.ts'
import {
  T0, changedTables, eventLog, hoursAfter, makeStore, tableDigests,
} from './fixture.ts'

test('SA-142：dedup_key 由代码派生 f"{kind}:{ref}"；库层 UNIQUE 保证同一件事只排一次', () => {
  assert.equal(dedupKey('concern_release', 8), 'concern_release:8')
  assert.equal(dedupKey('permission_rule', 123), 'permission_rule:123')

  const { store, log } = makeStore()
  try {
    const concern = { id: 8, title: '负载内务', origin: 'grown', lit_count: 1381 }
    const first = suggestConcernRelease(store, log.logEvent, {
      concern, cycleId: 0, cooldownCount: 3, now: T0,
    })
    assert.deepEqual([first.enqueued, first.reason], [true, 'new'])
    // 同一件事再排 → already_queued（UNIQUE 的可读面）；行数仍 1。
    const second = suggestConcernRelease(store, log.logEvent, {
      concern, cycleId: 0, cooldownCount: 4, now: hoursAfter(T0, 1),
    })
    assert.deepEqual([second.enqueued, second.reason, second.id], [false, 'already_queued', first.id])
    assert.equal(store.listRuleSuggestions(null).length, 1)
  } finally {
    store.close()
  }
})

test('SA-143：三 kind 与 _V14 CHECK 同源；standing_grant 今日无写者但库位留好；未知 kind 库层拒', () => {
  const { store } = makeStore()
  try {
    assert.deepEqual([KIND_CONCERN_RELEASE, KIND_PERMISSION_RULE, KIND_STANDING_GRANT],
      ['concern_release', 'permission_rule', 'standing_grant'])
    // standing_grant 经 store 可入（枚举位子在），但 l5 模块没有它的写者。
    const ok = store.enqueueRuleSuggestion({
      kind: KIND_STANDING_GRANT, dedupKey: 'standing_grant:probe', suggestionText: 'x', now: T0,
    })
    assert.equal(ok.enqueued, true)
    assert.throws(() => store.enqueueRuleSuggestion({
      kind: 'made_up', dedupKey: 'k', suggestionText: 'x', now: T0,
    }), /unknown rule suggestion kind/)
  } finally {
    store.close()
  }
})

test('SA-144：21 项词表逐条命中（往宽了判）；大小写不敏感；空文本 false', () => {
  assert.equal(PERMISSION_MARKERS.length, 21)
  for (const marker of PERMISSION_MARKERS) {
    assert.equal(isPermissionBoundary(`结论里提到了${marker}这件事`), true, `marker: ${marker}`)
  }
  assert.equal(isPermissionBoundary('提到 APPROVAL 也算（大小写折叠）'), true)
  assert.equal(isPermissionBoundary('今天聊了摄影与穿搭'), false)
  assert.equal(isPermissionBoundary(''), false)
  assert.equal(isPermissionBoundary(null), false)
  assert.equal(isPermissionBoundary(undefined), false)
})

test('入队文本有界：suggestion_text 与 rationale 各裁 400 字符（码点）', () => {
  const { store, log } = makeStore()
  try {
    const result = suggestPermissionRule(store, log.logEvent, {
      insightId: 5, conclusion: '权限'.repeat(500), cycleId: 0, now: T0,
    })
    const row = store.getRuleSuggestion(result.id)!
    assert.equal([...(row.suggestion_text as string)].length, SUGGESTION_TEXT_CHARS)
  } finally {
    store.close()
  }
})

test('SA-147：血缘失败不回滚入队——建议仍在队里等 Kevin，失败落 telemetry', () => {
  const { store, log } = makeStore()
  try {
    const broken: SuggestStore = {
      enqueueRuleSuggestion: (opts) => store.enqueueRuleSuggestion(opts),
      recordLineage: () => {
        throw new Error('lineage table on fire')
      },
    }
    const result = suggestPermissionRule(broken, log.logEvent, {
      insightId: 9, conclusion: '这类事不用再问我了吧（权限）', concernId: 2, cycleId: 4, now: T0,
    })
    assert.equal(result.enqueued, true)
    assert.equal(store.getRuleSuggestion(result.id)!.status, 'pending')
    const evt = log.of('rule_suggestion_lineage_failed')
    assert.equal(evt.length, 1)
    assert.match(String(evt[0]!.error), /lineage table on fire/)
  } finally {
    store.close()
  }
})

test('血缘正路：product=rule_suggestion，源=insight(+concern)；cycle_id=0（尚无周期）时不记血缘', () => {
  const { store, path, log } = makeStore()
  try {
    // 造一个真周期号（product_lineage.cycle_id 有 FK）。
    const cycleId = store.openFocusCycle({ now: T0 })
    const result = suggestPermissionRule(store, log.logEvent, {
      insightId: 77, conclusion: '涉及授权的结论', concernId: 3, cycleId, now: T0,
    })
    const rows = store.lineageForProduct('rule_suggestion', result.id)
    assert.deepEqual(rows.map((r) => [r.source_kind, r.source_id]),
      [['insight', '77'], ['concern', '3']])
    // cycle_id=0（Python `cycle_id or None` → 还没有过周期）不记血缘、不炸。
    const r0 = suggestConcernRelease(store, log.logEvent, {
      concern: { id: 12, title: 't', origin: 'grown', lit_count: 0 }, cycleId: 0, cooldownCount: 3, now: T0,
    })
    assert.equal(r0.enqueued, true)
    assert.deepEqual(store.lineageForProduct('rule_suggestion', r0.id), [])
  } finally {
    store.close()
  }
})

test('状态机（_V14）：pending→asked 原子认领；asked→declined 带冷却；冷却内拒排、期满再武装保留 ask_count 与 answer', () => {
  const { store, log } = makeStore()
  try {
    const concern = { id: 6, title: '旧关切', origin: 'grown', lit_count: 2 }
    const first = suggestConcernRelease(store, log.logEvent, {
      concern, cycleId: 0, cooldownCount: 3, now: T0,
    })
    // 认领（原子 WHERE status='pending'）；重复认领输竞态。
    assert.equal(store.markRuleSuggestionAsked(first.id, {
      questionMessageId: 'msg-1', questionText: '要放掉吗?', cycleId: 2, now: T0,
    }), true)
    assert.equal(store.markRuleSuggestionAsked(first.id, {
      questionMessageId: 'msg-2', questionText: 'x', cycleId: 2, now: T0,
    }), false)
    // 非法迁移：pending→accepted 之类被数据化的边挡住。
    assert.equal(store.resolveRuleSuggestion(first.id, 'applied_by_owner', { now: T0 }), false)
    // declined + 冷却到周期 32。
    assert.equal(store.resolveRuleSuggestion(first.id, 'declined', {
      answerText: '先留着吧', cooldownUntilCycle: 32, now: T0,
    }), true)
    // 冷却内再排 → cooldown（被拒绝的建议不许换个说法再问，§3.8 最要紧的克制）。
    const during = suggestConcernRelease(store, log.logEvent, {
      concern, cycleId: 10, cooldownCount: 4, now: hoursAfter(T0, 1),
    })
    assert.deepEqual([during.enqueued, during.reason], [false, 'cooldown'])
    // 冷却期满 → 再武装回 pending：文本刷新，ask_count 与上次 answer_text 保留。
    const cycleId = store.openFocusCycle({ now: hoursAfter(T0, 2) })
    void cycleId
    const rearmed = suggestConcernRelease(store, log.logEvent, {
      concern, cycleId: 33, cooldownCount: 5, now: hoursAfter(T0, 2),
    })
    assert.deepEqual([rearmed.enqueued, rearmed.reason], [true, 'rearmed'])
    const row = store.getRuleSuggestion(first.id)!
    assert.deepEqual(
      [row.status, row.ask_count, row.answer_text, row.asked_at_cycle, row.cooldown_until_cycle],
      ['pending', 1, '先留着吧', null, null])
    assert.match(row.suggestion_text as string, /已经强制冷却 5 次/)
  } finally {
    store.close()
  }
})

test('already_decided：accepted / applied_by_owner 后再排是骚扰；FIFO 出队口；overdue 按周期序号', () => {
  const { store, log } = makeStore()
  try {
    const a = suggestConcernRelease(store, log.logEvent, {
      concern: { id: 1, title: 'a', origin: 'grown', lit_count: 0 }, cycleId: 0, cooldownCount: 3, now: T0,
    })
    const b = suggestPermissionRule(store, log.logEvent, {
      insightId: 2, conclusion: '关于权限的结论', cycleId: 0, now: hoursAfter(T0, 1),
    })
    // FIFO：先来先问。
    assert.equal(store.nextPendingRuleSuggestion()!.id, a.id)
    store.markRuleSuggestionAsked(a.id, { questionMessageId: 'm', questionText: 'q', cycleId: 3, now: T0 })
    // 至多一条未决问询的取数面。
    assert.deepEqual(store.outstandingAskedRuleSuggestions().map((r) => r.id), [a.id])
    // overdue：asked_at_cycle=3，TTL=7 → 周期 10 起算超期（3 <= 10-7）。
    assert.deepEqual(store.overdueAskedRuleSuggestions(9, 7), [])
    assert.deepEqual(store.overdueAskedRuleSuggestions(10, 7).map((r) => r.id), [a.id])
    // accepted → 终态；再排 already_decided。
    assert.equal(store.resolveRuleSuggestion(a.id, 'accepted', { answerText: '可以', now: T0 }), true)
    const again = suggestConcernRelease(store, log.logEvent, {
      concern: { id: 1, title: 'a', origin: 'grown', lit_count: 0 }, cycleId: 20, cooldownCount: 9, now: T0,
    })
    assert.deepEqual([again.enqueued, again.reason], [false, 'already_decided'])
    // applied_by_owner 只从 accepted 来（owner console 的终态；她自己没有路径打到它）。
    assert.equal(store.resolveRuleSuggestion(a.id, 'applied_by_owner', { now: T0 }), true)
    void b
  } finally {
    store.close()
  }
})

test('SA-152：staged_instructions 渲染=给 root 会话看的执行说明；纯文本零副作用；howto 分 kind', () => {
  const { store, path, log } = makeStore()
  try {
    const result = suggestPermissionRule(store, log.logEvent, {
      insightId: 42, conclusion: '这类事可以自动批准吧', concernId: 7, cycleId: 0, now: T0,
    })
    const row = store.getRuleSuggestion(result.id)!
    const before = tableDigests(path)
    const text = stagedInstructions(row, { answerText: '可以, 你排一下' })
    // 渲染零副作用（逐表 sha 全等）。
    assert.deepEqual(changedTables(before, tableDigests(path)), [])
    assert.match(text, new RegExp(`^\\[规则建议 #${result.id} · 你已经同意 · 等你在 root 会话落笔\\]`))
    assert.match(text, /建议: 这类事可以自动批准吧/)
    assert.match(text, /来源: insight 42 \(insight #42 · concern #7 · 触及权限边界, 按 §3.8 只能问 Kevin\)/)
    assert.match(text, new RegExp(`product_id='${result.id}'`))
    assert.match(text, /你的原话: 可以, 你排一下/)
    assert.match(text, /由你在 root 会话里改 guardian 侧的审批规则/)
    // 模板要害末行逐字。
    assert.match(text, /在你落笔之前, 系统里什么都没有变 —— 她没有、也不会有写审批规则的路径。$/)
    // concern_release 的 howto 分支。
    const rel = suggestConcernRelease(store, log.logEvent, {
      concern: { id: 3, title: 't', origin: 'grown', lit_count: 0 }, cycleId: 0, cooldownCount: 3, now: T0,
    })
    const relText = stagedInstructions(store.getRuleSuggestion(rel.id)!)
    assert.match(relText, /释放一条关切走 owner 后门/)
    // 代入值里的花括号不做第二轮展开（str.format 单遍口径）。
    const fake = { id: 1, suggestion_text: '文本带 {howto} 字样', source_kind: '', source_id: '', rationale: '', kind: 'permission_rule' }
    assert.match(stagedInstructions(fake), /建议: 文本带 \{howto\} 字样/)
  } finally {
    store.close()
  }
})

test('队列空转零副作用：没有建议可排的周期，rule_suggestions 与全库逐字节未动', () => {
  const { store, path } = makeStore()
  try {
    const before = tableDigests(path)
    // 入队侧没有任何后台任务/定时器——不调用就什么都不发生；这里断言只读面也零写。
    assert.equal(store.nextPendingRuleSuggestion(), null)
    assert.deepEqual(store.outstandingAskedRuleSuggestions(), [])
    assert.deepEqual(store.listRuleSuggestions(null), [])
    assert.deepEqual(changedTables(before, tableDigests(path)), [])
  } finally {
    store.close()
  }
})
