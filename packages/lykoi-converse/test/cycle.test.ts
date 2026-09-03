/**
 * 信封周期（S-18/S-19 + G-10 D-01..D-04）：四选一各路 / 有界重试 / 工具枚举 /
 * demote 可观测 / 横幅不破坏沉默 / inner 落库 / 回合骨架（回滚 / history /
 * inner_outer_pair D-08 / reflow 接线）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { GAP_NOT_WIRED, JSON_RETRY_NUDGE } from 'lykoi-decide'
import {
  composeSurfaceReply, CYCLE_CLOSING_NOTE, CYCLE_TOOL_UNWIRED_EVENT, MAX_TOOL_STEPS,
} from '../src/index.ts'
import {
  envelope, eventNames, lastEvent, makeConversation, T0,
} from './fixture.ts'

function toolEnvelope(name: string, args: Record<string, unknown> = {}): string {
  return envelope({
    decision: {
      kind: 'tool_call',
      tool: { name, arguments: args },
      reason: '他问我在不在', // 逐字引用 assessment.item → 接地
    },
  })
}

test('reply 路：assistant 入史、返回 content、u3_cycle_envelope 只记字数（D-08）', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope({ 情绪脉冲: ['normal_interaction'] }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '在的，怎么了？')
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.equal(record.kind, 'reply')
  assert.equal(record.sent_chars, 7)
  assert.equal(record.demoted, false)
  assert.deepEqual(record.pulse, ['normal_interaction'])
  assert.equal(record.step, 0)
  // D-08：事件流零正文。
  assert.equal(JSON.stringify(record).includes('在的，怎么了'), false)
  // S-16：恰一条 history 行（正文归她的记忆表）。
  const rows = h.store.getRecentHistoryOfType('conversation', 10)
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0]!.content), { user: '在吗', reply: '在的，怎么了？' })
  // inner_outer_pair：长度/哈希形态。
  const pair = lastEvent(h.events, 'inner_outer_pair')!
  assert.equal(pair.turn_id, rows[0]!.id)
  assert.equal(pair.reply_chars, 7)
  assert.equal(typeof pair.reply_sha16, 'string')
  assert.equal(pair.has_inner, false)
  assert.equal(JSON.stringify(pair).includes('在的'), false)
  // 回流接线（S-16）：一条 conversation 经验 + normal_interaction。
  const exp = h.store.recentExperiences(3)
  assert.equal(exp[0]!.source, 'conversation')
  assert.ok(exp[0]!.content.includes('他说「在吗」,我答「在的，怎么了？」'))
})

test('silence 路：有账没话 —— 空回复、history reply=""、无 assistant 消息、横幅不破坏沉默（D-04）', async () => {
  const h = makeConversation()
  h.llm.push({
    content: envelope({ decision: { kind: 'silence', reason: '' } }),
  })
  const reply = await h.conversation.send('……', { runId: 'r1' })
  assert.equal(reply, '')
  assert.equal(lastEvent(h.events, 'u3_cycle_envelope')!.kind, 'silence')
  const rows = h.store.getRecentHistoryOfType('conversation', 10)
  assert.deepEqual(JSON.parse(rows[0]!.content), { user: '……', reply: '' })
  // D-04：有 pending 也不许把空回复变成非空横幅。
  assert.equal(composeSurfaceReply('', 3, false), '')
  assert.equal(composeSurfaceReply('有话', 3, false), '⚠️ 有 3 条待批准操作。\n\n有话')
  assert.equal(composeSurfaceReply('有话', 3, true), '有话', '本轮就是审批问句 → 不双重警告')
  assert.equal(composeSurfaceReply('有话', 0, false), '有话')
})

test('WO-FIX-NOTJSON-01 D-2/D-3 × WO-FIX-JSONMODE-01 D-1/D-2：not_json 有界重试至多两次、带引导且去 json 模式；三次全空 → u3_cycle_retried 两条，u3_cycle_failed.attempts===3', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop', promptTokens: 100, completionTokens: 5 })
  h.llm.push({ content: '', finishReason: 'stop', promptTokens: 17, completionTokens: 6, extraKeys: ['reasoning_content'] })
  h.llm.push({ content: '', finishReason: 'stop', promptTokens: 17, completionTokens: 7, extraKeys: ['reasoning_content'] })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '', '降级沉默')
  assert.equal(h.llm.calls.length, 3, '总调用 = 重试(至多两次) + 1')

  const retriedEvents = h.events.filter(([n]) => n === 'u3_cycle_retried').map(([, f]) => f)
  assert.equal(retriedEvents.length, 2)
  assert.deepEqual(
    retriedEvents[0],
    { reason: 'not_json', detail: 'first_char:empty', step: 0, attempt: 1, reasoning_len: 0, json_mode: true },
  )
  assert.deepEqual(
    retriedEvents[1],
    { reason: 'not_json', detail: 'first_char:empty', step: 0, attempt: 2, reasoning_len: 0, json_mode: false },
  )

  const failed = lastEvent(h.events, 'u3_cycle_failed')!
  assert.equal(failed.reason, 'not_json')
  assert.equal(failed.attempts, 3, '至多两次重试 + 首发 = 3')
  assert.equal(failed.content_chars, 0)
  assert.equal(failed.completion_tokens, 7, '最后一次尝试的账')
  assert.equal(failed.prompt_tokens, 17)
  assert.equal(failed.reasoning_len, 0)
  assert.equal(failed.json_mode, false, '最后一次尝试（attempt 2，带引导）已去 json 模式')

  // 第 1 次末尾是 system 契约；第 2/3 次末尾是 {role:'user', content: JSON_RETRY_NUDGE}。
  const [call0, call1, call2] = h.llm.calls
  assert.equal(call0!.messages[call0!.messages.length - 1]!.role, 'system')
  assert.deepEqual(
    call1!.messages[call1!.messages.length - 1],
    { role: 'user', content: JSON_RETRY_NUDGE },
  )
  assert.deepEqual(
    call2!.messages[call2!.messages.length - 1],
    { role: 'user', content: JSON_RETRY_NUDGE },
  )
  // 除末尾这一条引导外，三次 messages 逐字相等（attempt 0 本就没有引导，
  // 是 attempt 1/2 的公共前缀 —— 引导是唯一追加，不改上面任何一块）。
  assert.deepEqual(call1!.messages.slice(0, -1), call0!.messages)
  assert.deepEqual(call2!.messages.slice(0, -1), call0!.messages)
  // WO-FIX-JSONMODE-01 D-1：attempt 0 带 json_object，attempt 1/2（nudge）为 null。
  assert.deepEqual(call0!.opts.responseFormat, { type: 'json_object' })
  assert.equal(call1!.opts.responseFormat, null)
  assert.equal(call2!.opts.responseFormat, null)
  // 其余 options（purpose/reasoningEffort/signal）三次相等——本单只动 responseFormat。
  for (const key of ['purpose', 'reasoningEffort', 'signal'] as const) {
    assert.deepEqual(call1!.opts[key], call0!.opts[key])
    assert.deepEqual(call2!.opts[key], call0!.opts[key])
  }
  // 静默不发但回合成立：history reply=""。
  assert.equal(JSON.parse(h.store.getRecentHistoryOfType('conversation', 1)[0]!.content).reply, '')
})

test('WO-FIX-NOTJSON-01 D-2 × WO-FIX-JSONMODE-01 D-1：首次空、次成功 → 单条 retried + 正常回复；引导不进历史（下一轮首次调用不含它）；attempt 0 字节不变、attempt 1 去 json 模式', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop' })
  h.llm.push({ content: envelope() })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '在的，怎么了？')
  assert.equal(h.llm.calls.length, 2)
  const retriedEvents = h.events.filter(([n]) => n === 'u3_cycle_retried')
  assert.equal(retriedEvents.length, 1)
  assert.deepEqual(
    retriedEvents[0]![1],
    { reason: 'not_json', detail: 'first_char:empty', step: 0, attempt: 1, reasoning_len: 0, json_mode: true },
  )
  // attempt 0（首次）：opts 含 json_object —— 与今产线逐字节相同（测试钉）。
  assert.deepEqual(h.llm.calls[0]!.opts.responseFormat, { type: 'json_object' })
  // 第二次调用带引导，且去 json 模式。
  const secondCall = h.llm.calls[1]!
  assert.deepEqual(secondCall.messages[secondCall.messages.length - 1], { role: 'user', content: JSON_RETRY_NUDGE })
  assert.equal(secondCall.opts.responseFormat, null)

  // 下一轮：首次调用 messages 里不含引导语（引导没有 push 进 #messages，不进历史）；
  // 且这一次全新的 attempt 0 请求同样带 json_object（不是"重试之后就一直去 json 模式"）。
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '还在', reason: '他问我在不在' } }) })
  await h.conversation.send('还在吗', { runId: 'r2' })
  const nextFirstMsgs = h.llm.calls[2]!.messages
  assert.equal(nextFirstMsgs.some((m) => m.content === JSON_RETRY_NUDGE), false)
  assert.deepEqual(h.llm.calls[2]!.opts.responseFormat, { type: 'json_object' })
})

test('WO-FIX-JSONMODE-01 D-4③：重试返回「前缀说明 + JSON 对象」的正文能被 extractJson 抠出信封', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop' })
  h.llm.push({
    content: `好的，这是我的回复：\n${envelope({ decision: { kind: 'reply', content: '在的', reason: '他问我在不在' } })}\n以上。`,
  })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '在的', '前缀/后缀说明文字被 extractJson 的花括号切片容错吃掉')
  assert.equal(h.llm.calls.length, 2)
  assert.equal(h.llm.calls[1]!.opts.responseFormat, null, '这一次请求本就没强制 json 模式，靠切片容错兜底')
  assert.equal(eventNames(h.events).includes('u3_cycle_failed'), false)
})

// WO-FIX-THINKPOLICY-01 D-5 翻面：本条原断言「step ≥ 1 的重试同时带
// reasoningEffort:off」。THINKPOLICY-01 D-3 撤掉了那个 per-step 覆盖（它绕的
// 400 已由 TOOLFRAME-01 根除，档位归 adapter 一处），于是这一位翻成「键不
// 在」；同条用例另外两件事（引导、去 json 模式）与本单无关，原样保留。
test('WO-FIX-NOTJSON-01 D-2 × WO-FIX-TOOLSTEP-01 D-1（THINKPOLICY-01 D-5 翻面）× WO-FIX-JSONMODE-01 D-1：step ≥ 1 的重试不带 reasoningEffort 键，但带引导、去 json 模式', async () => {
  const h = makeConversation()
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) }) // step 0：工具步
  h.llm.push({ content: '', finishReason: 'stop' }) // step 1 attempt 0：空
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '好', reason: '他问我在不在' } }) }) // step 1 attempt 1
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '好')
  assert.equal(h.llm.calls.length, 3)
  const step1Retry = h.llm.calls[2]!
  assert.equal('reasoningEffort' in step1Retry.opts, false)
  assert.equal(step1Retry.opts.responseFormat, null)
  assert.deepEqual(
    step1Retry.messages[step1Retry.messages.length - 1],
    { role: 'user', content: JSON_RETRY_NUDGE },
  )
  const retried = lastEvent(h.events, 'u3_cycle_retried')!
  assert.equal(retried.step, 1)
  assert.equal(retried.json_mode, true, 'attempt 0（刚失败的那次）带了 json_object')
})

test('WO-FIX-NOTJSON-01 D-4：converse 侧回包带 reasoningLength → u3_cycle_retried.reasoning_len 原样透传', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop', reasoningLength: 137 })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const retried = lastEvent(h.events, 'u3_cycle_retried')!
  assert.equal(retried.reasoning_len, 137)
})

test('WO-FIX-NOTJSON-01 D-4：三次都带 reasoningLength → u3_cycle_failed.reasoning_len 为最后一次的值', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop', reasoningLength: 50 })
  h.llm.push({ content: '', finishReason: 'stop', reasoningLength: 80 })
  h.llm.push({ content: '', finishReason: 'stop', reasoningLength: 137 })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '')
  const failed = lastEvent(h.events, 'u3_cycle_failed')!
  assert.equal(failed.reasoning_len, 137)
})

// --- WO-FIX-THINKPOLICY-01 D-0：成功周期的三个读数 --------------------------
//
// elapsed_ms 一个数分不开「思考很长」与「前缀缓存未命中」。三个字段的缺席
// 语义与 u3_cycle_failed 对齐：usage 两项 null（「没报量」≠「花了 0」），
// reasoning_len 0（没有 reasoning-delta 就是真没有）。

test('WO-FIX-THINKPOLICY-01 D-0：回包带 usage 与 reasoningLength → u3_cycle_envelope 三字段原样入账', async () => {
  const h = makeConversation()
  h.llm.push({
    content: envelope(),
    promptTokens: 4321,
    completionTokens: 88,
    reasoningLength: 1907,
  })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '在的，怎么了？')
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.equal(record.prompt_tokens, 4321)
  assert.equal(record.completion_tokens, 88)
  assert.equal(record.reasoning_len, 1907)
  // 零正文口径不因加了读数而破：三个字段都是数，不含任何正文。
  assert.equal(JSON.stringify(record).includes('在的，怎么了'), false)
})

test('WO-FIX-THINKPOLICY-01 D-0：回包没有 usage / reasoningLength → prompt/completion 记 null，reasoning_len 记 0（键都在）', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope() }) // 缺省 fake：三个键一个都不带
  await h.conversation.send('在吗', { runId: 'r1' })
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.equal(record.prompt_tokens, null)
  assert.equal(record.completion_tokens, null)
  assert.equal(record.reasoning_len, 0)
  // 缺席是 null/0 而不是「键不在」—— 下游按名取值，缺个键与缺个读数不同。
  assert.equal('prompt_tokens' in record, true)
  assert.equal('completion_tokens' in record, true)
  assert.equal('reasoning_len' in record, true)
})

test('WO-FIX-THINKPOLICY-01 D-0：重试之后记的是**成立那一跳**的读数，不是失败那跳的', async () => {
  const h = makeConversation()
  h.llm.push({ content: '', finishReason: 'stop', promptTokens: 100, completionTokens: 1, reasoningLength: 900 })
  h.llm.push({ content: envelope(), promptTokens: 120, completionTokens: 66, reasoningLength: 7 })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(h.llm.calls.length, 2)
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.equal(record.prompt_tokens, 120)
  assert.equal(record.completion_tokens, 66)
  assert.equal(record.reasoning_len, 7)
  // 失败那一跳的读数没丢，它在自己的 u3_cycle_retried 里。
  assert.equal(lastEvent(h.events, 'u3_cycle_retried')!.reasoning_len, 900)
})

test('D-01 边界：unknown_kind 不重试（理解偏差重试大概率复现）—— attempts=1 直接失败', async () => {
  const h = makeConversation()
  h.llm.push({ content: JSON.stringify({ decision: { kind: 'REPLY', content: 'x' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '')
  assert.equal(h.llm.calls.length, 1)
  const failed = lastEvent(h.events, 'u3_cycle_failed')!
  assert.equal(failed.reason, 'unknown_kind')
  assert.equal(failed.detail, 'kind:REPLY')
  assert.equal(failed.attempts, 1)
  assert.equal(eventNames(h.events).includes('u3_cycle_retried'), false)
})

test('D-02：表外工具名 → cycle_unknown_tool 大声落痕 + error 结果回填 + 周期继续（不再是零痕迹断点）', async () => {
  const h = makeConversation()
  h.llm.push({ content: toolEnvelope('web_search', { q: 'x' }) }) // 断点 1 的那种名字
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '查不了，我换个说法', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '查不了，我换个说法')
  assert.deepEqual(lastEvent(h.events, 'cycle_unknown_tool'), { name: 'web_search' })
  // 第二周期读得到 error 结果（回填在史）。
  const second = h.llm.calls[1]!.messages
  const toolResult = second.find((m) => m.role === 'tool')!
  assert.deepEqual(JSON.parse(toolResult.content!), {
    success: false, error: "unknown tool 'web_search'",
  })
})

test('unwired dispatch：合法工具名大声失败（绝不静默成功），周期继续', async () => {
  const h = makeConversation()
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '通道还没长出来', reason: '他问我在不在' } }) })
  await h.conversation.send('在吗', { runId: 'r1' })
  const toolResult = h.llm.calls[1]!.messages.find((m) => m.role === 'tool')!
  const payload = JSON.parse(toolResult.content!)
  assert.equal(payload.success, false)
  assert.ok(String(payload.error).includes('kernel dispatch 未接线(M3)'))
})

/**
 * WO-FIX-LOOP-01 D-1d 直接验收：给一份不含该动作的 wiredActions，`#buildAction`
 * 在到达 dispatchFn 之前就把它挡下——大声落痕（CYCLE_TOOL_UNWIRED_EVENT +
 * capability_gap{reason: not_wired, source: converse}）+ error 结果回填 + 周期
 * 继续，dispatchFn 一次都不被调用。
 */
