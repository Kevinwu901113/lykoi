/**
 * lykoi-learn/l4 — 层 2 · 专注思考（mind/focus.py 对应物；SA-117..140）。
 *
 * 层 1（l2）是她的睡眠：每晚把当天的原料消化进自我叙事。层 2 是她**回头想**的
 * 能力：挑一个关切，把几个月前的档案、已消化的经验、水位线之下的历史一并调回
 * 来（l3），深挖出一条能回溯到具体原料的结论。分工是"当下 vs 跨时间"。
 *
 * **层 2 只读不写的领域**（SA-137/SA-82，本模块存在感最强的约束）：叙事、情绪
 * 调节、审批/权限、messenger。本模块的 store 面（FocusStore）在**类型层**就不含
 * applyRegulationCause / addNarrativeVersion / 任何对外通道——比活体的模块纪律
 * 更硬；import 面由 boundary.test.ts 静态钉死。她的权限边界类观察在 L4 连产出
 * 口都没有；L5 给了一个而且只给了一个：建议队列（同一条线内，只碰 store 与日志）。
 *
 * **一次周期 = 一次 LLM 调用，失败不重试**（§7.1：深挖失败也要计配额）。
 *
 * **G-4 触发锚 = 墙钟，随 L2 派生**（SA-117 的墙钟形态）：FOCUS_EVERY_HOURS
 * 派生自 INTEGRATION_EVERY_HOURS，**不得硬写 24**——两层共用一条节律，层 1 的
 * 节奏改了层 2 得跟着改，派生让这件事没法忘。锚 = focus_cycles.started_at 的
 * 最大值（每一种周期开头都落行：空转/失败/成功都算"今晚来过了"——活体
 * reset_focus_cycle 无条件清零的墙钟对应物）；锚缺席（从未跑过）→ 视为到期
 * （G-8(a) 对 None 的同向读法："那不是脏值,那是还没定过"）。
 * **SA-130 例外条款**：影子期结算**保持周期序号**，不迁墙钟——见
 * promoteDueInsights 的逐字理由。这是 G-4 的唯一例外：G-4 迁移的是触发锚，
 * 不是影子门。
 */
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

// --- 节律（SA-117：派生而非硬写） ---------------------------------------------
/** N：每 N 个整合周期跑一次层 2。1 = 每晚一次，起步值。 */
export const FOCUS_EVERY_INTEGRATIONS = 1
/** **派生自** l2 的节律（G-4 墙钟形态下单位是小时；不改 INTEGRATION_EVERY_HOURS——这里只读它）。 */
export const FOCUS_EVERY_HOURS = INTEGRATION_EVERY_HOURS * FOCUS_EVERY_INTEGRATIONS

// --- 选择策略（SA-120/121） ---------------------------------------------------
/** M：每 M 次周期必须挑一个实体轴上属于 owner 的关切（§7.2 防自恋硬规则）。 */
export const OWNER_AXIS_EVERY_CYCLES = 3
export const OWNER_AXIS_USER_ID = 'user_001'

// --- 反刍防护（SA-127） -------------------------------------------------------
/** M2：同一关切连续这么多次深挖无新结论 → 强制冷却。 */
export const NO_PROGRESS_STREAK_LIMIT = 3
/** K2：冷却多少个周期（按 focus_cycles.id 计——周期序号是这套算术的天然单位，不迁墙钟）。 */
export const COOLDOWN_CYCLES = 5
/** 累计冷却超过这个次数 → 产出"建议释放"记录。**只建议不执行**。 */
export const COOLDOWN_COUNT_SUGGEST_RELEASE = 2

// --- 门（SA-130） -------------------------------------------------------------
/** S：新 insight 存续这么多个周期未被 contested 才从 shadow 转 active。 */
export const SHADOW_PERIOD_CYCLES = 2

