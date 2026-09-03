/**
 * WO-FIX-TOOLSTEP-01 D-1：工具步后第二跳关思考。
 *
 * 根因：DeepSeek v4-flash 默认 thinking 开；把带 tool_calls 的 assistant 帧
 * 回灌给它、却不带 reasoning_content，会被判 400 —— 这个 400 经
 * adapterStream 归一成 finish{error}，再经 lykoi-llm 变成 LlmFinishError，
 * 不在 #runCycle 的 try/catch 覆盖范围内，直接把整轮回滚到沉默（S-14）。
 *
 * D-1 的修法：信封调用只要 step>=1（历史里已经有一帧工具调用/结果）就带
 * `reasoningEffort:'off'`；step 0 和 summary 调用一个字都不带这个键
 * （不是 undefined —— 键本身不出现，见下方 `in` 断言）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  envelope, makeConversation,
} from './fixture.ts'

function toolEnvelope(name: string, args: Record<string, unknown> = {}): string {
  return envelope({
    decision: {
      kind: 'tool_call',
      tool: { name, arguments: args },
      reason: '他问我在不在',
    },
  })
}

test('D-1：step 0 信封调用不带 reasoningEffort 键（不是 undefined —— 键本身不在）', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(h.llm.calls.length, 1)
  assert.equal('reasoningEffort' in h.llm.calls[0]!.opts, false)
})

test('D-1：工具步之后（step>=1）信封调用恒带 reasoningEffort:\'off\'；工具帧仍在历史里', async () => {
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: true, data: { ok: true } }
    },
  })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '看完了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '看完了')
  assert.equal(dispatched, 1)
  assert.equal(h.llm.calls.length, 2)

  // step 0：没有这个键。
  assert.equal('reasoningEffort' in h.llm.calls[0]!.opts, false)

  // step 1：键在，值是 'off'。
  assert.equal(h.llm.calls[1]!.opts.reasoningEffort, 'off')

  // D-1 只关思考，不掉工具帧：第二次调用的历史里能看到 assistant 的
  // tool_calls 帧和对应的 tool 结果帧（成对，callId 绑回）。
  const secondMessages = h.llm.calls[1]!.messages
  const toolCallMsg = secondMessages.find((m) => m.role === 'assistant' && m.tool_calls !== undefined)
  assert.ok(toolCallMsg, '第二次调用的历史里必须还留着那次工具调用的 assistant 帧')
  const callId = toolCallMsg!.tool_calls![0]!.id
  const toolResultMsg = secondMessages.find((m) => m.role === 'tool' && m.tool_call_id === callId)
  assert.ok(toolResultMsg, '对应的 tool 结果帧必须还在，callId 绑回同一次调用')
})

test('D-1：多步工具循环里每一步 step>=1 都带 reasoningEffort:\'off\'（不是只在第二步）', async () => {
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: true, data: {} }
    },
  })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://b' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '两个都看完了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '两个都看完了')
  assert.equal(dispatched, 2)
  assert.equal(h.llm.calls.length, 3)
  assert.equal('reasoningEffort' in h.llm.calls[0]!.opts, false)
  assert.equal(h.llm.calls[1]!.opts.reasoningEffort, 'off')
  assert.equal(h.llm.calls[2]!.opts.reasoningEffort, 'off')
})

test('D-1：summary 调用（purpose=summary）一个字都不带 reasoningEffort 键', async () => {
  const h = makeConversation({ limits: { windowTurns: 2 } })
  for (let i = 0; i < 3; i += 1) h.llm.push({ content: envelope() })
  h.llm.fallback = { content: '摘要：他们互道了三次早安' }
  await h.conversation.send('早安一', { runId: 'r1' })
  await h.conversation.send('早安二', { runId: 'r2' })
  await h.conversation.send('早安三', { runId: 'r3' })
  const summaryCall = h.llm.calls.find((c) => c.opts.purpose === 'summary')
  assert.ok(summaryCall, '本轮必须触发过一次摘要调用（软窗溢出）')
  assert.equal('reasoningEffort' in summaryCall!.opts, false)
})
