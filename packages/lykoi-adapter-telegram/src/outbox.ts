import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomicSync } from './jsonio.ts'

// 上半张表：主动发言队列（广播日志）

export function chatOutboxPath(): string {
  return process.env.LYKOI_CHAT_OUTBOX ?? 'var/state/chat_outbox.json'
}

/** 有界：极端积压时最旧的主动发言被挤掉。 */
export const CHAT_OUTBOX_MAX_KEEP = 200

export interface OutboxItem {
  id: number
  ts: string
  kind: string
  content: string
}

export interface OutboxState {
  version: 2
  next_id: number
  items: OutboxItem[]
}

function _intId(item: { id?: unknown }): number {
  const raw = item.id
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw ?? 0), 10)
  return Number.isFinite(n) ? n : 0
}

export function loadOutboxState(): OutboxState {
  const path = chatOutboxPath()
  if (!existsSync(path)) return { version: 2, next_id: 1, items: [] }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8')) // 无保护：坏文件可见崩溃
  if (Array.isArray(raw)) {
    const items = raw as OutboxItem[]
    return { version: 2, next_id: Math.max(0, ...items.map(_intId)) + 1, items }
  }
  if (typeof raw !== 'object' || raw === null
    || !Array.isArray((raw as Record<string, unknown>).items)) {
    throw new Error('invalid chat outbox state')
  }
  const doc = raw as Record<string, unknown>
  const items = doc.items as OutboxItem[]
  const nextFromItems = Math.max(0, ...items.map(_intId)) + 1
  const rawNext = typeof doc.next_id === 'number'
    ? Math.trunc(doc.next_id)
    : Number.parseInt(String(doc.next_id ?? 1), 10)
  return {
    version: 2,
    next_id: Math.max(Number.isFinite(rawNext) ? rawNext : 1, nextFromItems, 1),
    items,
  }
}

export function appendOutbox(
  content: string,
  kind = 'followup',
  opts: { now?: Date; logEvent?: (n: string, f: Record<string, unknown>) => void } = {},
): OutboxItem {
  const state = loadOutboxState()
  const msg: OutboxItem = {
    id: state.next_id,
    ts: (opts.now ?? new Date()).toISOString(),
    kind,
    content,
  }
  state.next_id += 1
  state.items.push(msg)
  if (state.items.length > CHAT_OUTBOX_MAX_KEEP) {
    state.items = state.items.slice(-CHAT_OUTBOX_MAX_KEEP)
  }
  writeJsonAtomicSync(chatOutboxPath(), state)
  opts.logEvent?.('chat_outbox_queued', { id: msg.id, kind, chars: content.length })
  return msg
}

export function outboxNewestId(): number {
  const items = loadOutboxState().items
  return items.length > 0 ? _intId(items[items.length - 1]!) : 0
}

export interface OutboxPage {
  messages: OutboxItem[]
  count: number
  next_cursor: number
  oldest_id: number | null
  newest_id: number | null
  gap: boolean
}

/** 非破坏性分页读（chat_outbox.read_after 逐字）。 */
export function readOutboxAfter(
  after = 0,
  limit = 100,
  opts: { logEvent?: (n: string, f: Record<string, unknown>) => void } = {},
): OutboxPage {
  if (after < 0) throw new RangeError('after must be >= 0')
  if (!(limit >= 1 && limit <= CHAT_OUTBOX_MAX_KEEP)) {
    throw new RangeError(`limit must be in [1,${CHAT_OUTBOX_MAX_KEEP}]`)
  }
  const items = [...loadOutboxState().items]
  const oldestId = items.length > 0 ? _intId(items[0]!) : null
  const newestId = items.length > 0 ? _intId(items[items.length - 1]!) : null
  const gap = Boolean(after && oldestId !== null && after < oldestId - 1)
  const messages = items.filter((i) => _intId(i) > after).slice(0, limit)
  const nextCursor = messages.length > 0 ? _intId(messages[messages.length - 1]!) : after
  if (messages.length > 0 || gap) {
    opts.logEvent?.('chat_outbox_read', {
      after, count: messages.length, next_cursor: nextCursor, gap,
    })
  }
  return {
    messages,
    count: messages.length,
    next_cursor: nextCursor,
    oldest_id: oldestId,
    newest_id: newestId,
    gap,
  }
}

