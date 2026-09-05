/**
 * WO-UTTER-01 D-7：出站长文按通道上限切分。
 *
 * 纯函数 `splitForTelegram`（逐字 / 切点优先级 / 代理对）、`BotApiTransport.sendMessage`
 * 的顺序发送与部分送达结局（D-3）、`telegram/sent.parts` 审计（D-4）、内存 fake 的
 * `maxChars`（D-6）。零真网：HTTP 是注入 seam。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import type { LykoiMemoryService } from 'lykoi-memory'
import type { TelegramAdapterService } from '../src/index.ts'
import * as adapterPlugin from '../src/index.ts'
import { ProductionTelegramTransport } from '../src/production.ts'
import {
  BotApiTransport, TELEGRAM_TEXT_MAX, setTransportLogEvent, setUndeliveredExperienceSink,
  splitForTelegram, type HttpPost,
} from '../src/transport.ts'
import { undelivered } from '../src/outbox.ts'
import { isolateOutboundState, MemoryTelegramTransport } from '../src/testing.ts'

/** 假 token：错误里一个字符都不许出现（transport 的 token 纪律）。 */
const FAKE_TOKEN = '1234567:AA-THIS-MUST-NEVER-LEAK'
const NO_SLEEP = async () => {}

/** 三段样本：a×4000 + \n\n + b×4000 + \n\n + c×100 = 8104 → [4002, 4002, 100]。 */
const THREE = 'a'.repeat(4000) + '\n\n' + 'b'.repeat(4000) + '\n\n' + 'c'.repeat(100)
const THREE_REST = 'b'.repeat(4000) + '\n\n' + 'c'.repeat(100)

function isolate(): void {
  isolateOutboundState(mkdtempSync(join(tmpdir(), 'lykoi-split-')))
  setTransportLogEvent(null)
  setUndeliveredExperienceSink(null)
}

function telemetry(): { name: string; fields: Record<string, unknown> }[] {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  setTransportLogEvent((name, fields) => events.push({ name, fields }))
  return events
}

type Step = Error | { status: number; body: unknown }
/** fake HTTP seam：按脚本给出结果（抛 = 网络故障；对象 = 一次响应）；脚本用尽重复末项。 */
function fakeHttp(script: Step[]) {
  const calls: { url: string; payload: Record<string, unknown> }[] = []
  let i = 0
  const post: HttpPost = async (url, payload) => {
    calls.push({ url, payload })
    const step = script[Math.min(i, script.length - 1)]!
    i += 1
    if (step instanceof Error) throw step
    return { status: step.status, json: () => step.body }
  }
  return { post, calls }
}

const ok = (messageId: number): Step => ({
  status: 200, body: { ok: true, result: { message_id: messageId, date: 1 } },
})

function api(post: HttpPost): BotApiTransport {
  return new BotApiTransport({ token: FAKE_TOKEN, post, sleep: NO_SLEEP, apiBase: 'https://example.invalid' })
}

const hasLoneSurrogate = (s: string): boolean =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)

// ============================== D-1 / D-2 纯函数 ==============================

test('D-1 TELEGRAM_TEXT_MAX = 4096（UTF-16 code unit，即 text.length）', () => {
  assert.equal(TELEGRAM_TEXT_MAX, 4096)
})

test('D-2 不超长：原样一段；空串也是一段；恰 4096 不切', () => {
  assert.deepEqual(splitForTelegram(''), [''])
  assert.deepEqual(splitForTelegram('hi'), ['hi'])
  const exact = 'x'.repeat(4096)
  assert.deepEqual(splitForTelegram(exact), [exact])
})

test('D-2 4097 → [4096, 1]，拼回等于原文', () => {
  const text = 'x'.repeat(4097)
  const parts = splitForTelegram(text)
  assert.deepEqual(parts.map((p) => p.length), [4096, 1])
  assert.equal(parts.join(''), text)
})

test('D-2 只有一个超长词：硬切 [4096, 4096, 1808]', () => {
  const text = 'w'.repeat(10000)
  const parts = splitForTelegram(text)
  assert.deepEqual(parts.map((p) => p.length), [4096, 4096, 1808])
  assert.equal(parts.join(''), text)
})

