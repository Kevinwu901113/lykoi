/**
 * Conversation —— 回合骨架 + 真装配器 + 信封周期（cognition/conversation.py 的
 * Conversation 类对应物；S-12..S-34 装配面 + S-35..S-53 信封面 + G-10 修正版）。
 *
 * 三段带（S-23，CACHE-INVERT）：
 *
 *   [稳定前缀]  persona 头(内核+重启叙事+纪律+acquired+转正结论) → 器官清单
 *               → 自我叙事 → 重启回灌 → 早前对话摘要 → 活跃关切（末尾！S-24）
 *   [历史]      #messages[1:]
 *   [易变尾部]  相关记忆 → 念头 → 当前时间 → 有话没送出去 → self-state（S-25）
 *
 * 字节在轮与轮之间不变的块全部先于 append-only 的历史，可匹配前缀随对话增长
 * 而不是被钉死在 message 0。空态零字节（S-26）：任何可空块为空时不加块、不加
 * 占位。稳定前缀的失效印记 = (integration_state.last_integration_at, 最新
 * focus_cycles.id)，跨进程可读；读不到 → 保持现状（S-27）。
 *
 * 信封周期（新体出生形态）：对话路径**生而信封** —— 每周期一次 completion +
 * parseEnvelope，四选一（reply/silence/tool_call/promise_followup）。失败方向
 * = 沉默（不变量 3）：契约失败经 D-01 的有界重试一次后仍败 → 降级沉默 +
 * u3_cycle_failed（带原始响应元数据，D-08 口径全部非内容）。
 *
 * D-01 的另一半（M4-W1）：**周期有一条时间上的边**（`cycleTimeoutS`，缺省
 * `D01_CYCLE_TIMEOUT_S`）。撞线不降级成沉默 —— 一次挂死的调用与她选择不说话
 * 在账上必须分得开：`u3_cycle_timeout` + S-14 整轮回滚 + 大声抛。
 *
 * M3 接口位（显式替身，绝不静默成功）：kernel dispatch 已接真身（W1）、审批
 * 问句机已接真身（W2：SK-77 四项载荷 → kernel approval-conversation）；仍为
 * 替身的是 vision 模型 / 出站进度队列 / interactive_lock / 未送达账本的生产侧
 * （随 W3 出站器官波）。
 */
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  applyInner, buildPersonaKernel, buildPersonaPrompt,
  emitCapabilityGap, GAP_NOT_WIRED, GAP_UNKNOWN_ACTION,
  type InnerBlock, type LogEvent, type PersonaConfig, type SanitizedThought,
} from 'lykoi-decide'
import { retrieveForConcern } from 'lykoi-learn'
import {
  conversationTurnReflow, emptyNotifications,
  type NotificationsView, type ReplyToNotification,
} from 'lykoi-reflow'
import { THOUGHT_SNAPSHOT_TOP } from 'lykoi-regulation'
import { pyRound, renderRestartNotice, type RestartEvent } from 'lykoi-snapshot'
import {
  buildEnvelopeMessages, classifyFailure, cycleCall, cycleRecord, parseEnvelope,
  envelopeJsonMode,
  CONVERSATION_INNER_ENABLED, CYCLE_EVENT, CYCLE_FAILURE_EVENT, CYCLE_RETRY_EVENT,
  CYCLE_TOOL_BUDGET_EVENT, CYCLE_TOOL_DEMOTED_EVENT, CYCLE_TOOL_UNWIRED_EVENT,
  CYCLE_UNKNOWN_TOOL_EVENT,
  ENVELOPE_RESPONSE_FORMAT, ENVELOPE_RETRY_MAX, FAIL_NOT_JSON, FOLLOWUP_TOOL,
  MAX_TOOL_STEPS, PROGRESS_TOOL, PROMISE_FOLLOWUP, REPLY, SILENCE, TOOL_CALL,
  TOOL_TO_ACTION, toolDispatchGate, VISION_TOOL,
  type ConverseMessage, type Decision, type ToolCall,
} from './contract.ts'
import {
  CYCLE_TIMEOUT_EVENT, D01_CYCLE_TIMEOUT_S, DeadlineExceededError, deadlineMs,
  monotonicNowMs, withDeadline,
} from './deadline.ts'
import {
  beijingClock, beijingStamp, collapseWs, cpSlice, estimateMessagesTokens,
  pyFloatStr, stripMarkup,
} from './hygiene.ts'
import {
  BACKFILL_HEADER, CONCERNS_HEADER, CONTEXT_BUDGET_SKELETON, CYCLE_CLOSING_NOTE,
  MEMORIES_HEADER, NARRATIVE_HEADER, PROMOTED_INSIGHTS_HEADER, RELATIONSHIP_OVERLAY_HEADER,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARY_SKELETON, SYSTEM_PROMPT, THOUGHTS_HEADER, UNDELIVERED_HEADER, fmt,
} from './prompts.ts'

// --- Context governance 常量（S-28；conversation.py:72-107 逐字，env 可覆写） ----

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  const parsed = Number.parseInt(raw, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export const CONTEXT_WINDOW_TURNS = envInt('LYKOI_CONTEXT_WINDOW_TURNS', 8)
export const CONTEXT_BACKFILL_ROWS = envInt('LYKOI_CONTEXT_BACKFILL_ROWS', 20)
export const CONTEXT_MAX_INPUT_TOKENS = envInt('LYKOI_CONTEXT_MAX_INPUT_TOKENS', 50000)
export const SUMMARY_MAX_TOKENS = 1024
export const SUMMARY_TEMPERATURE = 0.3
export const BACKFILL_CLIP_CHARS = 400
export const NARRATIVE_CLIP_CHARS = 2000
export const TOOL_RESULT_CLIP_CHARS = 300
export const UNDELIVERED_CONTEXT_MAX = 3
export const L3_PROBE_MAX_CHARS = 200
export const L3_RETRIEVAL_LIMIT = 6
export const L3_LINE_CHARS = 80
export const CONCERNS_CONTEXT_MAX = 5
export const CONCERNS_DESC_CHARS = 60

// --- 装配块的稳定名字（S-23；conversation.py:113-124 逐字 12 块） ---------------

export const BLOCK_PERSONA = 'persona'
export const BLOCK_ORGANS = 'organs'
export const BLOCK_CONCERNS = 'concerns'
export const BLOCK_NARRATIVE = 'narrative'
export const BLOCK_BACKFILL = 'backfill'
export const BLOCK_SUMMARY = 'summary'
export const BLOCK_HISTORY = 'history'
export const BLOCK_MEMORIES = 'memories'
export const BLOCK_THOUGHTS = 'thoughts'
export const BLOCK_TIME = 'time'
export const BLOCK_UNDELIVERED = 'undelivered'
export const BLOCK_SELF_STATE = 'self_state'

/**
 * 一整轮塞不进硬预算（S-20/S-30）：surface 呈现为清晰的 message_too_large，
 * 而不是让 provider 用一个不透明错误拒掉超限载荷。
 */
export class ContextBudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextBudgetError'
  }
}

// --- 依赖面 --------------------------------------------------------------------

type Fields = Record<string, unknown>
type RawRowLike = Record<string, unknown>

