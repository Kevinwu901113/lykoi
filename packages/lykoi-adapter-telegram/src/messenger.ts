import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomicSync } from './jsonio.ts'

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

let _transport: MessengerTransport | null = null

export function setTransport(transport: MessengerTransport | null): void {
  _transport = transport
}

export function currentTransport(): MessengerTransport {
  if (!_transport) throw new Error('messenger transport unavailable')
  return _transport
}

export const PROACTIVE_DAILY_CAP = 1
export const PROACTIVE_COOLDOWN_H = 6.0
/** 账本环：只留最近 50 次。 */
const LEDGER_MAX_KEEP = 50

export function messengerLedgerPath(): string {
  return process.env.LYKOI_MESSENGER_LEDGER ?? 'var/state/messenger_outbound.json'
}

function _loadLedger(): string[] {
  const path = messengerLedgerPath()
  if (!existsSync(path)) return []
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(data) || data.some(value => typeof value !== 'string' || !Number.isFinite(Date.parse(value)))) {
    throw new TypeError('messenger ledger must contain valid timestamps')
  }
  return data as string[]
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
    if ((now.getTime() - last.getTime()) / 1000 < PROACTIVE_COOLDOWN_H * 3600) return 'cooldown'
  }
  return null
}

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
  const transport = currentTransport()

  if (replyTo === null || replyTo === undefined) {
    const reason = _reserveProactiveSlot()
    if (reason !== null) return { sent: false, throttled: true, reason }
  }
  const result = await transport.sendMessage({
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
  return await currentTransport().fetchUpdates({
    contextId: contextId === undefined || contextId === null ? null : String(contextId),
    limit: limit as number,
  }) as unknown as Record<string, unknown>
}
