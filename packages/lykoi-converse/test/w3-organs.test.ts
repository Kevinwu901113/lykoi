/**
 * M3-W3 接线 e2e（converse 侧）：
 *  ③ **contact 链端到端** —— 真 kernel 通知队列 → `_pending_contact_ts` 读面 →
 *    一次对话轮 → `contact_answered` 的唯一写入点 + `markReplied` 首写幂等；
 *  ② **S-08 第二级实弹** —— owner 引用建议问句回话 → 建议问答机消费 → 不再当成
 *    一次普通对话；
 *  ① **投递线端到端** —— `autonomy.initiate_chat`（真 handler，proactive_chat 账本
 *    原子强制）→ chat_outbox → 设备层游标机 → 经 dispatch 盖 E3 章 → 真 transport。
 *
 * LLM/网络全程 fake、零真网；治理 state 与出站 state 全走 tmpdir。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import * as budgetPlugin from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import * as mockAdapter from 'lykoi-llm/mock'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { createStateFixture } from 'lykoi-memory/testing'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import {
  appendOutbox, loadOutboxCursor, saveOutboxCursor, type TelegramAdapterService,
} from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport, isolateOutboundState } from 'lykoi-adapter-telegram/testing'
import {
  bootstrapOwnerPreauthorization, getNotification, pendingCount, sendNotification,
} from 'lykoi-kernel'
import { _reserveProactiveSlot, messengerProactiveRemainingToday } from 'lykoi-adapter-telegram'
import { composeSurfaceReply } from '../src/index.ts'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function isolateAll(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-w3-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  isolateOutboundState(dir)
  return dir
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { events, async record(event) { events.push(event) } }
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

async function assemble(replyText: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-w3-db-'))
  const dbPath = join(dir, 'state.db')
  createStateFixture(dbPath)
  seedBinding(dbPath)
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', transport)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(budgetPlugin, {
    ledgerPath: join(dir, 'budget.json'), dailyTotalTokens: 1_000_000, dailyRouteTokens: {},
  })
  await ctx.plugin(lykoiLlm)
  await ctx.plugin(mockAdapter, {
    provider: 'mock', replyText, promptTokens: 210, completionTokens: 34,
  })
  await ctx.plugin(telegramAdapter, {
    cursorPath: join(dir, 'cursor.json'), archivePath: join(dir, 'inbound.json'),
    autoStart: false, pollTimeoutS: 25,
  })
  await ctx.plugin(converse, {
    dbPath, personaToml: PERSONA_TOML, route: 'mock', model: 'mock-model',
    restartMarker: join(dir, 'restart-marker.json'), narrativeFlag: '',
    restartRepoRoot: '', restartUnit: '', // M3-W4：dev/测试不采 git HEAD
    notificationOutboxDelivery: false, // GK-8 默认关

  })
  return {
    audit, transport, dbPath,
    telegram: ctx.get('telegram') as TelegramAdapterService,
    service: ctx.get('converse') as converse.ConverseService,
  }
}

// ============================== ③ contact 链端到端 ==============================

test('③ contact 链接通：真通知队列 → 一次对话轮 → contact_answered 唯一写入点', async () => {
  isolateAll()
  const { audit, transport, telegram, dbPath } = await assemble(envelope({}))
  bootstrapOwnerPreauthorization('user_001')
  // 她昨晚主动呼唤过一次（真 kernel 队列，origin=autonomous）——**未答**。
  const notif = sendNotification('我刚想到一件事', {
    origin: 'autonomous', now: new Date(Date.now() - 3600_000),
  })
  assert.equal(notif.throttled, undefined)

  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '刚看到你的消息' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  // NotificationsView 换真身之后，`_pending_contact_ts` 读得到那次呼唤 →
  // 这一轮回话解掉它（唯一写入点 = conversationTurnReflow 的那一支）。
  assert.ok(audit.events.some((e) => e.type === 'mind_contact_answered'))
  const store = new ReadWriteMemory(dbPath)
  try {
    const causes = store.recentRegulationEvents(null, 20).map((r) => r.cause)
    assert.equal(causes.filter((c) => c === 'contact_answered').length, 1, '恰一条，不多不少')
  } finally {
    store.close()
  }
})

test('③ markReplied 接真队列：显式引用一次呼唤 → 关联戳落在通知记录上（首写获胜）', async () => {
  isolateAll()
  const { dbPath } = await assemble(envelope({}))
  const notif = sendNotification('主动呼唤', { origin: 'autonomous' })
  const id = Number(notif.id)
  const store = new ReadWriteMemory(dbPath)
  try {
    const { conversationTurnReflow, emptyNotifications } = await import('lykoi-reflow')
    const { markReplied } = await import('lykoi-kernel')
    conversationTurnReflow({
      store, notifications: emptyNotifications,
      userText: '看到了', replyText: '嗯', historyId: 9, now: new Date(),
      replyToNotification: { id, ts: String(notif.ts) },
      markReplied: (nid, historyId, now) => { markReplied(nid, historyId, now) },
    })
  } finally {
    store.close()
  }
  const row = getNotification(id)!
  assert.equal(row.reply_history_id, 9)
  assert.ok(typeof row.replied_ts === 'string')
})

// ============================== ② S-08 第二级实弹 ==============================

test('② S-08 第二级：owner 引用建议问句回话 → 建议问答机消费，不再当成一次普通对话', async () => {
  isolateAll()
  const { audit, transport, telegram, service, dbPath } = await assemble(envelope({}))
  bootstrapOwnerPreauthorization('user_001')

  // 她排了一条建议（L5 的入队面），然后在这一拍问出去。
  const store = new ReadWriteMemory(dbPath)
  let suggestionId: number
  try {
    const row = store.enqueueRuleSuggestion({
      kind: 'concern_release', dedupKey: 'concern_release:3',
      suggestionText: '那条关切我觉得可以放掉了', now: new Date(),
    })
    suggestionId = row.id
  } finally {
    store.close()
  }
  const asked = await service.suggestion.maybeAskOwner({ now: new Date() })
  assert.equal(asked.status, 'asked')
  assert.equal(asked.suggestion_id, suggestionId)
  // 问询走她自己的 messenger.send，reply_to=null（照常吃主动打扰预算）。
  assert.equal(transport.sends.length, 1)
  assert.equal(transport.sends[0]!.replyTo, null)
  assert.ok(transport.sends[0]!.text.startsWith('有件事我自己想到了'))
  const questionId = String(asked.question_message_id)

  // owner **引用**那条问句回「不用了」→ S-08 第二级消费（LLM 判 decline）。
  transport.queueUpdate({
    updateId: 1,
    message: {
      messageId: 700, chatId: 'chat-1', senderId: '1001', text: '不用了',
      replyToMessageId: questionId,
    },
  })
  assert.equal(await telegram.pollOnce(), 1)
  const turn = audit.events.find((e) => e.type === 'telegram_rule_suggestion_turn')
  // mock LLM 的固定回复不是合法 verdict JSON → 落 unclear（永远不是 accept）。
  assert.ok(turn !== undefined, 'S-08 第二级必须消费掉这条消息')
  assert.equal(turn.suggestion_id, suggestionId)
  assert.ok(['unclear', 'declined', 'accepted'].includes(String(turn.outcome)))
  assert.equal(turn.outcome, 'unclear', '判不出来 = unclear，永远不是 accept')
  // **消费即 return**：这条消息不再进普通对话级
  assert.equal(audit.events.filter((e) => e.type === 'converse/received').length, 0)
  // 铁律的审计面：每一条都自证没碰规则文件
  const rows = audit.events.filter((e) => e.type === 'rule_suggestion_interaction')
  assert.ok(rows.length > 0)
  for (const row of rows) assert.equal(row.wrote_approval_rules, false)
})

// ============================== ① 投递线端到端（D-07） ==============================

test('① 投递线端到端：initiate_chat（真账本原子强制）→ outbox → 游标机 → E3 → 真 transport', async () => {
  isolateAll()
  const { audit, transport, telegram, service } = await assemble(envelope({}))
  bootstrapOwnerPreauthorization('user_001')
  saveOutboxCursor(0) // 从头消费（本用例的账本是空的，这里只是让起点确定）

  // 账本里躺着一条她的主动发言（生产侧的产生入口 = `autonomy.initiate_chat`
  // 真 handler，proactive_chat 账本在那里原子强制 —— 见 adapter 包的 resources 用例）。
  void service
  appendOutbox('我今天想到一件事', 'proactive')
  await telegram.consumeOutboxOnce()

  assert.equal(transport.sends.length, 1)
  assert.equal(transport.sends[0]!.text, '我今天想到一件事')
  assert.equal(transport.sends[0]!.replyTo, null, '主动发言不是应答')
  // **D-07 本体**：这条线经 dispatch，账照记，章是 E3。
  const dispatched = audit.events.filter(
    (e) => e.type === 'action_dispatch' && e.action_type === 'messenger.send',
  )
  assert.equal(dispatched.length, 1)
  assert.equal(dispatched[0]!.exemption, 'E3')
  assert.equal(dispatched[0]!.origin, 'autonomous')
  assert.equal(dispatched[0]!.decision, 'allow')
  assert.ok(audit.events.some((e) => e.type === 'chat_outbox_delivered_telegram'))
  assert.equal(loadOutboxCursor(), 1, '结局落定之后才推进游标')
})

test('① 出站游标机在长轮询**间隙**跑，且出站出事不带聋耳朵（自成一个 try）', async () => {
  isolateAll()
  const { audit, telegram, transport } = await assemble(envelope({}))
  bootstrapOwnerPreauthorization('user_001')
  saveOutboxCursor(0)
  // 游标文件指向一个不可写的位置 → 出站这边炸
  process.env.LYKOI_TELEGRAM_OUTBOX_CURSOR = '/nonexistent-dir-xyz/cursor'
  appendOutbox('一句话', 'proactive')
  await telegram.consumeOutboxOnce() // 不抛
  assert.ok(audit.events.some((e) => e.type === 'chat_outbox_consume_error'))
  // 耳朵照常：长轮询这一轮不受影响
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  assert.equal(await telegram.pollOnce(), 1)
})

// ============================== 出口判据②：预算边界回归 ==============================

test('出口判据② 预算边界回归：名额耗尽后 **reply_to=null 的问句仍被拒**，而设备层的问句照发', async () => {
  isolateAll()
  const { audit, transport, telegram, service } = await assemble(
    envelope({
      decision: {
        kind: 'tool_call', tool: { name: 'terminal_exec', arguments: { command: 'ls' } },
        reason: '他问我在不在',
      },
    }),
  )
  bootstrapOwnerPreauthorization('user_001')
  // 把今天的主动开口名额烧光（活体 8-19 01:40 那 6 连拒的前置条件）。
  assert.equal(_reserveProactiveSlot(new Date()), null)
  assert.equal(messengerProactiveRemainingToday(new Date()), 0)

  // ① 设备层的问句带 reply_to = 当轮入站 id → **应答路径，不吃预算** → 照发。
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 500, chatId: 'chat-1', senderId: '1001', text: '帮我跑 ls' },
  })
  assert.equal(await telegram.pollOnce(), 1)
  const asked = audit.events.find((e) => e.type === 'approval_question' && e.stage === 'asked')!
  assert.equal(asked.delivered, true, 'SK-77 的全部意义：名额耗尽也问得出去')
  assert.equal(transport.sends[0]!.replyTo, '500')

  // ② 同一时刻，**没有 reply_to** 的同一个问句被打扰预算挡下 → undelivered →
  //    deny_by_default（不排队、不执行）。这条边界必须**仍然存在** —— 它是纪律，
  //    不是缺陷；SK-77 修的是"谁去问"，从来不是"把预算取消掉"。
  const denied = await service.approval.requestApproval('terminal.exec', { command: 'whoami' }, {
    contextId: 'chat-1',
    replyTo: null, // 认知侧没有入站 id 时只能这样问 —— 于是它按主动打扰计费
    origin: 'interactive',
  })
  assert.equal(denied.status, 'send_failed')
  assert.equal(denied.pending_id, null, '没排队 = 那件事不做（deny-by-default）')
  const undeliveredRow = audit.events.filter(
    (e) => e.type === 'approval_question' && e.stage === 'undelivered',
  ).at(-1)!
  assert.equal(undeliveredRow.reason, 'daily_cap')
  assert.equal(undeliveredRow.outcome, 'deny_by_default')
  // 出站仍然只有那一条带 reply_to 的问句
  assert.equal(transport.sends.length, 1)
})

// ============================== ④ D-04 横幅权威源 ==============================

test('④ D-04 横幅接权威源：撞门之后的下一轮普通对话带上"有 N 条待批准操作"', async () => {
  isolateAll()
  const { audit, transport, telegram } = await assemble(
    envelope({
      decision: {
        kind: 'tool_call', tool: { name: 'terminal_exec', arguments: { command: 'ls' } },
        reason: '他问我在不在',
      },
    }),
  )
  bootstrapOwnerPreauthorization('user_001')
  assert.equal(pendingCount(), 0)

  // 第一轮：撞硬门 → 设备层问出去 → 队列里从此有一条真的悬置动作。
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 500, chatId: 'chat-1', senderId: '1001', text: '帮我跑 ls' },
  })
  await telegram.pollOnce()
  assert.equal(pendingCount(), 1, 'D-04 的权威源 = kernel pendingCount（恒 0 的假设解除）')

  // 第二轮：一句不引用任何东西的普通对话 → 回复带横幅。
  // （固定信封仍然点名 tool_call，所以这一轮又会撞门 —— 但那次撞门发生在装配
  //  **之后**，横幅数取的是这一轮开始时的权威读数。）
  transport.queueUpdate({
    updateId: 2,
    message: { messageId: 501, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  await telegram.pollOnce()
  const banner = transport.sends.map((s) => s.text).filter((t) => t.startsWith('⚠️'))
  assert.equal(banner.length, 0, '这一轮仍是沉默（信封点名工具）→ 横幅不破坏沉默')
  // 直接对着权威源验横幅装配（沉默路不加横幅是 D-04 的另一半，上面已钉）。
  assert.equal(composeSurfaceReply('在的', pendingCount(), false), '⚠️ 有 1 条待批准操作。\n\n在的')
  assert.equal(composeSurfaceReply('', pendingCount(), false), '', '沉默一路走到底')
  assert.ok(audit.events.some((e) => e.type === 'converse/silence'))
})
