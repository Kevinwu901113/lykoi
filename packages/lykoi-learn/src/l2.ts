/**
 * lykoi-learn/l2 — 整合（mind/integrator.py 对应物；SA-89..108；她的睡眠）。
 *
 * 完整 Phase-3 周期：消化 experiences → 四种叙事操作（吸收/重解释/修订/悬置）→
 * 取舍（release / new concerns）→ 重写 narrative（连续性/忠实性门 + 有界重试一次）
 * → 念头清算 → reset cycle。防御式解析——任何畸形节降级为 no-op + 事件；
 * 管线里没有任何东西向 wake 循环抛（SA-137 同族契约）。
 *
 * **G-4 触发锚 = 墙钟**（DA-03 定案）：scheduled 路读
 * `integration_state.last_integration_at` 距今 >= INTEGRATION_EVERY_HOURS（24h），
 * 取代活体的 `wakes_since >= 24` 计数锚（wakes_since 自 W4 起是账面列）。
 * 锚缺席（从未整合过）→ 视为到期——同 G-8(a) 对 None 的读法："那不是脏值,
 * 那是还没定过"；反向读法（缺锚→永不到期）是死锁：锚只在真整合后前进。
 * **SA-130 例外条款不适用于本层**：那条例外（影子期结算按周期序号）是 L4 的
 * ——integrator 没有影子期，它的触发锚整体迁墙钟，无保留。
 * 零操作周期不前进锚（SA-101 的墙钟形态）：resetIntegrationCycle 只在
 * accepted_any 时调用，锚不动 → 下一拍 scheduled 仍开——212 次空转陷阱的
 * 反面在墙钟锚下自然成立。
 */
import { cognitiveEffects } from 'lykoi-regulation'
import {
  cpSlice, errStr, extractJsonOrNull, isInt, parseWeight, pyIso, pyStrOrEmpty,
  type ChatMessage, type CompletionFn, type LogEvent, type PersonaLike, type RawRow,
} from './shared.ts'

// --- 节律与容量 --------------------------------------------------------------

/** G-4：integrator 的墙钟锚（活体 INTEGRATION_EVERY_WAKES=24 拍 ≈ 24h 的墙钟形态）。 */
export const INTEGRATION_EVERY_HOURS = 24
/**
 * SA-93：容量 K=30 / 积压压力阈值 3K=90（integrator.py:45-59；2026-08-11 实测账：
 * 水位线之上起步 0 条，K 面对纯流入 ≈3 条/天，历史高活跃日 ≈40 条/天，K=30
 * 一晚吃 30、次日补上不形成结构性积压。目标是"不积压"，不是"每晚都清空"）。
 */
export const INTEGRATION_CAPACITY_K = 30
export const BACKLOG_PRESSURE_THRESHOLD = 3 * INTEGRATION_CAPACITY_K

export const EXPERIENCE_OPS = ['absorb', 'reinterpret', 'revise', 'suspend'] as const
export type ExperienceOp = (typeof EXPERIENCE_OPS)[number]
export const THOUGHT_OPS = ['settle', 'archive'] as const
export const THREAD_KINDS = ['open_question', 'commitment', 'suspended_tension', 'arc'] as const

export type TriggerReason = 'no_pending' | 'scheduled' | 'early' | 'not_yet'

// --- fidelity check（integrator.py:70-99；SA-103 逐字词表） -------------------

const REL_MARKERS = ['伴侣', '对象', '男朋友', '女朋友', '恋人', 'partner', 'boyfriend', 'girlfriend'] as const
// P5-06: 只用完整分离短语。"不再/结束了/和别人/不爱"是日常高频词组 —
// "不再被动等待"这种正常叙事都会撞线, 而门控误伤 = 静默阻断身份回路
// (经验消化了却不许写进自我)。兜底红线宁窄勿宽; LLM 纪律仍是第一道。
const SEPARATION_CUES = ['分手', '不再爱', '不爱我', '离开我', '离开了我', '爱上别人',
  '属于别人', '和别人在一起', '关系结束', 'no longer love', 'broke up', 'left me'] as const
const IDENTITY_DENIALS = ['不是 lykoi', '不叫 lykoi', '不再是 lykoi', 'not lykoi',
  '另一个 ai', 'another ai'] as const
const NAME_STOPWORDS = new Set(['I', 'A', 'An', 'My', 'The', 'And', 'But', 'She', 'He', 'It'])

/**
 * SA-103：与内核矛盾即 true——身份否认、关系终结、伴侣名不符。保守；这是 LLM
 * 自身忠实性纪律**之下**的确定性地板。
 */
export function violatesFidelity(persona: PersonaLike, content: string): boolean {
  const low = content.toLowerCase()
  if (IDENTITY_DENIALS.some((d) => low.includes(d))) return true
  if (SEPARATION_CUES.some((c) => low.includes(c))) return true
  if (REL_MARKERS.some((m) => low.includes(m))) {
    const named = new Set(content.match(/[A-Z][A-Za-z]+/g) ?? [])
    for (const n of named) {
      if (!NAME_STOPWORDS.has(n) && n !== persona.relationship.partner) return true
    }
  }
  return false
}

