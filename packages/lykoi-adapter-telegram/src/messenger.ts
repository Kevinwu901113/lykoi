/**
 * messenger 资源 —— 她自己的 IM 器官（resources/messenger.py 逐字对拍；SK-80）。
 *
 * 设计框（具身重设计 §1.1/§1.2）：她用来和 Kevin 说话的 IM 是一个**器官，不是
 * 投递管道**。像浏览器一样，她靠**做一个动作**够到它 —— `messenger.send` /
 * `messenger.read` 是 dispatch 动作，与她做的其它一切一样被同一套审批/审计/遮蔽/
 * 预算机器管着 —— 而**绝不是**一个把消息直推进认知的平台 webhook。
 *
 * `Transport` 是 seam：一个窄协议（send_message/fetch_updates），真 Telegram 设备
 * 进程客户端实现它而本模块与 dispatch 一行不改。本文件里唯一的实现是
 * `NullTransport`（零网络 I/O，全部记进本地 JSONL）——**它是缺省**；设备层在启动
 * 时把它换成真身（`setTransport`），**单写者 = 设备层**。
 *
 * **打扰纪律（SK-80）整个住在这个文件里**：一组具名常量
 * （PROACTIVE_DAILY_CAP / PROACTIVE_COOLDOWN_H）加**一本持久账本**，所以日后要调
 * 就是一处显然可评审的 diff。**一条回复（`params.reply_to` 有值 —— 回答 Kevin
 * 已经说过的话）永不花预算**；只有她起头的消息才计入 cap/cooldown。被节流的
 * send 返回一个正常的 `{sent: false, ...}` **结果** —— dispatch 永不为一次策略
 * 拒绝抛异常，于是认知体验到的是一个结局，绝不是一次崩溃。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { writeJsonAtomicSync } from './jsonio.ts'
import { dirname } from 'node:path'

type LogEventFn = (name: string, fields: Record<string, unknown>) => void

let _logEvent: LogEventFn = () => {}
export function setMessengerLogEvent(fn: LogEventFn | null): void {
  _logEvent = fn ?? (() => {})
}
function logEvent(name: string, fields: Record<string, unknown> = {}): void {
  try { _logEvent(name, fields) } catch { /* 遥测失败静默 */ }
}

// --- transport 抽象 -----------------------------------------------------------

/**
 * `messenger.send` / `messenger.read` 需要一个 IM 后端提供的东西。
 * **刻意保持窄（两个方法）**，好让真平台客户端实现它而不把平台特有概念
 * （chat id、update offset、bot token……）漏进这个资源模块。
 */
export interface MessengerTransport {
  sendMessage(opts: { contextId: string; text: string; replyTo?: string | null }):
    Promise<{ message_id: string | null; [key: string]: unknown }>
  fetchUpdates(opts: { contextId?: string | null; limit?: number }):
    Promise<{ messages: unknown[]; count: number; [key: string]: unknown }>
}

/**
 * 零网络 I/O。每次调用都追加进一个本地 JSONL 文件，`fetchUpdates` 重放同一个
 * 文件 —— 于是 `messenger.read` 看到的恰好是 `messenger.send` 记下的东西。
 * **这是本单元的缺省 transport**；设备层用真身把它换掉。
 */
export class NullTransport implements MessengerTransport {
  readonly path: string

  constructor(path?: string) {
    this.path = path
      ?? process.env.LYKOI_MESSENGER_TRANSPORT_LOG
      ?? 'var/state/messenger_transport.jsonl'
  }

  #readAll(): Record<string, unknown>[] {
    if (!existsSync(this.path)) return []
    const records: Record<string, unknown>[] = []
    for (const raw of readFileSync(this.path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line) continue
      try {
        records.push(JSON.parse(line) as Record<string, unknown>)
      } catch { continue } // 半截行跳过，永不致命
    }
    return records
  }

  async sendMessage(opts: { contextId: string; text: string; replyTo?: string | null }): Promise<{
    message_id: string | null
    context_id: string
    ts: string
  }> {
    const existing = this.#readAll()
    const record = {
      id: existing.length + 1,
      direction: 'outbound',
      ts: new Date().toISOString(),
      context_id: opts.contextId,
      text: opts.text,
      reply_to: opts.replyTo ?? null,
    }
    mkdirSync(dirname(this.path) || '.', { recursive: true })
    appendFileSync(this.path, JSON.stringify(record) + '\n', 'utf8')
    logEvent('messenger_null_transport_sent', {
      context_id: opts.contextId, chars: opts.text.length,
    })
    return { message_id: String(record.id), context_id: opts.contextId, ts: record.ts }
  }

  async fetchUpdates(opts: { contextId?: string | null; limit?: number } = {}): Promise<{
    messages: Record<string, unknown>[]
    count: number
  }> {
    let records = this.#readAll()
    const contextId = opts.contextId ?? null
    if (contextId !== null) records = records.filter((r) => r.context_id === contextId)
    records = records.slice(-(opts.limit ?? 20))
    return { messages: records, count: records.length }
  }
}

/**
 * 进程内的现役 transport。**缺省是 Null**（零网络）；**单写者 = 设备层**：只有
 * 长轮询那个进程把它换成真身，因为 Bot API 的单进程单写者纪律不许两个写者同时
 * 抢（长轮询 offset 会互相吞更新）。
 */
