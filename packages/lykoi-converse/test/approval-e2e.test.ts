/**
 * M3-W2 出口判据 —— **终端硬门实弹** + GK-14 e2e。
 *
 * 实弹全链（dev，LLM 全程 fake、零真网）：
 *   fake 入站「帮我跑 ls」
 *     → 信封 tool_call terminal_exec
 *     → 真三层门（不可变核 HARD_ASK）→ ask → needs_approval
 *     → 认知侧 SK-77 四项载荷 `_delegated_ask`
 *     → **fake 设备**（W3 的位置）拿载荷调 requestApproval（reply_to=当轮入站 id）
 *     → 问句以她自己的 messenger.send 出去（E1 章）
 *     → fake owner **引用**问句回「执行」
 *     → SK-43 快通道（跳 LLM）→ execute_once
 *     → consume 原子点 → pre_approved 重派 → terminal.exec 真跑
 *     → 回执四分支之 EXEC_OK
 *
 * 为什么设备侧是 fake：真设备层（telegram `_ask_about` 形状校验 / E2 盖章 /
 * S-08 三级路由 / 出站游标机）是 W3 的交付面，器官真身（messenger/terminal）
 * 也随 W3/M5 才到。所以这里注入 fake 资源注册表 + fake 设备调用序 —— 被实弹
 * 打穿的是**门与器官的全部治理面**（kernel dispatch / 三层门 / 审批对话机 /
 * 解释器 / immutable audit），那一段一个替身都没有。
 *
 * 数据纪律：治理 state 全走 tmpdir；db 走 createStateFixture 合成副本；golden
 * devstate 不触；断言只看结构与类型，她的行内容零输出。
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
import { createStateFixture } from 'lykoi-memory/testing'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import {
  bootstrapOwnerPreauthorization, createApprovalConversation, createDispatch,
  unwiredResources, type ResourceRegistry,
} from 'lykoi-kernel'
import { TOOL_TO_ACTION } from '../src/contract.ts'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function isolateKernelFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-approval-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
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

/**
 * fake 器官注册表：只把本波实弹需要的两件换成真身替身，其余仍是 W1 的"大声抛"。
 * messenger.send 记下每条出站并回一个递增 message_id（Telegram 的形状）；
 * terminal.exec 回一个 stdout。
 */
function fakeOrgans(): {
  resources: ResourceRegistry
  sent: { text: string; context_id: string; reply_to: string | null }[]
  ran: string[]
} {
  const base = unwiredResources() as unknown as Record<string, Record<string, unknown>>
  const sent: { text: string; context_id: string; reply_to: string | null }[] = []
  const ran: string[] = []
  const registry: Record<string, Record<string, (p: Record<string, unknown>) => Promise<unknown>>> = {}
  for (const [prefix, methods] of Object.entries(base)) {
    registry[prefix] = { ...(methods as Record<string, (p: Record<string, unknown>) => Promise<unknown>>) }
  }
  registry.messenger!.send = async (params) => {
    sent.push({
      text: String(params.text),
      context_id: String(params.context_id),
      reply_to: params.reply_to === null || params.reply_to === undefined ? null : String(params.reply_to),
    })
    return { sent: true, message_id: `q-${sent.length}` }
  }
  registry.terminal!.exec = async (params) => {
    ran.push(String(params.command))
    return { stdout: 'file-a\nfile-b\n', exit_code: 0 }
  }
  return { resources: registry as unknown as ResourceRegistry, sent, ran }
}

async function assemble(replyText: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-approval-db-'))
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
    ledgerPath: join(dir, 'budget.json'),
    dailyTotalTokens: 1_000_000,
    dailyRouteTokens: {},
  })
  await ctx.plugin(lykoiLlm)
  await ctx.plugin(mockAdapter, {
    provider: 'mock', replyText, promptTokens: 210, completionTokens: 34,
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
  })
  return {
    audit,
    transport,
    telegram: ctx.get('telegram') as TelegramAdapterService,
    service: ctx.get('converse') as converse.ConverseService,
  }
}

function toolEnvelope(name: string, args: Record<string, unknown>): string {
  return envelope({
    decision: { kind: 'tool_call', tool: { name, arguments: args }, reason: '他问我在不在' },
  })
}

