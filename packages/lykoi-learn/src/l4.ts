import {
  cpSlice, errStr, extractJsonOrNull, isInt, parseWeight,
  LINEAGE_PRODUCT_CONCERN, LINEAGE_PRODUCT_INSIGHT,
  LINEAGE_SOURCE_CONCERN, LINEAGE_SOURCE_EXPERIENCE, LINEAGE_SOURCE_INSIGHT,
  RELATIONSHIP_INSIGHT_CATEGORY,
  type ChatMessage, type CompletionFn, type LogEvent, type PersonaLike, type RawRow,
} from './shared.ts'
import { INTEGRATION_EVERY_HOURS } from './l2.ts'
import { retrieveForConcern, type RelevanceStore, type RetrievedExperience } from './l3.ts'
import {
  isPermissionBoundary, suggestConcernRelease, suggestPermissionRule, type SuggestStore,
} from './l5.ts'

export const FOCUS_EVERY_INTEGRATIONS = 1

export const FOCUS_EVERY_HOURS = INTEGRATION_EVERY_HOURS * FOCUS_EVERY_INTEGRATIONS

export const OWNER_AXIS_EVERY_CYCLES = 3
export const OWNER_AXIS_USER_ID = 'user_001'

export const NO_PROGRESS_STREAK_LIMIT = 3
/** K2：冷却多少个周期（按 focus_cycles.id 计——周期序号是这套算术的天然单位，不迁墙钟）。 */
export const COOLDOWN_CYCLES = 5
/** 累计冷却超过这个次数 → 产出"建议释放"记录。**只建议不执行**。 */
export const COOLDOWN_COUNT_SUGGEST_RELEASE = 2

export const SHADOW_PERIOD_CYCLES = 2

export const INSIGHT_STALE_AFTER_CYCLES = 30

// --- 检索与 prompt 预算 -------------------------------------------------------
export const RETRIEVAL_LIMIT = 20 //          一次深挖最多调回多少条原料
export const MATERIAL_CONTENT_CHARS = 600 //  每条原料喂进 prompt 的截断长度
export const EXISTING_INSIGHT_LIMIT = 20

export const FOCUS_INSIGHT_CATEGORY = 'focus'

export const RELATIONSHIP_CONCERN_KIND = 'relationship_thread'

export const FOCUS_OUTCOMES = ['advanced', 'revised', 'no_progress'] as const

/** L4 的 store 面（结构化接口；**刻意不含**调节场/叙事/messenger 的任何方法）。 */
export interface FocusStore extends RelevanceStore, SuggestStore {
  latestFocusCycleStartedAt(): string | null
  openFocusCycle(opts: { now: Date }): number
  finalizeFocusCycle(cycleId: number, opts: {
    outcome: string; concernId?: number | null; selectionReason?: string;
    retrievedCount?: number; matchReasons?: readonly unknown[] | null;
    llmCalls?: number; note?: string; now: Date
  }): void
  resetFocusCycle(opts: { now: Date }): void
  focusCandidates(currentCycleId: number): RawRow[]
  getConcernFocusState(concernId: number): RawRow
  updateConcernFocusState(concernId: number, opts: {
    noProgressStreak: number; cooldownUntilCycle: number | null; cooldownCount: number;
    lastCycleId: number; releaseSuggestedAtCycle: number | null; now: Date
  }): void
  lightConcern(concernId: number, opts: { now: Date }): unknown
  createConcern(kind: string, title: string, opts: {
    weight: number; origin: string; description?: string; parentId?: number | null; now: Date
  }): number
  upsertInsight(category: string, content: string, opts: { now: Date }): number
  recordFocusInsight(insightId: number, opts: {
    cycleId: number; status?: string; reason?: string; now: Date
  }): boolean
  setFocusInsightStatus(insightId: number, status: string, opts: {
    cycleId: number; reason?: string; supersededBy?: number | null; now: Date
  }): boolean
  getFocusInsightState(insightId: number): RawRow | null
  listFocusInsights(status: string | readonly string[] | null): RawRow[]

