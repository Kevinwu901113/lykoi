/**
 * 审批对话机红测（SK-30..35 / S-61..S-63）。
 *
 *  ① requestApproval 四道闸 + 先发后排：每个非 asked 态 = 动作不执行、此路无执行
 *    出口（SK-30 / S-61）；enqueue 失败必撤回且**无队列条目**（S-62）。
 *  ② `_send` 漏斗 = 唯一的嘴 = E1 盖章处；任何拒绝永不是新问句，needs_approval
 *    回来只落 approval_message_undelivered 然后终止（SK-31 / S-63 没有递归）。
 *  ③ _executeOnce：consume 原子点、pre_approved=true、原 origin、action_id=grant
 *    id、correlation 透传（SK-32）。
 *  ④ 执行回执四分支 + RESULT_MAX_CHARS 截断显式告知 + _replyRef 免预算 + 投递
 *    失败吞并 log（SK-33）。
 *  ⑤ handleOwnerAnswer 路由：dead question 最前拦（GK-5 单一文案）→ 队列空
 *    ignored → 解释器 → clarify 单链 / granted+execute / denied+DENY_CONFIRM
 *    （SK-34）+ 审计事件全集（SK-35）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUDIT_ANSWER_ROUTED, AUDIT_EXECUTION, AUDIT_QUESTION, createApprovalConversation,
  DENY_CONFIRM, EXPIRED_REPLY, RESULT_MAX_CHARS, RETRACT_TEMPLATE, questionText,
} from '../src/approval-conversation.ts'
import {
  AUDIT_EVENT, resetClarifyRounds, setApprovalAuditSink, setApprovalInterpretLlm,
} from '../src/approval-interpreter.ts'
import {
  consumePending, enqueuePending, findPending, pendingActions, pendingState,
  recordDenial, resolvePending,
} from '../src/approval.ts'
import type { Action, DispatchContext, Observation } from '../src/dispatch.ts'
import { Exemption } from '../src/exemption.ts'
import { captureTelemetry, fakeSink, isolateKernelState, T0 } from './fixture.ts'

interface Call {
  action: Action
  context: DispatchContext
  preApproved: boolean
  actionId: string | null
  correlationId: string | null
}

/**
 * fake dispatch。默认：messenger.send 成功并回递增 message_id；其它动作成功回
 * stdout。`sendResult` / `execResult` 覆盖可造出四道闸与四分支的每一格。
 */
function fakeDispatch(overrides: {
  sendResult?: (n: number) => Observation
  execResult?: Observation
  execThrows?: Error
} = {}) {
  const calls: Call[] = []
  let sent = 0
  const dispatch = async (action: Action, opts: {
    context: DispatchContext
    preApproved?: boolean
    actionId?: string | null
    correlationId?: string | null
  }): Promise<Observation> => {
    calls.push({
      action,
      context: opts.context,
      preApproved: opts.preApproved ?? false,
      actionId: opts.actionId ?? null,
      correlationId: opts.correlationId ?? null,
    })
    if (action.type === 'messenger.send') {
      sent += 1
      return overrides.sendResult
        ? overrides.sendResult(sent)
        : { success: true, data: { sent: true, message_id: `msg-${sent}` }, error: null }
    }
    if (overrides.execThrows) throw overrides.execThrows
    return overrides.execResult ?? { success: true, data: { stdout: 'ok' }, error: null }
  }
  return { calls, dispatch, sends: () => calls.filter((c) => c.action.type === 'messenger.send') }
}

function setup() {
  isolateKernelState()
  resetClarifyRounds(null)
  const sink = fakeSink()
  setApprovalAuditSink(sink)
  setApprovalInterpretLlm(null)
  return sink
}

const CTX = 'chat-kevin'

function stageAudit(sink: ReturnType<typeof fakeSink>, stage: string): Record<string, unknown> | undefined {
  return sink.records.find((r) => r.type === AUDIT_QUESTION && r.stage === stage)
}

// --- ① 四道闸 + 先发后排 ------------------------------------------------------