test('D-1d：wiredActions 不含该动作 → #buildAction 挡在 dispatch 之前，大声落痕、周期继续', async () => {
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: true, data: {} }
    },
    wiredActions: new Set(['notify.owner']), // 真接得通的只有这一个——刻意不含 research_browser.read_text
  })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '看不了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '看不了')
  assert.equal(dispatched, 0, 'D-1d：dispatchFn 从未被调用')
  const unwired = lastEvent(h.events, 'u3_cycle_tool_unwired')!
  assert.deepEqual(unwired, { name: 'research_read_text', action_type: 'research_browser.read_text' })
  const gap = lastEvent(h.events, 'capability_gap')!
  // 治理复核改口：wanted 记工具名（18 字，≤ WANTED_TOKEN_MAX=20 原样落），
  // 与位点④同口径；记动作类型（26 字）只会落长度，标签就丢了。
  assert.equal(gap.wanted, 'research_read_text')
  assert.equal(gap.reason, GAP_NOT_WIRED)
  assert.equal(gap.source, 'converse')
  const toolResult = h.llm.calls[1]!.messages.find((m) => m.role === 'tool')!
  const payload = JSON.parse(toolResult.content!)
  assert.equal(payload.success, false)
  assert.ok(String(payload.error).includes('organ not wired'))
})

