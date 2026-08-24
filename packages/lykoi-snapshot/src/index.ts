/**
 * lykoi-snapshot — 感知快照 maintain/read 劈分版（M2 波次 2 交付①）。
 *
 * 规格正本：治理仓库 WO-M2-SPEC-MIND §2（SA-33..44）+ §7 相关条目；
 * 移植自活体 `mind/snapshot.py` + `mind/floor.py`（HEAD 4463ae8）。
 *
 * 一拍从这里开始：醒来看到的一切都来自状态层，所以快照必然每次不同 ——
 * 这就是打破土拨鼠日的机制。注意力预算：Top-6 关切、5 条线、3 条经验、
 * Top-3 念头 —— 她看不到全部，只看到发光的（SA-38）。
 *
 * 三分（SA-33）：
 *   maintain —— 感知期维护，**写**的那一半；仲裁器的活，一个心跳恰好一次；
 *   read     —— 纯读装配，**零写**；同一时刻的两次 read 逐字段相同，
 *               一份结果可以安全分发给 N 个并行分支（DA-10 的唯一前提）；
 *   assemble —— 兼容外观 = maintain 后 read，时刻解析一次两半共用（SA-36）。
 *
 * 时钟纪律（沿 W1 C-23）：now 一律必传（Date）；本包不读 Date.now()。
 * 写走 lykoi-memory/rw；本包自身不开连接。
 * 审计纪律：logEvent 是接口位（W3 心脏/编排接 audit sink），事件名与字段是契约。
 */
import {
  parseStateTimestamp,
  type AutonomyStateRow,
  type ConcernRow,
  type ExperienceRow,
  type HistoryRow,
  type ThoughtRow,
} from 'lykoi-memory'
import {
  formatPyIso,
  type AutonomyRunRow,
  type ConcernTransition,
  type NarrativeVersionRow,
  type RegulationEventRow,
  type ThreadRow,
} from 'lykoi-memory/rw'
import {
  cognitiveEffects,
  REGISTRY,
  THOUGHT_SNAPSHOT_TOP,
  type CognitiveEffects,
  type RegulationValues,
  type RegulationVariableName,
} from 'lykoi-regulation'
import { codePoints, median, pyRound } from './num.ts'
import { floorMaintain } from './floor.ts'

export * from './num.ts'
export * from './floor.ts'

// ============== 注意力预算（snapshot.py:44-48 逐字；SA-38） ==============
export const SNAPSHOT_CONCERN_TOP_N = 6
export const SNAPSHOT_THREAD_CAP = 5
export const SNAPSHOT_RECENT_EXPERIENCES = 3
export const SNAPSHOT_REGULATION_EVENTS = 3

// ============== 裁剪常量（snapshot.py:50-53 逐字；SA-39） ==============
export const NARRATIVE_CLIP = 400
export const DESCRIPTION_CLIP = 100
export const EXPERIENCE_CLIP = 200

/**
 * 呈现给她的治理预算（执行点在别处：小时顶在 supervisor 拍前检查、日顶在
 * kernel.notifications —— snapshot.py:55-57）。G-6 的折算见 environment()。
 */
export const HOURLY_ACTION_CAP = 20

// ====== 环境采样 / 懒惩罚（snapshot.py:59-65 逐字，初值待观察期校准） ======
export const OVERDUE_PENALTY_MIN_INTERVAL_H = 24.0
export const RHYTHM_WINDOW_DAYS = 14
export const RHYTHM_WINDOW_HOURS = 2.0
export const RHYTHM_SCAN_ROWS = 1000
export const MIN_GAP_SAMPLES = 5
export const DEFAULT_TYPICAL_GAP_H = 24.0

// ============================== 依赖面 ==============================

/**
 * 状态层依赖（结构化子集 —— lykoi-memory/rw 的 ReadWriteMemory 直接满足）。
 * read() 只触其中的纯读方法；maintain() 才触写方法（SA-33 的劈分在依赖面留痕）。
 */
