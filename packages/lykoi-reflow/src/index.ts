/**
 * lykoi-reflow — 执行与回流（M2 波次 3 交付①；mind/reflow.py 对应物）。
 *
 * 顶注语义逐字迁（reflow.py:1-26）：Every executed decision FORCES two
 * experiences into the buffer — one `wake_action`（她选了什么、为什么）and one
 * `action_result`（结果如何）。Failure and emptiness are written too:
 * 没有结果也是结果。旧 bug——无 url 的探索静默 completed——在这里修死：那是
 * failed 拍，她得到扑空经验（SA-58）。
 *
 * 调节场回写是代谢：每条经验 bump load（experience_recorded）、每次非 rest 拍
 * 花费（action_taken）、rest 泄压（rested）、完成的 explore 泄 hunger
 * （explore_completed）、联系尝试落成 contact_answered / contact_unanswered、
 * 接地关切发光（weight↑ / last_lit_at / lit_count）——点亮却未追喂 hunger
 * （concern_lit_unfollowed）。
 *
 * 外部副作用仍**只**经 kernel dispatch（origin=autonomous）；新体 M3 才有真
 * kernel，本模块以 `DispatchFn` 接口位表达（测试注 fake 返回 Observation 形状；
 * 不提供缺省实现——静默替身即绕过脑干）。kernel caps 是任何调节值都抬不掉的
 * 兜底（红线 #5）：被脑干拦下的通知以**结果**回到她身上，不是异常（SA-62）。
 *
 * G-1（治理定案，DA-01 修复）：queue_notification 是**显式分支**；未知 kind →
 * 落审计 `unknown_decision_kind` + 按 failed，**永不默默变成通知**。
 *
 * cheap tick（零 LLM，纯时间比较，SA-67..72）在两拍之间侦测沉默异常与联系
 * 超时；600s 限频与失败遏制在编排层（lykoi-wake 的驱动循环）。
 *
 * 时钟纪律（C-23 / W1 TODO#7）：所有入口 now 必传（Date）；注入源在 lykoi-wake
 * 的 clock 薄件（生产=systemClock、测试=VirtualClock）。
 */
import {
  emitCapabilityGap, GAP_NO_EXECUTION_BRANCH, type Decision, type LogEvent,
} from 'lykoi-decide'
import { parseStateTimestamp, type EpistemicStance, type HistoryRow } from 'lykoi-memory'
import type { ConversationDirection, ExperienceSource } from 'lykoi-memory/rw'
import {
  conversationTimestamps,
  medianGapHours,
  pyRound,
  sameWindowDays,
  type SnapshotStore,
} from 'lykoi-snapshot'

// --- constants（reflow.py:39-48 逐字；初值,待观察期校准） ---------------------
/** 每侧摘要的裁剪长度（reflow.py:40）。 */
export const CLIP_CHARS = 120
/** 短于此的沉默永不算异常（reflow.py:41；SA-68 条件①）。 */
export const SILENCE_MIN_HOURS = 12.0
/** 沉默 > factor × 典型间隔才算异常（reflow.py:42；SA-68 条件②）。 */
export const SILENCE_ANOMALY_FACTOR = 2.0
/** ……且这个时段他通常在（reflow.py:43；SA-68 条件③）。 */
export const SILENCE_WINDOW_MIN_DAYS = 3
/** silence 经验的 salience（reflow.py:44；SA-70）。 */
export const SILENCE_SALIENCE = 0.6
/** 主动联系超过这么久没回应 → contact_unanswered（reflow.py:45；SA-70）。 */
export const CONTACT_RESPONSE_TIMEOUT_H = 24.0
/** cheap tick 的驱动频率上限（reflow.py:46；SA-67 限频，驱动在 lykoi-wake）。 */
export const CHEAP_TICK_INTERVAL_S = 600.0

/** contact 解决因集合（reflow.py:48；SA-71/72 的耐重启标记查询键）。 */
export const CONTACT_RESOLUTION_CAUSES = ['contact_answered', 'contact_unanswered'] as const

// ============================== 依赖面 ==============================

/** kernel dispatch 的返回形状（kernel/dispatch.Observation 的结构化子集）。 */
export interface Observation {
  success: boolean
  data?: unknown
  error?: string | null
}

