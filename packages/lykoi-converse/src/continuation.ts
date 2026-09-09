import type { MessengerAdapterService } from 'lykoi-adapter-telegram'
import type { PendingContinuationRow } from 'lykoi-memory/rw'
import type { Conversation, CycleResult } from './conversation.ts'
import { failureReason } from './failure.ts'
import { cycleFailure, type TurnFailReason } from './outcome.ts'
import { sequenceUtterances } from './sequencer.ts'
import type { OutboundReplyOutcome } from 'lykoi-adapter-telegram'

/** D-5：pending 行超过这个时长还没跑上就作废（6 h）。 */
export const CONTINUATION_TTL_S = 21600
/** D-3：一次扫描最多认领的行数。 */
export const CONTINUATION_SCAN_LIMIT = 3
/** 续跑回合的开场白 —— 用户轮，带她自己答应过的原文。 */
export const CONTINUATION_PROMPT = (goal: string): string =>
  `【后台跟进】上一轮你答应完成：${goal}。现在继续。`
/** D-7：失败/过期给 owner 的确定性回执（无供应商正文）。 */
export const CONTINUATION_FAILURE_NOTICE = (reason: string): string =>
  `[系统] 上一轮答应的跟进没有完成（代号 ${reason}）。`

export type ContinuationTerminalState = 'completed' | 'failed' | 'expired'
export type ContinuationReason = TurnFailReason | 'approval_pending' | 'interrupted' | 'no_result' | 'chained_request' | null

export interface ContinuationStore {
  registerContinuation(row: {
    id: string
    originTurnId: string
    originRunId: string | null
    goal: string
    dueAt: Date
    now: Date
  }): void
  dueContinuations(now: Date, limit: number): PendingContinuationRow[]
  runningContinuations(): PendingContinuationRow[]
  claimContinuation(id: string, runId: string, now: Date): boolean
  finishContinuation(
    id: string, state: ContinuationTerminalState, reason: string | null, now: Date,
  ): boolean
  ownerBinding(): { channel: string; channel_key: string } | null
}

export type ContinuationConversation = Pick<
  Conversation, 'send' | 'lastCycleOutcome' | 'hasFollowupRequest' | 'takeFollowupRequest'
>

export interface ContinuationAudit {
  record(event: { type: string } & Record<string, unknown>): Promise<void>
}

export interface ContinuationRunnerDeps {
  store: ContinuationStore
  conversation: ContinuationConversation
  audit: ContinuationAudit
  /** 晚绑定：telegram 插件可能 disabled，每次要用时再取。 */
  messenger: () => Pick<MessengerAdapterService, 'transportSend'> | undefined
  /** 出站就绪才认领；持久 followup 经设备唯一消费者返回实际投递结果。 */
  canDeliver: () => boolean
  deliver: (content: string) => Promise<OutboundReplyOutcome>
  now: () => Date
  /** 后台错误的兜底出口（kick / 启动效应里的 promise 拒绝）。 */
  onError?: (where: string, err: unknown) => void
  runOwned?: <T>(work: () => Promise<T>) => Promise<T>
}

export interface ScanSummary {
  /** 扫描被进程内互斥挡住（已标记重扫）。 */
  skipped: boolean
  claimed: number
  expired: number
}

/** 跨插件（wake）看到的面。 */
export interface ContinuationsService {
  register(input: { originTurnId: string; originRunId: string | null; goal: string }): string | null
  scan(now: Date): Promise<ScanSummary>
  kick(): void
}

function parsePyIso(s: string): number {
  const ms = Date.parse(s)
  return Number.isNaN(ms) ? Number.NaN : ms
}

export class ContinuationRunner implements ContinuationsService {
  readonly #deps: ContinuationRunnerDeps
  #scanning: Promise<ScanSummary> | null = null
  #rescan = false

  constructor(deps: ContinuationRunnerDeps) {
    this.#deps = deps
  }

