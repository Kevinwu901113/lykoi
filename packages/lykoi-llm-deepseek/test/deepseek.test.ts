/**
 * 交付①测试：本地 mock HTTP server 模拟 DeepSeek SSE。
 * - 全程零真实外网（server 绑 127.0.0.1 临时端口）、零真实 key（假 key 只存在于
 *   测试进程 env，形态走 apiKeyEnv 环境引用——凭据永不落明文/入库）。
 * - 核心断言（CF-B6）：出站请求头不含任何 x-deepseek-harness-* 头，
 *   即便调用方显式给了 sessionId；UA 归因头保留。
 * - 场景：正常流（含 usage chunk）与空 content 流。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  createUserMessage,
  type GenerateOptions,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import * as deepseek from '../src/index.ts'

/** 假 key 的 env 引用名。值是显然的占位串，不是任何真实凭据。 */
const KEY_ENV = 'LYKOI_TEST_FAKE_DEEPSEEK_KEY'
const FAKE_KEY = 'test-not-a-real-key-0000'

interface CapturedRequest {
  headers: IncomingHttpHeaders
  url: string
  body: string
}

/** 一次性 mock DeepSeek：POST /chat/completions → 预置 SSE 载荷；记录入站请求。 */
async function startMockDeepSeek(ssePayloads: string[]): Promise<{
  server: Server
  baseURL: string
  requests: CapturedRequest[]
}> {
  const requests: CapturedRequest[] = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      requests.push({ headers: req.headers, url: req.url ?? '', body })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      for (const payload of ssePayloads) res.write(`data: ${payload}\n\n`)
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, baseURL: `http://127.0.0.1:${port}`, requests }
}

async function setupAdapter(baseURL: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(LlmRuntime)
  // 形态照上游：apply 注册 deepseek-official 路由；无 credentials 服务时
  // 凭据回落信任环境层（launchEnvironmentOf → process.env[apiKeyEnv]）。
  await ctx.plugin(deepseek, { baseURL, apiKeyEnv: KEY_ENV })
  return ctx
}

function request(text: string, sessionId?: string): GenerateOptions {
  return {
    provider: 'deepseek-official',
    model: 'deepseek-v4-flash',
    messages: [
      createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }),
    ],
    // 上游会把 sessionId 写进 x-deepseek-harness-session-id；剥头版必须无视它。
    ...(sessionId === undefined
      ? {}
      : { sessionId: sessionId as unknown as GenerateOptions['sessionId'] }),
  }
}

async function consume(ctx: Context, options: GenerateOptions): Promise<{
  text: string
  usage?: { inputTokens: number; outputTokens: number }
  finishKind?: string
  failureMessage?: string
  textDeltas: number
}> {
  let text = ''
  let usage: { inputTokens: number; outputTokens: number } | undefined
  let finishKind: string | undefined
  let failureMessage: string | undefined
  let textDeltas = 0
  for await (const chunk of ctx.llm.stream(options) as AsyncIterable<StreamChunk>) {
    if (chunk.type === 'text-delta') {
      text += chunk.text
      textDeltas += 1
    } else if (chunk.type === 'usage') {
      usage = { inputTokens: chunk.usage.inputTokens, outputTokens: chunk.usage.outputTokens }
    } else if (chunk.type === 'finish') {
      finishKind = chunk.reason.kind
      if (chunk.reason.kind === 'error') failureMessage = chunk.reason.failure.message
    }
  }
  return {
    text,
    ...(usage ? { usage } : {}),
    ...(finishKind ? { finishKind } : {}),
    ...(failureMessage ? { failureMessage } : {}),
    textDeltas,
  }
}

test('CF-B6 正常流：SSE 正文+usage 走通，出站头无任何 x-deepseek-harness-*（sessionId 给了也剥）', async (t) => {
  process.env[KEY_ENV] = FAKE_KEY
  t.after(() => delete process.env[KEY_ENV])
  const { server, baseURL, requests } = await startMockDeepSeek([
    JSON.stringify({ choices: [{ index: 0, delta: { content: '她收' } }] }),
    JSON.stringify({ choices: [{ index: 0, delta: { content: '到了' } }] }),
    JSON.stringify({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }),
    '[DONE]',
  ])
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  const ctx = await setupAdapter(baseURL)
  const result = await consume(ctx, request('管线证明', 'sess-0001'))

  assert.equal(result.text, '她收到了')
  assert.equal(result.usage?.inputTokens, 10, 'prompt_tokens（无 cache 命中）→ inputTokens')
  assert.equal(result.usage?.outputTokens, 5)
  assert.equal(result.finishKind, 'stop')

  assert.equal(requests.length, 1)
  const captured = requests[0]!
  assert.equal(captured.url, '/chat/completions')
  // ★ CF-B6 核心断言：不含任何 x-deepseek-harness-* 头（node http 头名已小写化）。
  const harnessHeaders = Object.keys(captured.headers).filter((h) =>
    h.startsWith('x-deepseek-harness-'))
  assert.deepEqual(harnessHeaders, [], `出站请求带了 harness 头: ${harnessHeaders.join(',')}`)
  // UA 归因头按 CF-B6 保留（attributionHeaders 原样）。
  assert.match(String(captured.headers['user-agent']), /^deepseek-harness\//)
  // 凭据经 env 引用解析进 authorization，不经任何 harness 头。
  assert.equal(captured.headers['authorization'], `Bearer ${FAKE_KEY}`)
  // 请求体里也不得夹带假名（防止头被挪进 body 的回归）。
  assert.ok(!captured.body.includes('harness-user-id'))
})

test('CF-B6 空 content 流：零 text-delta，终止 finish 归为 error（EMPTY_RESPONSE 语义原样保留）', async (t) => {
  process.env[KEY_ENV] = FAKE_KEY
  t.after(() => delete process.env[KEY_ENV])
  const { server, baseURL, requests } = await startMockDeepSeek(['[DONE]'])
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  const ctx = await setupAdapter(baseURL)
  const result = await consume(ctx, request('空回應场景'))

  assert.equal(result.textDeltas, 0)
  assert.equal(result.text, '')
  assert.equal(result.usage, undefined)
  // 上游语义：completed response with no content → finish {kind:'error'}；剥头不改此语义。
  assert.equal(result.finishKind, 'error')
  // 空 content 场景同样不带 harness 头。
  const harnessHeaders = Object.keys(requests[0]!.headers).filter((h) =>
    h.startsWith('x-deepseek-harness-'))
  assert.deepEqual(harnessHeaders, [])
})

test('凭据纪律：env 引用缺席时拒调（MISSING_CREDENTIAL），不发出任何请求', async (t) => {
  delete process.env[KEY_ENV]
  const { server, baseURL, requests } = await startMockDeepSeek(['[DONE]'])
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))

  const ctx = await setupAdapter(baseURL)
  // LlmRuntime 把 adapter 失败归一成终止 finish chunk（不抛），语义原样保留。
  const result = await consume(ctx, request('无 key'))
  assert.equal(result.finishKind, 'error')
  assert.match(String(result.failureMessage), /no API key/)
  assert.equal(requests.length, 0, '缺 key 时一个字节都不许出站')
})
