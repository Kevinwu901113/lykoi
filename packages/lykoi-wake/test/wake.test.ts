import test from 'node:test'
import assert from 'node:assert/strict'
import { wakeOnce, AUTONOMOUS_COGNITION, ORIGIN_AUTONOMOUS_WAKE } from '../src/index.ts'
import {
  T0, contemplateReply, fakeDispatch, fakeHeart, fakeLlm, makeStore, makeWakeDeps, rawOpen,
} from './fixture.ts'

test('idle：心脏无积压拍（claim=0）→ 零副作用', async () => {
  const { store, path } = makeStore()
  const { logicalDigest } = await import('./fixture.ts')
  const digest0 = logicalDigest(path)
  const { deps, llm } = makeWakeDeps({ store, reply: '{}', beats: [0] })
  const out = await wakeOnce(deps)
  assert.deepEqual(out, { status: 'idle', beats: 0 })
  assert.equal(llm.calls.length, 0)
  assert.equal(logicalDigest(path), digest0)
})

test('yielded：仲裁让位给对话——beats 已合并取走，无任何账面', async () => {
  const { store, path } = makeStore()
  const { deps, llm } = makeWakeDeps({
    store, reply: '{}', beats: [3],
    overrides: { shouldYieldToChat: () => true },
  })
  const out = await wakeOnce(deps)
  assert.deepEqual(out, { status: 'yielded', beats: 3 })
  assert.equal(llm.calls.length, 0)
  const db = rawOpen(path)
  try {
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM autonomy_runs').get() as { n: number }).n, 0)
  } finally {
    db.close()
  }
})

test('hourly_cap 早退：零 LLM、autonomy_rest 事件、档案时钟照写（SA-169 仲裁位）', async () => {
  const { store } = makeStore()
  // 预算已满：过去一小时 action_count 合计 20（HOURLY_ACTION_CAP）。
  store.startAutonomyRun('prior', { startedAt: new Date(T0.getTime() - 10 * 60_000) })
  store.finishAutonomyRun('prior', {
    status: 'completed', finishedAt: new Date(T0.getTime() - 9 * 60_000), actionCount: 20,
  })
  const { deps, llm, log } = makeWakeDeps({ store, reply: '{}' })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'rested')
  assert.equal(out.reason, 'hourly_cap')
  assert.equal(llm.calls.length, 0)
  assert.deepEqual(log.names(), ['autonomy_rest'])
  const state = store.autonomyState()!
  assert.ok(state.nextWakeAt, '档案时钟行已写（心脏对外读数）')
})

