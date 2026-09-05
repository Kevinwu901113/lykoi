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
  renderSystemPrompt, TOOL_TO_ACTION, renderToolTable, buildEnvelopeMessages,
  SELF_STATE_TEMPLATE,
} from '../src/index.ts'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

function cps(text: string): number {
  return [...text].length
}

test('§3.2 A 表：系统提示词逐字（chars + sha256 全等）', () => {
  // WO-FIX-TOOLSPEC-01 D-3：逐工具散文行 + notify_owner 两句 + query 句删除后
  // 的新钉（旧 1418 / 72a3c1c1… → 新 891 / 075d4282…）。
  assert.equal(cps(SYSTEM_PROMPT), 891)
  assert.equal(sha(SYSTEM_PROMPT), '075d4282f604f93dc74f9caf6d4a5963d65e449cdd49daf8206975606dc1bc17')
  assert.equal(cps(SUMMARIZE_SYSTEM_PROMPT), 142)
  assert.equal(sha(SUMMARIZE_SYSTEM_PROMPT), '3eb2679bd75cfd812bbbf0ffaf1156d284c771f0e1e59dac2daa40173ee32759')
  assert.equal(cps(CYCLE_CLOSING_NOTE), 92)
  assert.equal(sha(CYCLE_CLOSING_NOTE), '575ffe30c167b2e111789deee1a4702ffe93bc0384e381ff9d78b35eaf06a36a')
})

test('§3.2 B 表：装配块头部/骨架字面量逐字（15 条 sha 全等）', () => {
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
    // WO-PULSE-01（D-1）：本单唯一新增的提示词面（self_state 块骨架）。
    [SELF_STATE_TEMPLATE, 29, '936c4350d8d5f1a3c81af9e12bf454c72d576e3da1a7f5247dc8b2ad8f0888f3'],
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
  // 渲染后（causes+tools 已代入）：旧 1960/739494ec… → G-10 2245/f063714f… →
  // WO-FIX-TOOLSPEC-01 D-2（{tools} 从裸名 join 变成带签名与用途的表）
  // 2984/29f13777…。契约文本变了 = 稳定前缀缓存失效一次，属预期。
  assert.equal(cps(envelopeSystemPrompt()), 2984)
  assert.equal(
    sha(envelopeSystemPrompt()),
    '29f1377755b5890c14ab151f269ecb55a97e749e0fbe401546da30538786988f',
  )
})