test('D-2 硬切不落在代理对中间', () => {
  const text = 'a'.repeat(4095) + '😀' + 'b'
  const parts = splitForTelegram(text)
  assert.deepEqual(parts.map((p) => p.length), [4095, 3])
  for (const p of parts) assert.equal(hasLoneSurrogate(p), false)
  assert.equal(parts.join(''), text)
  assert.deepEqual(splitForTelegram('a😀b', 2), ['a', '😀', 'b'])
})

test('D-2 优先级：窗口内最后一个 \\n\\n 优先于 \\n', () => {
  const text = 'x'.repeat(3000) + '\n\n' + 'y'.repeat(1000) + '\n' + 'z'.repeat(500) // 4503
  const parts = splitForTelegram(text)
  assert.deepEqual(parts, ['x'.repeat(3000) + '\n\n', 'y'.repeat(1000) + '\n' + 'z'.repeat(500)])
  assert.deepEqual(parts.map((p) => p.length), [3002, 1501])
})

test('D-2 优先级：无 \\n\\n 时取最后一个 \\n', () => {
  const text = 'x'.repeat(3000) + '\n' + 'y'.repeat(2000)
  const parts = splitForTelegram(text)
  assert.deepEqual(parts.map((p) => p.length), [3001, 2000])
  assert.equal(parts[0]!.at(-1), '\n', '分隔符归前一段')
})

test('D-2 优先级：无换行时取最后一个空白', () => {
  const text = 'x'.repeat(3000) + ' ' + 'y'.repeat(2000)
  const parts = splitForTelegram(text)
  assert.deepEqual(parts.map((p) => p.length), [3001, 2000])
  assert.equal(parts[0]!.at(-1), ' ')
})

test('D-2 跨窗口边界的 \\n\\n：按 \\n 切，不丢字', () => {
  // max=10：'xxxxxxxxx\n' + '\ny' —— \n\n 正好跨在第 10 个 code unit 上
  const text = 'x'.repeat(9) + '\n\n' + 'y'
  const parts = splitForTelegram(text, 10)
  assert.deepEqual(parts, ['x'.repeat(9) + '\n', '\ny'])
  assert.equal(parts.join(''), text)
})

test('D-2 多轮切分，每轮各自找 \\n\\n', () => {
  assert.deepEqual(splitForTelegram('aaaa\n\nbbbb\n\ncccc\n\ndd', 10), ['aaaa\n\n', 'bbbb\n\n', 'cccc\n\ndd'])
})

test('D-2 小上限：空白切点；max=1 逐字', () => {
  assert.deepEqual(splitForTelegram('ab cd ef', 5), ['ab ', 'cd ef'])
  assert.deepEqual(splitForTelegram('abc', 1), ['a', 'b', 'c'])
})

test('D-2 max 非正整数 → RangeError', () => {
  assert.throws(() => splitForTelegram('x', 0), RangeError)
  assert.throws(() => splitForTelegram('x', 2.5), RangeError)
})

test('D-2 不变量：任意样本 × 任意上限 —— 段长 ∈ [1,max]、无孤立代理项、拼回逐字', () => {
  const samples = [
    '第一段。\n\n第二段有点长，' + '字'.repeat(300) + '\n第三行 with spaces and 😀 emoji\n\n' + 'tail',
    'no-separators-at-all-' + 'x'.repeat(500),
    '😀'.repeat(300),
    ' '.repeat(50) + '\n'.repeat(50),
    'a\n\n\n\nb' + 'c'.repeat(100),
  ]
  for (const text of samples) {
    for (const max of [2, 3, 7, 16, 64, 255, 4096]) {
      const parts = splitForTelegram(text, max)
      assert.equal(parts.join(''), text, `拼回 max=${max}`)
      for (const p of parts) {
        assert.ok(p.length >= 1 && p.length <= max, `段长 ${p.length} ∉ [1,${max}]`)
        assert.equal(hasLoneSurrogate(p), false, `孤立代理项 max=${max}`)
      }
    }
  }
})

