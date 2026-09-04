import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import { BudgetExceeded } from 'lykoi-budget'
import { LlmFinishError } from 'lykoi-llm'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import {
  OutboundOrgan, TelegramAdapter, type InboundMessage, type TelegramAdapterService,
  type TelegramSendOptions,
} from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import {
  ContextBudgetError, DeadlineExceededError, SYSTEM_FAILURE_NOTICE,
  handleTurn, type Conversation, type CycleOutcome, type TurnFailReason,
} from '../src/index.ts'

const MESSAGE: InboundMessage = {
  userId: 'user_001',
  contextId: 'chat-1',
  isOwner: true,
  text: 'USER_BODY_SENTINEL https://private.example/input',
  messageId: '100',
  updateId: 1,
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { events, async record(event) { events.push(event) } }
}

interface FakeConversationOptions {
  reply?: string
  error?: unknown
  cycleKind?: CycleOutcome['kind']
  followup?: boolean
  delegatedAsk?: boolean
}

function fakeConversation(options: FakeConversationOptions): {
  conversation: Conversation
  sendOptions: { runId: string; turnId?: string }[]
  messages: string[]
} {
  const sendOptions: { runId: string; turnId?: string }[] = []
  const messages: string[] = []
  const ask = options.delegatedAsk
    ? {
        action_type: 'research_browser.open', params: {}, action_id: 'a-1',
        correlation_id: 'c-1',
      }
    : null
  const conversation = {
    async send(text: string, opts: { runId: string; turnId?: string }) {
      messages.push(text)
      sendOptions.push(opts)
      if (options.error !== undefined) throw options.error
      return options.reply ?? ''
    },
    hasFollowupRequest: () => options.followup === true,
    takeFollowupRequest: () => (options.followup === true ? 'FOLLOWUP_GOAL_SENTINEL' : null),
    lastCycleOutcome: () => options.cycleKind === undefined
      ? null
      : { kind: options.cycleKind, step: 0 },
    takeDelegatedAsk: () => ask,
    peekDelegatedAsk: () => ask,
  } as unknown as Conversation
  return { conversation, sendOptions, messages }
}

interface FakeTelegramOptions {
  delivery?: 'delivered' | 'undelivered' | 'needs_approval' | 'dispatch_failed'
  askStatus?: string
  askThrows?: boolean
  noticeThrows?: boolean
}

function fakeTelegram(options: FakeTelegramOptions = {}): TelegramAdapterService & {
  bareSends: { contextId: string; text: string; replyTo: string }[]
  bareSendOptions: (TelegramSendOptions | undefined)[]
  replyContexts: { run_id?: string | null; turn_id?: string | null }[]
} {
  const bareSends: { contextId: string; text: string; replyTo: string }[] = []
  const bareSendOptions: (TelegramSendOptions | undefined)[] = []
  const replyContexts: { run_id?: string | null; turn_id?: string | null }[] = []
  return {
    bareSends,
    bareSendOptions,
    replyContexts,
    async send(contextId, text, replyTo, sendOptions) {
      if (options.noticeThrows) {
        const error = new Error('VENDOR_RAW_SENTINEL https://private.example/vendor')
        error.name = 'TransportExploded'
        throw error
      }
      bareSends.push({ contextId, text, replyTo })
      bareSendOptions.push(sendOptions)
      return { sent: true, messageId: 'notice-1' }
    },
    async sendReply(_contextId, _text, _replyTo, context) {
      replyContexts.push(context ?? {})
      return { outcome: options.delivery ?? 'delivered' }
    },
    async askAbout() {
      if (options.askThrows) {
        const error = new Error('VENDOR_RAW_SENTINEL https://private.example/approval')
        error.name = 'ApprovalAskExploded'
        throw error
      }
      return { asked: true, status: options.askStatus ?? 'asked', pending_id: 'p-1' }
    },
    outboundWired: () => true,
    wireOutbound() {},
    async pollOnce() { return 0 },
    counters: () => ({
      polls: 0, inbound: 0, droppedUnbound: 0, droppedMalformed: 0,
      duplicates: 0, editedIgnored: 0, sent: 0, sendFailed: 0,
    }),
    cursor: () => 0,
    async consumeOutboxOnce() {},
    async transportSend() { return { sent: true, messageId: 'transport-1' } },
  }
}