/**
 * SA-102【等价】连续性门（integrator.py:102-116）：旧文全部 4 字（码点）窗口作
 * anchors，新 content+"\n"+summary 命中任一非空白 anchor 即通过；首版免检。
 * backstop，不是完美过滤——LLM 也被告知了规则。
 */
export function narrativeContinuityOk(old: string | null, newContent: string, newSummary: string): boolean {
  if (old === null || !old.trim()) return true
  const cps = [...old]
  const blob = (newContent || '') + '\n' + (newSummary || '')
  for (let i = 0; i <= Math.max(0, cps.length - 4); i += 1) {
    const anchor = cps.slice(i, i + 4).join('')
    if (anchor.trim() && blob.includes(anchor)) return true
  }
  return false
}

// --- 触发闸 ------------------------------------------------------------------

/** L2 的 store 面（结构化接口；ReadWriteMemory 结构性满足）。 */
export interface IntegratorStore {
  countIntakePending(): number
  getIntegrationState(): RawRow
  getRegulation(opts: { now: Date }): {
    coherence: number; load: number; relational_tension: number; exploration_hunger: number
  }
  intakePending(limit: number | null, bySalience: boolean): RawRow[]
  getOpenThoughts(): RawRow[]
  thoughtsAwaitingClearance(): RawRow[]
  listConcerns(status?: string | readonly string[]): {
    id: number; kind: string; title: string; description: string; weight: number;
    status: string; lastLitAt: string | null
  }[]
  listThreads(status?: string | readonly string[]): {
    id: number; kind: string; content: string; status: string
  }[]
  currentCognitiveNarrative(): { content: string } | undefined
  releaseConcern(concernId: number, reason: string, opts: { now: Date }): void
  createConcern(kind: string, title: string, opts: {
    weight: number; origin: string; description?: string; now: Date
  }): number
  lightConcern(concernId: number, opts: { now: Date }): unknown
  getConcern(concernId: number): RawRow | null
  tendConcernDescription(concernId: number, description: string, opts: { now: Date }): void
  appendThreadProgress(threadId: number, line: string, opts: { now: Date }): void
  createThread(kind: string, content: string, opts: { now: Date }): number
  updateThread(threadId: number, opts: {
    status?: string | null; resolution?: string | null; now: Date
  }): void
  settleThought(thoughtId: number, integrationId: number): void
  archiveThought(thoughtId: number): void
  addNarrativeVersion(opts: {
    content: string; changeSummary: string; trigger: string; now: Date;
    narrativeClass?: string | null; acceptedOps?: number | null; expOps?: number | null
  }): number | null
  markExperiencesIntegrated(ids: readonly number[], integrationId: number, opts: { now: Date }): number
  applyRegulationCause(cause: string, opts: { now: Date }): unknown
  resetIntegrationCycle(opts: { now: Date }): void
}

/**
 * SA-89/90 触发闸（integrator.py:119-143；scheduled 锚按 G-4 迁墙钟）。纯查询。
 * **pending > 0 前置不可谈判**（红线 #1）：空整合会为零工作发 integration_completed
 * (+0.15 coherence)。口径 = intake（SA-90，与取料同口径——若读旧
 * countPendingExperiences，只有感知流入的夜晚被判 no_pending 而永不整合）。
 * early 与节律是 OR 不是 AND，且 early 路径**不查墙钟锚**（活体不查 wakes_since
 * 的对应物）。
 */
export function shouldIntegrate(store: IntegratorStore, now: Date): { should: boolean; reason: TriggerReason } {
  const pending = store.countIntakePending()
  if (pending === 0) return { should: false, reason: 'no_pending' }

  const state = store.getIntegrationState()
  const last = (state.last_integration_at ?? null) as string | null
  if (last === null || hoursSince(last, now) >= INTEGRATION_EVERY_HOURS) {
    return { should: true, reason: 'scheduled' }
  }

  const values = store.getRegulation({ now })
  if (cognitiveEffects(values).trigger_early_integration) {
    return { should: true, reason: 'early' }
  }
  return { should: false, reason: 'not_yet' }
}

function hoursSince(ts: string, now: Date): number {
  return (now.getTime() - new Date(ts).getTime()) / 3_600_000
}

// --- prompt ------------------------------------------------------------------

/**
 * SA-94：逐字迁（mind/integrator.py:148-190）。chars=1862，
 * sha256=b130d6473ff9c2e8983f06cced5ca97ae837644886f5db2f6f38ddf31132193c
 * （prompt.test.ts 常驻对拍）。
 */
