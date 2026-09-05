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
import { regulationField, openThoughts, autonomyState, readMindSchemaVersion } from './queries.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'

/**
 * mind_schema 的当前版本（WO-M0-STATE-CONTRACT §1.0）。新体不得读不认识的 schema。
 *
 * 16 = 15 + WO-MEM-SOURCE-01 的 `experiences.epistemic` 列（迁移件
 * `governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql`）。
 * 17 = 16 + WO-MEM-DECAY-01 的 `focus_insight_state.status` 六态 CHECK（新增
 * `dormant`；迁移件
 * `governance/wo/WO-MEM-DECAY-01/migrations/017_focus_insight_dormant.up.sql`）。
 * 「拒开」判定本身逐字未动（仍是 `MAX(version) !== 期望值` 则抛）——本次只是
 * **登记一个新版本号**：改 CHECK 而不升版会让两种物理 schema 同称 16，版本门就
 * 形同虚设（门放行之后才在 `CHECK constraint failed` 上炸，正是这道门要防的事）。
 * 部署纪律因此是「停 → 施加 017 → 起新体」；回滚梯子见 `.down.sql`。
 * 18 = 17 + WO-CONTINUATION-01 的 `pending_continuations` 表（迁移件
 * `governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.up.sql`）。
 * 加表同样升版：旧体不认识这张表也不会读它，但新体的续跑路径**依赖**它存在，
 * 版本门把"表缺席"挡在开库处而不是首次写入处。
 */
export const EXPECTED_MIND_SCHEMA_VERSION = 18

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

// ============================== 认识论第二轴（epistemic） ==============================

/**
 * `experiences.epistemic` 六值（人格分层设计稿 v1 §3.1，D-PERS-1）。
 *
 * 与渠道轴 `experiences.source`（八值 CHECK，从哪来）**正交**：本轴回答的是
 * 认识论地位——该多信、能否当事实引用。同是 `conversation` 渠道，Kevin 说的
 * 话是 `user_reported`，她自己产出的是 `executed`；同是 `thought_lapse`，可以
 * 是 `inferred` 也可以是 `imagined`。source 的八值枚举与 `ExperienceSource`
 * 类型本单逐字未动。
 *
 * `null` = 016 迁移之前写下的旧行未回填（读侧按"非虚构"处理，见
 * `factualEpistemicClause`）。
 */
export type EpistemicStance
  = 'observed' | 'executed' | 'user_reported' | 'inferred' | 'imagined' | 'simulated'

/** 六值枚举（库层 CHECK 的逐字对应物；顺序 = 设计稿 §3.1 列举序）。 */
export const EPISTEMIC_STANCES: readonly EpistemicStance[] = [
  'observed', 'executed', 'user_reported', 'inferred', 'imagined', 'simulated',
]

/**
 * 晋升铁律的排除集（设计稿 §3.1）：`imagined|simulated` 永不自动晋升为事实性
 * 自传记忆——她设想过的事不得在装配/整合里以"我经历过"的身份出现。带标引用
 * （"我曾设想过…"）属后续单；本单只落"排除"。
 */
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
  /**
   * 最近 N 条**事实性** experiences（id 降序）。
   * 晋升铁律（设计稿 §3.1）：`imagined|simulated` 不在供给里——这个出口喂的是
   * 快照装配（lykoi-snapshot 的最近经验块），她设想过的事不得从这里以事实身份
   * 进入 prompt。未回填的旧行（epistemic IS NULL）照常供给。
   */
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
