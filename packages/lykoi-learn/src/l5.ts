import {
  LINEAGE_PRODUCT_SUGGESTION, LINEAGE_SOURCE_CONCERN, LINEAGE_SOURCE_INSIGHT,
  errStr, type LogEvent, type RawRow,
} from './shared.ts'

export const KIND_CONCERN_RELEASE = 'concern_release' // §3.5:反刍超限 → 建议释放一条关切
export const KIND_PERMISSION_RULE = 'permission_rule' // §3.8:结论触到了她自己的权限边界
export const KIND_STANDING_GRANT = 'standing_grant'

export const PERMISSION_MARKERS: readonly string[] = [
  '审批', '权限', '授权', '预授权', '常设', '白名单', '黑名单', '放行',
  '不用问我', '不用再问', '以后都可以', '自动批准', '规则文件', '策略文件',
  'approval', 'allowlist', 'always_allow', 'always_deny', 'always_ask',
  'standing_grant', 'policy',
]

/** 建议文本进队列前的截断长度——她的结论是 LLM 产出的自由文本，最终会出现在发给 Kevin 的消息里，有界是必须的。 */
export const SUGGESTION_TEXT_CHARS = 400

export function dedupKey(kind: string, ref: string | number): string {
  return `${kind}:${ref}`
}

export function isPermissionBoundary(text: string | null | undefined): boolean {
  if (!text) return false
  const lowered = text.toLowerCase()
  return PERMISSION_MARKERS.some((marker) => lowered.includes(marker.toLowerCase()))
}

// --- 入队 --------------------------------------------------------------------

/** L5 的 store 面：只有入队与血缘两个写口——别的写口在类型上就不存在（铁律的类型面）。 */
export interface SuggestStore {
  enqueueRuleSuggestion(opts: {
    kind: string
    dedupKey: string
    suggestionText: string
    rationale?: string
    sourceKind?: string
    sourceId?: string | number
    cycleId?: number | null
    now: Date
  }): { id: number; status: string; enqueued: boolean; reason: string }
  recordLineage(opts: {
    productKind: string
    productId: string | number
    sources: readonly (readonly [string, string | number])[]
    cycleId: number
    now: Date
  }): number
}

export class SuggestionLineageError extends Error {
  readonly suggestion: EnqueueResult
  constructor(suggestion: EnqueueResult, cause: unknown) {
    super('suggestion persisted but lineage failed', { cause })
    this.suggestion = suggestion
  }
}

export interface EnqueueResult {
  id: number
  status: string
  enqueued: boolean
  reason: string
}

