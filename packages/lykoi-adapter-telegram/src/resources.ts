/**
 * 出站器官的资源注册面（W1 TODO ①"unwiredResources 换装"的 W3 那一批）。
 *
 * 换装四个动作：`messenger.send` / `messenger.read`（resources/messenger.py，
 * SK-80）、`notify.owner`（resources/notify.py，SK-60）、
 * `autonomy.queue_notification` + `autonomy.initiate_chat`（resources/autonomy.py）。
 * 其余 14 个动作（browser 5 / terminal.exec / research_browser 4 / delegation 3）
 * **原样留替身** —— 感知与执行器官归 M5。三道门（策略/审计/遮蔽）不因这次换装
 * 移动一行。
 *
 * SK-56 的结构面在这里成立：`sendNotification` 的**唯一合法调用方**就是本文件里
 * 那两个 handler（`notify.owner` 与 `autonomy.queue_notification`）—— 认知、surface
 * 与调度器一律经 `kernel.dispatch` 进来。治理不变量测试静态钉这条。
 */
import {
  sendNotification, trySend as proactiveTrySend, unwiredResources,
  type ResourceHandler, type ResourceRegistry,
} from 'lykoi-kernel'
import { appendOutbox } from './outbox.ts'
import * as messenger from './messenger.ts'

/**
 * 本 handler 会给通知打的 origin。**`autonomous` 被刻意排除**（SK-60）：自主环
 * 有它自己的 allow-list 动作（`autonomy.queue_notification`），不许经 notify.owner
 * 够到 Kevin —— 否则那条路上的日上限/冷却/同题去重就成了一个可以绕开的建议。
 */
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

/**
 * 器官接线位（M5 的 browser / terminal / research_browser / delegation 传输面从
 * 这里进来；本波的测试也用它注入受控器官）。**只是注册面，不是新的可达面** ——
 * 名字不在 `KNOWN_ACTIONS` 里的一律仍被 `_resolve` 在碰资源命名空间之前拒掉
 * （SK-01/02），所以这个 seam 一寸都没有扩动作面。
 */
const _extraOrgans = new Map<string, ResourceHandler>()

export function registerOrganHandler(actionType: string, handler: ResourceHandler | null): void {
  if (handler === null) _extraOrgans.delete(actionType)
  else _extraOrgans.set(actionType, handler)
}

/** 摘掉全部经 `registerOrganHandler` 接进来的器官（测试收尾用）。 */
export function clearOrganHandlers(): void {
  _extraOrgans.clear()
}

/**
 * W3 的器官注册表：替身底座 + 本波换装的五个 handler + 经 `registerOrganHandler`
 * 接进来的那些。（M5 再换 browser / terminal / research_browser / delegation。）
 */
export function outboundOrganResources(): ResourceRegistry {
  const base = unwiredResources() as unknown as Record<string, Record<string, ResourceHandler>>
  const registry: Record<string, Record<string, ResourceHandler>> = {}
  for (const [prefix, methods] of Object.entries(base)) registry[prefix] = { ...methods }
  registry.messenger = {
    send: messenger.send as ResourceHandler,
    read: messenger.read as ResourceHandler,
  }
  registry.notify = { owner: notifyOwner as ResourceHandler }
  registry.autonomy = {
    ...registry.autonomy,
    queue_notification: queueNotification as ResourceHandler,
    initiate_chat: initiateChat as ResourceHandler,
  }
  for (const [actionType, handler] of _extraOrgans) {
    const idx = actionType.indexOf('.')
    if (idx <= 0) continue
    const prefix = actionType.slice(0, idx)
    const method = actionType.slice(idx + 1)
    registry[prefix] ??= {}
    registry[prefix]![method] = handler
  }
  return registry as ResourceRegistry
}