/**
 * kernel 边界接口位（reflow.py:80-87 _kernel_dispatch 对应物）：外部副作用只经
 * 这里，origin=autonomous 由实现方（M3 真 kernel）盖章。测试注 fake。
 */
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
      /** 认识论第二轴显式覆盖（WO-MEM-SOURCE-01；缺省由渠道推导）。 */
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

/** counts 台账（autonomous.py:187 初始化形状；SA-56/57 口径）。 */
export interface WakeCounts {
  action: number
  external_read: number
  notification: number
}

/**
 * kernel/notifications.get_notifications(unread_only=False) 的结构化子集
 * （_pending_contact_ts 的读面）。M3 接真 kernel 通知队列；W3 测试注 fake。
 */
export interface NotificationsView {
  getNotifications(): readonly { ts?: string | null; origin?: string | null }[]
}

/** 通知队列未接线时的显式空视图（永无未决呼唤；不是静默替身——语义如实）。 */
export const emptyNotifications: NotificationsView = {
  getNotifications: () => [],
}

// ============================== 工具 ==============================

/** reflow._clip（reflow.py:55-57 逐字）：先 strip 再按码点裁，省略号在裁剪外。 */
export function clipStripped(text: string, limit: number = CLIP_CHARS): string {
  const stripped = text.trim()
  const cps = [...stripped]
  return cps.length <= limit ? stripped : cps.slice(0, limit).join('') + '…'
}

/** Python f-string 对任意值的形态（None→'None'、True/False 首字母大写）。 */
function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None'
  if (typeof v === 'boolean') return v ? 'True' : 'False'
  return String(v)
}

/** Python `round(x,1)` 落进 f-string 的形态：float 恒带小数（13.0 → "13.0"）。 */
function pyFloat1(x: number): string {
  const r = pyRound(x, 1)
  return Number.isInteger(r) ? r.toFixed(1) : String(r)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** reflow._hours_between（reflow.py:334-338；naive→UTC 由 parseStateTimestamp 承担）。 */
export function hoursBetween(ts: string, now: Date): number {
  return (now.getTime() - parseStateTimestamp(ts).getTime()) / 3_600_000
}

// ============================== 经验写入点（SA-53） ==============================

/**
 * Phase-2 经验唯一写入点（reflow.py:60-75 逐字）：每条入缓冲的经验都是代谢
 * 压力——record 后必发 `experience_recorded`（load +0.04）。本拍、对话路径与
 * cheap tick 的调用全部走这里。
 */
export function recordExperience(
  store: ReflowStore,
  source: ExperienceSource,
  content: string,
  opts: {
    salience?: number
    relatedConcernId?: number | null
    /**
     * WO-MEM-SOURCE-01：第二轴的显式覆盖与方向提示原样穿到 store 的写点
     * （本层不推导、不改写——推导表只有一份，在 lykoi-memory/rw
     * `deriveEpistemic`）。
     */
    epistemic?: EpistemicStance
    conversationDirection?: ConversationDirection
    now: Date
  },
): number {
  const experienceId = store.recordExperience(source, content, opts)
  store.applyRegulationCause('experience_recorded', { now: opts.now })
  return experienceId
}

// ============================== 执行 + 回流（SA-52..66） ==============================

/**
 * SA-64（reflow.py:92-111 逐字）：决策关联的关切发光。三层语义：
 * ① 去重保序（dict.fromkeys 对应 Set 迭代序）——primary 因此确定性；
 * ② LIVE active 二次闸（WO-P4R12 项4）：快照闸是"她当时看到的"，这里是"现在
 *   还活着的"——快照后被 release/转 dormant、重放决策、混过消毒闸的 id 都在此
 *   落 `grounding_concern_out_of_snapshot`（where=reflow）；
 * ③ 不杀拍：lightConcern 的 ValueError 只记 `mind_light_skipped` 并跳过——
 *   A stale/duplicate id from the model must not kill the beat。
 * 注意 activeIds 只含 status='active'：dimming/dormant 不被点亮（[事实]）。
 */
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
      // Python 只接 ValueError；其余异常照常冒泡（契约破坏 vs 语义拒绝的分野）。
      if (exc instanceof Error && exc.name === 'ValueError') {
        opts.logEvent?.('mind_light_skipped', { concern_id: concernId, error: exc.message })
        continue
      }
      throw exc
    }
  }
  return lit
}

