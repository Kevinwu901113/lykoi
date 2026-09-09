/** Bounded conversation cycles with explicit outcomes, context management and tool dispatch. */
import { RunAbortedError } from './deadline.ts'
import { randomUUID, createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  applyInner, buildPersonaKernel, buildPersonaPrompt, buildRelationshipOverlay, renderOwnerTemplate,
  emitCapabilityGap, GAP_NOT_WIRED, GAP_UNKNOWN_ACTION,
  type InnerBlock, type LogEvent, type PersonaConfig, type SanitizedThought,
} from 'lykoi-decide'
import { retrieveForConcern } from 'lykoi-learn'
import {
  conversationTurnReflow, emptyNotifications,
  type NotificationsView, type ReplyToNotification,
} from 'lykoi-reflow'
import { REGISTRY, THOUGHT_SNAPSHOT_TOP, type RegulationVariableName } from 'lykoi-regulation'
import { roundDecimal, renderRestartNotice, type RestartEvent } from 'lykoi-snapshot'
import {
  buildEnvelopeMessages, classifyFailure, cycleCall, cycleRecord, parseEnvelope,
  CONVERSATION_INNER_ENABLED, CYCLE_EVENT, CYCLE_FAILURE_EVENT,
  CYCLE_TOOL_BUDGET_EVENT, CYCLE_TOOL_UNWIRED_EVENT,
  CYCLE_UNKNOWN_TOOL_EVENT,
  ENVELOPE_RESPONSE_FORMAT, FOLLOWUP_TOOL,
  MAX_TOOL_STEPS, PROGRESS_TOOL, PROMISE_FOLLOWUP, REPLY, SILENCE,
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
  MEMORIES_HEADER, NARRATIVE_HEADER, PROMOTED_INSIGHTS_HEADER,
  SUMMARIZE_SYSTEM_PROMPT,
  SUMMARY_SKELETON, THOUGHTS_HEADER, UNDELIVERED_HEADER, fmt, renderSystemPrompt, SELF_STATE_TEMPLATE,
} from './prompts.ts'
import type { CycleOutcome } from './outcome.ts'

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

  promotedFocusInsights(): RawRowLike[]

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

export interface ConverseLlmResult {
  content: string | null
  finishReason?: string | null
  promptTokens?: number | null
  completionTokens?: number | null
  /** 原始响应 role/content 之外的键名（能暴露 reasoning_content 的存在，不泄内容）。 */
  extraKeys?: readonly string[]

  reasoningLength?: number
}

export type ConverseLlmFn = (
  messages: ConverseMessage[],
  opts: {
    purpose: 'envelope' | 'summary'

    responseFormat: typeof ENVELOPE_RESPONSE_FORMAT | null
    maxTokens?: number
    temperature?: number
    runId: string

    signal?: AbortSignal

    reasoningEffort?: 'off'
  },
) => Promise<ConverseLlmResult>

export interface ConverseObservation {
  success: boolean
  data?: unknown
  error?: string | null
}

export type ConverseDispatchFn = (
  action: { type: string; params: Record<string, unknown> },
  context: {
    origin: 'interactive'
    run_id?: string | null
    turn_id?: string | null
  },
) => Promise<ConverseObservation>

// 它取代的那个横幅会把一行裸的 `POST /approvals/{id}/approve` 打进聊天。它是为
// Mac 客户端写的 —— 在那里那个端点是唯一的应答方式；在 Telegram 里它是一条
// Kevin 无法执行的指令，而 2026-08-12 他在一次交流里收到了**四遍**，因为每一个
// 撞到门的工具步骤都会再打一次。端点本身留着（所有者控制台仍经它了结待批动作），
// 退役的是对话里的那个横幅。问是审批器官的活了：`requestApproval` 把问句说成
// 一句话、发进他的聊天、连同问句那条消息的 id 一起记下来（于是他的回复可归属），
// 并且拒绝就同一条悬置动作问第二遍。

export const ASK_FALLBACK = '这事需要你点头, 我稍后再问。'

export const DELEGATED_ASK_FIELDS = ['action_type', 'params', 'action_id', 'correlation_id'] as const

