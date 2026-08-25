/**
 * 所有者通知队列（kernel/notifications.py 逐字对拍；SK-56..58 + GK-1/GK-8）。
 *
 * W1 只立了文件读写原语；**M3-W3 起这里是队列真身**：节流策略表（SK-57）、
 * 读面（get/unread_count/get_notification）、mark_replied（SK-58）全部就位。
 *
 * **唯一合法调用方 = 两个 dispatch 注册的资源 handler**（`notify.owner` 与
 * `autonomy.queue_notification`，SK-56 逐字）：认知、surface 与调度器一律经
 * `kernel.dispatch` 进来，于是每一条通知都过了 pre-dispatch 不可变审计门与
 * 策略判定。**内容只在队列里，不入审计** —— 审计只记 id 与 origin。
 *
 * GK-1（治理定案，列 Kevin 追认清单）：活体 id = max+1（DK-03：环形淘汰后 id
 * 会复用，mark_replied 有错绑面）；新体**持久 next_id**，手法与 chat_outbox v2
 * 逐字同源 —— {"version": 2, "next_id": int, "items": [...]}，读到 v1 裸 list
 * 就地迁移（读保持零副作用，下一次 append 才落 v2）。id 从此单调，错绑面消灭。
 *
 * 坏文件姿态（R-14 / GK-2 同族）：**照抄活体 —— 无保护**。load 对坏 JSON 直接
 * 抛、对非法形状抛 ValueError 对应 —— 可见的崩溃，不是静默的数据丢失。不许
 * 顺手 try/catch；要改语义单独提单。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomic } from './jsonio.ts'
import { logEvent } from './telemetry.ts'

export function notificationsPath(): string {
  return process.env.LYKOI_NOTIFICATIONS ?? 'var/state/notifications.json'
}

/** 队列有界；最旧的（通常已读）滚出。 */
export const NOTIFICATIONS_MAX_KEEP = 500

export interface NotificationState {
  version: 2
  next_id: number
  items: Record<string, unknown>[]
}

function _intId(item: Record<string, unknown>): number {
  const raw = item.id
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? 0), 10)
  return Number.isFinite(n) ? n : 0
}

/**
 * 读通知 state（chat_outbox._load_state 同法）。文件缺席 → 空 v2；v1 裸 list →
 * 就地迁移（不落盘）；坏 JSON / 非法形状 → 抛（无保护，刻意）。
 */
export function loadNotificationState(): NotificationState {
  const path = notificationsPath()
  if (!existsSync(path)) return { version: 2, next_id: 1, items: [] }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8')) // 无保护：坏文件可见崩溃
  if (Array.isArray(raw)) {
    // v1 裸 list（活体现行形态）的就地迁移；读保持零副作用，append 才持久 v2。
    const items = raw as Record<string, unknown>[]
    return {
      version: 2,
      next_id: Math.max(0, ...items.map(_intId)) + 1,
      items,
    }
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as Record<string, unknown>).items)) {
    throw new Error('invalid notifications state')
  }
  const doc = raw as Record<string, unknown>
  const items = doc.items as Record<string, unknown>[]
  const nextFromItems = Math.max(0, ...items.map(_intId)) + 1
  const rawNext = typeof doc.next_id === 'number' ? Math.trunc(doc.next_id) : Number.parseInt(String(doc.next_id ?? 1), 10)
  return {
    version: 2,
    next_id: Math.max(Number.isFinite(rawNext) ? rawNext : 1, nextFromItems, 1),
    items,
  }
}

export function saveNotificationState(state: NotificationState): void {
  writeJsonAtomic(notificationsPath(), state)
}

/**
 * 追加一条通知记录（持久 next_id 分配 + 环形上限）。**只是原语**：节流政策
 * （AUTONOMOUS 日上限/冷却/同题去重）与"谁允许调它"（仅 dispatch 注册的
 * handler）由下面的 `sendNotification` 真身承担 —— 本函数是它的落笔面。
 */
export function appendNotification(
  fields: { content: string; origin: string; autonomy_run_id?: string | null; kind?: string | null },
  opts: { now?: Date } = {},
): Record<string, unknown> {
  const state = loadNotificationState()
  const notif: Record<string, unknown> = {
    id: state.next_id,
    ts: (opts.now ?? new Date()).toISOString(),
    content: fields.content,
    read: false,
    origin: fields.origin,
  }
  if (fields.autonomy_run_id !== undefined && fields.autonomy_run_id !== null) {
    notif.autonomy_run_id = fields.autonomy_run_id
  }
  if (fields.kind !== undefined && fields.kind !== null) {
    notif.kind = fields.kind
  }
  state.next_id += 1
  state.items.push(notif)
  if (state.items.length > NOTIFICATIONS_MAX_KEEP) {
    // bound growth; drops oldest entries first —— next_id 持久，id 不因此复用（GK-1）
    state.items = state.items.slice(-NOTIFICATIONS_MAX_KEEP)
  }
  saveNotificationState(state)
  logEvent('notification_sent', { id: notif.id, origin: fields.origin })
  return notif
}