test('出口判据 · 终端硬门实弹全链：入站 → 硬门 ask → 四项载荷 → 问句 → 引用「执行」→ 快通道 → execute_once → EXEC_OK 回执', async () => {
  isolateKernelFiles()
  const { audit, transport, telegram, service } = await assemble(
    toolEnvelope('terminal_exec', { command: 'ls' }),
  )
  // §2b 初始预授权（approval_model_v1；GK-9：部署期 owner 侧动作，这里由测试
  // 站在 owner 侧执行）。没有它 messenger.send 默认 "ask" —— 她没有审批就回不了
  // Kevin，而回不了 Kevin 就请示不了审批（S1B 死锁）。
  const boot = bootstrapOwnerPreauthorization('user_001')
  assert.deepEqual(boot.granted, ['messenger.send@user:user_001'])

  // ① 入站「帮我跑 ls」→ 信封点名 terminal_exec → 真硬门
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 500, chatId: '1001', senderId: '1001', text: '帮我跑 ls' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  const intent = audit.events.find((e) => e.type === 'action_dispatch')!
  assert.equal(intent.action_type, 'terminal.exec')
  assert.equal(intent.origin, 'interactive')
  assert.equal(intent.decision, 'ask') // 不可变核 HARD_ASK —— live 规则抬不掉
  assert.equal(intent.pre_approved, false)
  const gateResult = audit.events.find((e) => e.type === 'action_result')!
  assert.equal(gateResult.error, 'needs_approval')

  // ② 认知侧四项载荷（回合本身沉默 —— 问句就是那条消息）
  assert.ok(audit.events.some((e) => e.type === 'approval_ask_delegated'))
  assert.ok(audit.events.some((e) => e.type === 'converse/silence'))
  assert.deepEqual(transport.sends, []) // 回合没有复述
  const ask = service.conversation.takeDelegatedAsk()!
  assert.deepEqual(Object.keys(ask).sort(), ['action_id', 'action_type', 'correlation_id', 'params'])
  assert.equal(ask.action_type, 'terminal.exec')
  assert.deepEqual(ask.params, { command: 'ls' })

  // ③ fake 设备（W3 的位置）：以当轮入站 message_id 为 reply_to 去问。
  //   器官真身在这里注入 —— 被打穿的是门与审批机，不是传输。
  const organs = fakeOrgans()
  const dispatch = createDispatch({ sink: audit, resources: organs.resources })
  const approval = createApprovalConversation({ dispatch })
  const outcome = await approval.requestApproval(ask.action_type, ask.params, {
    contextId: '1001',
    replyTo: '500', // 当轮入站 id —— 只有设备层有它（E2 分层）
    origin: 'interactive',
    actionId: ask.action_id,
    correlationId: ask.correlation_id,
  })
  assert.equal(outcome.status, 'asked')
  assert.equal(outcome.pending_id, ask.action_id) // 排队 id = 撞门那次铸的 action_id
  assert.equal(outcome.scope_key, null) // terminal.exec 不可 scope

  // 问句：她自己的 messenger.send，带 reply_to（不计主动打扰预算）
  assert.equal(organs.sent.length, 1)
  assert.equal(organs.sent[0]!.reply_to, '500')
  assert.match(organs.sent[0]!.text, /^有件事得你点头我才做: 在终端执行命令: 'ls'。可以吗\?$/)
  const questionSend = audit.events.filter((e) => e.type === 'action_dispatch' && e.action_type === 'messenger.send')
  assert.equal(questionSend.length, 1)
  assert.equal(questionSend[0]!.exemption, 'E1') // 审批机器自己的嘴（免问不免账）
  assert.equal(questionSend[0]!.decision, 'allow')
  const asked = audit.events.find((e) => e.type === 'approval_question' && e.stage === 'asked')!
  assert.equal(asked.outcome, 'asked')
  assert.equal(asked.delivered, true)

  // ④ fake owner **引用**那条问句回「执行」→ SK-43 快通道（跳 LLM）
  const answer = await approval.handleOwnerAnswer('执行', {
    contextId: '1001',
    replyTo: outcome.question_message_id, // = 'q-1'
    messageId: '501',
  })
  assert.equal(answer.outcome, 'execute_once')
  assert.equal(answer.executed, true)
  assert.equal(answer.replied, true)

  // ⑤ 执行：consume 原子点 → pre_approved 重派 → terminal.exec 真跑一次
  assert.deepEqual(organs.ran, ['ls'])
  const exec = audit.events.filter(
    (e) => e.type === 'action_dispatch' && e.action_type === 'terminal.exec' && e.pre_approved === true,
  )
  assert.equal(exec.length, 1)
  assert.equal(exec[0]!.decision, 'pre_approved')
  assert.equal(exec[0]!.action_id, ask.action_id) // action_id = grant id
  assert.equal(exec[0]!.correlation_id, ask.correlation_id) // correlation 透传全链
  assert.equal(exec[0]!.origin, 'interactive') // 原 origin
  const execution = audit.events.find((e) => e.type === 'approval_execution')!
  assert.equal(execution.executed, true)
  assert.equal(execution.success, true)

  // ⑥ 回执四分支之 EXEC_OK：做完了 + 输出，reply_to = 他那条消息（免预算）
  assert.equal(organs.sent.length, 2)
  assert.equal(organs.sent[1]!.reply_to, '501')
  assert.equal(organs.sent[1]!.text, "做完了: 在终端执行命令: 'ls'\n\nfile-a\nfile-b")

  // ⑦ 六元组 + answer_routed 落在同一个 immutable sink 上
  const six = audit.events.find((e) => e.type === 'approval_interaction')!
  assert.equal(six.risk_level, 'hard_gated')
  assert.equal(six.scope_key, null)
  assert.equal(six.standing_grant_created, false) // 硬门永不产生常设授权
  const routed = audit.events.find((e) => e.type === 'approval_answer_routed')!
  assert.equal(routed.outcome, 'execute_once')
  assert.equal(routed.executed, true)

  // ⑧ 同一条批准不可重放：第二次「执行」拿不到任何东西
  const replay = await approval.handleOwnerAnswer('执行', {
    contextId: '1001', replyTo: outcome.question_message_id, messageId: '502',
  })
  assert.equal(replay.outcome, 'expired') // 死问句最前拦（GK-5 单一文案）
  assert.equal(organs.ran.length, 1) // 命令仍然只跑过一次
  assert.equal(organs.sent[2]!.text, '那条已经过期了, 要我重新问吗?')
})

