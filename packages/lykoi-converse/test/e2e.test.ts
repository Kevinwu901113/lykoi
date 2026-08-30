/**
 * 端到端 golden 全链（W5 交付④）：fake 入站（adapter-telegram fake 传输）→
 * 盖章 → 真装配器 → fake LLM 信封 → reply 回站（reply_to=入站 id）→
 * conversationTurnReflow → audit 全链事件序。三路：成功 / 失败（契约失败 →
 * 重试一次 → 仍失败 → 降级沉默 + 元数据）/ 沉默（demote 可观测 + D-04
 * 横幅不破坏沉默）。零真网：LLM = lykoi-llm/mock。
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
import type { BudgetService } from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import * as mockAdapter from 'lykoi-llm/mock'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-converse-e2e-'))
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
  dbPath: string
}

/** 全链装配：fixture db（含 owner 绑定）+ fake transport + mock LLM 固定信封。 */
async function assemble(replyText: string): Promise<Assembly> {
  const dir = tmp()
  const dbPath = join(dir, 'state.db')
  createStateFixture(dbPath)
  seedBinding(dbPath) // telegram/1001 → user_001（器官清单的身份轴真源）
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', transport)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(budgetPlugin, {
    ledgerPath: join(dir, 'budget.json'),
    dailyTotalTokens: 100_000,
    dailyRouteTokens: {},
  })
  await ctx.plugin(lykoiLlm)
  await ctx.plugin(mockAdapter, {
    provider: 'mock',
    replyText,
    promptTokens: 210,
    completionTokens: 34,
  })
  await ctx.plugin(telegramAdapter, {
    cursorPath: join(dir, 'cursor.json'),
    archivePath: join(dir, 'inbound.json'),
    autoStart: false,
    pollTimeoutS: 25,
  })
  await ctx.plugin(converse, {
    dbPath,
    personaToml: PERSONA_TOML,
    route: 'mock',
    model: 'mock-model',
    restartMarker: join(dir, 'restart-marker.json'),
    narrativeFlag: '',
    restartRepoRoot: '', // M3-W4：dev/测试不采 git HEAD（开发机的 HEAD 不是她的代码事实）
    restartUnit: '',
    notificationOutboxDelivery: false, // GK-8 默认关
    // D-01 三旋钮（M4-W1）：与 cordis.prod.yml 同数；缺省也是这三个。
    interpretTimeoutS: 30,
    interpretRetries: 1,
    cycleTimeoutS: 180,
    // vision 位：M4 定案显式 disabled（零真模型调用）。
    visionRoute: "disabled",
    visionModel: "disabled",
  })
  const telegram = ctx.get('telegram') as TelegramAdapterService
  const budget = ctx.get('budget') as BudgetService
  return { ctx, audit, transport, telegram, budget, dbPath }
}

/** 断言 expected 依序作为子序列出现在 actual 中（中间允许 store 遥测行）。 */
function assertSubsequence(actual: readonly string[], expected: readonly string[]): void {
  let i = 0
  for (const item of actual) {
    if (i < expected.length && item === expected[i]) i += 1
  }
  assert.equal(
    i, expected.length,
    `event subsequence mismatch:\n  expected ${JSON.stringify(expected)}\n  in ${JSON.stringify(actual)}`,
  )
}

function types(audit: { events: AuditEvent[] }): string[] {
  return audit.events.map((e) => String(e.type))
}

