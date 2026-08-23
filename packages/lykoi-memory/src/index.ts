/**
 * lykoi-memory — 只读 state 接入（M1 波次 2 交付②）。
 *
 * 数据契约正本：治理仓库 WO-M0-STATE-CONTRACT（C-01..C-30 / R-01..R-20）。
 * 蓝图（docs/m1_blueprint.md 包布局）：只读接 state 副本；M1 全程只读；
 * R-01 硬规则：绝不写真 state——本包落实为三重：
 *   1) 连接层 `readOnly: true` 打开（写在连接层物理不可能，学 salience_shadow
 *      的 mode=ro URI 纪律，WO-M0-STATE-CONTRACT §2 末）；
 *   2) `PRAGMA query_only = ON` 纵深防御（学 permission_evidence 只读连接，§3.4）；
 *   3) 服务面零写方法（测试有 R-01 绊线：prototype 上不得出现写形状的方法名）。
 *
 * 引擎取舍（蓝图波次 2 提示 better-sqlite3，本包用 Node 24 内建 node:sqlite）：
 * DatabaseSync 支持 readOnly 打开 + PRAGMA + prepare/get/all，M1 只读面所需
 * 能力齐备且零原生依赖（供应链面更小）；若后续波次需要其缺失能力再议 better-sqlite3。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

/** mind_schema 的当前版本（WO-M0-STATE-CONTRACT §1.0）。新体不得读不认识的 schema。 */
export const EXPECTED_MIND_SCHEMA_VERSION = 15

// ============================== C-22 时间戳 ==============================

/**
 * C-22：memory.db 内并存两种 ISO 格式——
 *   业务行：`isoformat()` 形态，`+00:00` 偏移，微秒精度且尾随零省略；
 *   迁移台账：`strftime('%Y-%m-%dT%H:%M:%fZ')` 形态，`Z` 后缀，固定毫秒三位。
 * 字符串排序在两种格式混排时不可靠 → 读侧统一 parse（本函数），写侧不归本包（R-01）。
 * C-24：历史行存在无 tz 的 naive 时间戳，一律按 UTC 处理。
 *
 * 隐私纪律：解析失败的错误信息不回显输入内容（时间戳来自她的行，不入日志）。
 */
const STATE_TS_RE
  = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|z|[+-]\d{2}:\d{2})?$/

export function parseStateTimestamp(text: string): Date {
  const match = typeof text === 'string' ? STATE_TS_RE.exec(text) : null
  if (!match) {
    throw new Error(
      'lykoi-memory: unparseable state timestamp '
      + `(len=${typeof text === 'string' ? text.length : 'n/a'}; content withheld — C-22)`,
    )
  }
  const [, y, mo, d, h, mi, s, frac, zone] = match
  // 分量范围校验（Date.UTC 会静默进位，这里不允许 2026-13-99 这类形似值溜过去）。
  if (
    Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31
    || Number(h) > 23 || Number(mi) > 59 || Number(s) > 59
  ) {
    throw new Error('lykoi-memory: state timestamp component out of range (content withheld — C-22)')
  }
  // 小数位补/截到毫秒三位（微秒尾数在 JS Date 精度外，截断；C-22 读侧统一口径）。
  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3))
  let epoch = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms)
  if (zone !== undefined && zone !== 'Z' && zone !== 'z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const offsetMin = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
    epoch -= offsetMin * 60_000
  }
  // zone 缺席（naive）：按 UTC（C-24），即不做任何偏移调整。
  const date = new Date(epoch)
  if (Number.isNaN(date.getTime())) {
    throw new Error('lykoi-memory: state timestamp out of range (content withheld — C-22)')
  }
  return date
}

/** C-22 便捷口径：统一成 epoch ms 后可安全比较/排序（两种格式混排也正确）。 */
export function stateTimestampMs(text: string): number {
  return parseStateTimestamp(text).getTime()
}

// ============================== 行类型 ==============================

export interface RegulationFieldRow {
  name: 'coherence' | 'load' | 'relational_tension' | 'exploration_hunger'
  value: number
  baseline: number
  updatedAt: string
}

export interface ConcernRow {
  id: number
  kind: string
  title: string
  description: string
  weight: number
  origin: string
  parentId: number | null
  status: string
  createdAt: string
  lastLitAt: string | null
  litCount: number
}

export interface ThoughtRow {
  id: number
  ts: string
  content: string
  kind: string
  source: string
  relatedConcernId: number | null
  sourceRef: string | null
  charge: number
  status: string
}

export interface HistoryRow {
  id: number
  ts: string
  eventType: string
  content: string
}

export interface ExperienceRow {
  id: number
  ts: string
  source: string
  content: string
  salience: number
  relatedConcernId: number | null
  integrated: number
  integrationId: number | null
}

export interface BindingResolution {
  userId: string
  /** users.role（§1.2 users：owner_primary 部分唯一索引保证至多一个 owner）。 */
  role: 'owner_primary' | 'group_member' | 'agent'
  userStatus: 'active' | 'archived'
}

export interface AutonomyStateRow {
  nextWakeAt: string
  lastWakeAt: string | null
  updatedAt: string
}

/**
 * 只读 state 服务面（M1「能感知」首批 API）。
 * R-01：接口上没有也永远不会有写方法。
 */
