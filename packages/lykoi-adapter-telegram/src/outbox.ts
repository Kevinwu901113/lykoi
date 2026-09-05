/**
 * chat outbox + 未送达账本（shared/chat_outbox.py 逐字对拍；SK-79/81 的存储面）。
 *
 * **上半张表：她在对话框里的主动发言队列。** 后台跟进（followup）的结果与自主
 * 路径的主动开口（proactive）排进这个出站队列。它是对话 surface 的延伸（和同步
 * 回复同级），不是对外副作用通道，所以**入队本身不过 kernel.dispatch** —— 内容
 * 来自一个完整审计过的回合。正式读取是**非破坏性**的广播日志，每个消费者只持
 * 自己的 cursor。
 *
 * **下半张表另住一张：Telegram 出站的未送达账本**（WO-U0 ②/WO-U1 ②）。两张表
 * **互不读写**，同住是为了层次（文件头逐字理由见下面那一节）。
 *
 * Python→TS 形态适配：`file_lock` 跨进程锁 → 单进程插件树里的同步 RMW（与
 * kernel/jsonio.ts 的 GK-4 同源声明逐字同理由）；`write_json_atomic` → 同目录
 * 临时文件 + fsync + rename。
 */
import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomicSync } from './jsonio.ts'

// ============================================================================
// 上半张表：主动发言队列（广播日志）
// ============================================================================

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

/**
 * 读 outbox state（chat_outbox._load_state 逐字）。v1 裸 list **就地迁移**（下一次
 * append 才持久 v2；读保持零副作用）；非法形状抛 —— **无保护，刻意**（R-14 与
 * GK-2 同族：可见的崩溃，不是静默的数据丢失）。
 */
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

/**
 * 入队一条主动发言。`kind` 标注消息类别（followup=进度/结果、
 * approval_request=挂起任务的审批请求、proactive=自主路径的主动开口、
 * notification=GK-8 开启后并入的通知）；不认识的 kind 当普通消息打印即可。
 */
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

/**
 * 账本里当前最大的 id（空账本 = 0）—— **纯读，不发事件**。
 *
 * 给**新消费者**定游标初值用："从现在起"，而不是把积压的陈货全灌一遍
 * （SK-79）。刻意不复用 `readAfter`：那个会记一条 `chat_outbox_read`，而定初值
 * 并没有读走任何一条消息，记了就是假账。
 */
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

// ============================================================================
// 下半张表：未送达账本（WO-U0 ② 的存储面 / WO-U1 ② 的读取面）
// ============================================================================
// 为什么和主动发言队列同住一个模块 —— 层次，不是省事（活体文件头逐字）：
//   * 账本住在两边都够得着的最底层：投递失败的一侧写得了，装配上下文的一侧读得
//     了，谁都不必跨层 import 谁。（新体形态：converse 经注入的 `UndeliveredView`
//     读，源码上一次 cognition→resources 的 import 都不发生。）
//   * 两者同类：都是"她说出去的话"的持久账，共用同一套原子写纪律。**但两张表
//     互不读写**：上面的 outbox 是广播日志（消费者是 cursor），这里是 Telegram
//     出站的未送达记录 —— U0 侦查早已判定前者不能兼任后者。
//   * 不新建模块：新文件 = manifest 多一条受保护源文件，而这件事不值一条。
//
// **单写者**：记录的**产生**仍只有一个入口 —— `transport.recordUndelivered`
// （U0 口径：一条出站消息要么有 message_id，要么在这张表里）。本节只提供存取
// 原语与 surfaced 标记，自己绝不造记录。

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

/**
 * 读未送达账本。**记录本身损坏时当空处理**：丢掉旧记录也好过让一次投递失败
 * 升级成崩溃（与上面 outbox 的"坏文件抛"**刻意相反** —— R-14 坏文件语义四档，
 * 逐文件复刻活体的取舍，不统一）。
 */
function _loadUndelivered(): UndeliveredState {
  const path = undeliveredPath()
  if (!existsSync(path)) return { next_id: 1, items: [] }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return { next_id: 1, items: [] }
  }
  if (typeof raw !== 'object' || raw === null
    || !Array.isArray((raw as Record<string, unknown>).items)) {
    return { next_id: 1, items: [] }
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

/**
 * 还没进过她上下文的未送达记录，最近的 `limit` 条（最新在后）。
 *
 * **纯读**：不建文件、不写文件 —— 账本不存在时返回 `[]`，于是"她没有掉过话"的
 * 那些天，上下文与今天逐字节一致（WO-U1 ③）。标记由 `markUndeliveredSurfaced`
 * 单独完成，因为"装配了一次"不等于"她真的看到了一次"：装配在预算收敛循环里
 * 会跑好几遍。
 */
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