export interface SnapshotStore {
  // —— maintain 写面（顺序即 SA-34） ——
  markDimmingDormant(opts: { now: Date }): ConcernTransition[]
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
  ): number
  applyRegulationCause(cause: string, opts: { now: Date }): unknown
  decayAllOpenThoughts(opts: { now: Date }): unknown
  // —— 读面 ——
  getRegulation(opts: { now: Date }): Record<RegulationVariableName, number>
  recentRegulationEvents(name: string | null, n: number): RegulationEventRow[]
  lastCauseEventTs(causes: readonly string[]): string | null
  listConcerns(status?: string | readonly string[]): ConcernRow[]
  listThreads(status?: string | readonly string[]): ThreadRow[]
  currentCognitiveNarrative(): NarrativeVersionRow | undefined
  countPendingExperiences(): number
  recentExperiences(n: number): ExperienceRow[]
  getThoughtsForSnapshot(topN: number): ThoughtRow[]
  getRecentHistoryOfType(eventType: string, n: number): HistoryRow[]
  autonomyActionsLastHour(opts: { now: Date }): number
  overdueSuspendedThreads(opts: { now: Date; days?: number }): ThreadRow[]
  overdueQuestions(opts: { now: Date }): ThoughtRow[]
  getAutonomyRuns(limit: number): AutonomyRunRow[]
  autonomyState(): AutonomyStateRow | undefined
}

/** restart 事件（cognition/restart.py 的 content 字段面；W5 才有生产者）。 */
export interface RestartEvent {
  notes?: readonly string[] | null
  [key: string]: unknown
}

/**
 * 尚未迁入新体的外部读数（kernel/approval、kernel/notifications、
 * shared/proactive_chat、cognition/restart）——接口位，W3/W5 接线。
 * 语义契约在各自 Python 源：
 *  - approvalPendingCount        = kernel.approval.pending_count()
 *  - notificationsRemainingToday = snapshot.py:163-178 _notifications_remaining_today
 *    （从权威队列现算 max(0, AUTONOMOUS_DAILY_CAP=2 - 今日 autonomous 已发)；
 *    "the throttle itself stays in the kernel; this is a view, not an enforcement
 *    point" —— SA-42）
 *  - proactiveRemainingToday     = shared/proactive_chat.remaining_today
 *    （日 1 条、冷却 6h，比通知更紧）
 *  - unprocessedRestartEvent     = cognition/restart.unprocessed_restart_event
 *    （SA-165：history ts 严格大于她上次醒来才算未处理）。
 *    TODO(M2-W5): restart 记录/消费接线；本波接口位可恒返 null（键即不出现）。
 */
export interface SnapshotDeps {
  approvalPendingCount(): number
  notificationsRemainingToday(now: Date): number
  proactiveRemainingToday(now: Date): number
  unprocessedRestartEvent(sinceIso: string | null): RestartEvent | null
  /** 审计接口位（W3 接 sink）；事件名与字段是契约（SA-44 拆分只上日志）。 */
  logEvent?(name: string, fields: Record<string, unknown>): void
}

// ============================== 快照类型 ==============================

export interface RegulationCauseView {
  cause: string
  delta: number
  ts: string
}

export interface RegulationBlockEntry {
  value: number
  recent_causes: RegulationCauseView[]
}

export interface ConcernView {
  id: number
  kind: string
  title: string
  description: string
  weight: number
  last_lit_at: string | null
  days_since_lit: number
}

export interface ThreadView {
  id: number
  kind: string
  content: string
  status: string
  days_stale: number
}

export interface NarrativeView {
  当前: string | null
  线: ThreadView[]
}

export interface ExperiencesBlock {
  未整合数: number
  最近: { source: string; content: string; ts: string }[]
}

export interface ThoughtView {
  id: number
  content: string
  kind: string
  charge: number
  status: string
  related_concern_id: number | null
  age_hours: number
}