export function undeliveredPath(): string {
  return process.env.LYKOI_TELEGRAM_UNDELIVERED ?? 'var/state/telegram_undelivered.json'
}

export const UNDELIVERED_MAX_KEEP = 200

export interface UndeliveredRecord {
  id: number
  ts: string
  context_id: string
  text_summary: string
  chars: number
  error: string
  ambiguous: boolean
  attempts: number
  source: string
  surfaced?: boolean
  surfaced_at?: string
}

interface UndeliveredState {
  next_id: number
  items: UndeliveredRecord[]
}

function _loadUndelivered(): UndeliveredState {
  const path = undeliveredPath()
  if (!existsSync(path)) return { next_id: 1, items: [] }
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof raw !== 'object' || raw === null
    || !Array.isArray((raw as Record<string, unknown>).items)) {
    throw new TypeError('invalid undelivered ledger')
  }
  const doc = raw as Record<string, unknown>
  const items = doc.items as UndeliveredRecord[]
  const nextFromItems = Math.max(0, ...items.map(_intId)) + 1
  const rawNext = typeof doc.next_id === 'number'
    ? Math.trunc(doc.next_id)
    : Number.parseInt(String(doc.next_id ?? 1), 10)
  return {
    next_id: Math.max(Number.isFinite(rawNext) ? rawNext : 1, nextFromItems, 1),
    items,
  }
}

/**
 * 给一条未送达记录分配 id 并落盘（有界）。返回带 id 的记录。
 * **只被 `transport.recordUndelivered` 调用** —— 事件与经验都在那边发，这里只
 * 管持久化。
 */
export function appendUndelivered(record: Omit<UndeliveredRecord, 'id'>): UndeliveredRecord {
  const state = _loadUndelivered()
  const withId = { ...record, id: state.next_id } as UndeliveredRecord
  state.next_id += 1
  state.items.push(withId)
  if (state.items.length > UNDELIVERED_MAX_KEEP) {
    state.items = state.items.slice(-UNDELIVERED_MAX_KEEP)
  }
  writeJsonAtomicSync(undeliveredPath(), state)
  return withId
}

/** 最近的未送达记录（最新在后）—— U0 ②的"可查"那一半。 */
export function undelivered(limit = 50): UndeliveredRecord[] {
  return _loadUndelivered().items.slice(-limit)
}

export function unsurfacedUndelivered(
  contextId: string | null = null,
  limit: number | null = 3,
): UndeliveredRecord[] {
  const items = _loadUndelivered().items
  const fresh = items.filter((item) =>
    !item.surfaced && (contextId === null || String(item.context_id) === String(contextId)))
  return limit === null ? fresh : fresh.slice(-limit)
}

/**
 * 把这些记录标成"她已经读到过一次"，返回实际改动的条数。
 *
 * 展示期就此结束：之后不再注入 —— 看到一次就够了，**重说与否是她的事**
 * （§forbidden：传输层不做自动重发）。已经标过的记录不再改动 `surfaced_at`，
 * 所以重复调用是幂等的。
 */
export function markUndeliveredSurfaced(
  ids: readonly number[],
  opts: { at?: string; logEvent?: (n: string, f: Record<string, unknown>) => void } = {},
): number {
  const wanted = new Set(ids.map((i) => Number(i)))
  if (wanted.size === 0) return 0
  const moment = opts.at ?? new Date().toISOString()
  const state = _loadUndelivered()
  let changed = 0
  for (const item of state.items) {
    if (wanted.has(_intId(item)) && !item.surfaced) {
      item.surfaced = true
      item.surfaced_at = moment
      changed += 1
    }
  }
  if (changed > 0) {
    writeJsonAtomicSync(undeliveredPath(), state)
    opts.logEvent?.('undelivered_surfaced', { count: changed, ids: [...wanted].sort((a, b) => a - b) })
  }
  return changed
}