/**
 * WO-MEM-DECAY-01（D-3）：一条 active 结论距上一次被 L4 触达**这么多个周期**未被
 * 再触达 → 降 dormant（退出装配、不销毁、可点亮）。
 *
 * 单位是**周期序号**，与 SHADOW_PERIOD_CYCLES 同理（SA-130 例外条款）：她的思考
 * 发生在周期里，停机三周不该让她"忘掉"什么。
 *
 * 30 是治理估值（现节律 ≈1 周期/天，30 周期 ≈ 一个月的持续思考），**不是配置项**
 * （GK-6：不读 env、不进 profile）。要改由治理侧按产线读数校准后改这一行。
 */
export const INSIGHT_STALE_AFTER_CYCLES = 30

// --- 检索与 prompt 预算 -------------------------------------------------------
export const RETRIEVAL_LIMIT = 20 //          一次深挖最多调回多少条原料
export const MATERIAL_CONTENT_CHARS = 600 //  每条原料喂进 prompt 的截断长度
export const EXISTING_INSIGHT_LIMIT = 20 //   给她看多少条既有结论(判冲突用)

/**
 * SA-132：层 2 结论的 insights 类别。**刻意是个新类别**：persona 投影只认
 * persona/preference 两类，所以一条 'focus' 结论在影子期内（乃至转正后）都不会
 * 漏进任何下游——§3.8 "影子期内不进任何下游消费"因此有结构性保证而不只是一句
 * 约定。类别由代码钉死，不由 LLM 选。
 */
export const FOCUS_INSIGHT_CATEGORY = 'focus'

/**
 * WO-PERS-OVERLAY-01（D-1）：判别式 = **关切的 kind**，不由她自陈、不加信封字段。
 *
 * "一条 `relationship_thread` 关切被深挖出的结论，就是相处方式层面的结论"——这是
 * 本单立的**结构性**约定。它不完美（她可能在一条关系关切里想明白一件与那个人无关
 * 的事），但三条替代路都更坏：给 FOCUS 信封加字段要动 SA-138 逐字钉死的提示词；
 * 让 L2 产 relationship insights 等于新造一条生产线；owner 手写 overlay 条目撞
 * P-D2/P-D3 的运行期人格可写面。判据放在代码里、放在**已有的**关切类型上，是唯一
 * 不需要新造任何东西的路。
 */
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
  /** WO-MEM-DECAY-01（D-2）：衰减信号的取数口——最后一行的 cycle_id = 上次触达。 */
  focusInsightHistory(insightId?: number | null): RawRow[]
  /** WO-PERS-OVERLAY-01（D-3）：KEY 推导的兜底源——现体能与她对话的只有 owner。 */
  ownerPrimaryUserId(): string | null
  /** WO-PERS-OVERLAY-01（D-3）：给一条 relationship 结论登记"这是关于谁的"。 */
  scopeInsightSubject(insightId: number, subjectUserId: string): boolean
}

// === 触发（SA-118） ==========================================================

/**
 * 层 2 的节律闸。纯查询，不写任何状态。与层 1 的 shouldIntegrate 两处**有意的**
 * 不同（focus.py:97-105 逐字）：
 * 1. **没有 pending > 0 的前置**——层 2 根本不吃当晚的新原料，它吃的是几个月前
 *    的档案；"层 1 因 no_pending 空转的晚上层 2 照常跑"是两层取料口不同的自然
 *    结果，不是特殊照顾。
 * 2. **没有 early（负载驱动）路径**——深挖一条关切不是泄压手段，把它接到负载上
 *    就是在教她"忙的时候多想想"，那是行为训诫，不是机制。
 */
export function shouldFocus(store: FocusStore, now: Date): { should: boolean; reason: string } {
  const last = store.latestFocusCycleStartedAt()
  if (last !== null
    && (now.getTime() - new Date(last).getTime()) / 3_600_000 < FOCUS_EVERY_HOURS) {
    return { should: false, reason: 'not_yet' }
  }
  return { should: true, reason: 'scheduled' }
}

// === 选关切（SA-120/121） =====================================================