export interface CycleResult {
  outcome: CycleOutcome | null
  followup: string | null
  delegatedAsk: DelegatedAsk | null
  utterances: readonly string[]
}

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

  postProgress?: (content: string) => void

  selfState?: (now: Date) => ConverseMessage | null

  markActive?: () => void
  /** 演化叙事 flag 文件路径（存在才注入；owner 域动作）。 */
  narrativeFlagPath?: string

  cycleTimeoutS?: number
  /** 对话情境念头出口熔断（测试面；缺省 = CONVERSATION_INNER_ENABLED）。 */
  innerEnabled?: boolean

  limits?: Partial<{ windowTurns: number; backfillRows: number; maxInputTokens: number }>

  wiredActions?: ReadonlySet<string>
  capabilityRevision?: () => number
}

// --- 小工具 --------------------------------------------------------------------

function sha16(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function parseToolArguments(call: ToolCall):
  | { args: Record<string, unknown>; error: null }
  | { args: null; error: Fields } {
  try {
    const parsed: unknown = JSON.parse(call.function.arguments || '{}')
    return { args: isPlainObject(parsed) ? parsed : {}, error: null }
  } catch (exc) {
    return { args: null, error: {
      success: false,
      error: `bad tool arguments: ${exc instanceof Error ? exc.message : String(exc)}`,
    } }
  }
}

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

export const SELF_STATE_DEVIATION_MIN = 0.05

/**
 * 调节场四变量 → self_state 块正文（纯函数，零 I/O）。按 REGISTRY 键序一行一变量
 * `<name>: <0.000>`；四个都在基线 ± SELF_STATE_DEVIATION_MIN 之内 → null（块不出现）。
 * 不渲染 cognitiveEffects：那是 wake 候选权重的语义，对话路径不消费。
 */
export function renderSelfState(
  values: Readonly<Partial<Record<RegulationVariableName, number>>>,
): string | null {
  const lines: string[] = []
  let deviates = false
  for (const name of Object.keys(REGISTRY) as RegulationVariableName[]) {
    const value = values[name]
    if (typeof value !== 'number' || !Number.isFinite(value)) continue
    // 按呈现精度（三位小数）比：0.25 − 0.2 在浮点下是 0.04999…，读数上却是 0.050。
    if (Number(Math.abs(value - REGISTRY[name].baseline).toFixed(3)) >= SELF_STATE_DEVIATION_MIN) deviates = true
    lines.push(`${name}: ${value.toFixed(3)}`)
  }
  if (!deviates) return null
  return SELF_STATE_TEMPLATE.replace('{}', lines.join('\n'))
}

/** 生产装配的接口位实现：懒衰减后的四值（纯读不落账）→ system 块；不偏离 → null。 */
export function selfStateBlock(
  store: { getRegulation(opts: { now: Date }): Readonly<Partial<Record<RegulationVariableName, number>>> },
  now: Date,
): ConverseMessage | null {
  const content = renderSelfState(store.getRegulation({ now }))
  return content === null ? null : { role: 'system', content }
}

export class Conversation {
  #runController: AbortController | null = null
  #runSealed = true

  canInterrupt(runId: string): boolean {
    return this.#runController !== null && !this.#runSealed && !this.#background && this.#lastRunId === runId
  }

  interrupt(runId: string): boolean {
    if (!this.canInterrupt(runId)) return false
    this.#runController!.abort(new RunAbortedError())
    return true
  }

  #deps: ConverseDeps
  #messages: ConverseMessage[]
  #capabilityRevision = -1
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

  #delegatedAsk: DelegatedAsk | null = null
  #background = false
  #cycleInner: string | null = null

  #cyclePulse: string[] = []
  #cycleUtterances: string[] = []
  #lastRunId = ''
  #lastTurnId: string | null = null
  #lastCycleOutcome: CycleOutcome | null = null

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
    this.#deps.logEvent(name, {
      ...fields,
      run_id: this.#lastRunId || null,
      turn_id: this.#lastTurnId,
    })
  }

  /** 当前认知尝试的 run_id；无当前回合时返回 null。 */
  currentRunId(): string | null {
    return this.#lastRunId || null
  }

  /** 当前用户回合的 turn_id；未由调用方提供时返回 null。 */
  currentTurnId(): string | null {
    return this.#lastTurnId
  }

  /** 最近一次 send 成立返回的周期结局；下一次 send 开始前会清空。 */
  lastCycleOutcome(): CycleOutcome | null {
    return this.#lastCycleOutcome
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

  #buildPersonaMessage(): ConverseMessage {
    const parts = [buildPersonaKernel(this.#deps.persona)]
    const notice = renderRestartNotice(this.#deps.restartEvent?.() ?? null)
    if (notice) parts.push(notice)
    parts.push(renderOwnerTemplate(renderSystemPrompt(this.#deps.wiredActions), this.#deps.persona))
    const acquired = buildPersonaPrompt(this.#deps.store, this.#deps.persona).trim()
    if (acquired) parts.push(acquired)
    const promoted = this.#promotedInsightsSection()
    if (promoted) parts.push(promoted)
    const overlay = this.#relationshipOverlaySection()
    if (overlay) parts.push(overlay)
    return { role: 'system', content: parts.join('\n\n') }
  }

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
      .map((content) =>`- ${content}`)
    if (lines.length === 0) return '' // 判据⑧a：空态零字节
    this.#log('promoted_insights_injected', { count: lines.length })
    return PROMOTED_INSIGHTS_HEADER + lines.join('\n')
  }

  #relationshipOverlaySection(): string {

    // 走同一个函数）；这里只剩落账。事件名与字段不变，加 origin 分辨两路。
    const overlay = buildRelationshipOverlay(this.#deps.store)
    if (overlay.error !== undefined) {
      this.#log('relationship_overlay_read_failed', {
        error_type: overlay.error, origin: 'converse',
      })
      return ''
    }
    if (overlay.count === 0) return ''
    this.#log('relationship_overlay_injected', {
      count: overlay.count, subject_user_id: overlay.subject, origin: 'converse',
    })
    return overlay.text
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

        reply = cpSlice(stripMarkup(String(exchange.reply)), BACKFILL_CLIP_CHARS)
      } catch {
        skipped += 1 // an unreadable row is dropped, never invented
        continue
      }
      entries.push(`[${row.ts}] ${this.#deps.persona.voice.address_owner}: ${user}\n我: ${reply}`)
    }
    if (skipped > 0) {
      // 静默丢弃会让历史损坏变成安静的失忆 —— 大声。
      this.#log('backfill_rows_skipped', { skipped, total: rows.length })
    }
    if (entries.length === 0) return null
    return BACKFILL_HEADER + '\n\n' + entries.join('\n\n')
  }

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
          (t) =>`id=${t.id} kind=${t.kind} charge=${pyFloatStr(roundDecimal(t.charge, 3))}: ${t.content}`,
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
    if (hits.length === 0) return null
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
      (item) =>`- [${beijingStamp(String(item.ts ?? ''))}] 「${item.text_summary ?? ''}」`,
    )
    return { role: 'system', content: renderOwnerTemplate(UNDELIVERED_HEADER, this.#deps.persona) + lines.join('\n') }
  }

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

  #selfState(): ConverseMessage | null {
    const provider = this.#deps.selfState
    if (provider === undefined) return null
    try {
      return provider(this.#now())
    } catch (exc) {
      this.#log('self_state_read_failed', {
        error_type: exc instanceof Error ? exc.name : 'Error',
      })
      return null
    }
  }

  #assemble(): ConverseMessage[] {
    const revision = this.#deps.capabilityRevision?.()
    if (revision !== undefined && revision !== this.#capabilityRevision) {
      this.#capabilityRevision = revision
      this.#deps.organs.invalidate()
      this.#organsBlock = this.#deps.organs.block()
    }
    const selfState = this.#selfState()
    const assembled = this.#stablePrefix().map(([, message]) => message)
    assembled.push(...this.#messages.slice(1))
    assembled.push(...this.#volatileTail(selfState).map(([, message]) => message))
    return assembled
  }

  assembleLayout(): string[] {
    const selfState = this.#selfState()
    const tags = this.#stablePrefix().map(([tag]) => tag)
    tags.push(BLOCK_HISTORY)
    tags.push(...this.#volatileTail(selfState).map(([tag]) => tag))
    return tags
  }

  #roundStarts(): number[] {
    const starts: number[] = []
    for (let i = 1; i < this.#messages.length; i += 1) {
      if (this.#messages[i]!.role === 'user') starts.push(i)
    }
    return starts
  }

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
        lines.push(`${this.#deps.persona.identity.name}（调用工具：${calls}）${content}`)
      } else if (role === 'assistant') {
        lines.push(`${this.#deps.persona.identity.name}: ${content}`)
      } else {
        lines.push(`${this.#deps.persona.voice.address_owner}: ${content}`)
      }
    }
    const result = await this.#deps.llm(
      [
        { role: 'system', content: renderOwnerTemplate(SUMMARIZE_SYSTEM_PROMPT, this.#deps.persona) },
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

  async #completion(signal?: AbortSignal): Promise<ConverseLlmResult> {
    this.#enforceBudget()
    const messages = buildEnvelopeMessages(this.#assemble(), this.#deps.wiredActions, this.#deps.persona)
    return await this.#deps.llm(messages, {
      purpose: 'envelope',
      responseFormat: ENVELOPE_RESPONSE_FORMAT,
      runId: this.#lastRunId,

      ...(signal === undefined ? {} : { signal }),
      // WO-FIX-THINKPOLICY-01 D-3：这里**不再**碰推理档位（任何 step 都不带
      // reasoningEffort 键）。推理策略只许有一个主人 —— adapter 那一处
      // （profile `llm-deepseek` 的显式 config 档位）；此前这里的 per-step
      // 覆盖（WO-FIX-TOOLSTEP-01 D-1：step >= 1 关思考）是原生工具帧被
      // DeepSeek 判 400 的绕行，而那个根因已由 WO-FIX-TOOLFRAME-01 消除
      // （工具帧改走文本帧，assistant 帧不再需要回传 reasoning_content；
      // 探针 v4 已证文本帧下思考开着也干净）。绕行留着的代价是档位有两个
      // 主人、且其中一个隐式：profile `llm-deepseek` 不配 config 时 vendor 的
      // resolveThinking 返回空对象 —— thinking/reasoning_effort 两个键在 wire
      // body 上根本不出现，档位落到供应商侧的模型缺省（读数上是 HIGH）；
      // converse 又在半路改口，于是 step 0 的 85 s 归不到任何一处。
    })
  }

  // --- 信封周期 ----------------------------------------------------------------

  async #runCycle(signal?: AbortSignal): Promise<string> {
    for (let step = 0; step <= MAX_TOOL_STEPS; step += 1) {
      const closing = step === MAX_TOOL_STEPS
      if (closing) {
        this.#messages.push({ role: 'system', content: CYCLE_CLOSING_NOTE })
      }
      const started = monotonicNowMs() // realtime-allow: cycle duration
      const lastResult = await this.#completion(signal)
      signal?.throwIfAborted()
      const elapsedMs = Math.round(monotonicNowMs() - started)
      let decision: Decision
      try {
        decision = parseEnvelope({ content: lastResult.content }, {
          logEvent: this.#deps.logEvent,
          runId: this.#lastRunId || null,
          injectedThoughtIds: new Set(this.#lastInjectedThoughtIds),
        })
      } catch (error) {
        const [reason, detail] = classifyFailure(error, lastResult.content)
        this.#log(CYCLE_FAILURE_EVENT, { reason, detail, step, elapsed_ms: elapsedMs })
        this.#lastCycleOutcome = { kind: 'envelope_failed', step }
        return ''
      }
      // 同步提交段从这里开始；inner、进度等内部写入也不允许事后回滚。
      this.#runSealed = true

      this.#markUndeliveredSurfaced()
      const injected = new Set(this.#lastInjectedThoughtIds)
      const innerApplied = this.#applyCycleInner(decision, injected)
      this.#log(CYCLE_EVENT, cycleRecord(decision, {
        elapsedMs,
        assembled: this.#messages,
        step,
        innerApplied,
        wiredActions: this.#deps.wiredActions,

        // 数分不开「思考长」与「前缀缓存未命中」）。缺席交给 cycleRecord 兜底：
        // usage 两项 null、reasoning_len 0。
        promptTokens: lastResult?.promptTokens ?? null,
        completionTokens: lastResult?.completionTokens ?? null,
        reasoningLength: lastResult?.reasoningLength ?? 0,
      }))
      const kind = decision.kind
      if (kind === SILENCE || kind === REPLY || kind === PROMISE_FOLLOWUP) {

        // 工具步中间信封的脉冲不累加（它们描述的是半途，不是这一轮的落点）。
        this.#cyclePulse = [...((decision.envelope.pulse as string[] | undefined) ?? [])]
      }
      if (kind === SILENCE) {
        // 沉默**有账没话**：上面那条事件就是它的账。历史里不补 assistant 消息。
        this.#lastCycleOutcome = { kind: 'silence', step }
        return ''
      }
      if (kind === REPLY) {
        this.#cycleUtterances = [...(decision.envelope.utterances as string[])]
        for (const content of this.#cycleUtterances) this.#messages.push({ role: 'assistant', content })
        this.#lastCycleOutcome = { kind: 'reply', step }
        return decision.content ?? ''
      }
      if (kind === PROMISE_FOLLOWUP) {
        this.#handleFollowup(cycleCall(step, FOLLOWUP_TOOL, { task: decision.content }))
        this.#cycleUtterances = [...(decision.envelope.utterances as string[])]
        for (const content of this.#cycleUtterances) this.#messages.push({ role: 'assistant', content })
        this.#lastCycleOutcome = { kind: 'followup', step }
        return this.#cycleUtterances.join('')
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
        this.#lastCycleOutcome = { kind: 'missing_tool', step }
        return ''
      }
      if (closing) {
        // 超界。不再执行、不硬编总结 —— 收尾周期已被告知走接力，她仍要动手，
        // 落账收在安全侧。
        this.#log(CYCLE_TOOL_BUDGET_EVENT, { tool: tool.name, steps: MAX_TOOL_STEPS })
        this.#lastCycleOutcome = { kind: 'tool_budget', step }
        return ''
      }
      const outcome = await this.#executeCycleTool(step, tool)
      if (outcome !== null) {
        this.#lastCycleOutcome = { kind: 'ask_pending', step }
        return outcome // 撞了审批门：这一轮的结局由那条腿交代
      }
    }
    this.#lastCycleOutcome = { kind: 'tool_budget', step: MAX_TOOL_STEPS }
    return '' // 不可达（closing 那一周期必然 return），安全侧兜底
  }

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

      this.#appendToolResult(call.id, {
        success: false, deferred: true, note: 'awaiting owner approval',
      })
      return this.#askForApproval(action!, observation.data)
    }
    this.#appendToolResult(call.id, this.#resultPayload(action!, observation))
    return null
  }

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

  #buildAction(call: ToolCall): [{ type: string; params: Record<string, unknown> } | null, Fields | null] {
    const name = call.function.name
    const gate = toolDispatchGate(name, this.#deps.wiredActions)
    if (gate === 'unknown_tool') {
      this.#log(CYCLE_UNKNOWN_TOOL_EVENT, { name })

      // 这是「她想做但没有」在对话路径上最贴近判定的那一处。旁路留痕：上面那条

      emitCapabilityGap(this.#deps.logEvent, {
        wanted: name,
        reason: GAP_UNKNOWN_ACTION,
        source: 'converse',
        runId: this.#lastRunId || null, // 空串 = 还没进过回合：记 null，不记 ''
      })
      return [null, { success: false, error: `unknown tool '${name}'` }]
    }
    const actionType = TOOL_TO_ACTION[name]!

    // 替身（未接线）—— 与上面的"词表外"分支是结构上不同的两件事，不许合并；
    // 不给 wiredActions 时（未接线口径缺省关）`toolDispatchGate` 永不判 not_wired，

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
    const { args: params, error } = parseToolArguments(call)
    if (error !== null) return [null, error]
    if (actionType === 'notify.owner') {
      params.origin = 'interactive' // provenance is stamped by this loop, never by the model
    }
    return [{ type: actionType, params }, null]
  }

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
    const { args, error } = parseToolArguments(call)
    if (error !== null) return error
    const attachmentId = args.attachment_id
    if (!attachmentId || typeof attachmentId !== 'string') {
      return { success: false, error: "vision_describe requires 'attachment_id'" }
    }

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

  #handleFollowup(call: ToolCall): Fields {
    const { args, error } = parseToolArguments(call)
    if (error !== null) return error
    const task = String(args.task ?? '').trim()
    if (!task) {
      return { success: false, error: "promise_followup 需要 'task':写清要完成什么、卡在哪里" }
    }
    this.#followupRequest = task // 一轮多次调用取最后一次
    if (this.#background) {
      this.#log('continuation_requested', { chars: [...task].length })
      return { success: true, data: { queued: true, note: renderOwnerTemplate('回合结束后任务挂起,等 {owner} 批准再继续', this.#deps.persona) } }
    }
    this.#log('followup_requested', { chars: [...task].length })
    return { success: true, data: { queued: true, note: '回复结束后开始后台跟进' } }
  }

  #handleProgress(call: ToolCall): Fields {
    const { args, error } = parseToolArguments(call)
    if (error !== null) return error
    const content = String(args.content ?? '').trim()
    if (!content) {
      return { success: false, error: renderOwnerTemplate("post_progress 需要 'content':要发给 {owner} 的进展", this.#deps.persona) }
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

  /** 只读查看本轮是否登记了 follow-up；不消费请求。 */
  hasFollowupRequest(): boolean {
    return this.#followupRequest !== null
  }

  takeFollowupRequest(): string | null {
    const task = this.#followupRequest
    this.#followupRequest = null
    return task
  }

  takeDelegatedAsk(): DelegatedAsk | null {
    const ask = this.#delegatedAsk
    this.#delegatedAsk = null
    return ask
  }

  peekDelegatedAsk(): DelegatedAsk | null {
    return this.#delegatedAsk
  }

  async send(
    message: string,
    opts: {
      background?: boolean
      onUtterances?: (parts: readonly string[]) => void
      onCycleResult?: (result: CycleResult) => void
      replyToNotification?: ReplyToNotification | null
      runId?: string
      turnId?: string | null
    } = {},
  ): Promise<string> {
    this.#deps.markActive?.()
    const visible = await this.#lock.run(async () => {
      this.#background = opts.background ?? false

      this.#followupRequest = null
      this.#delegatedAsk = null
      this.#cycleInner = null
      this.#cyclePulse = []
      this.#cycleUtterances = []
      this.#lastCycleOutcome = null
      this.#lastRunId = opts.runId ?? randomUUID().replaceAll('-', '')
      this.#lastTurnId = opts.turnId ?? null
      const checkpoint = this.#messages.length
      this.#messages.push({ role: 'user', content: message })
      // 来话即探针 —— 一轮一次检索，结果贴进易变尾部（零 LLM）。
      this.#relevantMemories = this.#buildRelevantMemories(message)
      this.#runSealed = false
      this.#runController = new AbortController()
      let reply: string
      try {

        const timeoutMs = deadlineMs(this.#deps.cycleTimeoutS ?? D01_CYCLE_TIMEOUT_S)
        const controller = this.#runController
        reply = await withDeadline('conversation_cycle', timeoutMs, async signal => {
          try { return await this.#runCycle(signal) }
          finally { if (this.#runController === controller) this.#runSealed = true }
        }, controller.signal)
      } catch (exc) {
        if (exc instanceof DeadlineExceededError) {

          this.#log(CYCLE_TIMEOUT_EVENT, {
            error_type: exc.name,
            elapsed_ms: exc.elapsedMs,
            timeout_ms: exc.timeoutMs,
            reason: 'cycle_timeout',
          })
        }

        // 会毒化之后每一次装配）。已 dispatch 的副作用留在 audit 里。
        const dropped = this.#messages.length - checkpoint
        this.#messages.splice(checkpoint)
        this.#cyclePulse = []
        this.#log('chat_turn_rolled_back', { dropped_messages: dropped })
        throw exc
      } finally {
        this.#runController = null
        this.#runSealed = true

        this.#relevantMemories = null
      }
      if (this.#cycleUtterances.length === 0 && reply) this.#cycleUtterances = [reply]
      const appliedInner = this.#cycleInner
      const now = this.#now()

      const historyId = this.#deps.store.appendHistory(
'conversation',
        JSON.stringify({ user: message, reply, ...(this.#cycleUtterances.length > 1 ? { utterances: this.#cycleUtterances } : {}) }),
        { now },
      )

      // 自相矛盾；出生规格统一成严的那一侧。
      this.#log('inner_outer_pair', {
        history_id: historyId,
        reply_chars: [...reply].length,
        reply_sha16: sha16(reply),
        inner_chars: appliedInner === null ? 0 : [...appliedInner].length,
        has_inner: appliedInner !== null,
      })

      try {
        conversationTurnReflow({
          store: this.#deps.store,
          notifications: this.#deps.notifications ?? emptyNotifications,
          ownerName: this.#deps.persona.owner?.name ?? this.#deps.persona.voice.address_owner,
          userText: message,
          replyText: reply,
          historyId,
          now,
          replyToNotification: opts.replyToNotification ?? null,

          pulse: this.#cyclePulse,
          runId: this.#lastRunId,
          turnId: this.#lastTurnId,
          markReplied: this.#deps.markReplied,
          logEvent: this.#deps.logEvent,
        })
      } catch (exc) {
        this.#log('conversation_reflow_failed', {
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
      opts.onCycleResult?.({
        outcome: structuredClone(this.lastCycleOutcome()),
        followup: this.#followupRequest,
        delegatedAsk: this.#delegatedAsk === null ? null : structuredClone(this.#delegatedAsk),
        utterances: [...this.#cycleUtterances],
      })
      opts.onUtterances?.([...this.#cycleUtterances])
      return reply
    })

    await this.governContext()
    this.#deps.markActive?.()
    return visible
  }
}
