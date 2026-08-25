/**
 * M3-W2/W3 出口判据 —— **终端硬门实弹** + GK-14 e2e。
 *
 * **W3 起设备侧承重**：W2 版本在这里手写了"设备该做的那几步"（拿四项载荷、
 * 以入站 id 为 reply_to 调 requestApproval、把 owner 的答复喂给 handleOwnerAnswer）。
 * 本波那三步全部由真设备层自己做 —— 所以实弹现在只有**两次入站**，中间没有一行
 * 测试代码代替设备说话：
 *
 *   fake 入站「帮我跑 ls」(message_id=500)
 *     → 信封 tool_call terminal_exec
 *     → 真三层门（不可变核 HARD_ASK）→ ask → needs_approval
 *     → 认知侧 SK-77 四项载荷 `_delegated_ask`
 *     → **真设备层**（SK-77）取走载荷 → `_ask_about` 形状校验 → requestApproval
 *       (reply_to = 当轮入站 message_id) → 问句以她自己的 messenger.send 出去（E1 章）
 *   fake 入站「执行」(引用那条问句)
 *     → **真设备层 S-08 三级路由第一级**（SK-82，仅 isOwner）
 *     → SK-43 快通道（跳 LLM）→ execute_once
 *     → consume 原子点 → pre_approved 重派 → terminal.exec 真跑
 *     → 回执四分支之 EXEC_OK
 *
 * 唯一的替身是 `terminal.exec` 器官本身（M5 才到，经 `registerOrganHandler` 注入）
 * 与 LLM/网络。被实弹打穿的是**门与器官的全部治理面**（kernel dispatch / 三层门 /
 * 审批对话机 / 解释器 / immutable audit / 设备层出站），那一段一个替身都没有。
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
import { MemoryTelegramTransport, isolateOutboundState } from 'lykoi-adapter-telegram/testing'
import { clearOrganHandlers, registerOrganHandler } from 'lykoi-adapter-telegram'
import { bootstrapOwnerPreauthorization } from 'lykoi-kernel'
import { TOOL_TO_ACTION } from '../src/contract.ts'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function isolateKernelFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-approval-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  // M3-W3：出站器官的持久面同样钉进 tmpdir（数据纪律：仓库树零 state 写）。
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

/**
 * 唯一的替身：`terminal.exec`（执行器官归 M5）。经 `registerOrganHandler` 从 M5
 * 的接线位进来 —— **不扩动作面**（不在 KNOWN_ACTIONS 里的名字仍被 `_resolve`
 * 在碰资源命名空间之前拒掉）。返回它跑过的命令表。
 */
function fakeTerminal(): { ran: string[] } {
  const ran: string[] = []
  registerOrganHandler('terminal.exec', async (params) => {
    ran.push(String(params.command))
    return { stdout: 'file-a\nfile-b\n', exit_code: 0 }
  })
  return { ran }
}

