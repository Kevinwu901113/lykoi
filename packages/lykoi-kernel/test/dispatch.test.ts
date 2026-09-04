/**
 * dispatch 主链（SK-01..12）：KNOWN_ACTIONS 双钉、_resolve 四重拒绝、
 * DispatchContext、DelegationRef 前置拒绝、redaction 门、_policy_decision 四值、
 * pre/post 不可变审计门 + degraded 状态机。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  _resolve, auditDegraded, createDispatch, DelegationRef, isUnwiredHandler,
  kernelActionCatalog, KNOWN_ACTION_LIST, KNOWN_ACTIONS, unwiredResources,
  wiredActionCatalog, _setSecretsForTest, _setPolicyCoreForTest,
  type ResourceRegistry,
} from '../src/index.ts'
import { captureTelemetry, fakeSink, ioError, isolateKernelState } from './fixture.ts'

/** 全 allow 的假资源（interactive 默认 ask，所以测试多用 autonomous 白名单动作）。 */
function echoResources(data: Record<string, unknown> = { ok: true }): ResourceRegistry {
  const registry: Record<string, Record<string, (p: Record<string, unknown>) => Promise<unknown>>> = {}
  for (const actionType of KNOWN_ACTION_LIST) {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    registry[prefix] ??= {}
    registry[prefix]![method] = async () => ({ ...data })
  }
  return registry
}

test('SK-01：KNOWN_ACTIONS 18 项 frozenset 等价，逐字全表（运行时 Set + 字面量联合双钉）', () => {
  assert.equal(KNOWN_ACTIONS.size, 18)
  assert.deepEqual([...KNOWN_ACTIONS], [
    'browser.navigate', 'browser.get_text', 'browser.click', 'browser.type',
    'browser.screenshot', 'terminal.exec', 'research_browser.open',
    'research_browser.read_text', 'research_browser.extract_links',
    'research_browser.screenshot', 'autonomy.queue_notification',
    'autonomy.initiate_chat', 'notify.owner', 'messenger.send', 'messenger.read',
    'delegation.dispatch', 'delegation.status', 'delegation.collect',
  ])
})

test('SK-02：_resolve 四重拒绝全 raise', () => {
  const resources = unwiredResources()
  assert.throws(() => _resolve('malformed', resources), /malformed action\.type/)
  assert.throws(() => _resolve('.method', resources), /malformed action\.type/)
  assert.throws(() => _resolve('browser.', resources), /malformed action\.type/)
  assert.throws(() => _resolve('browser.pay', resources), /unknown action "browser\.pay"/)
  // 只被 import 进资源模块的辅助函数成不了动作类型：不在 KNOWN_ACTIONS 就到不了 getattr。
  assert.throws(() => _resolve('messenger.raw_transport_send', resources), /unknown action/)
  // 表内动作但注册表缺前缀 / handler 不可调用。
  assert.throws(() => _resolve('terminal.exec', {}), /unknown action prefix "terminal"/)
  assert.throws(
    () => _resolve('terminal.exec', { terminal: {} as Record<string, never> }),
    /unknown action "terminal\.exec"/,
  )
})

test('SK-03：context 强制 —— 缺 context/origin 抛，动作不可能默取出处', async () => {
  isolateKernelState()
  const dispatch = createDispatch({ sink: fakeSink() })
  await assert.rejects(
    dispatch({ type: 'messenger.read', params: {} }, { context: undefined as never }),
    TypeError,
  )
})