export const INTEGRATION_SYSTEM_PROMPT = `你正在进入整合期(整合 = 她的睡眠)。下面是你过去一段时间积压的经验、当前关切、当前叙事、念头流。
你的任务是把经验消化进自我叙事,并对关切/念头做相应操作。

只输出一个 JSON 对象。结构:
{
  "experience_actions": [
    {"experience_id": <int>, "operation": "absorb|reinterpret|revise|suspend",
     "concern_id": <int|null>, "thread_id": <int|null>,
     "new_thread_kind": "suspended_tension|open_question|commitment|null",
     "note": <一句话, 必填>}
  ],
  "concern_releases": [{"concern_id": <int>, "reason": <str>}],
  "new_concerns":     [{"kind": "interest|project|question|ritual|relationship_thread",
                         "title": <str>, "description": <str>, "weight": <float, 0-1>,
                         "owner_directed": <bool>, "source_experience_id": <int|null>}],
  "narrative":        {"content": <str>, "change_summary": <str>},
  "thought_actions":  [{"thought_id": <int>, "operation": "settle|archive"}]
}

四种叙事操作 (每条经验必须选一种):
- absorb (吸收): 把经验写进一条现有关切。需 concern_id。
- reinterpret (重解释): 事实不变, 对一条关切或叙事线的意义重写。需 concern_id 或 thread_id。
- revise (修订): "我以前以为 X, 现在认为 Y, 因为 Z"。需 thread_id。
- suspend (悬置): 写一条新的叙事线 kind='suspended_tension', 明确不强行圆。

其他:
- concern_releases: 只有 status='dormant' 的关切可以 release(物理闸强制, active/dimming 会被拒), 给一句 reason。
- new_concerns: 真正稳定的新关切才提出, weight 默认 0.5。来源(origin)由系统标注, 你只需给下面两个字段:
  · owner_directed: 这条关切**是否来自 Kevin 明确表达的关注**。他在对话里说
    "我希望你留意 X" / "帮我盯着 Y" / "我最近在做 Z, 你注意一下" 这类**要你放在心上**的
    话, 就是 true —— 那是他给你的指定, 权重最高。
    只是聊到某个话题、你自己觉得该关心的, 是 false(那是你自己长出来的关切)。
  · source_experience_id: owner_directed=true 时, 填**说这句话的那条经验的 id**
    (必须来自 pending_experiences 里 source="conversation" 的那些)。
    不是他说的, 就填 null 并让 owner_directed=false。
- narrative: 新版本必须能引用旧版本的要素。无来由跳变会被拒绝。
- thought_actions: settle 只适用于 thoughts_to_clear 里 status='resolved' 的念头(吸收进叙事, 物理闸强制); archive 适用于 resolved/abandoned。open_thoughts 只是上下文, 不是操作目标。

不许:
- 改写身份内核 (你是谁, 谁是你的伴侣)。
- 凭空人格跳变。
- 输出 JSON 之外的任何文字。`

/** 第二条 system（身份守卫，integrator.py:277-278 逐字拼接形态；fixture sha=ce69ae2a…）。 */
export function integrationIdentityGuard(persona: PersonaLike): string {
  return `你的内核身份: ${persona.identity.name}; 你的伴侣: ${persona.relationship.partner}. `
    + '整合输出绝不能与之矛盾。'
}

const STATUS_RANK: Record<string, number> = { active: 0, dimming: 1, dormant: 2 }

/**
 * SA-95（integrator.py:228-238 逐字）：信封里的关切按 status-rank（active >
 * dimming > dormant）→ weight DESC → id ASC。一条刚铸出的低权重地板关切
 * (active) 必须浮到陈旧高权重 dormant 行之上。**只重排，不丢不藏**，且只作用
 * 于信封——listConcerns 对其他读者保持 weight DESC。
 */
export function statusFirst<T extends { status: string; weight: number; id: number }>(concerns: readonly T[]): T[] {
  return [...concerns].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 99) - (STATUS_RANK[b.status] ?? 99)
    || b.weight - a.weight
    || a.id - b.id)
}

/**
 * SA-96 _concern_origin（integrator.py:196-225 逐字）：识别是 LLM 判断，但
 * **能不能落成 owner_directed 是确定性的**——必须真的挂在本轮窗口里的一条
 * conversation 原料上。Kevin 的话只可能出现在对话里；一条感知或动作记录"要求"
 * 她留意什么，是幻觉或注入。判不成就降级为 emergent，**不丢关切**。
 */
export function concernOrigin(
  nc: { owner_directed: boolean; source_experience_id: number | null; title: string },
  conversationIds: ReadonlySet<number>,
  logEvent: LogEvent,
): string {
  if (!nc.owner_directed) return 'emergent'
  const sid = nc.source_experience_id
  if (sid !== null) {
    if (conversationIds.has(sid)) return 'owner_directed'
    logEvent('integration_owner_directed_downgraded', {
      reason: 'source_not_conversation', source_experience_id: sid, title: nc.title,
    })
    return 'emergent'
  }
  if (conversationIds.size > 0) return 'owner_directed'
  logEvent('integration_owner_directed_downgraded', {
    reason: 'no_conversation_in_window', title: nc.title,
  })
  return 'emergent'
}

// --- 信封（防御式解析，永不抛） -----------------------------------------------

export interface ExperienceAction {
  experience_id: number
  operation: ExperienceOp
  concern_id: number | null
  thread_id: number | null
  new_thread_kind: string | null
  note: string | null
}

export interface IntegrationEnvelope {
  experience_actions: ExperienceAction[]
  concern_releases: { concern_id: number; reason: string }[]
  new_concerns: {
    kind: string; title: string; description: string; weight: number;
    owner_directed: boolean; source_experience_id: number | null
  }[]
  narrative: { content: string; change_summary: string } | null
  thought_actions: { thought_id: number; operation: 'settle' | 'archive' }[]
}

