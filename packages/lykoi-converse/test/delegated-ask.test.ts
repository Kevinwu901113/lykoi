/**
 * SK-77 认知侧协议 + S-57/S-58/S-59/S-60（M3-W2：`cycle_approval_gate_unwired`
 * 换真身）。单元层：dispatchFn 直接造出 needs_approval 观察，不经 kernel。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { ASK_FALLBACK, type ConverseDispatchFn } from '../src/index.ts'
import { envelope, eventNames, lastEvent, makeConversation, T0 } from './fixture.ts'

function toolEnvelope(name: string, args: Record<string, unknown> = {}): string {
  return envelope({
    decision: {
      kind: 'tool_call',
      tool: { name, arguments: args },
      reason: '他问我在不在', // 逐字引用 assessment.item → 接地
    },
  })
}

/** 撞门的 dispatchFn：回 needs_approval，可选地略掉 action_id。 */
function gateDispatch(opts: { withActionId?: boolean } = {}): ConverseDispatchFn {
  return async () => ({
    success: false,
    error: 'needs_approval',
    data: {
      needs_approval: true,
      ...(opts.withActionId === false ? {} : { action_id: 'act-77', correlation_id: 'corr-77' }),
    },
  })
}

test('SK-77：撞门 → deferred 回填 + 四项载荷 + 回合沉默（S-57/S-58 口径）', async () => {
  const h = makeConversation({ dispatchFn: gateDispatch(), clock: () => T0 })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  const reply = await h.conversation.send('帮我跑 ls', { runId: 'r1' })

  // S-58：问句就是那条消息 —— 回合本身不复述（返回空串，不是 ASK_FALLBACK）
  assert.equal(reply, '')
  assert.ok(eventNames(h.events).includes('approval_ask_delegated'))
  assert.ok(!eventNames(h.events).includes('cycle_approval_gate_unwired')) // 替身已退役
  assert.equal(lastEvent(h.events, 'approval_ask_delegated')!.action_type, 'terminal.exec')

  // SK-77：恰四项，且入站侧的东西一个字节都不在里面（E2 分层）
  const ask = h.conversation.takeDelegatedAsk()!
  assert.deepEqual(Object.keys(ask).sort(), ['action_id', 'action_type', 'correlation_id', 'params'])
  assert.equal(ask.action_type, 'terminal.exec')
  assert.deepEqual(ask.params, { command: 'ls' })
  assert.equal(ask.action_id, 'act-77')
  assert.equal(ask.correlation_id, 'corr-77')

  // S-60：取走即清
  assert.equal(h.conversation.takeDelegatedAsk(), null)
})

test('S-59：认知侧**不预先 enqueue** —— 排队跟着问句走，这一层只交载荷', async () => {
  // 队列面的唯一入口是 kernel 的 enqueuePending；本层拿不到它，也没有任何写路径。
  // 结构断言：撞门那一轮除了 dispatchFn 之外零外部调用（dispatchFn 只被调一次）。
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: false, error: 'needs_approval', data: { needs_approval: true, action_id: 'a', correlation_id: 'c' } }
    },
  })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  await h.conversation.send('帮我跑 ls', { runId: 'r1' })
  assert.equal(dispatched, 1) // 一次派发撞门；没有第二次（问句不在这一层发）
  assert.equal(h.llm.calls.length, 1) // 也没有第二次 LLM —— 撞门就是这一轮的结局
})

test('S-13：一轮一份清场 —— 上一轮的载荷不跨轮悬着', async () => {
  const h = makeConversation({ dispatchFn: gateDispatch() })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  await h.conversation.send('帮我跑 ls', { runId: 'r1' })
  assert.notEqual(h.conversation.peekDelegatedAsk(), null)
  // 没人取走它，下一轮开头清场
  h.llm.push({ content: envelope({ 情绪脉冲: ['normal_interaction'] }) })
  await h.conversation.send('在吗', { runId: 'r2' })
  assert.equal(h.conversation.peekDelegatedAsk(), null)
})

test('peekDelegatedAsk 只看不取 —— 落账用它，去问用 takeDelegatedAsk', async () => {
  const h = makeConversation({ dispatchFn: gateDispatch() })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  await h.conversation.send('帮我跑 ls', { runId: 'r1' })
  assert.equal(h.conversation.peekDelegatedAsk()!.action_id, 'act-77')
  assert.equal(h.conversation.peekDelegatedAsk()!.action_id, 'act-77') // 看两次都还在
  assert.notEqual(h.conversation.takeDelegatedAsk(), null)
  assert.equal(h.conversation.peekDelegatedAsk(), null)
})

test('ASK_FALLBACK：没有 action_id 就没有可绑的把手 → 问不出去，说那一句，且**不编 id**', async () => {
  const h = makeConversation({ dispatchFn: gateDispatch({ withActionId: false }) })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  const reply = await h.conversation.send('帮我跑 ls', { runId: 'r1' })
  assert.equal(reply, ASK_FALLBACK)
  assert.equal(h.conversation.takeDelegatedAsk(), null) // 没有编出来的载荷
  const skipped = lastEvent(h.events, 'approval_ask_skipped')!
  assert.equal(skipped.reason, 'no_action_id')
  assert.equal(skipped.action_type, 'terminal.exec')
  assert.ok(!eventNames(h.events).includes('approval_ask_delegated'))
})

test('S-57：撞门那一步的 tool_call 补 deferred 结果 —— 历史里没有未应答的调用', async () => {
  const h = makeConversation({ dispatchFn: gateDispatch() })
  h.llm.push({ content: toolEnvelope('terminal_exec', { command: 'ls' }) })
  await h.conversation.send('帮我跑 ls', { runId: 'r1' })
  // 下一轮装配必须是合法形状（未应答的 tool_call 会毒化之后每一次装配）
  h.llm.push({ content: envelope({ 情绪脉冲: ['normal_interaction'] }) })
  await h.conversation.send('那算了', { runId: 'r2' })
  const sent = h.llm.calls.at(-1)!.messages
  const toolCalls = sent.filter((m) => m.role === 'assistant' && m.tool_calls)
  const toolResults = sent.filter((m) => m.role === 'tool')
  assert.equal(toolCalls.length, toolResults.length)
  assert.equal(toolCalls.length, 1)
  assert.equal(toolResults[0]!.tool_call_id, toolCalls[0]!.tool_calls![0]!.id)
  assert.match(String(toolResults[0]!.content), /"deferred":true/)
})