test('SK-04：delegated 缺 DelegationRef = 拒绝 + 落账，位于策略判定之前；伪造的 ref 平对象不算', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const events = captureTelemetry()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  const observation = await dispatch(
    { type: 'messenger.read', params: {} },
    {
      context: {
        origin: 'delegated',
        // 平对象伪造不出 DelegationRef（instanceof 判定）。
        delegation: { contractId: 'dc_x', agentUserId: 'a', isolationDomain: 'd', depth: 1 } as unknown as DelegationRef,
      },
    },
  )
  assert.equal(observation.success, false)
  assert.equal(observation.error, 'delegation_required')
  assert.equal(observation.data.delegation_required, true)
  // 落的是 delegation_context_invalid，不是 action_dispatch —— 身份不完整的调用
  // 不消耗策略判定、intent 行里没有半截委托身份。
  assert.deepEqual(sink.records.map((r) => r.type), ['delegation_context_invalid'])
  assert.equal(sink.records[0]!.reason, 'delegation_required')
  assert.ok(events.some((e) => e.name === 'delegation_context_invalid'))
})

test('SK-04 正面：真 DelegationRef 过前置闸（GK-7 地板在其后把动作 deny —— 账上看得见）', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  const ref = new DelegationRef({ contractId: 'dc_1', agentUserId: 'agent_1', isolationDomain: 'os_user:lykoi-agent-1', depth: 1 })
  const observation = await dispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'delegated', delegation: ref } },
  )
  // GK-7：delegated 空集地板 → deny（不是 ask）；但这次拒绝有完整 intent/result 账。
  assert.equal(observation.error, 'denied by rule')
  assert.deepEqual(sink.records.map((r) => r.type), ['action_dispatch', 'action_result'])
  const intent = sink.records[0]!
  assert.equal(intent.decision, 'deny')
  // SK-12 反面：有 ref 才有 delegation 栏，五字段全带 + dsess_ 派生。
  assert.deepEqual(intent.delegation, {
    contract_id: 'dc_1',
    session_id: 'dsess_dc_1',
    agent_user_id: 'agent_1',
    isolation_domain: 'os_user:lykoi-agent-1',
    depth: 1,
  })
})

test('SK-05：先 assert_no_secrets（抛 + 零审计）再 redact_obj（审计带 redacted 副本，raw 只用于 scope key）', async () => {
  isolateKernelState()
  _setSecretsForTest(['hunter2secret'])
  try {
    const sink = fakeSink()
    const dispatch = createDispatch({ sink, resources: echoResources() })
    // params 里带密钥值 → 拒绝动作，密钥不落任何盘。
    await assert.rejects(
      dispatch(
        { type: 'messenger.read', params: { token: 'hunter2secret' } },
        { context: { origin: 'autonomous' } },
      ),
      /secret value present in params/,
    )
    assert.equal(sink.records.length, 0)
    // 无密钥路径：审计行 params 是 redacted 副本（内容含密钥子串时被遮）。
    _setSecretsForTest(['topsecretvalue'])
    const observation = await dispatch(
      { type: 'messenger.read', params: { note: 'safe' } },
      { context: { origin: 'autonomous' } },
    )
    assert.equal(observation.success, true)
    const intent = sink.records.find((r) => r.type === 'action_dispatch')!
    assert.deepEqual(intent.params, { note: 'safe' })
  } finally {
    _setSecretsForTest(null)
  }
})

test('SK-10：成功数据先 redact 再交回认知；资源边界异常 = 正常失败观察（error 也 redact）', async () => {
  isolateKernelState()
  _setSecretsForTest(['topsecretvalue'])
  try {
    const sink = fakeSink()
    const leaky = echoResources({ echo: 'value is topsecretvalue here' })
    const dispatch = createDispatch({ sink, resources: leaky })
    const observation = await dispatch(
      { type: 'messenger.read', params: {} },
      { context: { origin: 'autonomous' } },
    )
    assert.equal(observation.data.echo, 'value is [REDACTED] here')
    // handler 抛 → Observation(success=false)，error 过 redact，不冒泡。
    const throwing: ResourceRegistry = {
      messenger: {
        read: async () => {
          throw new Error('boom with topsecretvalue inside')
        },
      },
    }
    const dispatch2 = createDispatch({ sink: fakeSink(), resources: throwing })
    const failed = await dispatch2(
      { type: 'messenger.read', params: {} },
      { context: { origin: 'autonomous' } },
    )
    assert.equal(failed.success, false)
    assert.equal(failed.error, 'boom with [REDACTED] inside')
  } finally {
    _setSecretsForTest(null)
  }
})