export interface EnvironmentBlock {
  距上次和Kevin互动小时: number | null
  同时段历史: {
    近14天此时段有互动的天数: number
    观察天数: number
    典型互动间隔小时: number
  }
  等待批准的动作数: number
  探索: {
    上次完成explore: string | null
    断粮小时: number | null
  }
  预算: {
    本小时剩余行动数: number
    今日剩余通知数: number
    今日剩余主动开口数: number
    预算系数: number
  }
}

export interface PreviousBeat {
  decision: unknown
  status: string
  started_at: string
  next_wake_at: string | null
}

/** 九项快照（键序即她看到的顺序，SA-37；`刚刚醒来` 是条件键）。 */
export interface Snapshot {
  now: string
  调节场: Record<string, RegulationBlockEntry>
  coherence_low: boolean
  关切: ConcernView[]
  叙事: NarrativeView
  经验: ExperiencesBlock
  念头: ThoughtView[]
  环境: EnvironmentBlock
  上一拍: PreviousBeat | null
  刚刚醒来?: string
}

// ============================== 工具 ==============================

function hoursBetween(ts: string, now: Date): number {
  return (now.getTime() - parseStateTimestamp(ts).getTime()) / 3_600_000
}

/**
 * SA-39：`_clip`（snapshot.py:81-82 逐字）—— 省略号追加在裁剪长度**之外**；
 * 长度与切片按码点（Python len/切片语义）。
 */
export function clip(text: string, limit: number): string {
  const cps = codePoints(text)
  return cps.length <= limit ? text : cps.slice(0, limit).join('') + '…'
}

// ========== 环境采样（纯时间比较；reflow 的 cheap_tick 复用 —— SA-42 一族） ==========

/**
 * 近 days 天内全部 conversation history 时间戳，**oldest first**（有界读；
 * history 表是"我和 Kevin 什么时候真的说过话"的唯一事实源）。
 * 解析失败的行跳过（snapshot.py:87-101）。
 */
export function conversationTimestamps(
  store: SnapshotStore,
  now: Date,
  days: number = RHYTHM_WINDOW_DAYS,
): Date[] {
  const cutoff = now.getTime() - days * 86_400_000
  const rows = store.getRecentHistoryOfType('conversation', RHYTHM_SCAN_ROWS)
  const stamps: Date[] = []
  for (const row of rows) {
    let ts: Date
    try {
      ts = parseStateTimestamp(row.ts)
    } catch {
      continue
    }
    if (cutoff <= ts.getTime() && ts.getTime() <= now.getTime()) stamps.push(ts)
  }
  return stamps
}

/**
 * 相邻对话间隔的中位数（小时）；历史不足以了解 owner 节律时（< MIN_GAP_SAMPLES+1
 * 个样本）返回 DEFAULT_TYPICAL_GAP_H（snapshot.py:104-113 逐字）。
 */
export function medianGapHours(stamps: readonly Date[]): number {
  if (stamps.length < MIN_GAP_SAMPLES + 1) return DEFAULT_TYPICAL_GAP_H
  const gaps: number[] = []
  for (let i = 1; i < stamps.length; i++) {
    gaps.push((stamps[i]!.getTime() - stamps[i - 1]!.getTime()) / 3_600_000)
  }
  return median(gaps)
}

/**
 * 过去 days 天里有多少天在此刻 ±window_h 的时段内发生过对话 ——
 * "他这个时段通常在吗"，纯时间比较（snapshot.py:116-129 逐字）。
 */
export function sameWindowDays(
  stamps: readonly Date[],
  now: Date,
  opts: { windowH?: number; days?: number } = {},
): number {
  const windowMs = (opts.windowH ?? RHYTHM_WINDOW_HOURS) * 3_600_000
  const days = opts.days ?? RHYTHM_WINDOW_DAYS
  let count = 0
  for (let day = 1; day <= days; day++) {
    const anchor = now.getTime() - day * 86_400_000
    if (stamps.some((ts) => anchor - windowMs <= ts.getTime() && ts.getTime() <= anchor + windowMs)) {
      count++
    }
  }
  return count
}

