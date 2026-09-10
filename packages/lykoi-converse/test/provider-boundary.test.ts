import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { apply, type LykoiGenerateOptions } from 'lykoi-llm'
import { envelope, makeConversation } from './fixture.ts'

test('provider recovery inside an ongoing tool cycle does not replay dispatch or mutate conversation history', async () => {
  const ctx = new Context()
  const providerRequests: LykoiGenerateOptions[] = []
  const charges: unknown[] = []
  const replies = [envelope({ decision: { kind: 'tool_call', reason: '需要查一下',
    tool: { name: 'research_browser.read_text', arguments: { url: 'https://example.org' } } } }),
  '', envelope({ decision: { kind: 'reply', content: '查完了', reason: '得到结果' } })]
  ctx.provide('budget', {
    async gate() {}, async charge(row) { charges.push(row) },
    usage() { return { day: '', totalTokens: 0, routeTokens: 0 } },
  })
  ctx.provide('llm', { async *stream(options: LykoiGenerateOptions) {
    providerRequests.push(options)
    yield { type: 'text-delta', text: replies.shift() }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } as unknown as Context['llm'])
  apply(ctx)
  let dispatches = 0
  const h = makeConversation({
    llm: async (messages, options) => {
      const result = await ctx.lykoiLlm.call({ provider: 'test', model: 'test',
        responseFormat: options.responseFormat ?? undefined,
        signal: options.signal,
        messages: messages.map(m => createUserMessage({ content: [{ type: 'text', text: m.content ?? '' }], source: { kind: 'user' } })),
      }, { runId: options.runId! })
      return { content: result.text }
    },
    dispatchFn: async () => { dispatches++; return { success: true, data: { text: '查到结果' } } },
  })
  try {
    assert.equal(await h.conversation.send('请查看', { runId: 'provider-cycle' }), '查完了')
    assert.equal(dispatches, 1)
    assert.equal(providerRequests.length, 3)
    assert.equal(charges.length, 3)
    assert.equal(h.events.filter(([name]) => name === 'u3_cycle_envelope').length, 2)
    assert.equal(h.events.filter(([name]) => name === 'u3_cycle_failed').length, 0)
    replies.push(envelope({ decision: { kind: 'reply', content: '继续聊', reason: '继续对话' } }))
    assert.equal(await h.conversation.send('继续', { runId: 'next-turn' }), '继续聊')
    assert.equal(JSON.stringify(providerRequests[3]!.messages).includes('你上一次的输出'), false)
    assert.equal(dispatches, 1)
  } finally { h.store.close() }
})