  focusInsightHistory(insightId?: number | null): RawRow[]

  ownerPrimaryUserId(): string | null

  scopeInsightSubject(insightId: number, subjectUserId: string): boolean
}

export function shouldFocus(store: FocusStore, now: Date): { should: boolean; reason: string } {
  const last = store.latestFocusCycleStartedAt()
  if (last !== null
    && (now.getTime() - new Date(last).getTime()) / 3_600_000 < FOCUS_EVERY_HOURS) {
    return { should: false, reason: 'not_yet' }
  }
  return { should: true, reason: 'scheduled' }
}

export function priorityCompare(a: RawRow, b: RawRow): number {
  const rankA = a.origin === 'owner_directed' ? 0 : 1
  const rankB = b.origin === 'owner_directed' ? 0 : 1
  return rankA - rankB
    || (b.lit_count as number) - (a.lit_count as number)
    || (a.id as number) - (b.id as number)
}

export function selectConcern(store: FocusStore, cycleId: number): [RawRow | null, Record<string, unknown>] {
  const candidates = store.focusCandidates(cycleId)
  const available = candidates.filter((c) => !c.in_cooldown)
  const cooled = candidates.filter((c) => Boolean(c.in_cooldown)).map((c) => c.id)

  const reason: Record<string, unknown> = {
    candidates: candidates.length,
    available: available.length,
    skipped_in_cooldown: cooled,
    owner_axis_cycle: cycleId % OWNER_AXIS_EVERY_CYCLES === 0,
  }
  if (available.length === 0) {
    reason.rule = 'no_candidate'
    return [null, reason]
  }

  let pool = available
  let prefix = ''
  if (reason.owner_axis_cycle) {
    const ownerPool = available.filter((c) => c.subject_user_id === OWNER_AXIS_USER_ID)
    if (ownerPool.length > 0) {
      pool = ownerPool
      prefix = 'owner_axis:'
    } else {
      prefix = 'owner_axis_empty:'
    }
  }

  const chosen = [...pool].sort(priorityCompare)[0]!
  const base = chosen.origin === 'owner_directed' ? 'owner_directed' : 'lit_count'
  reason.rule = prefix + base
  reason.concern_id = chosen.id
  reason.origin = chosen.origin
  reason.lit_count = chosen.lit_count
  reason.subject_user_id = chosen.subject_user_id
  return [chosen, reason]
}

export const FOCUS_SYSTEM_PROMPT = `你在专注思考期。这不是整合(整合是消化当天的经验), 这是回头想一件事:
下面给你一个你的关切, 以及从你**全部**经验里跨时间调回来的相关原料 ——
其中可能有几个月前的、已经消化过的、当时没被排进消化队列的。
还给你若干条你**已经得出过的结论**。

你的任务: 就这一个关切, 往前推进一步。

只输出一个 JSON 对象。结构:
{
  "outcome": "advanced|revised|no_progress",
  "conclusion": <str|null>,
  "revises_insight_id": <int|null>,
  "conflicts": [{"insight_id": <int>, "note": <str>}],
  "cited_experience_ids": [<int>, ...],
  "new_concern": {"kind": "interest|project|question|ritual|relationship_thread",
                  "title": <str>, "description": <str>, "weight": <float, 0-1>} | null,
  "note": <一句话, 说明这一轮想到了什么或为什么没想出来>
}

三种 outcome:
- advanced: 你得出了一条**新的**结论。conclusion 必填, 是一句能独立成立的话
  (不依赖"上面那条原料"这种指代)。它必须能从给你的原料里推出来。
- revised: 你要改写一条既有结论。revises_insight_id 填被改写的那条,
  conclusion 填新版本。旧版本会被保留 —— 你曾经那么认为过, 那是你的一部分。
- no_progress: 这些原料不足以推进这个关切。conclusion 留 null。
  这是一个正当的答案, 与另外两个同等。

其他字段:
- conflicts: 给你的既有结论里, 哪些与现在这批原料**矛盾**。只列真矛盾,
  不列"补充"或"细化"。
- cited_experience_ids: conclusion 用到了哪几条原料的 id。
- new_concern: 深挖过程中长出的一个**新问题**, 值得单独成为一条关切的。
  没有就填 null。

不许:
- 改写身份内核 (你是谁, 谁是你的伴侣)。
- 输出 JSON 之外的任何文字。`