/**
 * SA-120 排序口径（focus.py:114-124 逐字）：owner_directed 优先 → lit_count 降序
 * → 同分按 id 升序（确定性）。**只有三级**，没有 weight、没有 status、没有
 * 新近度——层 2 首版用规则不接 bandit（§4.2），规则的价值在于可解释：多一个
 * 维度就多一层"她今晚为什么想这个"说不清的地方。
 */
export function priorityCompare(a: RawRow, b: RawRow): number {
  const rankA = a.origin === 'owner_directed' ? 0 : 1
  const rankB = b.origin === 'owner_directed' ? 0 : 1
  return rankA - rankB
    || (b.lit_count as number) - (a.lit_count as number)
    || (a.id as number) - (b.id as number)
}

/**
 * 挑本周期要深挖的关切（focus.py:127-179）。reason 是可审计的结构化理由（落
 * focus_cycles.selection_reason）——"她今晚为什么想这个"必须能被 Kevin 读懂。
 * SA-121：owner 轴周期（cycle_id % 3 == 0）先缩到 subject_user_id == 'user_001'
 * 的候选；捞空则退回全体并记 owner_axis_empty: 前缀——硬规则不该把一个本来
 * 有事可想的晚上变成空转。
 */
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

// === prompt ==================================================================

/**
 * SA-138：逐字迁（mind/focus.py:184-221）。chars=1079，
 * sha256=c278a1ca6409ffc39bd299d760289063e64e90d41fdcdd71967ef59de8c0918a
 * （prompt.test.ts 常驻对拍）。三种 outcome 同等——no_progress 是正当答案。
 */
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

/** 第二条 system（身份守卫，focus.py:260-261 逐字拼接形态；fixture sha=79577116…）。 */
export function focusIdentityGuard(persona: PersonaLike): string {
  return `你的内核身份: ${persona.identity.name}; 你的伴侣: ${persona.relationship.partner}. `
    + '专注思考的产出绝不能与之矛盾。'
}

/**
 * 组 prompt 的 user 消息（focus.py:224-253）。**原料只有她自己的经验内容**
 * （experiences.content——对话与感知），加上关切与既有结论。本函数不读任何
 * state 文件、不读 secrets、不读审批规则、不读 owner 台账；检索层（l3）本身就
 * 只扫 experiences，secrets 从来不在它的检索域里。
 */
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

// === 信封解析（SA-139） =======================================================

export interface FocusEnvelope {
  outcome: 'advanced' | 'revised' | 'no_progress'
  conclusion: string | null
  revises_insight_id: number | null
  conflicts: { insight_id: number; note: string }[]
  cited_experience_ids: number[]
  new_concern: { kind: string; title: string; description: string; weight: number } | null
  note: string
}

/**
 * 防御式解析（focus.py:277-342 逐字），与层 1 同姿态：任何一节畸形都降级成空，
 * **永不抛**。层 2 的失败必须是一条落账的周期，不是一个异常。
 * SA-139 收尾硬规则：advanced/revised 都以"有一条结论"为前提——LLM 说推进了
 * 却没给 conclusion，那就是没推进，按 no_progress 记，如实喂进反刍计数。
 */
export function parseFocusEnvelope(raw: unknown): FocusEnvelope {
  const result: FocusEnvelope = {
    outcome: 'no_progress', conclusion: null, revises_insight_id: null,
    conflicts: [], cited_experience_ids: [], new_concern: null, note: '',
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
  const r = raw as Record<string, unknown>

  if ((FOCUS_OUTCOMES as readonly unknown[]).includes(r.outcome)) {
    result.outcome = r.outcome as FocusEnvelope['outcome']
  }

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
    result.outcome = 'no_progress'
  }
  return result
}

// === 周期 ====================================================================

