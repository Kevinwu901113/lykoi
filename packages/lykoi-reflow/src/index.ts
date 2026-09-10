/** Execute accepted decisions and record actual outcomes. External effects pass through dispatch. */
import {
  AUTONOMY_ACTIONS, emitCapabilityGap, GAP_NO_EXECUTION_BRANCH, type Decision, type LogEvent,
} from 'lykoi-decide'
import { parseStateTimestamp, type EpistemicStance, type HistoryRow } from 'lykoi-memory'
import type { ConversationDirection, ExperienceSource } from 'lykoi-memory/rw'
import {
  conversationTimestamps,
  medianGapHours,
  roundDecimal,
  sameWindowDays,
  type SnapshotStore,
} from 'lykoi-snapshot'

export const CLIP_CHARS = 120

export const SILENCE_MIN_HOURS = 12.0

export const SILENCE_ANOMALY_FACTOR = 2.0

export const SILENCE_WINDOW_MIN_DAYS = 3

export const SILENCE_SALIENCE = 0.6

export const CONTACT_RESPONSE_TIMEOUT_H = 24.0

export const CHEAP_TICK_INTERVAL_S = 600.0

export const CONTACT_RESOLUTION_CAUSES = ['contact_answered', 'contact_unanswered'] as const

// ============================== 依赖面 ==============================

/** kernel dispatch 的返回形状（kernel/dispatch.Observation 的结构化子集）。 */
export interface Observation {
  success: boolean
  data?: unknown
  error?: string | null
}

export type DispatchFn = (
  actionType: string,
  params: Record<string, unknown>,
  runId: string,
) => Promise<Observation>

/** 执行+回流的写依赖（lykoi-memory/rw ReadWriteMemory 的结构化子集）。 */
export interface ReflowStore {
  recordExperience(
    source: ExperienceSource,
    content: string,
    opts: {
      salience?: number
      relatedConcernId?: number | null

      epistemic?: EpistemicStance
      /** conversation 渠道的消息方向（缺省 inbound 口径）。 */
      conversationDirection?: ConversationDirection
      now: Date
    },
  ): number
  applyRegulationCause(cause: string, opts: { now: Date }): unknown
  listConcerns(status?: string | readonly string[]): { id: number }[]
  lightConcern(concernId: number, opts: { now: Date }): unknown
  appendThreadProgress(threadId: number, line: string, opts: { now: Date }): void
  tendConcernDescription(concernId: number, description: string, opts: { now: Date }): void
  appendAutonomyNote(
    autonomyRunId: string,
    kind: string,
    content: string,
    opts: { sourceType?: string | null; now: Date },
  ): number
}

export interface WakeCounts {
  action: number
  external_read: number
  notification: number
}

export interface NotificationsView {
  getNotifications(): readonly { ts?: string | null; origin?: string | null }[]
}

/** 通知队列未接线时的显式空视图（永无未决呼唤；不是静默替身——语义如实）。 */
export const emptyNotifications: NotificationsView = {
  getNotifications: () => [],
}

// ============================== 工具 ==============================

export function clipStripped(text: string, limit: number = CLIP_CHARS): string {
  const stripped = text.trim()
  const cps = [...stripped]
  return cps.length <= limit ? stripped : cps.slice(0, limit).join('') + '…'
}

function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