test('SK-30 闸①去重：一模一样的问题已经悬着 → already_pending，不再发第二条问句', async () => {
  const sink = setup()
  const events = captureTelemetry()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const params = { text: 'hi', context_id: 'chat-zhang' }

  const first = await ac.requestApproval('messenger.send', params, { contextId: CTX })
  assert.equal(first.status, 'asked')
  assert.equal(sends().length, 1)

  const again = await ac.requestApproval('messenger.send', params, { contextId: CTX })
  assert.equal(again.status, 'already_pending')
  assert.equal(again.pending_id, first.pending_id)
  assert.equal(again.question_message_id, first.question_message_id)
  assert.equal(sends().length, 1) // 第二条问句没有发出去
  assert.ok(events.some((e) => e.name === 'approval_question_deduped'))
  assert.equal(pendingActions().length, 1)
  assert.equal(sink.records.filter((r) => r.type === AUDIT_QUESTION && r.stage === 'asked').length, 1)
})

test('SK-30 闸②静默期：24h 内拒过同 scope → quiet_period（suppressed 入账，动作不跑）', async () => {
  const sink = setup()
  const events = captureTelemetry()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  recordDenial('messenger.send', 'channel:telegram:chat-zhang', { answer: '不用', now: T0 })

  const out = await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  assert.equal(out.status, 'quiet_period')
  assert.equal(out.pending_id, null)
  assert.equal(sends().length, 0) // 不再追着问
  assert.equal(pendingActions().length, 0) // 动作不排队 = 不执行
  const suppressed = stageAudit(sink, 'suppressed')!
  assert.equal(suppressed.outcome, 'quiet_period')
  assert.equal(suppressed.delivered, false)
  assert.ok(events.some((e) => e.name === 'approval_question_suppressed'))
})

test('SK-30 闸③先发失败 → send_failed + undelivered/deny_by_default，**不排队**', async () => {
  const sink = setup()
  const { dispatch } = fakeDispatch({
    sendResult: () => ({ success: false, data: {}, error: 'transport down' }),
  })
  const ac = createApprovalConversation({ dispatch })
  const out = await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  assert.equal(out.status, 'send_failed')
  assert.equal(out.pending_id, null)
  assert.equal(out.reason, 'transport down')
  assert.equal(pendingActions().length, 0) // 排了但没发出去的那条毒药：这里没有
  const undelivered = stageAudit(sink, 'undelivered')!
  assert.equal(undelivered.outcome, 'deny_by_default')
  assert.equal(undelivered.delivered, false)
})

test('SK-30/S-63 没有递归：问句的 messenger.send 回 needs_approval → undelivered 后终止（永不生第二问）', async () => {
  const sink = setup()
  const events = captureTelemetry()
  const { dispatch, sends } = fakeDispatch({
    sendResult: () => ({ success: false, data: { needs_approval: true }, error: 'needs_approval' }),
  })
  const ac = createApprovalConversation({ dispatch })
  const out = await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  assert.equal(out.status, 'send_failed')
  assert.equal(out.reason, 'needs_approval')
  assert.equal(sends().length, 1) // 恰一次尝试：一次问不可能生出第二次问
  const undelivered = events.filter((e) => e.name === 'approval_message_undelivered')
  assert.equal(undelivered.length, 1)
  assert.equal(undelivered[0]!.fields.reason, 'needs_approval')
  assert.equal(pendingActions().length, 0)
  assert.equal(stageAudit(sink, 'asked'), undefined)
})

test('SK-31：messenger 自己的策略拒绝形状（sent=false）也是 undelivered，不是新问句', async () => {
  setup()
  const events = captureTelemetry()
  const { dispatch } = fakeDispatch({
    sendResult: () => ({ success: true, data: { sent: false, reason: 'daily_cap' }, error: null }),
  })
  const ac = createApprovalConversation({ dispatch })
  const out = await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  assert.equal(out.status, 'send_failed')
  assert.equal(out.reason, 'daily_cap')
  assert.ok(events.some((e) => e.name === 'approval_message_undelivered' && e.fields.reason === 'daily_cap'))
})