/** integrator.py:299-380 逐字：任何一节畸形都降级成空。SA-97：owner_directed 只认 `=== true`。 */
export function parseIntegrationEnvelope(raw: unknown): IntegrationEnvelope {
  const result: IntegrationEnvelope = {
    experience_actions: [], concern_releases: [], new_concerns: [],
    narrative: null, thought_actions: [],
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return result
  const r = raw as Record<string, unknown>

  if (Array.isArray(r.experience_actions)) {
    for (const item of r.experience_actions as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const it = item as Record<string, unknown>
      const op = it.operation
      if (!(EXPERIENCE_OPS as readonly unknown[]).includes(op)) continue
      const eid = it.experience_id
      if (!isInt(eid)) continue
      result.experience_actions.push({
        experience_id: eid,
        operation: op as ExperienceOp,
        concern_id: isInt(it.concern_id) ? it.concern_id : null,
        thread_id: isInt(it.thread_id) ? it.thread_id : null,
        new_thread_kind: (THREAD_KINDS as readonly unknown[]).includes(it.new_thread_kind)
          ? (it.new_thread_kind as string)
          : null,
        note: pyStrOrEmpty(it.note).trim() || null,
      })
    }
  }

  if (Array.isArray(r.concern_releases)) {
    for (const item of r.concern_releases as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const it = item as Record<string, unknown>
      const cid = it.concern_id
      const reason = typeof it.reason === 'string' ? it.reason.trim() : ''
      if (isInt(cid) && reason) {
        result.concern_releases.push({ concern_id: cid, reason })
      }
    }
  }

  if (Array.isArray(r.new_concerns)) {
    for (const item of r.new_concerns as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const it = item as Record<string, unknown>
      const kind = it.kind
      const title = typeof it.title === 'string' ? it.title.trim() : ''
      const description = it.description ?? ''
      // SA-97（integrator.py:350-353 逐字）：owner_directed 只认真正的 true
      // ——这是最高权重的来源, 宁可漏认不可错认；source_experience_id 缺失/
      // 非 int 一律 null，由 concernOrigin 决定还能不能落成 owner_directed。
      const sid = it.source_experience_id
      if (kind && title) {
        result.new_concerns.push({
          kind: kind as string,
          title,
          description: typeof description === 'string' ? description : '',
          weight: parseWeight(it.weight),
          owner_directed: it.owner_directed === true,
          source_experience_id: isInt(sid) ? sid : null,
        })
      }
    }
  }

  const nar = r.narrative
  if (typeof nar === 'object' && nar !== null && !Array.isArray(nar)) {
    const n = nar as Record<string, unknown>
    const content = typeof n.content === 'string' ? n.content.trim() : ''
    const summary = typeof n.change_summary === 'string' ? n.change_summary.trim() : ''
    if (content && summary) {
      result.narrative = { content, change_summary: summary }
    }
  }

  if (Array.isArray(r.thought_actions)) {
    for (const item of r.thought_actions as unknown[]) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
      const it = item as Record<string, unknown>
      const op = it.operation
      const tid = it.thought_id
      if ((THOUGHT_OPS as readonly unknown[]).includes(op) && isInt(tid)) {
        result.thought_actions.push({ thought_id: tid, operation: op as 'settle' | 'archive' })
      }
    }
  }

  return result
}

// --- 遥测（WO-P4R-04 observe-only；SA-107/108） -------------------------------
// telemetry records, it does not gate（cardinal rule §0）。发射值全是计数/标签/
// 码，**自由文本永不入遥测**（shape-not-content）。

/** kill switch（关掉 → legacy 发射，认知逐字节相同——测试据此验证 no-op）。 */
export const integrationTelemetry = { emit: true }

const REJECTION_OPS = ['absorb', 'reinterpret', 'revise', 'suspend', 'settle', 'archive'] as const
const REJECTION_DETAIL_CODES: Record<string, string> = { 'no concern': 'no_concern', 'no target': 'no_target' }
const REJECTION_EXACT_CODES: Record<string, [string | null, string]> = {
  not_in_window: [null, 'not_in_window'],
  continuity_or_fidelity: [null, 'continuity_or_fidelity'],
}
const LIST_SECTIONS = ['experience_actions', 'concern_releases', 'new_concerns', 'thought_actions'] as const

export interface RejectionRecord extends Record<string, unknown> {
  section: string
}

/**
 * SA-107：把一条周期拒绝折成 content-free 的 {section, op, code}。reason 里可能
 * 嵌着异常文本（f"absorb: {exc}" / str(exc)）——一律折成通用 error 码。
 */
export function classifyRejection(rejection: RejectionRecord): { section: unknown; op: string | null; code: string } {
  const section = rejection.section
  const reason = pyStrOrEmpty(rejection.reason).trim()
  if (reason in REJECTION_EXACT_CODES) {
    const [op, code] = REJECTION_EXACT_CODES[reason]!
    return { section, op, code }
  }
  if (reason.includes(': ')) {
    const idx = reason.indexOf(': ')
    const prefix = reason.slice(0, idx)
    const detail = reason.slice(idx + 2)
    if ((REJECTION_OPS as readonly string[]).includes(prefix)) {
      return { section, op: prefix, code: REJECTION_DETAIL_CODES[detail.trim()] ?? 'error' }
    }
    return { section, op: null, code: 'error' }
  }
  for (const op of REJECTION_OPS) {
    if (reason.startsWith(op + '_')) {
      return { section, op, code: reason.slice(op.length + 1) }
    }
  }
  return { section, op: null, code: 'error' }
}