/**
 * WO-FIX-LOOP-01 D-1d 向后兼容：不给 wiredActions（缺省）→ 这道新闸整个不参与
 * 判断，行为逐字节落回旧路——dispatchFn 照样被调用，不再是"挡在门外"。
 */
test('D-1d 向后兼容：不给 wiredActions → 新闸不触发，dispatchFn 照常被调用', async () => {
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: true, data: {} }
    },
    // 故意不设 wiredActions。
  })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '看完了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '看完了')
  assert.equal(dispatched, 1, '缺省时 D-1d 闸不参与——旧行为不变')
  assert.equal(eventNames(h.events).includes('u3_cycle_tool_unwired'), false)
})

/**
 * WO-FIX-LOOP-01 D-2b 改口：这条用例原先钉的是"tool_call 理由未接地 → SA-20b
 * 溯源闸（第③关）把它 demote 掉"。D-2b 让 tool_call 免这一关——一次工具调用
 * 本身就是可核验的结构化动作，理由没有逐字落在 assessment 原文里不再是把它
 * 按下去的理由。于是这份未接地的理由不再能 demote 它：决定被认真对待、工具
 * 真的执行到底（这个用例里 dispatchFn 是喂进去的真替身，不受 wiredActions
 * 影响——unit 级夹具默认不设 wiredActions，D-1d 闸不在这条路上）。
 */
