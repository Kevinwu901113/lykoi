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
 * 时钟纪律（C-23）：新体的 clock 模块尚未移植，本层所有写 API 的 now 一律**必传**
 * （Date），不提供 Date.now() 缺省 —— 避免在 clock.now() 唯一真实读点之外偷读墙钟。
 * TODO(M2-W3): wake 编排落地后由调用方统一注入 clock.now()。
 */
import { DatabaseSync } from 'node:sqlite'
import {
  ABANDON_THRESHOLD,
  applyDeltaValue,
  CAUSES,
  decayCharge,
  decayValue,
  clamp01,
  THOUGHT_LAPSE_SALIENCE,
  THOUGHT_OPEN_CAP,
  type RegulationVariableName,
} from 'lykoi-regulation'
import {
  EXPECTED_MIND_SCHEMA_VERSION,
  parseStateTimestamp,
  type AutonomyStateRow,
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
  /** 本拍衰减过的 open 念头数（含 lapse 的）。 */
  decayed: number
  /** 跌破 ABANDON_THRESHOLD 被 lapse 成 abandoned 的念头 id。 */
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
   * decision JSON —— 由调用方序列化（Python json.dumps 与 JSON.stringify 的
   * 分隔符格式不同，序列化口径归 W2 决策层定，本层不擅代）。
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
        // TODO(M2-W1): charge 并列时的选位口径（charge ASC 内的次序键）未在规格里
        // 钉死，这里取 id ASC（最老优先）；W3 接线前须与 thoughts.py:65-135 对拍。
        const lowest = this.#db.prepare(
          "SELECT id, content, charge, related_concern_id FROM thoughts WHERE status = 'open' "
          + 'ORDER BY charge ASC, id ASC LIMIT 1',
        ).get() as { id: number; content: string; charge: number; related_concern_id: number | null }
        if (!(charge > lowest.charge)) return null // 软拒：不严格大于最低者即拒
        this.#lapseThought(lowest, ts)
      }
      const info = this.#db.prepare(
        `INSERT INTO thoughts (ts, content, kind, source, related_concern_id, source_ref, charge)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(ts, content, kind, source, opts.relatedConcernId ?? null, opts.sourceRef ?? null, charge)
      return Number(info.lastInsertRowid)
    })
  }

  /** 事务内工序：open→abandoned + thought_lapse 经验（SA-175/177 共用；调用方持有事务）。 */
  #lapseThought(
    row: { id: number; content: string; related_concern_id: number | null; charge?: number },
    ts: string,
    newCharge?: number,
  ): void {
    if (newCharge === undefined) {
      this.#db.prepare("UPDATE thoughts SET status = 'abandoned' WHERE id = ?").run(row.id)
    } else {
      this.#db.prepare("UPDATE thoughts SET status = 'abandoned', charge = ? WHERE id = ?")
        .run(newCharge, row.id)
    }
    // TODO(M2-W1): thought_lapse 经验的 content 模板未经与 thoughts.py 对拍（规格只
    // 钉了 source='thought_lapse' 与 salience=0.2）；W3 接线前须逐字校准。
    this.#db.prepare(
      `INSERT INTO experiences (ts, source, content, salience, related_concern_id)
       VALUES (?, 'thought_lapse', ?, ?, ?)`,
    ).run(ts, `[念头消散] ${row.content}`, THOUGHT_LAPSE_SALIENCE, row.related_concern_id)
  }

  /**
   * 注意力域第二道闸（store 层，§2.3 三层闸之 2）：id 不在本拍注入集内即拒。
   * 仅 open→resolved（状态机唯一入口边；非法边由库层触发器兜底）。
   * 返回 false = 拒绝（不在注入集 / 不存在 / 非 open）—— 调用方记 rejected_resolve。
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
   */
  decayAllOpenThoughts(opts: { now: Date }): DecayThoughtsResult {
    const ts = formatPyIso(opts.now)
    return this.#tx(() => {
      const rows = this.#db.prepare(
        "SELECT id, content, charge, related_concern_id FROM thoughts WHERE status = 'open' ORDER BY id",
      ).all() as { id: number; content: string; charge: number; related_concern_id: number | null }[]
      const lapsed: number[] = []
      for (const row of rows) {
        const next = decayCharge(row.charge, 1)
        if (next < ABANDON_THRESHOLD) {
          this.#lapseThought(row, ts, next)
          lapsed.push(row.id)
        } else {
          this.#db.prepare('UPDATE thoughts SET charge = ? WHERE id = ?').run(next, row.id)
        }
      }
      return { decayed: rows.length, lapsed }
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
   * 最近 N 次唤醒（供 W2 快照 `上一拍` 块）。
   * TODO(M2-W2): Python get_autonomy_runs 的排序键未逐字核实，这里按 started_at
   * DESC（业务行全为同一 isoformat 形态，字符串序 == 时间序）；W2 消费前对拍。
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