function rawListLen(parsedRaw: Record<string, unknown> | null, key: string): number {
  const value = parsedRaw?.[key]
  return Array.isArray(value) ? value.length : 0
}

/** 逐节结构形：proposed/accepted/rejected，按构造 proposed == accepted + rejected。 */
export function integrationShape(
  summary: IntegrationSummary,
  parsedRaw: Record<string, unknown> | null,
): Record<string, unknown> {
  const accepted: Record<string, number> = {
    experience_actions: summary.absorbs + summary.reinterprets + summary.revises + summary.suspends,
    concern_releases: summary.concerns_released,
    new_concerns: summary.concerns_created,
    thought_actions: summary.thoughts_settled + summary.thoughts_archived,
  }
  const shape: Record<string, unknown> = {}
  for (const section of LIST_SECTIONS) {
    const proposed = rawListLen(parsedRaw, section)
    const acc = accepted[section]!
    shape[section] = { proposed, accepted: acc, rejected: proposed - acc }
  }
  const nar = parsedRaw?.narrative
  shape.narrative = {
    proposed: typeof nar === 'object' && nar !== null && !Array.isArray(nar),
    rewritten: summary.narrative_rewritten,
  }
  return shape
}

function normalizedRejections(
  summary: IntegrationSummary,
  envelope: IntegrationEnvelope,
  parsedRaw: Record<string, unknown> | null,
): { section: unknown; op: string | null; code: string }[] {
  const records = summary.rejected.map((r) => classifyRejection(r))
  for (const section of LIST_SECTIONS) {
    const unmapped = rawListLen(parsedRaw, section) - (envelope[section] ?? []).length
    for (let i = 0; i < Math.max(0, unmapped); i += 1) {
      records.push({ section, op: null, code: 'unmapped' })
    }
  }
  return records
}

/**
 * SA-107/108 observe-only 发射：kill switch 关 → legacy 形（丢 rejected，无
 * shape/counts/stamp），认知两边逐字节相同。virtual_ts 与认知写用同一个 now
 * （压缩时制下遥测时刻与认知时刻一致）；事件自身 ts（audit 行）保持真实。
 */
export function emitIntegrationSummary(
  summary: IntegrationSummary,
  envelope: IntegrationEnvelope,
  parsedRaw: Record<string, unknown> | null,
  now: Date,
  logEvent: LogEvent,
): void {
  const { rejected: _rejected, ...fields } = summary
  if (!integrationTelemetry.emit) {
    logEvent('integration_completed_summary', { ...fields })
    return
  }
  const rejections = normalizedRejections(summary, envelope, parsedRaw)
  const acceptedOps = summary.absorbs + summary.reinterprets + summary.revises + summary.suspends
  logEvent('integration_completed_summary', {
    ...fields,
    virtual_ts: pyIso(now),
    accepted_ops: acceptedOps,
    rejected_count: rejections.length,
    rejected: rejections,
    shape: integrationShape(summary, parsedRaw),
  })
}

// --- 周期 --------------------------------------------------------------------

export interface IntegrationSummary {
  integration_id: number
  experiences_integrated: number
  absorbs: number
  reinterprets: number
  revises: number
  suspends: number
  concerns_released: number
  concerns_created: number
  /** 其中 origin='owner_directed' 的条数——concerns_created 的子集，不是另一个计数口径。 */
  concerns_owner_directed: number
  narrative_rewritten: boolean
  narrative_retried: boolean
  thoughts_settled: number
  thoughts_archived: number
  rejected: RejectionRecord[]
}

export interface IntegrateDeps {
  store: IntegratorStore
  persona: PersonaLike
  completion: CompletionFn
  logEvent: LogEvent
  now: Date
  /** integration_id 源（Python uuid4().int % 2**31；测试注定值）。 */
  integrationIdFn?: () => number
}

const OP_PLURAL = {
  absorb: 'absorbs', reinterpret: 'reinterprets', revise: 'revises', suspend: 'suspends',
} as const

/** _classify_integration（SA-98）：仅从 ACCEPTED 操作计数派生，与关切状态无关。 */
export function classifyIntegration(summary: IntegrationSummary): string {
  const expOps = summary.absorbs + summary.reinterprets + summary.revises + summary.suspends
  const concernOps = summary.concerns_released + summary.concerns_created
  const thoughtOps = summary.thoughts_settled + summary.thoughts_archived
  if (expOps > 0) return 'absorption'
  if (concernOps > 0 || thoughtOps > 0) return 'reflection'
  return 'narrative_only'
}