test('D-03→D-2b改口：tool_call 免溯源门（第③关）——未接地的理由不再降级，工具照常执行到底', async () => {
  let dispatched = 0
  const h = makeConversation({
    dispatchFn: async () => {
      dispatched += 1
      return { success: true, data: {} }
    },
  })
  h.llm.push({
    content: envelope({
      decision: {
        kind: 'tool_call',
        tool: { name: 'research_read_text', arguments: { url: 'https://a' } },
        reason: '我就是想看看', // 不引用任何评估条目——D-2b 起对 tool_call 免溯源门，这不再是 demote 的理由
      },
    }),
  })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '看完了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '看完了')
  assert.equal(dispatched, 1, 'D-2b：不再被溯源门挡下，工具真的执行了')
  assert.equal(eventNames(h.events).includes('u3_cycle_tool_demoted'), false, 'demote 路径不再对 tool_call 触发')
  const record = h.events.find(([n]) => n === 'u3_cycle_envelope')![1]
  assert.equal(record.kind, 'tool_call')
  assert.equal(record.demoted, false)
})

test('missing_tool / 工具预算烧完：安全侧收场（S-46 #7/#8）', async () => {
  // kind=tool_call 但 tool 缺失。
  const h = makeConversation()
  h.llm.push({ content: envelope({ decision: { kind: 'tool_call', reason: '他问我在不在' } }) })
  assert.equal(await h.conversation.send('在吗', { runId: 'r1' }), '')
  const failed = lastEvent(h.events, 'u3_cycle_failed')!
  assert.equal(failed.reason, 'missing_tool')
  assert.equal(failed.detail, 'tool:none')
  // 收尾周期仍要动手 → u3_cycle_tool_budget_exhausted，不执行不硬编总结。
  const h2 = makeConversation()
  for (let i = 0; i < MAX_TOOL_STEPS; i += 1) {
    h2.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  }
  h2.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) }) // closing 周期
  assert.equal(await h2.conversation.send('在吗', { runId: 'r1' }), '')
  assert.deepEqual(lastEvent(h2.events, 'u3_cycle_tool_budget_exhausted'), {
    tool: 'research_read_text', steps: MAX_TOOL_STEPS,
  })
  // 收尾周期带 CYCLE_CLOSING_NOTE（S-19）。
  const closingCall = h2.llm.calls.at(-1)!
  assert.ok(closingCall.messages.some((m) => m.content === CYCLE_CLOSING_NOTE))
})

