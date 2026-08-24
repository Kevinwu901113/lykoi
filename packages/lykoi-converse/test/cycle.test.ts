/**
 * 信封周期（S-18/S-19 + G-10 D-01..D-04）：四选一各路 / 有界重试 / 工具枚举 /
 * demote 可观测 / 横幅不破坏沉默 / inner 落库 / 回合骨架（回滚 / history /
 * inner_outer_pair D-08 / reflow 接线）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  composeSurfaceReply, CYCLE_CLOSING_NOTE, MAX_TOOL_STEPS,
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

test('D-01 有界重试：not_json 重试恰一次（u3_cycle_retried）；仍败 → u3_cycle_failed 带非内容元数据', async () => {
  const h = makeConversation()
  h.llm.push({ content: '我直接开口说话了', finishReason: 'stop', promptTokens: 100, completionTokens: 5 })
  h.llm.push({ content: '', finishReason: 'stop', promptTokens: 100, completionTokens: 42, extraKeys: ['reasoning_content'] })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '', '降级沉默')
  assert.equal(h.llm.calls.length, 2, '总调用 = 重试 + 1')
  const retried = lastEvent(h.events, 'u3_cycle_retried')!
  assert.deepEqual(retried, { reason: 'not_json', detail: 'first_char:cjk', step: 0, attempt: 1 })
  const failed = lastEvent(h.events, 'u3_cycle_failed')!
  assert.equal(failed.reason, 'not_json')
  assert.equal(failed.detail, 'first_char:empty', 'U3 缺陷①的那张脸：有 tokens、content 空')
  assert.equal(failed.attempts, 2)
  assert.equal(failed.content_chars, 0)
  assert.equal(failed.has_content, true)
  assert.equal(failed.finish_reason, 'stop')
  assert.equal(failed.completion_tokens, 42, '与失败同一事件可关联（活体两事件间无关联字段）')
  assert.equal(failed.prompt_tokens, 100)
  assert.deepEqual(failed.other_message_keys, ['reasoning_content'], 'reasoning_content 的存在可见，内容不泄')
  // 静默不发但回合成立：history reply=""。
  assert.equal(JSON.parse(h.store.getRecentHistoryOfType('conversation', 1)[0]!.content).reply, '')
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

test('D-03：tool_call 被 grounded 闸降级 → 沉默 + u3_cycle_tool_demoted（她想动手 ≠ 她想沉默）+ 零 dispatch', async () => {
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
        reason: '我就是想看看', // 不引用任何评估条目 → demote
      },
    }),
  })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '', '降级到 silence 一路走到底')
  assert.equal(dispatched, 0, '工具不执行')
  assert.deepEqual(lastEvent(h.events, 'u3_cycle_tool_demoted'), {
    original_kind: 'tool_call',
    tool_name: 'research_read_text',
  })
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.equal(record.demoted, true)
  assert.equal(record.demote_why, 'reason_not_grounded')
  assert.equal(record.original_kind, 'tool_call')
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