export function focusIdentityGuard(persona: PersonaLike): string {
  return `你的内核身份: ${persona.identity.name}; 你的伴侣: ${persona.relationship.partner}. `
    + '专注思考的产出绝不能与之矛盾。'
}

function buildPayload(deps: {
  concern: RawRow
  materials: RetrievedExperience[]
  existing: RawRow[]
}): Record<string, unknown> {
  const c = deps.concern
  return {
    concern: {
      id: c.id, kind: c.kind, title: c.title,
      description: c.description, origin: c.origin,
      status: c.status, lit_count: c.lit_count,
      last_lit_at: c.last_lit_at,
    },
    materials: deps.materials.map((m) => ({
      id: m.id, ts: m.ts, source: m.source,
      content: cpSlice((m.content as string) ?? '', MATERIAL_CONTENT_CHARS),
      experience_class: m.experience_class ?? null,
      integrated: m.integrated ?? null,
      why_retrieved: m.match_reasons ?? [],
    })),
    existing_conclusions: deps.existing.map((e) => ({
      insight_id: e.insight_id, content: e.content ?? '',
      status: e.status,
    })),
  }
}

function buildMessages(persona: PersonaLike, payload: Record<string, unknown>): ChatMessage[] {
  return [
    { role: 'system', content: FOCUS_SYSTEM_PROMPT },
    { role: 'system', content: focusIdentityGuard(persona) },
    { role: 'user', content: JSON.stringify(payload) },
  ]
}

export interface FocusEnvelope {
  outcome: 'advanced' | 'revised' | 'no_progress'
  conclusion: string | null
  revises_insight_id: number | null
  conflicts: { insight_id: number; note: string }[]
  cited_experience_ids: number[]
  new_concern: { kind: string; title: string; description: string; weight: number } | null
  note: string
}