// --- WO-FIX-ORGANOK-01：内核听器官的 ok（返回值 ok:false 即失败观察） -------

/** 单动作注册表：只接 messenger.read，返回值由调用方给（器官不抛只返回的形态）。 */
function returningResources(value: unknown): ResourceRegistry {
  return { messenger: { read: async () => value } } as unknown as ResourceRegistry
}

async function readOnce(resources: ResourceRegistry) {
  const dispatch = createDispatch({ sink: fakeSink(), resources })
  return dispatch({ type: 'messenger.read', params: {} }, { context: { origin: 'autonomous' } })
}

test('ORGANOK-01：handler 返回 ok:false → success:false，data 整体保留（detail 仍交给认知），error 取 data.error', async () => {
  isolateKernelState()
  const observation = await readOnce(
    returningResources({ ok: false, error: 'timeout', detail: '宿主 45s 未回' }),
  )
  assert.equal(observation.success, false)
  assert.equal(observation.error, 'timeout')
  // data 一个键都不少 —— 器官不抛而返回，正是为了这份细节能到她手里（红线 #5）。
  assert.deepEqual(observation.data, { ok: false, error: 'timeout', detail: '宿主 45s 未回' })
})

test('ORGANOK-01：ok:false 但 error 不是字符串（缺失/非串）→ error 恒 organ_failed，不编分类', async () => {
  isolateKernelState()
  const missing = await readOnce(returningResources({ ok: false, detail: '没说是哪一种' }))
  assert.equal(missing.success, false)
  assert.equal(missing.error, 'organ_failed')
  assert.deepEqual(missing.data, { ok: false, detail: '没说是哪一种' })
  const nonString = await readOnce(returningResources({ ok: false, error: 42 }))
  assert.equal(nonString.success, false)
  assert.equal(nonString.error, 'organ_failed')
})

test('ORGANOK-01：失败观察的 error 与 data 同过 redact（两处错误串不许一处遮一处不遮）', async () => {
  isolateKernelState()
  _setSecretsForTest(['topsecretvalue'])
  try {
    const observation = await readOnce(
      returningResources({ ok: false, error: 'blocked_url topsecretvalue' }),
    )
    assert.equal(observation.error, 'blocked_url [REDACTED]')
    assert.equal(observation.data.error, 'blocked_url [REDACTED]')
  } finally {
    _setSecretsForTest(null)
  }
})

test('ORGANOK-01：其余三路逐字节不变 —— ok:true / 无 ok 字段 / 非对象返回值全是成功观察', async () => {
  isolateKernelState()
  const okTrue = await readOnce(returningResources({ ok: true, text: '正文' }))
  assert.equal(okTrue.success, true)
  assert.equal(okTrue.error, null)
  assert.deepEqual(okTrue.data, { ok: true, text: '正文' })
  // 不带 ok 的 handler（notify.owner 的节流返回就是这一形态）照旧算成功。
  const noOk = await readOnce(returningResources({ queued: false, throttled: true, reason: 'cooldown' }))
  assert.equal(noOk.success, true)
  assert.equal(noOk.error, null)
  assert.deepEqual(noOk.data, { queued: false, throttled: true, reason: 'cooldown' })
  // 数组/标量不是 plain object：新规则够不着，成功路径原样。
  const arrayish = await readOnce(returningResources([{ ok: false }]))
  assert.equal(arrayish.success, true)
  assert.equal(arrayish.error, null)
})

test('ORGANOK-01：抛错路径不变 —— 仍是 data:{} 的失败观察，不被新规则改道', async () => {
  isolateKernelState()
  const throwing: ResourceRegistry = {
    messenger: {
      read: async () => {
        throw new Error('boom')
      },
    },
  } as unknown as ResourceRegistry
  const observation = await readOnce(throwing)
  assert.equal(observation.success, false)
  assert.equal(observation.error, 'boom')
  assert.deepEqual(observation.data, {})
})

