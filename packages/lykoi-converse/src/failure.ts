/**
 * 技术失败 → TurnFailReason 的映射（WO-OUTCOME-01 出生于 index.ts；
 * WO-CONTINUATION-01 把它抽出来给续跑路径共用 —— 同一种错误在回合与续跑里
 * 必须是同一个代号，owner 看到的回执才对得上号）。
 */
import { LlmFinishError } from 'lykoi-llm'
import { ContextBudgetError } from './conversation.ts'
import { DeadlineExceededError } from './deadline.ts'
import type { TurnFailReason } from './outcome.ts'

export function failureReason(err: unknown): TurnFailReason {
  if (err instanceof ContextBudgetError) return 'context_budget'
  if (err instanceof LlmFinishError) return 'llm_failed'
  if (err instanceof DeadlineExceededError) return 'deadline_exceeded'
  if (err instanceof Error && err.name === 'BudgetExceeded') return 'budget_exceeded'
  return 'unknown'
}
