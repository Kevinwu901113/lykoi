import { isWithin } from './path-guard.ts'

export const HARD_ASK_TYPES: ReadonlySet<string> = new Set([
  'terminal.exec',
  'delegation.dispatch',
])

// 即使所有者批准也永不可跑的动作类型。当前为空 —— 保留位；按动作的拒绝在
// live 规则里，按路径的在 PROTECTED_PATHS。
export const HARD_DENY_TYPES: ReadonlySet<string> = new Set([])

/** Existing autonomous defaults; deployment rules may authorize other registered capabilities. */
export const AUTONOMOUS_DEFAULT_ALLOWED: ReadonlySet<string> = new Set([
  'research_browser.open',
  'research_browser.read_text',
  'research_browser.extract_links',
  'research_browser.screenshot',
  'autonomy.queue_notification',
  'autonomy.initiate_chat', // WO-NIGHT-01/B3: 主动开口(对话消息; 日1条/冷却6h 在资源层强制)

  'messenger.send',
  'messenger.read',
])

export const GATE_SOURCE_CANONICAL = '/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate'

export const PROTECTED_PATHS: readonly string[] = [
  '/home/lykoi/secrets',
  GATE_SOURCE_CANONICAL,
]

export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((base) => isWithin(path, base))
}

export type HardDecision = 'deny' | 'ask' | null
export type CapabilityDecision = 'allow' | 'deny' | null

/** "deny" / "ask" / null（交给 live 规则）。 */
export function hardDecision(actionType: string): HardDecision {
  if (HARD_DENY_TYPES.has(actionType)) return 'deny'
  if (HARD_ASK_TYPES.has(actionType)) return 'ask'
  return null
}

/** Autonomous defaults, with approval-required operations still unavailable autonomously. */
export function capabilityProfile(origin: string, actionType: string): CapabilityDecision {
  if (origin !== 'autonomous') return null
  if (HARD_ASK_TYPES.has(actionType)) return 'deny'
  return AUTONOMOUS_DEFAULT_ALLOWED.has(actionType) ? 'allow' : null
}

/** approval 侧咨询的 core 形状（null = 加载失败 → fail CLOSED）。 */
export interface PolicyCoreLike {
  hardDecision(actionType: string): HardDecision
  capabilityProfile(origin: string, actionType: string): CapabilityDecision
}

/** 内建 core 的句柄形态（approval 缺省咨询它）。 */
export const builtinPolicyCore: PolicyCoreLike = { hardDecision, capabilityProfile }