// ============================================================================
// SK-57 节流政策（notifications.py:32-77 逐字）
// ============================================================================

/** 她自己起意打扰 Kevin 必须节制：UTC 日上限 2 条。 */
export const AUTONOMOUS_DAILY_CAP = 2
/** 两条自主通知之间的最小间隔（秒）。 */
export const AUTONOMOUS_COOLDOWN_S = 2 * 3600

function _topicHash(text: string): string {
  return createHash('sha256').update((text ?? '').trim().toLowerCase(), 'utf8').digest('hex')
}

/**
 * 返回**阻断**一条自主通知的理由，或 null = 放行（notifications.py:41-65 逐字）。
 *
 * 纯粹**从持久队列现算**，所以它扛得住重启：UTC 日至多 AUTONOMOUS_DAILY_CAP
 * 条、两条之间至少 AUTONOMOUS_COOLDOWN_S 秒、同一天内同题（sha256 去重）不再来
 * 第二条。判定序 = 日上限 → 冷却 → 同题去重，逐字照抄。
 */
export function _autonomousThrottle(
  items: readonly Record<string, unknown>[],
  summary: string,
  now: Date,
): string | null {
  const auto: [Date, string][] = []
  for (const item of items) {
    if (item.origin !== 'autonomous' || !item.ts) continue
    const ts = new Date(String(item.ts))
    // Python `datetime.fromisoformat` 抛 ValueError → continue；TS 形态 = NaN 判定。
    if (Number.isNaN(ts.getTime())) continue
    auto.push([ts, typeof item.content === 'string' ? item.content : ''])
  }
  // Python `now.replace(hour=0, ...)`：活体 clock.now() 是 UTC aware，所以这是
  // **UTC 日**的午夜（口径写在 SK-57 里："at most CAP per UTC day"）。
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0,
  ))
  const todays = auto.filter(([ts]) => ts.getTime() >= midnight.getTime())
  if (todays.length >= AUTONOMOUS_DAILY_CAP) return 'daily_cap'
  for (const [ts] of auto) {
    if ((now.getTime() - ts.getTime()) / 1000 < AUTONOMOUS_COOLDOWN_S) return 'cooldown'
  }
  const topic = _topicHash(summary)
  if (todays.some(([, content]) => _topicHash(content) === topic)) return 'dedup'
  return null
}

export type ThrottlePolicy = (
  items: readonly Record<string, unknown>[],
  summary: string,
  now: Date,
) => string | null

/**
 * 按 origin 的节流政策表（notifications.py:68-77 逐字）。
 *
 * **表里没有的 origin 一律不节流 —— 这是一条显式政策**（"owner receipts and
 * scheduler alerts must never be silently dropped"），不是漏掉的特例。一条通知
 * 带哪个 origin 由 handler 层按动作语义决定（resources 的 notify/autonomy），
 * 这个传输层只负责套上匹配的政策。
 */
export const THROTTLE_POLICIES: Readonly<Record<string, ThrottlePolicy>> = {
  autonomous: _autonomousThrottle,
}

// ============================================================================
// GK-8（治理定案，Kevin 决断项）：kind=notification 并入投递线 —— **默认关**
// ============================================================================
// DK-12：具身转向之后通知队列仍是 pull 模型（Kevin 自己来看），而她唯一的社交
// 躯体是 Telegram。把 kind=notification 并进 chat_outbox 的投递线就能让通知真的
// 到达他手上 —— 但那是**改变到达行为**，蓝图 GK-8 明定：做成开关、**默认关**、
// 开启=Kevin 决断项。构建侧不自作主张改。
//
// 开关一处、消费两处：本模块在 sendNotification 之后决定"要不要也排进投递线"，
// 出站游标机的可投递 kind 表读同一个开关（outboxDeliverableKinds）。
let _outboxDelivery = false
/** 投递线注入位（kernel 不 import 插件包 —— chat_outbox 住在出站器官那一侧）。 */
let _outboxSink: ((content: string, kind: string) => void) | null = null

/** GK-8 开关的现值（缺省 false）。 */
export function notificationOutboxDelivery(): boolean {
  return _outboxDelivery
}

/** 开启/关闭 GK-8 并入投递线（生产开启 = Kevin 决断，构建侧只提供旋钮）。 */
export function setNotificationOutboxDelivery(enabled: boolean): void {
  _outboxDelivery = enabled === true
}

/** 接线方注入 chat_outbox 的 append 面；null 摘除。 */
export function setNotificationOutboxSink(
  sink: ((content: string, kind: string) => void) | null,
): void {
  _outboxSink = sink
}

