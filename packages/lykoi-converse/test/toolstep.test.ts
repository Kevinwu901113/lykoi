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
 *
 * ---
 * WO-FIX-THINKPOLICY-01 D-5 翻面：上面那条修法**已撤**。它绕的那个 400 的
 * 根因由 WO-FIX-TOOLFRAME-01 消除（工具帧改走文本帧，assistant 帧不再需要
 * 回传 reasoning_content），绕行留着的代价是推理档位有两个主人。D-3 起
 * `#completion` 任何 step 都不带 reasoningEffort 键，档位只由 adapter 一处
 * （profile 的显式档位）决定。用例名保留 `D-1：` 前缀（同一条接缝的历史
 * 可追），断言全部翻成「键不在」；步内的工具帧形状断言原样保留 —— 那是
 * TOOLSTEP-01 另一半的成果，本单不动。
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

test('D-1（THINKPOLICY-01 D-5 翻面）：工具步之后（step>=1）信封调用同样不带 reasoningEffort 键；工具帧仍在历史里', async () => {
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

  // step 1：THINKPOLICY-01 D-3 之后同样没有这个键（此前是 'off'）——
  // 档位不再由这一层决定，两跳的 opts 在这一位上一模一样。
  assert.equal('reasoningEffort' in h.llm.calls[1]!.opts, false)

  // 工具帧不掉：第二次调用的历史里能看到 assistant 的
  // tool_calls 帧和对应的 tool 结果帧（成对，callId 绑回）。
  const secondMessages = h.llm.calls[1]!.messages
  const toolCallMsg = secondMessages.find((m) => m.role === 'assistant' && m.tool_calls !== undefined)
  assert.ok(toolCallMsg, '第二次调用的历史里必须还留着那次工具调用的 assistant 帧')
  const callId = toolCallMsg!.tool_calls![0]!.id
  const toolResultMsg = secondMessages.find((m) => m.role === 'tool' && m.tool_call_id === callId)
  assert.ok(toolResultMsg, '对应的 tool 结果帧必须还在，callId 绑回同一次调用')
})

test('D-1（THINKPOLICY-01 D-5 翻面）：多步工具循环里每一步都不带 reasoningEffort 键（不是只有第一步干净）', async () => {
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
  assert.equal('reasoningEffort' in h.llm.calls[1]!.opts, false)
  assert.equal('reasoningEffort' in h.llm.calls[2]!.opts, false)
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