/** 她这一轮出站消息的正文序（真 transport fake 记的那一份）。 */
function outboundTexts(transport: MemoryTelegramTransport): string[] {
  return transport.sends.map((s) => s.text)
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

test('出口判据 · 终端硬门实弹全链（W3 设备侧承重）：两次入站打穿门→问句→引用「执行」→快通道→execute_once→EXEC_OK', async (t) => {
  isolateKernelFiles()
  const terminal = fakeTerminal()
  t.after(() => clearOrganHandlers())
  const { audit, transport, telegram, service } = await assemble(
    toolEnvelope('terminal_exec', { command: 'ls' }),
  )
  // §2b 初始预授权（approval_model_v1；GK-9：部署期 owner 侧动作，这里由测试
  // 站在 owner 侧执行）。没有它 messenger.send 默认 "ask" —— 她没有审批就回不了
  // Kevin，而回不了 Kevin 就请示不了审批（S1B 死锁）。
  const boot = bootstrapOwnerPreauthorization('user_001')
  assert.deepEqual(boot.granted, ['messenger.send@user:user_001'])
  assert.equal(telegram.outboundWired(), true, '出站器官必须已接线，否则这不是实弹')

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

  // ② 认知侧四项载荷 → **设备侧取走并问出去**（SK-77 承重；device_side_wired 翻 true）
  assert.ok(audit.events.some((e) => e.type === 'approval_ask_delegated'))
  assert.ok(audit.events.some((e) => e.type === 'converse/silence')) // 回合本身沉默
  const pending = audit.events.find((e) => e.type === 'converse/approval_request_pending')!
  assert.equal(pending.device_side_wired, true, 'W3 出口判据：问句由设备层发')
  assert.equal(pending.action_type, 'terminal.exec')
  // 取走即清：设备层已经消费掉了，认知侧不再挂着（一轮一份）
  assert.equal(service.conversation.peekDelegatedAsk(), null)

  // 问句：她自己的 messenger.send，**reply_to = 当轮入站 message_id**
  //（只有设备层有它 —— E2 分层；没有它这条问句按主动打扰计费）
  assert.equal(transport.sends.length, 1)
  assert.equal(transport.sends[0]!.replyTo, '500')
  assert.match(transport.sends[0]!.text, /^有件事得你点头我才做: 在终端执行命令: 'ls'。可以吗\?$/)
  const questionSend = audit.events.filter(
    (e) => e.type === 'action_dispatch' && e.action_type === 'messenger.send',
  )
  assert.equal(questionSend.length, 1)
  assert.equal(questionSend[0]!.exemption, 'E1') // 审批机器自己的嘴（免问不免账）
  assert.equal(questionSend[0]!.decision, 'allow')
  const asked = audit.events.find((e) => e.type === 'approval_question' && e.stage === 'asked')!
  assert.equal(asked.outcome, 'asked')
  assert.equal(asked.delivered, true)
  const questionMessageId = String(asked.question_message_id)

  // ③ owner **引用**那条问句回「执行」→ 真设备层 S-08 路由第一级 → 快通道（跳 LLM）
  transport.queueUpdate({
    updateId: 2,
    message: {
      messageId: 501, chatId: '1001', senderId: '1001', text: '执行',
      replyToMessageId: questionMessageId,
    },
  })
  assert.equal(await telegram.pollOnce(), 1)
  const turn = audit.events.find((e) => e.type === 'telegram_approval_turn')!
  assert.equal(turn.outcome, 'execute_once')
  assert.equal(turn.executed, true)
  // **消费即 return**：这条消息就是那次审批回合，不再当成一次对话提示
  assert.equal(audit.events.filter((e) => e.type === 'converse/received').length, 1)

  // ④ 执行：consume 原子点 → pre_approved 重派 → terminal.exec 真跑一次
  assert.deepEqual(terminal.ran, ['ls'])
  const exec = audit.events.filter(
    (e) => e.type === 'action_dispatch' && e.action_type === 'terminal.exec' && e.pre_approved === true,
  )
  assert.equal(exec.length, 1)
  assert.equal(exec[0]!.decision, 'pre_approved')
  assert.equal(exec[0]!.action_id, pending.action_id) // action_id = grant id
  assert.equal(exec[0]!.correlation_id, pending.correlation_id) // correlation 透传全链
  assert.equal(exec[0]!.origin, 'interactive') // 原 origin
  const execution = audit.events.find((e) => e.type === 'approval_execution')!
  assert.equal(execution.executed, true)
  assert.equal(execution.success, true)

  // ⑤ 回执四分支之 EXEC_OK：做完了 + 输出，reply_to = 他那条消息（免预算）
  assert.equal(transport.sends.length, 2)
  assert.equal(transport.sends[1]!.replyTo, '501')
  assert.equal(transport.sends[1]!.text, "做完了: 在终端执行命令: 'ls'\n\nfile-a\nfile-b")

  // ⑥ 六元组 + answer_routed 落在同一个 immutable sink 上
  const six = audit.events.find((e) => e.type === 'approval_interaction')!
  assert.equal(six.risk_level, 'hard_gated')
  assert.equal(six.scope_key, null)
  assert.equal(six.standing_grant_created, false) // 硬门永不产生常设授权
  const routed = audit.events.find((e) => e.type === 'approval_answer_routed')!
  assert.equal(routed.outcome, 'execute_once')
  assert.equal(routed.executed, true)

  // ⑦ 同一条批准不可重放：第二次「执行」拿不到任何东西
  transport.queueUpdate({
    updateId: 3,
    message: {
      messageId: 502, chatId: '1001', senderId: '1001', text: '执行',
      replyToMessageId: questionMessageId,
    },
  })
  assert.equal(await telegram.pollOnce(), 1)
  assert.equal(terminal.ran.length, 1) // 命令仍然只跑过一次
  assert.equal(outboundTexts(transport).at(-1), '那条已经过期了, 要我重新问吗?') // 死问句最前拦
})

test('实弹反向（W3 设备侧）：owner 回「不要」→ denied + DENY_CONFIRM，命令一次都不跑', async (t) => {
  isolateKernelFiles()
  const terminal = fakeTerminal()
  t.after(() => clearOrganHandlers())
  const { transport, telegram, audit } = await assemble(
    toolEnvelope('terminal_exec', { command: 'rm -rf /tmp/x' }),
  )
  bootstrapOwnerPreauthorization('user_001')
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 600, chatId: '1001', senderId: '1001', text: '帮我清一下那个目录' },
  })
  assert.equal(await telegram.pollOnce(), 1)
  const asked = audit.events.find((e) => e.type === 'approval_question' && e.stage === 'asked')!
  assert.equal(asked.delivered, true)

  transport.queueUpdate({
    updateId: 2,
    message: {
      messageId: 601, chatId: '1001', senderId: '1001', text: '不要',
      replyToMessageId: String(asked.question_message_id),
    },
  })
  assert.equal(await telegram.pollOnce(), 1)

  const turn = audit.events.find((e) => e.type === 'telegram_approval_turn')!
  assert.equal(turn.outcome, 'denied')
  assert.equal(turn.executed, false)
  assert.deepEqual(terminal.ran, []) // 一次都没跑
  assert.equal(outboundTexts(transport).at(-1), '好, 这次不做。')
  // 硬门动作没有 scope key → 静默期记不下来（recordDenial 需要键）；它照样每次都问
  // —— 这正是硬门的语义，不是遗漏。
  const routed = audit.events.find((e) => e.type === 'approval_answer_routed')!
  assert.equal(routed.scope_key, null)
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
  const dispatched = audit.events.filter((e) => e.type === 'action_dispatch')
  // W3 起 audit 上还会多出**审批机器自己的嘴**那一行（设备层把问句问出去 ——
  // 它带豁免章，而信封从不自称说过它）。GK-14 的不变量是单向的"自称 ⟹ 有行"，
  // 所以对拍面限定在**没有豁免章**的那些行；带章的那些单独点名对拍，免得这条
  // 断言被一句"多出来的行不算"悄悄放宽。
  const recorded = dispatched.filter((e) => e.exemption === null).map((e) => String(e.action_type))
  const exempted = dispatched
    .filter((e) => e.exemption !== null)
    .map((e) => [String(e.action_type), String(e.exemption)])
  assert.deepEqual(claimed, ['terminal.exec'])
  assert.deepEqual(recorded, claimed) // 自称几条就有几行，且逐条同型
  assert.deepEqual(exempted, [['messenger.send', 'E1']]) // 问句本身：免问不免账
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