// ============================== D-3 / D-4 / D-5 BotApiTransport ==============================

test('D-3 三段全成功：顺序 3 次 POST，reply_to 只在第一段，message_id 取第一段，split 事件恰一次', async () => {
  isolate()
  const events = telemetry()
  const http = fakeHttp([ok(101), ok(102), ok(103)])
  const result = await api(http.post).sendMessage({ contextId: '1001', text: THREE, replyTo: '7' })
  assert.equal(result.message_id, '101')
  assert.equal(result.parts, 3)
  assert.equal(result.error, undefined)
  assert.equal(http.calls.length, 3)
  const texts = http.calls.map((c) => c.payload.text as string)
  assert.deepEqual(texts.map((t) => t.length), [4002, 4002, 100])
  assert.equal(texts.join(''), THREE, '逐字')
  assert.equal(http.calls[0]!.payload.reply_to_message_id, 7)
  assert.equal('reply_to_message_id' in http.calls[1]!.payload, false)
  assert.equal('reply_to_message_id' in http.calls[2]!.payload, false)
  assert.equal('parse_mode' in http.calls[0]!.payload, false)
  const split = events.filter((e) => e.name === 'telegram_transport_split')
  assert.deepEqual(split, [{ name: 'telegram_transport_split', fields: { parts: 3, chars: 8104 } }])
  assert.equal(JSON.stringify(events).includes('aaaa'), false, '事件零正文')
  assert.equal(undelivered().length, 0)
})

test('D-3 单段不发 split 事件，返回 parts=1', async () => {
  isolate()
  const events = telemetry()
  const http = fakeHttp([ok(111)])
  const result = await api(http.post).sendMessage({ contextId: '1001', text: 'short' })
  assert.equal(result.message_id, '111')
  assert.equal(result.parts, 1)
  assert.equal(events.filter((e) => e.name === 'telegram_transport_split').length, 0)
})

test('D-3 第 2 段 502 → 停发、partial_delivery、账本恰一条 = 剩余原文、undelivered_recorded:true；D-5 经验一条', async () => {
  isolate()
  const experiences: string[] = []
  setUndeliveredExperienceSink((_source, content) => { experiences.push(content); return 'exp-1' })
  const http = fakeHttp([ok(201), { status: 502, body: {} }])
  const result = await api(http.post).sendMessage({ contextId: '1001', text: THREE, replyTo: null })
  assert.deepEqual(result, {
    message_id: null, context_id: '1001', sent: false, error: 'partial_delivery',
    ambiguous: false, undelivered_recorded: true, parts: 3,
  })
  assert.equal(http.calls.length, 2, '第 2 段失败即停，第 3 段不发')
  const rows = undelivered()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.chars, THREE_REST.length)
  assert.equal(rows[0]!.text_summary, THREE_REST.slice(0, 200))
  assert.equal(rows[0]!.error, 'partial_delivery')
  assert.equal(rows[0]!.attempts, 1)
  assert.equal(rows[0]!.ambiguous, false)
  assert.equal(rows[0]!.source, 'telegram_transport.send_message')
  assert.equal(experiences.length, 1)
  assert.match(experiences[0]!, /partial_delivery/)
})

test('D-3 第 1 段就失败 = 普通失败（api_error，账本 chars = 全文），不叫 partial', async () => {
  isolate()
  const http = fakeHttp([{ status: 400, body: { ok: false } }])
  const result = await api(http.post).sendMessage({ contextId: '1001', text: THREE })
  assert.equal(result.error, 'api_error')
  assert.equal(result.parts, 3)
  assert.equal(http.calls.length, 1)
  const rows = undelivered()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.chars, THREE.length)
  assert.equal(rows[0]!.error, 'api_error')
})