/** 对话路径的 store 面（lykoi-memory/rw ReadWriteMemory 的结构化子集）。 */
export interface ConverseStore {
  // 装配读面
  getRecentHistoryOfType(eventType: string, n: number): { id: number; ts: string; content: string }[]
  listConcerns(status?: string | readonly string[]): {
    id: number; title: string; description: string; weight: number
  }[]
  currentCognitiveNarrative(): { content: string } | undefined
  getThoughtsForSnapshot(topN: number): { id: number; kind: string; charge: number; content: string }[]
  getInsights(category: string | null): { content: string }[]
  /** S-34/W4#2：转正结论唯一消费口 —— 不是 listFocusInsights 全集。 */
  promotedFocusInsights(): RawRowLike[]
  /** WO-PERS-OVERLAY-01（D-4/D-5）：键到**这个人**的相处方式条目。 */
  promotedRelationshipInsights(subjectUserId: string): RawRowLike[]
  getIntegrationState(): RawRowLike
  currentFocusCycleId(): number
  ownerPrimaryUserId(): string | null
  relevanceCandidateRows(opts: {
    terms: readonly string[]
    subjectUserId: string | null
    since: string | null
    until: string | null
  }): RawRowLike[]
  // 回合写面
  appendHistory(eventType: string, content: string, opts: { now: Date }): number
  // 回流面（conversationTurnReflow）
  recordExperience(
    source: 'conversation' | 'wake_action' | 'action_result' | 'silence' | 'owner_event' | 'system' | 'thought_lapse' | 'environment',
    content: string,
    opts: { salience?: number; relatedConcernId?: number | null; now: Date },
  ): number
  applyRegulationCause(cause: string, opts: { now: Date }): unknown
  lastCauseEventTs(causes: readonly string[]): string | null
  lightConcern(concernId: number, opts: { now: Date }): unknown
  appendThreadProgress(threadId: number, line: string, opts: { now: Date }): void
  tendConcernDescription(concernId: number, description: string, opts: { now: Date }): void
  appendAutonomyNote(
    autonomyRunId: string, kind: string, content: string,
    opts: { sourceType?: string | null; now: Date },
  ): number
  // inner 面（applyInner）
  createThought(
    content: string,
    kind: SanitizedThought['kind'],
    source: 'wake' | 'conversation' | 'integration' | 'contemplate',
    opts: { relatedConcernId?: number | null; chargeHint?: number; now: Date },
  ): number | null
  resolveThought(id: number, injectedIds: Iterable<number>): boolean
}

/** 一次 LLM 调用的结果面（D-01 失败元数据的来源；全部非内容）。 */
export interface ConverseLlmResult {
  content: string | null
  finishReason?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  /** 原始响应 role/content 之外的键名（能暴露 reasoning_content 的存在，不泄内容）。 */
  extraKeys?: readonly string[]
}

export type ConverseLlmFn = (
  messages: ConverseMessage[],
  opts: {
    purpose: 'envelope' | 'summary'
    /** S-52：json 强制只在信封调用生效；summary 恒 null。 */
    responseFormat: typeof ENVELOPE_RESPONSE_FORMAT | null
    maxTokens?: number
    temperature?: number
    runId: string
    /**
     * D-01（M4-W1）：周期超时的 AbortSignal 形态。信封调用带它 —— 周期撞线时
     * 那一跳**真的被掐断**（dsh-llm `GenerateOptions.signal` 收它），而不只是
     * 这边不等了。summary 在锁外、不属于周期，恒不带。
     */
    signal?: AbortSignal
  },
) => Promise<ConverseLlmResult>

export interface ConverseObservation {
  success: boolean
  data?: unknown
  error?: string | null
}

/** kernel dispatch 接口位（M3 真 kernel；origin 由实现方盖章，永不由模型给）。 */
export type ConverseDispatchFn = (
  action: { type: string; params: Record<string, unknown> },
  context: { origin: 'interactive' },
) => Promise<ConverseObservation>

// --- WO-FIX-APPROVAL-UX ②：老横幅退役（cognition/conversation.py:428 迁入） ----
// 它取代的那个横幅会把一行裸的 `POST /approvals/{id}/approve` 打进聊天。它是为
// Mac 客户端写的 —— 在那里那个端点是唯一的应答方式；在 Telegram 里它是一条
// Kevin 无法执行的指令，而 2026-08-12 他在一次交流里收到了**四遍**，因为每一个
// 撞到门的工具步骤都会再打一次。端点本身留着（所有者控制台仍经它了结待批动作），
// 退役的是对话里的那个横幅。问是审批器官的活了：`requestApproval` 把问句说成
// 一句话、发进他的聊天、连同问句那条消息的 id 一起记下来（于是他的回复可归属），
// 并且拒绝就同一条悬置动作问第二遍。
/** 15 字逐字，sha256 66b17e24…（SPEC-KERNEL §2 D 段）。 */
export const ASK_FALLBACK = '这事需要你点头, 我稍后再问。'

/**
 * SK-77 认知侧协议：交给"拥有这场对话的调用方"去问的待批动作载荷，**恰四项**。
 * 入站 message_id 一个字节都不进来（E2 分层：对端是谁只在设备层是结构事实）。
 */
export const DELEGATED_ASK_FIELDS = ['action_type', 'params', 'action_id', 'correlation_id'] as const

export interface DelegatedAsk {
  action_type: string
  params: Record<string, unknown>
  action_id: string
  correlation_id: string | null
}

/** kernel dispatch 未接线（M3）时的显式替身：一切外部动作大声失败，绝不静默成功。 */
export const unwiredConverseDispatch: ConverseDispatchFn = async (action) => ({
  success: false,
  error: `kernel dispatch 未接线(M3):${action.type} 不可达`,
})

/** 未送达账本读面（shared/chat_outbox 未送达半面；生产侧随 M3 出站器官）。 */
export interface UndeliveredView {
  unsurfaced(limit: number): { id: number; ts?: string | null; text_summary?: string | null }[]
  markSurfaced(ids: readonly number[]): void
}

export interface ConverseDeps {
  store: ConverseStore
  persona: PersonaConfig
  llm: ConverseLlmFn
  logEvent: LogEvent
  /** 器官清单（lykoi-decide OrganInventoryCache 形状）。 */
  organs: { block(): string | null; invalidate(): void }
  clock?: () => Date
  /** 重启叙事的读面（latestRestartEvent；每进程生命周期建入上下文一次）。 */
  restartEvent?: () => RestartEvent | null
  notifications?: NotificationsView
  /** kernel notifications.mark_replied 接口位（M3）。 */
  markReplied?: (notificationId: number, historyId: number, now: Date) => void
  undelivered?: UndeliveredView
  dispatchFn?: ConverseDispatchFn
  /** vision 模型接口位（M3）：attachment 路径 + 可选问题 → 描述文本。 */
  describeImage?: (path: string, question: string | null) => Promise<string>
  /** 出站进度队列接口位（chat_outbox.append 对应；M3 出站器官）。 */
  postProgress?: (content: string) => void
  /** self-state 注入接口位（活体缺省 disabled = null 不注入）。 */
  selfState?: () => ConverseMessage | null
  /** interactive_lock.mark_active 接口位（S-17；M3 接 wake 仲裁）。 */
  markActive?: () => void
  /** 演化叙事 flag 文件路径（存在才注入；owner 域动作）。 */
  narrativeFlagPath?: string
  /**
   * D-01 周期超时（秒；M4-W1 交付①）。一个对话周期 = 信封调用 + 工具派发全程；
   * 撞线 = 整轮按 S-14 回滚 + `u3_cycle_timeout` 落账 + 大声抛（设备侧那一层
   * 记 `converse/turn_failed`，对 Kevin 呈现为沉默）。**不降级成"假装沉默"**：
   * 一次挂死的调用与一次她选择不说话，在账上必须分得开。
   *
   * 缺省 = `D01_CYCLE_TIMEOUT_S`（源码单一出处）；`0` = 不设限（旧行为）。
   */
  cycleTimeoutS?: number
  /** 对话情境念头出口熔断（测试面；缺省 = CONVERSATION_INNER_ENABLED）。 */
  innerEnabled?: boolean
  /** 测试面（Python 侧以 monkeypatch 模块常量实现同一件事）。 */
  limits?: Partial<{ windowTurns: number; backfillRows: number; maxInputTokens: number }>
  /**
   * WO-FIX-LOOP-01 D-1d：真接得通的动作子集（`wiredActionCatalog(resources).
   * knownActions` 的 Set 化）。`#buildAction` 拿它挡"在 TOOL_TO_ACTION 词表里
   * 但注册表里仍是替身"的动作——不给 → 行为逐字节不变（既有测试与生产以外的
   * 调用点零改动）。
   */
  wiredActions?: ReadonlySet<string>
}

