/** 一条外界输入的中性正本。平台专属字段只以 identity/timestamp 形态保留。 */
export interface InboundPart {
  inboundId: string
  channel: string
  platformMessageId: string
  platformUpdateId?: string
  userId: string
  contextId: string
  isOwner: boolean
  text: string
  receivedAt: string
  sourceTimestamp?: string
  /** 适配器启动补收阶段，结束由 finishReplay 明确提交。 */
  replay?: boolean
  /** 只用于既有 approval/suggestion attribution；不让 cognition 看 Telegram update。 */
  replyToPlatformMessageId?: string
}

export type TurnCommitReason = 'idle_timeout' | 'hard_timeout' | 'restart_replay'
export type UserTurnState = 'collecting' | 'queued' | 'running' | 'terminal'

/** parts[] 是正本；rendered text 只能在最后的 Converse 边界临时生成。 */
export interface UserTurn {
  turnId: string
  channel: string
  userId: string
  contextId: string
  isOwner: boolean
  parts: InboundPart[]
  firstReceivedAt: string
  lastReceivedAt: string
  committedAt: string
  commitReason: TurnCommitReason
}

export type TurnTerminalStatus = 'completed' | 'intentional_silence' | 'deferred' | 'failed'

export interface TurnTerminalPayload {
  status: TurnTerminalStatus
  reason: string | null
  followup_registered: boolean
  ask_sent: boolean
  notice_sent: boolean
  reply_chars: number
  elapsed_ms: number
  task_id?: string | null
}

export interface TurnExecutionResult {
  terminal: TurnTerminalPayload
}

export type TurnExecutor = (
  turn: UserTurn,
  context: { runId: string },
) => Promise<TurnExecutionResult>

export interface AcceptInboundResult {
  inboundId: string
  turnId: string
  duplicate: boolean
  partCount: number
}
