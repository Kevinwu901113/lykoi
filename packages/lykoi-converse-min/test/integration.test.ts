/**
 * 交付④集成测试：一条链打通（工单原文）——
 * fake transport 注入 owner 消息 → 适配器盖章 → converse-min → lykoiLlm.call
 * （route 可配：mock 或 交付①的剥头 adapter 对 mock SSE server）→ 适配器 send
 * （reply_to=入站 id）→ 每步落 audit 行、budget 有账。
 * 断言全链事件序列与 audit 行数；再加一条非 owner（未绑定）消息断言被绑定闸丢弃。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import * as budgetPlugin from 'lykoi-budget'
import type { BudgetService } from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import * as mockAdapter from 'lykoi-llm/mock'
import * as deepseekAdapter from 'lykoi-llm-deepseek'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import * as converseMin from '../src/index.ts'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-converse-'))
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

function fakeMemory(): LykoiMemoryService {
  const bindings: Record<string, BindingResolution> = {
    'telegram:1001': { userId: 'user_001', role: 'owner_primary', userStatus: 'active' },
  }
  return {
    regulationField: () => [],
    activeConcerns: () => [],
    openThoughts: () => [],
    recentHistory: () => [],
    recentExperiences: () => [],
    identityBinding: (channel, key) => bindings[`${channel}:${key}`],
    autonomyState: () => undefined,
  }
}

interface Assembly {
  ctx: Context
  audit: ReturnType<typeof fakeAudit>
  transport: MemoryTelegramTransport
  telegram: TelegramAdapterService
  budget: BudgetService
}

/** 测试装配：dev 用 fake transport 的 entry 只在测试装配（工单④），不进 profile。 */
async function assemble(
  route: { route: string; model: string },
  caps: { dailyTotalTokens?: number; dailyRouteTokens?: Record<string, number> } = {},
): Promise<Assembly> {
  const dir = tmp()
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', transport)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(budgetPlugin, {
    ledgerPath: join(dir, 'budget.json'),
    dailyTotalTokens: caps.dailyTotalTokens ?? 100_000,
    dailyRouteTokens: caps.dailyRouteTokens ?? {},
  })
  await ctx.plugin(lykoiLlm)
  await ctx.plugin(telegramAdapter, {
    cursorPath: join(dir, 'cursor.json'),
    archivePath: join(dir, 'inbound.json'),
    autoStart: false,
    pollTimeoutS: 25,
  })
  await ctx.plugin(converseMin, route)
  const telegram = ctx.get('telegram') as TelegramAdapterService
  const budget = ctx.get('budget') as BudgetService
  return { ctx, audit, transport, telegram, budget }
}

test('全链（route=mock）：owner 消息 → 盖章 → converse → llm → send(reply_to=入站 id)；事件序列与行数；budget 有账', async () => {
  const { ctx, audit, transport, telegram, budget } = await assemble({
    route: 'mock',
    model: 'mock-model',
  })
  await ctx.plugin(mockAdapter, {
    provider: 'mock',
    replyText: '管线证明：她回话了',
    promptTokens: 21,
    completionTokens: 13,
  })

  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  // 出站：reply_to = 入站 message_id（SPEC §7.1）
  assert.deepEqual(transport.sends, [
    { chatId: 'chat-1', text: '管线证明：她回话了', replyTo: '100' },
  ])

  // 全链事件序列（每步落 audit 行）：
  assert.deepEqual(audit.events.map((e) => e.type), [
    'telegram/inbound', // 适配器盖章后
    'converse/received', // 环收到
    'budget/charge', // 调用后必记账（lykoiLlm 结构保证）
    'converse/reply', // 回复生成
    'telegram/sent', // 出站送达
  ])
  assert.equal(audit.events.length, 5)

  // budget 有账：mock 用量 21+13
  assert.equal(budget.usage('mock').routeTokens, 34)
  assert.equal(budget.usage('mock').totalTokens, 34)
  // run 归因贯穿：charge 行与 converse 行同 runId
  const charge = audit.events.find((e) => e.type === 'budget/charge')!
  const reply = audit.events.find((e) => e.type === 'converse/reply')!
  assert.equal(charge.runId, 'converse-1-100')
  assert.equal(reply.runId, charge.runId)
  // 隐私：全链 audit 行没有任何一行携带正文
  for (const event of audit.events) {
    assert.equal('text' in event, false)
    assert.equal('content' in event, false)
  }

  // —— 非 owner（未绑定）消息：被绑定闸丢弃（工单④断言） ——
  transport.queueUpdate({
    updateId: 2,
    message: { messageId: 200, chatId: 'chat-x', senderId: '8888', text: '陌生人来话' },
  })
  await telegram.pollOnce()
  assert.equal(telegram.counters().droppedUnbound, 1)
  assert.equal(audit.events.map((e) => e.type).at(-1), 'telegram/inbound_dropped_unbound')
  assert.equal(audit.events.length, 6, '丢弃只加一行，不进对话环')
  assert.equal(transport.sends.length, 1, '不回话')
  assert.equal(budget.usage('mock').routeTokens, 34, '不花她的预算')
})