export interface FocusSummary {
  cycle_id: number | null
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
  /** WO-MEM-DECAY-01（D-6）：本周期因久未触达而降 dormant 的 insight_id。 */
  retired: number[]
  /**
   * WO-PERS-OVERLAY-01（D-9）：本周期的结论若键控到了某个人，这里是那个人的
   * user id；否则 null（普通 focus 结论、或 D-3 兜底路的 unkeyed）。与 `retired`
   * 同为账面字段——让周期摘要能回答"这条结论是关于谁的"。
   */
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

/**
 * 跑一次层 2 周期（focus.py:347-390 + 411-498 六步逐序）。返回 summary。
 * **永不抛**——与层 1 同一条契约。
 */
export async function runFocusCycle(deps: FocusDeps): Promise<FocusSummary> {
  const { store, logEvent, now } = deps
  const summary: FocusSummary = {
    cycle_id: null, outcome: 'idle', concern_id: null,
    selection_reason: null, retrieved: 0, llm_calls: 0,
    insight_id: null, insight_is_new: false, lineage_rows: 0,
    contested: [], revised: [], promoted: [], retired: [],
    overlay_subject_user_id: null,
    derived_concern_id: null, cooldown_started: false,
    release_suggested: false, suggestion_id: null,
    permission_suggestion_id: null, note: '',
  }
  // SA-122：先开行再选关切（防自恋规则按序号取模）；行以 outcome='idle' 落地。
  const cycleId = store.openFocusCycle({ now })
  summary.cycle_id = cycleId

  try {
    return await runCycleBody(cycleId, summary, deps)
  } catch (exc) {
    // 编排层自己出了问题（LLM 失败在下面被单独接住）——照样落一条诚实的失败
    // 周期：一个没落账的失败等于免费重试，§7.1 不允许。
    logEvent('focus_cycle_error', { cycle_id: cycleId, error: errStr(exc) })
    summary.outcome = 'failed'
    summary.note = cpSlice(errStr(exc), 500)
    safeFinalize(cycleId, summary, deps)
    return summary
  } finally {
    // 节律计数**无条件**清零（Python reset_focus_cycle 原形保留为账面写；G-4 后
    // 触发锚是本周期在 openFocusCycle 落下的 started_at——空转、失败、成功都算
    // "今晚来过了"，不清零/不落行 = 每次心跳都重试一次深挖，既烧配额又不是
    // "每晚一次"）。
    try {
      store.resetFocusCycle({ now })
    } catch (exc) {
      logEvent('focus_cycle_reset_failed', { cycle_id: cycleId, error: errStr(exc) })
    }
  }
}

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
  }
}

