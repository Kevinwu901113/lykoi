import test from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { MindStore } from 'lykoi-runtime/mind'
import { makeConversation, makeStore, T0 } from './fixture.ts'

test('conversation commits contextual feedback to the same Mind later read by Wake; legacy inner no longer writes', async () => {
  const prepared = makeStore(), mind = new MindStore(join(dirname(prepared.path), 'mind.sqlite'), () => T0)
  let calls = 0
  const h = makeConversation({ prepared, mind, llm: async messages => {
    calls++
    const text = messages.map(m => m.content).join('\n')
    if (calls === 2) assert.ok(text.includes('普通产品小更新不主动通知'))
    return { content: JSON.stringify({ decision: { kind: 'reply', content: calls === 1 ? '记住了。' : '先给你结论。' },
      inner: { thoughts: [{ content: '旧通道不应创建重复记录', kind: 'question' }], resolve: [] },
      ...(calls === 1 ? { mind: { records: [{ id: 'contact-scope', revision: 0, kind: 'preference', topic: '主动联系范围', understanding: '普通产品小更新不主动通知',
        open: '', evidence: ['conversation:feedback:1'], links: [], status: 'open', reconsiderAt: null, basis: 'explicit', scope: 'Agent 产品新闻；仍关心持续认知' }], acknowledge: ['conversation:feedback:1'] } } : {}),
    }) }
  } })
  try {
    mind.receive({ id: 'conversation:feedback:1', source: 'user', reference: 'turn:1', content: '这种小更新不用特意说', createdAt: T0.toISOString() })
    assert.equal(await h.conversation.send('这种小更新不用特意说', { turnId: 'feedback:1' }), '记住了。')
    assert.equal(mind.view().records[0]!.basis, 'explicit')
    assert.equal(mind.view().events.length, 0)
    assert.equal(h.store.openThoughts().length, 0)
    assert.equal(await h.conversation.send('继续上次的问题'), '先给你结论。')
    assert.equal(mind.view().records[0]!.revision, 1)
  } finally { h.store.close(); mind.close() }
})