test('成功路：入站 → 装配 → 信封 reply → 回站(reply_to) → 回流 → 全链事件序 + 库面写集', async () => {
  const { audit, transport, telegram, budget, dbPath } = await assemble(
    envelope({ 情绪脉冲: ['normal_interaction'] }),
  )
  // 出生序事件（插件装载期）。
  assertSubsequence(types(audit), [
    'restart_event_recorded', 'organ_inventory_built', 'conversation_inner_state',
  ])

  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  // 出站：reply_to = 入站 message_id（应答路径不计打扰预算）。
  assert.deepEqual(transport.sends, [
    { chatId: 'chat-1', text: '在的，怎么了？', replyTo: '100' },
  ])
  // 全链事件序（子序列口径：中间允许 rw 遥测行）。
  assertSubsequence(types(audit), [
    'telegram/inbound', //     适配器盖章
    'converse/received', //    对话心智收到（字数）
    'budget/charge', //        一周期一调用（gate 前置/charge 后置）
    'u3_cycle_envelope', //    一周期一账（kind=reply）
    'inner_outer_pair', //     D-08 长度/哈希形态
    'mind_contact_answered', // —— 无未决呼唤时不该出现（见下）
  ].filter((n) => n !== 'mind_contact_answered'))
  assertSubsequence(types(audit), ['u3_cycle_envelope', 'converse/reply', 'telegram/sent'])
  const cycle = audit.events.find((e) => e.type === 'u3_cycle_envelope')!
  assert.equal(cycle.kind, 'reply')
  assert.equal(cycle.sent_chars, 7)
  assert.deepEqual(cycle.pulse, ['normal_interaction'])
  // budget 有账 + run 归因贯穿。
  assert.equal(budget.usage('mock').routeTokens, 244)
  const charge = audit.events.find((e) => e.type === 'budget/charge')!
  assert.equal(charge.runId, 'converse-1-100')
  // 隐私（D-08）：**对话面**的 audit 行零正文。
  // M3-W3 起她的回复是一次真的 `messenger.send` 动作（SK-78：E2 盖章唯一点在
  // 设备层），所以 kernel 的 `action_dispatch` 行按 SK-05 逐字带 redacted params
  // —— 那是活体口径（"审计带 redacted 副本"），不是 D-08 的适用面。两条口径的
  // 分界写在这里：`action_dispatch`/`action_result` 是**特权层**的账（她做了什么，
  // 参数在内），`converse/*`、`u3_cycle_*`、`inner_outer_pair` 是**对话面**的账
  // （只记长度/哈希，正文归 history 表 = 她的记忆）。
  const conversationFacing = audit.events.filter(
    (e) => e.type !== 'action_dispatch' && e.type !== 'action_result',
  )
  for (const event of conversationFacing) {
    const flat = JSON.stringify(event)
    assert.equal(flat.includes('在吗'), false, `event ${event.type} carries user text`)
    assert.equal(flat.includes('在的，怎么了'), false, `event ${event.type} carries reply text`)
  }
  // 反向钉住分界：**入站正文**在哪一层都不进事件流（她的话只有出站那条是动作
  // 参数；他的话从来不是），所以特权层的行也不许带用户原话。
  for (const event of audit.events) {
    assert.equal(JSON.stringify(event).includes('在吗'), false,
      `event ${event.type} carries user text`)
  }
  // E2 章：这条出站是"在场应答"，收件人 = 来话对端（设备层的结构事实）。
  const replySend = audit.events.find(
    (e) => e.type === 'action_dispatch' && e.action_type === 'messenger.send',
  )!
  assert.equal(replySend.exemption, 'E2')
  assert.equal(replySend.origin, 'interactive')
  // 库面写集：history 一行（全文归她的记忆）+ conversation 经验 + normal_interaction。
  const store = new ReadWriteMemory(dbPath)
  try {
    const rows = store.getRecentHistoryOfType('conversation', 10)
    assert.equal(rows.length, 1)
    assert.deepEqual(JSON.parse(rows[0]!.content), { user: '在吗', reply: '在的，怎么了？' })
    const exp = store.recentExperiences(5)
    assert.equal(exp[0]!.source, 'conversation')
    const causes = store.recentRegulationEvents(null, 10).map((r) => r.cause)
    assert.ok(causes.includes('normal_interaction'))
    // seedPersona 出生证：恰一条 preference（SA-168）。
    assert.equal(store.getInsights('preference').length, 1)
  } finally {
    store.close()
  }
})