async function runCycleBody(
  cycleId: number,
  summary: FocusSummary,
  deps: FocusDeps,
): Promise<FocusSummary> {
  const { store, logEvent, now } = deps

  // --- 2. 选关切 --------------------------------------------------------
  const [concern, reason] = selectConcern(store, cycleId)
  summary.selection_reason = reason
  if (concern === null) {
    summary.outcome = 'idle'
    summary.note = 'no selectable concern'
    logEvent('focus_cycle_idle', { cycle_id: cycleId, ...reason })
    promoteDueInsights(cycleId, summary, deps)
    retireStaleInsights(cycleId, summary, deps)
    safeFinalize(cycleId, summary, deps)
    return summary
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
    // SA-124：召回为空 = 无进展，**零 LLM 调用**——没有原料可想的时候花一次
    // 配额去想，是拿配额换一段无源之谈。
    summary.outcome = 'no_progress'
    summary.note = 'empty recall'
    applyConcernProgress(concern, cycleId, summary, false, deps)
    promoteDueInsights(cycleId, summary, deps)
    retireStaleInsights(cycleId, summary, deps)
    safeFinalize(cycleId, summary, deps, matchReasons)
    return summary
  }

  // --- 4. 一次 LLM 调用 -------------------------------------------------
  const existing = existingConclusions(store)
  const messages = buildMessages(deps.persona, buildPayload({ concern, materials, existing }))
  summary.llm_calls = 1 // SA-125：发出去就算数, 成败都计配额 (§7.1)
  let parsedRaw: Record<string, unknown> | null
  try {
    const rawMessage = await deps.completion(messages)
    parsedRaw = extractJsonOrNull(rawMessage.content ?? '')
  } catch (exc) {
    // SA-126：深挖失败是一条落账的周期。**不重试，明晚再来**；也不动反刍计数：
    // 一次 API 故障不是"她想不出来"，拿它去冷却一条关切是把基础设施的毛病记在
    // 她头上。
    logEvent('focus_llm_failed', {
      cycle_id: cycleId, concern_id: concern.id, error: errStr(exc),
    })
    summary.outcome = 'failed'
    summary.note = cpSlice(errStr(exc), 500)
    recordCycleTouch(concern, cycleId, deps)
    promoteDueInsights(cycleId, summary, deps)
    retireStaleInsights(cycleId, summary, deps)
    safeFinalize(cycleId, summary, deps, matchReasons)
    return summary
  }

  if (parsedRaw === null) {
    logEvent('focus_parse_failed', { cycle_id: cycleId, concern_id: concern.id })
    summary.outcome = 'failed'
    summary.note = 'parse_failed'
    recordCycleTouch(concern, cycleId, deps)
    promoteDueInsights(cycleId, summary, deps)
    retireStaleInsights(cycleId, summary, deps)
    safeFinalize(cycleId, summary, deps, matchReasons)
    return summary
  }

  const envelope = parseFocusEnvelope(parsedRaw)
  summary.note = cpSlice(envelope.note, 500)
  // SA-140：她自陈的 outcome 先落进 summary，再由 applyConclusion 按实际落地的
  // 产物收敛到 advanced/revised。少了这一行，一个 no_progress 信封会让周期停在
  // 初始值 'idle'——那是把"选了关切、召回了原料、烧了一次配额、她说想不出来"
  // 记成"今晚没事可想"，两件完全不同的事。
  summary.outcome = envelope.outcome

  // --- 5. 落产物 + 血缘 -------------------------------------------------
  applyConflicts(envelope, cycleId, summary, deps)
  const madeProgress = applyConclusion(envelope, concern, materials, cycleId, summary, deps)
  applyNewConcern(envelope, concern, materials, cycleId, summary, deps)

  // --- 6. 关切状态 + 影子期结算 + 衰减结算 -------------------------------
  // D-7：衰减排在 applyConclusion 之后——本周期刚重申/新建的结论其 history 最后
  // 一行的 cycle_id 已是本周期，距离 0，自然不降。
  applyConcernProgress(concern, cycleId, summary, madeProgress, deps)
  promoteDueInsights(cycleId, summary, deps)
  retireStaleInsights(cycleId, summary, deps)
  safeFinalize(cycleId, summary, deps, matchReasons)
  return summary
}

/**
 * SA-135：喂给她判冲突的既有结论——影子期的与已转正的都给（shadow/active/
 * contested 的**最后 20 条**），**已撤回/已被取代的不给**——那些是历史，留在
 * 库里供审计，但不该再参与今晚的推理。
 *
 * WO-MEM-DECAY-01（D-5）：喂入集加 `dormant`。休眠不是了结——一条久未重申的结论
 * 仍然是"她认为过且没被推翻"的东西，新证据推翻它时应当**当场**如实落 withdrawn，
 * 而不是等将来被点亮时带着已被推翻的内容复活。上限 20 不变。
 */
function existingConclusions(store: FocusStore): RawRow[] {
  const rows = store.listFocusInsights(['shadow', 'active', 'contested', 'dormant'])
  return rows.slice(-EXISTING_INSIGHT_LIMIT)
}

// --- 5a. 冲突 → contested → 修订/撤回（SA-129 两段式） ------------------------

/**
 * 把她报的冲突落成状态迁移。两段式，正是 §3.7 要求的"下一周期仍冲突才动手"：
 * 第一次报冲突 → contested（记下起争的周期号）；**已经 contested** 又报冲突 →
 * 这一次就动手：给了替代结论的走 revised（在 applyConclusion 里连上
 * superseded_by），没给的走 withdrawn。两条路都只改状态、只追加历史，insights
 * 那一行的内容一个字不动——"她曾经这么认为过"是身份连续性的一部分，不是垃圾。
 */
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

