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
 *
 * 遥测纪律（W3 新增 TODO#1 定案，W4 落地）：Python 侧 store/thoughts 的内部
 * log_event 位（thought_resolve_rejected / release_rejected_non_dormant /
 * focus_cycle_* / rule_suggestion_* …）在新体走**构造注入**而非编排层补发——
 * 决定性理由：resolveThought 的三条拒绝分支（集外/不存在/非 open）对调用方
 * 只是同一个 false，编排层不重复读库就无法还原 Python 的事件粒度；把发射点
 * 与写点钉在同一处也消灭"写了没报/报了没写"的漂移。接法 = `new
 * ReadWriteMemory(path, { logEvent })`，缺省 no-op（rw 保持纯库形态，不知道
 * audit 的存在）；wake 编排把 auditLogEvent 递进来。事件是遥测不是控制流：
 * 全部在事务 COMMIT 之后发（拒绝类事件在拒绝点发），发射失败由注入方自吞。
 */
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

/** WO-CONTINUATION-01 D-1：pending_continuations 的一行（列名 snake_case 原样）。 */
export interface PendingContinuationRow {
  id: string
  origin_turn_id: string
  origin_run_id: string | null
  goal: string
  due_at: string
  state: ContinuationState
  terminal_reason: string | null
  run_id: string | null
  created_at: string
  updated_at: string
}

export type ContinuationState = 'pending' | 'running' | 'completed' | 'failed' | 'expired'
export const CONTINUATION_TERMINAL_STATES: readonly ContinuationState[]
  = Object.freeze(['completed', 'failed', 'expired'])

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

// ============================== W4 学习环状态层（常量与类型） ==============================

/** 行原形（snake_case 列名的 plain object，同 Python dict）——W4 起新方法的返回形态。 */
export type RawRow = Record<string, unknown>

/** Python 字符串切片的码点口径（answer_text[:2048] 一类的有界裁剪）。 */
function cpSlice(s: string, n: number): string {
  const cps = [...s]
  return cps.length <= n ? s : cps.slice(0, n).join('')
}

/** 层 1 取料水位线键（store.py:1357）。 */
export const L2_INTAKE_WATERMARK_KEY = 'l2_intake_watermark_id'
/** 层 2 节律计数键（store.py:1701）。 */
export const L4_FOCUS_WAKES_KEY = 'l4_focus_wakes_since'
/**
 * SA-91 取料口 WHERE 片段（store.py:1380-1381 逐字）+ WO-MEM-SOURCE-01 的晋升
 * 铁律：整合管线是"经验 → 叙事（自传）"的晋升通道，`imagined|simulated` 在此
 * 被排除，未回填的旧行（NULL）照常取料。
 */
const INTAKE_CLAUSE = "ec.class = 'working' AND e.integrated = 0 AND e.id > ?"
  + ` AND ${factualEpistemicClause('e')}`

const NARRATIVE_TRIGGERS: readonly string[] = ['integration', 'owner_edit']
const NARRATIVE_CLASSES: readonly string[]
  = ['absorption', 'reflection', 'narrative_only', 'legacy', 'owner_edit']
const THREAD_KIND_ENUM: readonly string[]
  = ['open_question', 'commitment', 'suspended_tension', 'arc']
const THREAD_STATUS_ENUM: readonly string[] = ['open', 'suspended', 'resolved', 'absorbed']
/** focus_cycles.outcome 枚举（store.py:1714 逐字）。 */
export const FOCUS_OUTCOME_ENUM: readonly string[]
  = ['idle', 'advanced', 'revised', 'no_progress', 'failed']
/**
 * SA-129 insight 状态机——WO-MEM-DECAY-01（D-1）起为**六态**：前五态
 * （store.py:1715 逐字）+ `dormant`。`dormant` = 久未被 L4 再触达而退出装配的
 * 转正结论：不销毁、可被重申点亮回 active（recordFocusInsight 的点亮分支）。
 * 与 `withdrawn` 严格区分——那是被证据推翻，这只是久未重申。
 * 本常量与 schema.ts 的 focus_insight_state CHECK 是同一份枚举的两个面。
 */
export const FOCUS_INSIGHT_STATUS_ENUM: readonly string[]
  = ['shadow', 'active', 'contested', 'revised', 'withdrawn', 'dormant']

/**
 * WO-PERS-OVERLAY-01（D-2）：`insights.category` 的第四个值——**按对话者键控**的
 * 相处方式结论（L4 从 `relationship_thread` 关切深挖出来的那些）。
 *
 * 它与 `focus` 的区别只有一条：`focus` 是"她自己想明白的事"，对谁都成立；
 * `relationship` 是"她和**这个人**相处的方式"，脱开那个人就没有意义——所以它必须
 * 带一个键（`memory_scopes` 实体轴，见 scopeInsightSubject），而 `focus` 不带。
 * 两者共用同一套状态机（`focus_insight_state` 六态、影子门、衰减、点亮）：多一个
 * 维度不该多一套骨架。分流只发生在**读口**（promotedFocusInsights /
 * promotedRelationshipInsights），因此零 schema 变更。
 *
 * 与 `FOCUS_INSIGHT_CATEGORY` 同样**由代码钉死、不由 LLM 选**（判别式是关切的
 * kind）。`PERSONA_PROJECTION_CATEGORIES`（persona/preference）不含它：overlay
 * 不进 decide 共用投影，只进对话路径——与转正结论同一口径。
 *
 * 正本在此。`lykoi-learn/src/shared.ts` 持一份副本以守住 learn 的 import 面
 * （与 `LINEAGE_*` 六常量同一范式），逐字相等由 boundary.test.ts 断言。
 */