function environment(
  store: SnapshotStore,
  deps: SnapshotDeps,
  now: Date,
  effects: CognitiveEffects,
): EnvironmentBlock {
  const stamps = conversationTimestamps(store, now)
  const lastRows = store.getRecentHistoryOfType('conversation', 1)
  const hoursSince = lastRows.length > 0 ? hoursBetween(lastRows[0]!.ts, now) : null

  const actionsSpent = store.autonomyActionsLastHour({ now })
  const notificationsRemaining = deps.notificationsRemainingToday(now)
  // WO-NIGHT-01/B3：探索断粮时钟 —— decide 的饥饿棘轮修复读它（WO-P4R-18）；
  // 唯一事实来源是 regulation 账本里的 explore_completed 事件（snapshot.py:139-141）。
  const exploreLast = store.lastCauseEventTs(['explore_completed'])
  return {
    距上次和Kevin互动小时: hoursSince !== null ? pyRound(hoursSince, 2) : null,
    同时段历史: {
      近14天此时段有互动的天数: sameWindowDays(stamps, now),
      观察天数: RHYTHM_WINDOW_DAYS,
      典型互动间隔小时: pyRound(medianGapHours(stamps), 1),
    },
    等待批准的动作数: deps.approvalPendingCount(),
    探索: {
      上次完成explore: exploreLast,
      断粮小时: exploreLast ? pyRound(hoursBetween(exploreLast, now), 1) : null,
    },
    预算: {
      // G-6（治理定案，DA-06 接通；列 Kevin 追认清单）：行动预算判定兑现
      // load.outlet_doc 声明的"高于 0.7:唤醒预算减半" ——
      //   本小时剩余行动数 = max(0, floor(HOURLY_ACTION_CAP × budget_multiplier) - 已花)
      // 活体只呈现 budget_multiplier 不执行（裸 20）；新体在**快照侧**折算一次，
      // decide 层直读该读数、不再另乘（见 lykoi-decide build_candidates 注释）。
      本小时剩余行动数: Math.max(
        0,
        Math.floor(HOURLY_ACTION_CAP * effects.budget_multiplier) - actionsSpent,
      ),
      今日剩余通知数: notificationsRemaining,
      今日剩余主动开口数: deps.proactiveRemainingToday(now),
      预算系数: effects.budget_multiplier,
    },
  }
}

// ============================== 感知期维护 ==============================

/**
 * 悬置超龄 → coherence 懒读惩罚（蓝图 §3.3 + §5.5 §3 出口 ②；SA-44）。
 *
 * 两个来源共点一道门：悬置超 30 天的线 AND open 'question' 念头超 48h。
 * 共用**同一条** regulation 因（suspension_overdue）与**同一个** 24h 间隔闸
 * （裁决 7：总压力钳，不按来源分管道），coherence 不被双重扣费。
 * 拆分（线 vs 念头计数）只上日志供 Phase 4 复盘 —— regulation_events 行保持简单。
 */
function applyLazyOverduePenalty(store: SnapshotStore, deps: SnapshotDeps, now: Date): void {
  const overdueThreads = store.overdueSuspendedThreads({ now })
  const overdueQs = store.overdueQuestions({ now })
  if (overdueThreads.length === 0 && overdueQs.length === 0) return
  const last = store.lastCauseEventTs(['suspension_overdue'])
  if (last !== null && hoursBetween(last, now) < OVERDUE_PENALTY_MIN_INTERVAL_H) return
  store.applyRegulationCause('suspension_overdue', { now })
  deps.logEvent?.('suspension_overdue_breakdown', {
    threads: overdueThreads.length,
    thoughts: overdueQs.length,
  })
}

// ============================== 快照块 ==============================

function regulationBlock(
  store: SnapshotStore,
  now: Date,
): [Record<string, RegulationBlockEntry>, RegulationValues, CognitiveEffects] {
  const values = store.getRegulation({ now })
  const effects = cognitiveEffects(values)
  const block: Record<string, RegulationBlockEntry> = {}
  for (const name of Object.keys(REGISTRY) as RegulationVariableName[]) {
    const events = store.recentRegulationEvents(name, SNAPSHOT_REGULATION_EVENTS)
    block[name] = {
      value: pyRound(values[name], 3),
      recent_causes: events.map((e) => ({ cause: e.cause, delta: e.delta, ts: e.ts })),
    }
  }
  return [block, values, effects]
}