test('ORGANOK-01：审计 action_result.success 随之如实记 false（D-5 影响面）', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({
    sink,
    resources: returningResources({ ok: false, error: 'timeout' }),
  })
  await dispatch({ type: 'messenger.read', params: {} }, { context: { origin: 'autonomous' } })
  const results = sink.records.filter((r) => r.type === 'action_result')
  assert.equal(results.length, 1)
  assert.equal(results[0]!.success, false)
})

test('SK-06/10：四路判定入账 —— deny / ask（needs_approval 载荷）/ allow / pre_approved', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  // ask（interactive 默认）：handler 不跑、载荷带 safe params + id 对。
  const asked = await dispatch(
    { type: 'browser.navigate', params: { url: 'https://x.com' } },
    { context: { origin: 'interactive' }, actionId: 'a1', correlationId: 'c1' },
  )
  assert.equal(asked.error, 'needs_approval')
  assert.deepEqual(asked.data, {
    needs_approval: true,
    action: { type: 'browser.navigate', params: { url: 'https://x.com' } },
    action_id: 'a1',
    correlation_id: 'c1',
  })
  // pre_approved：同 correlation 链重派，handler 真跑。
  const approved = await dispatch(
    { type: 'browser.navigate', params: { url: 'https://x.com' } },
    { context: { origin: 'interactive' }, preApproved: true, actionId: 'a1', correlationId: 'c1' },
  )
  assert.equal(approved.success, true)
  // 硬门照拦（硬 deny 胜过批准的 dispatch 面）。
  _setPolicyCoreForTest({ hardDecision: () => 'deny', capabilityProfile: () => null })
  const denied = await dispatch(
    { type: 'browser.navigate', params: {} },
    { context: { origin: 'interactive' }, preApproved: true },
  )
  assert.equal(denied.error, 'denied by rule')
  assert.deepEqual(denied.data, { denied: true })
  _setPolicyCoreForTest(undefined)
  const decisions = sink.records.filter((r) => r.type === 'action_dispatch').map((r) => r.decision)
  assert.deepEqual(decisions, ['ask', 'pre_approved', 'deny'])
  // 三次派发 = 三对 intent/result 行；correlation 链前两次同串。
  const results = sink.records.filter((r) => r.type === 'action_result')
  assert.equal(results.length, 3)
  assert.equal(results[0]!.correlation_id, 'c1')
  assert.equal(results[1]!.correlation_id, 'c1')
})

test('SK-07/08：pre-dispatch 审计门 fail CLOSED + degraded 状态机 + 恢复', async () => {
  isolateKernelState()
  const events = captureTelemetry()
  const sink = fakeSink()
  let handlerRan = 0
  const resources: ResourceRegistry = {
    messenger: { read: async () => (handlerRan += 1, { ok: true }) },
  }
  const dispatch = createDispatch({ sink, resources })
  // sink 写失败（预期内 OSError 对应）→ 无 handler、audit_unavailable、degraded。
  sink.failWith = ioError()
  const refused = await dispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(refused.error, 'audit_unavailable')
  assert.equal(refused.data.audit_unavailable, true)
  assert.equal(handlerRan, 0) // a side effect is never taken without a durable record of intent
  assert.equal(auditDegraded(), true)
  assert.ok(events.some((e) => e.name === 'audit_degraded' && e.fields.reason === 'pre_dispatch_audit_failed'))
  // sink 恢复 → 下一次 pre 写成功即 clear。
  sink.failWith = null
  const recovered = await dispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(recovered.success, true)
  assert.equal(handlerRan, 1)
  assert.equal(auditDegraded(), false)
  assert.ok(events.some((e) => e.name === 'audit_recovered'))
})