export interface LykoiMemoryService {
  /** regulation_field 四值（§1.2：四行定长表）。 */
  regulationField(): RegulationFieldRow[]
  /** active 状态的 concerns（§1.2 concerns：idx_concerns_status）。 */
  activeConcerns(): ConcernRow[]
  /** open 状态的 thoughts（§1.2 thoughts：idx_thoughts_status）。 */
  openThoughts(): ThoughtRow[]
  /** 最近 N 条 history（id 降序；history 是 AUTOINCREMENT，id 单调，C-26）。 */
  recentHistory(limit: number): HistoryRow[]
  /** 最近 N 条 experiences（id 降序）。 */
  recentExperiences(limit: number): ExperienceRow[]
  /**
   * identity_bindings 查询：channel+channel_key → user（JOIN users 带出 role）。
   * 查无此绑定 → undefined（S-06/S-09 的 fail-closed 前提：未知即未绑定）。
   */
  identityBinding(channel: string, channelKey: string): BindingResolution | undefined
  /** autonomy_state 单行（id=1）；表空 → undefined。 */
  autonomyState(): AutonomyStateRow | undefined
}

// ============================== 实现 ==============================

export class ReadOnlyMemory implements LykoiMemoryService {
  #db: DatabaseSync
  /** 连接实际生效的 busy_timeout（观测位，供测试断言 C-01 口径）。 */
  readonly busyTimeoutMs: number

  constructor(dbPath: string) {
    // R-01 ①：readOnly 连接——写在连接层物理不可能。
    this.#db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      // C-01（mind 口径）：busy_timeout=10000。其余 C-01 条款（isolation/foreign_keys）
      // 是写侧纪律，只读连接不适用；不设 WAL（C-29：memory.db 现行 rollback journal，
      // 切 WAL 是 M1 之后的独立决策项，只读连接更不得改 journal 模式）。
      this.#db.exec('PRAGMA busy_timeout = 10000')
      // R-01 ②：query_only 纵深防御（学 §3.4 permission_evidence 只读连接）。
      this.#db.exec('PRAGMA query_only = ON')
      const busy = this.#db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
      this.busyTimeoutMs = Number(busy?.timeout ?? 0)
      this.#assertSchemaVersion()
    } catch (err) {
      this.#db.close()
      throw err
    }
  }

  /** 打开即断言 mind_schema MAX(version) == 15；不等则抛明确错误（不读不认识的 schema）。 */
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
        + `${EXPECTED_MIND_SCHEMA_VERSION}; the new body must not read a schema it does not `
        + 'understand (WO-M0-STATE-CONTRACT §1.0) — refuse to open, migrate governance-side first',
      )
    }
  }

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

  activeConcerns(): ConcernRow[] {
    const rows = this.#db.prepare(
      `SELECT id, kind, title, description, weight, origin, parent_id, status,
              created_at, last_lit_at, lit_count
         FROM concerns WHERE status = 'active' ORDER BY id`,
    ).all() as Record<string, unknown>[]
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

  recentHistory(limit: number): HistoryRow[] {
    assertLimit(limit)
    const rows = this.#db.prepare(
      'SELECT id, ts, event_type, content FROM history ORDER BY id DESC LIMIT ?',
    ).all(limit) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r.id as number,
      ts: r.ts as string,
      eventType: r.event_type as string,
      content: r.content as string,
    }))
  }

  recentExperiences(limit: number): ExperienceRow[] {
    assertLimit(limit)
    const rows = this.#db.prepare(
      `SELECT id, ts, source, content, salience, related_concern_id, integrated, integration_id
         FROM experiences ORDER BY id DESC LIMIT ?`,
    ).all(limit) as Record<string, unknown>[]
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

  identityBinding(channel: string, channelKey: string): BindingResolution | undefined {
    if (typeof channel !== 'string' || typeof channelKey !== 'string') return undefined
    const row = this.#db.prepare(
      `SELECT b.user_id, u.role, u.status
         FROM identity_bindings b JOIN users u ON u.id = b.user_id
        WHERE b.channel = ? AND b.channel_key = ?`,
    ).get(channel, channelKey) as
      | { user_id: string; role: string; status: string }
      | undefined
    if (!row) return undefined
    return {
      userId: row.user_id,
      role: row.role as BindingResolution['role'],
      userStatus: row.status as BindingResolution['userStatus'],
    }
  }

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

  close(): void {
    this.#db.close()
  }
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TypeError('lykoi-memory: limit must be a non-negative integer')
  }
}

// ============================== cordis 插件面 ==============================

declare module '@deepseek-ai/cordis' {
  interface Context {
    lykoiMemory: LykoiMemoryService
  }
}

export const name = 'lykoi-memory'
export const inject: string[] = []

export interface Config {
  /** state 副本 db 路径（相对进程 cwd 解析）。必填无默认：不猜她的 state 在哪。 */
  dbPath: string
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
})

export function apply(ctx: Context, config: Config) {
  const memory = new ReadOnlyMemory(resolve(config.dbPath))
  // 可逆副作用：fiber 卸载即关连接。
  ctx.effect(() => () => memory.close(), 'lykoi-memory readonly connection')
  ctx.provide('lykoiMemory', memory)
}