test('失败路（红）：契约失败 → 重试一次 → 仍失败 → 降级沉默 + 失败事件元数据；不发、不横幅', async () => {
  const { audit, transport, telegram } = await assemble('她这次没有输出 JSON，直接开口说话了')
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '在吗' },
  })
  await telegram.pollOnce()

  assert.deepEqual(transport.sends, [], '沉默一路走到底（D-04：横幅不破坏沉默）')
  assertSubsequence(types(audit), [
    'telegram/inbound',
    'converse/received',
    'budget/charge', //     第一次调用
    'u3_cycle_retried', //  D-01：有界重试一次
    'budget/charge', //     第二次调用
    'u3_cycle_failed', //   仍失败 → 归因 + 元数据
    'inner_outer_pair', //  回合成立（reply=""）
    'converse/silence', //  设备侧不发
  ])
  const retried = audit.events.find((e) => e.type === 'u3_cycle_retried')!
  assert.equal(retried.reason, 'not_json')
  assert.equal(retried.attempt, 1)
  const failed = audit.events.find((e) => e.type === 'u3_cycle_failed')!
  assert.equal(failed.reason, 'not_json')
  assert.equal(failed.detail, 'first_char:cjk')
  assert.equal(failed.attempts, 2)
  assert.equal(failed.finish_reason, 'stop')
  assert.equal(failed.completion_tokens, 34, 'U3 缺陷①消灭：tokens 与失败同事件可关联')
  assert.equal(String(failed.error_type ?? ''), 'Error')
  // 正文零泄漏（detail 只是模板组合）。
  for (const event of audit.events) {
    assert.equal(JSON.stringify(event).includes('直接开口说话'), false)
  }
  assert.equal(audit.events.filter((e) => e.type === 'telegram/sent').length, 0)
})

test('沉默路（红）：tool_call 未接地 → demote → u3_cycle_tool_demoted + 沉默；工具零执行', async () => {
  const { audit, transport, telegram } = await assemble(JSON.stringify({
    meaning_assessment: [{ item: '他发来一句话', meaning: '他在等我', pull: 0.4 }],
    decision: {
      kind: 'tool_call',
      tool: { name: 'research_read_text', arguments: { url: 'https://example.com' } },
      reason: '我想自己去看看', // 不引用任何评估条目 → reason_not_grounded
    },
  }))
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '看下这个' },
  })
  await telegram.pollOnce()

  assert.deepEqual(transport.sends, [], '被降级的 tool_call 不执行、不说话')
  assertSubsequence(types(audit), [
    'telegram/inbound',
    'converse/received',
    'budget/charge',
    'decision_ungrounded', //     护栏账（lykoi-decide 的 demote 事件）
    'u3_cycle_envelope', //       demoted=true 的周期账
    'u3_cycle_tool_demoted', //   D-03：独立告警
    'inner_outer_pair',
    'converse/silence',
  ])
  const demotedEvent = audit.events.find((e) => e.type === 'u3_cycle_tool_demoted')!
  assert.equal(demotedEvent.original_kind, 'tool_call')
  assert.equal(demotedEvent.tool_name, 'research_read_text')
  const cycle = audit.events.find((e) => e.type === 'u3_cycle_envelope')!
  assert.equal(cycle.kind, 'silence')
  assert.equal(cycle.demote_why, 'reason_not_grounded')
  // 工具 URL 不进事件流（隐私：参数只记条数）。
  for (const event of audit.events) {
    assert.equal(JSON.stringify(event).includes('example.com'), false)
  }
  assert.equal(cycle.dispatched, null, 'demote 后工具字段不算 dispatched')
})

test('未绑定发送者仍被适配器闸住：不进对话心智、不花预算（S-06 全链回归）', async () => {
  const { audit, transport, telegram, budget } = await assemble(envelope())
  transport.queueUpdate({
    updateId: 2,
    message: { messageId: 200, chatId: 'chat-x', senderId: '8888', text: '陌生人来话' },
  })
  await telegram.pollOnce()
  assert.equal(types(audit).includes('converse/received'), false)
  assert.equal(budget.usage('mock').routeTokens, 0)
  assert.equal(transport.sends.length, 0)
})