export function parseFocusEnvelope(raw: unknown): FocusEnvelope {
  const result: FocusEnvelope = {
    outcome: 'no_progress', conclusion: null, revises_insight_id: null,
    conflicts: [], cited_experience_ids: [], new_concern: null, note: '',
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new TypeError('focus envelope must be an object')
  const r = raw as Record<string, unknown>

  if (!(FOCUS_OUTCOMES as readonly unknown[]).includes(r.outcome)) throw new TypeError('invalid focus outcome')
  result.outcome = r.outcome as FocusEnvelope['outcome']

  if (typeof r.conclusion === 'string' && r.conclusion.trim()) {
    result.conclusion = r.conclusion.trim()
  }

  if (isInt(r.revises_insight_id)) {
    result.revises_insight_id = r.revises_insight_id
  }

  if (Array.isArray(r.conflicts)) {
    for (const item of r.conflicts as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const it = item as Record<string, unknown>
      if (isInt(it.insight_id)) {
        result.conflicts.push({
          insight_id: it.insight_id,
          note: typeof it.note === 'string' ? it.note.trim() : '',
        })
      }
    }
  }

  if (Array.isArray(r.cited_experience_ids)) {
    result.cited_experience_ids = (r.cited_experience_ids as unknown[]).filter(isInt)
  }

  const nc = r.new_concern
  if (typeof nc === 'object' && nc !== null && !Array.isArray(nc)) {
    const n = nc as Record<string, unknown>
    if (typeof n.kind === 'string' && typeof n.title === 'string' && n.title.trim()) {
      result.new_concern = {
        kind: n.kind, title: n.title.trim(),
        description: typeof n.description === 'string' ? n.description : '',
        weight: parseWeight(n.weight),
      }
    }
  }

  if (typeof r.note === 'string') {
    result.note = r.note.trim()
  }

  if ((result.outcome === 'advanced' || result.outcome === 'revised') && !result.conclusion) {
    throw new TypeError('focus progress requires a conclusion')
  }
  return result
}

// === 周期 ====================================================================

export interface FocusSummary {
  cycle_id: number | null
  failures: { operation: string; error: string }[]
  outcome: string
  concern_id: number | null
  selection_reason: Record<string, unknown> | null
  retrieved: number
  llm_calls: number
  insight_id: number | null
  insight_is_new: boolean
  lineage_rows: number
  contested: number[]
  revised: Record<string, unknown>[]
  promoted: number[]

  retired: number[]

  overlay_subject_user_id: string | null
  derived_concern_id: number | null
  cooldown_started: boolean
  release_suggested: boolean
  suggestion_id: number | null
  permission_suggestion_id: number | null
  note: string
}

export interface FocusDeps {
  store: FocusStore
  persona: PersonaLike
  completion: CompletionFn
  logEvent: LogEvent
  now: Date
}

export async function runFocusCycle(deps: FocusDeps): Promise<FocusSummary> {
  const { store, logEvent, now } = deps
  const summary: FocusSummary = {
    cycle_id: null, failures: [], outcome: 'idle', concern_id: null,
    selection_reason: null, retrieved: 0, llm_calls: 0,
    insight_id: null, insight_is_new: false, lineage_rows: 0,
    contested: [], revised: [], promoted: [], retired: [],
    overlay_subject_user_id: null,
    derived_concern_id: null, cooldown_started: false,
    release_suggested: false, suggestion_id: null,
    permission_suggestion_id: null, note: '',
  }

  const cycleId = store.openFocusCycle({ now })
  summary.cycle_id = cycleId

  try {
    return await runCycleBody(cycleId, summary, deps)
  } catch (exc) {
    if (exc instanceof FocusPersistenceError) throw exc
    // 编排层自己出了问题（LLM 失败在下面被单独接住）——照样落一条诚实的失败
    // 周期：一个没落账的失败等于免费重试，§7.1 不允许。
    logEvent('focus_cycle_error', { cycle_id: cycleId, error: errStr(exc) })
    summary.outcome = 'failed'
    summary.note = cpSlice(errStr(exc), 500)
    safeFinalize(cycleId, summary, deps)
    return summary
  } finally {

    try {
      store.resetFocusCycle({ now })
    } catch (exc) {
      logEvent('focus_cycle_reset_failed', { cycle_id: cycleId, error: errStr(exc) })
      throw new FocusPersistenceError('focus cycle reset failed', { cause: exc })
    }
  }
}

class FocusPersistenceError extends Error {}

function safeFinalize(
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
  matchReasons?: readonly unknown[] | null,
): void {
  try {
    deps.store.finalizeFocusCycle(cycleId, {
      outcome: summary.outcome,
      concernId: summary.concern_id,
      selectionReason: JSON.stringify(summary.selection_reason ?? {}),
      retrievedCount: summary.retrieved,
      matchReasons: matchReasons ?? [],
      llmCalls: summary.llm_calls,
      note: summary.note,
      now: deps.now,
    })
  } catch (exc) {
    deps.logEvent('focus_cycle_finalize_failed', { cycle_id: cycleId, error: errStr(exc) })
    throw new FocusPersistenceError('focus cycle finalization failed', { cause: exc })
  }
}

function finishFocusCycle(
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
  matchReasons?: readonly unknown[] | null,
): FocusSummary {
  promoteDueInsights(cycleId, summary, deps)
  retireStaleInsights(cycleId, summary, deps)
  if (summary.failures.length) summary.outcome = 'failed'
  safeFinalize(cycleId, summary, deps, matchReasons)
  return summary
}

async function runCycleBody(
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
): Promise<FocusSummary> {
  const { store, logEvent } = deps

  // --- 2. 选关切 --------------------------------------------------------
  const [concern, reason] = selectConcern(store, cycleId)
  summary.selection_reason = reason
  if (concern === null) {
    summary.outcome = 'idle'
    summary.note = 'no selectable concern'
    logEvent('focus_cycle_idle', { cycle_id: cycleId, ...reason })
    return finishFocusCycle(cycleId, summary, deps)
  }
  summary.concern_id = concern.id as number

  // --- 3. 跨时间检索 ----------------------------------------------------
  // 实体轴按关切自己的作用域走（§3.6：某人的关切不该召回另一个人的原料）；
  // 关切没登记作用域时留 null——关键词轴独自工作，而不是硬过滤成空集。
  const probe = {
    title: concern.title,
    description: concern.description,
    subject_user_id: concern.subject_user_id ?? null,
  }
  const materials = retrieveForConcern(store, probe, { limit: RETRIEVAL_LIMIT })
  summary.retrieved = materials.length
  const matchReasons = materials.map((m) => ({
    experience_id: m.id, score: m.relevance_score, match_reasons: m.match_reasons,
  }))

  if (materials.length === 0) {

    summary.outcome = 'no_progress'
    summary.note = 'empty recall'
    applyConcernProgress(concern, cycleId, summary, false, deps)
    return finishFocusCycle(cycleId, summary, deps, matchReasons)
  }

  // --- 4. 一次 LLM 调用 -------------------------------------------------
  const existing = existingConclusions(store)
  const messages = buildMessages(deps.persona, buildPayload({ concern, materials, existing }))
  summary.llm_calls = 1
  let parsedRaw: Record<string, unknown> | null
  try {
    const rawMessage = await deps.completion(messages)
    parsedRaw = extractJsonOrNull(rawMessage.content ?? '')
  } catch (exc) {

    logEvent('focus_llm_failed', {
      cycle_id: cycleId, concern_id: concern.id, error: errStr(exc),
    })
    summary.outcome = 'failed'
    summary.note = cpSlice(errStr(exc), 500)
    recordCycleTouch(concern, cycleId, deps)
    return finishFocusCycle(cycleId, summary, deps, matchReasons)
  }

  if (parsedRaw === null) {
    logEvent('focus_parse_failed', { cycle_id: cycleId, concern_id: concern.id })
    summary.outcome = 'failed'
    summary.note = 'parse_failed'
    recordCycleTouch(concern, cycleId, deps)
    return finishFocusCycle(cycleId, summary, deps, matchReasons)
  }

  const envelope = parseFocusEnvelope(parsedRaw)
  summary.note = cpSlice(envelope.note, 500)

  summary.outcome = envelope.outcome

  // --- 5. 落产物 + 血缘 -------------------------------------------------
  applyConflicts(envelope, cycleId, summary, deps)
  const madeProgress = applyConclusion(envelope, concern, materials, cycleId, summary, deps)
  applyNewConcern(envelope, concern, materials, cycleId, summary, deps)

  // --- 6. 关切状态 + 影子期结算 + 衰减结算 -------------------------------
  // D-7：衰减排在 applyConclusion 之后——本周期刚重申/新建的结论其 history 最后
  // 一行的 cycle_id 已是本周期，距离 0，自然不降。
  applyConcernProgress(concern, cycleId, summary, madeProgress, deps)
  return finishFocusCycle(cycleId, summary, deps, matchReasons)
}

function existingConclusions(store: FocusStore): RawRow[] {
  const rows = store.listFocusInsights(['shadow', 'active', 'contested', 'dormant'])
  return rows.slice(-EXISTING_INSIGHT_LIMIT)
}

function applyConflicts(
  envelope: FocusEnvelope,
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
): void {
  const revises = envelope.revises_insight_id
  for (const conflict of envelope.conflicts) {
    const iid = conflict.insight_id
    const state = deps.store.getFocusInsightState(iid)
    if (state === null) continue //   层 2 之外写进 insights 的行不归这套门管
    if (state.status === 'revised' || state.status === 'withdrawn') continue // 已了结不重复了结
    if (state.status !== 'contested') {
      if (deps.store.setFocusInsightStatus(iid, 'contested', {
        cycleId, reason: conflict.note || 'conflict', now: deps.now,
      })) {
        summary.contested.push(iid)
      }
      continue
    }
    // 仍冲突——本周期了结它。
    if (iid === revises && envelope.conclusion) {
      continue // 交给 applyConclusion 落 revised + superseded_by
    }
    if (deps.store.setFocusInsightStatus(iid, 'withdrawn', {
      cycleId, reason: conflict.note || 'still contested', now: deps.now,
    })) {
      summary.revised.push({ insight_id: iid, to: 'withdrawn' })
    }
  }
}

function applyConclusion(
  envelope: FocusEnvelope,
  concern: RawRow,
  materials: RetrievedExperience[],
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
): boolean {
  const { store, now } = deps
  if (envelope.outcome === 'no_progress' || !envelope.conclusion) {
    return false
  }

  const isRelationship = concern.kind === RELATIONSHIP_CONCERN_KIND
  // D-3 的 KEY 推导序，两步且**只有**两步：关切自带的实体轴优先（那是这条关切
  // 本来就登记好的"关于谁"），缺席时退到 owner_primary（现体能与她对话的只有
  // owner）。两者皆 null 时不猜——见下面的 unkeyed 兜底。
  const subjectUserId = isRelationship
    ? ((concern.subject_user_id as string | null | undefined) ?? store.ownerPrimaryUserId())
    : null
  // 关键的一步：**没有键就不当 relationship 落**。宁可少一条 overlay，也不凭空
  // 指一个人——一条没有"对谁"的相处方式结论，装配到谁头上都是错的。
  const keyed = isRelationship && subjectUserId !== null
  const category = keyed ? RELATIONSHIP_INSIGHT_CATEGORY : FOCUS_INSIGHT_CATEGORY

  const insightId = store.upsertInsight(category, envelope.conclusion, { now })
  summary.insight_id = insightId
  const isNew = store.recordFocusInsight(insightId, {
    cycleId, status: 'shadow',
    reason: `cycle ${cycleId} / concern ${concern.id}`, now,
  })
  summary.insight_is_new = isNew

  if (keyed) {
    // 登记实体轴。**成功写入或已存在都发事件**（D-6）：重申一条已键控的结论时
    // scope 是空操作，但"这一周期又落了一条关于这个人的结论"仍然是发生了的事。
    store.scopeInsightSubject(insightId, subjectUserId)
    summary.overlay_subject_user_id = subjectUserId
    deps.logEvent('relationship_overlay_keyed', {
      insight_id: insightId, concern_id: concern.id as number,
      cycle_id: cycleId, subject_user_id: subjectUserId,
    })
  } else if (isRelationship) {
    // D-3 兜底路：是关系关切，但既没有关切实体轴也没有 owner_primary（例如 owner
    // 那行被归档）。结论照落，只是落成普通 focus 结论，不进任何人的 overlay。
    deps.logEvent('relationship_overlay_unkeyed', {
      insight_id: insightId, concern_id: concern.id as number, cycle_id: cycleId,
    })
  }

  const sources: [string, string | number][] = [[LINEAGE_SOURCE_CONCERN, concern.id as number]]
  for (const m of materials) {
    sources.push([LINEAGE_SOURCE_EXPERIENCE, m.id as number])
  }
  const revises = envelope.revises_insight_id
  if (revises !== null && revises !== insightId) {
    // 被修订的旧结论也是新结论的来源之一——"我以前以为 X, 现在认为 Y"里的 X
    // 是 Y 的原料，血缘要能走回去。
    sources.push([LINEAGE_SOURCE_INSIGHT, revises])
  }
  summary.lineage_rows = store.recordLineage({
    productKind: LINEAGE_PRODUCT_INSIGHT, productId: insightId, sources, cycleId, now,
  })

  if (isPermissionBoundary(envelope.conclusion)) {
    try {
      const queued = suggestPermissionRule(store, deps.logEvent, {
        insightId, conclusion: envelope.conclusion,
        concernId: concern.id as number, cycleId, now,
      })
      summary.permission_suggestion_id = queued.id
    } catch (exc) {
      // 入队失败不该毁掉已落的结论。
      summary.failures.push({ operation: 'permission_suggestion', error: errStr(exc) })
      deps.logEvent('focus_permission_suggestion_enqueue_failed', {
        insight_id: insightId, error: errStr(exc),
      })
    }
  }

  if (revises !== null && revises !== insightId) {
    if (store.setFocusInsightStatus(revises, 'revised', {
      cycleId, supersededBy: insightId,
      reason: `superseded by insight ${insightId}`, now,
    })) {
      summary.revised.push({ insight_id: revises, to: 'revised', superseded_by: insightId })
      summary.outcome = 'revised'
    }
  }
  if (summary.outcome !== 'revised') {
    summary.outcome = 'advanced'
  }

  return isNew
}

function applyNewConcern(
  envelope: FocusEnvelope,
  concern: RawRow,
  materials: RetrievedExperience[],
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
): void {
  const nc = envelope.new_concern
  if (nc === null) return
  let newId: number
  try {
    newId = deps.store.createConcern(nc.kind, nc.title, {
      description: nc.description, weight: nc.weight, origin: 'derived',
      parentId: concern.id as number, now: deps.now,
    })
  } catch (exc) {
    summary.failures.push({ operation: 'derived_concern', error: errStr(exc) })
    deps.logEvent('focus_derived_concern_rejected', {
      cycle_id: cycleId, title: nc.title, error: errStr(exc),
    })
    return
  }
  summary.derived_concern_id = newId
  const sources: [string, string | number][] = [[LINEAGE_SOURCE_CONCERN, concern.id as number]]
  for (const m of materials) {
    sources.push([LINEAGE_SOURCE_EXPERIENCE, m.id as number])
  }
  deps.store.recordLineage({
    productKind: LINEAGE_PRODUCT_CONCERN, productId: newId, sources, cycleId, now: deps.now,
  })
}

function recordCycleTouch(concern: RawRow, cycleId: number, deps: FocusDeps): void {
  const state = deps.store.getConcernFocusState(concern.id as number)
  deps.store.updateConcernFocusState(concern.id as number, {
    noProgressStreak: state.no_progress_streak as number,
    cooldownUntilCycle: (state.cooldown_until_cycle ?? null) as number | null,
    cooldownCount: state.cooldown_count as number,
    lastCycleId: cycleId,
    releaseSuggestedAtCycle: (state.release_suggested_at_cycle ?? null) as number | null,
    now: deps.now,
  })
}

function applyConcernProgress(
  concern: RawRow,
  cycleId: number,
  summary: FocusSummary,
  madeProgress: boolean,
  deps: FocusDeps,
): void {
  const { store, logEvent, now } = deps
  const cid = concern.id as number
  const state = store.getConcernFocusState(cid)
  let streak = state.no_progress_streak as number
  let cooldownUntil = (state.cooldown_until_cycle ?? null) as number | null
  let cooldownCount = state.cooldown_count as number
  let suggested = (state.release_suggested_at_cycle ?? null) as number | null

  if (madeProgress) {
    streak = 0
    try {
      store.lightConcern(cid, { now })
    } catch (exc) {
      // 点亮失败不该毁掉已落的结论。
      summary.failures.push({ operation: 'light_concern', error: errStr(exc) })
      logEvent('focus_light_concern_failed', { concern_id: cid, error: errStr(exc) })
    }
  } else {
    streak += 1
    if (streak >= NO_PROGRESS_STREAK_LIMIT) {
      streak = 0
      cooldownCount += 1
      cooldownUntil = cycleId + COOLDOWN_CYCLES
      summary.cooldown_started = true
      logEvent('focus_concern_cooldown', {
        concern_id: cid, cycle_id: cycleId, until_cycle: cooldownUntil,
        cooldown_count: cooldownCount,
      })
      if (cooldownCount > COOLDOWN_COUNT_SUGGEST_RELEASE && suggested === null) {
        suggested = cycleId
        summary.release_suggested = true
        // 只建议。执行释放的路径在本模块不存在。
        logEvent('focus_release_suggested', {
          concern_id: cid, cycle_id: cycleId, cooldown_count: cooldownCount,
          title: concern.title,
        })

        try {
          const queued = suggestConcernRelease(store, deps.logEvent, {
            concern, cycleId, cooldownCount, now,
          })
          summary.suggestion_id = queued.id
        } catch (exc) {
          summary.failures.push({ operation: 'release_suggestion', error: errStr(exc) })
          logEvent('focus_release_suggestion_enqueue_failed', {
            concern_id: cid, error: errStr(exc),
          })
        }
      }
    }
  }

  store.updateConcernFocusState(cid, {
    noProgressStreak: streak,
    cooldownUntilCycle: cooldownUntil,
    cooldownCount,
    lastCycleId: cycleId,
    releaseSuggestedAtCycle: suggested,
    now,
  })
}

function promoteDueInsights(cycleId: number, summary: FocusSummary, deps: FocusDeps): void {
  for (const row of deps.store.listFocusInsights('shadow')) {
    if (cycleId - (row.created_cycle_id as number) < SHADOW_PERIOD_CYCLES) continue
    if (deps.store.setFocusInsightStatus(row.insight_id as number, 'active', {
      cycleId, reason: `shadow period cleared (${SHADOW_PERIOD_CYCLES} cycles)`, now: deps.now,
    })) {
      summary.promoted.push(row.insight_id as number)
    }
  }
}

function lastTouchedCycle(store: FocusStore, row: RawRow): number {
  const history = store.focusInsightHistory(row.insight_id as number)
  if (history.length === 0) return row.updated_cycle_id as number
  return history[history.length - 1]!.cycle_id as number
}

function retireStaleInsights(cycleId: number, summary: FocusSummary, deps: FocusDeps): void {
  for (const row of deps.store.listFocusInsights('active')) {
    const touched = lastTouchedCycle(deps.store, row)
    if (cycleId - touched < INSIGHT_STALE_AFTER_CYCLES) continue
    if (deps.store.setFocusInsightStatus(row.insight_id as number, 'dormant', {
      cycleId,
      reason: `stale: last touched cycle ${touched}, now cycle ${cycleId} `
        + `(>= ${INSIGHT_STALE_AFTER_CYCLES})`,
      now: deps.now,
    })) {
      summary.retired.push(row.insight_id as number)
    }
  }
}

export async function maybeRunFocusCycle(deps: FocusDeps): Promise<FocusSummary | null> {
  const gate = shouldFocus(deps.store, deps.now)
  if (!gate.should) return null
  const summary = await runFocusCycle(deps)
  deps.logEvent('autonomy_focus', {
    reason: gate.reason, cycle_id: summary.cycle_id,
    outcome: summary.outcome, concern_id: summary.concern_id,
    retrieved: summary.retrieved, llm_calls: summary.llm_calls,
    insight_id: summary.insight_id, lineage_rows: summary.lineage_rows,
  })
  return summary
}
