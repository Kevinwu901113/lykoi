import {
  sendNotification, trySend as proactiveTrySend,
  type ResourceHandler, type ResourceRegistry,
} from 'lykoi-kernel'
import type { Capability } from 'lykoi-contracts'
import { appendOutbox } from './outbox.ts'
import * as messenger from './messenger.ts'

export const NOTIFY_ALLOWED_ORIGINS: ReadonlySet<string>
  = new Set(['interactive', 'scheduler', 'system'])

/**
 * `notify.owner` —— dispatch 通往所有者队列的唯一路径。
 *
 * `params.origin` 必须等于派发上下文的 origin —— **可信调用方自己盖章（模型给的
 * 工具参数被覆写，永不被相信）**，而按 origin 的节流政策以它为键。
 */
export async function notifyOwner(params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const content = params.content
  if (!content) throw new TypeError("notify.owner requires 'content'")
  const origin = String(params.origin ?? 'system')
  if (!NOTIFY_ALLOWED_ORIGINS.has(origin)) {
    throw new TypeError(`notify.owner does not accept origin '${origin}'`)
  }
  const notif = sendNotification(String(content), { origin })
  if (notif.throttled) return { queued: false, throttled: true, reason: notif.reason }
  return { queued: true, notified: true, id: notif.id }
}

/**
 * `autonomy.queue_notification` —— 自主环排一条所有者通知，**带 origin 标签所以
 * 会被节流**（≤2/日、冷却、去重）。被节流的返回 `{queued: false, reason}` 而不是
 * 到达 Kevin。
 */
export async function queueNotification(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const summary = params.summary || params.content
  if (!summary) throw new TypeError("queue_notification requires 'summary'")
  const notif = sendNotification(String(summary), {
    origin: 'autonomous',
    autonomyRunId: (params.run_id ?? null) as string | null,
    kind: 'notification',
  })
  if (notif.throttled) return { queued: false, reason: notif.reason }
  return { queued: true, id: notif.id }
}

/**
 * `autonomy.initiate_chat` —— 主动开口：自主路径在对话框里发起一条主动对话，
 * 排进 chat_outbox（kind=proactive）。
 *
 * 消费者是**设备层的出站投递线**（本包 device.ts，长轮询间隙取走）。所以这里的
 * `queued=true` 只说明"**已交给投递**"，不是送达 —— 送达与否由那一侧的两个结局
 * 交代（有 message_id / 进未送达账本 → U1 回灌成她的经验）。
 *
 * 预算比通知更紧（日 1 条 / 冷却 ≥6h），由 `proactive_chat` 账本在此**原子强制**
 * —— 被拦下返回 `{queued: false, reason}`，她体验为结果而非异常（红线 #5）。
 */
export async function initiateChat(
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const content = String(params.content ?? '').trim()
  if (!content) throw new TypeError("initiate_chat requires 'content'")
  const reason = proactiveTrySend()
  if (reason !== null) return { queued: false, reason }
  const msg = appendOutbox(content, 'proactive')
  return { queued: true, id: msg.id }
}

/** Descriptions, schemas and handlers are declared together by this plugin. */
export function outboundCapabilities(): Capability[] {
  return [
    { name: 'messenger.send', description: 'Send text to a known conversation context. Omitting reply_to is a proactive message and consumes its existing quota.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, context_id: { type: 'string' }, reply_to: { type: ['string', 'null'] } }, required: ['text', 'context_id'] }, handler: messenger.send },
    { name: 'messenger.read', description: 'Read recent messages, optionally restricted to a known context.',
      inputSchema: { type: 'object', properties: { context_id: { type: ['string', 'null'] }, limit: { type: 'integer', minimum: 1 } } }, handler: messenger.read },
    { name: 'notify.owner', description: 'Queue a notification for the owner. Queued does not mean delivered; existing notification quotas apply.',
      inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }, handler: notifyOwner },
    { name: 'autonomy.queue_notification', description: 'Queue an autonomous notification summary for the owner, subject to its daily quota and cooldown.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string' }, content: { type: 'string' } } }, handler: queueNotification },
    { name: 'autonomy.initiate_chat', description: 'Queue a proactive message to the owner, subject to its daily quota and cooldown.',
      inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] }, handler: initiateChat },
  ]
}

/** Compatibility view for callers assembling the adapter directly. */
export function outboundOrganResources(): ResourceRegistry {
  const registry: Record<string, Record<string, ResourceHandler>> = {}
  for (const { name, handler } of outboundCapabilities()) {
    const [prefix, method] = name.split('.') as [string, string]
    ;(registry[prefix] ??= {})[method] = handler
  }
  return registry
}