function pyFloat1(x: number): string {
  const r = roundDecimal(x, 1)
  return Number.isInteger(r) ? r.toFixed(1) : String(r)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function hoursBetween(ts: string, now: Date): number {
  return (now.getTime() - parseStateTimestamp(ts).getTime()) / 3_600_000
}

export function recordExperience(
  store: ReflowStore,
  source: ExperienceSource,
  content: string,
  opts: {
    salience?: number
    relatedConcernId?: number | null

    epistemic?: EpistemicStance
    conversationDirection?: ConversationDirection
    now: Date
  },
): number {
  const experienceId = store.recordExperience(source, content, opts)
  store.applyRegulationCause('experience_recorded', { now: opts.now })
  return experienceId
}

export function lightGroundedConcerns(
  decision: Decision,
  opts: { store: ReflowStore; now: Date; logEvent?: LogEvent },
): number[] {
  const lit: number[] = []
  const activeIds = new Set(opts.store.listConcerns('active').map((c) => c.id))
  for (const concernId of new Set(decision.grounded_concern_ids)) {
    if (!activeIds.has(concernId)) {
      opts.logEvent?.('grounding_concern_out_of_snapshot', { concern_id: concernId, where: 'reflow' })
      continue
    }
    try {
      opts.store.lightConcern(concernId, { now: opts.now })
      lit.push(concernId)
    } catch (exc) {

      if (exc instanceof Error && exc.name === 'ValueError') {
        opts.logEvent?.('mind_light_skipped', { concern_id: concernId, error: exc.message })
        continue
      }
      throw exc
    }
  }
  return lit
}

export function actionSummary(decision: Decision): string {
  const bits = [`[${decision.kind}]`]

  if (decision.url) {
    bits.push(decision.url)
  }
  if (decision.content) {
    bits.push(clipStripped(decision.content))
  }
  if (decision.reason) {
    bits.push(`理由:${clipStripped(decision.reason)}`)
  }
  return bits.join(' ')
}

function tendInner(
  decision: Decision,
  runId: string,
  opts: { store: ReflowStore; now: Date; logEvent?: LogEvent },
): string {
  const content = (decision.content ?? '').trim()
  let form: string
  let outcome: string
  if (decision.thread_id !== null) {
    opts.store.appendThreadProgress(decision.thread_id, content, { now: opts.now })
    form = 'thread_progress'
    outcome = `给叙事线 #${decision.thread_id} 写了一句进展`
  } else if (decision.concern_id !== null) {
    opts.store.tendConcernDescription(decision.concern_id, content, { now: opts.now })
    form = 'concern_description'
    outcome = `调整了关切 #${decision.concern_id} 的描述`
  } else {
    const noteId = opts.store.appendAutonomyNote(runId, 'reflection', content, {
      sourceType: 'internal',
      now: opts.now,
    })
    form = 'note_to_self'
    outcome = `给自己留了一条 note(#${noteId})`
  }
  opts.logEvent?.('mind_tend_inner', { run_id: runId, form })
  return outcome
}

export async function executeAndReflow(
  decision: Decision,
  runId: string,
  counts: WakeCounts,
  opts: { store: ReflowStore; dispatchFn: DispatchFn; now: Date; logEvent?: LogEvent; ownerName?: string },
): Promise<'completed' | 'failed'> {
  const { store, dispatchFn, now, logEvent } = opts

  const lit = lightGroundedConcerns(decision, { store, now, logEvent })
  const primary = lit.length > 0 ? lit[0]! : null
  recordExperience(store, 'wake_action', actionSummary(decision), {
    relatedConcernId: primary,
    now,
  })

  let status: 'completed' | 'failed' = 'completed'
  let result: string
  if (decision.kind === 'rest') {
    store.applyRegulationCause('rested', { now })
    result = 'rest:这一拍我休息,load 泄压'
  } else {

    store.applyRegulationCause('action_taken', { now })

    if (decision.kind === 'record_note') {
      // 无 try/except（[事实]）：append 抛异常冒泡到编排层，整拍记 failed。
      const noteId = store.appendAutonomyNote(runId, 'reflection', (decision.content ?? '').trim(), {
        sourceType: 'internal',
        now,
      })
      result = `record_note 完成:写下了笔记 #${noteId}`
    } else if (decision.kind === 'tend_inner') {
      try {
        result = `tend_inner 完成:${tendInner(decision, runId, { store, now, logEvent })}`
      } catch (exc) {
        if (!(exc instanceof Error && exc.name === 'ValueError')) throw exc
        status = 'failed'
        result = `tend_inner 失败:${exc.message}`
      }
    } else if (decision.kind === 'tool_call') {
      const tool = decision.envelope.tool
      if (!isPlainObject(tool) || typeof tool.name !== 'string' || !isPlainObject(tool.arguments)) throw new TypeError('invalid capability call')
      const observation = await dispatchFn(tool.name, tool.arguments, runId)
      counts.action += 1
      status = observation.success ? 'completed' : 'failed'
      result = JSON.stringify({ capability: tool.name, ...observation })
    } else if (decision.kind === 'explore') {
      if (!decision.url) {

        status = 'failed'
        result = 'explore 扑空:想去看看,但没有起点 url,什么都没读到'
      } else {
        const observation = await dispatchFn(
          AUTONOMY_ACTIONS.explore.action, { url: decision.url }, runId,
        )

        counts.action += 1
        counts.external_read += 1
        if (observation.success) {
          let text = ''
          if (isPlainObject(observation.data)) {
            const raw = observation.data.text
            text = raw ? String(raw) : ''
          }

          store.applyRegulationCause('explore_completed', { now })
          result = `explore 完成:读了 ${decision.url}(约 ${[...text].length} 字),探索饥饿泄压`
        } else {
          status = 'failed'
          result = `explore 失败:${observation.error || '没有读到内容'}`
        }
      }
    } else if (decision.kind === 'contemplate') {

      // 内向的一拍——产出是 inner 念头块，由 wake 编排在本函数返回**之后**
      // applyInner 落地，这里不重做任何向内的事。在这条分支存在之前，
      // contemplate 落进 queue_notification 的 else 兜底**误向 Kevin 发了话**
      // （决策记录 §1.6：107/107 进入动作尝试,18 条成了真通知）。零通知、零
      // owner-dispatch：a routing fix, not a new capability——无 kernel
      // dispatch、无新的向外通道。上面的 action_taken 仍算（向内也花一拍）。
      result = 'contemplate 完成:向内的一拍,没有对外发声'
    } else if (decision.kind === 'initiate_chat') {

      // 一样走 kernel dispatch(origin=autonomous),预算被拦下时她体验为结果。
      const observation = await dispatchFn(
        AUTONOMY_ACTIONS.initiate_chat.action,
        { content: (decision.content ?? '').trim(), run_id: runId },
        runId,
      )
      counts.action += 1
      const data = isPlainObject(observation.data) ? observation.data : {}
      if (observation.success && data.queued) {

        // 是结构性假回执；排队 ≠ 送达。只报她真正做完的那一步；送达与否由投递
        // 路径交代，失败会回灌成她的经验。**不得回退这句文案**。
        result = 'initiate_chat 完成:主动开了口,已交给投递;送达与否之后会回到你的经验里'
      } else if (observation.success) {

        result = `initiate_chat 被脑干拦下(${pyStr(data.reason)}):主动开口的份额还没回来`
      } else {
        status = 'failed'
        result = `initiate_chat 失败:${pyStr(observation.error)}`
      }
    } else if (decision.kind === 'queue_notification') {

      // 分支的 kind 都会默默变成一条发给 Kevin 的通知（contemplate 踩过的坑）。

      const observation = await dispatchFn(
        AUTONOMY_ACTIONS.queue_notification.action,
        { summary: (decision.content ?? '').trim(), run_id: runId },
        runId,
      )
      counts.action += 1
      const data = isPlainObject(observation.data) ? observation.data : {}
      if (observation.success && data.queued) {

        // 外部动作"，通知配额记"确实留了一条话"）。
        counts.notification += 1
        result = `queue_notification 完成:留了话给 ${opts.ownerName ?? '所有者'},等待回应`
      } else if (observation.success) {

        // and she experiences it as a result, not a crash (红线 #5)。
        result = `queue_notification 被脑干拦下(${pyStr(data.reason)}):今天对他说得够多了`
      } else {
        status = 'failed'
        result = `queue_notification 失败:${pyStr(observation.error)}`
      }
    } else {

      // 路由变成大声失败；action_result 照写（没有结果也是结果）。
      logEvent?.('unknown_decision_kind', { run_id: runId, kind: decision.kind })

      // 这里没有身体可用。旁路留痕 —— 上面那条账与下面 failed 的落法都不动。
      emitCapabilityGap(logEvent, {
        wanted: decision.kind,
        reason: GAP_NO_EXECUTION_BRANCH,
        source: 'wake', // executeAndReflow 只有自主拍一个调用方（converse 走信封周期）
        runId,
      })
      status = 'failed'
      result = `未知 kind(${decision.kind}):reflow 没有它的执行分支,这一拍记 failed`
    }
  }

  // concern_lit_unfollowed）。治理理由：contemplate/tend_inner 确实推进了内部
  // 状态（inner 念头/线进展/关切照料），不属"点亮了却没追"；判据本意取 DA-05
  // 读法②（"没有向内也没有向外推进的拍"）。此为治理按预授权定案，列 Kevin
  // 追认清单——不是"因为新 kind 出现得晚而漏掉"的沿袭。
  if (lit.length > 0 && (decision.kind === 'rest' || decision.kind === 'record_note')) {
    store.applyRegulationCause('concern_lit_unfollowed', { now })
  }

  recordExperience(store, 'action_result', result, { relatedConcernId: primary, now })
  return status
}

export function pendingContactTs(
  store: { lastCauseEventTs(causes: readonly string[]): string | null },
  notifications: NotificationsView,
): string | null {
  let latest: string | null = null
  for (const item of notifications.getNotifications()) {
    if (item.origin === 'autonomous' && item.ts) {
      if (latest === null || item.ts > latest) latest = item.ts
    }
  }
  if (latest === null) return null
  const resolved = store.lastCauseEventTs(CONTACT_RESOLUTION_CAUSES)
  if (resolved !== null && resolved >= latest) return null
  return latest
}

export function resolveContactAnswered(opts: {
  store: ReflowStore & { lastCauseEventTs(causes: readonly string[]): string | null }
  notifications: NotificationsView
  now: Date
  via: string
  logEvent?: LogEvent
}): boolean {
  if (pendingContactTs(opts.store, opts.notifications) === null) return false
  opts.store.applyRegulationCause('contact_answered', { now: opts.now })
  opts.logEvent?.('mind_contact_answered', { via: opts.via })
  return true
}

export function notificationsReadReflow(opts: {
  store: ReflowStore & { lastCauseEventTs(causes: readonly string[]): string | null }
  notifications: NotificationsView
  now: Date
  logEvent?: LogEvent
}): boolean {
  return resolveContactAnswered({ ...opts, via: 'mark_read' })
}

/** cheap tick 的状态读写面：快照读面（节律采样）+ reflow 写面。 */
export type CheapTickStore = SnapshotStore & ReflowStore & {
  latestExperienceTs(source: ExperienceSource): string | null
}

export function cheapTick(opts: {
  ownerName?: string
  store: CheapTickStore
  notifications: NotificationsView
  now: Date
  logEvent?: LogEvent
}): { contact_unanswered: boolean; silence_anomaly: boolean } {
  const { store, notifications, now, logEvent } = opts
  const out = { contact_unanswered: false, silence_anomaly: false }

  const pending = pendingContactTs(store, notifications)
  const observedSilence = store.latestExperienceTs('silence')
  if (pending !== null && hoursBetween(pending, now) > CONTACT_RESPONSE_TIMEOUT_H
    && (observedSilence === null || observedSilence < pending)) {
    recordExperience(
      store,
'silence',
`我主动联系了 ${opts.ownerName ?? '所有者'},超过 ${Math.trunc(CONTACT_RESPONSE_TIMEOUT_H)} 小时没有回应`,
      { salience: SILENCE_SALIENCE, now },
    )
    logEvent?.('mind_contact_unanswered', { pending_since: pending })
    out.contact_unanswered = true
  }

  const lastRows: HistoryRow[] = store.getRecentHistoryOfType('conversation', 1)
  if (lastRows.length > 0) {
    const lastTs = lastRows[0]!.ts
    const hoursQuiet = hoursBetween(lastTs, now)
    const stamps = conversationTimestamps(store, now)
    const typical = medianGapHours(stamps)
    const usuallyActive = sameWindowDays(stamps, now) >= SILENCE_WINDOW_MIN_DAYS

    const anomalous
      = hoursQuiet >= SILENCE_MIN_HOURS
      && hoursQuiet > SILENCE_ANOMALY_FACTOR * typical
      && usuallyActive
    if (anomalous) {

      const lastSilence = store.latestExperienceTs('silence')
      if (lastSilence === null || lastSilence < lastTs) {
        recordExperience(
          store,
'silence',
`${opts.ownerName ?? '所有者'} 比平时安静:已经 ${pyFloat1(hoursQuiet)} 小时没有互动`
          + `(这个时段通常有互动,典型间隔约 ${pyFloat1(typical)} 小时)`,
          { salience: SILENCE_SALIENCE, now },
        )
        logEvent?.('mind_silence_anomaly', { hours_quiet: roundDecimal(hoursQuiet, 1) })
        out.silence_anomaly = true
      }
    }
  }
  return out
}

// ============================== 对话回合回流（W3#2 → W5 落地） ==============================

/** Kevin 显式引用的 autonomous 呼唤（surface 已校验的通知记录子集）。 */
export interface ReplyToNotification {
  id: number
  ts?: string | null
  [key: string]: unknown
}

export function conversationTurnReflow(opts: {
  store: ReflowStore & { lastCauseEventTs(causes: readonly string[]): string | null }
  notifications: NotificationsView
  ownerName?: string
  userText: string
  replyText: string
  historyId: number
  now: Date
  replyToNotification?: ReplyToNotification | null

  markReplied?: (notificationId: number, historyId: number, now: Date) => void
  logEvent?: LogEvent

  pulse?: readonly string[]
  /** converse/pulse_applied 的两个 id 栏。 */
  runId?: string | null
  turnId?: string | null
}): void {
  const { store, notifications, now, logEvent } = opts

  let content
    = `和 ${opts.ownerName ?? '所有者'} 聊了一轮(history #${opts.historyId}):`
    + `对方说「${clipStripped(opts.userText, 80)}」,我答「${clipStripped(opts.replyText, 80)}」`
  let via = 'chat_turn'
  const replyTo = opts.replyToNotification ?? null
  if (replyTo !== null) {
    via = 'reply_to'
    opts.markReplied?.(replyTo.id, opts.historyId, now)

    const ts = 'ts' in replyTo ? pyStr(replyTo.ts) : '?'
    content += `——这是他在回应我 ${ts} 的主动呼唤(通知 #${replyTo.id})`
  }
  recordExperience(store, 'conversation', content, { now })
  store.applyRegulationCause('normal_interaction', { now })

  // 打过一次，applyPulse 会跳过它，不双打。
  applyPulse(store, opts.pulse ?? [], {
    now, logEvent, runId: opts.runId ?? null, turnId: opts.turnId ?? null,
  })
  resolveContactAnswered({ store, notifications, now, via, logEvent })
}

/** 一轮对话最多消费的脉冲因数（超出按信封序丢弃）。 */
export const PULSE_APPLY_MAX = 3
/** 脉冲里这个名字跳过 —— conversationTurnReflow 每轮已固定打一次，再打就是双打。 */
export const PULSE_SKIP_CAUSE = 'normal_interaction'
/** 脉冲消费审计（只在 applied 非空时记；零正文 —— 只有 CAUSES 枚举名与计数）。 */
export const PULSE_APPLIED_EVENT = 'converse/pulse_applied'

export function applyPulse(
  store: Pick<ReflowStore, 'applyRegulationCause'>,
  pulse: readonly string[],
  opts: { now: Date; logEvent?: LogEvent; runId?: string | null; turnId?: string | null },
): string[] {
  const applied: string[] = []
  for (const cause of pulse.filter((name) => name !== PULSE_SKIP_CAUSE).slice(0, PULSE_APPLY_MAX)) {
    store.applyRegulationCause(cause, { now: opts.now })
    applied.push(cause)
  }
  if (applied.length > 0) {
    opts.logEvent?.(PULSE_APPLIED_EVENT, {
      run_id: opts.runId ?? null,
      turn_id: opts.turnId ?? null,
      applied,
      skipped: pulse.length - applied.length,
    })
  }
  return applied
}