test('promise_followup：登记 + takeFollowupRequest 取走即清（S-60）；后台回合 continuation 口径', async () => {
  const h = makeConversation()
  h.llm.push({
    content: envelope({
      decision: { kind: 'promise_followup', content: '把赛程查完再告诉他', reason: '他问我在不在' },
    }),
  })
  const reply = await h.conversation.send('帮我查下赛程', { runId: 'r1' })
  assert.equal(reply, '把赛程查完再告诉他')
  assert.ok(eventNames(h.events).includes('followup_requested'))
  assert.equal(h.conversation.takeFollowupRequest(), '把赛程查完再告诉他')
  assert.equal(h.conversation.takeFollowupRequest(), null, '取走即清')
  // 后台回合：continuation_requested（挂起等批，无递归续跑）。
  const bg = makeConversation()
  bg.llm.push({
    content: envelope({
      decision: { kind: 'promise_followup', content: '继续没做完的', reason: '他问我在不在' },
    }),
  })
  await bg.conversation.send('继续', { runId: 'r1', background: true })
  assert.ok(eventNames(bg.events).includes('continuation_requested'))
})

test('inner 真落库：conversation_inner_applied（source 派生）+ resolve 注入域闸；熔断开关 → dropped 事件', async () => {
  const h = makeConversation()
  const seededId = h.store.createThought('他最近在忙什么', 'question', 'conversation', { chargeHint: 0.9, now: T0 })!
  h.llm.push({
    content: envelope({
      inner: {
        thoughts: [{ content: '他今天心情不错', kind: 'observation', related_concern_hint: null, charge_hint: 0.6 }],
        resolve: [seededId, 9999], // 9999 不在注入域 → 消毒层静默丢
      },
    }),
  })
  await h.conversation.send('在吗', { runId: 'r1' })
  const applied = lastEvent(h.events, 'conversation_inner_applied')!
  assert.equal(applied.created, 1)
  assert.equal(applied.resolved, 1)
  const pair = lastEvent(h.events, 'inner_outer_pair')!
  assert.equal(pair.has_inner, true)
  assert.equal(lastEvent(h.events, 'u3_cycle_envelope')!.inner_applied, true)
  // 熔断：innerEnabled=false → conversation_inner_dropped_switch_off，零落库。
  const off = makeConversation({ innerEnabled: false })
  off.llm.push({
    content: envelope({
      inner: { thoughts: [{ content: 'x', kind: 'observation', related_concern_hint: null, charge_hint: 0.5 }], resolve: [] },
    }),
  })
  await off.conversation.send('在吗', { runId: 'r1' })
  assert.ok(eventNames(off.events).includes('conversation_inner_dropped_switch_off'))
  assert.equal(lastEvent(off.events, 'u3_cycle_envelope')!.inner_applied, false)
})