test('SK-30 闸④后排失败 → 发 RETRACT 撤回 + enqueue_failed + **无队列条目**（S-62）', async () => {
  const sink = setup()
  const events = captureTelemetry()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  // 让队列写不下去：把 pending 文件指到一个不存在的目录（GK-2：无保护 → 抛）
  process.env.LYKOI_PENDING_ACTIONS = '/nonexistent-dir-lykoi-w2/pending_actions.json'
  const out = await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  assert.equal(out.status, 'enqueue_failed')
  assert.equal(out.pending_id, null)
  assert.notEqual(out.question_message_id, null) // 问句确实发出去了
  const texts = sends().map((c) => String(c.action.params.text))
  assert.equal(texts.length, 2)
  assert.equal(texts[1], RETRACT_TEMPLATE.replace('{reason}', 'Error')) // 撤回那条
  const retracted = stageAudit(sink, 'retracted')!
  assert.equal(retracted.outcome, 'deny_by_default')
  assert.equal(retracted.delivered, true)
  assert.ok(events.some((e) => e.name === 'approval_enqueue_failed'))
})

test('SK-30 asked：问句文本 = QUESTION_TEMPLATE∘describeAction；队列条目盖上 question_message_id/question_text', async () => {
  const sink = setup()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const params = { command: 'ls -la' }
  const out = await ac.requestApproval('terminal.exec', params, {
    contextId: CTX, replyTo: 'inbound-9', origin: 'interactive', actionId: 'act-1', correlationId: 'corr-1',
  })
  assert.equal(out.status, 'asked')
  assert.equal(out.scope_key, null) // terminal.exec 不可 scope
  const send = sends()[0]!
  assert.equal(send.action.params.text, questionText('terminal.exec', params))
  assert.equal(send.action.params.reply_to, 'inbound-9') // reply_to 原样带下去（打扰纪律）
  const row = findPending('act-1')!
  assert.equal(row.question_message_id, 'msg-1')
  assert.equal(row.question_text, questionText('terminal.exec', params))
  assert.equal(row.correlation_id, 'corr-1')
  assert.equal(row.origin, 'interactive')
  const asked = stageAudit(sink, 'asked')!
  assert.equal(asked.outcome, 'asked')
  assert.equal(asked.delivered, true)
  assert.equal(asked.pending_id, 'act-1')
})

test('SK-31：_send 漏斗是审批机器唯一的嘴 = E1 盖章处（origin=interactive + E1 章）', async () => {
  setup()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  await ac.requestApproval('messenger.send', { text: 'hi', context_id: 'chat-zhang' }, { contextId: CTX })
  const send = sends()[0]!
  assert.equal(send.context.origin, 'interactive')
  assert.ok(send.context.exemption instanceof Exemption)
  assert.equal((send.context.exemption as Exemption).category, 'E1')
  assert.equal(send.preApproved, false) // 问句自己不是"已批准"
})

// --- ③④ 执行 + 回执 -----------------------------------------------------------

/** 铺一条已问过的 pending，返回它的 id。 */
async function askOne(
  ac: ReturnType<typeof createApprovalConversation>,
  actionType = 'terminal.exec',
  params: Record<string, unknown> = { command: 'ls' },
): Promise<string> {
  const out = await ac.requestApproval(actionType, params, {
    contextId: CTX, replyTo: 'inbound-1', actionId: 'act-1', correlationId: 'corr-1',
  })
  assert.equal(out.status, 'asked')
  return out.pending_id!
}