test('SK-07/08：sink 缺席（null）= 门恒关；post 失败 best-effort → audit_degraded 标记', async () => {
  isolateKernelState()
  // sink=null：每次都 fail closed。
  const noSink = createDispatch({ sink: null, resources: echoResources() })
  const refused = await noSink(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(refused.error, 'audit_unavailable')
  assert.equal(auditDegraded(), true)
  isolateKernelState()
  // post 半面：intent 成功、result 失败 → handler 已跑，观察带 audit_degraded 旗。
  const sink = fakeSink()
  let calls = 0
  const flaky = {
    records: sink.records,
    async record(event: { type: string; [key: string]: unknown }) {
      calls += 1
      if (calls === 2) throw ioError('post write failed')
      sink.records.push({ ...event })
    },
  }
  const dispatch = createDispatch({ sink: flaky, resources: echoResources() })
  const observation = await dispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(observation.success, true) // 结果无法 un-run
  assert.equal(observation.data.audit_degraded, true)
  assert.equal(auditDegraded(), true)
  // 下一次 pre 门照常尝试写：成功即恢复。
  const next = await dispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(next.success, true)
  assert.equal(auditDegraded(), false)
})

test('SK-09：编程错误不伪装成审计不可用 —— 无 errno code 的异常照常传播', async () => {
  isolateKernelState()
  const sink = fakeSink()
  sink.failWith = new TypeError('a programming error, not an OSError')
  const dispatch = createDispatch({ sink, resources: echoResources() })
  await assert.rejects(
    dispatch({ type: 'messenger.read', params: {} }, { context: { origin: 'autonomous' } }),
    TypeError,
  )
  assert.equal(auditDegraded(), false) // 不进 degraded：这是 bug，不是 sink 故障
})

test('SK-11/12：action_result 不带 data/params 正文；无委托的行没有 delegation 键（逐字节不变）', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources({ secret_payload: 'x' }) })
  await dispatch(
    { type: 'messenger.read', params: { context_id: 'c1' } },
    { context: { origin: 'autonomous', runId: 'run-1' } },
  )
  const result = sink.records.find((r) => r.type === 'action_result')!
  assert.ok(!('data' in result))
  assert.ok(!('params' in result))
  assert.equal(result.success, true)
  assert.equal(result.error, null)
  assert.equal(result.run_id, 'run-1')
  // 既有四 origin 的审计行没有 delegation 键（空 dict 展开 = 键不存在）。
  for (const record of sink.records) assert.ok(!('delegation' in record))
})

test('WO-OUTCOME-01 D-2d：snake_case run_id/turn_id 透传到 action_dispatch 与 action_result', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  const observation = await dispatch(
    { type: 'messenger.read', params: {} },
    {
      context: { origin: 'autonomous', run_id: 'run-snake', turn_id: 'turn-1' },
      actionId: 'action-1',
      correlationId: 'correlation-1',
    },
  )
  assert.equal(observation.success, true)

  const actionRows = sink.records.filter(
    (record) => record.type === 'action_dispatch' || record.type === 'action_result',
  )
  assert.equal(actionRows.length, 2)
  for (const record of actionRows) {
    assert.equal(record.run_id, 'run-snake')
    assert.equal(record.turn_id, 'turn-1')
    assert.equal(record.action_id, 'action-1')
    assert.equal(record.correlation_id, 'correlation-1')
  }
})