function concernBlock(store: SnapshotStore, now: Date): ConcernView[] {
  const rows = store.listConcerns('active').slice(0, SNAPSHOT_CONCERN_TOP_N)
  return rows.map((row) => {
    const litRef = row.lastLitAt ?? row.createdAt
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      description: clip(row.description, DESCRIPTION_CLIP),
      weight: row.weight,
      last_lit_at: row.lastLitAt,
      days_since_lit: pyRound(hoursBetween(litRef, now) / 24.0, 2),
    }
  })
}

function narrativeBlock(store: SnapshotStore, now: Date): NarrativeView {
  // WO-P4R-06 / SA-41：清醒拍快照是 LIVE 认知路径 —— 感知认知叙事（跳过
  // strict-empty 'narrative_only' 虚构），绝不读原始最新行：空整合的改写
  // 不被感知为自我。
  const current = store.currentCognitiveNarrative()
  const threads = [...store.listThreads(['open', 'suspended'])]
  // SA-40：按 updated_at 升序 —— 最久没动的先看见（Python 对 ts 字符串稳定排序；
  // 业务行同为 isoformat 形态，串序 == 时间序）。
  threads.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
  return {
    当前: current ? clip(current.content, NARRATIVE_CLIP) : null,
    线: threads.slice(0, SNAPSHOT_THREAD_CAP).map((t) => ({
      id: t.id,
      kind: t.kind,
      content: clip(t.content, EXPERIENCE_CLIP),
      status: t.status,
      days_stale: pyRound(hoursBetween(t.updatedAt, now) / 24.0, 2),
    })),
  }
}

function experienceBlock(store: SnapshotStore): ExperiencesBlock {
  const recent = store.recentExperiences(SNAPSHOT_RECENT_EXPERIENCES)
  return {
    未整合数: store.countPendingExperiences(),
    最近: recent.map((e) => ({
      source: e.source,
      content: clip(e.content, EXPERIENCE_CLIP),
      ts: e.ts,
    })),
  }
}

/**
 * Top-N open 念头按 charge（§5.5 §3 出口 ①）。注意力有界：她看到最强的几条，
 * 不是长尾。少于 Top-N 合法 —— 空列表是正确渲染，不是警告或错误（SA-38）。
 */
function thoughtsBlock(store: SnapshotStore, now: Date): ThoughtView[] {
  const rows = store.getThoughtsForSnapshot(THOUGHT_SNAPSHOT_TOP)
  return rows.map((r) => ({
    id: r.id,
    content: clip(r.content, EXPERIENCE_CLIP),
    kind: r.kind,
    charge: pyRound(r.charge, 3),
    status: r.status,
    related_concern_id: r.relatedConcernId,
    age_hours: pyRound(hoursBetween(r.ts, now), 2),
  }))
}

/**
 * 上一个**已完结**的拍 —— 决策与结局（回流闭环的可见性，SA-43）。
 * 本拍自己（status=='running' 的开行）被跳过；不可解析的旧 decision 原样展示，
 * 绝不编造。
 */
function previousBeat(store: SnapshotStore): PreviousBeat | null {
  for (const run of store.getAutonomyRuns(5)) {
    if (run.status === 'running') continue
    let decision: unknown = run.decision
    if (!decision) {
      decision = null
    } else {
      try {
        decision = JSON.parse(run.decision!)
      } catch {
        // 不可解析的旧行原样展示，绝不编造（snapshot.py:309）
      }
    }
    return {
      decision,
      status: run.status,
      started_at: run.startedAt,
      next_wake_at: run.nextWakeAt,
    }
  }
  return null
}

// ============================== restart 叙事（SA-162） ==============================

/**
 * 把 restart 事件渲染成第二人称一句话，或空串（cognition/restart.py:239-246 逐字）。
 * notes 用**无分隔符** join（每条 note 自带全角句号）；外层方括号是"这是材料
 * 不是对话"的标记；空 event → 空串。生产者（record/unprocessed）归 W5。
 */
