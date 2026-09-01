/**
 * `capability_gap`（WO-U2-SENSE-01）——对话路径这一半。
 *
 * 位点④（`TOOL_TO_ACTION` 未命中）是「她想做但没有」在新体最常走到的那一处：
 * 模型点了一个白名单外的工具名。位点①（kind 词表）经信封解析器共用
 * `lykoi-decide`，这里核的是 `source: 'converse'` 与 `run_id` 真的贯穿到了。
 *
 * 断言口径：事件名**精确相等**，不做子串匹配。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { envelope, lastEvent, makeConversation } from './fixture.ts'

/** **精确匹配**（全等，非子串）。 */
function gaps(
  events: readonly [string, Record<string, unknown>][],
): Record<string, unknown>[] {
  return events.filter(([n]) => n === 'capability_gap').map(([, f]) => f)
}

function toolEnvelope(name: string, args: Record<string, unknown> = {}): string {
  return envelope({
    decision: {
      kind: 'tool_call',
      tool: { name, arguments: args },
      reason: '他问我在不在', // 逐字引用 assessment.item → 接地（不走 demote 路）
    },
  })
}

test('位点④：表外工具名 → capability_gap(unknown_action, converse, run_id) + 原拒绝逐字节不变', async () => {
  const h = makeConversation()
  h.llm.push({ content: toolEnvelope('web_search', { q: 'x' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '查不了，我换个说法', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })

  // 原语义：cycle_unknown_tool 照落、error 结果照回填、周期照继续。
  assert.equal(reply, '查不了，我换个说法')
  assert.deepEqual(lastEvent(h.events, 'cycle_unknown_tool'), { name: 'web_search' })
  const toolResult = h.llm.calls[1]!.messages.find((m) => m.role === 'tool')!
  assert.deepEqual(JSON.parse(toolResult.content!), {
    success: false, error: "unknown tool 'web_search'",
  })
  // 旁路留痕。
  assert.deepEqual(gaps(h.events), [{
    wanted: 'web_search', source: 'converse', run_id: 'r1', reason: 'unknown_action',
  }])
  // 顺序：原账在前。
  const names = h.events.map(([n]) => n)
  assert.ok(
    names.indexOf('cycle_unknown_tool') < names.indexOf('capability_gap'),
    '原拒绝的账必须在旁路留痕之前',
  )
})

test('位点④隐私：超长工具名只落长度，参数与正文一个字都不进事件', async () => {
  const h = makeConversation()
  const longName = '请你帮我把这段话原封不动地发到那个群里去然后再订一张机票'
  h.llm.push({ content: toolEnvelope(longName, { url: 'https://secret.example/x' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '做不了', reason: '他问我在不在' } }) })
  await h.conversation.send('在吗', { runId: 'r2' })

  const gap = gaps(h.events)[0]!
  assert.equal(gap.wanted, `unrecognized:len${[...longName].length}`)
  assert.equal(gap.reason, 'unknown_action')
  assert.equal(JSON.stringify(gap).includes('机票'), false)
  assert.equal(JSON.stringify(gap).includes('secret.example'), false)
})

test('位点①经对话路径：未知 kind → capability_gap(unknown_kind, converse)；沉默收场语义不变', async () => {
  const h = makeConversation()
  h.llm.push({ content: JSON.stringify({ decision: { kind: 'REPLY', content: 'x' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r3' })

  // 原语义（D-01 边界）：unknown_kind 不重试、降级沉默、u3_cycle_failed 照落。
  assert.equal(reply, '')
  assert.equal(h.llm.calls.length, 1)
  assert.equal(lastEvent(h.events, 'u3_cycle_failed')!.reason, 'unknown_kind')
  assert.deepEqual(gaps(h.events), [{
    wanted: 'REPLY', source: 'converse', run_id: 'r3', reason: 'unknown_kind',
  }])
})

test('对照组：合法工具名（表内、接地）→ **零** capability_gap —— 派发失败不是能力缺口', async () => {
  const h = makeConversation()
  h.llm.push({ content: toolEnvelope('research_read_text', { url: 'https://a' }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '通道还没长出来', reason: '他问我在不在' } }) })
  await h.conversation.send('在吗', { runId: 'r4' })

  // dispatch 未接线 → 结果 success=false；但那是**器官没接通**，不是「不被承认」。
  const toolResult = h.llm.calls[1]!.messages.find((m) => m.role === 'tool')!
  assert.equal(JSON.parse(toolResult.content!).success, false)
  assert.deepEqual(gaps(h.events), [])
})

test('对照组：普通 reply 回合 → 零 capability_gap（安静路上不许有噪声）', async () => {
  const h = makeConversation()
  h.llm.push({ content: envelope({ 情绪脉冲: ['normal_interaction'] }) })
  await h.conversation.send('在吗', { runId: 'r5' })
  assert.deepEqual(gaps(h.events), [])
})
