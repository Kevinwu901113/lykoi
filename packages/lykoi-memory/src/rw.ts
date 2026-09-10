import { regulationField, openThoughts, autonomyState, readMindSchemaVersion } from './queries.ts'
import { DatabaseSync } from 'node:sqlite'
import { classifyExperience, RULE_VERSION } from 'lykoi-learn/l1'
import {
  ABANDON_THRESHOLD,
  applyDeltaValue,
  CAUSES,
  decayCharge,
  decayValue,
  clamp01,
  QUESTION_OVERDUE_HOURS,
  THOUGHT_LAPSE_SALIENCE,
  THOUGHT_OPEN_CAP,
  type RegulationVariableName,
} from 'lykoi-regulation'
import {
  EXPECTED_MIND_SCHEMA_VERSION,
  factualEpistemicClause,
  parseStateTimestamp,
  type AutonomyStateRow,
  type ConcernRow,
  type EpistemicStance,
  type ExperienceRow,
  type HistoryRow,
  type RegulationFieldRow,
  type ThoughtRow,
} from './index.ts'

export function formatPyIso(moment: Date): string {
  if (!(moment instanceof Date) || Number.isNaN(moment.getTime())) {
    throw new TypeError('lykoi-memory: formatPyIso requires a valid Date')
  }
  const iso = moment.toISOString() // YYYY-MM-DDTHH:mm:ss.sssZ
  const head = iso.slice(0, 19)
  const ms = moment.getUTCMilliseconds()
  const frac = ms === 0 ? '' : `.${String(ms).padStart(3, '0')}000`
  return `${head}${frac}+00:00`
}

// ============================== 类型 ==============================

/** experiences.source 的 CHECK 枚举（STATE-CONTRACT §1.2 experiences，逐字）。 */
export type ExperienceSource
  = 'conversation' | 'wake_action' | 'action_result' | 'silence'
  | 'owner_event' | 'system' | 'thought_lapse' | 'environment'

/**
 * `conversation` 渠道的消息方向（设计稿 §3.1：同一渠道按方向劈认识论地位）。
 * `inbound` = 对方产出（他说的）→ `user_reported`；
 * `outbound` = 她自己产出（她说的/她做的）→ `executed`。
 */
export type ConversationDirection = 'inbound' | 'outbound'

/**
 * 渠道 → 认识论地位的默认推导（人格分层设计稿 v1 §3.1 映射表逐字）：
 *   `wake_action` / `action_result`      → executed
 *   `owner_event`                        → user_reported
 *   `silence` / `environment` / `system` → observed
 *   `thought_lapse`                      → inferred
 *   `conversation`                       → 按消息方向劈（inbound=user_reported /
 *                                          outbound=executed）
 *
 * `conversation` 缺方向时取 `user_reported`：对话渠道的经验默认记的是"对方说了
 * 什么"这件被告知的事，取更弱的认识论主张是保守侧；知道自己是产出方的调用点
 * 显式传 `outbound`。**本函数永不产出 `imagined|simulated`**——虚构地位只能由
 * 写入方显式声明（如 contemplate 产物标 imagined），推不出来。
 */
export function deriveEpistemic(
  source: ExperienceSource,
  direction?: ConversationDirection,
): EpistemicStance {
  switch (source) {
    case 'wake_action':
    case 'action_result':
      return 'executed'
    case 'owner_event':
      return 'user_reported'
    case 'silence':
    case 'environment':
    case 'system':
      return 'observed'
    case 'thought_lapse':
      return 'inferred'
    case 'conversation':
      return direction === 'outbound' ? 'executed' : 'user_reported'
    default: {
      // 渠道轴是 CHECK 枚举，走到这里说明调用方绕过了类型面。
      throw new ValueError(`unknown experience source: '${String(source)}'`)
    }
  }
}

export type ThoughtKind = 'intent' | 'question' | 'hypothesis' | 'rumination' | 'observation'
export type ThoughtSource = 'wake' | 'conversation' | 'integration' | 'contemplate'

export interface RegulationCauseResult {
  cause: string
  name: RegulationVariableName
  delta: number
  /** 懒衰减落账后的写前值（本次 delta 之前）。 */
  valueBefore: number
  valueAfter: number
  ts: string
}

export interface DecayThoughtsResult {

  decayed: number

  lapsed: number[]
}

export interface AutonomyRunRow {
  id: string
  startedAt: string
  finishedAt: string | null
  status: string
  decision: string | null
  nextWakeAt: string | null
  actionCount: number | null
  externalReadCount: number | null
  notificationCount: number | null
}



export interface FinishAutonomyRunOptions {
  /** autonomy_runs.status 注释级枚举（C 契约 §1.2：无 CHECK，纪律在 API 层）。 */
  status: 'completed' | 'failed' | 'stale'
  finishedAt: Date

  decision?: string | null
  nextWakeAt?: Date | null
  actionCount?: number
  externalReadCount?: number
  notificationCount?: number
}

const THOUGHT_KINDS: readonly ThoughtKind[] = [
  'intent', 'question', 'hypothesis', 'rumination', 'observation',
]
const THOUGHT_SOURCES: readonly ThoughtSource[] = [
  'wake', 'conversation', 'integration', 'contemplate',
]
const RUN_STATUSES = ['completed', 'failed', 'stale'] as const

export const ACTIVE_CONCERN_CAP = 12

export const DIMMING_AFTER_DAYS = 7

export const DORMANT_AFTER_DAYS = 21

export const SUSPENDED_OVERDUE_DAYS = 30

export const CONCERN_KINDS = [
  'interest', 'project', 'question', 'ritual', 'relationship_thread',
] as const
export type ConcernKind = (typeof CONCERN_KINDS)[number]

export const CONCERN_ORIGINS = [
  'seed', 'grown', 'relationship', 'floor', 'emergent', 'owner_directed', 'derived',
] as const
export type ConcernOrigin = (typeof CONCERN_ORIGINS)[number]

export class ConcernCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcernCapError'
  }
}

export class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

export const CONCERN_LIT_WEIGHT_DELTA = 0.05

export type RawRow = Record<string, unknown>

function cpSlice(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

export const L2_INTAKE_WATERMARK_KEY = 'l2_intake_watermark_id'

export const L4_FOCUS_WAKES_KEY = 'l4_focus_wakes_since'

const INTAKE_CLAUSE = "ec.class = 'working' AND e.integrated = 0 AND e.id > ?"
  + ` AND ${factualEpistemicClause('e')}`

const NARRATIVE_TRIGGERS: readonly string[] = ['integration', 'owner_edit']
const NARRATIVE_CLASSES: readonly string[]
  = ['absorption', 'reflection', 'narrative_only', 'legacy', 'owner_edit']
const THREAD_KIND_ENUM: readonly string[]
  = ['open_question', 'commitment', 'suspended_tension', 'arc']
const THREAD_STATUS_ENUM: readonly string[] = ['open', 'suspended', 'resolved', 'absorbed']

export const FOCUS_OUTCOME_ENUM: readonly string[]
  = ['idle', 'advanced', 'revised', 'no_progress', 'failed']

export const FOCUS_INSIGHT_STATUS_ENUM: readonly string[]
  = ['shadow', 'active', 'contested', 'revised', 'withdrawn', 'dormant']

export const RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'

export const LINEAGE_PRODUCT_INSIGHT = 'insight'
export const LINEAGE_PRODUCT_CONCERN = 'concern'
export const LINEAGE_PRODUCT_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_EXPERIENCE = 'experience'
export const LINEAGE_SOURCE_CONCERN = 'concern'
export const LINEAGE_SOURCE_INSIGHT = 'insight'

export const RULE_SUGGESTION_KINDS: readonly string[]
  = ['concern_release', 'permission_rule', 'standing_grant']
const SUGGESTION_STATUS_ENUM: readonly string[]
  = ['pending', 'asked', 'accepted', 'declined', 'expired', 'applied_by_owner']

export const SUGGESTION_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  asked: ['pending'],
  accepted: ['asked'],
  declined: ['asked'],
  expired: ['asked'],
  applied_by_owner: ['accepted'],
  pending: ['declined', 'expired'],
}

export class ReleaseCandidacyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseCandidacyError'
  }
}

export interface RegulationEventRow {
  id: number
  ts: string
  name: string
  delta: number
  valueAfter: number
  cause: string
}

export interface ThreadRow {
  id: number
  kind: string
  content: string
  status: string
  createdAt: string
  updatedAt: string
  resolution: string | null
}

export interface NarrativeVersionRow {
  id: number
  createdAt: string
  content: string
  changeSummary: string
  trigger: string
  narrativeClass: string | null
}

export interface InsightRow {
  id: number
  created: string
  updated: string
  category: string
  content: string
}

export interface ConcernTransition {
  id: number
  from: string
  to: string
}

export type StoreLogEvent = (name: string, fields: Record<string, unknown>) => void

export class ReadWriteMemory {
  #db: DatabaseSync
  /** store 层遥测（见文件头"遥测纪律"）。telemetry records, it does not gate。 */
  #log: StoreLogEvent

  readonly busyTimeoutMs: number

  constructor(dbPath: string, opts?: { logEvent?: StoreLogEvent }) {
    // 显式 rw：这是整个包唯一会以写模式打开 state 的入口。
    this.#log = opts?.logEvent ?? (() => {})
    this.#db = new DatabaseSync(dbPath)
    try {
      this.#db.exec('PRAGMA busy_timeout = 10000')
      this.#db.exec('PRAGMA foreign_keys = ON')
      const busy = this.#db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
      this.busyTimeoutMs = Number(busy?.timeout ?? 0)
      this.#assertSchemaVersion()
    } catch (err) {
      this.#db.close()
      throw err
    }
  }

  /**
   * 与只读入口同一道门：mind_schema != `EXPECTED_MIND_SCHEMA_VERSION`（现 17）
   * 拒开（不写不认识的 schema，更甚于不读）。
   */
  #assertSchemaVersion(): void {
    const version = readMindSchemaVersion(this.#db)
    if (version !== EXPECTED_MIND_SCHEMA_VERSION) {
      throw new Error(
        `lykoi-memory: mind_schema version ${String(version)} != expected `
        + `${EXPECTED_MIND_SCHEMA_VERSION}; refuse to open for writing (WO-M0-STATE-CONTRACT §1.0)`,
      )
    }
  }