test('D-3 第 2 段网络歧义失败：重试序列照走，partial_delivery + ambiguous:true + attempts=5', async () => {
  isolate()
  const timeout = new Error('network')
  timeout.name = 'ReadTimeout'
  const http = fakeHttp([ok(301), timeout])
  const result = await api(http.post).sendMessage({ contextId: '1001', text: THREE })
  assert.equal(result.error, 'partial_delivery')
  assert.equal(result.ambiguous, true)
  assert.equal(result.undelivered_recorded, true)
  assert.equal(http.calls.length, 1 + 5, '第 2 段首次 + 4 次重试')
  const rows = undelivered()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.attempts, 5)
  assert.equal(rows[0]!.ambiguous, true)
  assert.equal(rows[0]!.chars, THREE_REST.length)
})

// ============================== D-4 审计（经 adapter.transportSend） ==============================

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { events, async record(event) { events.push(event) } }
}

function fakeMemory(): LykoiMemoryService {
  return {
    regulationField: () => [],
    activeConcerns: () => [],
    openThoughts: () => [],
    recentHistory: () => [],
    recentExperiences: () => [],
    identityBinding: () => ({ userId: 'user_001', role: 'owner_primary', userStatus: 'active' }),
    autonomyState: () => undefined,
  }
}

async function setup(post: HttpPost) {
  isolate()
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', new ProductionTelegramTransport(undefined, { api: api(post) }))
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-split-adapter-'))
  await ctx.plugin(adapterPlugin, {
    cursorPath: join(dir, 'cursor.json'), archivePath: join(dir, 'inbound.json'),
    autoStart: false, pollTimeoutS: 25,
  })
  return { svc: ctx.get('telegram') as TelegramAdapterService, audit }
}

test('D-4 telegram/sent 审计：chars 记全文，parts 记段数；单段 parts=1', async () => {
  const http = fakeHttp([ok(401), ok(402), ok(403), ok(404)])
  const { svc, audit } = await setup(http.post)
  await svc.transportSend('chat-1', THREE, '9')
  await svc.transportSend('chat-1', 'short', null)
  const sent = audit.events.filter((e) => e.type === 'telegram/sent')
  assert.deepEqual(sent, [
    { type: 'telegram/sent', contextId: 'chat-1', replyTo: '9', chars: 8104, messageId: '401', parts: 3 },
    { type: 'telegram/sent', contextId: 'chat-1', replyTo: null, chars: 5, messageId: '404', parts: 1 },
  ])
})

test('D-4 telegram/send_failed 审计带 partial_delivery 与 parts', async () => {
  const http = fakeHttp([ok(501), { status: 502, body: {} }])
  const { svc, audit } = await setup(http.post)
  const result = await svc.transportSend('chat-1', THREE, null)
  assert.equal(result.sent, false)
  assert.equal(result.error, 'partial_delivery')
  assert.equal(result.undelivered_recorded, true)
  assert.equal(result.parts, 3)
  const failed = audit.events.filter((e) => e.type === 'telegram/send_failed')
  assert.equal(failed.length, 1)
  assert.equal((failed[0] as Record<string, unknown>).error, 'partial_delivery')
  assert.equal((failed[0] as Record<string, unknown>).parts, 3)
  assert.equal((failed[0] as Record<string, unknown>).chars, 8104)
})

// ============================== D-6 内存 fake ==============================

test('D-6 MemoryTelegramTransport({maxChars})：同一切分函数，replyTo 只在第一段，缺省不切', async () => {
  const t = new MemoryTelegramTransport({ maxChars: 10 })
  const result = await t.send('chat-1', 'aaaa\n\nbbbb\n\ncccc\n\ndd', '1')
  assert.deepEqual(result, { messageId: 'm9001', sent: true, parts: 3 })
  assert.deepEqual(t.sends, [
    { chatId: 'chat-1', text: 'aaaa\n\n', replyTo: '1' },
    { chatId: 'chat-1', text: 'bbbb\n\n', replyTo: null },
    { chatId: 'chat-1', text: 'cccc\n\ndd', replyTo: null },
  ])
  assert.deepEqual(await t.send('chat-1', 'short', '2'), { messageId: 'm9004', sent: true })
  const plain = new MemoryTelegramTransport()
  assert.deepEqual(await plain.send('chat-1', 'x'.repeat(5000), '3'), { messageId: 'm9001', sent: true })
  assert.equal(plain.sends.length, 1)
})