interface HandleScenario extends FakeConversationOptions, FakeTelegramOptions {
  expectedStatus: 'replied' | 'intentional_silence' | 'deferred' | 'failed'
  expectedReason: string | null
  expectedNotice: boolean
  noTransport?: boolean
  expectedAsk?: boolean
}

async function runHandleScenario(scenario: HandleScenario): Promise<{
  audit: ReturnType<typeof fakeAudit>
  telegram: ReturnType<typeof fakeTelegram> | undefined
  conversation: ReturnType<typeof fakeConversation>
}> {
  const audit = fakeAudit()
  const telegram = scenario.noTransport ? undefined : fakeTelegram(scenario)
  const ctx = {
    audit,
    get(name: string) { return name === 'telegram' ? telegram : undefined },
  } as unknown as Context
  const conversation = fakeConversation(scenario)
  await handleTurn(ctx, conversation.conversation, MESSAGE)

  const terminals = audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(terminals.length, 1, '每条入站必须恰有一条正本终局')
  const terminal = terminals[0]!
  assert.equal(terminal.status, scenario.expectedStatus)
  assert.equal(terminal.reason, scenario.expectedReason)
  assert.equal(terminal.notice_sent, scenario.expectedNotice)
  assert.equal(terminal.ask_sent, scenario.expectedAsk ?? false)
  assert.equal(terminal.followup_registered, scenario.followup ?? false)
  assert.equal(terminal.turn_id, 'tg:1')
  assert.equal(terminal.inbound_id, 'tg:1')
  assert.equal(terminal.run_id, 'converse-1-100')
  assert.equal(terminal.update_id, 1)
  assert.equal(terminal.message_id, '100')
  assert.equal(typeof terminal.elapsed_ms, 'number')
  assert.ok(Number(terminal.elapsed_ms) >= 0)

  const received = audit.events.find((event) => event.type === 'converse/received')!
  assert.equal(received.turn_id, 'tg:1')
  assert.equal(received.inbound_id, 'tg:1')
  assert.equal(Object.hasOwn(received, 'run_id'), false)
  for (const event of audit.events.filter((item) => String(item.type).startsWith('converse/'))) {
    assert.equal(event.turn_id, 'tg:1', `${event.type} 缺 turn_id`)
  }
  for (const event of audit.events) {
    const flat = JSON.stringify(event)
    assert.equal(flat.includes('USER_BODY_SENTINEL'), false)
    assert.equal(flat.includes('VENDOR_RAW_SENTINEL'), false)
    assert.equal(flat.includes('https://private.example'), false)
  }
  return { audit, telegram, conversation }
}

const llmError = new LlmFinishError({
  reason: {
    kind: 'error',
    failure: {
      code: 'PROVIDER_FAILED', status: 502,
      message: 'VENDOR_RAW_SENTINEL https://private.example/vendor',
    },
  },
  route: 'mock',
  textLength: 0,
  reasoningLength: 0,
})

