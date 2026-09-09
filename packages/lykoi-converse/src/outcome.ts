/**
 * 回合终局的结构化类型。终局事件由 surface 层落账；Conversation 只暴露
 * 周期结局，避免把传输与认知周期混成同一个状态。
 */

import type { TurnTerminalStatus } from 'lykoi-ingress'

export type TurnStatus = TurnTerminalStatus

export type TurnFailReason =
  | 'decision_suppressed'
  | 'outbound_unavailable'
  | 'envelope_failed'
  | 'missing_tool'
  | 'tool_budget_exhausted'
  | 'llm_failed'
  | 'deadline_exceeded'
  | 'context_budget'
  | 'budget_exceeded'
  | 'delivery_failed'
  | 'no_transport'
  | 'unknown'

export interface TurnOutcome {
  status: TurnStatus
  reason: TurnFailReason | 'approval_answer' | 'suggestion_answer' | 'approval_pending' | null
  followup_registered: boolean
  ask_sent: boolean
  notice_sent: boolean
  reply_chars: number
  elapsed_ms: number
}

export type CycleOutcomeKind =
  | 'suppressed'
  | 'reply'
  | 'silence'
  | 'followup'
  | 'envelope_failed'
  | 'missing_tool'
  | 'tool_budget'
  | 'ask_pending'

export type CycleOutcome =
  | { kind: Exclude<CycleOutcomeKind, 'suppressed'>; step: number }
  | { kind: 'suppressed'; step: number; originalKind: string; reason: string }

/** 两个 surface 共用认知失败投影，不能把框架拒绝误记为主动沉默。 */
export function cycleFailure(outcome: CycleOutcome | null): TurnFailReason | null {
  switch (outcome?.kind) {
    case 'suppressed': return 'decision_suppressed'
    case 'envelope_failed': return 'envelope_failed'
    case 'missing_tool': return 'missing_tool'
    case 'tool_budget': return 'tool_budget_exhausted'
    default: return null
  }
}

/** 技术失败给 owner 的确定性、无供应商正文回执。 */
export const SYSTEM_FAILURE_NOTICE = (reason: TurnFailReason): string =>
  `[系统] 这一轮没有得到可靠回复（代号 ${reason}）。`
