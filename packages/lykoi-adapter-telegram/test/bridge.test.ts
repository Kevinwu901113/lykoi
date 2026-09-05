/**
 * WO-FIX-UNDELIVERED-BRIDGE-01 D-3：一次生产发送失败穿过整条桥 ——
 * 真 `BotApiTransport`（注入 HttpPost）→ `ProductionTelegramTransport` →
 * `adapter.transportSend` → `messengerTransportBridge` → `messenger.send` handler →
 * 真 `OutboundOrgan.sendReply` / `deliverOutboxItem`。
 * 断言：账本恰 1 条（transport 记的那条）、经验恰 1 条 —— 桥不再吃掉
 * `undelivered_recorded`，device 的两处兜底自然不触发。零真网。
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
import { send as messengerSend } from '../src/index.ts'
import { OutboundOrgan } from '../src/device.ts'
import { ProductionTelegramTransport } from '../src/production.ts'
import { BotApiTransport, setUndeliveredExperienceSink } from '../src/transport.ts'
import { undelivered } from '../src/outbox.ts'
import { isolateOutboundState, MemoryTelegramTransport } from '../src/testing.ts'

/** 假 token：错误里一个字符都不许出现（transport 的 token 纪律）。 */
const FAKE_TOKEN = '1234567:AA-THIS-MUST-NEVER-LEAK'

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

/** 真 handler 当 dispatch：kernel 不在场，但 `messenger.send` 本人在。 */
function realMessengerDispatch() {
  return (async (action: { type: string; params: Record<string, unknown> }) => {
    assert.equal(action.type, 'messenger.send')
    const data = await messengerSend(action.params)
    return { success: true, data, error: null }
  }) as never
}

interface Setup {
  svc: TelegramAdapterService
  audit: ReturnType<typeof fakeAudit>
  experiences: string[]
}

async function setup(transport: ProductionTelegramTransport | MemoryTelegramTransport): Promise<Setup> {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-bridge-'))
  isolateOutboundState(dir)
  const experiences: string[] = []
  setUndeliveredExperienceSink((_source, content) => {
    experiences.push(content)
    return `exp-${experiences.length}`
  })
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', transport)
  await ctx.plugin(adapterPlugin, {
    cursorPath: join(dir, 'cursor.json'), archivePath: join(dir, 'inbound.json'),
    autoStart: false, pollTimeoutS: 25,
  })
  return { svc: ctx.get('telegram') as TelegramAdapterService, audit, experiences }
}

function production(status: number, body: () => unknown = () => ({})): ProductionTelegramTransport {
  const api = new BotApiTransport({ token: FAKE_TOKEN, post: async () => ({ status, json: body }) })
  return new ProductionTelegramTransport(undefined, { api })
}

test('D-1 桥透传：502 → transportSend 与 messenger.send 都带 undelivered_recorded:true / ambiguous:false；成功路不带这两键', async () => {
  try {
    const { svc } = await setup(production(502))
    const direct = await svc.transportSend('chat-1', '发不出去', '100')
    assert.deepEqual(direct, {
      messageId: null, sent: false, error: 'api_error', undelivered_recorded: true, ambiguous: false,
    })
    const viaHandler = await messengerSend({ text: '发不出去', context_id: 'chat-1', reply_to: '100' })
    assert.equal(viaHandler.undelivered_recorded, true)
    assert.equal(viaHandler.ambiguous, false)
    assert.equal(viaHandler.message_id, null)
    assert.equal(undelivered().length, 2, '两次直发 = transport 记两条（本例绕过 OutboundOrgan）')
  } finally {
    setUndeliveredExperienceSink(null)
  }
  try {
    const { svc } = await setup(production(200, () => ({ ok: true, result: { message_id: 55, date: 1 } })))
    const ok = await svc.transportSend('chat-1', '在的', '100')
    assert.deepEqual(ok, { messageId: '55', sent: true })
    const viaHandler = await messengerSend({ text: '在的', context_id: 'chat-1', reply_to: '100' })
    assert.equal(viaHandler.message_id, '55')
    assert.equal('undelivered_recorded' in viaHandler, false)
    assert.equal('ambiguous' in viaHandler, false)
    assert.deepEqual(undelivered(), [])
  } finally {
    setUndeliveredExperienceSink(null)
  }
})

test('D-3 ①：生产 502 → 真 OutboundOrgan.sendReply → 账本恰 1 条（source telegram_transport.send_message）、经验恰 1 条、结局 undelivered', async () => {
  try {
    const { svc, experiences } = await setup(production(502))
    const organ = new OutboundOrgan({ dispatch: realMessengerDispatch(), ownerChannelKey: () => 'chat-1' })
    const result = await organ.sendReply({ contextId: 'chat-1', text: '这句发不出去', replyTo: '100' })
    assert.deepEqual(result, { outcome: 'undelivered' })
    const ledger = undelivered()
    assert.equal(ledger.length, 1, `账本条数（修前读数为 2：transport 一条 + chat_reply 兜底一条）`)
    assert.equal(ledger[0]!.source, 'telegram_transport.send_message')
    assert.equal(ledger[0]!.error, 'api_error')
    assert.equal(experiences.length, 1, '经验条数（修前读数为 2）')
    assert.equal(svc.counters().sendFailed, 1)
  } finally {
    setUndeliveredExperienceSink(null)
  }
})

test('D-3 ②：生产 502 → 真 OutboundOrgan.deliverOutboxItem（reply_to=null 主动线）→ 同样恰 1 条', async () => {
  try {
    const { experiences } = await setup(production(502))
    const organ = new OutboundOrgan({ dispatch: realMessengerDispatch(), ownerChannelKey: () => 'chat-1' })
    await organ.deliverOutboxItem(
      { id: 1, ts: '2026-09-05T00:00:00Z', kind: 'proactive', content: '主动说一句' }, 'chat-1',
    )
    const ledger = undelivered()
    assert.equal(ledger.length, 1, '修前读数为 2（transport 一条 + chat_outbox 兜底一条）')
    assert.equal(ledger[0]!.source, 'telegram_transport.send_message')
    assert.equal(experiences.length, 1)
  } finally {
    setUndeliveredExperienceSink(null)
  }
})

test('D-2 测试面同形：MemoryTelegramTransport 失败分支带 undelivered_recorded:false → OutboundOrgan 兜底恰记 1 条（source chat_reply）', async () => {
  try {
    const memory = new MemoryTelegramTransport()
    const { experiences } = await setup(memory)
    memory.failNextSendWith = 'api_error'
    const direct = await memory.send('chat-1', 'x', '1')
    assert.deepEqual(direct, { messageId: null, sent: false, error: 'api_error', undelivered_recorded: false })
    memory.failNextSendWith = 'api_error'
    const organ = new OutboundOrgan({ dispatch: realMessengerDispatch(), ownerChannelKey: () => 'chat-1' })
    assert.deepEqual(
      await organ.sendReply({ contextId: 'chat-1', text: '内存假体发不出去', replyTo: '100' }),
      { outcome: 'undelivered' },
    )
    const ledger = undelivered()
    assert.equal(ledger.length, 1)
    assert.equal(ledger[0]!.source, 'chat_reply', '假体不记账 → 兜底记，且只记一次')
    assert.equal(experiences.length, 1)
  } finally {
    setUndeliveredExperienceSink(null)
  }
})
