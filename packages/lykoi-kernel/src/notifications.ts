/**
 * 所有者通知队列 —— **W1 只立文件读写原语**（kernel/notifications.py 的持久
 * 半面；队列语义 —— 节流三策略/读面/mark_replied —— 归 M3-W3，GK-8 的
 * "并入投递线"开关默认关、开启待 Kevin 决断）。
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
 * handler）归 W3 的 send_notification 真身 —— 本函数是它将来的落笔面。
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