function buildPayload(deps: {
  experiences: RawRow[]
  concerns: { id: number; kind: string; title: string; description: string; weight: number; status: string; lastLitAt: string | null }[]
  threads: { id: number; kind: string; content: string; status: string }[]
  narrative: string | null
  openThoughts: RawRow[]
  settledThoughts: RawRow[]
}): Record<string, unknown> {
  return {
    pending_experiences: deps.experiences.map((e) => ({
      id: e.id, ts: e.ts, source: e.source, content: e.content,
      salience: e.salience, related_concern_id: e.related_concern_id,
    })),
    concerns: deps.concerns.map((c) => ({
      id: c.id, kind: c.kind, title: c.title, description: c.description,
      weight: c.weight, status: c.status, last_lit_at: c.lastLitAt,
    })),
    narrative_threads: deps.threads.map((t) => ({
      id: t.id, kind: t.kind, content: t.content, status: t.status,
    })),
    current_narrative: deps.narrative,
    open_thoughts: deps.openThoughts.map((t) => ({
      id: t.id, content: t.content, kind: t.kind, charge: t.charge, status: t.status,
    })),
    thoughts_to_clear: deps.settledThoughts.map((t) => ({
      id: t.id, content: t.content, kind: t.kind, status: t.status,
    })),
  }
}

function buildMessages(persona: PersonaLike, payload: Record<string, unknown>): ChatMessage[] {
  // payload 序列化：JSON.stringify 紧凑分隔符（W1 TODO#6 既定跨语言等价档——
  // Python json.dumps(ensure_ascii=False) 的 ", "/": " 分隔符差异不入契约面；
  // 键序 = 插入序，两边一致）。
  return [
    { role: 'system', content: INTEGRATION_SYSTEM_PROMPT },
    { role: 'system', content: integrationIdentityGuard(persona) },
    { role: 'user', content: JSON.stringify(payload) },
  ]
}

/** P5-06 重试轮 user 消息（integrator.py:750-759 逐字骨架；含变长 old_content，不可哈希）。 */
export function narrativeRetryFeedback(oldContent: string | null): string {
  return (
    '你的叙事改写被连续性/忠实性门控拒绝。本次整合的其他操作已全部生效, 不要重发。\n'
    + `当前叙事全文:\n${oldContent || '(无)'}\n\n`
    + '重写一版新叙事: content 或 change_summary 必须包含旧叙事中一段逐字原文片段(至少 4 字), '
    + '且不得否认身份内核(你是谁、谁是你的伴侣)。\n'
    + '只输出一个 JSON 对象: {"narrative": {"content": <str>, "change_summary": <str>}}'
  )
}

function defaultIntegrationId(): number {
  // uuid4().int % 2**31 的等价档：31 位均匀随机正整数。
  return Math.floor(Math.random() * 2 ** 31)
}

/**
 * 跑一个完整整合周期（integrator.py:537-718 七步逐序）。返回 summary。
 * **永不抛**——任何一步的失败降级为落账 no-op，周期其余部分继续。
 */