test('端到端一拍（fake LLM，contemplate+接地+inner）：六阶段可观测面全对齐', async () => {
  const { store, path } = makeStore()
  const cid = store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: new Date(T0.getTime() - 3_600_000) })
  const { deps, llm, dispatch, log } = makeWakeDeps({
    store, reply: contemplateReply(cid, '词源学'), beats: [2],
  })
  const out = await wakeOnce(deps)

  // 返回面：claim 合并（错过 2 拍一次醒）+ 决策可观测。
  assert.equal(out.status, 'completed')
  assert.equal(out.beats, 2)
  assert.equal(out.run_id, 'run-wake-test')
  assert.equal(out.decision, 'contemplate')
  assert.equal(out.demoted, false)

  // 阶段 4b：一次 AUTONOMOUS_COGNITION 调用，SA-172 归因 + runId 贯穿。D-3b：
  // 这一条调用带 json_object 强制模式。
  assert.equal(llm.calls.length, 1)
  assert.deepEqual(llm.calls[0]!.meta, {
    runId: 'run-wake-test', route: AUTONOMOUS_COGNITION, origin: ORIGIN_AUTONOMOUS_WAKE,
    responseFormat: { type: 'json_object' },
  })
  assert.ok(llm.calls[0]!.messages.length >= 3, 'persona 内核 + decide 契约 + user 快照')
  assert.equal(llm.calls[0]!.messages.at(-1)!.role, 'user')

  // 阶段 5：contemplate 零 dispatch；关切被点亮（接地）。
  assert.equal(dispatch.calls.length, 0)
  const concern = store.listConcerns('active').find((c) => c.id === cid)!
  assert.equal(concern.litCount, 1)

  // 两条强制经验（SA-52）：wake_action + action_result，共用 primary=cid。
  const exps = store.recentExperiences(2)
  assert.equal(exps[0]!.source, 'action_result')
  assert.equal(exps[0]!.content, 'contemplate 完成:向内的一拍,没有对外发声')
  assert.equal(exps[1]!.source, 'wake_action')
  assert.equal(exps[1]!.relatedConcernId, cid)

  // 阶段 6：inner 落地（在 execute 之后）——新念头已建。
  const thoughts = store.openThoughts()
  assert.equal(thoughts.length, 1)
  assert.equal(thoughts[0]!.content, '把这条线索想清楚一点')
  assert.equal(thoughts[0]!.source, 'wake')

  // 阶段 7：run 行收账 + decision JSON + 计数三列 + wakes_since 双计数器。
  const db = rawOpen(path)
  try {
    const run = db.prepare('SELECT * FROM autonomy_runs WHERE id = ?').get('run-wake-test') as
      Record<string, unknown>
    assert.equal(run.status, 'completed')
    assert.equal(run.action_count, 0)
    const decision = JSON.parse(String(run.decision)) as Record<string, unknown>
    assert.equal(decision.kind, 'contemplate')
    assert.deepEqual(decision.grounded_concern_ids, [cid])
    const wakes = db.prepare('SELECT wakes_since FROM integration_state WHERE id = 1').get() as
      { wakes_since: number }
    assert.equal(wakes.wakes_since, 1)
    const l4 = db.prepare(
      "SELECT value FROM learning_layer_state WHERE key = 'l4_focus_wakes_since'",
    ).get() as { value: number }
    assert.equal(l4.value, 1)
    // 档案时钟（G-2 后语义）：next_wake_at = 心脏对外读数；last_wake_at = 本拍醒来时刻。
    const state = store.autonomyState()!
    assert.equal(state.nextWakeAt, '2026-08-24T10:30:00+00:00')
    assert.equal(state.lastWakeAt, '2026-08-24T10:00:00+00:00')
  } finally {
    db.close()
  }

  // 事件序列（logEvent→audit 的注入位，W2 TODO#4）：inner 汇总 + 拍收尾。
  assert.deepEqual(log.names(), ['wake_inner_applied', 'autonomy_wake'])
  assert.deepEqual(log.events.at(-1)![1], {
    run_id: 'run-wake-test', decision: 'contemplate', demoted: false, actions: 0, status: 'completed',
  })
})

test('SA-31/SA-169：applyInner 在 executeAndReflow **之后**——dispatch 时刻看不到本拍 inner 念头', async () => {
  const { store } = makeStore()
  const cid = store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: T0 })
  const reply = JSON.stringify({
    meaning_assessment: [
      { item: `关切#${cid} 词源学`, meaning: '想看看', concern_id: cid, pull: 0.5 },
    ],
    decision: {
      kind: 'explore', url: 'https://example.org/x',
      reason: `关切#${cid} 词源学 让我想出门看看`,
    },
    inner: { thoughts: [{ content: '回来记得整理', kind: 'intent' }], resolve: [] },
  })
  let thoughtsAtDispatch = -1
  const dispatch = fakeDispatch({ success: true, data: { text: '正文' } })
  const probing: typeof dispatch = Object.assign(
    (async (actionType: string, params: Record<string, unknown>, runId: string) => {
      thoughtsAtDispatch = store.openThoughts().length
      return dispatch(actionType, params, runId)
    }) as typeof dispatch,
    { calls: dispatch.calls },
  )
  const { deps } = makeWakeDeps({
    store, reply, overrides: { dispatchFn: probing },
  })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'completed')
  assert.equal(thoughtsAtDispatch, 0, '执行时 inner 尚未落地（畸形 inner 不可能影响决策）')
  assert.equal(store.openThoughts().length, 1, '拍尾 inner 已落地')
})