export function renderRestartNotice(event: RestartEvent | null | undefined): string {
  // Python `if not event` —— 空 dict 也为假。
  if (!event || Object.keys(event).length === 0) return ''
  const notes = event.notes || []
  const body = notes.length > 0 ? notes.join('') : '你刚从一次重启中醒来。'
  return `[${body}]`
}

// ============================== 三分主面（SA-33） ==============================

/**
 * 感知期维护 —— 写的那一半（WO-CB-01 步 0；SA-34 四写顺序逐字）。
 *
 * 四件确定性、零 LLM 的写：dim/dormant 标记 → 关切地板 → 超龄悬置惩罚 →
 * 念头衰减。第 4 项可能当场把一条念头 lapse 成 abandoned + 一条 thought_lapse
 * 经验，所以它必须发生在读之前 —— 经验块要看得见（SA-35）。
 * 地板站位（floor.py 顶注）：AFTER aging（老化流失被覆盖）、BEFORE 整合读
 * 关切集（吸收目标始终存在）。
 *
 * 这是**仲裁器的活**，一个心跳恰好一次（SA-49）。从装配里抽出来具名，是为了
 * 让"取一份快照分发给 N 个分支推演"成为可能：今天取快照本身就是一次状态变更
 * （C-A §5.2 / ⑤ C12），那条路因此走不通。
 *
 * 返回它实际用的 moment，好让调用方把同一个时刻传给 read() —— 两半分家取时
 * 就不是纯重构了（维护写的时间戳会与快照里的 now 错开）（SA-36）。
 */
export function maintain(store: SnapshotStore, deps: SnapshotDeps, now: Date): Date {
  store.markDimmingDormant({ now })
  // WO-P4R-08 concern floor：把 (active,dimming) 活性数从叙事派生目标补到 N。
  floorMaintain(store, now)
  applyLazyOverduePenalty(store, deps, now)
  store.decayAllOpenThoughts({ now }) // §5.5 §3 出口 ③
  return now
}

/**
 * 纯读装配 —— 读的那一半（WO-CB-01 步 0；SA-33/37）。
 *
 * 九项里的 3-9 项，一个字节都不往状态层写。同一时刻的两次 read 逐字段相同，
 * 所以一份结果可以安全地分发给 N 个并行分支（步 4 推演切分的前提；
 * 零写断言 + 对照组见测试，G-9 立 M2）。
 */
export function read(store: SnapshotStore, deps: SnapshotDeps, now: Date): Snapshot {
  const [regBlock, , effects] = regulationBlock(store, now)
  const snap: Snapshot = {
    now: formatPyIso(now),
    调节场: regBlock,
    coherence_low: effects.flag_low_coherence, // 快照中标红
    关切: concernBlock(store, now),
    叙事: narrativeBlock(store, now),
    经验: experienceBlock(store),
    念头: thoughtsBlock(store, now), // §5.5 §3 出口 ①
    环境: environment(store, deps, now, effects),
    上一拍: previousBeat(store),
  }
  // SA-165：仅当有未处理的 restart 事件时键才存在（W5 接真实生产者；
  // 本波 deps 可恒返 null）。
  const restart = deps.unprocessedRestartEvent(store.autonomyState()?.lastWakeAt ?? null)
  if (restart && Object.keys(restart).length > 0) {
    snap.刚刚醒来 = renderRestartNotice(restart)
  }
  return snap
}

/**
 * 兼容外观（SA-33/36）："maintain 后 read"，行为与拆分前逐字节一致 ——
 * 时刻在调用方解析**一次**，两半共用同一个 moment（两半各自再取时钟就会让
 * 维护写的时间戳与快照里的 now 分家，那不是纯重构）。
 */
export function assemble(store: SnapshotStore, deps: SnapshotDeps, now: Date): Snapshot {
  const moment = maintain(store, deps, now)
  return read(store, deps, moment)
}