// --- 小工具 --------------------------------------------------------------------

function sha16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 简单互斥（asyncio.Lock 对应）：回合与摘要各一把（S-12）。 */
class AsyncLock {
  #tail: Promise<void> = Promise.resolve()

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.#tail
    let release!: () => void
    this.#tail = new Promise((resolve) => {
      release = resolve
    })
    await prev
    try {
      return await fn()
    } finally {
      release()
    }
  }
}

/**
 * D-04（G-10 修正版）：审批横幅的装配点。reply 为空（silence 回合）时**不加
 * 横幅** —— 沉默作为一个正当动作必须能一路走到底，不被基础设施推翻；本轮就是
 * 审批问句时也不加（双重警告）。pending 的权威源 = kernel `pendingCount()`，
 * 由拥有对话的调用方在装配点递进来（设备侧接线归 M3-W3）。
 */
export function composeSurfaceReply(
  reply: string,
  pending: number,
  isAwaitingApproval: boolean,
): string {
  if (pending > 0 && reply && !isAwaitingApproval) {
    return `⚠️ 有 ${pending} 条待批准操作。\n\n${reply}`
  }
  return reply
}

// --- Conversation --------------------------------------------------------------

export class Conversation {
  #deps: ConverseDeps
  #messages: ConverseMessage[]
  #prefixEpoch: string | null
  #organsBlock: string | null
  #concerns: ConverseMessage | null
  #backfill: string | null
  #summary: string | null = null
  #lock = new AsyncLock()
  #summaryLock = new AsyncLock()
  #lastInjectedThoughtIds: number[] = []
  #pendingUndeliveredIds: number[] = []
  #relevantMemories: ConverseMessage | null = null
  #followupRequest: string | null = null
  /** SK-77 认知侧：交给调用方去问的待批动作载荷（一轮一份，取走即清）。 */
  #delegatedAsk: DelegatedAsk | null = null
  #background = false
  #cycleInner: string | null = null
  #lastRunId = ''
  /** S-56：截图路径永不交给模型 —— 只发不透明 attachment id（进程内注册表）。 */
  #attachments = new Map<string, string>()

  constructor(deps: ConverseDeps) {
    this.#deps = deps
    this.#messages = [this.#buildPersonaMessage()]
    // 稳定前缀的三块进程内缓存 + 失效印记，种在构造期（开场第一轮不白重建）。
    this.#prefixEpoch = this.#nightlyEpoch()
    this.#organsBlock = deps.organs.block()
    this.#concerns = this.#renderConcernsBlock()
    this.#backfill = this.#buildBackfill()
    // 熔断状态每次构造落一条 —— 改常量的重启在事件流里可见。
    this.#log('conversation_inner_state', { enabled: this.#innerEnabled() })
  }

