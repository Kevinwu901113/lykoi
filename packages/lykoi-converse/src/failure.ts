/**
 * 技术失败 → TurnFailReason 的映射（WO-OUTCOME-01 出生于 index.ts；
 * WO-CONTINUATION-01 把它抽出来给续跑路径共用 —— 同一种错误在回合与续跑里
 * 必须是同一个代号，owner 看到的回执才对得上号）。
 */
import { OutboundUnavailableError } from 'lykoi-adapter-telegram'
import { LlmFinishError, LlmJsonError } from 'lykoi-llm'
import { ContextBudgetError } from './conversation.ts'
import { DeadlineExceededError } from './deadline.ts'
import type { TurnFailReason } from './outcome.ts'

export function failureReason(err: unknown): TurnFailReason {
  if (err instanceof OutboundUnavailableError) return 'outbound_unavailable'
  if (err instanceof ContextBudgetError) return 'context_budget'
  if (err instanceof LlmJsonError) return 'envelope_failed'
  if (err instanceof LlmFinishError) return 'llm_failed'
  if (err instanceof DeadlineExceededError) return 'deadline_exceeded'
  if (err instanceof Error && err.name === 'BudgetExceeded') return 'budget_exceeded'
  return 'unknown'
}

/** JSON/protocol recovery has already been exhausted by the LLM service. */
export function isTransientInterpretFailure(error: unknown): boolean {
  if (error instanceof LlmJsonError) return false
  if (error instanceof DeadlineExceededError) return true
  if (!(error instanceof LlmFinishError) || error.reason.kind !== 'error') return false
  const { code, status } = error.reason.failure
  if (code === 'EMPTY_RESPONSE') return false
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status < 600)
}