test('WO-OUTCOME-01 D-2d：拒绝与资源失败路径也保留 snake_case ID，且不影响判定', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  const denied = await dispatch(
    { type: 'browser.navigate', params: { url: 'https://example.com' } },
    {
      context: { origin: 'interactive', run_id: 'run-denied', turn_id: 'turn-denied' },
      actionId: 'action-denied',
      correlationId: 'correlation-denied',
    },
  )
  assert.equal(denied.error, 'needs_approval')

  const failureSink = fakeSink()
  const failureDispatch = createDispatch({
    sink: failureSink,
    resources: {
      messenger: {
        read: async () => {
          throw new Error('resource failed')
        },
      },
    },
  })
  const failed = await failureDispatch(
    { type: 'messenger.read', params: {} },
    {
      context: { origin: 'autonomous', run_id: 'run-failed', turn_id: 'turn-failed' },
      actionId: 'action-failed',
      correlationId: 'correlation-failed',
    },
  )
  assert.equal(failed.success, false)
  assert.equal(failed.error, 'resource failed')

  for (const [records, expected] of [
    [sink.records, { run_id: 'run-denied', turn_id: 'turn-denied', action_id: 'action-denied', correlation_id: 'correlation-denied' }],
    [failureSink.records, { run_id: 'run-failed', turn_id: 'turn-failed', action_id: 'action-failed', correlation_id: 'correlation-failed' }],
  ] as const) {
    const actionRows = records.filter(
      (record) => record.type === 'action_dispatch' || record.type === 'action_result',
    )
    assert.equal(actionRows.length, 2)
    for (const record of actionRows) {
      assert.equal(record.run_id, expected.run_id)
      assert.equal(record.turn_id, expected.turn_id)
      assert.equal(record.action_id, expected.action_id)
      assert.equal(record.correlation_id, expected.correlation_id)
    }
  }
  assert.equal(sink.records.find((record) => record.type === 'action_dispatch')!.decision, 'ask')
  assert.equal(failureSink.records.find((record) => record.type === 'action_result')!.success, false)
})

test('WO-OUTCOME-01 D-2d：缺失委托上下文的拒绝审计也透传 snake_case ID', async () => {
  isolateKernelState()
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  const refused = await dispatch(
    { type: 'messenger.read', params: {} },
    {
      context: { origin: 'delegated', run_id: 'run-refused', turn_id: 'turn-refused' },
      actionId: 'action-refused',
      correlationId: 'correlation-refused',
    },
  )
  assert.equal(refused.error, 'delegation_required')
  assert.deepEqual(sink.records.map((record) => record.type), ['delegation_context_invalid'])
  assert.deepEqual(sink.records[0], {
    type: 'delegation_context_invalid',
    ts: sink.records[0]!.ts,
    action_type: 'messenger.read',
    action_id: 'action-refused',
    correlation_id: 'correlation-refused',
    origin: 'delegated',
    run_id: 'run-refused',
    turn_id: 'turn-refused',
    reason: 'delegation_required',
  })
})

test('WO-OUTCOME-01 D-2d：旧 runId 兼容；未提供新字段时审计形状不新增 turn_id', async () => {
  isolateKernelState()
  const legacySink = fakeSink()
  const legacyDispatch = createDispatch({ sink: legacySink, resources: echoResources() })
  await legacyDispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous', runId: 'run-legacy' } },
  )
  const legacyRows = legacySink.records.filter(
    (record) => record.type === 'action_dispatch' || record.type === 'action_result',
  )
  assert.equal(legacyRows.length, 2)
  for (const record of legacyRows) {
    assert.equal(record.run_id, 'run-legacy')
    assert.ok(!('turn_id' in record))
  }

  const emptySink = fakeSink()
  const emptyDispatch = createDispatch({ sink: emptySink, resources: echoResources() })
  await emptyDispatch(
    { type: 'messenger.read', params: {} },
    { context: { origin: 'autonomous' } },
  )
  const emptyRows = emptySink.records.filter(
    (record) => record.type === 'action_dispatch' || record.type === 'action_result',
  )
  assert.equal(emptyRows.length, 2)
  for (const record of emptyRows) {
    assert.equal(record.run_id, null)
    assert.ok(!('turn_id' in record))
  }
})

