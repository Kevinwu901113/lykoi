import { regulationField, openThoughts, autonomyState, readMindSchemaVersion } from './queries.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

export const EXPECTED_MIND_SCHEMA_VERSION = 18

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

  const ms = frac === undefined ? 0 : Number(frac.padEnd(3, '0').slice(0, 3))
  let epoch = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms)
  if (zone !== undefined && zone !== 'Z' && zone !== 'z') {
    const sign = zone.startsWith('-') ? -1 : 1
    const offsetMin = sign * (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6)))
    epoch -= offsetMin * 60_000
  }

  const date = new Date(epoch)
  if (Number.isNaN(date.getTime())) {
    throw new Error('lykoi-memory: state timestamp out of range (content withheld — C-22)')
  }
  return date
}

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

export type EpistemicStance
  = 'observed' | 'executed' | 'user_reported' | 'inferred' | 'imagined' | 'simulated'

/** 六值枚举（库层 CHECK 的逐字对应物；顺序 = 设计稿 §3.1 列举序）。 */
export const EPISTEMIC_STANCES: readonly EpistemicStance[] = [
  'observed', 'executed', 'user_reported', 'inferred', 'imagined', 'simulated',
]

export const NON_FACTUAL_EPISTEMIC: readonly EpistemicStance[] = ['imagined', 'simulated']

/**
 * 事实性供给的 SQL 过滤片段（读侧凡向装配/晋升通道供料之处一律挂它）。
 *
 * `IS NULL OR NOT IN (...)` 两段缺一不可：SQL 三值逻辑下 `NULL NOT IN (...)`
 * 求值为 NULL 而非 TRUE，只写后半段会把全部未回填的旧行一起挡在门外（= 她
 * 016 之前的全部经历凭空消失）。
 */
export function factualEpistemicClause(alias: string): string {
  const quoted = NON_FACTUAL_EPISTEMIC.map((s) => `'${s}'`).join(',')
  return `(${alias}.epistemic IS NULL OR ${alias}.epistemic NOT IN (${quoted}))`
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
  /** 认识论第二轴；null = 016 之前的旧行未回填。 */
  epistemic: EpistemicStance | null
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

export interface LykoiMemoryService {
  /** regulation_field 四值（§1.2：四行定长表）。 */
  regulationField(): RegulationFieldRow[]
  /** active 状态的 concerns（§1.2 concerns：idx_concerns_status）。 */
  activeConcerns(): ConcernRow[]
  /** open 状态的 thoughts（§1.2 thoughts：idx_thoughts_status）。 */
  openThoughts(): ThoughtRow[]

  recentHistory(limit: number): HistoryRow[]
  /**
   * 最近 N 条**事实性** experiences（id 降序）。
   * 晋升铁律（设计稿 §3.1）：`imagined|simulated` 不在供给里——这个出口喂的是
   * 快照装配（lykoi-snapshot 的最近经验块），她设想过的事不得从这里以事实身份
   * 进入 prompt。未回填的旧行（epistemic IS NULL）照常供给。
   */
  recentExperiences(limit: number): ExperienceRow[]

  identityBinding(channel: string, channelKey: string): BindingResolution | undefined
  /** autonomy_state 单行（id=1）；表空 → undefined。 */
  autonomyState(): AutonomyStateRow | undefined
}

export class ReadOnlyMemory implements LykoiMemoryService {
  #db: DatabaseSync

  readonly busyTimeoutMs: number

  constructor(dbPath: string) {

    this.#db = new DatabaseSync(dbPath, { readOnly: true })
    try {

      this.#db.exec('PRAGMA busy_timeout = 10000')

      this.#db.exec('PRAGMA query_only = ON')
      const busy = this.#db.prepare('PRAGMA busy_timeout').get() as { timeout: number }
      this.busyTimeoutMs = Number(busy?.timeout ?? 0)
      this.#assertSchemaVersion()
    } catch (err) {
      this.#db.close()
      throw err
    }
  }

  /**
   * 打开即断言 mind_schema MAX(version) == `EXPECTED_MIND_SCHEMA_VERSION`（现 17）；
   * 不等则抛明确错误（不读不认识的 schema）。
   */
  #assertSchemaVersion(): void {
    const version = readMindSchemaVersion(this.#db)
    if (version !== EXPECTED_MIND_SCHEMA_VERSION) {
      throw new Error(
        `lykoi-memory: mind_schema version ${String(version)} != expected `
        + `${EXPECTED_MIND_SCHEMA_VERSION}; the new body must not read a schema it does not `
        + 'understand (WO-M0-STATE-CONTRACT §1.0) — refuse to open, migrate governance-side first',
      )
    }
  }

  regulationField(): RegulationFieldRow[] {
    return regulationField(this.#db)
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
    return openThoughts(this.#db)
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
      `SELECT id, ts, source, content, salience, related_concern_id, integrated, integration_id,
              epistemic
         FROM experiences WHERE ${factualEpistemicClause('experiences')}
         ORDER BY id DESC LIMIT ?`,
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
      epistemic: (r.epistemic ?? null) as EpistemicStance | null,
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
    return autonomyState(this.#db)
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