export async function runIntegration(deps: IntegrateDeps): Promise<IntegrationSummary> {
  const { store, logEvent, now } = deps
  const integrationId = (deps.integrationIdFn ?? defaultIntegrationId)()
  const summary: IntegrationSummary = {
    integration_id: integrationId,
    experiences_integrated: 0,
    absorbs: 0, reinterprets: 0, revises: 0, suspends: 0,
    concerns_released: 0, concerns_created: 0,
    concerns_owner_directed: 0,
    narrative_rewritten: false,
    narrative_retried: false,
    thoughts_settled: 0, thoughts_archived: 0,
    rejected: [],
  }

  // 1. 取料（WO-L2 口：原料池未消化项 且 id > 水位线；environment 不再被硬排除）。
  const pending = store.intakePending(INTEGRATION_CAPACITY_K, true)
  if (pending.length === 0) {
    logEvent('integration_skipped', { reason: 'no_pending' })
    return summary
  }

  const openThoughts = store.getOpenThoughts()
  const settled = store.thoughtsAwaitingClearance()

  const payload = buildPayload({
    experiences: pending,
    concerns: statusFirst(store.listConcerns(['active', 'dimming', 'dormant'])),
    threads: store.listThreads(['open', 'suspended']),
    narrative: (store.currentCognitiveNarrative()?.content ?? null),
    openThoughts,
    settledThoughts: settled,
  })
  const messages = buildMessages(deps.persona, payload)

  // 2. 一次 LLM 调用（路由/温度/max_tokens/origin 归编排层的 completion 闭包，
  //    SA-172）。LLM 异常按活体口径**向上冒**——吞它的是编排层的 SA-171 钩子
  //    （autonomy_integrate_failed），不是本函数；"永不抛"指的是解析与落库面。
  const rawMessage = await deps.completion(messages)
  const parsedRaw = extractJsonOrNull(rawMessage.content ?? '')
  if (parsedRaw === null) {
    logEvent('integration_parse_failed', { run: 'integrator' })
    return summary
  }
  const envelope = parseIntegrationEnvelope(parsedRaw)

  // 3. 四操作。
  const pendingIds = new Set(pending.map((e) => e.id as number))
  const integratedNow: number[] = []
  for (const action of envelope.experience_actions) {
    const eid = action.experience_id
    if (!pendingIds.has(eid)) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: 'not_in_window' })
      continue
    }
    const ok = applyExperienceOp(action, store, summary, now)
    if (ok) {
      integratedNow.push(eid)
      summary[OP_PLURAL[action.operation]] += 1
    }
  }

  // 4. 取舍：releases + new concerns。
  for (const rel of envelope.concern_releases) {
    try {
      store.releaseConcern(rel.concern_id, rel.reason, { now })
      summary.concerns_released += 1
    } catch (exc) {
      summary.rejected.push({ section: 'concern_releases', id: rel.concern_id, reason: errStr(exc) })
    }
  }
  const conversationIds = new Set(
    pending.filter((e) => e.source === 'conversation').map((e) => e.id as number),
  )
  for (const nc of envelope.new_concerns) {
    try {
      const origin = concernOrigin(nc, conversationIds, logEvent)
      store.createConcern(nc.kind, nc.title, {
        description: nc.description, weight: nc.weight, origin, now,
      })
      summary.concerns_created += 1
      if (origin === 'owner_directed') summary.concerns_owner_directed += 1
    } catch (exc) {
      summary.rejected.push({ section: 'new_concerns', title: nc.title, reason: errStr(exc) })
    }
  }

  // 5. 念头清算（settle 仅 resolved→absorbed=红线 #3 的物理面；失败 → rejected）。
  for (const ta of envelope.thought_actions) {
    if (ta.operation === 'settle') {
      try {
        store.settleThought(ta.thought_id, integrationId)
        summary.thoughts_settled += 1
      } catch {
        summary.rejected.push({ section: 'thought_actions', id: ta.thought_id, reason: 'settle_failed' })
      }
    } else {
      try {
        store.archiveThought(ta.thought_id)
        summary.thoughts_archived += 1
      } catch {
        summary.rejected.push({ section: 'thought_actions', id: ta.thought_id, reason: 'archive_failed' })
      }
    }
  }

  // 6. 重写叙事（座位在念头清算之后——class 看到含念头 op 的最终计数，SA-98；
  //    连续性基准 = current_cognitive_narrative，跳过 narrative_only，SA-104）。
  if (envelope.narrative) {
    const current = store.currentCognitiveNarrative()
    const oldContent = current ? current.content : null
    const firstNew = envelope.narrative
    if (!gateAndPersistNarrative(firstNew, deps, oldContent, summary)) {
      // SA-105 有界重试一次：retry 只要 narrative，已生效的 ops 绝不重放（非幂等）。
      let retryNew: { content: string; change_summary: string } | null = null
      try {
        const retryMessages: ChatMessage[] = [
          ...messages,
          { role: 'assistant', content: rawMessage.content ?? '' },
          { role: 'user', content: narrativeRetryFeedback(oldContent) },
        ]
        const retryRaw = await deps.completion(retryMessages)
        const retryParsed = extractJsonOrNull(retryRaw.content ?? '')
        if (retryParsed !== null) {
          retryNew = parseIntegrationEnvelope(retryParsed).narrative
        }
      } catch (exc) {
        logEvent('integration_narrative_retry_error', { error: errStr(exc) })
      }
      if (retryNew && gateAndPersistNarrative(retryNew, deps, oldContent, summary)) {
        summary.narrative_retried = true
        logEvent('integration_narrative_retry_accepted', {})
      } else {
        logEvent('integration_narrative_rejected', {
          reason: 'continuity_or_fidelity',
          change_summary: cpSlice(firstNew.change_summary, 200),
        })
        summary.rejected.push({ section: 'narrative', reason: 'continuity_or_fidelity' })
        // SA-106 终拒 → narrative_conflict：coherence 的第一条真实下行出口。
        store.applyRegulationCause('narrative_conflict', { now })
      }
    }
  }

  // 7. 收尾：标记 + 因 + 积压 + reset + 遥测。
  if (integratedNow.length > 0) {
    store.markExperiencesIntegrated(integratedNow, integrationId, { now })
    summary.experiences_integrated = integratedNow.length
    // 红线 #1：只在真有活时发 integration_completed。
    store.applyRegulationCause('integration_completed', { now })
    // SA-100：integration_digested 只由 absorbs>0 触发——load 是 ABSORBING 状态
    // 的桩，reinterpret/revise/suspend 标记经验已整合但什么都没吸收，在它们上
    // 泄压 = 声称消化却没消化（与 C2 confabulation 同质）。
    if (summary.absorbs > 0) {
      store.applyRegulationCause('integration_digested', { now })
    }
  }
  // 积压压力（intake 口径——水位线之下的历史感知根本不该消化，拿它们喂
  // experience_backlog 会造出一个她永远无法通过消化解除的假压力）。
  if (store.countIntakePending() > BACKLOG_PRESSURE_THRESHOLD) {
    store.applyRegulationCause('experience_backlog', { now })
  }
  // SA-101：零操作周期不前进锚（G-4 墙钟形态；212 次空转陷阱），空转不算一次整合。
  const acceptedAny = integratedNow.length > 0
    || summary.concerns_released > 0 || summary.concerns_created > 0
    || summary.thoughts_settled > 0 || summary.thoughts_archived > 0
    || summary.narrative_rewritten
  if (acceptedAny) {
    store.resetIntegrationCycle({ now })
  }
  emitIntegrationSummary(summary, envelope, parsedRaw, now, logEvent)
  return summary
}