  #now(): Date {
    return this.#deps.clock?.() ?? new Date()
  }

  #log(name: string, fields: Fields): void {
    this.#deps.logEvent(name, fields)
  }

  #innerEnabled(): boolean {
    return this.#deps.innerEnabled ?? CONVERSATION_INNER_ENABLED
  }

  #limit(key: 'windowTurns' | 'backfillRows' | 'maxInputTokens'): number {
    const overrides = this.#deps.limits ?? {}
    if (key === 'windowTurns') return overrides.windowTurns ?? CONTEXT_WINDOW_TURNS
    if (key === 'backfillRows') return overrides.backfillRows ?? CONTEXT_BACKFILL_ROWS
    return overrides.maxInputTokens ?? CONTEXT_MAX_INPUT_TOKENS
  }

  // --- persona 头（S-24 第一块） ----------------------------------------------

  /**
   * 她的 system prompt，分层：先天内核（与自主唤醒逐字节相同 —— 同一个装配
   * 函数，SA-154）→ 重启叙事（若刚醒）→ 操作纪律 → 后天 insights → 转正结论
   * （W4#2 唯一消费口）。整合边界重建，不是每轮（S-27）。
   */
  #buildPersonaMessage(): ConverseMessage {
    const parts = [buildPersonaKernel(this.#deps.persona)]
    const notice = renderRestartNotice(this.#deps.restartEvent?.() ?? null)
    if (notice) parts.push(notice)
    parts.push(SYSTEM_PROMPT)
    const acquired = buildPersonaPrompt(this.#deps.store).trim()
    if (acquired) parts.push(acquired)
    const promoted = this.#promotedInsightsSection()
    if (promoted) parts.push(promoted)
    const overlay = this.#relationshipOverlaySection()
    if (overlay) parts.push(overlay)
    return { role: 'system', content: parts.join('\n\n') }
  }

  /**
   * S-34：**只读 promotedFocusInsights()**（= status active），不是
   * listFocusInsights() 全集 —— shadow 还没熬过复核期、contested 正被她自己
   * 质疑、revised/withdrawn 已作废：一条都不进上下文，那正是影子门的语义。
   * 只叠在对话路径，不进 buildPersonaPrompt（那是 decide 共用的投影）。
   */
  #promotedInsightsSection(): string {
    let rows: RawRowLike[]
    try {
      rows = this.#deps.store.promotedFocusInsights()
    } catch (exc) {
      // 读不到就是这一层今天不叠。
      this.#log('promoted_insights_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return ''
    }
    const lines = rows
      .map((row) => String(row.content ?? '').trim())
      .filter((content) => content.length > 0)
      .map((content) => `- ${content}`)
    if (lines.length === 0) return '' // 判据⑧a：空态零字节
    this.#log('promoted_insights_injected', { count: lines.length })
    return PROMOTED_INSIGHTS_HEADER + lines.join('\n')
  }

  /**
   * WO-PERS-OVERLAY-01（D-5）：慢变层的"对谁"维度——她和**眼前这个人**相处的方式。
   *
   * 与上一段的分工不是重要性而是作用域：转正结论对谁都成立，overlay 条目脱开那个人
   * 就没有意义。所以这里多一个 subject 参数，而那里没有。
   *
   * subject = `store.ownerPrimaryUserId()`：`Conversation` 是**单实例单对话者**
   * （converse 对所有绑定发信人走同一个实例的 send，本身不知道本轮是谁），而现体
   * 能与她对话的只有 owner。给 send 加对话者参数是多对话者那一单的结构改动，不在
   * 这里顺手做——真做了也只会是一个永远等于 owner 的参数。
   *
   * subject 为 null（owner 未登记）或读回为空 → **零字节**，与转正结论段同口径：
   * 没有内容时连标题都不出现，人格块逐字节回到本单之前的形态。
   * 读失败 → 一条事件 + 零字节：读不到就是这一层今天不叠，不是整轮对话失败。
   */
  #relationshipOverlaySection(): string {
    const subject = this.#deps.store.ownerPrimaryUserId()
    if (subject === null) return ''
    let rows: RawRowLike[]
    try {
      rows = this.#deps.store.promotedRelationshipInsights(subject)
    } catch (exc) {
      this.#log('relationship_overlay_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return ''
    }
    const lines = rows
      .map((row) => String(row.content ?? '').trim())
      .filter((content) => content.length > 0)
      .map((content) => `- ${content}`)
    if (lines.length === 0) return ''
    this.#log('relationship_overlay_injected', {
      count: lines.length, subject_user_id: subject,
    })
    return RELATIONSHIP_OVERLAY_HEADER + lines.join('\n')
  }

  /** 重启回灌：最近的 history(conversation) 行（自旧到新），每侧裁 400 字。 */
  #buildBackfill(): string | null {
    const rows = this.#deps.store.getRecentHistoryOfType('conversation', this.#limit('backfillRows'))
    const entries: string[] = []
    let skipped = 0
    for (const row of rows) {
      let user: string
      let reply: string
      try {
        const exchange: unknown = JSON.parse(row.content)
        if (!isPlainObject(exchange) || !('user' in exchange) || !('reply' in exchange)) {
          throw new TypeError('malformed exchange')
        }
        user = cpSlice(String(exchange.user), BACKFILL_CLIP_CHARS)
        // 读侧卫生（S-32）：已落库的 DSML 泄漏行不再经回灌重新进入上下文。
        reply = cpSlice(stripMarkup(String(exchange.reply)), BACKFILL_CLIP_CHARS)
      } catch {
        skipped += 1 // an unreadable row is dropped, never invented
        continue
      }
      entries.push(`[${row.ts}] Kevin: ${user}\n我: ${reply}`)
    }
    if (skipped > 0) {
      // 静默丢弃会让历史损坏变成安静的失忆 —— 大声。
      this.#log('backfill_rows_skipped', { skipped, total: rows.length })
    }
    if (entries.length === 0) return null
    return BACKFILL_HEADER + '\n\n' + entries.join('\n\n')
  }

  // --- 整合边界刷新（S-27） ---------------------------------------------------

  /**
   * 夜间机器走过一遍的印记，**跨进程可读**：integration_state.last_integration_at
   * （层 1，只在 accepted_any 时变）+ 最新 focus_cycles.id（层 2，转正不写
   * integration_state，只看层 1 会漏掉"昨晚有一条结论转正了"）。
   * 读不到 → null → 调用方保持现状（不重建、不报错）。
   */
  #nightlyEpoch(): string | null {
    try {
      const last = this.#deps.store.getIntegrationState().last_integration_at ?? null
      const cid = this.#deps.store.currentFocusCycleId()
      return JSON.stringify([last, cid === 0 ? null : cid])
    } catch (exc) {
      this.#log('nightly_epoch_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return null
    }
  }

  /** 印记变了才重建人格头/器官/关切，落 stable_prefix_rebuilt（≤1 次/整合边界）。 */
  #refreshIdentityIfStale(): void {
    const epoch = this.#nightlyEpoch()
    if (epoch === null || epoch === this.#prefixEpoch) return
    this.#prefixEpoch = epoch
    this.#deps.organs.invalidate() // 绑定可能变了，清单跟着重新派生
    this.#organsBlock = this.#deps.organs.block()
    this.#concerns = this.#renderConcernsBlock()
    this.#messages[0] = this.#buildPersonaMessage()
    this.#log('stable_prefix_rebuilt', { reason: 'nightly_epoch' })
  }

  // --- 稳定前缀（S-24 实际发出顺序） ------------------------------------------

  #stablePrefix(): [string, ConverseMessage][] {
    this.#refreshIdentityIfStale()
    const blocks: [string, ConverseMessage][] = [[BLOCK_PERSONA, this.#messages[0]!]]
    if (this.#organsBlock) {
      blocks.push([BLOCK_ORGANS, { role: 'system', content: this.#organsBlock }])
    }
    // 演化叙事：flag 文件门控（owner 域，touch/rm 即时生效）；strict-empty
    // narrative_only 已在 store 读点排除。
    const flagPath = this.#deps.narrativeFlagPath
    const narrative = flagPath && existsSync(flagPath)
      ? this.#deps.store.currentCognitiveNarrative()
      : undefined
    if (narrative) {
      blocks.push([BLOCK_NARRATIVE, {
        role: 'system',
        content: NARRATIVE_HEADER + cpSlice(narrative.content, NARRATIVE_CLIP_CHARS),
      }])
    }
    if (this.#backfill) {
      blocks.push([BLOCK_BACKFILL, { role: 'system', content: this.#backfill }])
    }
    if (this.#summary) {
      blocks.push([BLOCK_SUMMARY, { role: 'system', content: fmt(SUMMARY_SKELETON, this.#summary) }])
    }
    // S-24：concerns 在稳定段**末尾**（实际发出顺序为准，不是常量声明序）。
    if (this.#concerns !== null) {
      blocks.push([BLOCK_CONCERNS, this.#concerns])
    }
    return blocks
  }

  /**
   * 〔活跃关切(只读)〕—— 最多 5 条。稳定段而非易变尾部：渲染的 title/description
   * 全部写者是日级边界；轮级的 lit_count/last_lit_at **不进渲染**。排序沿
   * listConcerns 的 weight DESC, id —— 截断掉的是她自己排在后面的那些。
   */
  #renderConcernsBlock(): ConverseMessage | null {
    let rows: { id: number; title: string; description: string }[]
    try {
      rows = this.#deps.store.listConcerns('active')
    } catch (exc) {
      this.#log('concerns_context_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return null
    }
    if (rows.length === 0) return null // 判据⑧a：空态零字节
    const lines = rows.slice(0, CONCERNS_CONTEXT_MAX).map((row) => {
      const description = collapseWs(String(row.description ?? ''))
      const suffix = description ? ` —— ${cpSlice(description, CONCERNS_DESC_CHARS)}` : ''
      return `- ${row.title}${suffix}`
    })
    return { role: 'system', content: CONCERNS_HEADER + lines.join('\n') }
  }

  // --- 易变尾部（S-25） --------------------------------------------------------

  #volatileTail(selfState: ConverseMessage | null): [string, ConverseMessage][] {
    const blocks: [string, ConverseMessage][] = []
    if (this.#relevantMemories !== null) {
      blocks.push([BLOCK_MEMORIES, this.#relevantMemories])
    }
    if (this.#innerEnabled()) {
      const tops = this.#deps.store.getThoughtsForSnapshot(THOUGHT_SNAPSHOT_TOP)
      this.#lastInjectedThoughtIds = tops.map((t) => t.id)
      if (tops.length > 0) {
        const lines = tops.map(
          (t) => `id=${t.id} kind=${t.kind} charge=${pyFloatStr(pyRound(t.charge, 3))}: ${t.content}`,
        )
        blocks.push([BLOCK_THOUGHTS, {
          role: 'system',
          content: THOUGHTS_HEADER + lines.join('\n'),
        }])
      }
    } else {
      this.#lastInjectedThoughtIds = []
    }
    // 时间锚：分钟粒度每轮必变 —— 它正是当初把缓存边界顶到 message 0 的那一块。
    const { stamp, weekday } = beijingClock(this.#now())
    blocks.push([BLOCK_TIME, {
      role: 'system',
      content: `[当前时间] ${stamp} 周${'一二三四五六日'[weekday]} (北京时间)`,
    }])
    const undelivered = this.#undeliveredBlock()
    if (undelivered !== null) {
      blocks.push([BLOCK_UNDELIVERED, undelivered])
    }
    if (selfState !== null) {
      blocks.push([BLOCK_SELF_STATE, selfState])
    }
    return blocks
  }

  /**
   * L3 跨时间检索（S-33 前半）：来话即探针，一轮一算（在 send 里，不在 assemble
   * 里 —— enforceBudget 会反复调 assemble）。**零 LLM**：纯三轴打分一次 SELECT。
   */
  #buildRelevantMemories(message: string): ConverseMessage | null {
    const probe = cpSlice((message || '').trim(), L3_PROBE_MAX_CHARS)
    if (!probe) return null
    let hits: RawRowLike[]
    try {
      const subject = this.#deps.store.ownerPrimaryUserId()
      hits = retrieveForConcern(
        this.#deps.store,
        { title: probe, description: '', subject_user_id: subject },
        { limit: L3_RETRIEVAL_LIMIT },
      )
    } catch (exc) {
      // 检索坏了是运维问题，不是这轮对话的问题。
      this.#log('relevant_memories_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return null
    }
    if (hits.length === 0) return null // 命中为空不加块（S-26/⑧a）
    const lines = hits.map((hit) => this.#renderMemoryLine(hit))
    this.#log('relevant_memories_injected', { hits: hits.length, probe_chars: [...probe].length })
    return { role: 'system', content: MEMORIES_HEADER + lines.join('\n') }
  }

  /** 一条召回 → 一行：时刻 + 来源 + ≤80 字正文（strip + 折行 —— 读侧卫生同回灌）。 */
  #renderMemoryLine(hit: RawRowLike): string {
    const stamp = beijingStamp(String(hit.ts ?? ''))
    const source = String(hit.source || '?')
    const body = collapseWs(stripMarkup(String(hit.content ?? '')))
    return `- [${stamp}] ${source}: ${cpSlice(body, L3_LINE_CHARS)}`
  }

  /**
   * 「我刚才有话没送到他手上」（≤3 条）。**只读不标**（S-33）：enforceBudget 会
   * 反复调 assemble，在这里标就会把块标没了；标 surfaced 落在这一周期最终成立
   * 之后（D-05 修正版）。
   */
  #undeliveredBlock(): ConverseMessage | null {
    const ledger = this.#deps.undelivered
    if (ledger === undefined) {
      this.#pendingUndeliveredIds = []
      return null
    }
    let items: { id: number; ts?: string | null; text_summary?: string | null }[]
    try {
      items = ledger.unsurfaced(UNDELIVERED_CONTEXT_MAX)
    } catch (exc) {
      this.#log('undelivered_context_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      this.#pendingUndeliveredIds = []
      return null
    }
    if (items.length === 0) {
      this.#pendingUndeliveredIds = []
      return null
    }
    this.#pendingUndeliveredIds = items.map((item) => Number(item.id))
    const lines = items.map(
      (item) => `- [${beijingStamp(String(item.ts ?? ''))}] 「${item.text_summary ?? ''}」`,
    )
    return { role: 'system', content: UNDELIVERED_HEADER + lines.join('\n') }
  }

  /**
   * 展示期结束（D-05 修正版）：在**这一周期最终成立**（信封解析通过）之后调，
   * 不是每次 completion 之后 —— 重试的第二轮装配因此仍带着未送达块，她看到的
   * 处境与第一次相同。看到一次就够了；重说与否是她的认知决定。
   */
  #markUndeliveredSurfaced(): void {
    const ids = this.#pendingUndeliveredIds
    if (ids.length === 0) return
    this.#pendingUndeliveredIds = []
    try {
      this.#deps.undelivered?.markSurfaced(ids)
    } catch (exc) {
      // 标不上最坏只是下轮再看一次同一条，不值得毁掉这一轮的回复。
      this.#log('undelivered_surfaced_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
        count: ids.length,
      })
    }
  }

  // --- 装配 --------------------------------------------------------------------

  #assemble(): ConverseMessage[] {
    const selfState = this.#deps.selfState?.() ?? null
    const assembled = this.#stablePrefix().map(([, message]) => message)
    assembled.push(...this.#messages.slice(1))
    assembled.push(...this.#volatileTail(selfState).map(([, message]) => message))
    return assembled
  }

  /** 结构守恒测试的断言面（S-23）：本轮会装配的块标签序，history 代活窗。 */
  assembleLayout(): string[] {
    const selfState = this.#deps.selfState?.() ?? null
    const tags = this.#stablePrefix().map(([tag]) => tag)
    tags.push(BLOCK_HISTORY)
    tags.push(...this.#volatileTail(selfState).map(([tag]) => tag))
    return tags
  }

  // --- Context governance（S-29/S-30/S-31） -----------------------------------

  /** 轮边界（user 消息处）：裁剪只在这里切 —— tool_calls 与其结果同生共死（S-29）。 */
  #roundStarts(): number[] {
    const starts: number[] = []
    for (let i = 1; i < this.#messages.length; i += 1) {
      if (this.#messages[i]!.role === 'user') starts.push(i)
    }
    return starts
  }

  /**
   * 软窗（S-31）：活窗轮数超限时把溢出部分摘要进滚动摘要再丢。摘要是网络调用，
   * **锁外**跑；正确性靠对象身份重对齐 —— 捕获的消息仍在窗口前部的才删。
   * 摘要失败什么都不丢（硬预算仍兜底，下一轮重试）。
   */
  async governContext(): Promise<void> {
    await this.#summaryLock.run(async () => {
      let overflow: ConverseMessage[] = []
      let prior: string | null = null
      await this.#lock.run(async () => {
        const starts = this.#roundStarts()
        if (starts.length <= this.#limit('windowTurns')) return
        const cut = starts[starts.length - this.#limit('windowTurns')]!
        overflow = this.#messages.slice(1, cut)
        prior = this.#summary
      })
      if (overflow.length === 0) return
      let newSummary: string
      try {
        newSummary = await this.#summarize(overflow, prior)
      } catch (exc) {
        this.#log('context_summary_failed', {
          error: exc instanceof Error ? exc.message : String(exc),
        })
        return
      }
      let dropped = 0
      await this.#lock.run(async () => {
        const overflowSet = new Set(overflow)
        let end = 1
        while (end < this.#messages.length && overflowSet.has(this.#messages[end]!)) {
          end += 1
        }
        dropped = end - 1
        this.#messages.splice(1, dropped)
        this.#summary = newSummary
      })
      this.#log('context_trimmed', {
        dropped_messages: dropped,
        rounds_kept: this.#limit('windowTurns'),
      })
    })
  }

  async #summarize(overflow: ConverseMessage[], prior: string | null): Promise<string> {
    const lines: string[] = []
    if (prior) {
      lines.push(`（已有摘要，请把新内容合并进去）\n${prior}\n\n--- 新的早前对话 ---`)
    }
    for (const message of overflow) {
      const role = message.role
      let content = message.content || ''
      if (role === 'tool') {
        if ([...content].length > TOOL_RESULT_CLIP_CHARS) {
          content = cpSlice(content, TOOL_RESULT_CLIP_CHARS) + '…(已截断)'
        }
        lines.push(`[工具结果] ${content}`)
      } else if (role === 'assistant' && message.tool_calls) {
        const calls = message.tool_calls.map((c) => c.function.name).join(', ')
        lines.push(`Lykoi（调用工具：${calls}）${content}`)
      } else if (role === 'assistant') {
        lines.push(`Lykoi: ${content}`)
      } else {
        lines.push(`Kevin: ${content}`)
      }
    }
    const result = await this.#deps.llm(
      [
        { role: 'system', content: SUMMARIZE_SYSTEM_PROMPT },
        { role: 'user', content: lines.join('\n') },
      ],
      {
        purpose: 'summary',
        responseFormat: null,
        maxTokens: SUMMARY_MAX_TOKENS,
        temperature: SUMMARY_TEMPERATURE,
        runId: this.#lastRunId || 'summary',
      },
    )
    const summary = (result.content || '').trim()
    if (!summary) throw new Error('summarizer returned empty content')
    return summary
  }

  /**
   * 硬预算（S-30）：先丢最老的完整轮（不动当前轮）→ 再丢回灌 → 都没了就大声
   * 抛 ContextBudgetError（文案骨架 sha 钉死）。确定性 —— 摘要器不可用时照样成立。
   */
  #enforceBudget(): void {
    const budget = this.#limit('maxInputTokens')
    for (;;) {
      if (estimateMessagesTokens(this.#assemble() as unknown as Record<string, unknown>[]) <= budget) {
        return
      }
      const starts = this.#roundStarts()
      if (starts.length >= 2) {
        this.#messages.splice(1, starts[1]! - 1)
        this.#log('context_hard_trimmed', { upto_round: 2 })
      } else if (this.#backfill !== null) {
        this.#backfill = null
        this.#log('context_backfill_dropped', { reason: 'over_budget' })
      } else {
        const estimated = estimateMessagesTokens(this.#assemble() as unknown as Record<string, unknown>[])
        this.#log('context_over_budget', { estimated, budget })
        throw new ContextBudgetError(fmt(CONTEXT_BUDGET_SKELETON, estimated, budget))
      }
    }
  }

  // --- 一次 completion（S-52 的 json 钮只在信封那一次生效） --------------------

  async #completion(signal?: AbortSignal): Promise<ConverseLlmResult> {
    this.#enforceBudget()
    const messages = buildEnvelopeMessages(this.#assemble())
    return await this.#deps.llm(messages, {
      purpose: 'envelope',
      responseFormat: envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null,
      runId: this.#lastRunId,
      // D-01：周期的那条边递到 wire（signal 缺席 = 不设限，键根本不出现）。
      ...(signal === undefined ? {} : { signal }),
    })
  }

  // --- 信封周期 ----------------------------------------------------------------

  /**
   * 一个 inbound 回合 = 一串信封周期。每周期四选一；失败方向 = 沉默（不变量 3）
   * + D-01 有界重试一次（只对 not_json）。这条路上没有一个新的对外副作用出口。
   */
  async #runCycle(signal?: AbortSignal): Promise<string> {
    for (let step = 0; step <= MAX_TOOL_STEPS; step += 1) {
      const closing = step === MAX_TOOL_STEPS
      if (closing) {
        this.#messages.push({ role: 'system', content: CYCLE_CLOSING_NOTE })
      }
      let decision: Decision | null = null
      let elapsedMs = 0
      for (let attempt = 0; ; attempt += 1) {
        const started = monotonicNowMs() // realtime-allow: 周期时延量真实墙钟
        const result = await this.#completion(signal)
        elapsedMs = Math.round(monotonicNowMs() - started)
        const injected = new Set(this.#lastInjectedThoughtIds)
        try {
          decision = parseEnvelope({ content: result.content }, {
            injectedThoughtIds: injected,
            logEvent: this.#deps.logEvent,
            runId: this.#lastRunId || null, // capability_gap 的 run_id 栏（旁路留痕）
          })
          break
        } catch (exc) {
          // 契约失败 = 这一轮沉默，不是回合崩掉。
          const [reason, detail] = classifyFailure(exc, result.content)
          if (attempt < ENVELOPE_RETRY_MAX && reason === FAIL_NOT_JSON) {
            // D-01：只对 not_json 有界重试一次 —— 空回复/截断是采样偶发，
            // 重试有实际收益；unknown_kind/missing_content 是理解偏差，重试复现。
            this.#log(CYCLE_RETRY_EVENT, { reason, detail, step, attempt: attempt + 1 })
            continue
          }
          // D-01/D-08：失败事件带**非内容**元数据 —— 长度/键名/finish_reason，
          // 原文一个字不进事件流。
          this.#log(CYCLE_FAILURE_EVENT, {
            error_type: exc instanceof Error ? exc.name : 'Error',
            elapsed_ms: elapsedMs,
            reason,
            detail,
            step,
            attempts: attempt + 1,
            content_chars: [...(result.content ?? '')].length,
            has_content: result.content !== null && result.content !== undefined,
            finish_reason: result.finishReason ?? null,
            completion_tokens: result.completionTokens ?? null,
            prompt_tokens: result.promptTokens ?? null,
            other_message_keys: [...(result.extraKeys ?? [])],
          })
          return ''
        }
      }
      // D-05（修正版）：这一周期最终成立之后才收未送达展示期。
      this.#markUndeliveredSurfaced()
      const injected = new Set(this.#lastInjectedThoughtIds)
      const innerApplied = this.#applyCycleInner(decision, injected)
      this.#log(CYCLE_EVENT, cycleRecord(decision, {
        elapsedMs,
        assembled: this.#messages,
        step,
        innerApplied,
        wiredActions: this.#deps.wiredActions,
      }))
      if (decision.demoted && decision.original_kind === TOOL_CALL) {
        // D-03：她想动手却被闸掉 ≠ 她本来就想沉默 —— 独立告警。
        const tool = decision.envelope.tool as { name: string } | null
        this.#log(CYCLE_TOOL_DEMOTED_EVENT, {
          original_kind: TOOL_CALL,
          tool_name: tool?.name ?? null,
        })
      }
      const kind = decision.kind
      if (kind === SILENCE) {
        // 沉默**有账没话**：上面那条事件就是它的账。历史里不补 assistant 消息。
        return ''
      }
      if (kind === REPLY) {
        this.#messages.push({ role: 'assistant', content: decision.content })
        return decision.content ?? ''
      }
      if (kind === PROMISE_FOLLOWUP) {
        this.#handleFollowup(cycleCall(step, FOLLOWUP_TOOL, { task: decision.content }))
        this.#messages.push({ role: 'assistant', content: decision.content })
        return decision.content ?? ''
      }
      // --- tool_call ---
      const tool = decision.envelope.tool as { name: string; arguments: Record<string, unknown> } | null
      if (tool === null || tool === undefined) {
        // 信封说要动手却没给动作 —— 没有可执行物，安全侧收场。
        this.#log(CYCLE_FAILURE_EVENT, {
          error_type: 'MissingTool',
          elapsed_ms: elapsedMs,
          reason: 'missing_tool',
          detail: 'tool:none',
          step,
        })
        return ''
      }
      if (closing) {
        // 超界。不再执行、不硬编总结 —— 收尾周期已被告知走接力，她仍要动手，
        // 落账收在安全侧。
        this.#log(CYCLE_TOOL_BUDGET_EVENT, { tool: tool.name, steps: MAX_TOOL_STEPS })
        return ''
      }
      const outcome = await this.#executeCycleTool(step, tool)
      if (outcome !== null) return outcome // 撞了审批门：这一轮的结局由那条腿交代
    }
    return '' // 不可达（closing 那一周期必然 return），安全侧兜底
  }

  /**
   * 执行信封点名的那一个工具，回填结果；null = 周期继续。合成一条
   * assistant/tool_calls 消息：信封这一路没用 tools API，但对话历史是共用的 ——
   * 用它原生的词汇把"她决定动手"写进历史，既有结果回填/回执探针原样可用。
   * 撞审批门（S-57）：补 deferred 结果，然后走 `#askForApproval`（M3-W2 换真身：
   * SK-77 四项载荷交给拥有对话的调用方）—— 回合本身沉默收场，不静默执行。
   */
  async #executeCycleTool(
    step: number,
    tool: { name: string; arguments: Record<string, unknown> },
  ): Promise<string | null> {
    const call = cycleCall(step, tool.name, tool.arguments)
    this.#messages.push({ role: 'assistant', content: null, tool_calls: [call] })
    const name = tool.name
    if (name === VISION_TOOL) {
      this.#appendToolResult(call.id, await this.#handleVision(call))
      return null
    }
    if (name === FOLLOWUP_TOOL) {
      this.#appendToolResult(call.id, this.#handleFollowup(call))
      return null
    }
    if (name === PROGRESS_TOOL) {
      this.#appendToolResult(call.id, this.#handleProgress(call))
      return null
    }
    const [action, errorPayload] = this.#buildAction(call)
    if (errorPayload !== null) {
      this.#appendToolResult(call.id, errorPayload)
      return null
    }
    const dispatchFn = this.#deps.dispatchFn ?? unwiredConverseDispatch
    const observation = await dispatchFn(action!, { origin: 'interactive' })
    if (
      !observation.success
      && isPlainObject(observation.data)
      && observation.data.needs_approval
    ) {
      // S-57：这一个未应答的 tool_call 补 deferred 结果，历史保持合法形状。
      // （新体一周期恰点名一个工具，所以"这一个"就是"其后所有"。）
      this.#appendToolResult(call.id, {
        success: false, deferred: true, note: 'awaiting owner approval',
      })
      return this.#askForApproval(action!, observation.data)
    }
    this.#appendToolResult(call.id, this.#resultPayload(action!, observation))
    return null
  }

  /**
   * 这一轮的动作撞了审批门。**问一次**，并且在回复本身里什么也不说
   * （WO-FIX-APPROVAL-UX ② / S-58）。
   *
   * 返回值就是这一回合的回复，所以在问句已经在途的那条路上它刻意是**空串**：
   * 问句就是那条消息，在回复里再复述一遍，正是它所替代的那堆四连横幅。只有
   * 一条问句都问不出去时这一回合才开口 —— 而且永不带一个端点进去。
   *
   * **SK-77 认知侧协议（新体唯一形态）**：认知侧只交出四项载荷
   * （action_type / params / action_id / correlation_id），由**拥有这场对话的
   * 调用方**（今天 = 设备层）以当轮入站 message_id 为 reply_to 去问。
   *
   * 为什么不是"把入站 id 送进认知侧"：那是 WO-U3/P1 E2 分层的刻意设计 ——
   * 「对端是谁」只在设备层是结构事实。所以反过来：**问句移到设备层去发**。
   * 排队也跟着问句走，在那一侧由 `requestApproval` 一次做完（"先发后排"的原子
   * 性口径原封不动），这一层**不预先排一条没人问过的队**（S-59）。
   *
   * 活体的路 B（`_delegate_approval_ask=False`，认知侧自己取 `_owner_context()`
   * 调 request_approval）是 Mac app 的缺省路径 —— 具身重设计后 Mac 退化为纯感知
   * 器官，那条路在新体**不出生**（本波刻意不迁；ASK_FALLBACK 的文案随本条款迁
   * 入，用在下面那个真正"问不出去"的分支上）。
   */
  #askForApproval(
    action: { type: string; params: Record<string, unknown> },
    data: Record<string, unknown>,
  ): string {
    const actionId = data.action_id
    const correlationId = data.correlation_id
    if (typeof actionId !== 'string' || !actionId) {
      // 没有 action_id 就没有可以让设备侧绑住的把手：那条问句问不出去，动作不
      // 做。**不**编一个 id —— 编出来的把手会让 Kevin 的「可以」绑到空处。
      this.#log('approval_ask_skipped', { reason: 'no_action_id', action_type: action.type })
      return ASK_FALLBACK
    }
    // 一轮一份，取走即清（S-60）：同一个待批动作被两个调用方各问一遍，就是
    // Kevin 面前两条问句指向一件事。
    this.#delegatedAsk = {
      action_type: action.type,
      params: action.params,
      action_id: actionId,
      correlation_id: typeof correlationId === 'string' ? correlationId : null,
    }
    this.#log('approval_ask_delegated', { action_type: action.type })
    // 与 "asked" 同一条口径：问句就是那条消息，回合本身不再复述一遍。
    return ''
  }

  /**
   * D-02②③：工具名过 TOOL_TO_ACTION 枚举 —— unknown-tool 分支**大声失败**
   * （cycle_unknown_tool 事件 + error 结果回填；活体这里零 audit 零 events，
   * 正是 U3 缺陷②"零痕迹断点"的病灶）。notify.owner 的 origin 由本循环盖章，
   * 永不由模型给（S-55）。
   *
   * GK-14：两道闸的判定本身现在只在 `toolDispatchGate`（contract.ts）里写一份
   * —— 这里只消费判定结果，不重复判定逻辑；`cycleRecord` 也调同一个函数算
   * `dispatch_gate`/`dispatched`，两处不会各说各话。事件名、`capability_gap`
   * 载荷、error 结果串逐字节不变。
   */
  #buildAction(call: ToolCall): [{ type: string; params: Record<string, unknown> } | null, Fields | null] {
    const name = call.function.name
    const gate = toolDispatchGate(name, this.#deps.wiredActions)
    if (gate === 'unknown_tool') {
      this.#log(CYCLE_UNKNOWN_TOOL_EVENT, { name })
      // 位点④（工具名词表判定；WO-U2-SENSE-01）：她点了一个白名单外的工具名 ——
      // 这是「她想做但没有」在对话路径上最贴近判定的那一处。旁路留痕：上面那条
      // 账与下面回填的 error 结果都逐字节不变。
      emitCapabilityGap(this.#deps.logEvent, {
        wanted: name,
        reason: GAP_UNKNOWN_ACTION,
        source: 'converse',
        runId: this.#lastRunId || null, // 空串 = 还没进过回合：记 null，不记 ''
      })
      return [null, { success: false, error: `unknown tool '${name}'` }]
    }
    const actionType = TOOL_TO_ACTION[name]!
    // WO-FIX-LOOP-01 D-1d：动作**在**词表里，但注册表里仍是 D-1a 打了标记的
    // 替身（未接线）—— 与上面的"词表外"分支是结构上不同的两件事，不许合并；
    // 不给 wiredActions 时（未接线口径缺省关）`toolDispatchGate` 永不判 not_wired，
    // 此分支永不触发，行为逐字节不变。
    if (gate === 'not_wired') {
      this.#log(CYCLE_TOOL_UNWIRED_EVENT, { name, action_type: actionType })
      emitCapabilityGap(this.#deps.logEvent, {
        // 治理复核改口：记工具名（≤20 字，过 capabilityToken 标签闸原样落）而非
        // 动作类型（`research_browser.read_text` 26 字只会落长度）——与位点④同口径。
        wanted: name,
        reason: GAP_NOT_WIRED,
        source: 'converse',
        runId: this.#lastRunId || null,
      })
      return [null, { success: false, error: `organ not wired: '${name}'` }]
    }
    let params: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}')
      params = isPlainObject(parsed) ? parsed : {}
    } catch (exc) {
      return [null, {
        success: false,
        error: `bad tool arguments: ${exc instanceof Error ? exc.message : String(exc)}`,
      }]
    }
    if (actionType === 'notify.owner') {
      params.origin = 'interactive' // provenance is stamped by this loop, never by the model
    }
    return [{ type: actionType, params }, null]
  }

  /** S-56：截图真实路径永不交给模型 —— 只给不透明 attachment id。 */
  #resultPayload(
    action: { type: string; params: Record<string, unknown> },
    observation: ConverseObservation,
  ): Fields {
    let data = observation.data
    if (
      action.type === 'browser.screenshot'
      && observation.success
      && isPlainObject(data)
      && data.path
    ) {
      const id = `att-${randomUUID().replaceAll('-', '')}`
      this.#attachments.set(id, String(data.path))
      data = { attachment_id: id }
    }
    return { success: observation.success, data, error: observation.error ?? null }
  }

  #appendToolResult(callId: string, payload: Fields): void {
    this.#messages.push({
      role: 'tool',
      tool_call_id: callId,
      content: JSON.stringify(payload),
    })
  }

  async #handleVision(call: ToolCall): Promise<Fields> {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}')
      args = isPlainObject(parsed) ? parsed : {}
    } catch (exc) {
      return { success: false, error: `bad tool arguments: ${exc instanceof Error ? exc.message : String(exc)}` }
    }
    const attachmentId = args.attachment_id
    if (!attachmentId || typeof attachmentId !== 'string') {
      return { success: false, error: "vision_describe requires 'attachment_id'" }
    }
    // S-56：只有可信生产者发出的 id 才 resolve —— 猜的 id、裸路径永远到不了读取。
    const path = this.#attachments.get(attachmentId)
    if (path === undefined) {
      return { success: false, error: `unknown attachment: ${attachmentId}` }
    }
    if (this.#deps.describeImage === undefined) {
      return { success: false, error: 'vision model 未接线(M3)' }
    }
    try {
      const question = typeof args.question === 'string' ? args.question : null
      const description = await this.#deps.describeImage(path, question)
      this.#log('vision_describe', { attachment_id: attachmentId, chars: description.length })
      return { success: true, data: { description } }
    } catch (exc) {
      this.#log('vision_error', {
        attachment_id: attachmentId,
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return { success: false, error: 'vision model failed' }
    }
  }

  /**
   * promise_followup —— 认知内工具：只登记，不动外界（S-54）。现场回合由 surface
   * 在回合成功后调度成后台跟进；后台回合是挂起信号（无递归自动续跑）。
   */
  #handleFollowup(call: ToolCall): Fields {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}')
      args = isPlainObject(parsed) ? parsed : {}
    } catch (exc) {
      return { success: false, error: `bad tool arguments: ${exc instanceof Error ? exc.message : String(exc)}` }
    }
    const task = String(args.task ?? '').trim()
    if (!task) {
      return { success: false, error: "promise_followup 需要 'task':写清要完成什么、卡在哪里" }
    }
    this.#followupRequest = task // 一轮多次调用取最后一次
    if (this.#background) {
      this.#log('continuation_requested', { chars: [...task].length })
      return { success: true, data: { queued: true, note: '回合结束后任务挂起,等 Kevin 批准再继续' } }
    }
    this.#log('followup_requested', { chars: [...task].length })
    return { success: true, data: { queued: true, note: '回复结束后开始后台跟进' } }
  }

  /** post_progress —— 后台执行中的进度推送：写对话出站队列，不过 dispatch（S-54）。 */
  #handleProgress(call: ToolCall): Fields {
    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(call.function.arguments || '{}')
      args = isPlainObject(parsed) ? parsed : {}
    } catch (exc) {
      return { success: false, error: `bad tool arguments: ${exc instanceof Error ? exc.message : String(exc)}` }
    }
    const content = String(args.content ?? '').trim()
    if (!content) {
      return { success: false, error: "post_progress 需要 'content':要发给 Kevin 的进展" }
    }
    if (!this.#background) {
      return { success: false, error: '现场对话直接在回复里说,post_progress 只在后台回合可用' }
    }
    try {
      if (this.#deps.postProgress === undefined) {
        throw new Error('chat outbox 未接线(M3)')
      }
      this.#deps.postProgress('⏳ ' + content)
    } catch (exc) {
      // 投递故障不打断执行。
      this.#log('chat_outbox_error', {
        error: exc instanceof Error ? exc.message : String(exc),
      })
      return { success: false, error: '进度没发出去(出站队列故障)——继续做任务,结果里再说' }
    }
    this.#log('progress_posted', { chars: [...content].length })
    return { success: true, data: { delivered: true } }
  }

  /**
   * 信封的 inner 真落库。source='conversation'：事件名由 source 派生 ——
   * conversation_inner_applied 与活体同一条曲线。注入 id 门与 THOUGHT_OPEN_CAP
   * 软拒原样继承（都在 applyInner/createThought 里，这里一条都没重写）。
   */
  #applyCycleInner(decision: Decision, injectedIds: Set<number>): boolean {
    const inner: InnerBlock = decision.inner ?? { thoughts: [], resolve: [] }
    if (!(inner.thoughts.length > 0 || inner.resolve.length > 0)) return false
    if (!this.#innerEnabled()) {
      // 对话情境念头出口的熔断：管的是"落不落库"这件事本身。
      this.#log('conversation_inner_dropped_switch_off', {})
      return false
    }
    try {
      applyInner(inner, {
        source: 'conversation',
        injectedIds,
        store: this.#deps.store,
        now: this.#now(),
        logEvent: this.#deps.logEvent,
      })
    } catch (exc) {
      // applyInner 永不抛；即便如此仍兜一层 —— 念头落不下去不该让她说不出话。
      this.#log('conversation_cycle_inner_failed', {
        error: exc instanceof Error ? exc.name : 'Error',
      })
      return false
    }
    this.#cycleInner = JSON.stringify(inner)
    return true
  }

  // --- 回合骨架（S-12..S-17） --------------------------------------------------

  /** 取走并清空本轮登记的跟进任务（S-60：取走即清）。 */
  takeFollowupRequest(): string | null {
    const task = this.#followupRequest
    this.#followupRequest = null
    return task
  }

  /**
   * 取走并清空本轮交给调用方去问的待批动作（S-60；surface/设备层在回合结束后
   * 调用）。与 takeFollowupRequest 同一形态：取一次就没了 —— 同一个待批动作被
   * 两个调用方各问一遍，就是 Kevin 面前两条问句指向一件事（`requestApproval`
   * 的 already-outstanding 检查会挡住第二条入队，但那是最后一道网，不是借口）。
   */
  takeDelegatedAsk(): DelegatedAsk | null {
    const ask = this.#delegatedAsk
    this.#delegatedAsk = null
    return ask
  }

  /**
   * 只看不取（本波的观测口）。`takeDelegatedAsk` 的语义是**消费** —— 在设备层
   * 真接上去问之前调它，等于把载荷丢进垃圾桶；所以接线侧落账用这个，去问用
   * 那个。跨轮不会悬着：下一轮 `send` 开头就清场（S-13）。
   */
  peekDelegatedAsk(): DelegatedAsk | null {
    return this.#delegatedAsk
  }

  async send(
    message: string,
    opts: {
      background?: boolean
      replyToNotification?: ReplyToNotification | null
      runId?: string
    } = {},
  ): Promise<string> {
    this.#deps.markActive?.() // S-17：开头一次（M3 接真锁）
    const visible = await this.#lock.run(async () => {
      this.#background = opts.background ?? false
      // S-13 一轮一份的清场（新体适用子集：followup / cycle_inner / delegate
      // ask —— 后者随 M3-W2 审批器官出生；shadow 是影子期构件，本体不存在）。
      this.#followupRequest = null
      this.#delegatedAsk = null
      this.#cycleInner = null
      this.#lastRunId = opts.runId ?? randomUUID().replaceAll('-', '')
      const checkpoint = this.#messages.length
      this.#messages.push({ role: 'user', content: message })
      // 来话即探针 —— 一轮一次检索，结果贴进易变尾部（零 LLM）。
      this.#relevantMemories = this.#buildRelevantMemories(message)
      let reply: string
      try {
        // D-01（M4-W1）：整个周期有一条边。撞线 = AbortSignal 掐断那一跳 +
        // 下面的 S-14 回滚 + `u3_cycle_timeout` 落账（elapsed 与判定读同一只表）。
        const timeoutMs = deadlineMs(this.#deps.cycleTimeoutS ?? D01_CYCLE_TIMEOUT_S)
        reply = await withDeadline('conversation_cycle', timeoutMs, (signal) => this.#runCycle(signal))
      } catch (exc) {
        if (exc instanceof DeadlineExceededError) {
          // 风格对齐 G-10 的 u3_cycle_failed：类别/时延/原因/零正文。
          this.#log(CYCLE_TIMEOUT_EVENT, {
            error_type: exc.name,
            elapsed_ms: exc.elapsedMs,
            timeout_ms: exc.timeoutMs,
            reason: 'cycle_timeout',
            run_id: this.#lastRunId,
          })
        }
        // S-14：失败回合整轮回滚 —— 消息列表永不带半截轮（未应答的 tool_call
        // 会毒化之后每一次装配）。已 dispatch 的副作用留在 audit 里。
        const dropped = this.#messages.length - checkpoint
        this.#messages.splice(checkpoint)
        this.#log('chat_turn_rolled_back', { dropped_messages: dropped })
        throw exc
      } finally {
        // S-15：召回是针对这句话的，展示期就是这一轮。
        this.#relevantMemories = null
      }
      const appliedInner = this.#cycleInner
      const now = this.#now()
      // S-16：每个成功回合恰一条 history(conversation) 行（含 silence，reply=""）。
      const historyId = this.#deps.store.appendHistory(
        'conversation',
        JSON.stringify({ user: message, reply }),
        { now },
      )
      // D-08（G-10 修正版）：inner_outer_pair 只记长度/哈希 —— 正文归 history 表
      // （她的记忆），不归事件流。活体在这里写明文正文，与 u3_* 的隐私口径
      // 自相矛盾；出生规格统一成严的那一侧。
      this.#log('inner_outer_pair', {
        turn_id: historyId,
        reply_chars: [...reply].length,
        reply_sha16: sha16(reply),
        inner_chars: appliedInner === null ? 0 : [...appliedInner].length,
        has_inner: appliedInner !== null,
      })
      // S-16：一次 conversationTurnReflow —— reflow 失败是遥测，不是坏掉的回合。
      try {
        conversationTurnReflow({
          store: this.#deps.store,
          notifications: this.#deps.notifications ?? emptyNotifications,
          userText: message,
          replyText: reply,
          historyId,
          now,
          replyToNotification: opts.replyToNotification ?? null,
          markReplied: this.#deps.markReplied,
          logEvent: this.#deps.logEvent,
        })
      } catch (exc) {
        this.#log('conversation_reflow_failed', {
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
      return reply
    })
    // S-12：摘要在**锁外**跑 —— 摘要时延不挡并发回合。
    await this.governContext()
    this.#deps.markActive?.() // S-17：结尾一次
    return visible
  }
}