test('S-14 回合回滚：llm 抛错 → 消息列表复原 + chat_turn_rolled_back + 重抛；下一轮不带半截轮', async () => {
  const h = makeConversation()
  h.llm.push(() => {
    throw new Error('transport down')
  })
  await assert.rejects(() => h.conversation.send('在吗', { runId: 'r1' }), /transport down/)
  assert.ok(eventNames(h.events).includes('chat_turn_rolled_back'))
  assert.equal(h.store.getRecentHistoryOfType('conversation', 10).length, 0, '失败回合零 history')
  // 复原后下一轮照常。
  h.llm.push({ content: envelope() })
  assert.equal(await h.conversation.send('还在吗', { runId: 'r2' }), '在的，怎么了？')
  // 半截轮没有留下：第二轮装配的 history 段只有这一条 user。
  const userMessages = h.llm.calls.at(-1)!.messages.filter((m) => m.role === 'user')
  assert.equal(userMessages.length, 1)
  assert.equal(userMessages[0]!.content, '还在吗')
})

test('S-52：json 强制默认开且只在信封调用（summary 恒 null）；关钮后信封也不带', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.deepEqual(h.llm.calls[0]!.opts.responseFormat, { type: 'json_object' })
  // 关钮（读在调用点：改 env 即生效）。
  process.env.LYKOI_U3_ENVELOPE_JSON_MODE = '0'
  try {
    h.llm.push({ content: envelope() })
    await h.conversation.send('还在吗', { runId: 'r2' })
    assert.equal(h.llm.calls.at(-1)!.opts.responseFormat, null)
  } finally {
    delete process.env.LYKOI_U3_ENVELOPE_JSON_MODE
  }
})

test('信封契约恒在生成点最后（CACHE-INVERT 第 13 块）', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const messages = h.llm.calls[0]!.messages
  const last = messages.at(-1)!
  assert.equal(last.role, 'system')
  assert.ok(last.content!.startsWith('上面是你此刻的全部处境。'))
  assert.ok(last.content!.includes('只有那一个 JSON 对象。'))
})