test('豁免栏（SK-05 附）：E 章免问不免账 —— audit 行 exemption 栏多一栏；非标记恒 null', async () => {
  isolateKernelState()
  const { approvalMachinery } = await import('../src/index.ts')
  const sink = fakeSink()
  const dispatch = createDispatch({ sink, resources: echoResources() })
  await dispatch(
    { type: 'messenger.send', params: { context_id: 'c7', text: 'hi' } },
    { context: { origin: 'interactive', exemption: approvalMachinery() } },
  )
  const intent = sink.records.find((r) => r.type === 'action_dispatch')!
  assert.equal(intent.decision, 'allow') // E1 把默认 ask 翻成 allow（check ⑨）
  assert.equal(intent.exemption, 'E1') // 账上多一栏，不是少一栏
  sink.records.length = 0
  await dispatch(
    { type: 'messenger.send', params: { context_id: 'c7', text: 'hi' } },
    { context: { origin: 'interactive', exemption: 'E1' } }, // 伪造：字符串不是章
  )
  const forged = sink.records.find((r) => r.type === 'action_dispatch')!
  assert.equal(forged.decision, 'ask')
  assert.equal(forged.exemption, null)
})

test('kernelActionCatalog：动作轴 = KNOWN_ACTIONS；isHardGated = 不可变核判定（fail closed 同向）', () => {
  isolateKernelState()
  assert.deepEqual([...kernelActionCatalog.knownActions], [...KNOWN_ACTION_LIST])
  assert.ok(kernelActionCatalog.isHardGated('terminal.exec'))
  assert.ok(kernelActionCatalog.isHardGated('delegation.dispatch'))
  assert.ok(!kernelActionCatalog.isHardGated('messenger.send'))
  _setPolicyCoreForTest(null)
  assert.ok(kernelActionCatalog.isHardGated('messenger.send')) // core 缺失 → 全表硬门（往少了说）
  _setPolicyCoreForTest(undefined)
})

// --- WO-FIX-LOOP-01 D-1a：替身标记 + wiredActionCatalog ------------------------

test('D-1a：unwiredResources() 的每个 handler 都被 isUnwiredHandler 识别为替身', () => {
  const resources = unwiredResources()
  for (const actionType of KNOWN_ACTION_LIST) {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    const handler = resources[prefix]![method]!
    assert.ok(isUnwiredHandler(handler), `${actionType} 应被判定为替身`)
  }
})

test('D-1a：echoResources()（全真 handler）不被 isUnwiredHandler 识别为替身', () => {
  const resources = echoResources()
  for (const actionType of KNOWN_ACTION_LIST) {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    const handler = resources[prefix]![method]!
    assert.ok(!isUnwiredHandler(handler), `${actionType} 不该被判定为替身`)
  }
})

test('D-1a：wiredActionCatalog(unwiredResources()) 为空（全替身 → 零接得通）', () => {
  isolateKernelState()
  const catalog = wiredActionCatalog(unwiredResources())
  assert.deepEqual([...catalog.knownActions], [])
})

test('D-1a：混入真 handler 后只列真的，顺序随 KNOWN_ACTION_LIST', () => {
  isolateKernelState()
  const resources = unwiredResources() as Record<string, Record<string, ResourceHandlerLike>>
  // 只给 5 个真身（同活体现状：messenger.send/read、notify.owner、autonomy 2 个）。
  resources.messenger!.send = async () => ({ ok: true })
  resources.messenger!.read = async () => ({ ok: true })
  resources.notify!.owner = async () => ({ ok: true })
  resources.autonomy!.queue_notification = async () => ({ ok: true })
  resources.autonomy!.initiate_chat = async () => ({ ok: true })
  const catalog = wiredActionCatalog(resources)
  assert.deepEqual([...catalog.knownActions], [
    'autonomy.queue_notification', 'autonomy.initiate_chat',
    'notify.owner', 'messenger.send', 'messenger.read',
  ])
})

test('D-1a：wiredActionCatalog 混入真 handler 的 isHardGated 与 kernelActionCatalog 逐项相等', () => {
  isolateKernelState()
  const resources = unwiredResources() as Record<string, Record<string, ResourceHandlerLike>>
  resources.messenger!.send = async () => ({ ok: true })
  const catalog = wiredActionCatalog(resources)
  for (const actionType of KNOWN_ACTION_LIST) {
    assert.equal(catalog.isHardGated(actionType), kernelActionCatalog.isHardGated(actionType))
  }
})

type ResourceHandlerLike = (params: Record<string, unknown>) => Promise<unknown>
