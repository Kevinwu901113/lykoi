export const CAPABILITY_GAP_EVENT = 'capability_gap'

/** 名字不在动作/工具词汇表（converse：Runtime 未注册）。 */
export const GAP_UNKNOWN_ACTION = 'unknown_action'
/** 决策 kind 不在本情境的 kind 词汇表（decide：`KINDS` / `CONVERSATION_KINDS`）。 */
export const GAP_UNKNOWN_KIND = 'unknown_kind'
/** kind 合法，但本拍候选表没给（decide：`decision_ungrounded` 的同一判定）。 */
export const GAP_KIND_NOT_IN_CANDIDATES = 'kind_not_in_candidates'
/** kind 合法且在候选表，但执行点没有它的分支（reflow：`unknown_decision_kind`）。 */
export const GAP_NO_EXECUTION_BRANCH = 'no_execution_branch'

export const GAP_NOT_REGISTERED = 'not_registered'

export const GAP_NOT_WIRED = 'not_wired'

export const GAP_REASONS = [
  GAP_UNKNOWN_ACTION,
  GAP_UNKNOWN_KIND,
  GAP_KIND_NOT_IN_CANDIDATES,
  GAP_NO_EXECUTION_BRANCH,
  GAP_NOT_REGISTERED,
  GAP_NOT_WIRED,
] as const

export type CapabilityGapReason = (typeof GAP_REASONS)[number]

export type CapabilityGapSource = 'wake' | 'converse'

/**
 * 情境栏。**只进事件，不参与任何判定** —— 缺席时事件照发，两栏记 `null`
 * （不编造一个来源；"不知道是谁问的" 与 "是 wake 问的" 必须分得开）。
 */
export interface CapabilityGapContext {
  source: CapabilityGapSource
  runId?: string | null
}

/** 与 `lykoi-converse` 的 `KIND_DETAIL_MAX` 同值：20 是「标签」与「话」的分界。 */
export const WANTED_TOKEN_MAX = 20

/** `logEvent` 的结构形状（本模块不 import 任何东西 —— 与 organs.ts 同一条纪律）。 */
type LogEventLike = (name: string, fields: Record<string, unknown>) => void

/**
 * `wanted` 的标签闸。整值 ≤20 字（码点）才原样记 —— 近失手的
 * `"browser_navigat"` / `"send_email"` 正是要看的东西；超过只记长度，
 * **不截断**（截断 = 把一句话的前 20 字落进日志）。
 */
export function capabilityToken(wanted: unknown): string {
  if (wanted === null || wanted === undefined) return 'missing'
  if (typeof wanted !== 'string') return 'nonstring'
  const stripped = wanted.trim()
  if (!stripped) return 'blank'
  const cps = [...stripped]
  if (cps.length <= WANTED_TOKEN_MAX) return stripped
  return `unrecognized:len${cps.length}`
}

/**
 * 落一条 `capability_gap`。**旁路留痕**：调用点不许消费返回值，也不许因它改道。
 *
 * 字段四栏固定：`wanted`（过标签闸的能力名）/ `source` / `run_id` / `reason`。
 * 键名用 `run_id` 而不是驼峰 —— 与审计行既有词汇（`autonomy_wake_failed` 等
 * 全部用 `run_id`）同一口径，事后按 run 聚合的人不必记两套拼法。
 */
export function emitCapabilityGap(
  logEvent: LogEventLike | undefined,
  fields: {
    wanted: unknown
    reason: CapabilityGapReason
    source?: CapabilityGapSource | null
    runId?: string | null
  },
): void {
  try {
    // 字面量而非 CAPABILITY_GAP_EVENT：见该常量顶注（门的遥测扫描只认字面量）。
    logEvent?.('capability_gap', {
      wanted: capabilityToken(fields.wanted),
      source: fields.source ?? null,
      run_id: fields.runId ?? null,
      reason: fields.reason,
    })
  } catch {
    // fail-safe（organ_inventory_bindings_failed 先例）：留痕失败不毁一轮。
    // 刻意连一条"留痕失败"的事件都不补 —— 那需要同一个已经坏掉的 sink。
  }
}