  /**
   * D-2：登记。返回 id；登记失败（例如同一回合两次、库不可写）落
   * `continuation/register_failed` 并返回 null —— 回合终局不因账簿故障翻车。
   */
  register(input: { originTurnId: string; originRunId: string | null; goal: string }): string | null {
    const now = this.#deps.now()
    const id = `cont-${input.originTurnId}-${now.getTime()}`
    try {
      this.#deps.store.registerContinuation({
        id,
        originTurnId: input.originTurnId,
        originRunId: input.originRunId,
        goal: input.goal,
        dueAt: now,
        now,
      })
      return id
    } catch (err) {
      void this.#deps.audit.record({
        type: 'continuation/register_failed',
        continuation_id: id,
        origin_turn_id: input.originTurnId,
        origin_run_id: input.originRunId,
        goal_chars: [...input.goal].length,
        error_name: err instanceof Error ? err.name : 'unknown',
      }).catch(() => {})
      return null
    }
  }

  /** 登记后立刻踢一脚，不等 cheap tick。失败只走 onError。 */
  kick(): void {
    this.scan(this.#deps.now()).catch((err) => {
      this.#deps.onError?.('kick', err)
    })
  }

  /**
   * D-3：到期扫描。进程内互斥 —— 撞上正在跑的扫描就标记重扫并让位（返回
   * skipped），正在跑的那次结束前会再扫一圈把新登记的行捡起来。
   */
  async scan(now: Date): Promise<ScanSummary> {
    return this.#deps.runOwned ? this.#deps.runOwned(() => this.#scan(now)) : this.#scan(now)
  }

  async #scan(now: Date): Promise<ScanSummary> {
    if (!this.#deps.canDeliver()) return { skipped: true, claimed: 0, expired: 0 }
    if (this.#scanning !== null) {
      this.#rescan = true
      return { skipped: true, claimed: 0, expired: 0 }
    }
    const run = (async (): Promise<ScanSummary> => {
      const summary: ScanSummary = { skipped: false, claimed: 0, expired: 0 }
      let clock = now
      do {
        this.#rescan = false
        const rows = this.#deps.store.dueContinuations(clock, CONTINUATION_SCAN_LIMIT)
        for (const row of rows) {
          const due = parsePyIso(row.due_at)
          if (!Number.isNaN(due) && clock.getTime() - due > CONTINUATION_TTL_S * 1000) {
            if (this.#deps.store.finishContinuation(row.id, 'expired', null, clock)) {
              summary.expired += 1
              await this.#terminal(row, { state: 'expired', reason: null, elapsedMs: 0, replyChars: 0, chained: false })
              await this.#notice('expired')
            }
            continue
          }
          const runId = `continuation-${row.id}`
          if (!this.#deps.store.claimContinuation(row.id, runId, clock)) continue
          summary.claimed += 1
          await this.#run(row, runId)
        }
        clock = this.#deps.now()
      } while (this.#rescan)
      return summary
    })()
    this.#scanning = run
    try {
      return await run
    } finally {
      this.#scanning = null
    }
  }

  /**
   * 启动扫描：上一个进程死在半路留下的 running 行一律收成 failed(interrupted)
   * 并回执 —— 不重跑（她答应的那件事的上下文已经随进程没了）。
   */
  async recoverOnStartup(now: Date): Promise<number> {
    let recovered = 0
    for (const row of this.#deps.store.runningContinuations()) {
      if (!this.#deps.store.finishContinuation(row.id, 'failed', 'interrupted', now)) continue
      recovered += 1
      await this.#terminal(row, { state: 'failed', reason: 'interrupted', elapsedMs: 0, replyChars: 0, chained: false })
      await this.#notice('interrupted')
    }
    return recovered
  }

  async #run(row: PendingContinuationRow, runId: string): Promise<void> {
    const started = performance.now()
    let state: ContinuationTerminalState = 'completed'
    let reason: ContinuationReason = null
    let replyChars = 0
    let chained = false
    try {
      let captured: CycleResult | undefined
      const reply = await this.#deps.conversation.send(CONTINUATION_PROMPT(row.goal), {
        background: true,
        runId,
        turnId: row.id,
        onCycleResult: result => { captured = result; this.#deps.conversation.takeFollowupRequest() },
      })
      // D-6：续跑里又答应"稍后做" —— 取走丢弃，只记旗子，不登记新行。
      const result = captured ?? {
        outcome: this.#deps.conversation.lastCycleOutcome(), followup: this.#deps.conversation.takeFollowupRequest(),
        utterances: reply ? [reply] : [],
      }
      chained = result.followup !== null
      const kind = result.outcome?.kind ?? null
      const failure = cycleFailure(result.outcome)
      if (failure) { state = 'failed'; reason = failure }
      else if (kind === 'ask_pending') { state = 'failed'; reason = 'approval_pending' }
      else if (chained || kind === 'followup') { state = 'failed'; reason = 'chained_request' }
      else if (kind !== 'reply' || result.utterances.length === 0) { state = 'failed'; reason = 'no_result' }
      else {
        replyChars = reply.length
        const delivery = await sequenceUtterances(result.utterances, this.#deps.deliver)
        if (delivery.outcome !== 'delivered') { state = 'failed'; reason = 'delivery_failed' }
      }
    } catch (err) {
      state = 'failed'
      reason = failureReason(err)
    }
    const now = this.#deps.now()
    const elapsedMs = Math.max(0, Math.round(performance.now() - started))
    if (!this.#deps.store.finishContinuation(row.id, state, reason, now)) return
    await this.#terminal({ ...row, run_id: runId }, { state, reason, elapsedMs, replyChars, chained })
    if (state === 'failed') await this.#notice(reason ?? 'unknown')
  }

  async #terminal(
    row: PendingContinuationRow,
    outcome: {
      state: ContinuationTerminalState
      reason: ContinuationReason
      elapsedMs: number
      replyChars: number
      chained: boolean
    },
  ): Promise<void> {
    await this.#deps.audit.record({
      type: 'continuation/terminal',
      continuation_id: row.id,
      origin_turn_id: row.origin_turn_id,
      origin_run_id: row.origin_run_id,
      run_id: row.run_id,
      state: outcome.state,
      reason: outcome.reason,
      goal_chars: [...row.goal].length,
      elapsed_ms: outcome.elapsedMs,
      reply_chars: outcome.replyChars,
      chained_request: outcome.chained,
    })
  }

  /**
   * D-7：回执只发给 owner 绑定的 chat；无传输 / 无绑定 / 发失败都只落账。
   * 走 transportSend（主动出站，无 reply_to）：续跑没有"当轮入站"可回，裸
   * `send` 是 reply-only 门面。
   */
  async #notice(reason: string): Promise<void> {
    const messenger = this.#deps.messenger()
    const chatId = this.#deps.store.ownerBinding()?.channel_key ?? null
    if (messenger === undefined || chatId === null) {
      await this.#deps.audit.record({
        type: 'continuation/notice_failed',
        reason,
        error_name: messenger === undefined ? 'no_transport' : 'no_owner_binding',
      })
      return
    }
    try {
      const result = await messenger.transportSend(chatId, CONTINUATION_FAILURE_NOTICE(reason), null, {
        recordUndeliveredExperience: false,
      })
      if (!result.sent) throw new Error('notice_not_delivered')
    } catch (err) {
      await this.#deps.audit.record({
        type: 'continuation/notice_failed',
        reason,
        error_name: err instanceof Error ? err.name : 'unknown',
      })
    }
  }
}