const handleScenarios: { name: string; scenario: HandleScenario }[] = [
  {
    name: 'reply delivered → replied，sendReply 收到 run_id/turn_id',
    scenario: {
      reply: '可靠回复', cycleKind: 'reply', delivery: 'delivered',
      expectedStatus: 'replied', expectedReason: null, expectedNotice: false,
    },
  },
  {
    name: '信封 silence → intentional_silence',
    scenario: {
      reply: '', cycleKind: 'silence', expectedStatus: 'intentional_silence',
      expectedReason: null, expectedNotice: false,
    },
  },
  {
    name: '契约重试耗尽 → envelope_failed + 裸系统回执',
    scenario: {
      reply: '', cycleKind: 'envelope_failed', expectedStatus: 'failed',
      expectedReason: 'envelope_failed', expectedNotice: true,
    },
  },
  {
    name: 'LlmFinishError → llm_failed + 裸系统回执',
    scenario: {
      error: llmError, expectedStatus: 'failed', expectedReason: 'llm_failed',
      expectedNotice: true,
    },
  },
  {
    name: 'DeadlineExceededError → deadline_exceeded + 裸系统回执',
    scenario: {
      error: new DeadlineExceededError('conversation_cycle', 10, 11),
      expectedStatus: 'failed', expectedReason: 'deadline_exceeded', expectedNotice: true,
    },
  },
  {
    name: 'ContextBudgetError → context_budget + 裸系统回执',
    scenario: {
      error: new ContextBudgetError('too large'), expectedStatus: 'failed',
      expectedReason: 'context_budget', expectedNotice: true,
    },
  },
  {
    name: 'BudgetExceeded → budget_exceeded + 裸系统回执',
    scenario: {
      error: new BudgetExceeded('route', 'mock', '2026-09-04', 101, 100),
      expectedStatus: 'failed', expectedReason: 'budget_exceeded', expectedNotice: true,
    },
  },
  {
    name: '工具步超界 → tool_budget_exhausted + 裸系统回执',
    scenario: {
      reply: '', cycleKind: 'tool_budget', expectedStatus: 'failed',
      expectedReason: 'tool_budget_exhausted', expectedNotice: true,
    },
  },
  {
    name: 'tool_call 缺 tool → missing_tool + 裸系统回执',
    scenario: {
      reply: '', cycleKind: 'missing_tool', expectedStatus: 'failed',
      expectedReason: 'missing_tool', expectedNotice: true,
    },
  },
  {
    name: 'sendReply undelivered → delivery_failed 且无系统回执',
    scenario: {
      reply: '未送达回复', cycleKind: 'reply', delivery: 'undelivered',
      expectedStatus: 'failed', expectedReason: 'delivery_failed', expectedNotice: false,
    },
  },
  {
    name: 'sendReply needs_approval → deferred/approval_pending',
    scenario: {
      reply: '待审批回复', cycleKind: 'reply', delivery: 'needs_approval',
      expectedStatus: 'deferred', expectedReason: 'approval_pending', expectedNotice: false,
    },
  },
  {
    name: '空答复 + delegated ask 已问出 → deferred 且 ask_sent',
    scenario: {
      reply: '', cycleKind: 'ask_pending', delegatedAsk: true,
      expectedStatus: 'deferred', expectedReason: 'approval_pending', expectedNotice: false,
      expectedAsk: true,
    },
  },
  {
    name: '空答复 + 审批问句未新发 → deferred 但 ask_sent=false',
    scenario: {
      reply: '', cycleKind: 'ask_pending', delegatedAsk: true, askStatus: 'quiet_period',
      expectedStatus: 'deferred', expectedReason: 'approval_pending', expectedNotice: false,
      expectedAsk: false,
    },
  },
  {
    name: '回复已交付后 askAbout 抛错 → 保留 replied 且不补系统回执',
    scenario: {
      reply: '先交付的回复', cycleKind: 'reply', delegatedAsk: true, askThrows: true,
      expectedStatus: 'replied', expectedReason: null, expectedNotice: false,
    },
  },
  {
    name: 'promise_followup reply → replied 且 followup_registered',
    scenario: {
      reply: '我会继续', cycleKind: 'followup', followup: true, delivery: 'delivered',
      expectedStatus: 'replied', expectedReason: null, expectedNotice: false,
    },
  },
  {
    name: 'telegram 服务缺席 → no_transport 且无系统回执',
    scenario: {
      reply: '无法投递', cycleKind: 'reply', noTransport: true,
      expectedStatus: 'failed', expectedReason: 'no_transport', expectedNotice: false,
    },
  },
  {
    name: '裸系统回执抛错 → notice_failed，终局仍落且不外抛',
    scenario: {
      reply: '', cycleKind: 'envelope_failed', noticeThrows: true,
      expectedStatus: 'failed', expectedReason: 'envelope_failed', expectedNotice: false,
    },
  },
]