export const RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'

// SA-131 血缘的产物/原料类型词汇（store.py:1706-1712 逐字）。**不是 CHECK 约束**
// ——表是多态的，词汇钉死在 schema 里等于每加一类产物就要一次迁移。对齐面在此。
export const LINEAGE_PRODUCT_INSIGHT = 'insight'
export const LINEAGE_PRODUCT_CONCERN = 'concern'
export const LINEAGE_PRODUCT_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_SUGGESTION = 'rule_suggestion'
export const LINEAGE_SOURCE_EXPERIENCE = 'experience'
export const LINEAGE_SOURCE_CONCERN = 'concern'
export const LINEAGE_SOURCE_INSIGHT = 'insight'

/** SA-143：三种建议 kind，与 _V14 的 CHECK 枚举同源（store.py:2224 逐字）。 */
export const RULE_SUGGESTION_KINDS: readonly string[]
  = ['concern_release', 'permission_rule', 'standing_grant']
const SUGGESTION_STATUS_ENUM: readonly string[]
  = ['pending', 'asked', 'accepted', 'declined', 'expired', 'applied_by_owner']
/**
 * 状态机的边，写成数据而不是散在 if 里（store.py:2230-2240 逐字）。值 = 允许的
 * **来源**状态集合。applied_by_owner 由 owner console 打——**她自己没有任何路径
 * 打到它**；pending ← declined/expired 是冷却期满后的再武装。
 */
export const SUGGESTION_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  asked: ['pending'],
  accepted: ['asked'],
  declined: ['asked'],
  expired: ['asked'],
  applied_by_owner: ['accepted'],
  pending: ['declined', 'expired'],
}

/**
 * WO-P4R12 项2 红线 #3 候选闸的拒绝类型（store.py ReleaseCandidacyError 对应物）：
 * 非 dormant 的释放在物理层被拒。
 */
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

// ============================== 实现 ==============================

/** store 层遥测发射面（W3 TODO#1 定案：注入，缺省 no-op；形状同 lykoi-decide 的 LogEvent）。 */
export type StoreLogEvent = (name: string, fields: Record<string, unknown>) => void

export class ReadWriteMemory {
  #db: DatabaseSync
  /** store 层遥测（见文件头"遥测纪律"）。telemetry records, it does not gate。 */
  #log: StoreLogEvent
  /** 连接实际生效的 busy_timeout（观测位，供测试断言 C-01 口径）。 */
  readonly busyTimeoutMs: number

