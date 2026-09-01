/**
 * `capability_gap` —— 一等审计事件（WO-U2-SENSE-01）。
 *
 * 来源：Capability Forge 方案评估（governance/docs/
 * capability_forge_assessment_2026-09-01.md）认定的三条净新贡献之一 ——
 * 「她想调却没有的能力，先诚实答复、后留痕」。落位节把它并进本单；Forge 本体
 * （Builder / Candidate Artifact / 价值阈值 / resolution 优先）**不在本单**，
 * 裁定 D-FORGE-1（启用权归治理侧）与 D-FORGE-2（永不成为第二委托口）是上位约束。
 *
 * ## 它是什么 / 不是什么
 *
 * 新体今天有四个结构位点会拒绝「她选了一个此刻不被承认的动作」，四条拒绝各有
 * 各的局部账（`unknown decision kind` 抛错 / `decision_ungrounded` 降级 /
 * `cycle_unknown_tool` 回填 error / `unknown_decision_kind` 记 failed）。四条账
 * 互不相识，没有一条能回答「她这一周想做而做不到的是哪些事、各几次」。本事件
 * 就是那个收口：**同一个名字、同一组字段、跨两条生产路径可计数**。
 *
 * 它**不是**一个判定。三条纪律：
 *
 *  1. **零控制流**。发射点全部是既有拒绝语句的**旁边**，不在它前面也不代替它；
 *     四处原拒绝语义逐字节不变。`emitCapabilityGap` 无返回值且永不抛 —— 事件写
 *     失败不毁一轮（与 `organ_inventory_bindings_failed` 先例同向：遥测永不是
 *     控制流，SK-08）。
 *  2. **只落结构字段**（D-08 / D-01 失败事件元数据口径）。`wanted` 过
 *     `capabilityToken` 的标签闸 —— 整值 ≤20 字才原样记，超过只记长度、
 *     **不截断**（口径逐字取自 `lykoi-converse/contract.ts` 的 `kindToken`：
 *     截断会把一句话的前 20 字落进日志）。用户消息、工具参数、URL、reason 正文
 *     一个字都不进。
 *  3. **不发明判定点**。`not_registered`（图式注册表的「在位」判定，GK-11）
 *     刻意**没有**发射点：新体今天没有任何生产路径会拿她选的动作去问
 *     `BodySchemaRegistry`（`registryActionCatalog` 尚未接线，归 M5 编排），
 *     凭空造一个判定点等于凭空造一条语义。等注册表真的接进 catalog 那一刻，
 *     发射点跟着长出来，reason 常量在这里已经预留。
 */

/**
 * 事件名。`emitCapabilityGap` 里刻意写**字面量**而不是引这个常量：完整性门
 * 的遥测词汇扫描（`lykoi-gate/src/vocabulary.ts` 的 `EMISSION_RE`）只认
 * `logEvent('…'` 形态的字面量，用常量会让这个名字在门那一侧隐形。两者不许分叉
 * 由测试钉死（`capability-gap.test.ts` 第一条）。
 */
export const CAPABILITY_GAP_EVENT = 'capability_gap'

/** 名字不在动作/工具词汇表（converse：`TOOL_TO_ACTION` 未命中）。 */
export const GAP_UNKNOWN_ACTION = 'unknown_action'
/** 决策 kind 不在本情境的 kind 词汇表（decide：`KINDS` / `CONVERSATION_KINDS`）。 */
export const GAP_UNKNOWN_KIND = 'unknown_kind'
/** kind 合法，但本拍候选表没给（decide：`decision_ungrounded` 的同一判定）。 */
export const GAP_KIND_NOT_IN_CANDIDATES = 'kind_not_in_candidates'
/** kind 合法且在候选表，但执行点没有它的分支（reflow：`unknown_decision_kind`）。 */
export const GAP_NO_EXECUTION_BRANCH = 'no_execution_branch'
/**
 * 器官没在图式注册表里登记（GK-11 的「在位」判定）。**今天没有发射点** ——
 * 见文件头纪律 3。常量在此是为了 reason 值域从一开始就是一张表而不是散字符串。
 */
export const GAP_NOT_REGISTERED = 'not_registered'

export const GAP_REASONS = [
  GAP_UNKNOWN_ACTION,
  GAP_UNKNOWN_KIND,
  GAP_KIND_NOT_IN_CANDIDATES,
  GAP_NO_EXECUTION_BRANCH,
  GAP_NOT_REGISTERED,
] as const

export type CapabilityGapReason = (typeof GAP_REASONS)[number]

/** 两条生产路径（G-7 的两个消费者：独处的她与聊天的她）。 */
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