/** kind=notification 的投递线 kind 名（并入时用）。 */
export const NOTIFICATION_OUTBOX_KIND = 'notification'

// ============================================================================
// 传输（notifications.py:91-128 逐字）
// ============================================================================

export interface SendNotificationResult {
  throttled?: true
  reason?: string | null
  [key: string]: unknown
}

/**
 * 排一条所有者通知（notifications.py:91-128 逐字）。`origin` 缺省 "system"。
 * THROTTLE_POLICIES 表按 origin 决定这一条能不能被挡；被挡的返回
 * `{throttled: true, reason}` 而**不是**一条队列记录。`now` 可注入。
 *
 * **唯一合法调用方是两个 handler**（SK-56）：`notify.owner` 与
 * `autonomy.queue_notification`。静态结构测试钉这条（governance-invariant）。
 */
export function sendNotification(
  content: string,
  opts: {
    origin?: string
    autonomyRunId?: string | null
    kind?: string | null
    now?: Date
  } = {},
): SendNotificationResult {
  const origin = opts.origin ?? 'system'
  const ts = opts.now ?? new Date()
  const state = loadNotificationState()
  const policy = THROTTLE_POLICIES[origin]
  if (policy !== undefined) {
    const reason = policy(state.items, content, ts)
    if (reason !== null) {
      logEvent('notification_throttled', { origin, reason })
      return { throttled: true, reason }
    }
  }
  const notif = appendNotification({
    content,
    origin,
    ...(opts.autonomyRunId === undefined ? {} : { autonomy_run_id: opts.autonomyRunId }),
    ...(opts.kind === undefined ? {} : { kind: opts.kind }),
  }, { now: ts })
  // GK-8：默认关。开启后同一条内容再排进投递线，于是它经出站游标机真的到达他
  // 手上；关着的时候到达行为与活体逐字一致（pull 模型）。
  if (_outboxDelivery && _outboxSink !== null) {
    _outboxSink(content, NOTIFICATION_OUTBOX_KIND)
    logEvent('notification_outbox_delivery', { id: notif.id, origin })
  }
  return notif
}

// ============================================================================
// 读面（notifications.py:131-151 逐字）
// ============================================================================

export function getNotifications(
  unreadOnly = true,
  markRead = false,
): Record<string, unknown>[] {
  const state = loadNotificationState()
  const result = state.items.filter((i) => !(unreadOnly && i.read))
  if (markRead && result.length > 0) {
    const shown = new Set(result.map((i) => _intId(i)))
    for (const item of state.items) {
      if (shown.has(_intId(item))) item.read = true
    }
    saveNotificationState(state)
  }
  return result
}

export function unreadCount(): number {
  return loadNotificationState().items.filter((i) => !i.read).length
}

export function getNotification(notificationId: number): Record<string, unknown> | null {
  return loadNotificationState().items.find((i) => _intId(i) === notificationId) ?? null
}

/**
 * 把"这条回话回的是那条通知"戳在通知记录上（notifications.py:154-168 逐字）。
 *
 * **首写获胜**：重复答复是 no-op（幂等）；**已经滚出有界队列的 id 是静默
 * no-op** —— 环形淘汰是设计的一部分，不是错误。GK-1 之后 id 持久单调，所以
 * "滚出去了"与"戳错了别人"不再可能混淆（活体 max+1 复用的那个错绑面消灭）。
 */
export function markReplied(
  notificationId: number,
  historyId: number,
  now?: Date,
): boolean {
  const ts = (now ?? new Date()).toISOString()
  const state = loadNotificationState()
  const target = state.items.find((i) => _intId(i) === notificationId)
  if (target === undefined || target.reply_history_id !== undefined
    && target.reply_history_id !== null) {
    return false
  }
  target.reply_history_id = historyId
  target.replied_ts = ts
  saveNotificationState(state)
  logEvent('notification_replied', { id: notificationId, history_id: historyId })
  return true
}

/**
 * 快照读面：今日还剩几条自主通知（snapshot.py:163-178
 * `_notifications_remaining_today` 对应物，SA-42）。
 *
 * **从权威队列现算** = max(0, AUTONOMOUS_DAILY_CAP - 今日 autonomous 已发)。
 * 节流本身留在 kernel，这里只是一个视图、不是执行点 —— 冷却与同题去重不体现在
 * 这个数字里（它们由 sendNotification 兜底）。
 */
export function notificationsRemainingToday(now: Date): number {
  const items = loadNotificationState().items
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  let todays = 0
  for (const item of items) {
    if (item.origin !== 'autonomous' || !item.ts) continue
    const ts = new Date(String(item.ts))
    if (Number.isNaN(ts.getTime())) continue
    if (ts.getTime() >= midnight) todays += 1
  }
  return Math.max(0, AUTONOMOUS_DAILY_CAP - todays)
}