test('SA-170：一拍失败被完整接住——failed run + {"error"} + bump + autonomy_wake_failed', async () => {
  const { store, path } = makeStore()
  const { deps, llm, log } = makeWakeDeps({ store, reply: '这不是 JSON' })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'failed')
  assert.equal(out.run_id, 'run-wake-test')
  assert.ok(out.error)
  const db = rawOpen(path)
  try {
    const run = db.prepare('SELECT status, decision FROM autonomy_runs WHERE id = ?')
      .get('run-wake-test') as { status: string; decision: string }
    assert.equal(run.status, 'failed')
    const parsed = JSON.parse(run.decision) as { error: string }
    assert.match(parsed.error, /autonomous model did not return a decision JSON/)
    const wakes = db.prepare('SELECT wakes_since FROM integration_state WHERE id = 1').get() as
      { wakes_since: number }
    assert.equal(wakes.wakes_since, 1, '失败拍也 bump_wakes_since（SA-170）')
  } finally {
    db.close()
  }
  // WO-FIX-LOOP-01 D-3a：两次回包都非 JSON（fakeLlm 同一份 reply 打两次）——
  // 有界重试打满（恰一次），仍败 → 现行失败路径原样接住，只是账前面多一条
  // autonomy_wake_retried。
  assert.equal(llm.calls.length, 2)
  assert.deepEqual(log.names(), ['autonomy_wake_retried', 'autonomy_wake_failed'])
})

test('D-3a：首包非 JSON、次包合法 → 有界重试一次后 completed，账上留痕', async () => {
  const { store } = makeStore()
  const cid = store.createConcern(
    'interest', '词源学', { weight: 0.5, origin: 'seed', now: new Date(T0.getTime() - 3_600_000) },
  )
  let calls = 0
  const reply = () => {
    calls += 1
    return calls === 1 ? '这不是 JSON' : contemplateReply(cid, '词源学')
  }
  const llm = fakeLlm(reply)
  const { deps, log } = makeWakeDeps({ store, reply: '{}', overrides: { llm } })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'completed')
  assert.equal(out.decision, 'contemplate')
  // 恰两次调用（同 runId/route/origin），且都带 json_object 强制模式。
  assert.equal(llm.calls.length, 2)
  for (const call of llm.calls) {
    assert.deepEqual(call.meta, {
      runId: 'run-wake-test', route: AUTONOMOUS_COGNITION, origin: ORIGIN_AUTONOMOUS_WAKE,
      responseFormat: { type: 'json_object' },
    })
  }
  // autonomy_wake_retried 先于本拍收尾账；reason=not_json，run_id 贯穿。
  const retried = log.events.find(([name]) => name === 'autonomy_wake_retried')
  assert.ok(retried, '重试事件必须存在')
  assert.equal(retried![1].run_id, 'run-wake-test')
  assert.equal(retried![1].reason, 'not_json')
  assert.equal(typeof retried![1].content_len, 'number')
})

test('D-3a：两包都非 JSON → 不循环，最多重试一次，仍归入既有失败路径', async () => {
  const { store } = makeStore()
  const llm = fakeLlm('这不是 JSON')
  const { deps, log } = makeWakeDeps({ store, reply: '{}', overrides: { llm } })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'failed')
  assert.equal(llm.calls.length, 2, '有界重试至多一次——不是循环到成功为止')
  assert.deepEqual(log.names(), ['autonomy_wake_retried', 'autonomy_wake_failed'])
})

test('SA-171 接口位：整合/专注只在 completed 后串行驱动；异常被吞成遥测', async () => {
  const { store } = makeStore()
  const order: string[] = []
  const { deps, log } = makeWakeDeps({
    store, reply: JSON.stringify({ decision: { kind: 'rest', reason: '歇一拍' } }),
    overrides: {
      integrate: async () => {
        order.push('integrate')
        throw new Error('整合还没长出来')
      },
      focus: async () => {
        order.push('focus')
      },
    },
  })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'completed')
  assert.deepEqual(order, ['integrate', 'focus'], '层 2 独立于层 1 的成败')
  assert.deepEqual(log.names(), ['wake_inner_applied', 'autonomy_wake', 'autonomy_integrate_failed'])
})

test('SA-171：失败拍不驱动整合/专注', async () => {
  const { store } = makeStore()
  const order: string[] = []
  const { deps } = makeWakeDeps({
    store, reply: '坏回复',
    overrides: {
      integrate: async () => {
        order.push('integrate')
      },
    },
  })
  await wakeOnce(deps)
  assert.deepEqual(order, [])
})

test('rest 拍端到端：安静合法、demote 不发生、计数为零', async () => {
  const { store } = makeStore()
  const heart = fakeHeart([1], new Date(T0.getTime() + 30 * 60_000).toISOString())
  const { deps } = makeWakeDeps({
    store,
    reply: JSON.stringify({ decision: { kind: 'rest', reason: '就想歇着' } }),
    overrides: { heart },
  })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'completed')
  assert.equal(out.decision, 'rest')
  assert.equal(out.demoted, false) // safe kind 永不降级（无接地也合法）
})