test('实弹反向：owner 回「不要」→ denied + DENY_CONFIRM，命令一次都不跑（硬门 deny 出口）', async () => {
  isolateKernelFiles()
  const { transport, telegram, service, audit } = await assemble(
    toolEnvelope('terminal_exec', { command: 'rm -rf /tmp/x' }),
  )
  bootstrapOwnerPreauthorization('user_001')
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 600, chatId: '1001', senderId: '1001', text: '帮我清一下那个目录' },
  })
  assert.equal(await telegram.pollOnce(), 1)
  const ask = service.conversation.takeDelegatedAsk()!

  const organs = fakeOrgans()
  const approval = createApprovalConversation({
    dispatch: createDispatch({ sink: audit, resources: organs.resources }),
  })
  const outcome = await approval.requestApproval(ask.action_type, ask.params, {
    contextId: '1001', replyTo: '600', actionId: ask.action_id, correlationId: ask.correlation_id,
  })
  assert.equal(outcome.status, 'asked')

  const answer = await approval.handleOwnerAnswer('不要', {
    contextId: '1001', replyTo: outcome.question_message_id, messageId: '601',
  })
  assert.equal(answer.outcome, 'denied')
  assert.equal(answer.executed, false)
  assert.deepEqual(organs.ran, []) // 一次都没跑
  assert.equal(organs.sent.at(-1)!.text, '好, 这次不做。')
  // 硬门动作没有 scope key → 静默期记不下来（recordDenial 需要键）；它照样
  // 每次都问 —— 这正是硬门的语义，不是遗漏。
  assert.equal(answer.scope_key, null)
})

// --- GK-14 e2e（DK-07 定案；W2 必立） -----------------------------------------

/** 一条 u3_cycle_envelope 自称 dispatched 且那个工具是**会派发**的动作。 */
function selfReportedDispatches(events: AuditEvent[]): string[] {
  return events
    .filter((e) => e.type === 'u3_cycle_envelope')
    .map((e) => e.dispatched)
    .filter((name): name is string => typeof name === 'string' && name in TOOL_TO_ACTION)
    .map((name) => TOOL_TO_ACTION[name]!)
}

test('GK-14 正断言：信封自称 dispatched ⟹ audit 有对应的 action_dispatch 行（逐条同型同数）', async () => {
  isolateKernelFiles()
  const { audit, transport, telegram } = await assemble(
    toolEnvelope('terminal_exec', { command: 'ls' }),
  )
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 700, chatId: '1001', senderId: '1001', text: '帮我跑 ls' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  const claimed = selfReportedDispatches(audit.events)
  const recorded = audit.events
    .filter((e) => e.type === 'action_dispatch')
    .map((e) => String(e.action_type))
  assert.deepEqual(claimed, ['terminal.exec'])
  assert.deepEqual(recorded, claimed) // 自称几条就有几行，且逐条同型
  assert.ok(claimed.length > 0, '这个夹具必须真的自称过一次，否则正断言是空转')
})

test('GK-14 反断言：没有自称 dispatched ⟹ audit **一行** action_dispatch 都没有（demote 路）', async () => {
  isolateKernelFiles()
  // 未接地的 tool_call 被护栏 demote 成沉默 —— 她想动手却被闸掉，工具零执行。
  const { audit, transport, telegram } = await assemble(envelope({
    decision: {
      kind: 'tool_call',
      tool: { name: 'terminal_exec', arguments: { command: 'ls' } },
      reason: '我自己想跑一下', // 不引用 assessment.item → 未接地
    },
  }))
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 800, chatId: '1001', senderId: '1001', text: '在吗' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  assert.ok(audit.events.some((e) => e.type === 'u3_cycle_tool_demoted'))
  assert.deepEqual(selfReportedDispatches(audit.events), [])
  assert.equal(audit.events.filter((e) => e.type === 'action_dispatch').length, 0)
  assert.equal(audit.events.filter((e) => e.type === 'action_result').length, 0)
  // 反向也成立：既然一行都没有，就不可能有 approval 器官的任何一步
  assert.equal(audit.events.filter((e) => e.type === 'approval_question').length, 0)
})
