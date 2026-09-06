/** A3：真 dsh runtime + vendored DeepSeek HTTP/SSE，零外网。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as deepseek from '../src/index.ts'

test('A3：signal 取消真 SSE body，runtime 返回 aborted 且服务器观察到连接关闭', { timeout: 5000 }, async t => {
  const keyEnv = 'LYKOI_SCHED_TEST_FAKE_KEY'
  process.env[keyEnv] = 'synthetic-test-key'
  t.after(() => { delete process.env[keyEnv] })
  let close!: () => void
  const closed = new Promise<void>(resolve => { close = resolve })
  const server = createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.on('close', close)
      res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'first' }, finish_reason: null }] }) + '\n\n')
      // 故意不 end，取消必须切断这条真实 body read。
    })
  })
  t.after(() => { server.closeAllConnections(); server.close() })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const ctx = new Context()
  const runtime = await ctx.plugin(LlmRuntime)
  const adapter = await ctx.plugin(deepseek, { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKeyEnv: keyEnv })
  t.after(async () => { await adapter.dispose(); await runtime.dispose() })
  const controller = new AbortController()
  let text = '', finish = ''
  for await (const chunk of ctx.llm.stream({
    provider: 'deepseek-official', model: 'deepseek-v4-flash', signal: controller.signal,
    messages: [createUserMessage({ content: [{ type: 'text', text: 'synthetic cancellation probe' }], source: { kind: 'user' } })],
  })) {
    if (chunk.type === 'text-delta') { text += chunk.text; controller.abort(new Error('revision')) }
    if (chunk.type === 'finish') finish = chunk.reason.kind
  }
  assert.equal(text, 'first')
  assert.equal(finish, 'aborted')
  await closed
})