/** 连续性/忠实性门 + 落库（integrator.py:721-747）。true = 门过（store 仍可能拒 strict-empty——那是计数判定，重写文字改不了它，所以 gate-pass 总是终结重试循环）。 */
function gateAndPersistNarrative(
  neu: { content: string; change_summary: string },
  deps: IntegrateDeps,
  oldContent: string | null,
  summary: IntegrationSummary,
): boolean {
  if (!(narrativeContinuityOk(oldContent, neu.content, neu.change_summary)
    && !violatesFidelity(deps.persona, neu.content))) {
    return false
  }
  // WO-P4R-C2：申报结构计数，让 STORE 物理拒绝 strict-empty / absorb-lie
  // （物理层优先——不是 integrator 的约定）。change_summary 原样传递；
  // 谎言闸是纯计数，从不读散文。
  const expOps = summary.absorbs + summary.reinterprets + summary.revises + summary.suspends
  const acceptedOps = expOps + summary.concerns_released + summary.concerns_created
    + summary.thoughts_settled + summary.thoughts_archived
  const versionId = deps.store.addNarrativeVersion({
    content: neu.content, changeSummary: neu.change_summary,
    trigger: 'integration', now: deps.now,
    narrativeClass: classifyIntegration(summary),
    acceptedOps, expOps,
  })
  // narrative_rewritten 反映**实际持久化**：store 拒绝 strict-empty 时返回 null
  // ——那就什么都没重写，先前的真实叙事继续站着。
  summary.narrative_rewritten = versionId !== null
  return true
}

/** 四操作逐支（integrator.py:762-841 逐字语义）。true = 本周期把该经验标为已整合。 */
function applyExperienceOp(
  action: ExperienceAction,
  store: IntegratorStore,
  summary: IntegrationSummary,
  now: Date,
): boolean {
  const eid = action.experience_id
  const op = action.operation
  const note = action.note ?? ''
  const cid = action.concern_id
  const tid = action.thread_id

  if (op === 'absorb') {
    if (cid === null) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: 'absorb_missing_concern_id' })
      return false
    }
    // 点亮关切刷新 last_lit_at + lit_count，兼作"这条经验触到这条关切"的审计锚。
    try {
      store.lightConcern(cid, { now })
      return true
    } catch (exc) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: `absorb: ${errStr(exc)}` })
      return false
    }
  }

  if (op === 'reinterpret') {
    // 重解释是元数据级——note 落线更新（有 thread_id）或关切描述照料。
    try {
      if (tid !== null) {
        store.appendThreadProgress(tid, note || '(reinterpreted)', { now })
      } else if (cid !== null) {
        const old = store.getConcern(cid)
        if (old === null) {
          summary.rejected.push({ section: 'experience_actions', id: eid, reason: 'reinterpret: no concern' })
          return false
        }
        const desc = (old.description as string) ?? ''
        const merged = cpSlice((desc + (desc ? '\n' : '') + note).trim(), 1024)
        store.tendConcernDescription(cid, merged, { now })
      } else {
        summary.rejected.push({ section: 'experience_actions', id: eid, reason: 'reinterpret: no target' })
        return false
      }
      return true
    } catch (exc) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: `reinterpret: ${errStr(exc)}` })
      return false
    }
  }

  if (op === 'revise') {
    if (tid === null) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: 'revise_missing_thread_id' })
      return false
    }
    try {
      // resolved + resolution = "我以前以为 X, 现在认为 Y, 因为 Z" 的落点。
      const wasSuspended = store.listThreads(['suspended']).some((t) => t.id === tid)
      store.updateThread(tid, { status: 'resolved', resolution: note || '(revised)', now })
      // P5-06 suspension_resolved：悬置张力被 revise 解除 = 真实的 coherence 上行事件。
      if (wasSuspended) {
        store.applyRegulationCause('suspension_resolved', { now })
      }
      return true
    } catch (exc) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: `revise: ${errStr(exc)}` })
      return false
    }
  }

  if (op === 'suspend') {
    const kind = action.new_thread_kind ?? 'suspended_tension'
    try {
      const newTid = store.createThread(kind, note || '(suspended)', { now })
      if (kind !== 'open') {
        // create_thread 起始 'open'——suspend 要让超龄门最终看得见它。
        store.updateThread(newTid, { status: 'suspended', now })
      }
      return true
    } catch (exc) {
      summary.rejected.push({ section: 'experience_actions', id: eid, reason: `suspend: ${errStr(exc)}` })
      return false
    }
  }

  return false
}

/**
 * 闸 + 周期（挂接位；wake 的 SA-171 钩子调它）。返回 summary 或 null（闸没开）。
 */
export async function maybeRunIntegration(deps: IntegrateDeps): Promise<IntegrationSummary | null> {
  const gate = shouldIntegrate(deps.store, deps.now)
  if (!gate.should) return null
  const summary = await runIntegration(deps)
  deps.logEvent('autonomy_integrate', {
    reason: gate.reason,
    integration_id: summary.integration_id,
    experiences_integrated: summary.experiences_integrated,
    narrative_rewritten: summary.narrative_rewritten,
  })
  return summary
}
