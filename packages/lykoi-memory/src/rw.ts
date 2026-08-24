/**
 * lykoi-memory/rw — state 写层（M2 波次 1 交付①）。
 *
 * 显式 rw 入口：只有 import 'lykoi-memory/rw' 并 new ReadWriteMemory 才拿得到写面；
 * 包的缺省入口（./src/index.ts）仍是只读，R-01 三重防写原样不动。
 *
 * 契约正本：治理仓库 WO-M0-STATE-CONTRACT（C 系列）+ WO-M2-SPEC-MIND（SA 系列）。
 * 写层纪律：
 *   C-01  mind 侧连接口径：autocommit（node:sqlite 总是 autocommit，事务全显式）、
 *         PRAGMA foreign_keys = ON、PRAGMA busy_timeout = 10000。
 *         （Python 的 connect(timeout=10.0) 与 busy_timeout 双轨在 node:sqlite 里
 *         只有 busy_timeout 一条轨，取 10000 —— R-03。）
 *   C-02  所有写走 #tx()：显式 BEGIN IMMEDIATE → COMMIT，异常 ROLLBACK 后原样再抛。
 *         是 IMMEDIATE 不是 DEFERRED：读-改-写必须在 DB 层串行。
 *   C-03/R-08  memory 侧表（history/autonomy_*）在 Python 是隐式 DEFERRED + 30000ms；
 *         本写层按 M2 蓝图 W1 的定案统一走 BEGIN IMMEDIATE + 10000ms（行为收紧，
 *         select-then-insert/update 因此保住原子性）。此为蓝图明文，不再各自判断。
 *   C-22  写侧时间戳沿用 Python isoformat 形态（formatPyIso：+00:00 偏移、微秒零省略）。
 *   C-29  不设 journal_mode（memory.db 现行 rollback journal；切 WAL 是独立决策项）。
 *   R-01  本层永远只对副本工作；真 state 的防线在治理侧（golden devstate 只读纪律）。
 *
 * 时钟纪律（C-23）：本层所有写 API 的 now 一律**必传**（Date），不提供
 * Date.now() 缺省 —— 避免在 clock.now() 唯一真实读点之外偷读墙钟。
 * （W1 TODO#7 已落：clock 薄件在 lykoi-wake —— 生产走 systemClock、测试走
 * VirtualClock，全部调用方经它取 now 后显式传入，本层纪律不变。）
 */
import { DatabaseSync } from 'node:sqlite'
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
  parseStateTimestamp,
  type AutonomyStateRow,
  type ConcernRow,
  type ExperienceRow,
  type HistoryRow,
  type RegulationFieldRow,
  type ThoughtRow,
} from './index.ts'

// ============================== C-22 写侧格式 ==============================

/**
 * C-22 写侧：Python `datetime.isoformat()`（tz-aware UTC）的形态 ——
 * `YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00`；微秒为 0 时整个小数部分省略；
 * 非零时固定六位（JS 只有毫秒精度，微秒后三位恒为 000 —— 是该格式的合法子集）。
 * 与真实历史行的格式一致性由测试对 golden devstate 断言（只断格式，零内容输出）。
 */
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
  /** 本拍衰减后仍 open 的念头数（thoughts.py 口径：lapse 的不计入 decayed）。 */
  decayed: number
  /** 跌破 ABANDON_THRESHOLD 被 lapse 成 abandoned 的念头 id（Python 只返回计数，此处保留 id 供断言）。 */
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
  /**
   * decision JSON —— 由调用方序列化。口径已由 W2 决策层定案（W1 TODO#6 销账）：
   * 新体 = `serializeDecision`（lykoi-decide：JSON.stringify over 保序 as_dict，
   * 紧凑分隔符）；与 Python 历史行（json.dumps 的 ", "/": " 分隔符）并存，
   * 读侧 JSON.parse 双向兼容 —— 见 lykoi-decide/src/index.ts 的序列化注释。
   */
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

// ============================== W2 补齐面（快照/决策消费） ==============================