test('全链（route=deepseek-official，交付①剥头 adapter 对 mock SSE server）：管线同构走通，出站头无 harness 假名', async (t) => {
  // mock DeepSeek SSE server（零真实外网、零真实 key）
  const seenHeaders: string[][] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seenHeaders.push(Object.keys(req.headers))
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '经真形态路由的回话' } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 7, completion_tokens: 4 },
      })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const { port } = server.address() as AddressInfo
  process.env.LYKOI_TEST_FAKE_DEEPSEEK_KEY = 'test-not-a-real-key-0000'
  t.after(() => delete process.env.LYKOI_TEST_FAKE_DEEPSEEK_KEY)

  const { ctx, audit, transport, telegram, budget } = await assemble({
    route: 'deepseek-official',
    model: 'deepseek-v4-flash',
  })
  await ctx.plugin(deepseekAdapter, {
    baseURL: `http://127.0.0.1:${port}`,
    apiKeyEnv: 'LYKOI_TEST_FAKE_DEEPSEEK_KEY',
  })

  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '换真形态路由' },
  })
  await telegram.pollOnce()

  assert.deepEqual(transport.sends, [
    { chatId: 'chat-1', text: '经真形态路由的回话', replyTo: '100' },
  ])
  assert.deepEqual(audit.events.map((e) => e.type), [
    'telegram/inbound',
    'converse/received',
    'budget/charge',
    'converse/reply',
    'telegram/sent',
  ])
  // budget 按 SSE usage 记账：7+4
  assert.equal(budget.usage('deepseek-official').routeTokens, 11)
  // CF-B6 复核：整条链出站的 HTTP 头无任何 x-deepseek-harness-*
  assert.equal(seenHeaders.length, 1)
  assert.deepEqual(seenHeaders[0]!.filter((h) => h.startsWith('x-deepseek-harness-')), [])
})

test('失败方向：budget 硬顶拒调 → 空回合（不崩轮询、不出站、拒调有审计）', async () => {
  const { ctx, audit, transport, telegram } = await assemble(
    { route: 'mock', model: 'mock-model' },
    { dailyRouteTokens: { mock: 0 } }, // used(0) >= cap(0) → gate 必拒
  )
  await ctx.plugin(mockAdapter, {
    provider: 'mock',
    replyText: '不该说出的话',
    promptTokens: 21,
    completionTokens: 13,
  })

  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  // 不崩：拒调被环吸收为空回合
  assert.equal(await telegram.pollOnce(), 1)
  assert.equal(transport.sends.length, 0, '超顶不许出站')
  assert.deepEqual(audit.events.map((e) => e.type), [
    'telegram/inbound',
    'converse/received',
    'budget/refusal', // 拒调落审计（budget 结构保证）
    'converse/turn_failed', // 环留痕
  ])
  const failed = audit.events.find((e) => e.type === 'converse/turn_failed')!
  assert.equal(failed.error, 'BudgetExceeded')
  // 游标照推：失败方向=空回合而非重放（T4/S 语义：/chat 失败→empty turn）
  assert.equal(telegram.cursor(), 1)
})
