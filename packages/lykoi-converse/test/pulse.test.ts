/**
 * WO-PULSE-01：对话路径接调节场的三断点。
 *   ①③ self_state 块 —— 只在偏离基线 ≥ SELF_STATE_DEVIATION_MIN 时出块，位置在易变尾部末位；
 *   ②   信封 `情绪脉冲` → conversationTurnReflow → applyRegulationCause（跳过 normal_interaction、
 *       单轮上限 PULSE_APPLY_MAX、失败轮零写入、工具步中间信封不累加）；
 *   审计 converse/pulse_applied 与 u3_cycle_envelope.pulse 对得上。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { PULSE_APPLIED_EVENT, PULSE_APPLY_MAX } from 'lykoi-reflow'
import { REGISTRY } from 'lykoi-regulation'
import {
  BLOCK_SELF_STATE, SELF_STATE_DEVIATION_MIN, SELF_STATE_TEMPLATE,
  renderSelfState, selfStateBlock,
} from '../src/index.ts'
import {
  MemoryUndelivered, envelope, eventNames, lastEvent, makeConversation, makeStore,
} from './fixture.ts'

/** 夹具 regulation_field 四行 baseline 的 updated_at（lykoi-memory/testing）—— 此刻懒衰减为零。 */
const T_BASE = new Date('2026-08-20T00:00:00Z')

const BASELINES = {
  coherence: REGISTRY.coherence.baseline,
  load: REGISTRY.load.baseline,
  relational_tension: REGISTRY.relational_tension.baseline,
  exploration_hunger: REGISTRY.exploration_hunger.baseline,
}

function toolEnvelope(name: string, args: Record<string, unknown>, pulse: string[]): string {
  return envelope({
    情绪脉冲: pulse,
    decision: { kind: 'tool_call', tool: { name, arguments: args }, reason: '他问我在不在' },
  })
}

function causes(store: { recentRegulationEvents(name: null, n: number): { cause: string }[] }): string[] {
  return store.recentRegulationEvents(null, 20).map((r) => r.cause).sort()
}

// --- ①③ self_state 块 -------------------------------------------------------------

test('D-1 renderSelfState：四个都在基线 → null；一个偏离 ≥ 0.05 → 四行按 REGISTRY 键序、三位小数', () => {
  assert.equal(renderSelfState(BASELINES), null)
  const text = renderSelfState({ ...BASELINES, relational_tension: 0.5 })!
  assert.equal(
    text,
    SELF_STATE_TEMPLATE.replace('{}', [
      'coherence: 0.700', 'load: 0.200', 'relational_tension: 0.500', 'exploration_hunger: 0.000',
    ].join('\n')),
  )
  // 不渲染 cognitiveEffects：块里没有任何效果键。
  assert.equal(text.includes('prefer_rest'), false)
  assert.equal(text.includes('budget_multiplier'), false)
})

test('D-1 阈值：偏离恰 0.05 出块（按三位小数比，0.25−0.2 的浮点尾巴不作数）；0.049 不出；缺席变量跳过一行', () => {
  assert.equal(SELF_STATE_DEVIATION_MIN, 0.05)
  assert.notEqual(renderSelfState({ ...BASELINES, load: 0.25 }), null)
  assert.equal(renderSelfState({ ...BASELINES, load: 0.249 }), null)
  const partial = renderSelfState({ coherence: 0.7, load: 0.9 })!
  assert.deepEqual(partial.split('\n').slice(1), ['coherence: 0.700', 'load: 0.900'])
})

test('D-1 装配：基线时刻无 self_state 块；打一个因偏离后块出现在易变尾部末位（time 之后）', () => {
  const prepared = makeStore()
  try {
    const h = makeConversation({
      prepared,
      clock: () => T_BASE,
      selfState: (now) => selfStateBlock(prepared.store, now),
    })
    assert.equal(h.conversation.assembleLayout().includes(BLOCK_SELF_STATE), false)
    prepared.store.applyRegulationCause('contact_unanswered', { now: T_BASE }) // relational_tension 0.3 → 0.5
    const layout = h.conversation.assembleLayout()
    assert.deepEqual(layout.slice(-2), ['time', BLOCK_SELF_STATE])
  } finally {
    prepared.store.close()
  }
})

test('D-1 装配：有未送达块时 self_state 仍在最后（time, undelivered, self_state）；块正文是四行读数', async () => {
  const prepared = makeStore()
  try {
    prepared.store.applyRegulationCause('contact_unanswered', { now: T_BASE })
    const undelivered = new MemoryUndelivered()
    undelivered.items.push({ id: 1, ts: '2026-08-19T23:00:00+00:00', text_summary: '昨晚那句' })
    const h = makeConversation({
      prepared,
      undelivered,
      clock: () => T_BASE,
      selfState: (now) => selfStateBlock(prepared.store, now),
    })
    assert.deepEqual(h.conversation.assembleLayout().slice(-3), ['time', 'undelivered', BLOCK_SELF_STATE])
    // 真装配：模型看到的最后一条 system 消息就是 self_state 块。
    h.llm.push({ content: envelope() })
    await h.conversation.send('在吗', { runId: 'r1' })
    const messages = h.llm.calls[0]!.messages
    const block = messages.filter((m) => m.role === 'system' && String(m.content).startsWith('[自我状态')).at(-1)!
    assert.ok(block, 'self_state 块进了 prompt')
    assert.ok(String(block.content).includes('relational_tension: 0.500'))
  } finally {
    prepared.store.close()
  }
})