let _transport: MessengerTransport = new NullTransport()

export function setTransport(transport: MessengerTransport | null): void {
  _transport = transport ?? new NullTransport()
}

export function currentTransport(): MessengerTransport {
  return _transport
}

// --- 打扰纪律（SK-80） ---------------------------------------------------------
// 具名常量，一处：她自己起头的消息，日上限 1 / 冷却 6h。**一条回复
// （params.reply_to 有值）根本不碰这一层** —— 回答 Kevin 不是打扰他。持久化选择：
// LYKOI_MESSENGER_LEDGER 上一份有界的 ISO 时间戳 JSON 列表，与 proactive_chat 的
// 账本同形同位（最近的既有先例 —— 同一套"起头 vs 回应"的预算语义），所以两者都
// 扛得住重启，也都用同一种方式可检视。

export const PROACTIVE_DAILY_CAP = 1
export const PROACTIVE_COOLDOWN_H = 6.0
/** 账本环：只留最近 50 次。 */
const LEDGER_MAX_KEEP = 50

export function messengerLedgerPath(): string {
  return process.env.LYKOI_MESSENGER_LEDGER ?? 'var/state/messenger_outbound.json'
}

/**
 * 读账本。**坏账本当空**：最坏情况是多发一条主动消息（仍受日上限约束），
 * 不是一次硬失败。
 */
function _loadLedger(): string[] {
  const path = messengerLedgerPath()
  if (!existsSync(path)) return []
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
  return Array.isArray(data) ? data as string[] : []
}

function _todayCount(sent: readonly string[], now: Date): number {
  const day = now.toISOString().slice(0, 10)
  let n = 0
  for (const ts of sent) if (typeof ts === 'string' && ts.slice(0, 10) === day) n += 1
  return n
}

function _throttleReason(sent: readonly string[], now: Date): string | null {
  if (_todayCount(sent, now) >= PROACTIVE_DAILY_CAP) return 'daily_cap'
  if (sent.length > 0) {
    const last = new Date(String(sent[sent.length - 1]))
    if (Number.isNaN(last.getTime())) return null
    if ((now.getTime() - last.getTime()) / 1000 < PROACTIVE_COOLDOWN_H * 3600) return 'cooldown'
  }
  return null
}

/**
 * **原子地检查并占用**一个主动发送名额（SK-80）。成功返回 null（名额此刻已经
 * 记账），必须拒绝时返回节流原因（`daily_cap` | `cooldown`）。
 *
 * 检查与占用是**一步**，不是"先查后写"：两步之间的窗口正是名额被超发的地方。
 */
export function _reserveProactiveSlot(now?: Date): string | null {
  const moment = now ?? new Date()
  const sent = _loadLedger()
  const reason = _throttleReason(sent, moment)
  if (reason !== null) {
    logEvent('messenger_proactive_throttled', { reason })
    return reason
  }
  sent.push(moment.toISOString())
  writeJsonAtomicSync(messengerLedgerPath(), sent.slice(-LEDGER_MAX_KEEP))
  return null
}

/** 今日还剩几条主动开口（只读视图）。 */
export function messengerProactiveRemainingToday(now?: Date): number {
  return Math.max(0, PROACTIVE_DAILY_CAP - _todayCount(_loadLedger(), now ?? new Date()))
}

// --- dispatch handlers ---------------------------------------------------------

/**
 * `messenger.send` —— 她在 IM 上开口的**唯一**通路。
 *
 * `params`：`text`（必需）、`context_id`（必需 —— 哪一场对话）、`reply_to`
 * （可选 —— 答一条来话时设；**设了就免主动打扰预算**）。
 *
 * 被节流的主动发送返回 `{sent: false, throttled: true, reason}` —— **绝不是一个
 * 异常**，与 `autonomy.initiate_chat` / `notify.owner` 对策略拒绝已经在用的形状
 * 一致。
 */
export async function send(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const text = params.text
  if (!text) throw new TypeError("messenger.send requires 'text'")
  const contextId = params.context_id
  if (!contextId) throw new TypeError("messenger.send requires 'context_id'")
  const replyTo = params.reply_to
  // **只有 reply_to is None 才过原子 check-and-reserve**（SK-80 逐字）。
  if (replyTo === null || replyTo === undefined) {
    const reason = _reserveProactiveSlot()
    if (reason !== null) return { sent: false, throttled: true, reason }
  }
  const result = await _transport.sendMessage({
    contextId: String(contextId),
    text: String(text),
    replyTo: replyTo === null || replyTo === undefined ? null : String(replyTo),
  })
  return { sent: true, ...result }
}

/**
 * `messenger.read` —— 拉 transport 的近期记录。`params`：`limit`（缺省 20）、
 * `context_id`（可选过滤）。**读不适用任何打扰政策。**
 */
export async function read(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const limit = params.limit ?? 20
  if (typeof limit === 'boolean' || !Number.isInteger(limit) || (limit as number) <= 0) {
    throw new TypeError("messenger.read 'limit' must be a positive integer")
  }
  const contextId = params.context_id
  return await _transport.fetchUpdates({
    contextId: contextId === undefined || contextId === null ? null : String(contextId),
    limit: limit as number,
  }) as unknown as Record<string, unknown>
}
