/**
 * prompt/模板 sha256 逐字对拍（SPEC-CONV §3.2 表 + SPEC-MIND §6.6）。
 * ENVELOPE_SYSTEM_PROMPT 是唯一"修正版"文本（G-10 D-02①/D-03 两处出生修正）：
 * 以**反向恢复**钉住"其余逐字"——把两处修正换回活体原文后 sha 必须等于旧值。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  BACKFILL_HEADER, CONCERNS_HEADER, CONTEXT_BUDGET_SKELETON, CYCLE_CLOSING_NOTE,
  ENVELOPE_SYSTEM_PROMPT, MEMORIES_HEADER, MEMORIES_LINE_SKELETON, NARRATIVE_HEADER,
  PROMOTED_INSIGHTS_HEADER, RELATIONSHIP_OVERLAY_HEADER,
  SUMMARIZE_SYSTEM_PROMPT, SUMMARY_SKELETON, SYSTEM_PROMPT,
  THOUGHTS_HEADER, THOUGHTS_LINE_SKELETON, TIME_SKELETON, UNDELIVERED_HEADER,
  UNDELIVERED_LINE_SKELETON, envelopeSystemPrompt, envelopeToolNames,
  ASK_FALLBACK, DELEGATED_ASK_FIELDS,
} from '../src/index.ts'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function cps(text: string): number {
  return [...text].length
}

test('§3.2 A 表：系统提示词逐字（chars + sha256 全等）', () => {
  assert.equal(cps(SYSTEM_PROMPT), 1418)
  assert.equal(sha(SYSTEM_PROMPT), '72a3c1c128b63def708fdd5fedd89792098b821071662e164f511bc7e6a81314')
  assert.equal(cps(SUMMARIZE_SYSTEM_PROMPT), 142)
  assert.equal(sha(SUMMARIZE_SYSTEM_PROMPT), '3eb2679bd75cfd812bbbf0ffaf1156d284c771f0e1e59dac2daa40173ee32759')
  assert.equal(cps(CYCLE_CLOSING_NOTE), 92)
  assert.equal(sha(CYCLE_CLOSING_NOTE), '575ffe30c167b2e111789deee1a4702ffe93bc0384e381ff9d78b35eaf06a36a')
})

test('§3.2 B 表：装配块头部/骨架字面量逐字（14 条 sha 全等）', () => {
  const table: [string, number, string][] = [
    [PROMOTED_INSIGHTS_HEADER, 27, '48ddd6b81fdb4d597f65cdd658202667b1d7ef052945f6e20f20ced6df76ab29'],
    [BACKFILL_HEADER, 35, 'fbd7132d2046bca9c4f2f12fb33dc59347ef21876782e4de01a6ad23e6bf4777'],
    [NARRATIVE_HEADER, 19, '3f62912463bc2f068cc34540cf3f137263f64061d6474ed4c79fa5a22702a019'],
    [SUMMARY_SKELETON, 11, '598fe6863b6c3315a7b3329f8897f53b5c968f1cf1e2c63fc4b50f9650d7ec64'],
    [CONCERNS_HEADER, 49, 'f65c29624e876c058691b8de306a6c705e1af92eddb1cc96e2fc5a560928df19'],
    [THOUGHTS_HEADER, 35, 'e8cc247f6b0e1d896966bb9fe44d0b9be0a1483c230cb72958d912299c29ec89'],
    [THOUGHTS_LINE_SKELETON, 27, 'a58edd000e6e5edc99652bd9dddb28fb06587b51c859080b5940e7ff3e4e9399'],
    [TIME_SKELETON, 20, 'f2ed3e8081dacf51419c20138314fd1652bf5e30e2fdd8fdd1db51d7eb45673f'],
    [MEMORIES_HEADER, 86, '35f74e70ba5449e0039a748da6b492e5c92404cbed5de2ab1154af0c4e03bcfa'],
    [MEMORIES_LINE_SKELETON, 13, '9a37c2b5ae1d546276356cd76a7cfd2d58bd89eb0afba870ec4c082f48caef9f'],
    [UNDELIVERED_HEADER, 68, '658c95ff5e9b49d65e43a54b4ae37e60bbdccfe0ad60b1b215d1233edd55c360'],
    [UNDELIVERED_LINE_SKELETON, 11, '80e0c2ec4f0cbc683f3cf139290de769010b731fb6d4aca193cb56750a1dbf5a'],
    [CONTEXT_BUDGET_SKELETON, 33, '584ca3b4ec76336911cd041626bf185889dcc27c820fb4a2b8941e7f2b2f2ead'],
    // WO-PERS-OVERLAY-01（D-5）：本单唯一新增的提示词面。
    [RELATIONSHIP_OVERLAY_HEADER, 38,
      'a0553be7100bd34013ac54ac67b11e3628beb5d0b3e48c3f5f9ac2b2b674c22e'],
  ]
  for (const [text, chars, expected] of table) {
    assert.equal(cps(text), chars, `chars mismatch for ${expected.slice(0, 8)}`)
    assert.equal(sha(text), expected)
  }
})

// G-10 出生修正的两处（本测试持活体原文；生产文件持修正版 —— 单一真相不受扰）。
const LIVE_GROUNDING_BULLET
  = '- decision.reason 必须逐字引用(原样复制)meaning_assessment 里至少一条的 item\n'
  + '  或 meaning 文本 —— 不引用任何评估条目的非 silence 决定会被确定性地降级为\n'
  + '  silence。\n'
const AMENDED_GROUNDING_BULLET
  = '- decision.reason 必须逐字引用(原样复制)meaning_assessment 里至少一条的 item\n'
  + '  或 meaning 文本 —— 不引用任何评估条目的非 silence 决定会被确定性地降级为\n'
  + '  silence。被降级的 tool_call 不会执行那个工具。\n'
const LIVE_TOOL_CALL_BULLET
  = '- tool_call: 需要 tool.name 与 tool.arguments。工具照旧分级 —— 需要他点头的\n'
  + '  工具不会因为你同时说了话就免了。\n'
const AMENDED_TOOL_CALL_BULLET
  = '- tool_call: 需要 tool.name 与 tool.arguments。tool.name 只能取下面这张表里的\n'
  + '  名字(表外的名字不会执行):\n'
  + '  {tools}\n'
  + '  工具照旧分级 —— 需要他点头的工具不会因为你同时说了话就免了。\n'

test('G-10 修正版信封契约：反向恢复两处修正后 sha == 活体 raw（9d4f169e…, 1677）——其余逐字', () => {
  assert.ok(ENVELOPE_SYSTEM_PROMPT.includes(AMENDED_GROUNDING_BULLET), 'D-03 修正在位')
  assert.ok(ENVELOPE_SYSTEM_PROMPT.includes(AMENDED_TOOL_CALL_BULLET), 'D-02① 修正在位')
  const reverted = ENVELOPE_SYSTEM_PROMPT
    .replace(AMENDED_GROUNDING_BULLET, LIVE_GROUNDING_BULLET)
    .replace(AMENDED_TOOL_CALL_BULLET, LIVE_TOOL_CALL_BULLET)
  assert.equal(cps(reverted), 1677)
  assert.equal(sha(reverted), '9d4f169eb3ea368be6cf46e44445fc0ea943a4d7052a3c03744ea63bdf869eb7')
})

test('新 raw sha 记录（旧 9d4f169e… → 新；随 G-2 sha 变更表同一体例入报告/追认清单）', () => {
  // 实算钉死：任何后续改动都会让这两行变红 —— 修正版文本从此就是契约。
  // 旧（活体 raw）：chars=1677 sha=9d4f169eb3ea368be6cf46e44445fc0ea943a4d7052a3c03744ea63bdf869eb7
  // 新（G-10 D-02①/D-03）：chars=1748 sha=88587c8e…（{causes}/{tools} 未展开口径）
  assert.equal(cps(ENVELOPE_SYSTEM_PROMPT), 1748)
  assert.equal(
    sha(ENVELOPE_SYSTEM_PROMPT),
    '88587c8e3d923969d16a92e4cb996b6d45d5e2e077ac7af00ff016a39c0be14a',
  )
  // 渲染后（causes+tools 已代入）：旧 1960/739494ec… → 新 2245/f063714f…。
  assert.equal(cps(envelopeSystemPrompt()), 2245)
  assert.equal(
    sha(envelopeSystemPrompt()),
    'f063714f530496695ee1a2fc95dd952b2f64e2d195312dacf99e0808d5ff80ee',
  )
})

test('渲染代入：{causes} = 15 名排序 join（sha ad676bb0…）；{tools} = TOOL_TO_ACTION 投影 + 三 in-cognition', () => {
  const rendered = envelopeSystemPrompt()
  assert.equal(rendered.includes('{causes}'), false)
  assert.equal(rendered.includes('{tools}'), false)
  const causes = 'action_taken, concern_lit_unfollowed, contact_answered, contact_unanswered, '
    + 'experience_backlog, experience_recorded, explore_completed, integration_completed, '
    + 'integration_digested, narrative_conflict, normal_interaction, owner_silence_anomaly, '
    + 'rested, suspension_overdue, suspension_resolved'
  assert.equal(sha(causes), 'ad676bb093c8ba1751040677f7543f01cef3d1c10abb8dadc6626a84316d1929')
  assert.ok(rendered.includes(causes))
  // D-02①：白名单从同一真相源派生（sorted TOOL_TO_ACTION + vision/followup/progress 恰 13 项）。
  const tools = envelopeToolNames()
  assert.equal(tools.length, 13)
  assert.deepEqual(tools.slice(-3), ['vision_describe', 'promise_followup', 'post_progress'])
  assert.ok(rendered.includes(tools.join(', ')))
})

test('§2 D 段（M3-W2 迁入）：ASK_FALLBACK 逐字 —— 15 字 / sha 66b17e24…', () => {
  // WO-FIX-APPROVAL-UX ② 老横幅退役的那句话，随审批器官从 cognition/
  // conversation.py:428 迁入本包。SPEC-KERNEL §2 D 段的复核值一位不差。
  assert.equal(cps(ASK_FALLBACK), 15)
  assert.equal(sha(ASK_FALLBACK), '66b17e244f974f0b8941b741a66d6990ec6a81cef9817b582a0cf63a8eaccd56')
  // 它是"一条问句都问不出去"时才说的那句 —— 里面永不带端点（横幅退役的全部理由）。
  assert.ok(!ASK_FALLBACK.includes('/approvals'))
  assert.ok(!ASK_FALLBACK.toUpperCase().includes('POST'))
})

test('SK-77：DELEGATED_ASK_FIELDS 恰四项，入站 message_id 不在其中（E2 分层）', () => {
  assert.deepEqual([...DELEGATED_ASK_FIELDS], ['action_type', 'params', 'action_id', 'correlation_id'])
  assert.equal(DELEGATED_ASK_FIELDS.length, 4)
  assert.ok(!(DELEGATED_ASK_FIELDS as readonly string[]).includes('message_id'))
  assert.ok(!(DELEGATED_ASK_FIELDS as readonly string[]).includes('reply_to'))
  assert.ok(!(DELEGATED_ASK_FIELDS as readonly string[]).includes('context_id'))
})
