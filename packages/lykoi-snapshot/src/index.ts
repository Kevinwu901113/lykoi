/** Read-only perception with separate maintenance. Maintenance ages existing state without creating concerns. */
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
import { median, roundDecimal } from './num.ts'

export * from './num.ts'
export * from './restart.ts'
export * from './restart-collect.ts'

export const SNAPSHOT_CONCERN_TOP_N = 6
export const SNAPSHOT_THREAD_CAP = 5
export const SNAPSHOT_RECENT_EXPERIENCES = 3
export const SNAPSHOT_REGULATION_EVENTS = 3

export const NARRATIVE_CLIP = 400
export const DESCRIPTION_CLIP = 100
export const EXPERIENCE_CLIP = 200

/** 快照呈现的小时行动上限；environment 从实际上限扣除已使用次数。实际执行仍经过派发权限与预算检查。 */
export const HOURLY_ACTION_CAP = 20

export const OVERDUE_PENALTY_MIN_INTERVAL_H = 24.0
export const RHYTHM_WINDOW_DAYS = 14
export const RHYTHM_WINDOW_HOURS = 2.0
export const RHYTHM_SCAN_ROWS = 1000
export const MIN_GAP_SAMPLES = 5
export const DEFAULT_TYPICAL_GAP_H = 24.0

// ============================== 依赖面 ==============================

/** 状态层依赖。read 只使用读取方法，maintain 才调用写入方法。 */
export interface SnapshotStore {

  markDimmingDormant(opts: { now: Date }): ConcernTransition[]
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

/** 重启事件的内容字段。 */
export interface RestartEvent {
  notes?: readonly string[] | null
  [key: string]: unknown
}

/**
 * 审批、通知、主动联系额度和重启事件的外部读数。
 * 这些是权威状态的只读视图，不在快照层执行权限或节流决策。
 */
export interface SnapshotDeps {
  approvalPendingCount(): number
  notificationsRemainingToday(now: Date): number
  proactiveRemainingToday(now: Date): number
  unprocessedRestartEvent(sinceIso: string | null): RestartEvent | null
  /** 审计接口；事件名和字段供观测消费者使用。 */
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
  距上次与所有者互动小时: number | null
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
  }
}

export interface PreviousBeat {
  decision: unknown
  status: string
  started_at: string
  next_wake_at: string | null
}

/** 快照字段按上下文呈现顺序构造；刚刚醒来只在存在重启事件时出现。 */
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

/** 按 Unicode 码点裁剪，省略号追加在限制长度之外。 */
export function clip(text: string, limit: number): string {
  const cps = [...text]
  return cps.length <= limit ? text : cps.slice(0, limit).join('') + '…'
}

/** 有界读取最近 days 天的对话时间戳，按时间升序排列；跳过无法解析的行。 */
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

/** 相邻对话间隔的中位数（小时）；少于 MIN_GAP_SAMPLES + 1 个样本时返回默认间隔。 */
export function medianGapHours(stamps: readonly Date[]): number {
  if (stamps.length < MIN_GAP_SAMPLES + 1) return DEFAULT_TYPICAL_GAP_H
  const gaps: number[] = []
  for (let i = 1; i < stamps.length; i++) {
    gaps.push((stamps[i]!.getTime() - stamps[i - 1]!.getTime()) / 3_600_000)
  }
  return median(gaps)
}

/** 统计过去 days 天中在此刻前后 windowH 小时内发生过对话的天数，每天只计一次。 */
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

  const exploreLast = store.lastCauseEventTs(['explore_completed'])
  return {
    距上次与所有者互动小时: hoursSince !== null ? roundDecimal(hoursSince, 2) : null,
    同时段历史: {
      近14天此时段有互动的天数: sameWindowDays(stamps, now),
      观察天数: RHYTHM_WINDOW_DAYS,
      典型互动间隔小时: roundDecimal(medianGapHours(stamps), 1),
    },
    等待批准的动作数: deps.approvalPendingCount(),
    探索: {
      上次完成explore: exploreLast,
      断粮小时: exploreLast ? roundDecimal(hoursBetween(exploreLast, now), 1) : null,
    },
    预算: {

      // decide 层直读该读数、不再另乘（见 lykoi-decide build_candidates 注释）。
      本小时剩余行动数: Math.max(
        0,
        HOURLY_ACTION_CAP - actionsSpent,
      ),
      今日剩余通知数: notificationsRemaining,
      今日剩余主动开口数: deps.proactiveRemainingToday(now),
    },
  }
}

// ============================== 感知期维护 ==============================

/**
 * 超龄悬置线和 open question 念头共用 suspension_overdue 调节因与 24 小时间隔闸。
 * 任一来源超龄即可触发；本函数属于维护写入，read 不调用它。
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
      value: roundDecimal(values[name], 3),
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
      days_since_lit: roundDecimal(hoursBetween(litRef, now) / 24.0, 2),
    }
  })
}

function narrativeBlock(store: SnapshotStore, now: Date): NarrativeView {

  // strict-empty 'narrative_only' 虚构），绝不读原始最新行：空整合的改写
  // 不被感知为自我。
  const current = store.currentCognitiveNarrative()
  const threads = [...store.listThreads(['open', 'suspended'])]

  // 业务行同为 isoformat 形态，串序 == 时间序）。
  threads.sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0))
  return {
    当前: current ? clip(current.content, NARRATIVE_CLIP) : null,
    线: threads.slice(0, SNAPSHOT_THREAD_CAP).map((t) => ({
      id: t.id,
      kind: t.kind,
      content: clip(t.content, EXPERIENCE_CLIP),
      status: t.status,
      days_stale: roundDecimal(hoursBetween(t.updatedAt, now) / 24.0, 2),
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

/** 按 charge 读取 Top-N 个 open 念头；不足上限或空列表均为合法快照。 */
function thoughtsBlock(store: SnapshotStore, now: Date): ThoughtView[] {
  const rows = store.getThoughtsForSnapshot(THOUGHT_SNAPSHOT_TOP)
  return rows.map((r) => ({
    id: r.id,
    content: clip(r.content, EXPERIENCE_CLIP),
    kind: r.kind,
    charge: roundDecimal(r.charge, 3),
    status: r.status,
    related_concern_id: r.relatedConcernId,
    age_hours: roundDecimal(hoursBetween(r.ts, now), 2),
  }))
}

/** 呈现上一个已结束周期的决策与结果；跳过 running，无法解析的历史决策原样展示。 */
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

/** 重启事件渲染。notes 自带标点、无分隔符连接；空事件返回空串。 */
export function renderRestartNotice(event: RestartEvent | null | undefined): string {

  if (!event || Object.keys(event).length === 0) return ''
  const notes = event.notes || []
  const body = notes.length > 0 ? notes.join('') : '你刚从一次重启中醒来。'
  return `[${body}]`
}

/**
 * 感知期维护：老化关切 → 超龄惩罚 → 念头衰减。
 * 维护先于读取，确保衰减生成的经验进入本轮快照；返回注入时刻供读侧复用。
 * 关切地板及调节行为的去留在防御审查阶段处理。
 */
export function maintain(store: SnapshotStore, deps: SnapshotDeps, now: Date): Date {
  store.markDimmingDormant({ now })
  applyLazyOverduePenalty(store, deps, now)
  store.decayAllOpenThoughts({ now }) // §5.5 §3 出口 ③
  return now
}

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

  const restart = deps.unprocessedRestartEvent(store.autonomyState()?.lastWakeAt ?? null)
  if (restart && Object.keys(restart).length > 0) {
    snap.刚刚醒来 = renderRestartNotice(restart)
  }
  return snap
}