test('SK-32/33：granted → consume 原子点 + pre_approved 原 origin 重派 + EXEC_OK 回执（引用他的消息=免预算）', async () => {
  const sink = setup()
  const { dispatch, calls, sends } = fakeDispatch({
    execResult: { success: true, data: { stdout: 'total 0\n' }, error: null },
  })
  const ac = createApprovalConversation({ dispatch })
  const pendingId = await askOne(ac)

  const answer = await ac.handleOwnerAnswer('执行', {
    contextId: CTX, replyTo: 'msg-1', messageId: 'inbound-2',
  })
  assert.equal(answer.outcome, 'execute_once')
  assert.equal(answer.executed, true)
  assert.equal(answer.replied, true)

  // 原子点：记录已被消费，第二次认领拿不到
  assert.equal(pendingState(findPending(pendingId)!), 'consumed')
  assert.deepEqual(consumePending(pendingId, { command: 'ls' })[0], 'consumed')

  // 重派：pre_approved=true、原 origin、action_id = grant id、correlation 透传
  const exec = calls.find((c) => c.action.type === 'terminal.exec')!
  assert.equal(exec.preApproved, true)
  assert.equal(exec.context.origin, 'interactive')
  assert.equal(exec.actionId, pendingId)
  assert.equal(exec.correlationId, 'corr-1')
  assert.equal(exec.context.exemption, undefined) // 执行不是审批机器的嘴，不盖 E1

  // 回执：做完了 + 输出，且 reply_to = 他那条消息（S1A 免主动打扰预算）
  const report = sends().at(-1)!
  assert.match(String(report.action.params.text), /^做完了: 在终端执行命令: 'ls'\n\ntotal 0$/)
  assert.equal(report.action.params.reply_to, 'inbound-2')

  // 审计事件全集
  const exe = sink.records.find((r) => r.type === AUDIT_EXECUTION)!
  assert.equal(exe.executed, true)
  assert.equal(exe.success, true)
  assert.equal(exe.correlation_id, 'corr-1')
  const routed = sink.records.find((r) => r.type === AUDIT_ANSWER_ROUTED)!
  assert.equal(routed.outcome, 'execute_once')
  assert.equal(routed.executed, true)
  assert.equal(routed.standing_grant_created, false)
  assert.ok(sink.records.some((r) => r.type === AUDIT_EVENT)) // 六元组也在
})

test('SK-33 回执四分支：EXEC_OK / NO_OUTPUT / FAIL / SKIPPED', async () => {
  // 分支②：成功但**没有任何**可展示的输出（handler 什么都没回 → data=null）
  {
    setup()
    const { dispatch, sends } = fakeDispatch({
      execResult: { success: true, data: null as unknown as Record<string, unknown>, error: null },
    })
    const ac = createApprovalConversation({ dispatch })
    await askOne(ac)
    await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
    assert.equal(sends().at(-1)!.action.params.text, "做完了: 在终端执行命令: 'ls'\n(没有输出)")
  }
  // 分支①附：_resultBody 取值序的末位是**朴素 dump**，永不空手 —— 一个空 dict
  // 走 dump 分支渲染成 "{}"（与活体 json.dumps 逐字同向），不是 NO_OUTPUT。
  {
    setup()
    const { dispatch, sends } = fakeDispatch({ execResult: { success: true, data: {}, error: null } })
    const ac = createApprovalConversation({ dispatch })
    await askOne(ac)
    await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
    assert.equal(sends().at(-1)!.action.params.text, "做完了: 在终端执行命令: 'ls'\n\n{}")
  }
  // 分支①：取值序 stdout → output → result → text → content，stderr 追加
  {
    setup()
    const { dispatch, sends } = fakeDispatch({
      execResult: { success: true, data: { stdout: 'A', content: 'B', stderr: 'C' }, error: null },
    })
    const ac = createApprovalConversation({ dispatch })
    await askOne(ac)
    await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
    assert.equal(sends().at(-1)!.action.params.text, "做完了: 在终端执行命令: 'ls'\n\nA\nB\nstderr: C")
  }
  // 分支③：跑了但出错（error + body 并排）
  {
    setup()
    const { dispatch, sends } = fakeDispatch({
      execResult: { success: false, data: { stderr: 'no such file' }, error: 'exit 2' },
    })
    const ac = createApprovalConversation({ dispatch })
    await askOne(ac)
    const out = await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
    assert.equal(out.executed, true) // 跑过了就是跑过了
    const text = String(sends().at(-1)!.action.params.text)
    assert.match(text, /^跑了, 但出错了: /)
    assert.match(text, /exit 2/)
    assert.match(text, /stderr: no such file/)
  }
  // 分支④：没能执行（consume 拒绝 —— 这里造 resolved 的死记录）
  {
    setup()
    const { dispatch, sends } = fakeDispatch()
    const ac = createApprovalConversation({ dispatch })
    const pendingId = await askOne(ac)
    // 队列条目在答复到达之前被别的路径关掉 → consume 返回 missing/consumed
    consumePending(pendingId, { command: 'ls' }, { actor: 'owner' })
    const out = await ac.handleOwnerAnswer('执行', {
      contextId: CTX, replyTo: 'inbound-x', messageId: 'in', // 不引用死问句
    })
    // 队列已空 → ignored（consume 之后 pendingActions 不再含它）
    assert.equal(out.outcome, 'ignored')
    assert.equal(sends().length, 1) // 只有当初那条问句
  }
})