test('D-1 读失败只记账不毁轮：selfState 接口位抛 → self_state_read_failed、块不出现、回合照常', async () => {
  const h = makeConversation({
    selfState: () => { throw new Error('db gone') },
  })
  assert.equal(h.conversation.assembleLayout().includes(BLOCK_SELF_STATE), false)
  assert.ok(eventNames(h.events).includes('self_state_read_failed'))
  h.llm.push({ content: envelope() })
  assert.equal(await h.conversation.send('在吗', { runId: 'r1' }), '在的，怎么了？')
})

// --- ② 脉冲消费 ---------------------------------------------------------------------

test('D-2 reply 信封 ["explore_completed","normal_interaction"] → explore_completed 恰一次、normal_interaction 仍只一次；审计与信封对得上', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope({ 情绪脉冲: ['explore_completed', 'normal_interaction'] }) })
  await h.conversation.send('在吗', { runId: 'r1', turnId: 't1' })
  assert.deepEqual(causes(h.store), ['experience_recorded', 'explore_completed', 'normal_interaction'])
  const applied = lastEvent(h.events, PULSE_APPLIED_EVENT)!
  assert.deepEqual(applied, { run_id: 'r1', turn_id: 't1', applied: ['explore_completed'], skipped: 1 })
  const record = lastEvent(h.events, 'u3_cycle_envelope')!
  assert.deepEqual(record.pulse, ['explore_completed', 'normal_interaction'])
  assert.deepEqual(
    (record.pulse as string[]).filter((c) => c !== 'normal_interaction'),
    applied.applied,
  )
})

test('D-2 上限：四个名字 → 前三个按信封序写入，第四个丢弃（skipped=1）', async () => {
  assert.equal(PULSE_APPLY_MAX, 3)
  const h = makeConversation()
  h.llm.push({
    content: envelope({ 情绪脉冲: ['contact_unanswered', 'owner_silence_anomaly', 'rested', 'action_taken'] }),
  })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.deepEqual(causes(h.store), [
    'contact_unanswered', 'experience_recorded', 'normal_interaction', 'owner_silence_anomaly', 'rested',
  ])
  const applied = lastEvent(h.events, PULSE_APPLIED_EVENT)!
  assert.deepEqual(applied.applied, ['contact_unanswered', 'owner_silence_anomaly', 'rested'])
  assert.equal(applied.skipped, 1)
  // 事件行零正文：只有枚举名与计数。
  assert.equal(JSON.stringify(applied).includes('在的'), false)
})

test('D-2 silence 信封的脉冲同样消费（沉默是被接受的信封）；无脉冲的轮不记 pulse_applied', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope({ 情绪脉冲: ['owner_silence_anomaly'], decision: { kind: 'silence', reason: '' } }) })
  assert.equal(await h.conversation.send('……', { runId: 'r1' }), '')
  assert.deepEqual(causes(h.store), ['experience_recorded', 'normal_interaction', 'owner_silence_anomaly'])
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r2' })
  assert.equal(h.events.filter(([n]) => n === PULSE_APPLIED_EVENT).length, 1)
})

test('D-3 失败轮零写入：LLM 抛 → 回滚，无 regulation 事件、无 pulse_applied', async () => {
  const h = makeConversation()
  h.llm.push(() => { throw new Error('boom') })
  await assert.rejects(h.conversation.send('在吗', { runId: 'r1' }), /boom/)
  assert.deepEqual(causes(h.store), [])
  assert.equal(eventNames(h.events).includes(PULSE_APPLIED_EVENT), false)
  assert.ok(eventNames(h.events).includes('chat_turn_rolled_back'))
})

test('D-4 工具步中间信封的脉冲不累加：step 0 tool_call ["rested"] + step 1 reply ["action_taken"] → 只写 action_taken', async () => {
  const h = makeConversation({
    dispatchFn: async () => ({ success: true, data: { ok: true } }),
  })
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }, ['rested']) })
  h.llm.push({ content: envelope({ 情绪脉冲: ['action_taken'], decision: { kind: 'reply', content: '看完了', reason: '他问我在不在' } }) })
  assert.equal(await h.conversation.send('在吗', { runId: 'r1', turnId: 't1' }), '看完了')
  assert.deepEqual(causes(h.store), ['action_taken', 'experience_recorded', 'normal_interaction'])
  assert.deepEqual(lastEvent(h.events, PULSE_APPLIED_EVENT)!.applied, ['action_taken'])
})
