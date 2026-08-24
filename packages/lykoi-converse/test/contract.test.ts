/**
 * 信封契约（S-35..S-47）：词汇表/候选表/消毒器/护栏继承/失败归因/回执背书。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  annotateReceiptBacking, classifyFailure, CONVERSATION_CATALOGUE,
  CONVERSATION_CONTENT_REQUIRED, CONVERSATION_KINDS, CONVERSATION_SAFE_KIND,
  ENVELOPE_FIELDS, FAIL_MISSING_CONTENT, FAIL_NO_DECISION_OBJECT, FAIL_NOT_JSON,
  FAIL_UNKNOWN_KIND, FAILURE_REASONS, firstCharClass, kindToken, parseEnvelope,
  receiptsPresentInContext, sanitizePulse, sanitizeTool, TOOL_TO_ACTION,
  type ConverseMessage,
} from '../src/index.ts'
import { envelope } from './fixture.ts'

test('S-35：kinds 恰 4 项 / content 必填恰 2 项 / SAFE=silence / ENVELOPE_FIELDS=(tool,情绪脉冲)', () => {
  assert.deepEqual([...CONVERSATION_KINDS], ['reply', 'silence', 'tool_call', 'promise_followup'])
  assert.deepEqual([...CONVERSATION_CONTENT_REQUIRED], ['reply', 'promise_followup'])
  assert.equal(CONVERSATION_SAFE_KIND, 'silence')
  assert.deepEqual([...ENVELOPE_FIELDS], ['tool', '情绪脉冲'])
  assert.equal(Object.keys(TOOL_TO_ACTION).length, 10) // S-55
})

test('候选表：静态四条恒在，权重/cost/note 逐字（对话轮无"预算耗尽摘候选"的对应物）', () => {
  assert.deepEqual(CONVERSATION_CATALOGUE.map((c) => [c.kind, c.weight]), [
    ['reply', 0.5], ['silence', 0.4], ['tool_call', 0.4], ['promise_followup', 0.3],
  ])
  assert.equal(
    CONVERSATION_CATALOGUE[1]!.note,
    '选择不回。**沉默是一个动作, 有账** —— 它会落成事件, 不是什么都没发生',
  )
  assert.equal(
    CONVERSATION_CATALOGUE[3]!.note,
    '这一轮做不完: 写清要完成什么、卡在哪里。不是自动续跑, 挂起等他点头',
  )
})

test('S-43 sanitizeTool：只做形状/边界，不做白名单；永不抛', () => {
  assert.equal(sanitizeTool('browser_navigate'), null) // 字符串不是对象（断点 3 的形态）
  assert.equal(sanitizeTool({ name: 42 }), null)
  assert.equal(sanitizeTool({ name: '   ' }), null)
  assert.equal(sanitizeTool({ name: 'x'.repeat(65) }), null)
  // 表外名字**通过消毒**（合法性归 buildAction 的枚举 —— 两处真相禁令）。
  assert.deepEqual(sanitizeTool({ name: 'made_up_tool' }), { name: 'made_up_tool', arguments: {} })
  // arguments 非 dict → {}；超长 JSON → {}（name 保留）。
  assert.deepEqual(sanitizeTool({ name: 'a', arguments: [1] }), { name: 'a', arguments: {} })
  const big = { blob: 'x'.repeat(3000) }
  assert.deepEqual(sanitizeTool({ name: 'a', arguments: big }), { name: 'a', arguments: {} })
  assert.deepEqual(
    sanitizeTool({ name: ' browser_navigate ', arguments: { url: 'https://a' } }),
    { name: 'browser_navigate', arguments: { url: 'https://a' } },
  )
})

test('S-42 sanitizePulse：只认 15 CAUSES 名字，去重保序；表外/畸形静默丢弃；永不抛', () => {
  assert.deepEqual(sanitizePulse(['normal_interaction', 'rested', 'normal_interaction']), [
    'normal_interaction', 'rested',
  ])
  assert.deepEqual(sanitizePulse(['made_up_cause', 42, null]), [])
  assert.deepEqual(sanitizePulse('normal_interaction'), []) // 非 list → []
  assert.deepEqual(sanitizePulse({ 0: 'rested' }), [])
})

test('护栏原样继承：S-36 silence 永不降级 / S-37 候选表闸 / S-38/39 grounded 闸 + 清空 ids', () => {
  // silence 无 reason 无引用 —— 免辩护。
  const silent = parseEnvelope({
    content: JSON.stringify({ meaning_assessment: [], decision: { kind: 'silence', reason: '' } }),
  })
  assert.equal(silent.kind, 'silence')
  assert.equal(silent.demoted, false)
  // reason 未逐字引用 → demote reason_not_grounded → silence。
  const demoted = parseEnvelope({
    content: JSON.stringify({
      meaning_assessment: [{ item: '他问了一个问题', meaning: '他需要答案', pull: 0.5 }],
      decision: { kind: 'reply', content: '好', reason: '我就是想说' },
    }),
  })
  assert.equal(demoted.kind, 'silence')
  assert.equal(demoted.demoted, true)
  assert.equal(demoted.demote_why, 'reason_not_grounded')
  assert.equal(demoted.original_kind, 'reply')
  assert.deepEqual(demoted.grounded_concern_ids, [])
  // 候选表闸：kind 不在传入候选集 → kind_not_in_candidates。
  const offMenu = parseEnvelope(
    { content: envelope() },
    { candidates: CONVERSATION_CATALOGUE.filter((c) => c.kind !== 'reply') },
  )
  assert.equal(offMenu.demote_why, 'kind_not_in_candidates')
})

test('parseEnvelope 的 envelope 出参恰 2 键：{tool, pulse}（情绪脉冲改写）', () => {
  const decision = parseEnvelope({
    content: envelope({
      decision: {
        kind: 'tool_call',
        tool: { name: 'research_read_text', arguments: { url: 'https://a' } },
        reason: '他问我在不在',
      },
      情绪脉冲: ['normal_interaction', 'bogus'],
    }),
  })
  assert.deepEqual(Object.keys(decision.envelope).sort(), ['pulse', 'tool'])
  assert.deepEqual(decision.envelope.pulse, ['normal_interaction'])
  assert.deepEqual(decision.envelope.tool, {
    name: 'research_read_text', arguments: { url: 'https://a' },
  })
})

test('S-46 六归因逐条：not_json(首字符类别)/no_decision(三形态)/unknown_kind/missing_content', () => {
  assert.deepEqual([...FAILURE_REASONS].length, 6)
  const err = new Error('x')
  assert.deepEqual(classifyFailure(err, ''), [FAIL_NOT_JSON, 'first_char:empty'])
  // 注意：'```json\n{}' 会被两段式抽取救回成 {} —— 归因为 no_decision_object
  // （与活体同路）；fence 类别只在抽取整体失败时出现。
  assert.deepEqual(classifyFailure(err, '```\n她开口说话\n```'), [FAIL_NOT_JSON, 'first_char:fence'])
  assert.deepEqual(
    classifyFailure(err, '```json\n{}'),
    [FAIL_NO_DECISION_OBJECT, 'decision:missing'],
  )
  assert.deepEqual(classifyFailure(err, '{"trunc'), [FAIL_NOT_JSON, 'first_char:brace'])
  assert.deepEqual(classifyFailure(err, '好的，我来回答'), [FAIL_NOT_JSON, 'first_char:cjk'])
  assert.deepEqual(classifyFailure(err, 'Sure, here'), [FAIL_NOT_JSON, 'first_char:ascii_alpha'])
  assert.deepEqual(classifyFailure(err, '[1]'), [FAIL_NO_DECISION_OBJECT, 'top_level:not_object'])
  assert.deepEqual(classifyFailure(err, '{"a":1}'), [FAIL_NO_DECISION_OBJECT, 'decision:missing'])
  assert.deepEqual(
    classifyFailure(err, '{"decision": [1]}'),
    [FAIL_NO_DECISION_OBJECT, 'decision:type:list'],
  )
  assert.deepEqual(
    classifyFailure(err, '{"decision": {"kind": "REPLY"}}'),
    [FAIL_UNKNOWN_KIND, 'kind:REPLY'],
  )
  assert.deepEqual(
    classifyFailure(err, '{"decision": {"kind": "reply"}}'),
    [FAIL_MISSING_CONTENT, 'kind:reply:content:missing'],
  )
  assert.deepEqual(
    classifyFailure(err, '{"decision": {"kind": "reply", "content": "  "}}'),
    [FAIL_MISSING_CONTENT, 'kind:reply:content:blank'],
  )
})

test('S-47 隐私口径：kind 整值 ≤20 字才原样记，超长只记长度（不截断）；detail 永不带正文', () => {
  assert.equal(kindToken(null), 'missing')
  assert.equal(kindToken(42), 'type:int')
  assert.equal(kindToken('  '), 'blank')
  assert.equal(kindToken('promise_followup'), 'promise_followup') // 17 字合法带出
  const sentence = '好的我现在就去帮你查一下这个问题然后告诉你' // >20 字：正文不入账
  const token = kindToken(sentence)
  assert.equal(token, `unrecognized:len${[...sentence].length}`)
  assert.equal(token.includes('好的'), false)
})

test('firstCharClass 全类别 + classifyFailure 永不抛（归因器自坏 → classifier_error）', () => {
  assert.equal(firstCharClass('[1]'), 'bracket')
  assert.equal(firstCharClass('"x"'), 'quote')
  assert.equal(firstCharClass('42'), 'digit')
  assert.equal(firstCharClass('★'), 'other')
  assert.deepEqual(classifyFailure('not-an-error', 'x'), ['other', 'classifier_error'])
  // content 缺席 = 调用没回来 → other。
  assert.deepEqual(classifyFailure(new Error('boom'), null), ['other', 'none'])
})

test('回执背书真值表（宁漏勿误）：三条负向倾斜 + 命中形态', () => {
  const hit = annotateReceiptBacking('我查了赛程。都是新的。', { receiptAvailable: false })
  assert.equal(hit.has_action_claim, true)
  assert.equal(hit.matched_verb, '查了')
  assert.equal(hit.unbacked_claim, true)
  // 6 个必须为 False 的反例（意图/疑问/无完成标记/无动词/空/回执在场）。
  for (const [text, receipt] of [
    ['我要去搜索一下', false], //          意图标记"要"作废整句
    ['需不需要我截图看看吗', false], //     疑问"吗"
    ['我去搜一下', false], //              无完成标记
    ['这件事我记得很清楚了', false], //     无白名单动词
    ['', false],
    ['我查了赛程。', true], //             有回执 → unbacked=false
  ] as const) {
    const out = annotateReceiptBacking(text, { receiptAvailable: receipt })
    assert.equal(out.unbacked_claim, false, text)
  }
})

test('receiptsPresentInContext：成功回执/解析不出的 tool 消息 → true；全失败 → false', () => {
  const ok: ConverseMessage[] = [
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ success: true, data: {} }) },
  ]
  assert.equal(receiptsPresentInContext(ok), true)
  const failed: ConverseMessage[] = [
    { role: 'tool', tool_call_id: 'c1', content: JSON.stringify({ success: false }) },
  ]
  assert.equal(receiptsPresentInContext(failed), false)
  const unparsable: ConverseMessage[] = [
    { role: 'tool', tool_call_id: 'c1', content: 'not json' },
  ]
  assert.equal(receiptsPresentInContext(unparsable), true) // 宁可判 True
  assert.equal(receiptsPresentInContext([{ role: 'user', content: 'hi' }]), false)
})