/** active 关切数上限（mind/store.py:36 逐字：满了想加新的必须先释放旧的）。 */
export const ACTIVE_CONCERN_CAP = 12
/** last_lit_at 超 7 天 → dimming（mind/store.py:39）。 */
export const DIMMING_AFTER_DAYS = 7
/** 超 21 天 → dormant——绝不自动 released，红线 #3（mind/store.py:40）。 */
export const DORMANT_AFTER_DAYS = 21
/** 悬置超 30 天未动 → 压低 coherence 的判据（mind/store.py:41）。 */
export const SUSPENDED_OVERDUE_DAYS = 30

/** concerns.kind 枚举（mind/store.py:46 逐字）。 */
export const CONCERN_KINDS = [
  'interest', 'project', 'question', 'ritual', 'relationship_thread',
] as const
export type ConcernKind = (typeof CONCERN_KINDS)[number]
/** concerns.origin 枚举（mind/store.py:51 一带；DDL CHECK 七值并集）。 */
export const CONCERN_ORIGINS = [
  'seed', 'grown', 'relationship', 'floor', 'emergent', 'owner_directed', 'derived',
] as const
export type ConcernOrigin = (typeof CONCERN_ORIGINS)[number]

/** create_concern 的有限性拒绝（mind/store.py:74 ConcernCapError 对应物）。 */
export class ConcernCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcernCapError'
  }
}

/**
 * Python ValueError 的对应物（W3 新增，reflow 消费）：语义级拒绝（目标不存在 /
 * 状态不许 / 载荷为空）。活体 reflow 的 tend_inner 只接 ValueError（其余异常
 * 冒泡把整拍记 failed）—— 这道"契约破坏 vs 语义拒绝"的分野要在类型上可辨。
 * 只用于 W3 新增方法；既有方法的抛错类型保持 W1/W2 原样（复核已过，不回改）。
 */
export class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

/** 一次发光的默认权重上调（mind/store.py:44 逐字）。 */
export const CONCERN_LIT_WEIGHT_DELTA = 0.05

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

// ============================== 实现 ==============================

export class ReadWriteMemory {
  #db: DatabaseSync
  /** 连接实际生效的 busy_timeout（观测位，供测试断言 C-01 口径）。 */
  readonly busyTimeoutMs: number

  constructor(dbPath: string) {
    // 显式 rw：这是整个包唯一会以写模式打开 state 的入口。
    this.#db = new DatabaseSync(dbPath)
    try {
      this.#db.exec('PRAGMA busy_timeout = 10000') // C-01
      this.#db.exec('PRAGMA foreign_keys = ON') //    C-01
      const busy = this.#db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
      this.busyTimeoutMs = Number(busy?.timeout ?? 0)
      this.#assertSchemaVersion()
    } catch (err) {
      this.#db.close()
      throw err
    }
  }

