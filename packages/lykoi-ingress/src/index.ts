/** Neutral durable ingress：消息 accept 与 cognition 生命周期物理解耦。 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createHash } from 'node:crypto'
import type { AuditService } from 'lykoi-audit'
import { DurableTurnStore } from './store.ts'
import type {
  AcceptInboundResult,
  InboundPart,
  TurnExecutor,
  TurnTerminalPayload,
  UserTurn,
} from './types.ts'

export * from './store.ts'
export * from './types.ts'

export const DEFAULT_IDLE_WINDOW_MS = 1_500
export const DEFAULT_HARD_WINDOW_MS = 4_000
// 仅重试本进程的持久化/审计收尾；不会重跑 cognition，也不是任务重试策略。
const RECOVERY_RETRY_MS = 1_000

export interface RunInterruptor {
  canInterrupt(runId: string): boolean
  interrupt(runId: string): boolean
}

export interface IngressService {
  registerInterruptor?(interruptor: RunInterruptor): void
  accept(part: InboundPart, onDurable?: () => void): Promise<AcceptInboundResult>
  registerExecutor(executor: TurnExecutor): void
  finishReplay?(channel: string): Promise<void>
  /** transport 在 durable cursor 落盘后显式放行 assembler timer / FIFO worker。 */
  kick(): Promise<void>
  tick(now?: Date): Promise<void>
  /** 等待当前 FIFO executor 清空；测试、停机前收敛与验收共用同一语义。 */
  drain(): Promise<void>
  start(): Promise<void>
  /** 停止接收新输入，并等待正在执行的 turn 完成、terminal 落库后再关库。 */
  close(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    ingress: IngressService
  }
}

export interface IngressRuntimeOptions {
  dbPath: string
  audit: AuditService
  idleWindowMs?: number
  hardWindowMs?: number
  autoStart?: boolean
  now?: () => Date
  schedule?: (delayMs: number, callback: () => void) => () => void
  onError?: (where: string, error: unknown) => void
}

export class DurableIngress implements IngressService {
  #interruptor: RunInterruptor | null = null
  #active: { turn: UserTurn; runId: string } | null = null
  #pendingRevision: string | null = null
  #store: DurableTurnStore
  #audit: AuditService
  #idleMs: number
  #hardMs: number
  #autoStart: boolean
  #now: () => Date
  #schedule: NonNullable<IngressRuntimeOptions['schedule']>
  #onError: NonNullable<IngressRuntimeOptions['onError']>
  #cancelTimer: (() => void) | null = null
  #cancelRecovery: (() => void) | null = null
  #executor: TurnExecutor | null = null
  #work: Promise<void> | null = null
  #pumpRequested = false
  #pendingFinish: { turnId: string; terminal: TurnTerminalPayload } | null = null
  #started = false
  #closed = false

  constructor(options: IngressRuntimeOptions) {
    this.#store = new DurableTurnStore(options.dbPath)
    this.#audit = options.audit
    this.#idleMs = options.idleWindowMs ?? DEFAULT_IDLE_WINDOW_MS
    this.#hardMs = options.hardWindowMs ?? DEFAULT_HARD_WINDOW_MS
    if (!Number.isFinite(this.#idleMs) || this.#idleMs <= 0
      || !Number.isFinite(this.#hardMs) || this.#hardMs <= 0
      || this.#idleMs > this.#hardMs) {
      this.#store.close()
      throw new TypeError('lykoi-ingress: require 0 < idleWindowMs <= hardWindowMs')
    }
    this.#autoStart = options.autoStart ?? true
    this.#now = options.now ?? (() => new Date())
    this.#schedule = options.schedule ?? ((delayMs, callback) => {
      const timer = setTimeout(callback, delayMs)
      return () => clearTimeout(timer)
    })
    this.#onError = options.onError ?? (() => {})
  }