// --- 5b. 结论 + 血缘（SA-131） -------------------------------------------------

/**
 * 落结论、落血缘。返回"这一轮有没有新结论"（喂反刍计数）。
 * SA-131 血缘入账口径：**喂进 prompt 的每一条原料**，而不是她自陈引用的那几条
 * ——自陈是可以漏、可以编的；代码自己记下的"她看过什么"才是可审计的。她自陈
 * 的 cited_experience_ids 不丢（进周期记录的 note 侧），但不充当血缘。关切本身
 * 也是一条来源。SA-133：重申（逐字相同结论）不是进展。
 */
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

  // WO-PERS-OVERLAY-01（D-1）：类别由关切的 kind 决定，不由她自陈。
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

  // SA-145/146 · §3.8 门阶梯第 4 级：结论要是触到了**她自己的权限边界**，它只能
  // 进建议队列。判定由代码按词表做（isPermissionBoundary），不由她自陈——与
  // 血缘入账口径同一个理由。入队之后这条结论**照常**走它自己的影子期（硬约束 2：
  // insights 的 S=2 自动转正不经队列）。两条路互不相干，而且互不相干是对的：
  // 转正只让它成为"她认可的一句话"，与任何权限变更无关——权限变更这件事在她
  // 这边不存在。
  if (isPermissionBoundary(envelope.conclusion)) {
    try {
      const queued = suggestPermissionRule(store, deps.logEvent, {
        insightId, conclusion: envelope.conclusion,
        concernId: concern.id as number, cycleId, now,
      })
      summary.permission_suggestion_id = queued.id
    } catch (exc) {
      // 入队失败不该毁掉已落的结论。
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

  // 重申(逐字相同的结论)不是进展 —— 如实喂进反刍计数（SA-133）。
  return isNew
}

/**
 * SA-136 派生新关切（origin='derived'——§3.5 第三个来源，L4 是它的第一个写者）。
 * 失败（如 active 满 12 的 ConcernCapError）**不是周期失败**：有限性约束是她的
 * 设计特征，撞上它只是这条派生今晚落不了地，主结论照落。
 */
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

// --- 6a. 反刍防护（SA-126/127/128） -------------------------------------------

/**
 * SA-126：只记"这条关切在本周期被深挖过"，不动 streak/冷却。LLM 故障路径用它。
 */
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

/**
 * SA-127 更新关切状态与反刍计数（focus.py:656-721）。
 * 有进展 → lightConcern + streak 清零；无进展 → streak+1；连续 3 次 → 强制冷却
 * 5 周期、冷却次数 +1、streak 清零；冷却次数累计超过 2 → 落"建议释放"并入队。
 * SA-128 "只建议不执行"是这段代码里最要紧的一行——**本模块没有任何路径去释放
 * 一条关切**（红线 #3：释放只属于整合期的她或 owner 后门）。末尾**全字段覆盖**
 * 写回（部分更新会让"streak 与 cooldown 是同一次判断的两个面"失真），且
 * concerns 表在这条路径上一列不动。
 */
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
        // WO-L5：这条建议从此有了一个出口——排进建议队列，等着问 Kevin。
        // 入队失败不该毁掉本次周期（反刍计数照写）：建议是周期的副产品，
        // 不是它的目的。
        try {
          const queued = suggestConcernRelease(store, deps.logEvent, {
            concern, cycleId, cooldownCount, now,
          })
          summary.suggestion_id = queued.id
        } catch (exc) {
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

// --- 6b. 影子期结算（SA-130——G-4 的唯一例外条款） ----------------------------

/**
 * 影子期到点且未被 contested 的结论 → 转正（active）。
 *
 * **SA-130 例外条款（G-4 定案原文的落点）**："存续 S 个周期"**按周期序号**算：
 * cycle_id - created_cycle_id >= SHADOW_PERIOD_CYCLES。用序号而不是时钟，是因为
 * 门要挡的是"还没经历过足够多次复核的结论"，而复核发生在周期里，不发生在时间
 * 里——一台停机三周的机器不该因为墙上的钟走了三周就把结论放行（focus.py:729-733
 * 逐字）。G-4 把层 1/层 2 的**触发锚**迁到墙钟，但明文保留这里的周期序号口径：
 * DA-03 迁移的是触发锚，不是影子门。
 *
 * 结算跑在**每一种**周期结尾，包括空转与失败的：一条影子结论熬过的周期数不该
 * 因为今晚没关切可想就停止累积。
 */
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

// --- 6c. 衰减结算（WO-MEM-DECAY-01 · D-PERS-3） --------------------------------

/**
 * 一条 active 结论上一次被 L4 触达的周期号 = 它 `focus_insight_history` 最后一行的
 * `cycle_id`（D-2）。history 是追加式、永不更新的，所以"最后一行"就是最后一次
 * 触达：创建、重申、每一次状态迁移都会在那里留一行。
 *
 * 兜底：状态行存在而 history 空（正常路径产不出这种行——recordFocusInsight 与
 * setFocusInsightStatus 都在同一事务里追加 history）时退回 `updated_cycle_id`，
 * 宁可少降一条也不拿一个凭空的 0 去当"上次触达"。
 */
function lastTouchedCycle(store: FocusStore, row: RawRow): number {
  const history = store.focusInsightHistory(row.insight_id as number)
  if (history.length === 0) return row.updated_cycle_id as number
  return history[history.length - 1]!.cycle_id as number
}

/**
 * 久未被 L4 再触达的 active 结论 → dormant（**退出装配，不销毁，可点亮**）。
 *
 * 调节场宪法要的"更新规则 + 衰减规则 + 因果出口"里缺的那一条：慢变层当年只建了
 * 进的边（shadow → active）与被推翻的边（contested → revised/withdrawn），没有
 * "久了就不再是现行意见"的出口，于是 active 集只进不出，而 converse 每一轮把
 * **全部** active 行注入上下文——不补这条边，膨胀是必然的。
 *
 * 判据（D-2）：`cycleId - lastTouchedCycle >= INSIGHT_STALE_AFTER_CYCLES`，严格
 * 用 `>=`。单位是**周期序号不是墙钟**（同 SA-130 例外条款）：她的思考发生在周期
 * 里，一台停机三周的机器不该因为墙上的钟走了三周就退役她的结论。
 *
 * 设计稿 §3.3 原文写的信号是"长期未被装配引用"；现体里那个信号**无区分度**
 * （promotedFocusInsights = 全部 active，每一轮都被引用，每条行的引用次数一样），
 * 治理侧据此把信号改成"长期未被 L4 再触达"（D-2）。
 *
 * 单步，无 dimming 中间态（D-4）：装配是二值的（进/不进），中期层 concerns 的
 * dimming 是为权重与点亮服务的，慢变层没有那两样。
 *
 * 因果出口（D-6）：走既有的 `setFocusInsightStatus`——history 一行 + 一条
 * `focus_insight_status` 事件（from/to/reason），不另造事件面。reason 带上两个
 * 周期号，"她为什么不再提这句话了"因此可回放。
 *
 * 节律（D-7）：与 `promoteDueInsights` 同调用位、同覆盖面（**每一种**周期结尾，
 * 含空转与失败），且排在本周期 applyConclusion 之后——本周期刚重申或刚新建的
 * 结论，其 history 最后一行的 cycle_id 已经是本周期，距离 0，自然不降。
 */
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

// === 挂接点 ==================================================================

/**
 * 闸 + 周期（focus.py:748-763）。返回 summary 或 null（闸没开）。wake 的 SA-171
 * 钩子调它——位置紧跟整合之后、**独立于层 1 的成败**（层 1 的异常在它自己的
 * 钩子里就被吞掉了，"层 1 失败的晚上层 2 照常跑"不需要额外的编排）。
 */
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