test('SK-33：SKIPPED 分支 —— consume 拒绝时回执说明原因、动作未执行', async () => {
  setup()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const pendingId = await askOne(ac)
  // 造一个"活着但 params 对不上"的局面：改 params_hash 之外最简单的等价物 ——
  // 先把它 resolve 掉，再手工塞回活队列会破坏台账，所以这里直接验 executionReport
  // 的 SKIPPED 渲染（_executeOnce 的四分支之一）。
  const report = ac.executionReport(
    { action_type: 'terminal.exec', params: { command: 'ls' } },
    { executed: false, reason: 'consumed', observation: null },
  )
  assert.equal(report, '这条我没能执行(consumed) —— 要的话你再说一次。')
  assert.equal(pendingState(findPending(pendingId)!), 'live')
  assert.equal(sends().length, 1)
})

test('SK-33：RESULT_MAX_CHARS=1500 截断**显式告知**，绝不静默', async () => {
  setup()
  const { dispatch, sends } = fakeDispatch({
    execResult: { success: true, data: { stdout: 'x'.repeat(5000) }, error: null },
  })
  const ac = createApprovalConversation({ dispatch })
  await askOne(ac)
  await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
  const text = String(sends().at(-1)!.action.params.text)
  assert.match(text, /…\(输出还有, 这里只显示前 1500 字\)$/)
  assert.equal(RESULT_MAX_CHARS, 1500)
  assert.ok([...text].length < 1700) // 一兆字节的命令不会变成一兆字节的消息
})

test('SK-33：回执投递失败被吞并 log —— 已经做完的事不因为"没说出口"而回滚', async () => {
  setup()
  const events = captureTelemetry()
  let n = 0
  const { dispatch } = fakeDispatch({
    sendResult: () => {
      n += 1
      // 第一条（问句）成功，第二条（回执）失败
      return n === 1
        ? { success: true, data: { sent: true, message_id: 'msg-1' }, error: null }
        : { success: false, data: {}, error: 'transport down' }
    },
  })
  const ac = createApprovalConversation({ dispatch })
  await askOne(ac)
  const out = await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })
  assert.equal(out.executed, true) // 动作确实跑了
  assert.equal(out.replied, false) // 只是没说出口
  assert.ok(events.some((e) => e.name === 'approval_result_report_failed'))
})

// --- ⑤ handleOwnerAnswer 路由 --------------------------------------------------

test('SK-34/GK-5：dead question **最前拦** —— EXPIRED_REPLY 单一文案照抄（denied 也说"过期"）', async () => {
  const sink = setup()
  const events = captureTelemetry()
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const pendingId = await askOne(ac)
  resolvePending(pendingId, 'denied') // 已拒绝 = 死问句

  const out = await ac.handleOwnerAnswer('可以', {
    contextId: CTX, replyTo: 'msg-1', messageId: 'in-2',
  })
  assert.equal(out.outcome, 'expired')
  assert.equal(out.executed, false)
  assert.equal(out.replied, true)
  assert.equal(sends().at(-1)!.action.params.text, EXPIRED_REPLY) // GK-5：不加宽
  const routed = sink.records.find((r) => r.type === AUDIT_ANSWER_ROUTED)!
  assert.equal(routed.outcome, 'expired')
  assert.equal(routed.state, 'resolved') // 事实上是"已拒绝"，文案仍说过期（DK-09 照抄）
  assert.ok(events.some((e) => e.name === 'approval_answer_expired'))
})