  async start(): Promise<void> {
    if (this.#started || this.#closed) return
    try {
      this.#store.recoverRunning(this.#now())
      this.#started = true
      await this.#flushTerminals()
      await this.tick(this.#now())
    } catch (err) {
      this.#recoverLater()
      throw err
    }
  }

  async accept(part: InboundPart, onDurable?: () => void): Promise<AcceptInboundResult> {
    if (this.#closed) throw new Error('lykoi-ingress: closed')
    const active = this.#active
    const revise = active !== null && !active.runId.endsWith(':r2') && part.isOwner && !part.replay
      && part.replyToPlatformMessageId === undefined && active.turn.isOwner
      && active.turn.channel === part.channel && active.turn.contextId === part.contextId
      && active.turn.userId === part.userId && this.#interruptor?.canInterrupt(active.runId) === true
    // 此处直到 interrupt 都无 await：资格判断与 durable append 之间不能插入 dispatch。
    const result = this.#store.accept(part, this.#idleMs, this.#hardMs, revise ? active!.turn.turnId : undefined)
    if (result.revised && !this.#interruptor!.interrupt(active!.runId)) {
      throw new Error('lykoi-ingress: synchronous interrupt contract violated')
    }
    // 同步通知 durable commit；即使后续审计暂时不可用，wake 也已获入站活动信号。
    onDurable?.()
    await this.#audit.record({
      type: 'inbound/accepted',
      inbound_id: result.inboundId,
      turn_id: result.turnId,
      channel: part.channel,
      platform_message_id: part.platformMessageId,
      platform_update_id: part.platformUpdateId ?? null,
      context_id: part.contextId,
      user_id: part.userId,
      is_owner: part.isOwner,
      chars: [...part.text].length,
      text_sha256: createHash('sha256').update(part.text).digest('hex'),
      duplicate: result.duplicate,
    })
    if (!result.duplicate) {
      await this.#audit.record({
        type: 'turn/collecting',
        turn_id: result.turnId,
        inbound_id: result.inboundId,
        part_count: result.partCount,
        channel: part.channel,
        context_id: part.contextId,
        user_id: part.userId,
      })
    }
    for (const turn of result.committed) await this.#recordCommitted(turn)
    return {
      inboundId: result.inboundId,
      turnId: result.turnId,
      duplicate: result.duplicate,
      partCount: result.partCount,
    }
  }

  registerInterruptor(interruptor: RunInterruptor): void { this.#interruptor = interruptor }

  async finishReplay(channel: string): Promise<void> {
    for (const turn of this.#store.finishReplay(channel, this.#now())) await this.#recordCommitted(turn)
    await this.kick()
  }

  registerExecutor(executor: TurnExecutor): void {
    if (this.#executor !== null && this.#executor !== executor) {
      throw new Error('lykoi-ingress: executor already registered')
    }
    this.#executor = executor
    this.#pump()
  }

  async kick(): Promise<void> {
    if (this.#closed) return
    this.#arm()
    this.#pump()
  }

  async tick(now = this.#now()): Promise<void> {
    if (this.#closed) return
    try {
      const committed = this.#store.commitDue(now, this.#idleMs, this.#hardMs)
      for (const turn of committed) await this.#recordCommitted(turn)
      this.#arm()
      this.#pump()
    } catch (err) {
      this.#recoverLater()
      throw err
    }
  }

  #recoverLater(): void {
    if (!this.#autoStart || this.#closed || this.#cancelRecovery !== null) return
    this.#cancelRecovery = this.#schedule(RECOVERY_RETRY_MS, () => {
      this.#cancelRecovery = null
      const recovery = this.#started ? this.tick(this.#now()) : this.start()
      recovery.catch((err) => this.#onError('recovery', err))
    })
  }

  async #recordCommitted(turn: UserTurn): Promise<void> {
    const fields = {
      turn_id: turn.turnId,
      inbound_ids: turn.parts.map((part) => part.inboundId),
      platform_message_ids: turn.parts.map((part) => part.platformMessageId),
      platform_update_ids: turn.parts.map((part) => part.platformUpdateId ?? null),
      part_count: turn.parts.length,
      commit_reason: turn.commitReason,
      first_received_at: turn.firstReceivedAt,
      last_received_at: turn.lastReceivedAt,
      committed_at: turn.committedAt,
    }
    await this.#audit.record({ type: 'turn/committed', ...fields })
    await this.#audit.record({ type: 'turn/queued', ...fields })
  }

  #arm(): void {
    this.#cancelTimer?.()
    this.#cancelTimer = null
    if (!this.#autoStart || this.#closed) return
    const deadline = this.#store.nextDeadline(this.#idleMs, this.#hardMs)
    if (deadline === null) return
    const delay = Math.max(0, deadline.getTime() - this.#now().getTime())
    this.#cancelTimer = this.#schedule(delay, () => {
      this.#cancelTimer = null
      this.tick(this.#now()).catch((err) => this.#onError('timer', err))
    })
  }

  #pump(): void {
    if (this.#executor === null || this.#closed || (this.#autoStart && !this.#started)) return
    if (this.#work !== null) {
      this.#pumpRequested = true
      return
    }
    this.#pumpRequested = false
    const run = async (): Promise<void> => {
      // DB 短暂拒写时保留已完成的结果；恢复只重试落账，绝不再次执行动作。
      this.#finishPending()
      // 上一进程可能已把 terminal 正本落库、但尚未来得及写审计；先补账再认知。
      await this.#flushTerminals()
      while (!this.#closed && this.#executor !== null) {
        const claimed = this.#store.claimNext(this.#now())
        if (claimed === null) break
        let terminal: TurnTerminalPayload
        this.#active = claimed
        try {
          terminal = (await this.#executor(claimed.turn, { runId: claimed.runId })).terminal
        } catch (err) {
          terminal = {
            status: 'failed', reason: 'unknown', followup_registered: false,
            ask_sent: false, notice_sent: false, reply_chars: 0, elapsed_ms: 0,
            continuation_id: null,
          }
          if (!this.#store.revisionPending(claimed.turn.turnId)) this.#onError('executor', err)
        } finally {
          this.#active = null
        }
        if (this.#store.revisionPending(claimed.turn.turnId)) {
          this.#pendingRevision = claimed.turn.turnId
          this.#finishPending()
          await this.#flushTerminals()
          continue
        }
        this.#pendingFinish = { turnId: claimed.turn.turnId, terminal }
        this.#finishPending()
        await this.#flushTerminals()
      }
    }
    this.#work = run()
      .catch((err) => {
        this.#recoverLater()
        this.#onError('pump', err)
      })
      .finally(() => {
        this.#work = null
        if (this.#pumpRequested) this.#pump()
      })
  }

  #finishPending(): void {
    if (this.#pendingRevision !== null) {
      this.#store.revise(this.#pendingRevision, this.#now())
      this.#pendingRevision = null
    }
    if (this.#pendingFinish === null) return
    const { turnId, terminal } = this.#pendingFinish
    if (!this.#store.finish(turnId, terminal, this.#now())) {
      throw new Error(`lykoi-ingress: turn ${turnId} is no longer running`)
    }
    this.#pendingFinish = null
  }

  async drain(): Promise<void> {
    this.#pump()
    while (this.#work !== null) await this.#work
  }

  async #flushTerminals(): Promise<void> {
    for (const abort of this.#store.unauditedRunAborts()) {
      const event = { type: 'converse/run_aborted', turn_id: abort.turnId, run_id: abort.runId,
        reason: 'revision', ts: abort.ts }
      const eventId = `run-aborted:${abort.runId}`
      if (this.#audit.recordOnce) await this.#audit.recordOnce(eventId, event)
      else await this.#audit.record({ ...event, event_id: eventId })
      this.#store.markRunAbortAudited(abort.turnId, abort.index)
    }
    for (const row of this.#store.unauditedTerminals()) {
      const last = row.turn.parts.at(-1)!
      // Existing spool rows may predate the four-state contract. Normalize only
      // their pending audit projection; immutable historical audit rows stay intact.
      const priorStatus = String(row.terminal.status)
      const payload: TurnTerminalPayload = { ...row.terminal }
      if (priorStatus === 'replied' || priorStatus === 'consumed') payload.status = 'completed'
      else if (!['completed', 'intentional_silence', 'deferred', 'failed'].includes(priorStatus)) {
        payload.status = 'failed'
        payload.reason = 'unknown'
      }
      const terminalEvent = {
        type: 'converse/turn_terminal',
        turn_id: row.turn.turnId,
        inbound_id: row.turn.parts[0]!.inboundId,
        inbound_ids: row.turn.parts.map((part) => part.inboundId),
        platform_message_ids: row.turn.parts.map((part) => part.platformMessageId),
        platform_update_ids: row.turn.parts.map((part) => part.platformUpdateId ?? null),
        run_id: row.runId,
        update_id: last.platformUpdateId ?? null,
        message_id: last.platformMessageId,
        reply_anchor_message_id: last.platformMessageId,
        context_id: row.turn.contextId,
        user_id: row.turn.userId,
        is_owner: row.turn.isOwner,
        part_count: row.turn.parts.length,
        commit_reason: row.turn.commitReason,
        ...payload,
      }
      const eventId = `turn-terminal:${row.turn.turnId}`
      if (this.#audit.recordOnce === undefined) {
        await this.#audit.record({ ...terminalEvent, event_id: eventId })
      } else {
        await this.#audit.recordOnce(eventId, terminalEvent)
      }
      if (payload.status === 'intentional_silence') {
        const derived = { type: 'converse/silence', turn_id: row.turn.turnId, run_id: row.runId,
          terminal_event_id: eventId, derived: true }
        const derivedId = `turn-silence:${row.turn.turnId}`
        if (this.#audit.recordOnce) await this.#audit.recordOnce(derivedId, derived)
        else await this.#audit.record({ ...derived, event_id: derivedId })
      }
      this.#store.markTerminalAudited(row.turn.turnId)
    }
  }

  async close(): Promise<void> {
    if (this.#closed) {
      if (this.#work !== null) await this.#work
      return
    }
    this.#closed = true
    this.#cancelTimer?.()
    this.#cancelTimer = null
    this.#cancelRecovery?.()
    this.#cancelRecovery = null
    if (this.#work !== null) await this.#work
    this.#store.close()
  }
}

export const name = 'lykoi-ingress'
export const inject = ['audit']

export interface Config {
  dbPath: string
  idleWindowMs: number
  hardWindowMs: number
  autoStart: boolean
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
  idleWindowMs: Schema.number().default(DEFAULT_IDLE_WINDOW_MS),
  hardWindowMs: Schema.number().default(DEFAULT_HARD_WINDOW_MS),
  autoStart: Schema.boolean().default(true),
})

export function apply(ctx: Context, config: Config): void {
  const ingress = new DurableIngress({
    dbPath: config.dbPath,
    audit: ctx.audit,
    idleWindowMs: config.idleWindowMs,
    hardWindowMs: config.hardWindowMs,
    autoStart: config.autoStart,
    onError: (where, err) => ctx.logger.error('lykoi-ingress %s failed: %s', where, String(err)),
  })
  ctx.provide('ingress', ingress)
  ctx.effect(() => {
    ingress.start().catch((err) => ctx.logger.error('lykoi-ingress startup failed: %s', String(err)))
    return () => ingress.close()
  }, 'lykoi-ingress durable turn runtime')
}