  constructor(dbPath: string, opts?: { logEvent?: StoreLogEvent }) {
    // 显式 rw：这是整个包唯一会以写模式打开 state 的入口。
    this.#log = opts?.logEvent ?? (() => {})
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
   *
   * SA-86/88（WO-L1）：档案/原料分流与经验写入**同事务**（store.py:761-767 逐字
   * 理由：不存在"经验已落库但没有分类"的中间态——否则层 1 取原料时会漏掉刚写
   * 的这条,而它恰恰是最新的）。判据是纯函数（lykoi-learn/l1，SA-83），这里不做
   * 任何额外判断；INSERT OR IGNORE = 回填与实时写入相遇时先到者胜且答案相同。
   * pending 计数随写同步（_sync_pending 对应物）。
   *
   * WO-MEM-SOURCE-01：每条新经验都带认识论第二轴 `epistemic`——缺省由渠道推导
   * （`deriveEpistemic`，映射表 = 设计稿 §3.1），写入方可显式覆盖。新行**永不**
   * 落 NULL：NULL 的含义被 016 迁移钉死为"旧行未回填"，写路径再产 NULL 会把
   * 这个区分弄脏。
   */
  recordExperience(
    source: ExperienceSource,
    content: string,
    opts: {
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
      const info = this.#db.prepare(
        `INSERT INTO experiences (ts, source, content, salience, related_concern_id, epistemic)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(ts, source, content, salience, opts.relatedConcernId ?? null, epistemic)
      const id = Number(info.lastInsertRowid)
      this.#recordClassInTx(id, source, content, ts)
      pending = this.#syncPendingInTx()
      return id
    })
    // 事件字段面不动：`mind_experience` 是 Python 逐字字段的对拍面
    // （rw-w4.test.ts:45 精确 deepEqual），第二轴不往里塞。
    this.#log('mind_experience', { id: experienceId, source, salience, pending })
    return experienceId
  }

  /** SA-88：分类行与经验同生共死（调用方持有事务；experience_class.record_class_in_tx 对应物）。 */
  #recordClassInTx(experienceId: number, source: string, content: string | null, classifiedAt: string): void {
    this.#db.prepare(
      'INSERT OR IGNORE INTO experience_class '
      + '(experience_id, class, classified_at, rule_version) VALUES (?,?,?,?)',
    ).run(experienceId, classifyExperience(source, content), classifiedAt, RULE_VERSION)
  }

  /**
   * mind/store._sync_pending 对应物（调用方持有事务）：W1 environment 事实是
   * 耐久沉积——不计入旧口径 pending（integration_state.experiences_pending 列）。
   * 该列在新体只是账面列（触发闸走 countIntakePending 的 intake 口径，SA-90）。
   */
  #syncPendingInTx(): number {
    const row = this.#db.prepare(
      "SELECT COUNT(*) AS n FROM experiences WHERE integrated = 0 AND source <> 'environment'",
    ).get() as { n: number }
    this.#db.prepare(
      'UPDATE integration_state SET experiences_pending = ? WHERE id = 1',
    ).run(row.n)
    return Number(row.n)
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
    // mind_regulation（store.py:276）：value_after 圆整 4 位仅是遥测呈现，非认知值。
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
   *
   * WO-MEM-SOURCE-01 刻意不加 epistemic 过滤：这是账面口径（Python 逐字对应物），
   * 不是供给口径。晋升铁律落在真正的供给通道上——取料/触发闸走
   * `INTAKE_CLAUSE`、快照走 `recentExperiences`、检索走 `relevanceCandidateRows`，
   * 三处都排除 imagined|simulated。代价是虚构行会把这个计数抬高，但它不决定
   * 任何一条经验是否进整合。
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

  /**
   * 最近 N 条**事实性**经验（mind/store.recent_experiences 对应物：ORDER BY id DESC）。
   *
   * 晋升铁律（设计稿 §3.1，WO-MEM-SOURCE-01）：这个出口是快照装配的最近经验块
   * （lykoi-snapshot experienceBlock），`imagined|simulated` 在此被排除——她设想
   * 过的事不得以"我经历过"的身份进 prompt。未回填的旧行（NULL）照常供给。
   */
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

  // ============================== 身份登记处读面（W5） ==============================

  /**
   * owner_primary 用户 id（mind/store.owner_primary_user_id 逐字对应）：
   * schema（WO-P2-01）的部分唯一索引保证该行至多一个 —— "the owner" 是一行，
   * 永远不是硬编码特例。没绑 owner → null。L3 实体轴（对话路径的 subject）读它。
   */
  ownerPrimaryUserId(): string | null {
    const row = this.#db.prepare(
      "SELECT id FROM users WHERE role = 'owner_primary' AND status = 'active' LIMIT 1",
    ).get() as { id: string } | undefined
    return row?.id ?? null
  }

  /**
   * 器官清单的身份/设备两条轴（mind/store.identity_binding_inventory 逐字对应；
   * SA-161/D5 定界）：每条绑定的 (channel, user_id, display_name, role)，按
   * channel, user_id 排序。**只读，且刻意不返回 channel_key** —— 那是渠道内的
   * 寻址标识（Telegram 的 chat id）；器官清单要回答的是"我长着什么"，寻址是
   * 另一个问题。少给一列，清单就少一样可以被不可信输入引用的东西。
   *
   * users 表在极早期 fixture 里可能还没有对应行 —— LEFT JOIN 让一条孤儿绑定
   * 仍然出现在清单里（role/display_name 为 null）：一个绑定存在却不显示，
   * 比显示得不完整坏得多。
   */
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

  /**
   * (channel, channel_key) 绑到的 user_id，未绑定 null
   * （mind/store.identity_binding_user_id 逐字对应；M3-W1 新增读点）。
   * 消费方：lykoi-kernel scope key 的 messenger 轴（setIdentityBindingLookup
   * 注入）—— 绑定过的收件人塌到稳定 user 键，未绑定停在更窄的 channel 键。
   * 只读；绑定本身永不在此写 —— 首次绑定是 owner 侧的显式手工动作。
   */
  identityBindingUserId(channel: string, channelKey: string): string | null {
    const row = this.#db.prepare(
      'SELECT user_id FROM identity_bindings WHERE channel = ? AND channel_key = ?',
    ).get(channel, channelKey) as { user_id: string } | undefined
    return row?.user_id ?? null
  }

  /**
   * owner 在某个渠道上的 channel_key，没绑就是 null
   * （mind/store.owner_channel_key:1674-1694 逐字对应；M3-W3 新增读点）。
   *
   * identityBindingUserId 的**反向**：那个是"这个人是谁"，这个是"他在哪儿" ——
   * 一条她主动发起的问询需要知道往哪个对话里问，而"哪个对话"只能来自已登记
   * 的绑定，**不能是硬编码或环境变量里的一个 chat id**（那等于绕开 P2-01 的
   * 身份层）。SK-51 的 `_owner_context` 与 SK-79 出站投递的 chat_id 都只认这
   * 一个口。绑定仍然只读、绝不在这里写。
   */
  ownerChannelKey(channel: string): string | null {
    const owner = this.ownerPrimaryUserId()
    if (!owner) return null
    const row = this.#db.prepare(
      'SELECT channel_key FROM identity_bindings WHERE channel = ? AND user_id = ? '
      + 'ORDER BY channel_key LIMIT 1',
    ).get(channel, owner) as { channel_key: string } | undefined
    return row?.channel_key ?? null
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

  /**
   * 注意力域第二道闸（store 层，§2.3 三层闸之 2）：id 不在本拍注入集内即拒。
   * 仅 open→resolved（状态机唯一入口边；非法边由库层触发器兜底）。
   * 返回契约对拍（W1 TODO#4 销账）：thoughts.py:138-171 逐字一致 ——
   * 集外 → false / 不存在 → false / 非 open → false / 成功 open→resolved → true；
   * 拒绝路径零副作用。遥测（W3 TODO#1 落地）：thought_resolve_rejected 带
   * Python 逐字 reason（not_in_injected_set / not_found / not_open）、成功发
   * thought_resolved —— 三条拒绝分支只有 store 自己分得清，这正是"注入而非
   * 编排层补发"的定案理由。
   */
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
   * 「仅整合路径可调」的静态扫描绊线已随 W4 立起（lykoi-learn 的 boundary 测试：
   * 全仓 src 内 `.settleThought(` 调用点唯 lykoi-learn/src/l2.ts —— W1 TODO 销账）。
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
    return autonomyState(this.#db)
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

  // ============================== W4 · L1/L2 取料口与整合写面 ==============================
  // 学习环各层（lykoi-learn）零 SQL——五张 _V13/_V14 影子表与取料口全部只经这里
  // 读写（蓝图 §0 单写者纪律；store.py:1697-1699 逐字姿态）。新体 W4 起的方法
  // 返回**行原形**（snake_case 列名的 plain object，同 Python dict）——学习环的
  // payload/血缘按列名取数，映射层是多余的漂移点。

  /** 读一个学习层标量状态（learning_layer_state 键值表），缺键返回 null。 */
  getLearningLayerState(key: string): number | null {
    const row = this.#db.prepare(
      'SELECT value FROM learning_layer_state WHERE key = ?',
    ).get(key) as { value: number } | undefined
    return row ? Number(row.value) : null
  }

  /**
   * SA-92：层 1 取料水位线——只有 experiences.id 严格大于它的原料进 nightly 队列。
   * 值由活体迁移 _V12 在上线那一刻写死为当时的 MAX(experiences.id)；缺键返回 0
   * ——"没有历史积压需要豁免"，这正是空库该有的语义（store.py:1370-1377 逐字）。
   */
  getIntakeWatermarkId(): number {
    return this.getLearningLayerState(L2_INTAKE_WATERMARK_KEY) ?? 0
  }

  /**
   * SA-91：nightly 消化队列（store.py:1384-1420 逐字）——原料池未消化项中，
   * 水位线**之上**的那些：`class='working' AND integrated = 0 AND id > watermark`。
   * 与被取代的 pending_experiences 相比两处实质变化：① source<>'environment'
   * 硬排除没有了（1178 条关于 Kevin 的感知被一行 SQL 挡在门外 55 天）；② 多了
   * 水位线（补消化 1178 条是伪需求）。bySalience 按显著性降序（同分 id 升序，
   * 确定性），否则时间序（id 升序）。limit=null 不设上限。
   */
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

  /**
   * SA-90：队列长度（intakePending 的口径）。整合触发闸读它——触发闸必须与
   * 取料口同口径：若闸门还读旧的 countPendingExperiences，一个只有感知流入的
   * 夜晚会被判成 "no_pending" 而永不整合（store.py:1426-1428 逐字）。
   */
  countIntakePending(): number {
    const floor = this.getIntakeWatermarkId()
    const row = this.#db.prepare(
      `SELECT COUNT(*) AS n FROM experiences AS e
         JOIN experience_class AS ec ON ec.experience_id = e.id
         WHERE ${INTAKE_CLAUSE}`,
    ).get(floor) as { n: number }
    return Number(row.n)
  }

  /** integration_state 单行（G-4 墙钟锚读 last_integration_at；wakes_since 现为账面列）。 */
  getIntegrationState(): RawRow {
    const row = this.#db.prepare('SELECT * FROM integration_state WHERE id = 1').get() as
      | RawRow
      | undefined
    if (!row) {
      throw new Error('lykoi-memory: integration_state row missing (schema violation)')
    }
    return row
  }

  /**
   * 整合消化（store.py:1244-1262 逐字）：只翻 integrated/integration_id 标记
   * （schema 触发器保证其余列动不了，且 0→1 仅一次）。返回实际翻转行数。
   */
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

  /** 整合收尾（store.py:1544-1556）：记录时间、清零 wake 计数、重算 pending。 */
  resetIntegrationCycle(opts: { now: Date }): void {
    this.#tx(() => {
      this.#db.prepare(
        'UPDATE integration_state SET last_integration_at = ?, wakes_since = 0 WHERE id = 1',
      ).run(formatPyIso(opts.now))
      this.#syncPendingInTx()
    })
    this.#log('mind_integration_cycle_reset', {})
  }

  /**
   * 释放（store.py:425-464 逐字语义）：只能由整合期的她或 owner 后门调用（红线
   * #3）。requires a non-empty reason。WO-P4R12 项2 物理层候选闸：仅 dormant 放行
   * ——拒绝点在 store 发 release_rejected_non_dormant（不依赖上层是否 catch）。
   * viaOwner=true 是 owner 后门，绕过候选闸；reason 校验与"已释放"检查依然生效。
   */
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

  /** 单行读（store.py:505-511）。 */
  getConcern(concernId: number): RawRow | null {
    const row = this.#db.prepare('SELECT * FROM concerns WHERE id = ?').get(concernId) as
      | RawRow
      | undefined
    return row ?? null
  }

  /**
   * SA-99 物理闸（store.py:516-571 逐字）：narrative_versions 的 INSERT 仲裁在
   * **store 而不是 integrator 的约定**。strict-empty（acceptedOps<=0）→ INSERT
   * 被跳过（行根本不进表，连全量读也浮不出）；absorb-lie（class='absorption'
   * 且 expOps<=0）→ 拒绝。两条都是**纯计数**，change_summary 自由文本从不被
   * 检查。acceptedOps === null 标记 TRUSTED caller（owner_edit / legacy backfill /
   * test seed），旁路闸门——owner 写入缝。返回新版本 id，被拒返回 null。
   */
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

  /** 建叙事线（store.py:615-632）：起始 status='open'。 */
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

  /**
   * 线更新（store.py:635-669）：解决/吸收必须留下交代（resolution）——这是她对
   * 一条线的告别,不许默默关掉。
   */
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

  /** open 念头按注意力序（thoughts.py:245-260：charge DESC, ts ASC, id ASC，无上限）。 */
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

  /**
   * insights 写口（memory/store.upsert_insight 对应物）：按 (category, content)
   * 去重——已存在只刷 updated 并返回原 id。重申语义（SA-133）建立在这上面。
   */
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

  /**
   * WO-PERS-OVERLAY-01（D-3）：给一条 insight 登记实体轴——"这一行是关于谁的"。
   * 返回 true = 这一次真写进去了；false = 主键 (table_name,row_id) 已存在，原样不动。
   *
   * **这是 TS 体第一个 `memory_scopes` 的运行期写者。** 在此之前该表只有 Python 期
   * 的回填数据与四处读（检索实体轴、focusCandidates 联查），STATE-CONTRACT 报告
   * 原注"只回填，无运行时写者"到此为止。写面**只限 insights 行**：其余表的实体轴
   * 谁来写、按什么口径写，是另外的问题，不在这一单里顺手决定。
   *
   * `INSERT OR IGNORE` 而不是 upsert，语义是**键在首次落地时钉死**：同一条结论被
   * 重申、被降 dormant 又被点亮，键都不动。一条相处方式结论中途改认对象，那不是
   * 同一条结论，该是新的一条——让它悄悄改键，等于允许历史被重写。
   *
   * 形状按 P2-01：`origin_context` NULL（结论不属于任何一次具体对话，它是跨对话
   * 沉淀出来的）、`visibility` private、`sensitivity` content。
   *
   * FK `subject_user_id REFERENCES users(id)` 在 `PRAGMA foreign_keys = ON` 下真的
   * 生效：传一个不存在的 user id 会抛，而不是静默落一行指向空气的键。调用方要么
   * 给一个真实的键，要么走"不键控"的那条路（见 L4 的 unkeyed 分支），没有第三条。
   */
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

  /**
   * L3 检索的唯一 SQL（relevance._candidate_rows 对应物，relevance.py:327-390 逐字）：
   * 硬过滤（实体/时间）+ 关键词 OR 预筛，拉回候选行。**只读，一条 SELECT。**
   * "怎么算相关"不在这里——SQL 只负责把全表缩到候选集（预筛比打分宽），命中
   * 定稿在 lykoi-learn/l3 的打分函数。
   *
   * SA-116 第二道保险：%/_/\\ 按字面转义（词项本身已不含通配符——切段时被当
   * 分隔符丢了；任何将来放宽切段规则的改动都不会让 % 通配整个档案）。已知窄口
   * （relevance.py:338-341）：LIKE 比对**未归一** content，全角英文会漏——中文
   * 不受影响，接受的取舍不是 bug。experience_class 用 LEFT JOIN：影子表缺行不该
   * 让真实经验从检索域消失；memory_scopes 主键 (table_name,row_id) 保证实体轴
   * JOIN 至多配一行，不放大结果。
   */
  relevanceCandidateRows(opts: {
    terms: readonly string[]
    subjectUserId: string | null
    since: string | null
    until: string | null
  }): RawRow[] {
    // WO-MEM-SOURCE-01 晋升铁律：检索命中会被当作"我记得的事"装配进对话，
    // `imagined|simulated` 因此不在候选域里（NULL 旧行照常在）。这一条无条件
    // 挂上，不受 terms/实体/时间轴任何一路过滤是否为空的影响。
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

  // ============================== W4 · 层 2 专注思考状态层（store.py:1697-2213） ==============================

  /** 层 2 节律计数（store.py:1718-1720；G-4 后为账面列，触发闸走墙钟锚）。缺键 = 0。 */
  getFocusWakesSince(): number {
    return this.getLearningLayerState(L4_FOCUS_WAKES_KEY) ?? 0
  }

  /**
   * 一次层 2 周期收尾（store.py:1723-1741）：节律计数**无条件**清零——层 2 的
   * 空转意味着"今晚确实没有可想的关切"，来了就算数。G-4 后触发闸读的墙钟锚是
   * focus_cycles.started_at（见 latestFocusCycleStartedAt），本方法保留 Python
   * 写形（计数器账面 + 写集对拍）。
   */
  resetFocusCycle(opts: { now: Date }): void {
    this.#tx(() => {
      this.#db.prepare(
        `INSERT INTO learning_layer_state (key, value, set_at) VALUES (?, 0, ?)
         ON CONFLICT(key) DO UPDATE SET value = 0, set_at = excluded.set_at`,
      ).run(L4_FOCUS_WAKES_KEY, formatPyIso(opts.now))
    })
  }

  /**
   * SA-122（store.py:1746-1764）：开周期行，返回**周期序号**（= focus_cycles.id）。
   * 先开行再选关切：防自恋硬规则按序号取模，序号必须在选择之前确定。行以
   * outcome='idle' 落地——进程中途死掉留下的是诚实空转记录，而不是没有记录。
   */
  openFocusCycle(opts: { now: Date }): number {
    const cycleId = this.#tx(() => {
      const info = this.#db.prepare('INSERT INTO focus_cycles (started_at) VALUES (?)')
        .run(formatPyIso(opts.now))
      return Number(info.lastInsertRowid)
    })
    this.#log('focus_cycle_opened', { cycle_id: cycleId })
    return cycleId
  }

  /** 周期收尾写回台账行（store.py:1767-1803）；match_reasons 存 JSON 文本（§3.7 上一跳）。 */
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

  /**
   * G-4 墙钟锚（focus 侧）：最近一次周期的 started_at；一个周期都没跑过 → null。
   * 台账行由 openFocusCycle 在**每一种**周期开头写（空转/失败/成功都算），所以
   * 这个读数天然就是"上一次来过"的墙钟时刻——Python 的无条件 reset_focus_cycle
   * 语义在墙钟锚下的对应物。
   */
  latestFocusCycleStartedAt(): string | null {
    const row = this.#db.prepare(
      'SELECT MAX(started_at) AS ts FROM focus_cycles',
    ).get() as { ts: string | null } | undefined
    return row?.ts ?? null
  }

  /** 当前（=最近开出的）周期序号；一个都没有 → 0（store.py:2201-2212；建议队列的算术口）。 */
  currentFocusCycleId(): number {
    const row = this.#db.prepare('SELECT MAX(id) AS n FROM focus_cycles').get() as
      | { n: number | null }
      | undefined
    return Number(row?.n ?? 0)
  }

  /**
   * SA-123（store.py:1825-1863 逐字）：层 2 选关切候选集——排除 released，
   * **不排除 dormant**（层 2 的价值恰在把久未点亮的调出来想）。LEFT JOIN
   * memory_scopes（没登记作用域的关切不消失，只是实体轴匿名）与
   * concern_focus_state（缺行按零算）；in_cooldown 物化；基序 id 升序。
   */
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

  /** 反刍计数（store.py:1866-1881）：缺行返回全零默认形状。 */
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

  /**
   * 写回反刍计数（store.py:1884-1919 逐字）：**全字段覆盖**——部分更新会让
   * "streak 与 cooldown 是同一次判断的两个面"失真；concerns 表在这条路径上
   * 一列不动（冷却是层 2 内务，不是关切的身份属性）。
   */
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

  /** "建议释放"清单（store.py:1922-1941）：只读的建议——没有任何代码路径因上榜而释放。 */
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

  /**
   * SA-131 血缘落账（store.py:1946-1982 逐字）：产物与它的每一条原料钉在一起，
   * 返回**新写入**行数。五元组 UNIQUE + INSERT OR IGNORE：同周期重放幂等，
   * 血缘的行数是可信的计数不是估计（C-17）。
   */
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

  /** insights.content 只读（store.py:2016-2024）：insights 的唯一写者仍是 upsertInsight。 */
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

  /**
   * 层 2 结论 + 影子状态（store.py:2038-2061）：content/category 从 insights 联出。
   * status=null 给全部；下游消费者应当只读 'active'（见 promotedFocusInsights）。
   */
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

  /**
   * SA-134（store.py:2064-2071 逐字）：转正的结论——**这是层 2 产物唯一的对外
   * 消费口**。将来接下游时接的是这个函数，而不是 listFocusInsights 的全集——
   * 那样影子期就成了摆设。
   *
   * WO-PERS-OVERLAY-01（D-4）语义收窄：**排除 relationship 类**——那些是按对话者
   * 键控的相处方式条目，走 promotedRelationshipInsights 的另一口。两个读口互斥、
   * 并集 = 本函数收窄前的结果集（同为 status active 的全部行）。
   *
   * LEFT JOIN 下 `i.category` 可能为 NULL（状态行存在而 insights 那行不见了的
   * 孤儿——正常路径产不出，但读口不该因此漏行），`COALESCE(i.category,'')` 让这类
   * 行**仍归通用层**：宁可多给一条来历不明的，也不要让它两个口都掉出去。
   */
  promotedFocusInsights(): RawRow[] {
    return this.#db.prepare(
      `SELECT s.*, i.content AS content, i.category AS category
         FROM focus_insight_state AS s
         LEFT JOIN insights AS i ON i.id = s.insight_id
        WHERE s.status = 'active' AND COALESCE(i.category, '') <> ?
        ORDER BY s.insight_id`,
    ).all(RELATIONSHIP_INSIGHT_CATEGORY) as RawRow[]
  }

  /**
   * WO-PERS-OVERLAY-01（D-4）：**眼前这个人**的相处方式条目——status `active`
   * ∧ category `relationship` ∧ 实体轴键 = subjectUserId。
   *
   * 三个条件缺一不可，而第三个正是这一单的全部意义："不同的人不同的脸"在这里是
   * 一条 JOIN 而不是一句约定——键到别人的行**查不出来**，不是查出来再过滤。
   * 内联 JOIN（不是 LEFT）：没登记实体轴的 relationship 行不属于任何人，两个读口
   * 都不给——一条没有"对谁"的相处方式条目是坏数据，不该被装配进任何人的上下文。
   */
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

  /**
   * SA-133（store.py:2074-2123 逐字）：给一条新结论落影子状态 + 一行历史。返回
   * true = 这是**新结论**。重申（逐字相同结论 → 同一 insight_id）：状态行原样
   * 保留（影子期不因重申而重新计时），只追加一行历史，返回 false——调用方据此
   * 把本次周期判成"深挖无新结论"，重申如实喂进反刍计数，不伪装成进展。
   *
   * WO-MEM-DECAY-01（D-5）唯一的例外是**点亮**：重申一条 `dormant` 结论时状态行
   * 改回 `active`（updated_cycle_id / updated_at 刷新、contested_since_cycle 清空，
   * 与 setFocusInsightStatus 的 active 分支同规则），history 一行 reason `relit`，
   * 并发 `focus_insight_status` from dormant to active。理由：她又想到了同一结论，
   * 它就是现行的——衰减是"久未重申"的退场，不是判决。**其他状态的重申行为一个
   * 字不动**（shadow 不因重申重新计时依旧成立），返回值也仍是 false：点亮不是新
   * 结论，不该被记成进展。
   */
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

  /**
   * SA-129 状态迁移 + 一行历史（store.py:2126-2186 逐字）。返回 false = 这条
   * insight 没有影子状态行（层 2 之外写进 insights 的行不归这套门管）。
   * **历史永远保留**：撤回删的是"现行"资格，不是"她曾经这么认为过"。
   * contested_since_cycle 三条规则：迁进 contested 钉住首个起争周期号；迁回
   * shadow/active 清空；迁到 revised/withdrawn **及 dormant**（WO-MEM-DECAY-01
   * D-5：dormant 与 revised/withdrawn 同属"不再现行"的落点，起争周期号是账，
   * 留着）保留——下面的 else 分支已逐字覆盖 dormant，无需新增判定。
   */
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

  /** 一条（或全部）结论的状态迁移史，时间序。追加式，永不删（store.py:2189-2198）。 */
  focusInsightHistory(insightId?: number | null): RawRow[] {
    if (insightId === undefined || insightId === null) {
      return this.#db.prepare('SELECT * FROM focus_insight_history ORDER BY id').all() as RawRow[]
    }
    return this.#db.prepare(
      'SELECT * FROM focus_insight_history WHERE insight_id = ? ORDER BY id',
    ).all(insightId) as RawRow[]
  }

  // ============================== W4 · 规则建议队列状态层（store.py:2215-2506） ==============================
  // **铁律**（§3.8 门阶梯最高一级，SA-141）：这一整节没有任何一行写
  // approval_rules.json，也没有任何一行 import 审批件。她可以观察"这类事 Kevin
  // 总是批准"、可以把它排进队列问他，但生效那一笔永远由 Kevin 在 root 会话落下。

  /**
   * SA-142..146 入队（store.py:2249-2332 逐字）：返回 {id, status, enqueued, reason}。
   * enqueued 只有在**真的新排了一件事等他答**时才是 true。四种既有情形：
   * pending/asked → already_queued（与 dedup_key UNIQUE 是同一件事的两个面）；
   * accepted/applied_by_owner → already_decided（再问一遍是骚扰）；declined/expired
   * 且仍在冷却 → cooldown（被拒绝的建议不许换个说法再问，§3.8 最要紧的克制）；
   * 冷却已过 → **再武装**回 pending：文本与来源刷新，ask_count 与上次 answer_text
   * **保留**（他上次怎么说的是事实，不该被一次重排抹掉）。
   */
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
    const cycle = opts.cycleId || null // Python `cycle_id or None`：0 → None
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

  /**
   * 按"她问出去的那条消息 id"找建议（store.py:2354-2371）——归属消歧的唯一口径。
   * **只认 reply_to，不做语义匹配**：把"他大概是在说这个"当成"他同意这个"，
   * 是这一整单最不该有的便利。
   */
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

  /**
   * 下一条该问的建议：最早入队的那条（FIFO，store.py:2394-2407 逐字理由）——
   * 建议队列不该有"她觉得哪条更重要"的旋钮：那正是把"她自己的权限边界"往她
   * 自己手里挪的第一步。先来先问，可解释、可预期。
   */
  nextPendingRuleSuggestion(): RawRow | null {
    const row = this.#db.prepare(
      "SELECT * FROM rule_suggestions WHERE status = 'pending' ORDER BY id LIMIT 1",
    ).get() as RawRow | undefined
    return row ?? null
  }

  /** 已问出去、还没答复的建议。同一时刻**至多一条**（问答侧强制，SA-149）。 */
  outstandingAskedRuleSuggestions(): RawRow[] {
    return this.listRuleSuggestions('asked')
  }

  /**
   * 问出去超过 ttlCycles 个周期仍无答复的建议——该判 expired 了（store.py:2416-2431）。
   * **按周期序号不按墙钟**（与 §3.8 影子期同口径，SA-148）：一台停机三周的机器
   * 不该因为钟走了三周就把她问过的事悄悄作废。
   */
  overdueAskedRuleSuggestions(cycleId: number, ttlCycles: number): RawRow[] {
    return this.#db.prepare(
      `SELECT * FROM rule_suggestions
        WHERE status = 'asked' AND COALESCE(asked_at_cycle, 0) <= ?
        ORDER BY id`,
    ).all(cycleId - ttlCycles) as RawRow[]
  }

  /**
   * pending → asked（store.py:2434-2465）：UPDATE 自带 WHERE status='pending'，
   * "认领"是一次原子写不是先读后写。返回 false = 输了竞态——调用方据此撤回
   * 已发出的问题，而不是留下一条 Kevin 在等、系统里却没有记录的问题。
   */
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

  /**
   * 打终态（store.py:2468-2506）：accepted/declined/expired/applied_by_owner，
   * 迁移边由 SUGGESTION_TRANSITIONS 数据表钉死；返回 false = 来源状态不允许。
   * stagedInstructions 是"接受"那一路的产物：一段给 Kevin root 会话看的执行说明
   * ——存在表里，不发给 guardian、不改任何文件（SA-152）。
   */
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

  // ============================== pending_continuations（WO-CONTINUATION-01） ==============================

  /**
   * D-2：登记一条待续跑的承诺。id 由调用方铸（`cont-<origin_turn_id>-<ms>`），
   * 撞主键即抛（同一回合登记两次是调用方的错，不静默）。
   */
  registerContinuation(row: {
    id: string
    originTurnId: string
    originRunId: string | null
    goal: string
    dueAt: Date
    now: Date
  }): void {
    if (typeof row.id !== 'string' || row.id.length === 0) {
      throw new TypeError('lykoi-memory: continuation id must be a non-empty string')
    }
    if (typeof row.goal !== 'string' || row.goal.trim().length === 0) {
      throw new TypeError('lykoi-memory: continuation goal must be a non-empty string')
    }
    const moment = formatPyIso(row.now)
    this.#tx(() => {
      this.#db.prepare(
        `INSERT INTO pending_continuations
           (id, origin_turn_id, origin_run_id, goal, due_at, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(row.id, row.originTurnId, row.originRunId, row.goal, formatPyIso(row.dueAt), moment, moment)
    })
    this.#log('continuation_registered', { continuation_id: row.id, goal_chars: [...row.goal].length })
  }

  /** D-3：到期的 pending 行（due_at ≤ now），按 due_at 升序，最多 limit 条。 */
  dueContinuations(now: Date, limit: number): PendingContinuationRow[] {
    return this.#db.prepare(
      `SELECT id, origin_turn_id, origin_run_id, goal, due_at, state, terminal_reason, run_id,
              created_at, updated_at
         FROM pending_continuations
        WHERE state = 'pending' AND due_at <= ?
        ORDER BY due_at ASC, created_at ASC
        LIMIT ?`,
    ).all(formatPyIso(now), limit) as unknown as PendingContinuationRow[]
  }

  /** D-3 启动扫描：进程死在半路留下的 running 行。 */
  runningContinuations(): PendingContinuationRow[] {
    return this.#db.prepare(
      `SELECT id, origin_turn_id, origin_run_id, goal, due_at, state, terminal_reason, run_id,
              created_at, updated_at
         FROM pending_continuations
        WHERE state = 'running'
        ORDER BY updated_at ASC`,
    ).all() as unknown as PendingContinuationRow[]
  }