test('SK-34：队列空 → ignored（调用方按普通对话处理），零发送零审计', async () => {
  const sink = setup()
  const { dispatch, calls } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const out = await ac.handleOwnerAnswer('你今天怎么样', { contextId: CTX })
  assert.deepEqual(out, { outcome: 'ignored', pending_id: null, executed: false, replied: false, scope_key: null })
  assert.equal(calls.length, 0)
  assert.equal(sink.records.length, 0)
})

test('SK-34：clarify → 追问 + setQuestionMessageId **单链**（他回新消息仍解析到同一条 pending）', async () => {
  setup()
  setApprovalInterpretLlm(async () => ({ content: '{"verdict":"unclear","confidence":0.1,"reason":"看不懂"}' }))
  const { dispatch, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const pendingId = await askOne(ac)

  const out = await ac.handleOwnerAnswer('嗯……', { contextId: CTX, replyTo: 'msg-1', messageId: 'in-2' })
  assert.equal(out.outcome, 'clarify')
  assert.equal(out.replied, true)
  const followUp = sends().at(-1)!
  assert.match(String(followUp.action.params.text), /请直接回「执行」或「不要」。$/) // 硬门文案
  assert.equal(followUp.action.params.reply_to, 'in-2')
  // 链改指到追问那条消息，且**只有一条**
  assert.equal(findPending(pendingId)!.question_message_id, 'msg-2')
  // 回追问那条 → 仍解析到同一条 pending（快通道兑现她承诺的应答词）
  const done = await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-2', messageId: 'in-3' })
  assert.equal(done.outcome, 'execute_once')
  assert.equal(done.pending_id, pendingId)
})

test('SK-34：denied → resolvePending + DENY_CONFIRM 一句短话；动作不跑', async () => {
  const sink = setup()
  const { dispatch, calls, sends } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const pendingId = await askOne(ac)
  const out = await ac.handleOwnerAnswer('不要', { contextId: CTX, replyTo: 'msg-1', messageId: 'in-2' })
  assert.equal(out.outcome, 'denied')
  assert.equal(out.executed, false)
  assert.equal(sends().at(-1)!.action.params.text, DENY_CONFIRM)
  assert.equal(calls.filter((c) => c.action.type === 'terminal.exec').length, 0) // 没跑
  assert.equal(findPending(pendingId)!.resolved, 'denied')
  const routed = sink.records.find((r) => r.type === AUDIT_ANSWER_ROUTED)!
  assert.equal(routed.outcome, 'denied')
  assert.equal(routed.executed, false)
})

test('SK-35：审计事件全集 —— approval_question 四态 / answer_routed / execution / 六元组', async () => {
  const sink = setup()
  const { dispatch } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })

  // asked
  await askOne(ac)
  // suppressed（另一个 scope）
  recordDenial('messenger.send', 'channel:telegram:chat-li', { answer: 'no', now: T0 })
  await ac.requestApproval('messenger.send', { text: 'x', context_id: 'chat-li' }, { contextId: CTX })
  // undelivered
  {
    const failing = fakeDispatch({ sendResult: () => ({ success: false, data: {}, error: 'down' }) })
    const ac2 = createApprovalConversation({ dispatch: failing.dispatch })
    await ac2.requestApproval('browser.navigate', { url: 'https://a.example.com' }, { contextId: CTX })
  }
  // answer_routed + execution + 六元组
  await ac.handleOwnerAnswer('执行', { contextId: CTX, replyTo: 'msg-1', messageId: 'in' })

  const stages = sink.records.filter((r) => r.type === AUDIT_QUESTION).map((r) => r.stage)
  assert.deepEqual([...new Set(stages)].sort(), ['asked', 'suppressed', 'undelivered'])
  assert.ok(sink.records.some((r) => r.type === AUDIT_ANSWER_ROUTED))
  assert.ok(sink.records.some((r) => r.type === AUDIT_EXECUTION))
  assert.ok(sink.records.some((r) => r.type === AUDIT_EVENT))
  // 第四态 retracted 由 S-62 那条测试单独覆盖（它需要一个写不下去的队列）
})