  #tx<T>(fn: () => T): T {
    if (this.#db.isTransaction) {
      throw new Error('lykoi-memory: nested transaction (C-02 short-transaction discipline)')
    }
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.#db.exec('COMMIT')
      return out
    } catch (err) {
      if (this.#db.isTransaction) this.#db.exec('ROLLBACK')
      throw err
    }
  }

  recordExperience(
    source: ExperienceSource,
    content: string,
    opts: {
      reference?: string
      salience?: number
      relatedConcernId?: number | null
      /**
       * 认识论第二轴的**显式覆盖**（设计稿 §3.1）：缺省由渠道推导
       * （`deriveEpistemic`）。虚构地位（`imagined|simulated`）只能从这里来。
       */
      epistemic?: EpistemicStance
      /** `conversation` 渠道的消息方向；非 conversation 渠道忽略。 */
      conversationDirection?: ConversationDirection
      now: Date
    },
  ): number {
    if (typeof content !== 'string' || content.length === 0) {
      throw new TypeError('lykoi-memory: experience content must be a non-empty string')
    }
    const salience = opts.salience ?? 0.5
    const epistemic = opts.epistemic ?? deriveEpistemic(source, opts.conversationDirection)
    const ts = formatPyIso(opts.now)
    let pending = 0
    const experienceId = this.#tx(() => {
      if (opts.reference) {
        this.#db.exec('CREATE TABLE IF NOT EXISTS experience_references (reference TEXT PRIMARY KEY, experience_id INTEGER NOT NULL REFERENCES experiences(id))')
        const existing = this.#db.prepare('SELECT experience_id FROM experience_references WHERE reference=?').get(opts.reference)
        if (existing) return Number(existing.experience_id)
      }
      const info = this.#db.prepare(
        `INSERT INTO experiences (ts, source, content, salience, related_concern_id, epistemic)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(ts, source, content, salience, opts.relatedConcernId ?? null, epistemic)
      const id = Number(info.lastInsertRowid)
      if (opts.reference) this.#db.prepare('INSERT INTO experience_references VALUES(?,?)').run(opts.reference, id)
      this.#recordClassInTx(id, source, content, ts)
      pending = this.#syncPendingInTx()
      return id
    })

    this.#log('mind_experience', { id: experienceId, source, salience, pending })
    return experienceId
  }

  #recordClassInTx(experienceId: number, source: string, content: string | null, classifiedAt: string): void {
    this.#db.prepare(
      'INSERT OR IGNORE INTO experience_class '
      + '(experience_id, class, classified_at, rule_version) VALUES (?,?,?,?)',
    ).run(experienceId, classifyExperience(source, content), classifiedAt, RULE_VERSION)
  }

  #syncPendingInTx(): number {
    const row = this.#db.prepare(
      "SELECT COUNT(*) AS n FROM experiences WHERE integrated = 0 AND source <> 'environment'",
    ).get() as { n: number }
    this.#db.prepare(
      'UPDATE integration_state SET experiences_pending = ? WHERE id = 1',
    ).run(row.n)
    return Number(row.n)
  }

  applyRegulationCause(cause: string, opts: { now: Date }): RegulationCauseResult {
    const entry = CAUSES[cause]
    if (!entry) {
      throw new Error(`lykoi-memory: unknown regulation cause '${cause}' (SA-75: delta 只从 CAUSES 查)`)
    }
    const [name, delta] = entry
    const ts = formatPyIso(opts.now)
    const result = this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT value, updated_at FROM regulation_field WHERE name = ?',
      ).get(name) as { value: number; updated_at: string } | undefined
      if (!row) {
        throw new Error(`lykoi-memory: regulation_field row '${name}' missing (schema violation)`)
      }
      const hours = (opts.now.getTime() - parseStateTimestamp(row.updated_at).getTime()) / 3_600_000
      const decayed = decayValue(name, row.value, hours)
      const after = applyDeltaValue(decayed, delta)
      this.#db.prepare(
        'UPDATE regulation_field SET value = ?, updated_at = ? WHERE name = ?',
      ).run(after, ts, name)
      this.#db.prepare(
        'INSERT INTO regulation_events (ts, name, delta, value_after, cause) VALUES (?, ?, ?, ?, ?)',
      ).run(ts, name, delta, after, cause)
      return { cause, name, delta, valueBefore: decayed, valueAfter: after, ts }
    })

    this.#log('mind_regulation', {
      name, cause, delta, value_after: Number(result.valueAfter.toFixed(4)),
    })
    return result
  }

  /**
   * 调节场懒衰减读（§4.3：读时从 updated_at 计算，纯读不落账；
   * 落账只发生在 applyRegulationCause 的读改写里）。
   */
  getRegulation(opts: { now: Date }): Record<RegulationVariableName, number> {
    const rows = this.#db.prepare(
      'SELECT name, value, updated_at FROM regulation_field',
    ).all() as { name: RegulationVariableName; value: number; updated_at: string }[]
    const out = {} as Record<RegulationVariableName, number>
    for (const row of rows) {
      const hours = (opts.now.getTime() - parseStateTimestamp(row.updated_at).getTime()) / 3_600_000
      out[row.name] = decayValue(row.name, row.value, hours)
    }
    return out
  }

  /** regulation_field 原始四行（同只读入口口径；供装配/测试断言）。 */
  regulationField(): RegulationFieldRow[] {
    return regulationField(this.#db)
  }

  /**
   * 最近调节事件（mind/store.recent_regulation_events 对应物：ORDER BY id DESC，
   * 新的在前 —— 快照 recent_causes 的呈现序即此序）。name=null 时全量表尾。
   */
  recentRegulationEvents(name: string | null, n: number): RegulationEventRow[] {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = (name === null
      ? this.#db.prepare(
        'SELECT id, ts, name, delta, value_after, cause FROM regulation_events ORDER BY id DESC LIMIT ?',
      ).all(n)
      : this.#db.prepare(
        'SELECT id, ts, name, delta, value_after, cause FROM regulation_events WHERE name = ? '
        + 'ORDER BY id DESC LIMIT ?',
      ).all(name, n)) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      name: r.name as string,
      delta: r.delta as number,
      valueAfter: r.value_after as number,
      cause: r.cause as string,
    }))
  }

  /**
   * 指定因集合中最新事件的 ts（mind/store.last_cause_event_ts 对应物：
   * SELECT MAX(ts)；append-only 事件账本兼作耐重启的去重标记）。空集合 → null。
   */
  lastCauseEventTs(causes: readonly string[]): string | null {
    if (causes.length === 0) return null
    const marks = causes.map(() => '?').join(',')
    const row = this.#db.prepare(
      `SELECT MAX(ts) AS ts FROM regulation_events WHERE cause IN (${marks})`,
    ).get(...causes) as { ts: string | null } | undefined
    return row?.ts ?? null
  }

  listConcerns(status?: string | readonly string[]): ConcernRow[] {
    let rows: Record<string, unknown>[]
    if (status === undefined) {
      rows = this.#db.prepare(
        'SELECT * FROM concerns ORDER BY weight DESC, id',
      ).all() as Record<string, unknown>[]
    } else {
      const statuses = typeof status === 'string' ? [status] : [...status]
      const marks = statuses.map(() => '?').join(',')
      rows = this.#db.prepare(
        `SELECT * FROM concerns WHERE status IN (${marks}) ORDER BY weight DESC, id`,
      ).all(...statuses) as Record<string, unknown>[]
    }
    return rows.map((r) => ({
      id: r.id as number,
      kind: r.kind as string,
      title: r.title as string,
      description: r.description as string,
      weight: r.weight as number,
      origin: r.origin as string,
      parentId: (r.parent_id ?? null) as number | null,
      status: r.status as string,
      createdAt: r.created_at as string,
      lastLitAt: (r.last_lit_at ?? null) as string | null,
      litCount: r.lit_count as number,
    }))
  }

  createConcern(
    kind: string,
    title: string,
    opts: {
      weight: number
      origin: string
      description?: string
      parentId?: number | null
      now: Date
    },
  ): number {
    if (!(CONCERN_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`unknown concern kind: '${kind}'`)
    }
    if (!(CONCERN_ORIGINS as readonly string[]).includes(opts.origin)) {
      throw new Error(`unknown concern origin: '${opts.origin}'`)
    }
    if (!title.trim()) {
      throw new Error('concern title must be non-empty')
    }
    if (!(opts.weight >= 0.0 && opts.weight <= 1.0)) {
      throw new Error('concern weight must be in [0,1]')
    }
    const ts = formatPyIso(opts.now)
    const concernId = this.#tx(() => {
      const active = this.#db.prepare(
        "SELECT COUNT(*) AS n FROM concerns WHERE status = 'active'",
      ).get() as { n: number }
      if (active.n >= ACTIVE_CONCERN_CAP) {
        throw new ConcernCapError(
          `active concerns at cap (${ACTIVE_CONCERN_CAP}); release one first — 取舍即生命`,
        )
      }
      const info = this.#db.prepare(
        `INSERT INTO concerns (kind, title, description, weight, origin, parent_id, status, created_at)
         VALUES (?,?,?,?,?,?, 'active', ?)`,
      ).run(kind, title, opts.description ?? '', opts.weight, opts.origin, opts.parentId ?? null, ts)
      return Number(info.lastInsertRowid)
    })
    this.#log('mind_concern_created', { id: concernId, kind, title, origin: opts.origin })
    return concernId
  }

  markDimmingDormant(opts: { now: Date }): ConcernTransition[] {
    const changes: ConcernTransition[] = []
    this.#tx(() => {
      const rows = this.#db.prepare(
        `SELECT id, status, COALESCE(last_lit_at, created_at) AS ref_ts
           FROM concerns WHERE status IN ('active', 'dimming')`,
      ).all() as { id: number; status: string; ref_ts: string }[]
      for (const row of rows) {
        const days
          = (opts.now.getTime() - parseStateTimestamp(row.ref_ts).getTime()) / 86_400_000
        let target: string | null = null
        if (days > DORMANT_AFTER_DAYS) {
          target = 'dormant'
        } else if (days > DIMMING_AFTER_DAYS && row.status === 'active') {
          target = 'dimming'
        }
        if (target && target !== row.status) {
          this.#db.prepare('UPDATE concerns SET status = ? WHERE id = ?').run(target, row.id)
          changes.push({ id: row.id, from: row.status, to: target })
        }
      }
    })
    return changes
  }

  lightConcern(
    concernId: number,
    opts: { weightDelta?: number; now: Date },
  ): { id: number; weight: number; status: string } {
    const delta = opts.weightDelta ?? CONCERN_LIT_WEIGHT_DELTA
    const ts = formatPyIso(opts.now)
    const lit = this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT status, weight FROM concerns WHERE id = ?',
      ).get(concernId) as { status: string; weight: number } | undefined
      if (!row) {
        throw new ValueError(`no concern ${concernId}`)
      }
      if (row.status === 'released') {
        throw new ValueError(`concern ${concernId} is released; code must not relight it`)
      }
      const newWeight = clamp01(row.weight + delta)
      let newStatus = row.status
      if (row.status === 'dimming' || row.status === 'dormant') {
        const active = this.#db.prepare(
          "SELECT COUNT(*) AS n FROM concerns WHERE status = 'active'",
        ).get() as { n: number }
        if (active.n < ACTIVE_CONCERN_CAP) newStatus = 'active'
      }
      this.#db.prepare(
        `UPDATE concerns SET weight = ?, status = ?, last_lit_at = ?, lit_count = lit_count + 1
         WHERE id = ?`,
      ).run(newWeight, newStatus, ts, concernId)
      return { id: concernId, weight: newWeight, status: newStatus }
    })
    this.#log('mind_concern_lit', {
      id: concernId, weight: Number(lit.weight.toFixed(4)), status: lit.status,
    })
    return lit
  }

  /**
   * tend_inner 的关切形式（mind/store.tend_concern_description 对应物，蓝图 §4.2）：
   * 只改 description —— weight/status/last_lit_at 一概不动（点亮是意义评估的路，
   * 释放是她的）。released 不可照料（红线 #3 的照料侧）；空描述/不存在抛
   * ValueError。
   */
  tendConcernDescription(concernId: number, description: string, opts: { now: Date }): void {
    if (!description.trim()) {
      throw new ValueError('concern description must be non-empty')
    }
    this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT status FROM concerns WHERE id = ?',
      ).get(concernId) as { status: string } | undefined
      if (!row) {
        throw new ValueError(`no concern ${concernId}`)
      }
      if (row.status === 'released') {
        throw new ValueError(`concern ${concernId} is released; tending it is not the code's call`)
      }
      this.#db.prepare('UPDATE concerns SET description = ? WHERE id = ?')
        .run(description, concernId)
    })
  }

  currentCognitiveNarrative(): NarrativeVersionRow | undefined {
    const row = this.#db.prepare(
      "SELECT * FROM narrative_versions WHERE narrative_class IS NOT 'narrative_only' "
      + 'ORDER BY id DESC LIMIT 1',
    ).get() as Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      id: row.id as number,
      createdAt: row.created_at as string,
      content: row.content as string,
      changeSummary: row.change_summary as string,
      trigger: row.trigger as string,
      narrativeClass: (row.narrative_class ?? null) as string | null,
    }
  }

  /** 叙事线列表（mind/store.list_threads 对应物：ORDER BY id）。 */
  listThreads(status?: string | readonly string[]): ThreadRow[] {
    let rows: Record<string, unknown>[]
    if (status === undefined) {
      rows = this.#db.prepare('SELECT * FROM narrative_threads ORDER BY id')
        .all() as Record<string, unknown>[]
    } else {
      const statuses = typeof status === 'string' ? [status] : [...status]
      const marks = statuses.map(() => '?').join(',')
      rows = this.#db.prepare(
        `SELECT * FROM narrative_threads WHERE status IN (${marks}) ORDER BY id`,
      ).all(...statuses) as Record<string, unknown>[]
    }
    return rows.map((r) => this.#threadRow(r))
  }

  /**
   * tend_inner 的叙事线形式（mind/store.append_thread_progress 对应物，蓝图 §4.2）：
   * 给一条 open/suspended 线追加一句带日期的进展。刷新 updated_at 正是要点 ——
   * 面对一条悬置张力本身就是照料，会重置 30 天超龄时钟（§3.3）。closed 线
   * （resolved/absorbed）已携带告别，不得在此重开；拒绝抛 ValueError。
   * 拼接形态逐字：`{旧 content}\n[{YYYY-MM-DD}] {line.strip()}`。
   */
  appendThreadProgress(threadId: number, line: string, opts: { now: Date }): void {
    if (!line.trim()) {
      throw new ValueError('thread progress line must be non-empty')
    }
    const ts = formatPyIso(opts.now)
    const day = ts.slice(0, 10) // moment.date().isoformat()（tz-aware UTC 的日期部分）
    this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT status, content FROM narrative_threads WHERE id = ?',
      ).get(threadId) as { status: string; content: string } | undefined
      if (!row) {
        throw new ValueError(`no thread ${threadId}`)
      }
      if (row.status !== 'open' && row.status !== 'suspended') {
        throw new ValueError(`thread ${threadId} is ${row.status}; only open/suspended can be tended`)
      }
      const content = `${row.content}\n[${day}] ${line.trim()}`
      this.#db.prepare(
        'UPDATE narrative_threads SET content = ?, updated_at = ? WHERE id = ?',
      ).run(content, ts, threadId)
    })
  }

  #threadRow(r: Record<string, unknown>): ThreadRow {
    return {
      id: r.id as number,
      kind: r.kind as string,
      content: r.content as string,
      status: r.status as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
      resolution: (r.resolution ?? null) as string | null,
    }
  }

  /**
   * 悬置超龄线（mind/store.overdue_suspended_threads 对应物：suspended 且
   * updated_at 距今超 days 天；过滤在代码侧按解析后的时钟差算，不做字符串比较）。
   */
  overdueSuspendedThreads(opts: { now: Date; days?: number }): ThreadRow[] {
    const days = opts.days ?? SUSPENDED_OVERDUE_DAYS
    const rows = this.#db.prepare(
      "SELECT * FROM narrative_threads WHERE status = 'suspended' ORDER BY id",
    ).all() as Record<string, unknown>[]
    return rows
      .filter((r) => (opts.now.getTime()
        - parseStateTimestamp(r.updated_at as string).getTime()) / 86_400_000 > days)
      .map((r) => this.#threadRow(r))
  }

  countPendingExperiences(): number {
    const row = this.#db.prepare(
      "SELECT COUNT(*) AS n FROM experiences WHERE integrated = 0 AND source <> 'environment'",
    ).get() as { n: number }
    return row.n
  }

  latestExperienceTs(source: ExperienceSource): string | null {
    const known: readonly string[] = [
      'conversation', 'wake_action', 'action_result', 'silence',
      'owner_event', 'system', 'thought_lapse', 'environment',
    ]
    if (!known.includes(source)) {
      throw new ValueError(`unknown experience source: '${String(source)}'`)
    }
    const row = this.#db.prepare(
      'SELECT MAX(ts) AS ts FROM experiences WHERE source = ?',
    ).get(source) as { ts: string | null } | undefined
    return row?.ts ?? null
  }

  recentExperiences(n: number): ExperienceRow[] {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = this.#db.prepare(
      `SELECT id, ts, source, content, salience, related_concern_id, integrated, integration_id,
              epistemic
         FROM experiences WHERE ${factualEpistemicClause('experiences')}
         ORDER BY id DESC LIMIT ?`,
    ).all(n) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      source: r.source as string,
      content: r.content as string,
      salience: r.salience as number,
      relatedConcernId: (r.related_concern_id ?? null) as number | null,
      integrated: r.integrated as number,
      integrationId: (r.integration_id ?? null) as number | null,
      epistemic: (r.epistemic ?? null) as EpistemicStance | null,
    }))
  }

  getThoughtsForSnapshot(topN: number): ThoughtRow[] {
    if (!Number.isInteger(topN) || topN < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = this.#db.prepare(
      `SELECT id, ts, content, kind, source, related_concern_id, source_ref, charge, status
         FROM thoughts WHERE status = 'open' ORDER BY charge DESC, ts ASC, id ASC LIMIT ?`,
    ).all(topN) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      content: r.content as string,
      kind: r.kind as string,
      source: r.source as string,
      relatedConcernId: (r.related_concern_id ?? null) as number | null,
      sourceRef: (r.source_ref ?? null) as string | null,
      charge: r.charge as number,
      status: r.status as string,
    }))
  }

  overdueQuestions(opts: { now: Date }): ThoughtRow[] {
    const cutoff = formatPyIso(new Date(opts.now.getTime() - QUESTION_OVERDUE_HOURS * 3_600_000))
    const rows = this.#db.prepare(
      `SELECT id, ts, content, kind, source, related_concern_id, source_ref, charge, status
         FROM thoughts WHERE status = 'open' AND kind = 'question' AND ts < ? ORDER BY ts`,
    ).all(cutoff) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      content: r.content as string,
      kind: r.kind as string,
      source: r.source as string,
      relatedConcernId: (r.related_concern_id ?? null) as number | null,
      sourceRef: (r.source_ref ?? null) as string | null,
      charge: r.charge as number,
      status: r.status as string,
    }))
  }

  // ============================== history / insights（读侧） ==============================

  /**
   * 某 event_type 最近 N 条，**oldest-first**（memory/store.get_recent_history_of_type
   * 对应物：id DESC 取表尾后 reversed —— 节律采样 conversation_timestamps 依赖此序）。
   */
  getRecentHistoryOfType(eventType: string, n: number): HistoryRow[] {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = this.#db.prepare(
      'SELECT id, ts, event_type, content FROM history WHERE event_type = ? ORDER BY id DESC LIMIT ?',
    ).all(eventType, n) as Record<string, unknown>[]
    return rows.reverse().map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      eventType: r.event_type as string,
      content: r.content as string,
    }))
  }

  /**
   * insights 按类读取（memory/store.get_insights 对应物：ORDER BY id ——
   * persona 投影 _bullets 的行序即此序）。category=null → 全量。
   */
  getInsights(category: string | null): InsightRow[] {
    const rows = (category === null
      ? this.#db.prepare(
        'SELECT id, created, updated, category, content FROM insights ORDER BY id',
      ).all()
      : this.#db.prepare(
        'SELECT id, created, updated, category, content FROM insights WHERE category = ? ORDER BY id',
      ).all(category)) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      created: r.created as string,
      updated: r.updated as string,
      category: r.category as string,
      content: r.content as string,
    }))
  }

  ownerPrimaryUserId(): string | null {
    const row = this.#db.prepare(
      "SELECT id FROM users WHERE role = 'owner_primary' AND status = 'active' LIMIT 1",
    ).get() as { id: string } | undefined
    return row?.id ?? null
  }

  identityBindingInventory(): {
    channel: string
    user_id: string
    display_name: string | null
    role: string | null
  }[] {
    const rows = this.#db.prepare(
      `SELECT b.channel AS channel, b.user_id AS user_id,
              u.display_name AS display_name, u.role AS role
         FROM identity_bindings AS b
         LEFT JOIN users AS u ON u.id = b.user_id
        ORDER BY b.channel, b.user_id`,
    ).all() as Record<string, unknown>[]
    return rows.map((r) => ({
      channel: r.channel as string,
      user_id: r.user_id as string,
      display_name: (r.display_name ?? null) as string | null,
      role: (r.role ?? null) as string | null,
    }))
  }

  identityBindingUserId(channel: string, channelKey: string): string | null {
    const row = this.#db.prepare(
      'SELECT user_id FROM identity_bindings WHERE channel = ? AND channel_key = ?',
    ).get(channel, channelKey) as { user_id: string } | undefined
    return row?.user_id ?? null
  }

  ownerBinding(): { channel: string; channel_key: string } | null {
    const owner = this.ownerPrimaryUserId()
    if (!owner) return null
    return this.#db.prepare(
      'SELECT channel, channel_key FROM identity_bindings WHERE user_id = ? '
      + 'ORDER BY channel, channel_key LIMIT 1',
    ).get(owner) as { channel: string; channel_key: string } | undefined ?? null
  }

  ownerChannelKey(channel: string): string | null {
    const owner = this.ownerPrimaryUserId()
    if (!owner) return null
    const row = this.#db.prepare(
      'SELECT channel_key FROM identity_bindings WHERE channel = ? AND user_id = ? '
      + 'ORDER BY channel_key LIMIT 1',
    ).get(channel, owner) as { channel_key: string } | undefined
    return row?.channel_key ?? null
  }

  createThought(
    content: string,
    kind: ThoughtKind,
    source: ThoughtSource,
    opts: { relatedConcernId?: number | null; sourceRef?: string | null; chargeHint?: number; now: Date },
  ): number | null {
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error('lykoi-memory: thought content must be a non-empty string')
    }
    if ([...content].length > 200) {
      throw new Error('lykoi-memory: thought content exceeds 200 chars (schema CHECK)')
    }
    if (!THOUGHT_KINDS.includes(kind)) {
      throw new Error(`lykoi-memory: invalid thought kind '${String(kind)}'`)
    }
    if (!THOUGHT_SOURCES.includes(source)) {
      throw new Error(`lykoi-memory: invalid thought source '${String(source)}'`)
    }
    const charge = clamp01(opts.chargeHint ?? 0.5)
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
      const open = this.#db.prepare(
        "SELECT COUNT(*) AS n FROM thoughts WHERE status = 'open'",
      ).get() as { n: number }
      if (open.n >= THOUGHT_OPEN_CAP) {

        const lowest = this.#db.prepare(
          "SELECT id, content, charge FROM thoughts WHERE status = 'open' "
          + 'ORDER BY charge ASC, ts ASC, id ASC LIMIT 1',
        ).get() as { id: number; content: string; charge: number }
        if (!(charge > lowest.charge)) return null // 软拒：不严格大于最低者即拒
        this.#abandonInTx(lowest.id, lowest.content, 'capacity_displacement', ts)
      }
      const info = this.#db.prepare(
        `INSERT INTO thoughts (ts, content, kind, source, related_concern_id, source_ref, charge)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(ts, content, kind, source, opts.relatedConcernId ?? null, opts.sourceRef ?? null, charge)
      return Number(info.lastInsertRowid)
    })
  }

  #abandonInTx(thoughtId: number, summary: string, reason: string, ts: string): void {
    this.#db.prepare("UPDATE thoughts SET status = 'abandoned' WHERE id = ?").run(thoughtId)
    const cps = [...summary]
    const clipped = cps.length <= 100 ? summary : cps.slice(0, 100).join('') + '…'
    this.#db.prepare(
      `INSERT INTO experiences (ts, source, content, salience, epistemic)
       VALUES (?, 'thought_lapse', ?, ?, ?)`,
    ).run(
      ts,
      `放掉了一个没想完的念头:${clipped} (${reason})`,
      THOUGHT_LAPSE_SALIENCE,
      // 第二轴走同一张映射表：thought_lapse → inferred（"我放掉了它"是从
      // charge 落到阈下推出来的，不是观察到的外部事实）。
      deriveEpistemic('thought_lapse'),
    )
  }

  resolveThought(id: number, injectedIds: Iterable<number>): boolean {
    if (!Number.isInteger(id)) return false
    const allowed = injectedIds instanceof Set ? injectedIds : new Set(injectedIds)
    if (!allowed.has(id)) {
      this.#log('thought_resolve_rejected', { id, reason: 'not_in_injected_set' })
      return false
    }
    const outcome = this.#tx(() => {
      const row = this.#db.prepare('SELECT status FROM thoughts WHERE id = ?').get(id) as
        | { status: string }
        | undefined
      if (!row || row.status !== 'open') {
        return row ? 'not_open' : 'not_found'
      }
      this.#db.prepare("UPDATE thoughts SET status = 'resolved' WHERE id = ?").run(id)
      return 'resolved'
    })
    if (outcome !== 'resolved') {
      this.#log('thought_resolve_rejected', { id, reason: outcome })
      return false
    }
    this.#log('thought_resolved', { id })
    return true
  }

  decayAllOpenThoughts(opts: { now: Date }): DecayThoughtsResult {
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
      const rows = this.#db.prepare(
        "SELECT id, content, charge FROM thoughts WHERE status = 'open' ORDER BY id",
      ).all() as { id: number; content: string; charge: number }[]
      const lapsed: number[] = []
      let decayed = 0
      for (const row of rows) {
        const next = decayCharge(row.charge, 1)
        if (next < ABANDON_THRESHOLD) {
          this.#abandonInTx(row.id, row.content, 'decay', ts)
          lapsed.push(row.id)
        } else {
          this.#db.prepare('UPDATE thoughts SET charge = ? WHERE id = ?').run(next, row.id)
          decayed += 1
        }
      }
      return { decayed, lapsed }
    })
  }

  settleThought(id: number, integrationId: number): void {
    if (!Number.isInteger(integrationId)) {
      throw new Error('lykoi-memory: settleThought requires an integer integration_id (SA-176)')
    }
    this.#tx(() => {
      const info = this.#db.prepare(
        "UPDATE thoughts SET status = 'absorbed', resolved_by_integration_id = ? "
        + "WHERE id = ? AND status = 'resolved'",
      ).run(integrationId, id)
      if (Number(info.changes) !== 1) {
        throw new Error('lykoi-memory: settleThought only moves resolved→absorbed (SA-176)')
      }
    })
    this.#log('thought_settled', { id, integration_id: integrationId })
  }

  /** 归档：resolved/abandoned→archived（状态机仅有的两条入 archived 边）。 */
  archiveThought(id: number): void {
    this.#tx(() => {
      const info = this.#db.prepare(
        "UPDATE thoughts SET status = 'archived' WHERE id = ? AND status IN ('resolved','abandoned')",
      ).run(id)
      if (Number(info.changes) !== 1) {
        throw new Error('lykoi-memory: archiveThought only moves resolved/abandoned→archived')
      }
    })
    this.#log('thought_archived', { id })
  }

  /** open 念头（写层调用方 / 测试断言用；与只读入口同口径）。 */
  openThoughts(): ThoughtRow[] {
    return openThoughts(this.#db)
  }

  appendHistory(eventType: string, content: string, opts: { now: Date }): number {
    if (typeof eventType !== 'string' || eventType.length === 0) {
      throw new TypeError('lykoi-memory: history event_type must be a non-empty string')
    }
    return this.#tx(() => {
      const info = this.#db.prepare(
        'INSERT INTO history (ts, event_type, content) VALUES (?, ?, ?)',
      ).run(formatPyIso(opts.now), eventType, content)
      return Number(info.lastInsertRowid)
    })
  }

  // ============================== autonomy_state / autonomy_runs ==============================

  autonomyState(): AutonomyStateRow | undefined {
    return autonomyState(this.#db)
  }

  setAutonomyNextWake(nextWakeAt: Date, opts: { now: Date }): void {
    const next = formatPyIso(nextWakeAt)
    const updated = formatPyIso(opts.now)
    this.#tx(() => {
      const exists = this.#db.prepare('SELECT 1 AS x FROM autonomy_state WHERE id = 1').get()
      if (exists) {
        this.#db.prepare(
          'UPDATE autonomy_state SET next_wake_at = ?, updated_at = ? WHERE id = 1',
        ).run(next, updated)
      } else {
        this.#db.prepare(
          'INSERT INTO autonomy_state (id, next_wake_at, last_wake_at, updated_at) VALUES (1, ?, NULL, ?)',
        ).run(next, updated)
      }
    })
  }

  /** last_wake_at 落账；行不存在即抛（next_wake_at NOT NULL，无法凭空补行）。 */
  setAutonomyLastWake(lastWakeAt: Date, opts: { now: Date }): void {
    this.#tx(() => {
      const info = this.#db.prepare(
        'UPDATE autonomy_state SET last_wake_at = ?, updated_at = ? WHERE id = 1',
      ).run(formatPyIso(lastWakeAt), formatPyIso(opts.now))
      if (Number(info.changes) !== 1) {
        throw new Error('lykoi-memory: autonomy_state row missing (set next wake first)')
      }
    })
  }

  /** 每次唤醒一行：status='running' 起账（计数三列走 DDL DEFAULT 0）。 */
  startAutonomyRun(id: string, opts: { startedAt: Date }): void {
    if (typeof id !== 'string' || id.length === 0) {
      throw new TypeError('lykoi-memory: autonomy run id must be a non-empty string')
    }
    this.#tx(() => {
      this.#db.prepare(
        "INSERT INTO autonomy_runs (id, started_at, status) VALUES (?, ?, 'running')",
      ).run(id, formatPyIso(opts.startedAt))
    })
  }

  /** 收账：running → completed/failed/stale（枚举无 CHECK —— C 契约注明，纪律在 API 层）。 */
  finishAutonomyRun(id: string, opts: FinishAutonomyRunOptions): void {
    if (!RUN_STATUSES.includes(opts.status)) {
      throw new Error(`lykoi-memory: invalid autonomy run status '${String(opts.status)}'`)
    }
    this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE autonomy_runs SET
           finished_at = ?, status = ?, decision = ?, next_wake_at = ?,
           action_count = COALESCE(?, action_count),
           external_read_count = COALESCE(?, external_read_count),
           notification_count = COALESCE(?, notification_count)
         WHERE id = ?`,
      ).run(
        formatPyIso(opts.finishedAt),
        opts.status,
        opts.decision ?? null,
        opts.nextWakeAt ? formatPyIso(opts.nextWakeAt) : null,
        opts.actionCount ?? null,
        opts.externalReadCount ?? null,
        opts.notificationCount ?? null,
        id,
      )
      if (Number(info.changes) !== 1) {
        throw new Error('lykoi-memory: finishAutonomyRun found no such run row')
      }
    })
  }

  /**
   * 自主笔记 append（memory/store.append_autonomy_note 对应物，append-only 由
   * 库层双触发器保证）。自主环只写 notes，**从不**直写 insights —— 晋升是
   * 整合期的受治理动作（W4 integrator）。kind 注释级枚举
   * observation|reflection|question（无 CHECK，纪律在调用方）。
   */
  appendAutonomyNote(
    autonomyRunId: string,
    kind: string,
    content: string,
    opts: { confidence?: number | null; sourceType?: string | null; sourceUrls?: readonly string[] | null; now: Date },
  ): number {
    if (typeof autonomyRunId !== 'string' || autonomyRunId.length === 0) {
      throw new TypeError('lykoi-memory: autonomy note run id must be a non-empty string')
    }
    return this.#tx(() => {
      const info = this.#db.prepare(
        `INSERT INTO autonomy_notes
           (created_at, autonomy_run_id, kind, content, confidence, source_type, source_urls_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        formatPyIso(opts.now),
        autonomyRunId,
        kind,
        content,
        opts.confidence ?? null,
        opts.sourceType ?? null,
        opts.sourceUrls && opts.sourceUrls.length > 0 ? JSON.stringify(opts.sourceUrls) : null,
      )
      return Number(info.lastInsertRowid)
    })
  }

  /**
   * 每次 wake +1（mind/store.bump_wakes_since 对应物）：同一次心跳把
   * integration_state.wakes_since 与 learning_layer_state['l4_focus_wakes_since']
   * **都 +1**（整合与专注思考是同一条节律上的两台机器；清零点不同 —— 层 1 由
   * reset_integration_cycle 在"确实做了事"后清零，层 2 每周期后清零，W4 接）。
   * 返回层 1 计数。
   */
  bumpWakesSince(opts: { now: Date }): number {
    return this.#tx(() => {
      this.#db.prepare(
        'UPDATE integration_state SET wakes_since = wakes_since + 1 WHERE id = 1',
      ).run()
      const row = this.#db.prepare(
        'SELECT wakes_since AS n FROM integration_state WHERE id = 1',
      ).get() as { n: number } | undefined
      if (!row) {
        throw new Error('lykoi-memory: integration_state row missing (schema violation)')
      }
      this.#db.prepare(
        `INSERT INTO learning_layer_state (key, value, set_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET value = value + 1, set_at = excluded.set_at`,
      ).run('l4_focus_wakes_since', formatPyIso(opts.now))
      return Number(row.n)
    })
  }

  autonomyActionsLastHour(opts: { now: Date }): number {
    const cutoff = formatPyIso(new Date(opts.now.getTime() - 3_600_000))
    const row = this.#db.prepare(
      'SELECT COALESCE(SUM(action_count), 0) AS n FROM autonomy_runs WHERE started_at >= ?',
    ).get(cutoff) as { n: number }
    return Number(row.n)
  }

  getAutonomyRuns(limit: number): AutonomyRunRow[] {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = this.#db.prepare(
      `SELECT id, started_at, finished_at, status, decision, next_wake_at,
              action_count, external_read_count, notification_count
         FROM autonomy_runs ORDER BY started_at DESC LIMIT ?`,
    ).all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as string,
      startedAt: r.started_at as string,
      finishedAt: (r.finished_at ?? null) as string | null,
      status: r.status as string,
      decision: (r.decision ?? null) as string | null,
      nextWakeAt: (r.next_wake_at ?? null) as string | null,
      actionCount: (r.action_count ?? null) as number | null,
      externalReadCount: (r.external_read_count ?? null) as number | null,
      notificationCount: (r.notification_count ?? null) as number | null,
    }))
  }

  getLearningLayerState(key: string): number | null {
    const row = this.#db.prepare(
      'SELECT value FROM learning_layer_state WHERE key = ?',
    ).get(key) as { value: number } | undefined
    return row ? Number(row.value) : null
  }

  getIntakeWatermarkId(): number {
    return this.getLearningLayerState(L2_INTAKE_WATERMARK_KEY) ?? 0
  }

  intakePending(limit: number | null, bySalience: boolean): RawRow[] {
    if (limit !== null && limit < 0) {
      throw new ValueError('limit must be >= 0')
    }
    const order = bySalience ? 'e.salience DESC, e.id ASC' : 'e.id ASC'
    const floor = this.getIntakeWatermarkId()
    const sql = `SELECT e.* FROM experiences AS e
                   JOIN experience_class AS ec ON ec.experience_id = e.id
                   WHERE ${INTAKE_CLAUSE}
                   ORDER BY ${order}`
    const rows = (limit === null
      ? this.#db.prepare(sql).all(floor)
      : this.#db.prepare(sql + ' LIMIT ?').all(floor, limit)) as RawRow[]
    return rows
  }

  countIntakePending(): number {
    const floor = this.getIntakeWatermarkId()
    const row = this.#db.prepare(
      `SELECT COUNT(*) AS n FROM experiences AS e
         JOIN experience_class AS ec ON ec.experience_id = e.id
         WHERE ${INTAKE_CLAUSE}`,
    ).get(floor) as { n: number }
    return Number(row.n)
  }

  getIntegrationState(): RawRow {
    const row = this.#db.prepare('SELECT * FROM integration_state WHERE id = 1').get() as
      | RawRow
      | undefined
    if (!row) {
      throw new Error('lykoi-memory: integration_state row missing (schema violation)')
    }
    return row
  }

  markExperiencesIntegrated(ids: readonly number[], integrationId: number, opts: { now: Date }): number {
    if (ids.length === 0) return 0
    let pending = 0
    const changed = this.#tx(() => {
      const marks = ids.map(() => '?').join(',')
      const info = this.#db.prepare(
        `UPDATE experiences SET integrated = 1, integration_id = ? WHERE id IN (${marks}) AND integrated = 0`,
      ).run(integrationId, ...ids)
      pending = this.#syncPendingInTx()
      return Number(info.changes)
    })
    this.#log('mind_experiences_integrated', {
      count: changed, integration_id: integrationId, pending,
    })
    return changed
  }

  resetIntegrationCycle(opts: { now: Date }): void {
    this.#tx(() => {
      this.#db.prepare(
        'UPDATE integration_state SET last_integration_at = ?, wakes_since = 0 WHERE id = 1',
      ).run(formatPyIso(opts.now))
      this.#syncPendingInTx()
    })
    this.#log('mind_integration_cycle_reset', {})
  }

  releaseConcern(concernId: number, reason: string, opts: { now: Date; viaOwner?: boolean }): void {
    if (!reason.trim()) {
      throw new ValueError('release requires a reason (release_reason)')
    }
    const moment = formatPyIso(opts.now)
    this.#tx(() => {
      const row = this.#db.prepare('SELECT status FROM concerns WHERE id = ?').get(concernId) as
        | { status: string }
        | undefined
      if (!row) {
        throw new ValueError(`no concern ${concernId}`)
      }
      if (row.status === 'released') {
        throw new ValueError(`concern ${concernId} already released`)
      }
      if (!opts.viaOwner && row.status !== 'dormant') {
        this.#log('release_rejected_non_dormant', {
          concern_id: concernId, status: row.status, reason,
        })
        throw new ReleaseCandidacyError(
          `concern ${concernId} is '${row.status}', not 'dormant'; only dormant `
          + `concerns are release candidates (红线 #3) — use viaOwner for owner console`,
        )
      }
      this.#db.prepare(
        "UPDATE concerns SET status = 'released', released_at = ?, release_reason = ? WHERE id = ?",
      ).run(moment, reason, concernId)
    })
    this.#log('mind_concern_released', { id: concernId, reason })
  }

  getConcern(concernId: number): RawRow | null {
    const row = this.#db.prepare('SELECT * FROM concerns WHERE id = ?').get(concernId) as
      | RawRow
      | undefined
    return row ?? null
  }

  addNarrativeVersion(opts: {
    content: string
    changeSummary: string
    trigger: string
    now: Date
    narrativeClass?: string | null
    acceptedOps?: number | null
    expOps?: number | null
  }): number | null {
    const narrativeClass = opts.narrativeClass ?? null
    const acceptedOps = opts.acceptedOps ?? null
    if (!NARRATIVE_TRIGGERS.includes(opts.trigger)) {
      throw new ValueError(`unknown narrative trigger: '${opts.trigger}'`)
    }
    if (narrativeClass !== null && !NARRATIVE_CLASSES.includes(narrativeClass)) {
      throw new ValueError(`unknown narrative class: '${narrativeClass}'`)
    }
    if (!opts.content.trim() || !opts.changeSummary.trim()) {
      throw new ValueError('narrative content and change_summary must be non-empty')
    }
    if (acceptedOps !== null) {
      if (narrativeClass === 'absorption' && (opts.expOps ?? 0) <= 0) {
        this.#log('narrative_write_rejected_absorb_lie', {
          trigger: opts.trigger, accepted_ops: acceptedOps, exp_ops: opts.expOps ?? 0,
        })
        return null
      }
      if (acceptedOps <= 0) {
        this.#log('narrative_write_skipped_strict_empty', {
          trigger: opts.trigger, narrative_class: narrativeClass,
        })
        return null
      }
    }
    const versionId = this.#tx(() => {
      const info = this.#db.prepare(
        'INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class) '
        + 'VALUES (?,?,?,?,?)',
      ).run(formatPyIso(opts.now), opts.content, opts.changeSummary, opts.trigger, narrativeClass)
      return Number(info.lastInsertRowid)
    })
    this.#log('mind_narrative_version', { id: versionId, trigger: opts.trigger })
    return versionId
  }

  createThread(kind: string, content: string, opts: { now: Date }): number {
    if (!THREAD_KIND_ENUM.includes(kind)) {
      throw new ValueError(`unknown thread kind: '${kind}'`)
    }
    if (!content.trim()) {
      throw new ValueError('thread content must be non-empty')
    }
    const moment = formatPyIso(opts.now)
    const threadId = this.#tx(() => {
      const info = this.#db.prepare(
        "INSERT INTO narrative_threads (kind, content, status, created_at, updated_at) VALUES (?,?,'open',?,?)",
      ).run(kind, content, moment, moment)
      return Number(info.lastInsertRowid)
    })
    this.#log('mind_thread_created', { id: threadId, kind })
    return threadId
  }

  updateThread(
    threadId: number,
    opts: { status?: string | null; content?: string | null; resolution?: string | null; now: Date },
  ): void {
    const status = opts.status ?? null
    if (status !== null && !THREAD_STATUS_ENUM.includes(status)) {
      throw new ValueError(`unknown thread status: '${status}'`)
    }
    if ((status === 'resolved' || status === 'absorbed') && !(opts.resolution ?? '').trim()) {
      throw new ValueError(`closing a thread as ${status} requires a resolution`)
    }
    this.#tx(() => {
      const row = this.#db.prepare('SELECT id FROM narrative_threads WHERE id = ?').get(threadId)
      if (!row) {
        throw new ValueError(`no thread ${threadId}`)
      }
      const sets = ['updated_at = ?']
      const params: (string | number)[] = [formatPyIso(opts.now)]
      if (status !== null) {
        sets.push('status = ?')
        params.push(status)
      }
      if (opts.content !== undefined && opts.content !== null) {
        sets.push('content = ?')
        params.push(opts.content)
      }
      if (opts.resolution !== undefined && opts.resolution !== null) {
        sets.push('resolution = ?')
        params.push(opts.resolution)
      }
      params.push(threadId)
      this.#db.prepare(`UPDATE narrative_threads SET ${sets.join(', ')} WHERE id = ?`).run(...params)
    })
    this.#log('mind_thread_updated', { id: threadId, status })
  }

  getOpenThoughts(): RawRow[] {
    return this.#db.prepare(
      "SELECT * FROM thoughts WHERE status='open' ORDER BY charge DESC, ts ASC, id ASC",
    ).all() as RawRow[]
  }

  /**
   * 等待本次整合清算的念头（integrator._thoughts_since_last_integration 对应物）：
   * resolved/abandoned 全量、id 序——清算不受 Top-N 注意力帽限制（工单 §5）。
   */
  thoughtsAwaitingClearance(): RawRow[] {
    return this.#db.prepare(
      "SELECT * FROM thoughts WHERE status IN ('resolved', 'abandoned') ORDER BY id",
    ).all() as RawRow[]
  }

  upsertInsight(category: string, content: string, opts: { now: Date }): number {
    const moment = formatPyIso(opts.now)
    return this.#tx(() => {
      const existing = this.#db.prepare(
        'SELECT id FROM insights WHERE category = ? AND content = ?',
      ).get(category, content) as { id: number } | undefined
      if (existing) {
        this.#db.prepare('UPDATE insights SET updated = ? WHERE id = ?').run(moment, existing.id)
        return Number(existing.id)
      }
      const info = this.#db.prepare(
        'INSERT INTO insights (created, updated, category, content) VALUES (?, ?, ?, ?)',
      ).run(moment, moment, category, content)
      return Number(info.lastInsertRowid)
    })
  }

  scopeInsightSubject(insightId: number, subjectUserId: string): boolean {
    return this.#tx(() => {
      const info = this.#db.prepare(
        `INSERT OR IGNORE INTO memory_scopes
           (table_name, row_id, subject_user_id, origin_context, visibility, sensitivity)
         VALUES ('insights', ?, ?, NULL, 'private', 'content')`,
      ).run(insightId, subjectUserId)
      return Number(info.changes) > 0
    })
  }

  relevanceCandidateRows(opts: {
    terms: readonly string[]
    subjectUserId: string | null
    since: string | null
    until: string | null
  }): RawRow[] {

    const clauses: string[] = [factualEpistemicClause('e')]
    const params: (string | number)[] = []
    let join = ''
    if (opts.subjectUserId !== null) {
      join = " JOIN memory_scopes AS ms ON ms.table_name = 'experiences' AND ms.row_id = e.id"
      clauses.push('ms.subject_user_id = ?')
      params.push(opts.subjectUserId)
    }
    if (opts.since !== null) {
      clauses.push('e.ts >= ?')
      params.push(opts.since)
    }
    if (opts.until !== null) {
      clauses.push('e.ts <= ?')
      params.push(opts.until)
    }
    if (opts.terms.length > 0) {
      const likes: string[] = []
      for (const term of opts.terms) {
        const escaped = term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
        likes.push("e.content LIKE ? ESCAPE '\\'")
        params.push(`%${escaped}%`)
      }
      clauses.push('(' + likes.join(' OR ') + ')')
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
    return this.#db.prepare(
      `SELECT e.*, ec.class AS experience_class
         FROM experiences AS e
         LEFT JOIN experience_class AS ec ON ec.experience_id = e.id${join}
         ${where}
         ORDER BY e.id`,
    ).all(...params) as RawRow[]
  }

  getFocusWakesSince(): number {
    return this.getLearningLayerState(L4_FOCUS_WAKES_KEY) ?? 0
  }

  resetFocusCycle(opts: { now: Date }): void {
    this.#tx(() => {
      this.#db.prepare(
        `INSERT INTO learning_layer_state (key, value, set_at) VALUES (?, 0, ?)
         ON CONFLICT(key) DO UPDATE SET value = 0, set_at = excluded.set_at`,
      ).run(L4_FOCUS_WAKES_KEY, formatPyIso(opts.now))
    })
  }

  openFocusCycle(opts: { now: Date }): number {
    const cycleId = this.#tx(() => {
      const info = this.#db.prepare('INSERT INTO focus_cycles (started_at) VALUES (?)')
        .run(formatPyIso(opts.now))
      return Number(info.lastInsertRowid)
    })
    this.#log('focus_cycle_opened', { cycle_id: cycleId })
    return cycleId
  }

  finalizeFocusCycle(cycleId: number, opts: {
    outcome: string
    concernId?: number | null
    selectionReason?: string
    retrievedCount?: number
    matchReasons?: readonly unknown[] | null
    llmCalls?: number
    note?: string
    now: Date
  }): void {
    if (!FOCUS_OUTCOME_ENUM.includes(opts.outcome)) {
      throw new ValueError(`unknown focus outcome: '${opts.outcome}'`)
    }
    const payload = JSON.stringify(opts.matchReasons ?? [])
    this.#tx(() => {
      this.#db.prepare(
        `UPDATE focus_cycles
            SET finished_at = ?, concern_id = ?, selection_reason = ?,
                outcome = ?, retrieved_count = ?, match_reasons = ?,
                llm_calls = ?, note = ?
          WHERE id = ?`,
      ).run(
        formatPyIso(opts.now), opts.concernId ?? null, opts.selectionReason ?? '',
        opts.outcome, opts.retrievedCount ?? 0, payload,
        opts.llmCalls ?? 0, cpSlice(opts.note ?? '', 2048), cycleId,
      )
    })
    this.#log('focus_cycle_finished', {
      cycle_id: cycleId, outcome: opts.outcome, concern_id: opts.concernId ?? null,
      retrieved: opts.retrievedCount ?? 0, llm_calls: opts.llmCalls ?? 0,
      selection_reason: opts.selectionReason ?? '',
    })
  }

  getFocusCycle(cycleId: number): RawRow | null {
    const row = this.#db.prepare('SELECT * FROM focus_cycles WHERE id = ?').get(cycleId) as
      | RawRow
      | undefined
    return row ?? null
  }

  latestFocusCycleStartedAt(): string | null {
    const row = this.#db.prepare(
      'SELECT MAX(started_at) AS ts FROM focus_cycles',
    ).get() as { ts: string | null } | undefined
    return row?.ts ?? null
  }

  currentFocusCycleId(): number {
    const row = this.#db.prepare('SELECT MAX(id) AS n FROM focus_cycles').get() as
      | { n: number | null }
      | undefined
    return Number(row?.n ?? 0)
  }

  focusCandidates(currentCycleId: number): RawRow[] {
    return this.#db.prepare(
      `SELECT c.*,
              ms.subject_user_id                    AS subject_user_id,
              COALESCE(cfs.no_progress_streak, 0)   AS no_progress_streak,
              COALESCE(cfs.cooldown_count, 0)       AS cooldown_count,
              cfs.cooldown_until_cycle              AS cooldown_until_cycle,
              cfs.release_suggested_at_cycle        AS release_suggested_at_cycle,
              CASE WHEN COALESCE(cfs.cooldown_until_cycle, 0) > ?
                   THEN 1 ELSE 0 END                AS in_cooldown
         FROM concerns AS c
         LEFT JOIN memory_scopes AS ms
                ON ms.table_name = 'concerns' AND ms.row_id = c.id
         LEFT JOIN concern_focus_state AS cfs ON cfs.concern_id = c.id
        WHERE c.status <> 'released'
        ORDER BY c.id`,
    ).all(currentCycleId) as RawRow[]
  }

  getConcernFocusState(concernId: number): RawRow {
    const row = this.#db.prepare(
      'SELECT * FROM concern_focus_state WHERE concern_id = ?',
    ).get(concernId) as RawRow | undefined
    if (row) return row
    return {
      concern_id: concernId, no_progress_streak: 0, cooldown_until_cycle: null,
      cooldown_count: 0, last_cycle_id: null, release_suggested_at_cycle: null,
      updated_at: null,
    }
  }

  updateConcernFocusState(concernId: number, opts: {
    noProgressStreak: number
    cooldownUntilCycle: number | null
    cooldownCount: number
    lastCycleId: number
    releaseSuggestedAtCycle: number | null
    now: Date
  }): void {
    this.#tx(() => {
      this.#db.prepare(
        `INSERT INTO concern_focus_state
             (concern_id, no_progress_streak, cooldown_until_cycle,
              cooldown_count, last_cycle_id, release_suggested_at_cycle, updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(concern_id) DO UPDATE SET
             no_progress_streak = excluded.no_progress_streak,
             cooldown_until_cycle = excluded.cooldown_until_cycle,
             cooldown_count = excluded.cooldown_count,
             last_cycle_id = excluded.last_cycle_id,
             release_suggested_at_cycle = excluded.release_suggested_at_cycle,
             updated_at = excluded.updated_at`,
      ).run(
        concernId, opts.noProgressStreak, opts.cooldownUntilCycle, opts.cooldownCount,
        opts.lastCycleId, opts.releaseSuggestedAtCycle, formatPyIso(opts.now),
      )
    })
  }

  concernsSuggestedForRelease(): RawRow[] {
    return this.#db.prepare(
      `SELECT c.*, cfs.cooldown_count, cfs.release_suggested_at_cycle,
              cfs.no_progress_streak
         FROM concern_focus_state AS cfs
         JOIN concerns AS c ON c.id = cfs.concern_id
        WHERE cfs.release_suggested_at_cycle IS NOT NULL
          AND c.status <> 'released'
        ORDER BY c.id`,
    ).all() as RawRow[]
  }

  recordLineage(opts: {
    productKind: string
    productId: string | number
    sources: readonly (readonly [string, string | number])[]
    cycleId: number
    now: Date
  }): number {
    if (opts.sources.length === 0) return 0
    const moment = formatPyIso(opts.now)
    const written = this.#tx(() => {
      let count = 0
      const stmt = this.#db.prepare(
        `INSERT OR IGNORE INTO product_lineage
             (product_kind, product_id, source_kind, source_id, cycle_id, created_at)
         VALUES (?,?,?,?,?,?)`,
      )
      for (const [kind, sid] of opts.sources) {
        const info = stmt.run(opts.productKind, String(opts.productId), kind, String(sid),
          opts.cycleId, moment)
        count += Number(info.changes)
      }
      return count
    })
    this.#log('focus_lineage_recorded', {
      product_kind: opts.productKind, product_id: String(opts.productId),
      cycle_id: opts.cycleId, sources: written,
    })
    return written
  }

  /** 一个产物的全部血缘行（时间序；§3.7 可审计面）。 */
  lineageForProduct(productKind: string, productId: string | number): RawRow[] {
    return this.#db.prepare(
      'SELECT * FROM product_lineage WHERE product_kind = ? AND product_id = ? ORDER BY id',
    ).all(productKind, String(productId)) as RawRow[]
  }

  /** 反向：一条原料喂出过哪些结论。 */
  lineageForSource(sourceKind: string, sourceId: string | number): RawRow[] {
    return this.#db.prepare(
      'SELECT * FROM product_lineage WHERE source_kind = ? AND source_id = ? ORDER BY id',
    ).all(sourceKind, String(sourceId)) as RawRow[]
  }

  #insightContent(insightId: number): string {
    const row = this.#db.prepare('SELECT content FROM insights WHERE id = ?').get(insightId) as
      | { content: string }
      | undefined
    return row ? row.content : ''
  }

  getFocusInsightState(insightId: number): RawRow | null {
    const row = this.#db.prepare(
      'SELECT * FROM focus_insight_state WHERE insight_id = ?',
    ).get(insightId) as RawRow | undefined
    return row ?? null
  }

  listFocusInsights(status: string | readonly string[] | null): RawRow[] {
    let statuses: string[] | null = null
    if (status !== null) {
      statuses = typeof status === 'string' ? [status] : [...status]
      for (const value of statuses) {
        if (!FOCUS_INSIGHT_STATUS_ENUM.includes(value)) {
          throw new ValueError(`unknown focus insight status: '${value}'`)
        }
      }
    }
    const sql = `SELECT s.*, i.content AS content, i.category AS category
                   FROM focus_insight_state AS s
                   LEFT JOIN insights AS i ON i.id = s.insight_id`
    if (statuses && statuses.length > 0) {
      const marks = statuses.map(() => '?').join(',')
      return this.#db.prepare(
        sql + ` WHERE s.status IN (${marks}) ORDER BY s.insight_id`,
      ).all(...statuses) as RawRow[]
    }
    return this.#db.prepare(sql + ' ORDER BY s.insight_id').all() as RawRow[]
  }

  promotedFocusInsights(): RawRow[] {
    return this.#db.prepare(
      `SELECT s.*, i.content AS content, i.category AS category
         FROM focus_insight_state AS s
         LEFT JOIN insights AS i ON i.id = s.insight_id
        WHERE s.status = 'active' AND COALESCE(i.category, '') <> ?
        ORDER BY s.insight_id`,
    ).all(RELATIONSHIP_INSIGHT_CATEGORY) as RawRow[]
  }

  promotedRelationshipInsights(subjectUserId: string): RawRow[] {
    return this.#db.prepare(
      `SELECT s.*, i.content AS content, i.category AS category
         FROM focus_insight_state AS s
         JOIN insights AS i ON i.id = s.insight_id
         JOIN memory_scopes AS ms
           ON ms.table_name = 'insights' AND ms.row_id = s.insight_id
        WHERE s.status = 'active' AND i.category = ? AND ms.subject_user_id = ?
        ORDER BY s.insight_id`,
    ).all(RELATIONSHIP_INSIGHT_CATEGORY, subjectUserId) as RawRow[]
  }

  recordFocusInsight(insightId: number, opts: {
    cycleId: number
    status?: string
    reason?: string
    now: Date
  }): boolean {
    const status = opts.status ?? 'shadow'
    if (!FOCUS_INSIGHT_STATUS_ENUM.includes(status)) {
      throw new ValueError(`unknown focus insight status: '${status}'`)
    }
    const moment = formatPyIso(opts.now)
    let toStatus = status
    const outcome = this.#tx((): { reaffirmed: boolean; relit: boolean } => {
      const existing = this.#db.prepare(
        'SELECT status FROM focus_insight_state WHERE insight_id = ?',
      ).get(insightId) as { status: string } | undefined
      const snapshot = this.#insightContent(insightId)
      let fromStatus: string | null
      if (existing && existing.status === 'dormant') {
        // D-5 点亮：休眠结论被重申 → 回到现行。
        fromStatus = 'dormant'
        toStatus = 'active'
        this.#db.prepare(
          `UPDATE focus_insight_state
              SET status = 'active', updated_cycle_id = ?, contested_since_cycle = NULL,
                  updated_at = ?
            WHERE insight_id = ?`,
        ).run(opts.cycleId, moment, insightId)
      } else if (existing) {
        // 重申:状态行原样不动(影子期不重新计时),只留痕。
        fromStatus = existing.status
        toStatus = existing.status
      } else {
        this.#db.prepare(
          `INSERT INTO focus_insight_state
               (insight_id, status, created_cycle_id, updated_cycle_id, updated_at)
           VALUES (?,?,?,?,?)`,
        ).run(insightId, status, opts.cycleId, opts.cycleId, moment)
        fromStatus = null
        toStatus = status
      }
      this.#db.prepare(
        `INSERT INTO focus_insight_history
             (insight_id, cycle_id, from_status, to_status, content_snapshot, reason, at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(insightId, opts.cycleId, fromStatus, toStatus, snapshot,
        fromStatus === 'dormant'
          ? 'relit'
          : (opts.reason || (existing ? 'reaffirmed' : 'created')),
        moment)
      return { reaffirmed: existing !== undefined, relit: fromStatus === 'dormant' }
    })
    this.#log('focus_insight_recorded', {
      insight_id: insightId, cycle_id: opts.cycleId,
      status: toStatus, reaffirmed: outcome.reaffirmed,
    })
    if (outcome.relit) {
      // D-6：因果出口走既有通道，不另造事件面。
      this.#log('focus_insight_status', {
        insight_id: insightId, cycle_id: opts.cycleId,
        from: 'dormant', to: 'active', reason: 'relit',
      })
    }
    return !outcome.reaffirmed
  }

  setFocusInsightStatus(insightId: number, status: string, opts: {
    cycleId: number
    reason?: string
    supersededBy?: number | null
    contestedSinceCycle?: number | null
    now: Date
  }): boolean {
    if (!FOCUS_INSIGHT_STATUS_ENUM.includes(status)) {
      throw new ValueError(`unknown focus insight status: '${status}'`)
    }
    const moment = formatPyIso(opts.now)
    let fromStatus = ''
    const moved = this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT status, contested_since_cycle FROM focus_insight_state WHERE insight_id = ?',
      ).get(insightId) as { status: string; contested_since_cycle: number | null } | undefined
      if (!row) return false
      fromStatus = row.status
      let keepContested: number | null
      if (status === 'contested') {
        keepContested = opts.contestedSinceCycle ?? row.contested_since_cycle ?? opts.cycleId
      } else if (status === 'shadow' || status === 'active') {
        keepContested = null
      } else {
        keepContested = row.contested_since_cycle
      }
      this.#db.prepare(
        `UPDATE focus_insight_state
            SET status = ?, updated_cycle_id = ?, contested_since_cycle = ?,
                superseded_by = COALESCE(?, superseded_by), updated_at = ?
          WHERE insight_id = ?`,
      ).run(status, opts.cycleId, keepContested, opts.supersededBy ?? null, moment, insightId)
      this.#db.prepare(
        `INSERT INTO focus_insight_history
             (insight_id, cycle_id, from_status, to_status, content_snapshot, reason, at)
         VALUES (?,?,?,?,?,?,?)`,
      ).run(insightId, opts.cycleId, row.status, status,
        this.#insightContent(insightId), opts.reason ?? '', moment)
      return true
    })
    if (moved) {
      this.#log('focus_insight_status', {
        insight_id: insightId, cycle_id: opts.cycleId,
        from: fromStatus, to: status, reason: opts.reason ?? '',
      })
    }
    return moved
  }

  focusInsightHistory(insightId?: number | null): RawRow[] {
    if (insightId === undefined || insightId === null) {
      return this.#db.prepare('SELECT * FROM focus_insight_history ORDER BY id').all() as RawRow[]
    }
    return this.#db.prepare(
      'SELECT * FROM focus_insight_history WHERE insight_id = ? ORDER BY id',
    ).all(insightId) as RawRow[]
  }

  enqueueRuleSuggestion(opts: {
    kind: string
    dedupKey: string
    suggestionText: string
    rationale?: string
    sourceKind?: string
    sourceId?: string | number
    cycleId?: number | null
    now: Date
  }): { id: number; status: string; enqueued: boolean; reason: string } {
    if (!RULE_SUGGESTION_KINDS.includes(opts.kind)) {
      throw new ValueError(`unknown rule suggestion kind: '${opts.kind}'`)
    }
    if (!opts.dedupKey) {
      throw new ValueError('rule suggestion requires a dedup_key')
    }
    if (!(opts.suggestionText ?? '').trim()) {
      throw new ValueError('rule suggestion requires suggestion_text')
    }
    const moment = formatPyIso(opts.now)
    const cycle = opts.cycleId || null
    const rationale = opts.rationale ?? ''
    const sourceKind = opts.sourceKind ?? ''
    const sourceId = String(opts.sourceId ?? '')
    let rearmedFrom: string | null = null
    const result = this.#tx(() => {
      const row = this.#db.prepare(
        'SELECT * FROM rule_suggestions WHERE dedup_key = ?',
      ).get(opts.dedupKey) as RawRow | undefined
      if (row) {
        const status = row.status as string
        if (status === 'pending' || status === 'asked') {
          return { id: Number(row.id), status, enqueued: false, reason: 'already_queued' }
        }
        if (status === 'accepted' || status === 'applied_by_owner') {
          return { id: Number(row.id), status, enqueued: false, reason: 'already_decided' }
        }
        const cooldown = row.cooldown_until_cycle as number | null
        if (cooldown !== null && (cycle ?? 0) < cooldown) {
          return { id: Number(row.id), status, enqueued: false, reason: 'cooldown' }
        }
        this.#db.prepare(
          `UPDATE rule_suggestions
              SET status = 'pending', suggestion_text = ?, rationale = ?,
                  source_kind = ?, source_id = ?, created_cycle_id = ?,
                  question_message_id = NULL, question_text = '',
                  asked_at_cycle = NULL, cooldown_until_cycle = NULL,
                  updated_at = ?
            WHERE id = ? AND status IN ('declined','expired')`,
        ).run(opts.suggestionText.trim(), rationale, sourceKind, sourceId,
          cycle, moment, Number(row.id))
        rearmedFrom = status
        return { id: Number(row.id), status: 'pending', enqueued: true, reason: 'rearmed' }
      }
      const info = this.#db.prepare(
        `INSERT INTO rule_suggestions
             (kind, dedup_key, suggestion_text, rationale, source_kind,
              source_id, created_cycle_id, status, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, 'pending', ?, ?)`,
      ).run(opts.kind, opts.dedupKey, opts.suggestionText.trim(), rationale, sourceKind,
        sourceId, cycle, moment, moment)
      return { id: Number(info.lastInsertRowid), status: 'pending', enqueued: true, reason: 'new' }
    })
    if (result.reason === 'rearmed') {
      this.#log('rule_suggestion_rearmed', {
        suggestion_id: result.id, kind: opts.kind, dedup_key: opts.dedupKey,
        was: rearmedFrom, cycle_id: cycle,
      })
    } else if (result.reason === 'new') {
      this.#log('rule_suggestion_enqueued', {
        suggestion_id: result.id, kind: opts.kind, dedup_key: opts.dedupKey,
        source_kind: sourceKind, source_id: sourceId, cycle_id: cycle,
      })
    }
    return result
  }

  getRuleSuggestion(suggestionId: number): RawRow | null {
    const row = this.#db.prepare('SELECT * FROM rule_suggestions WHERE id = ?')
      .get(suggestionId) as RawRow | undefined
    return row ?? null
  }

  ruleSuggestionByDedupKey(dedupKey: string): RawRow | null {
    const row = this.#db.prepare('SELECT * FROM rule_suggestions WHERE dedup_key = ?')
      .get(dedupKey) as RawRow | undefined
    return row ?? null
  }

  ruleSuggestionByQuestion(questionMessageId: string | number | null): RawRow | null {
    if (questionMessageId === null) return null
    const row = this.#db.prepare(
      'SELECT * FROM rule_suggestions WHERE question_message_id = ? ORDER BY id DESC LIMIT 1',
    ).get(String(questionMessageId)) as RawRow | undefined
    return row ?? null
  }

  /** 队列只读视图（owner console 与用例的取数面）。 */
  listRuleSuggestions(status: string | readonly string[] | null): RawRow[] {
    let statuses: string[] | null = null
    if (status !== null) {
      statuses = typeof status === 'string' ? [status] : [...status]
      for (const value of statuses) {
        if (!SUGGESTION_STATUS_ENUM.includes(value)) {
          throw new ValueError(`unknown rule suggestion status: '${value}'`)
        }
      }
    }
    if (statuses && statuses.length > 0) {
      const marks = statuses.map(() => '?').join(',')
      return this.#db.prepare(
        `SELECT * FROM rule_suggestions WHERE status IN (${marks}) ORDER BY id`,
      ).all(...statuses) as RawRow[]
    }
    return this.#db.prepare('SELECT * FROM rule_suggestions ORDER BY id').all() as RawRow[]
  }

  nextPendingRuleSuggestion(): RawRow | null {
    const row = this.#db.prepare(
      "SELECT * FROM rule_suggestions WHERE status = 'pending' ORDER BY id LIMIT 1",
    ).get() as RawRow | undefined
    return row ?? null
  }

  outstandingAskedRuleSuggestions(): RawRow[] {
    return this.listRuleSuggestions('asked')
  }

  overdueAskedRuleSuggestions(cycleId: number, ttlCycles: number): RawRow[] {
    return this.#db.prepare(
      `SELECT * FROM rule_suggestions
        WHERE status = 'asked' AND COALESCE(asked_at_cycle, 0) <= ?
        ORDER BY id`,
    ).all(cycleId - ttlCycles) as RawRow[]
  }

  markRuleSuggestionAsked(suggestionId: number, opts: {
    questionMessageId: string | number | null
    questionText: string
    cycleId?: number | null
    now: Date
  }): boolean {
    const claimed = this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE rule_suggestions
            SET status = 'asked', question_message_id = ?, question_text = ?,
                asked_at_cycle = ?, ask_count = ask_count + 1, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      ).run(
        opts.questionMessageId === null ? null : String(opts.questionMessageId),
        opts.questionText, opts.cycleId ?? null, formatPyIso(opts.now), suggestionId,
      )
      return Number(info.changes) === 1
    })
    this.#log('rule_suggestion_asked', {
      suggestion_id: suggestionId, claimed,
      question_message_id: String(opts.questionMessageId), cycle_id: opts.cycleId ?? null,
    })
    return claimed
  }

  resolveRuleSuggestion(suggestionId: number, status: string, opts: {
    answerText?: string
    cooldownUntilCycle?: number | null
    stagedInstructions?: string
    now: Date
  }): boolean {
    if (!SUGGESTION_STATUS_ENUM.includes(status)) {
      throw new ValueError(`unknown rule suggestion status: '${status}'`)
    }
    const sources = SUGGESTION_TRANSITIONS[status] ?? []
    const marks = sources.map(() => '?').join(',')
    const moment = formatPyIso(opts.now)
    const staged = opts.stagedInstructions ?? ''
    const moved = this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE rule_suggestions
            SET status = ?, answer_text = ?, cooldown_until_cycle = ?,
                staged_instructions = CASE WHEN ? <> '' THEN ? ELSE staged_instructions END,
                decided_at = ?, updated_at = ?
          WHERE id = ? AND status IN (${marks})`,
      ).run(status, cpSlice(opts.answerText ?? '', 2048), opts.cooldownUntilCycle ?? null,
        staged, staged, moment, moment, suggestionId, ...sources)
      return Number(info.changes) === 1
    })
    this.#log('rule_suggestion_resolved', {
      suggestion_id: suggestionId, status, moved,
      cooldown_until_cycle: opts.cooldownUntilCycle ?? null,
    })
    return moved
  }

  close(): void {
    this.#db.close()
  }
}
