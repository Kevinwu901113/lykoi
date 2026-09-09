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

export function loadNotificationState(): NotificationState {
  const path = notificationsPath()
  if (!existsSync(path)) return { version: 2, next_id: 1, items: [] }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8')) // 无保护：坏文件可见崩溃
  if (Array.isArray(raw)) {

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

    state.items = state.items.slice(-NOTIFICATIONS_MAX_KEEP)
  }
  saveNotificationState(state)
  logEvent('notification_sent', { id: notif.id, origin: fields.origin })
  return notif
}

export const AUTONOMOUS_DAILY_CAP = 2
/** 两条自主通知之间的最小间隔（秒）。 */
export const AUTONOMOUS_COOLDOWN_S = 2 * 3600

function _topicHash(text: string): string {
  return createHash('sha256').update((text ?? '').trim().toLowerCase(), 'utf8').digest('hex')
}

export function _autonomousThrottle(
  items: readonly Record<string, unknown>[],
  summary: string,
  now: Date,
): string | null {
  const auto: [Date, string][] = []
  for (const item of items) {
    if (item.origin !== 'autonomous' || !item.ts) continue
    const ts = new Date(String(item.ts))

    if (Number.isNaN(ts.getTime())) continue
    auto.push([ts, typeof item.content === 'string' ? item.content : ''])
  }

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

export const THROTTLE_POLICIES: Readonly<Record<string, ThrottlePolicy>> = {
  autonomous: _autonomousThrottle,
}

let _outboxDelivery = false
/** 投递线注入位（kernel 不 import 插件包 —— chat_outbox 住在出站器官那一侧）。 */
let _outboxSink: ((content: string, kind: string) => void) | null = null

export function notificationOutboxDelivery(): boolean {
  return _outboxDelivery
}

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

export interface SendNotificationResult {
  throttled?: true
  reason?: string | null
  [key: string]: unknown
}

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

  if (_outboxDelivery && _outboxSink !== null) {
    _outboxSink(content, NOTIFICATION_OUTBOX_KIND)
    logEvent('notification_outbox_delivery', { id: notif.id, origin })
  }
  return notif
}

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