test('渲染代入：{causes} = 15 名排序 join（sha ad676bb0…）；{tools} = 工具表（名字 + 签名 + 用途）', () => {
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
  // WO-FIX-TOOLSPEC-01 D-2：代入的不再是裸名 join，而是逐行的表；13 行同序。
  assert.ok(rendered.includes(renderToolTable().split('\n').join('\n  ')))
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

// --- WO-FIX-TOOLSTEP-01 D-3a/D-3b：白名单按接线过滤（不给 wiredActions 时零漂移） ---

/** 生产装配面的实际接线集（order.md 给定，wake/converse 两侧同一份）。 */
const PROD_WIRED = new Set([
  'terminal.exec', 'browser.navigate', 'browser.get_text',
  'research_browser.read_text', 'notify.owner',
])

test('D-3a：不给 wiredActions → envelopeToolNames/envelopeSystemPrompt 逐字节不变（既有 pin 就是回归线）', () => {
  assert.deepEqual(envelopeToolNames(undefined), envelopeToolNames())
  assert.equal(envelopeSystemPrompt(undefined), envelopeSystemPrompt())
  // 全接线（TOOL_TO_ACTION 的整张映射值集）等价于不给——两条路殊途同归。
  const fullWired = new Set(Object.values(TOOL_TO_ACTION))
  assert.deepEqual(envelopeToolNames(fullWired), envelopeToolNames())
})

test('D-3a：envelopeToolNames(生产接线集) 恰为 order.md 给定的那 8 项（5 个白名单工具 + 3 个恒在的 in-cognition 工具）', () => {
  const tools = envelopeToolNames(PROD_WIRED)
  assert.deepEqual(tools, [
    'browser_get_text', 'browser_navigate', 'notify_owner', 'research_read_text', 'terminal_exec',
    'vision_describe', 'promise_followup', 'post_progress',
  ])
  // 未接线的工具名一个都不许出现（research_open/research_extract_links/
  // browser_click/browser_type/browser_screenshot 全部被过滤掉）。
  for (const gone of [
    'research_open', 'research_extract_links', 'browser_click', 'browser_type', 'browser_screenshot',
  ]) {
    assert.ok(!tools.includes(gone), `${gone} 不该出现在生产接线集的过滤结果里`)
  }
})

test('D-3a：buildEnvelopeMessages 把 wiredActions 一路传到系统提示词里的 {tools} 代入（不是只在 envelopeToolNames 单元里生效）', () => {
  const messages = buildEnvelopeMessages([], PROD_WIRED)
  const system = messages.find((m) => m.role === 'system')!
  assert.ok(system.content!.includes('research_read_text'))
  assert.ok(!system.content!.includes('research_open'))
  assert.ok(!system.content!.includes('browser_type'))
})

test('D-3b：renderSystemPrompt() 与 renderSystemPrompt(全接线) 都恒等于 SYSTEM_PROMPT（=== 而不只是 deepEqual —— 老版消费者零感知）', () => {
  assert.equal(renderSystemPrompt(undefined), SYSTEM_PROMPT)
  const fullWired = new Set(Object.values(TOOL_TO_ACTION))
  assert.equal(renderSystemPrompt(fullWired), SYSTEM_PROMPT)
})

test('TOOLSPEC D-3：SYSTEM_PROMPT 里工具枚举行没了 → renderSystemPrompt 对任何接线集都恒等于原文', () => {
  // D-3 把逐工具散文行删了，接线过滤只剩契约 {tools} 那一处。D-3b 的过滤器
  // 因此没有作用对象——空集这种最狠的入参也一行都删不掉。
  assert.equal(renderSystemPrompt(PROD_WIRED), SYSTEM_PROMPT)
  assert.equal(renderSystemPrompt(new Set()), SYSTEM_PROMPT)
})

test('TOOLSPEC D-3：逐工具散文与 query 句都不在了，保留的两句还在（工具描述只剩契约那一处）', () => {
  for (const gone of [
    'research_open', 'research_read_text', 'research_extract_links',
    'browser_navigate', 'browser_click', 'browser_screenshot', 'browser_get_text',
    'vision_describe', 'notify_owner', 'query',
  ]) {
    assert.ok(!SYSTEM_PROMPT.includes(gone), `${gone} 不该再出现在 SYSTEM_PROMPT 里`)
  }
  // 保留项：审批语义那句仍点名 browser_type / terminal_exec（它讲的是审批分级，
  // 不是工具描述）；虚拟电脑一句与结构化来源一句原样留着。
  assert.ok(SYSTEM_PROMPT.includes('会找他确认的只剩输入（browser_type）和终端（terminal_exec）'))
  assert.ok(SYSTEM_PROMPT.includes('你有一台自己的虚拟电脑'))
  assert.ok(SYSTEM_PROMPT.includes('优先找结构化来源'))
  assert.ok(SYSTEM_PROMPT.includes('自己换检索词重搜'))
})

// --- WO-FIX-TOOLSPEC-01 D-4：工具表渲染进契约（表本身的投影不变量在 contract.test.ts） ---

test('D-2：{tools} 每行都是 name(签名) — 用途；notify_owner 那行带 content 且写明与 reply 的分工', () => {
  const rendered = envelopeSystemPrompt()
  const lines = renderToolTable().split('\n')
  assert.equal(lines.length, 13)
  for (const line of lines) {
    assert.match(line, /^[a-z_]+\(.*\) — .+$/, `工具行形状不对：${line}`)
    assert.ok(rendered.includes(line), `渲染后的契约里缺这一行：${line}`)
  }
  const notify = lines.find((l) => l.startsWith('notify_owner'))!
  assert.ok(notify.includes('(content)'), 'notify_owner 的参数名必须写出来（她猜错过）')
  assert.ok(notify.includes('reply'), 'notify_owner 与 reply 的分工必须写在用途里')
  // research_read_text 只收 url：旧散文里的 query 参数在表里没有对应物。
  const research = lines.find((l) => l.startsWith('research_read_text'))!
  assert.ok(research.includes('(url, max_chars?)'))
  assert.ok(!research.includes('query('))
})

test('D-2：给了 wiredActions → 未接线工具整行不出现；三个 in-cognition 工具恒在', () => {
  const lines = renderToolTable(PROD_WIRED).split('\n')
  assert.deepEqual(lines.map((l) => l.slice(0, l.indexOf('('))), [
    'browser_get_text', 'browser_navigate', 'notify_owner', 'research_read_text', 'terminal_exec',
    'vision_describe', 'promise_followup', 'post_progress',
  ])
  const text = lines.join('\n')
  for (const gone of [
    'research_open', 'research_extract_links', 'browser_click', 'browser_type', 'browser_screenshot',
  ]) {
    assert.ok(!text.includes(gone), `${gone} 未接线，不该出现在她能点名的表里`)
  }
  // 空接线集：dispatch 那 10 项一个不剩，in-cognition 三项照旧在（不受这道闸管）。
  const none = renderToolTable(new Set()).split('\n')
  assert.equal(none.length, 3)
  assert.deepEqual(none.map((l) => l.slice(0, l.indexOf('('))), [
    'vision_describe', 'promise_followup', 'post_progress',
  ])
})