/**
 * SA-55（reflow.py:114-124 逐字）：wake_action 的 content 模板，空格连接、条件
 * 拼装：`[{kind}] [(由 {original_kind} 降级:{demote_why})] [{url}]
 * [clip120(content)] [理由:clip120(reason)]`。
 */
export function actionSummary(decision: Decision): string {
  const bits = [`[${decision.kind}]`]
  if (decision.demoted) {
    bits.push(`(由 ${decision.original_kind} 降级:${decision.demote_why})`)
  }
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

/**
 * SA-63（reflow.py:127-140 逐字）：tend_inner 三形式按字段优先级——
 * thread_id → concern_id → note；恒发 `mind_tend_inner` 带 form；**不经
 * kernel**（内部副作用，全部留痕审计事件流）。
 */
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

/**
 * 执行一个决定并回写一切（reflow.py:143-262）。返回 run status
 * （'completed' | 'failed'）。无论中间发生什么，wake_action 与 action_result
 * 两条经验**必写**（SA-52；异常冒泡的路径除外——那是契约破坏，整拍由编排层记
 * failed，与活体一致）。
 *
 * 不可移位的三步（SA-52/65）：light → primary = lit[0] → wake_action 经验；
 * 末尾恒 action_result，两条经验共用 primary。
 */
export async function executeAndReflow(
  decision: Decision,
  runId: string,
  counts: WakeCounts,
  opts: { store: ReflowStore; dispatchFn: DispatchFn; now: Date; logEvent?: LogEvent },
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
    // SA-54：其余六 kind 全部 action_taken——contemplate/record_note/tend_inner
    // 也计（向内也花一拍）；G-1 的未知 kind 同样先花掉这一拍再大声失败。
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
    } else if (decision.kind === 'explore') {
      if (!decision.url) {
        // SA-58 旧 bug 修复:没有 url 的探索不许静默 completed。零 counts、零 dispatch。
        status = 'failed'
        result = 'explore 扑空:想去看看,但没有起点 url,什么都没读到'
      } else {
        const observation = await dispatchFn(
          'research_browser.read_text', { url: decision.url }, runId,
        )
        // SA-57：counts["action"] 在 dispatch 之后**无条件** +1（被拦下也算）。
        counts.action += 1
        counts.external_read += 1
        if (observation.success) {
          let text = ''
          if (isPlainObject(observation.data)) {
            const raw = observation.data.text
            text = raw ? String(raw) : ''
          }
          // SA-59：hunger 只在 success 分支泄压——失败的 explore 不伪造满足。
          store.applyRegulationCause('explore_completed', { now })
          result = `explore 完成:读了 ${decision.url}(约 ${[...text].length} 字),探索饥饿泄压`
        } else {
          status = 'failed'
          result = `explore 失败:${observation.error || '没有读到内容'}`
        }
      }
    } else if (decision.kind === 'contemplate') {
      // SA-60（WO-P4R-09 路由修正逐字迁,reflow.py:204-214）：contemplate 是纯
      // 内向的一拍——产出是 inner 念头块，由 wake 编排在本函数返回**之后**
      // applyInner 落地，这里不重做任何向内的事。在这条分支存在之前，
      // contemplate 落进 queue_notification 的 else 兜底**误向 Kevin 发了话**
      // （决策记录 §1.6：107/107 进入动作尝试,18 条成了真通知）。零通知、零
      // owner-dispatch：a routing fix, not a new capability——无 kernel
      // dispatch、无新的向外通道。上面的 action_taken 仍算（向内也花一拍）。
      result = 'contemplate 完成:向内的一拍,没有对外发声'
    } else if (decision.kind === 'initiate_chat') {
      // WO-NIGHT-01/B3 主动开口:对话消息,不是手机通知。同 queue_notification
      // 一样走 kernel dispatch(origin=autonomous),预算被拦下时她体验为结果。
      const observation = await dispatchFn(
        'autonomy.initiate_chat',
        { content: (decision.content ?? '').trim(), run_id: runId },
        runId,
      )
      counts.action += 1
      const data = isPlainObject(observation.data) ? observation.data : {}
      if (observation.success && data.queued) {
        // SA-61（WO-REWIRE-PROACTIVE ③ 逐字）：旧文案许诺"他一打开对话就会读到"
        // 是结构性假回执；排队 ≠ 送达。只报她真正做完的那一步；送达与否由投递
        // 路径交代，失败会回灌成她的经验。**不得回退这句文案**。
        result = 'initiate_chat 完成:主动开了口,已交给投递;送达与否之后会回到你的经验里'
      } else if (observation.success) {
        // SA-62：脑干拦下 = 结果，不是异常（status 仍 completed）。
        result = `initiate_chat 被脑干拦下(${pyStr(data.reason)}):主动开口的份额还没回来`
      } else {
        status = 'failed'
        result = `initiate_chat 失败:${pyStr(observation.error)}`
      }
    } else if (decision.kind === 'queue_notification') {
      // G-1（治理定案，DA-01 修复）：活体这里是 `else` 兜底——任何新增而未加
      // 分支的 kind 都会默默变成一条发给 Kevin 的通知（contemplate 踩过的坑）。
      // 新体改**显式分支**；语义与活体逐字等价（今日七 kind 全覆盖）。
      const observation = await dispatchFn(
        'autonomy.queue_notification',
        { summary: (decision.content ?? '').trim(), run_id: runId },
        runId,
      )
      counts.action += 1
      const data = isPlainObject(observation.data) ? observation.data : {}
      if (observation.success && data.queued) {
        // SA-57：counts["notification"] 只在真入队时 +1（行动预算记"她试了一次
        // 外部动作"，通知配额记"确实留了一条话"）。
        counts.notification += 1
        result = 'queue_notification 完成:留了话给 Kevin,等他回应'
      } else if (observation.success) {
        // SA-62：The kernel throttle held — that IS the governance cap working,
        // and she experiences it as a result, not a crash (红线 #5)。
        result = `queue_notification 被脑干拦下(${pyStr(data.reason)}):今天对他说得够多了`
      } else {
        status = 'failed'
        result = `queue_notification 失败:${pyStr(observation.error)}`
      }
    } else {
      // G-1：未知 kind → 落审计 + 按 failed，**永不默默变成通知**。把静默误
      // 路由变成大声失败；action_result 照写（没有结果也是结果）。
      logEvent?.('unknown_decision_kind', { run_id: runId, kind: decision.kind })
      // 位点③（执行点无分支；WO-U2-SENSE-01）：kind 过了词汇表与候选表，却在
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

  // SA-66 / G-5（治理定案：**维持现状**——仅 rest/record_note 记
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

// ============================== contact 解决（SA-71/72） ==============================

/**
 * SA-72（reflow.py:267-281 等价档）：最新一条尚未解决（answered / 超时）的
 * autonomous 主动通知 ts。append-only 的 regulation_events 账本兼作**耐重启的**
 * 解决标记——不另开 state 文件。
 */
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

/**
 * SA-71（reflow.py:284-291 逐字）：唯一的 `contact_answered` 写入点
 * （audit CHAT-01）。有未决呼唤才落账，没有就 no-op——幂等，重复调用不会重复写。
 * 两条上游：对话回合（via=chat_turn / reply_to，W5 conversation 路径接）与
 * 通知标已读（via=mark_read，notificationsReadReflow）。
 */
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

/**
 * Kevin 把 autonomous 通知标为已读 → 呼唤已被看见，按 answered 回流
 * （reflow.py:325-329；audit CHAT-01：34 条已读却零 answered 的关系失真到此
 * 为止）。只修前向，历史已读通知不回填。
 */
export function notificationsReadReflow(opts: {
  store: ReflowStore & { lastCauseEventTs(causes: readonly string[]): string | null }
  notifications: NotificationsView
  now: Date
  logEvent?: LogEvent
}): boolean {
  return resolveContactAnswered({ ...opts, via: 'mark_read' })
}

// ============================== cheap tick（SA-67..70） ==============================

/** cheap tick 的状态读写面：快照读面（节律采样）+ reflow 写面。 */
export type CheapTickStore = SnapshotStore & ReflowStore & {
  latestExperienceTs(source: ExperienceSource): string | null
}

/**
 * 两拍之间的家务（reflow.py:341-384 逐字）：contact 超时 + 沉默异常侦测。
 * 对盘面既有状态做纯时间比较；safe to run often（600s 限频与失败遏制由
 * lykoi-wake 的驱动循环承担，SA-67）。
 */
export function cheapTick(opts: {
  store: CheapTickStore
  notifications: NotificationsView
  now: Date
  logEvent?: LogEvent
}): { contact_unanswered: boolean; silence_anomaly: boolean } {
  const { store, notifications, now, logEvent } = opts
  const out = { contact_unanswered: false, silence_anomaly: false }

  // SA-70：contact 超时 24h → contact_unanswered + silence 经验（salience 0.6）。
  const pending = pendingContactTs(store, notifications)
  if (pending !== null && hoursBetween(pending, now) > CONTACT_RESPONSE_TIMEOUT_H) {
    store.applyRegulationCause('contact_unanswered', { now })
    recordExperience(
      store,
      'silence',
      `我主动联系了 Kevin,超过 ${Math.trunc(CONTACT_RESPONSE_TIMEOUT_H)} 小时没有回应`,
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
    // SA-68：三条件全部成立才算异常（≥12h ∧ >2×typical ∧ 时段通常在）。
    const anomalous
      = hoursQuiet >= SILENCE_MIN_HOURS
      && hoursQuiet > SILENCE_ANOMALY_FACTOR * typical
      && usuallyActive
    if (anomalous) {
      // SA-69：每个沉默期只写一次（latest silence 经验早于本次沉默的起点才写）。
      const lastSilence = store.latestExperienceTs('silence')
      if (lastSilence === null || lastSilence < lastTs) {
        recordExperience(
          store,
          'silence',
          `Kevin 比平时安静:已经 ${pyFloat1(hoursQuiet)} 小时没有互动`
          + `(他这个时段通常在,典型间隔约 ${pyFloat1(typical)} 小时)`,
          { salience: SILENCE_SALIENCE, now },
        )
        store.applyRegulationCause('owner_silence_anomaly', { now })
        logEvent?.('mind_silence_anomaly', { hours_quiet: pyRound(hoursQuiet, 1) })
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

/**
 * One finished chat turn → one conversation experience（摘要 + history 行号
 * 引用，蓝图 §3.4）+ normal interaction relief; an outstanding contact attempt
 * is resolved as answered（reflow.py:294-323 逐字）。
 *
 * `replyToNotification` 是 Kevin 显式引用的 autonomous 呼唤（surface 已校验）：
 * 关联戳在通知记录上（首写幂等 —— kernel notifications.mark_replied 归 M3 真
 * 队列，本波 markReplied 接口位），经验内容携带引用让整合管线看见"这句回话
 * 是在回应哪次主动接触"；contact_answered 仍走同一唯一写入点
 * （resolveContactAnswered，W3 已就位只接不改），只是 via 标成 reply_to。
 *
 * 写集（与自主拍 executeAndReflow 对拍分立，见 conversation-turn.test.ts）：
 * experiences 一行（source=conversation）+ regulation_events 两至三行
 * （experience_recorded / normal_interaction / 条件 contact_answered）——
 * 零 concerns 点亮、零 autonomy_notes、零 dispatch。
 */
export function conversationTurnReflow(opts: {
  store: ReflowStore & { lastCauseEventTs(causes: readonly string[]): string | null }
  notifications: NotificationsView
  userText: string
  replyText: string
  historyId: number
  now: Date
  replyToNotification?: ReplyToNotification | null
  /** kernel/notifications.mark_replied 接口位（M3 接真队列；首写幂等归实现方）。 */
  markReplied?: (notificationId: number, historyId: number, now: Date) => void
  logEvent?: LogEvent
}): void {
  const { store, notifications, now, logEvent } = opts
  // 摘要模板逐字（reflow.py:308-311）：user/reply 各裁 80 字。
  let content
    = `和 Kevin 聊了一轮(history #${opts.historyId}):`
    + `他说「${clipStripped(opts.userText, 80)}」,我答「${clipStripped(opts.replyText, 80)}」`
  let via = 'chat_turn'
  const replyTo = opts.replyToNotification ?? null
  if (replyTo !== null) {
    via = 'reply_to'
    opts.markReplied?.(replyTo.id, opts.historyId, now)
    // Python `reply_to_notification.get('ts', '?')`：键缺席 → '?'；值为 None → 'None'。
    const ts = 'ts' in replyTo ? pyStr(replyTo.ts) : '?'
    content += `——这是他在回应我 ${ts} 的主动呼唤(通知 #${replyTo.id})`
  }
  recordExperience(store, 'conversation', content, { now })
  store.applyRegulationCause('normal_interaction', { now })
  resolveContactAnswered({ store, notifications, now, via, logEvent })
}