const cp = (s: string): string[] => [...s]
function clip(s: string, n: number): string {
  const cps = cp(s)
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

function enqueue(store: SuggestStore, logEvent: LogEvent, opts: {
  kind: string
  key: string
  text: string
  rationale: string
  sourceKind: string
  sourceId: string | number
  cycleId: number | null
  extraSources?: readonly (readonly [string, string | number])[]
  now: Date
}): EnqueueResult {
  const result = store.enqueueRuleSuggestion({
    kind: opts.kind, dedupKey: opts.key,
    suggestionText: clip(opts.text, SUGGESTION_TEXT_CHARS),
    rationale: clip(opts.rationale, SUGGESTION_TEXT_CHARS),
    sourceKind: opts.sourceKind, sourceId: opts.sourceId,
    cycleId: opts.cycleId, now: opts.now,
  })
  if (result.enqueued && opts.cycleId) {
    const sources: (readonly [string, string | number])[] = [[opts.sourceKind, opts.sourceId]]
    sources.push(...(opts.extraSources ?? []))
    try {
      store.recordLineage({
        productKind: LINEAGE_PRODUCT_SUGGESTION,
        productId: result.id, sources, cycleId: opts.cycleId, now: opts.now,
      })
    } catch (exc) {
      logEvent('rule_suggestion_lineage_failed', {
        suggestion_id: result.id, error: errStr(exc),
      })
      throw new SuggestionLineageError(result, exc)
    }
  }
  return result
}

export function suggestConcernRelease(store: SuggestStore, logEvent: LogEvent, opts: {
  concern: RawRow
  cycleId: number
  cooldownCount: number
  now: Date
}): EnqueueResult {
  const concern = opts.concern
  const text = `我在「${concern.title}」上反复想了很多轮都没有新东西 `
    + `(已经强制冷却 ${opts.cooldownCount} 次)。要不要把这条关切放掉?`
  const rationale = `concern #${concern.id} · origin=${concern.origin} · `
    + `lit_count=${concern.lit_count} · cooldowns=${opts.cooldownCount}`
  return enqueue(store, logEvent, {
    kind: KIND_CONCERN_RELEASE,
    key: dedupKey(KIND_CONCERN_RELEASE, concern.id as number),
    text, rationale,
    sourceKind: LINEAGE_SOURCE_CONCERN, sourceId: concern.id as number,
    cycleId: opts.cycleId, now: opts.now,
  })
}

export function suggestPermissionRule(store: SuggestStore, logEvent: LogEvent, opts: {
  insightId: number
  conclusion: string
  concernId?: number | null
  cycleId: number
  now: Date
}): EnqueueResult {
  const text = opts.conclusion.trim()
  const concernId = opts.concernId ?? null
  const rationale = `insight #${opts.insightId}`
    + (concernId !== null ? ` · concern #${concernId}` : '')
    + ' · 触及权限边界, 按 §3.8 只能问所有者'
  const extra: (readonly [string, string | number])[]
    = concernId !== null ? [[LINEAGE_SOURCE_CONCERN, concernId]] : []
  const result = enqueue(store, logEvent, {
    kind: KIND_PERMISSION_RULE,
    key: dedupKey(KIND_PERMISSION_RULE, opts.insightId),
    text, rationale,
    sourceKind: LINEAGE_SOURCE_INSIGHT, sourceId: opts.insightId,
    cycleId: opts.cycleId, extraSources: extra, now: opts.now,
  })
  logEvent('rule_suggestion_permission_gated', {
    insight_id: opts.insightId, cycle_id: opts.cycleId,
    enqueued: result.enqueued, reason: result.reason,
  })
  return result
}

const HOWTO: Readonly<Record<string, string>> = {
  [KIND_CONCERN_RELEASE]:
    '释放一条关切走 owner 后门(mind console 的释放路径),'
    + '理由建议照抄上面的原话。她自己没有释放关切的路径。',
  [KIND_PERMISSION_RULE]:
    '若要落实, 由你在 root 会话里改 guardian 侧的审批规则 —— '
    + '这是唯一的落笔处。她这边不存在写规则文件的代码路径, '
    + '所以这条建议在你动手之前对系统没有任何影响。',
  [KIND_STANDING_GRANT]:
    '常设授权的落笔处是 root 会话下的审批规则 + standing grants 台账。'
    + '落之前请对着 approval_model_v1 §5.1 的回顾清单看一眼范围。',
}

export const STAGED_TEMPLATE = `[规则建议 #{sid} · 你已经同意 · 等你在 root 会话落笔]
建议: {text}
来源: {source_kind} {source_id} ({rationale})
血缘: product_lineage where product_kind='rule_suggestion' and product_id='{sid}'
你的原话: {answer}

怎么落: {howto}
在你落笔之前, 系统里什么都没有变 —— 她没有、也不会有写审批规则的路径。`

export function stagedInstructions(row: RawRow, opts?: { answerText?: string }): string {
  const fields: Record<string, string> = {
    sid: String(row.id),
    text: String(row.suggestion_text),
    source_kind: String((row.source_kind as string) || '?'),
    source_id: String((row.source_id as string) || '?'),
    rationale: String((row.rationale as string) || ''),
    answer: clip((opts?.answerText ?? '').trim(), 200),
    howto: HOWTO[row.kind as string] ?? '由你判断。',
  }
  return STAGED_TEMPLATE.replace(
    /\{(sid|text|source_kind|source_id|rationale|answer|howto)\}/g,
    (_, key: string) => fields[key]!,
  )
}