test('SK-30：每个非 asked 态都意味着动作不跑 —— 此路无执行出口（四态汇总）', async () => {
  setup()
  const outcomes: string[] = []
  // already_pending
  {
    const { dispatch, calls } = fakeDispatch()
    const ac = createApprovalConversation({ dispatch })
    const p = { text: 'hi', context_id: 'chat-zhang' }
    await ac.requestApproval('messenger.send', p, { contextId: CTX })
    outcomes.push((await ac.requestApproval('messenger.send', p, { contextId: CTX })).status)
    assert.equal(calls.filter((c) => c.action.type !== 'messenger.send').length, 0)
  }
  // quiet_period
  {
    setup()
    const { dispatch, calls } = fakeDispatch()
    const ac = createApprovalConversation({ dispatch })
    recordDenial('browser.navigate', 'domain:example.com', { now: T0 })
    outcomes.push((await ac.requestApproval('browser.navigate', { url: 'https://example.com/p' }, { contextId: CTX })).status)
    assert.equal(calls.length, 0)
  }
  // send_failed
  {
    setup()
    const { dispatch, calls } = fakeDispatch({ sendResult: () => ({ success: false, data: {}, error: 'down' }) })
    const ac = createApprovalConversation({ dispatch })
    outcomes.push((await ac.requestApproval('terminal.exec', { command: 'ls' }, { contextId: CTX })).status)
    assert.equal(calls.filter((c) => c.action.type === 'terminal.exec').length, 0)
    assert.equal(pendingActions().length, 0)
  }
  // enqueue_failed
  {
    setup()
    const { dispatch, calls } = fakeDispatch()
    const ac = createApprovalConversation({ dispatch })
    process.env.LYKOI_PENDING_ACTIONS = '/nonexistent-dir-lykoi-w2/pending_actions.json'
    outcomes.push((await ac.requestApproval('terminal.exec', { command: 'ls' }, { contextId: CTX })).status)
    assert.equal(calls.filter((c) => c.action.type === 'terminal.exec').length, 0)
  }
  assert.deepEqual(outcomes, ['already_pending', 'quiet_period', 'send_failed', 'enqueue_failed'])
})

test('SK-30/S-61：先发后排的顺序**可观测** —— 发送在入队之前发生', async () => {
  setup()
  const order: string[] = []
  const dispatch = async (action: Action): Promise<Observation> => {
    order.push(`send:${pendingActions().length}`) // 发送那一刻队列里有几条
    return { success: true, data: { sent: true, message_id: 'msg-1' }, error: null }
  }
  const ac = createApprovalConversation({ dispatch })
  await ac.requestApproval('terminal.exec', { command: 'ls' }, { contextId: CTX })
  assert.deepEqual(order, ['send:0']) // 发的时候队列还是空的 —— 先发后排
  assert.equal(pendingActions().length, 1)
})

test('SK-27 配合：enqueuePending 的 actionId 就是 pending id（审批端点 URL 用它）', async () => {
  setup()
  const { dispatch } = fakeDispatch()
  const ac = createApprovalConversation({ dispatch })
  const out = await ac.requestApproval('terminal.exec', { command: 'whoami' }, {
    contextId: CTX, actionId: 'act-xyz',
  })
  assert.equal(out.pending_id, 'act-xyz')
  assert.equal(enqueuePending('terminal.exec', { command: 'whoami' }), 'act-xyz') // 去重同 id
})