  /** 与只读入口同一道门：mind_schema != 15 拒开（不写不认识的 schema，更甚于不读）。 */
  #assertSchemaVersion(): void {
    let version: unknown
    try {
      const row = this.#db.prepare('SELECT MAX(version) AS version FROM mind_schema').get() as
        | { version: unknown }
        | undefined
      version = row?.version
    } catch (err) {
      throw new Error(
        'lykoi-memory: cannot read mind_schema from this database — not a Lykoi state copy? '
        + `(${(err as Error).message})`,
      )
    }
    if (version !== EXPECTED_MIND_SCHEMA_VERSION) {
      throw new Error(
        `lykoi-memory: mind_schema version ${String(version)} != expected `
        + `${EXPECTED_MIND_SCHEMA_VERSION}; refuse to open for writing (WO-M0-STATE-CONTRACT §1.0)`,
      )
    }
  }

  /**
   * C-02：BEGIN IMMEDIATE → fn → COMMIT；BaseException 对应物 = 任何 throw，
   * ROLLBACK 后原样再抛。短事务、不嵌套（嵌套即纪律违规，直接抛）。
   */
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

  // ============================== experiences ==============================

  /**
   * SA-52/53 数据面：经验落缓冲（mind/store.record_experience 对应物）。
   * 「每条经验必发 experience_recorded」的联动调用序在 reflow 侧（W3），
   * 本层不隐式发因 —— 调用方紧随其后 applyRegulationCause('experience_recorded')。
   * 触发器保证行 append-only + integrated 仅 0→1（库层，见触发器契约红测）。
   */
  recordExperience(
    source: ExperienceSource,
    content: string,
    opts: { salience?: number; relatedConcernId?: number | null; now: Date },
  ): number {
    if (typeof content !== 'string' || content.length === 0) {
      throw new TypeError('lykoi-memory: experience content must be a non-empty string')
    }
    const salience = opts.salience ?? 0.5
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
      const info = this.#db.prepare(
        `INSERT INTO experiences (ts, source, content, salience, related_concern_id)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(ts, source, content, salience, opts.relatedConcernId ?? null)
      return Number(info.lastInsertRowid)
    })
  }

  // ============================== 调节场 ==============================

  /**
   * SA-75：唯一的 delta 写入点。delta 只从 lykoi-regulation 的 CAUSES 表查 ——
   * 接口上不存在 delta 参数，调用点无法自带幅度（"a call site cannot invent its
   * own magnitude"）。同一事务内完成：懒衰减落账（§4.3 从 updated_at 起算）→
   * apply_delta → regulation_field 读改写 + regulation_events append（交付③闭环）。
   */
  applyRegulationCause(cause: string, opts: { now: Date }): RegulationCauseResult {
    const entry = CAUSES[cause]
    if (!entry) {
      throw new Error(`lykoi-memory: unknown regulation cause '${cause}' (SA-75: delta 只从 CAUSES 查)`)
    }
    const [name, delta] = entry
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
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
    const rows = this.#db.prepare(
      'SELECT name, value, baseline, updated_at FROM regulation_field ORDER BY name',
    ).all() as { name: string; value: number; baseline: number; updated_at: string }[]
    return rows.map((r) => ({
      name: r.name as RegulationFieldRow['name'],
      value: r.value,
      baseline: r.baseline,
      updatedAt: r.updated_at,
    }))
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

  // ============================== concerns ==============================

  /**
   * 关切列表（mind/store.list_concerns 对应物：ORDER BY weight DESC, id ——
   * 快照 Top-N 截取直接依赖这个次序）。status 缺省 = 全部状态（含 released，
   * 种子幂等 SA-166 的读法）。
   */
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

  /**
   * 建关切（mind/store.create_concern 对应物）。受有限性约束：active 满 12 则
   * ConcernCapError —— 代码不替她腾位置，释放是整合期她的判断（红线 #3）。
   * 校验与错误文案序沿 Python：kind → origin → title → weight → cap。
   */
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
    return this.#tx(() => {
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
  }

  /**
   * SA-34 第一写：确定性变暗（mind/store.mark_dimming_dormant 对应物，蓝图 §3.2）。
   * last_lit_at（缺则 created_at）超 7 天 → dimming；超 21 天 → dormant。
   * 本方法 NEVER 写 'released' —— 释放只属于整合期的她或 owner 后门（红线 #3）。
   * 严格大于（Python `days > DORMANT_AFTER_DAYS`）；dimming 仅对 active 行。
   */
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

  /**
   * 发光（mind/store.light_concern 对应物，W3 reflow 消费）：意义评估把一条经验
   * 关联到此关切。weight 上调（默认增量 CONCERN_LIT_WEIGHT_DELTA）、last_lit_at
   * 刷新、lit_count+1。dimming/dormant 被重新点亮会回到 active —— 但只在 active
   * 未满时（上限不因发光而突破）；released 不可点亮（复活一个已释放的关切是
   * 整合期的判断，不是代码的）—— 两条拒绝抛 ValueError（reflow 只 log 不杀拍，
   * SA-64）。
   */
  lightConcern(
    concernId: number,
    opts: { weightDelta?: number; now: Date },
  ): { id: number; weight: number; status: string } {
    const delta = opts.weightDelta ?? CONCERN_LIT_WEIGHT_DELTA
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
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

  // ============================== 叙事 ==============================

  /**
   * 认知当前叙事（mind/store.current_cognitive_narrative 对应物，WO-P4R-06 /
   * SA-41）：最新的非 narrative_only 版本 —— 空整合的虚构改写绝不被提升为
   * "当前自我叙事"。`IS NOT` 是 NULL 安全的：未标记的历史行仍认知可见（fail-safe）。
   */
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

  // ============================== experiences（读侧） ==============================

  /**
   * 未整合行为经验数（mind/store.count_pending_experiences 对应物）。
   * W1 environment 沉淀明确不计（integrated = 0 AND source <> 'environment'）。
   */
  countPendingExperiences(): number {
    const row = this.#db.prepare(
      "SELECT COUNT(*) AS n FROM experiences WHERE integrated = 0 AND source <> 'environment'",
    ).get() as { n: number }
    return row.n
  }

  /**
   * 某 source 最新经验的 ts（mind/store.latest_experience_ts 对应物）：
   * 耐久去重标记（如 cheap_tick 的"每个沉默期只写一次 silence"，SA-69）。
   * 未知 source 抛 ValueError（Python 逐字：unknown experience source）。
   */
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

  /** 最近 N 条经验（mind/store.recent_experiences 对应物：ORDER BY id DESC）。 */
  recentExperiences(n: number): ExperienceRow[] {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError('lykoi-memory: limit must be a non-negative integer')
    }
    const rows = this.#db.prepare(
      `SELECT id, ts, source, content, salience, related_concern_id, integrated, integration_id
         FROM experiences ORDER BY id DESC LIMIT ?`,
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
    }))
  }

  // ============================== thoughts（读侧） ==============================

  /**
   * 快照注入的 Top-N open 念头（thoughts.get_thoughts_for_snapshot 对应物，出口 ①）。
   * 排序键逐字：charge DESC, ts ASC, id ASC —— 最强的先看见，平局按最老、最小 id。
   * 不足 top_n 合法，空列表是正确渲染而非警告（SA-38）。
   */
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

  /**
   * 超时未答的 question 念头（thoughts.overdue_questions 对应物，出口 ②）：
   * open ∧ kind='question' ∧ ts < now - QUESTION_OVERDUE_HOURS。
   * 比较沿 Python：cutoff 以 isoformat 形态与业务行做字符串比较（同格式串序=时间序）。
   */
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

  // ============================== thoughts ==============================

  /**
   * SA-175：create 容量软拒 —— open 念头满 THOUGHT_OPEN_CAP=7 时，新 charge 不
   * **严格大于**现存最低者即拒（返回 null，调用方记 rejected_create/capacity）；
   * 严格大于则挤掉最低者：同一事务内 open→abandoned + 落一条 thought_lapse 经验
   * （salience 0.2），再插新念头。状态机与列冻结由库层 6 触发器兜底。
   */
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
        // 挤占次序键逐字对拍（W1 TODO#3 销账）：thoughts.py:106-108
        // `ORDER BY charge ASC, ts ASC, id ASC` —— 最低 charge，平局按最老 ts、最小 id。
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

  /**
   * 事务内工序：open→abandoned + thought_lapse 经验（SA-175/177 共用；调用方持有
   * 事务）——thoughts.py:43-62 `_abandon_in_tx` 逐字对拍（W1 TODO#1 销账）：
   * - 只改 status，**不写 charge**（Python 弃置时不落新 charge）；
   * - 经验 content 模板逐字 `放掉了一个没想完的念头:{clip(summary,100)} ({reason})`
   *   （clip 不 strip、省略号在 100 之外）；reason ∈ {capacity_displacement, decay}；
   * - related_concern_id 不带（Python insert_experience_in_tx 未传该列）。
   */
  #abandonInTx(thoughtId: number, summary: string, reason: string, ts: string): void {
    this.#db.prepare("UPDATE thoughts SET status = 'abandoned' WHERE id = ?").run(thoughtId)
    const cps = [...summary]
    const clipped = cps.length <= 100 ? summary : cps.slice(0, 100).join('') + '…'
    this.#db.prepare(
      `INSERT INTO experiences (ts, source, content, salience)
       VALUES (?, 'thought_lapse', ?, ?)`,
    ).run(ts, `放掉了一个没想完的念头:${clipped} (${reason})`, THOUGHT_LAPSE_SALIENCE)
  }

  /**
   * 注意力域第二道闸（store 层，§2.3 三层闸之 2）：id 不在本拍注入集内即拒。
   * 仅 open→resolved（状态机唯一入口边；非法边由库层触发器兜底）。
   * 返回契约对拍（W1 TODO#4 销账）：thoughts.py:138-171 逐字一致 ——
   * 集外 → false / 不存在 → false / 非 open → false / 成功 open→resolved → true；
   * 拒绝路径零副作用。（Python 侧的 thought_resolve_rejected/thought_resolved
   * log_event 属 store 层遥测面，见 W3 报告新增 TODO。）
   */
  resolveThought(id: number, injectedIds: Iterable<number>): boolean {
    if (!Number.isInteger(id)) return false
    const allowed = injectedIds instanceof Set ? injectedIds : new Set(injectedIds)
    if (!allowed.has(id)) return false
    return this.#tx(() => {
      const info = this.#db.prepare(
        "UPDATE thoughts SET status = 'resolved' WHERE id = ? AND status = 'open'",
      ).run(id)
      return Number(info.changes) === 1
    })
  }

  /**
   * SA-177：念头衰减一拍一次（decay_charge，beats=1）；跌破 ABANDON_THRESHOLD=0.15
   * → 同一事务内 abandoned + thought_lapse 经验（salience 0.2），原子。
   * 计数口径对拍 thoughts.py:293-325：decayed 只数**存续**的（lapse 的不计）；
   * lapse 行只改 status 不写衰减后 charge（W1 TODO#1 一并修正）。
   */
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

  /**
   * SA-176：settle 仅整合路径可调（红线 #3）——仅 resolved→absorbed，必携
   * integration_id（thoughts_terminal_integration 触发器在库层再兜一遍）。
   * TODO(M2-W4): 「仅整合路径可调」的静态扫描绊线随 integrator 移植波一起立。
   */
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
  }

  /** open 念头（写层调用方 / 测试断言用；与只读入口同口径）。 */
  openThoughts(): ThoughtRow[] {
    const rows = this.#db.prepare(
      `SELECT id, ts, content, kind, source, related_concern_id, source_ref, charge, status
         FROM thoughts WHERE status = 'open' ORDER BY id`,
    ).all() as Record<string, unknown>[]
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

  // ============================== history ==============================

  /** history append（append-only 由库层双触发器保证；R-16 同族纪律）。 */
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
    const row = this.#db.prepare(
      'SELECT next_wake_at, last_wake_at, updated_at FROM autonomy_state WHERE id = 1',
    ).get() as
      | { next_wake_at: string; last_wake_at: string | null; updated_at: string }
      | undefined
    if (!row) return undefined
    return {
      nextWakeAt: row.next_wake_at,
      lastWakeAt: row.last_wake_at ?? null,
      updatedAt: row.updated_at,
    }
  }

  /**
   * 单行唤醒时钟 upsert（memory/store.set_autonomy_next_wake 对应物）。
   * R-08：Python 的 select-then-insert/update 在这里由 BEGIN IMMEDIATE 保住原子性。
   */
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

  /**
   * 过去一小时行动总数（memory/store.autonomy_actions_last_hour 对应物：
   * SUM(action_count) WHERE started_at >= cutoff，从 DB 汇总所以重启不清零；
   * cutoff 以 isoformat 形态做字符串比较，同 Python `cutoff.isoformat()` 口径）。
   */
  autonomyActionsLastHour(opts: { now: Date }): number {
    const cutoff = formatPyIso(new Date(opts.now.getTime() - 3_600_000))
    const row = this.#db.prepare(
      'SELECT COALESCE(SUM(action_count), 0) AS n FROM autonomy_runs WHERE started_at >= ?',
    ).get(cutoff) as { n: number }
    return Number(row.n)
  }

  /**
   * 最近 N 次唤醒（W2 快照 `上一拍` 块消费）。
   * 排序键对拍（W1 TODO#5 销账）：Python memory/store.get_autonomy_runs =
   * `ORDER BY started_at DESC`、无次级键 —— 本实现逐字一致。
   */
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

  close(): void {
    this.#db.close()
  }
}
