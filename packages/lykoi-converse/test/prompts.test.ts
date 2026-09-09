import assert from 'node:assert/strict'
import test from 'node:test'
import {

  ASK_FALLBACK, SYSTEM_PROMPT,

  envelopeSystemPrompt, envelopeToolNames,
  DELEGATED_ASK_FIELDS,
  renderSystemPrompt, TOOL_TO_ACTION, renderToolTable, buildEnvelopeMessages,
} from '../src/index.ts'

test('渲染代入：{causes} = 15 名排序 join（sha ad676bb0…）；{tools} = 工具表（名字 + 签名 + 用途）', () => {
  const rendered = envelopeSystemPrompt()
  assert.equal(rendered.includes('{causes}'), false)
  assert.equal(rendered.includes('{tools}'), false)
  const causes = 'action_taken, concern_lit_unfollowed, contact_answered, contact_unanswered, '
    + 'experience_backlog, experience_recorded, explore_completed, integration_completed, '
    + 'integration_digested, narrative_conflict, normal_interaction, owner_silence_anomaly, '
    + 'rested, suspension_overdue, suspension_resolved'
  assert.ok(rendered.includes(causes))
  // D-02①：白名单从同一真相源派生（sorted TOOL_TO_ACTION + vision/followup/progress 恰 13 项）。
  const tools = envelopeToolNames()
  assert.equal(tools.length, 13)
  assert.deepEqual(tools.slice(-3), ['vision_describe', 'promise_followup', 'post_progress'])
  // WO-FIX-TOOLSPEC-01 D-2：代入的不再是裸名 join，而是逐行的表；13 行同序。
  assert.ok(rendered.includes(renderToolTable().split('\n').join('\n  ')))
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
  assert.ok(SYSTEM_PROMPT.includes('会请求确认的只剩输入（browser_type）和终端（terminal_exec）'))
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

test('E4-3：信封装配保留用户原文中的模板字符', async () => {
  const { FIXTURE_PERSONA } = await import('./fixture.ts')
  const raw = '请逐字保留 {owner}、{owner_name}、{self} 和 Kevin'
  const messages = buildEnvelopeMessages([{ role: 'user', content: raw }], undefined, FIXTURE_PERSONA)
  assert.equal(messages.find(m => m.role === 'user')!.content, raw)
  assert.ok(messages.some(m => m.role === 'system' && m.content?.includes('Owner')))
  assert.ok(messages.filter(m => m.role === 'system').every(m => !/\{owner\}|Kevin|Lykoi/.test(m.content ?? '')))
})

test('approval clarification exposes no internal HTTP endpoint', () => {
  assert.ok(!ASK_FALLBACK.includes('/approvals'))
  assert.ok(!ASK_FALLBACK.toUpperCase().includes('POST'))
})