for (const { name, scenario } of handleScenarios) {
  test(name, async () => {
    const result = await runHandleScenario(scenario)
    const terminal = result.audit.events.find((event) => event.type === 'turn/terminal')!
    if (scenario.reply !== undefined && scenario.reply.trim() !== '') {
      assert.ok(Number(terminal.reply_chars) > 0)
    }
    if (scenario.expectedNotice) {
      assert.deepEqual(result.telegram?.bareSends, [{
        contextId: 'chat-1',
        text: SYSTEM_FAILURE_NOTICE(scenario.expectedReason as TurnFailReason),
        replyTo: '100',
      }])
      assert.deepEqual(result.telegram?.bareSendOptions, [{ recordUndeliveredExperience: false }])
      assert.deepEqual(result.conversation.messages, [MESSAGE.text],
        '系统回执不得写入 Conversation messages/history')
    }
    if (name.startsWith('reply delivered')) {
      assert.deepEqual(result.telegram?.replyContexts, [{
        run_id: 'converse-1-100', turn_id: 'tg:1',
      }])
    }
    if (scenario.noticeThrows) {
      const failed = result.audit.events.filter((event) => event.type === 'turn/notice_failed')
      assert.equal(failed.length, 1)
      assert.equal(failed[0]!.error_name, 'TransportExploded')
    }
    if (scenario.askThrows) {
      const failed = result.audit.events.filter(
        (event) => event.type === 'converse/approval_request_failed',
      )
      assert.equal(failed.length, 1)
      assert.equal(failed[0]!.error_name, 'ApprovalAskExploded')
      assert.deepEqual(result.telegram?.bareSends, [])
    }
  })
}

function fakeMemory(): LykoiMemoryService {
  const owner: BindingResolution = {
    userId: 'user_001', role: 'owner_primary', userStatus: 'active',
  }
  return {
    regulationField: () => [],
    activeConcerns: () => [],
    openThoughts: () => [],
    recentHistory: () => [],
    recentExperiences: () => [],
    identityBinding: () => owner,
    autonomyState: () => undefined,
  }
}

async function runConsumed(reason: 'approval_answer' | 'suggestion_answer'): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-outcome-consumed-'))
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  let cognitiveInbound = 0
  ctx.on('lykoi/telegram/inbound', () => { cognitiveInbound += 1 })
  const adapter = new TelegramAdapter(ctx, {
    transport,
    audit,
    memory: fakeMemory(),
    cursorPath: join(dir, 'cursor.json'),
    archivePath: join(dir, 'archive.json'),
    pollTimeoutS: 1,
  })
  const approvalOutcome = reason === 'approval_answer' ? 'granted' : 'ignored'
  const suggestionOutcome = reason === 'suggestion_answer' ? 'accepted' : 'ignored'
  adapter.wireOutbound(new OutboundOrgan({
    dispatch: (async () => ({ success: true, data: {} })) as never,
    ownerChannelKey: () => 'chat-1',
    approval: {
      requestApproval: async () => ({ status: 'asked', pending_id: null }),
      handleOwnerAnswer: async () => ({ outcome: approvalOutcome, executed: false }),
    },
    suggestion: {
      handleOwnerAnswer: async () => ({ outcome: suggestionOutcome, suggestion_id: null }),
    },
  }))
  transport.queueUpdate({
    updateId: 9,
    message: {
      messageId: 901, chatId: 'chat-1', senderId: '1001', text: '可以',
      replyToMessageId: 'question-1',
    },
  })
  assert.equal(await adapter.pollOnce(), 1)
  assert.equal(cognitiveInbound, 0, '消费路径不得进入认知 inbound')
  const terminals = audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0]!.status, 'consumed')
  assert.equal(terminals[0]!.reason, reason)
  assert.equal(terminals[0]!.turn_id, 'tg:9')
  assert.equal(terminals[0]!.run_id, null)
}

test('设备层 approval answer 被消费 → consumed/approval_answer', async () => {
  await runConsumed('approval_answer')
})

test('设备层 suggestion answer 被消费 → consumed/suggestion_answer', async () => {
  await runConsumed('suggestion_answer')
})