  /**
   * D-4：pending → running 的 CAS（rowcount 租约，R3 范式）。返回 false = 已被别的
   * 扫描拿走或已终局，调用方跳过。
   */
  claimContinuation(id: string, runId: string, now: Date): boolean {
    return this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE pending_continuations
            SET state = 'running', run_id = ?, updated_at = ?
          WHERE id = ? AND state = 'pending'`,
      ).run(runId, formatPyIso(now), id)
      return Number(info.changes) === 1
    })
  }

  /**
   * D-5：收账到三种终局之一。只允许从 pending / running 出发（终局是一次性的：
   * 已终局的行再收账 = 0 行受影响，返回 false，不抛 —— 两个扫描撞上同一行时后者
   * 静默让位）。
   */
  finishContinuation(
    id: string, state: 'completed' | 'failed' | 'expired', reason: string | null, now: Date,
  ): boolean {
    if (!CONTINUATION_TERMINAL_STATES.includes(state)) {
      throw new Error(`lykoi-memory: invalid continuation terminal state '${String(state)}'`)
    }
    return this.#tx(() => {
      const info = this.#db.prepare(
        `UPDATE pending_continuations
            SET state = ?, terminal_reason = ?, updated_at = ?
          WHERE id = ? AND state IN ('pending','running')`,
      ).run(state, reason, formatPyIso(now), id)
      return Number(info.changes) === 1
    })
  }

  /** 读一行（测试与观测用）。 */
  getContinuation(id: string): PendingContinuationRow | null {
    const row = this.#db.prepare(
      `SELECT id, origin_turn_id, origin_run_id, goal, due_at, state, terminal_reason, run_id,
              created_at, updated_at
         FROM pending_continuations WHERE id = ?`,
    ).get(id) as unknown as PendingContinuationRow | undefined
    return row ?? null
  }

  close(): void {
    this.#db.close()
  }
}
