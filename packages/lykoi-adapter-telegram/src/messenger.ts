import { workspaceDocument, type DocumentSend } from './document.ts'
import type { CapabilityExecutionContext, ResourceAdmission } from 'lykoi-contracts'
import { trySend } from 'lykoi-kernel'
export { PROACTIVE_CHAT_DAILY_CAP as PROACTIVE_DAILY_CAP, PROACTIVE_CHAT_COOLDOWN_H as PROACTIVE_COOLDOWN_H, proactiveChatLedgerPath as messengerLedgerPath, proactiveRemainingToday as messengerProactiveRemainingToday } from 'lykoi-kernel'

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
  sendDocument?(opts: DocumentSend): Promise<{ message_id: string | null; sent: boolean; [key: string]: unknown }>
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

/** Compatibility entry point; all proactive chat paths reserve the kernel ledger. */
export function _reserveProactiveSlot(now?: Date): string | null {
  const reason = trySend(now)
  if (reason !== null) logEvent('messenger_proactive_throttled', { reason })
  return reason
}

// --- dispatch handlers ---------------------------------------------------------

/**
 * `messenger.send` —— 她在 IM 上开口的**唯一**通路。
 *
 * `params`：`text`（必需）、`context_id`（必需 —— 哪一场对话）、`reply_to`
 * （可选，仅决定传输引用，不授予预算豁免）。
 *
 * kernel 已验证的 E1/E2/E3 预算资格通过独立 admission 传入，不从模型参数读取。
 * 被节流的主动发送返回 `{sent: false, throttled: true, reason}` —— **绝不是一个
 * 异常**，与 `autonomy.initiate_chat` / `notify.owner` 对策略拒绝已经在用的形状
 * 一致。
 */
export async function send(params: Record<string, unknown>, _execution?: CapabilityExecutionContext, admission?: ResourceAdmission): Promise<Record<string, unknown>> {
  const text = params.text
  if (!text) throw new TypeError("messenger.send requires 'text'")
  const contextId = params.context_id
  if (!contextId) throw new TypeError("messenger.send requires 'context_id'")
  const replyTo = params.reply_to
  const transport = currentTransport()

  if (admission?.messageBudget !== 'exempt') {
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

/** Every file export is hard-approved by Kernel; it cannot use text grants or proactive routes. */
export async function sendFile(params: Record<string, unknown>, execution?: CapabilityExecutionContext, instanceWorkspace?: string): Promise<Record<string, unknown>> {
  const workspace = execution?.workspace ?? instanceWorkspace
  if (!workspace) throw new Error('file export requires instance execution context')
  if (typeof params.context_id !== 'string' || !params.context_id) throw new TypeError('file export requires context_id')
  const transport = currentTransport()
  if (!transport.sendDocument) throw new Error('file transport unavailable')
  const document = await workspaceDocument(workspace, params.path)
  const result = await transport.sendDocument({ ...document, contextId: params.context_id,
    replyTo: params.reply_to == null ? null : String(params.reply_to) })
  return { ...result, ok: result.sent && result.message_id !== null }
}
