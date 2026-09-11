import type { OwnerInteraction } from 'lykoi-contracts'
import {
  appendOutbox, outboxNewestId, readOutboxAfter, type OutboxItem,
} from './outbox.ts'
import { recordUndelivered } from './transport.ts'
import {
  notificationOutboxDelivery, NOTIFICATION_OUTBOX_KIND,
  upstreamBudgetedDelivery, inPresenceReply,
  type DispatchFunction,
} from 'lykoi-kernel'
import { existsSync, readFileSync } from 'node:fs'
import { writeJsonAtomicSync } from './jsonio.ts'

export const CHANNEL = 'telegram'

export function outboxCursorPath(): string {
  return process.env.LYKOI_TELEGRAM_OUTBOX_CURSOR ?? 'var/state/telegram_outbox.cursor'
}

export const OUTBOX_DELIVERABLE_KINDS: readonly string[] = ['proactive', 'followup']

export function outboxDeliverableKinds(): readonly string[] {
  return notificationOutboxDelivery()
    ? [...OUTBOX_DELIVERABLE_KINDS, NOTIFICATION_OUTBOX_KIND]
    : OUTBOX_DELIVERABLE_KINDS
}

/** 每轮间隙至多投这么多，免得一次积压把长轮询晾太久。 */
export const OUTBOX_BATCH_LIMIT = 20

export function loadOutboxCursor(): number | null {
  const path = outboxCursorPath()
  if (!existsSync(path)) return null
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  const raw = typeof data === 'object' && data !== null
    ? (data as Record<string, unknown>).last_outbox_id : undefined
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < 0) {
    throw new TypeError('outbox cursor must contain a non-negative safe integer')
  }
  return raw
}

export function saveOutboxCursor(lastOutboxId: number): void {
  writeJsonAtomicSync(outboxCursorPath(), { last_outbox_id: Math.trunc(lastOutboxId) })
}

/** Missing cursor starts at the current broadcast boundary; corruption is an error. */
export function initOutboxCursor(logEvent?: (n: string, f: Record<string, unknown>) => void): number {
  const persisted = loadOutboxCursor()
  if (persisted !== null) return persisted
  const cursor = outboxNewestId()
  saveOutboxCursor(cursor)
  logEvent?.('chat_outbox_cursor_initialized', { cursor })
  return cursor
}

// 出站器官

export interface ApprovalLeg {
  requestApproval(actionType: string, params: Record<string, unknown>, opts: {
    contextId: string
    replyTo?: string | null
    origin?: string
    run_id?: string | null
    turn_id?: string | null
    actionId?: string | null
    correlationId?: string | null
  }): Promise<{ status: string; pending_id: string | null }>
  handleOwnerAnswer(answerText: string, opts: {
    contextId: string
    replyTo?: string | number | null
    messageId?: string | number | null
  }): Promise<{ outcome: string; executed: boolean; replied?: boolean; observation?: unknown }>
}

export interface SuggestionLeg {
  handleOwnerAnswer(answerText: string, opts: {
    contextId: string
    replyTo?: string | number | null
    messageId?: string | number | null
  }): Promise<{ outcome: string; suggestion_id: number | null; replied?: boolean }>
}

export interface DelegatedAsk {
  action_type?: unknown
  params?: unknown
  action_id?: unknown
  correlation_id?: unknown
}

/** 与认知回合关联的可选 ID；只进入 kernel/审批上下文，不改变动作参数。 */
export interface OutboundTurnContext {
  run_id?: string | null
  turn_id?: string | null
}

export type OutboundReplyOutcome =
  | 'delivered'
  | 'undelivered'
  | 'needs_approval'
  | 'dispatch_failed'

export interface OutboundReplyResult {
  outcome: OutboundReplyOutcome
}

export interface AskAboutResult {
  asked: boolean
  status?: string
  pending_id?: string | null
}

export interface OutboundOrganDeps {
  /** kernel dispatch 真身 —— 这一层的**唯一**出口。 */
  dispatch: DispatchFunction
  /** owner 的 telegram chat id 读点（identity_bindings，只读；绝不在这里写）。 */
  ownerChannelKey: () => string | null
  approval?: ApprovalLeg | null
  suggestion?: SuggestionLeg | null
  logEvent?: (name: string, fields: Record<string, unknown>) => void
}

export class OutboundOrgan {
  #deps: OutboundOrganDeps
  /** 首次消费时定初值（账本此刻的 max id）。 */
  #outboxCursor: number | null = null
  #outboxLock: Promise<unknown> = Promise.resolve()
  #closed = false

  constructor(deps: OutboundOrganDeps) {
    this.#deps = deps
  }

  #log(name: string, fields: Record<string, unknown> = {}): void {
    this.#deps.logEvent?.(name, fields)
  }

  cursor(): number | null { return this.#outboxCursor }

  async sendReply(opts: {
    contextId: string
    text: string
    replyTo: string | null
    run_id?: string | null
    turn_id?: string | null
  }): Promise<OutboundReplyResult> {
    const params = { text: opts.text, context_id: opts.contextId, reply_to: opts.replyTo }
    const context = {
      origin: 'interactive' as const,
      exemption: inPresenceReply(opts.contextId),
      ...(opts.run_id === undefined ? {} : { run_id: opts.run_id }),
      ...(opts.turn_id === undefined ? {} : { turn_id: opts.turn_id }),
    }
    const observation = await this.#deps.dispatch(
      { type: 'messenger.send', params },
      { context },
    )
    const data = (typeof observation.data === 'object' && observation.data !== null)
      ? observation.data as Record<string, unknown>
      : {}
    if (observation.success) {

      const messageId = data.message_id
      if (data.sent !== false && messageId !== null && messageId !== undefined) {
        this.#log('chat_reply_delivered', {
          message_id: messageId, context_id: String(opts.contextId), chars: opts.text.length,
        })
        return { outcome: 'delivered' }
      }
      if (data.undelivered_recorded !== true) {
        // transport 没到（被打扰频控挡下等）—— 它没机会记账，这里补上。
        recordUndelivered({
          contextId: opts.contextId,
          text: opts.text,
          error: String(data.reason ?? data.error ?? 'not_delivered'),
          source: 'chat_reply',
        })
      }
      return { outcome: 'undelivered' }
    }
    if (data.needs_approval) {

      const outcome = await this.#requireApproval().requestApproval('messenger.send', params, {
        contextId: opts.contextId,
        replyTo: opts.replyTo,
        origin: 'interactive',
        ...(opts.run_id === undefined ? {} : { run_id: opts.run_id }),
        ...(opts.turn_id === undefined ? {} : { turn_id: opts.turn_id }),
        actionId: (data.action_id ?? null) as string | null,
        correlationId: (data.correlation_id ?? null) as string | null,
      })
      this.#log('telegram_reply_awaiting_approval', {
        status: outcome.status, pending_id: outcome.pending_id,
      })
      // **排队等批 ≠ 未送达**：它还有下文，结局由审批那条腿交代。
      return { outcome: 'needs_approval' }
    }
    this.#log('telegram_reply_send_incomplete', {
      error: observation.error, needs_approval: false,
    })
    // 动作本身失败（transport 从未被调用）—— 同样不许静默（③）。
    recordUndelivered({
      contextId: opts.contextId,
      text: opts.text,
      error: observation.error || 'dispatch_failed',
      source: 'chat_reply',
    })
    return { outcome: 'dispatch_failed' }
  }

  async askAbout(action: DelegatedAsk, opts: {
    contextId: string
    replyTo: string | null
    run_id?: string | null
    turn_id?: string | null
  }): Promise<AskAboutResult> {
    const actionType = action.action_type
    const params = action.params
    if (typeof actionType !== 'string' || !actionType
      || typeof params !== 'object' || params === null || Array.isArray(params)) {
      // 认知侧交出的载荷形状不对 —— **宁可不问**，也不拿一个残缺动作去排队。
      this.#log('telegram_approval_ask_malformed', { action_type: String(actionType) })
      return { asked: false }
    }
    const outcome = await this.#requireApproval().requestApproval(
      actionType, params as Record<string, unknown>, {
        contextId: opts.contextId,
        replyTo: opts.replyTo,
        origin: 'interactive',
        ...(opts.run_id === undefined ? {} : { run_id: opts.run_id }),
        ...(opts.turn_id === undefined ? {} : { turn_id: opts.turn_id }),
        actionId: (action.action_id ?? null) as string | null,
        correlationId: (action.correlation_id ?? null) as string | null,
      },
    )
    this.#log('telegram_chat_action_awaiting_approval', {
      status: outcome.status, pending_id: outcome.pending_id, action_type: actionType,
    })
    return { asked: true, status: outcome.status, pending_id: outcome.pending_id }
  }

  #requireApproval(): ApprovalLeg {
    const approval = this.#deps.approval
    if (approval === undefined || approval === null) {
      throw new Error('lykoi-adapter-telegram: approval organ is not wired into the device layer')
    }
    return approval
  }

  async routeOwnerMessage(opts: {
    text: string
    contextId: string
    replyTo: string | number | null
    messageId: string | number | null
  }): Promise<OwnerInteraction | null> {
    const approval = this.#deps.approval
    if (approval !== undefined && approval !== null) {
      const routed = await approval.handleOwnerAnswer(opts.text, {
        contextId: opts.contextId, replyTo: opts.replyTo, messageId: opts.messageId,
      })
      if (routed.outcome !== 'ignored') {
        this.#log('telegram_approval_turn', {
          outcome: routed.outcome, executed: routed.executed,
        })
        return { kind: 'approval_answer', outcome: routed.outcome, executed: routed.executed, replied: routed.replied, ...(routed.observation === undefined ? {} : { observation: routed.observation }) }
      }
    }

    const suggestion = this.#deps.suggestion
    if (suggestion !== undefined && suggestion !== null) {
      const suggested = await suggestion.handleOwnerAnswer(opts.text, {
        contextId: opts.contextId, replyTo: opts.replyTo, messageId: opts.messageId,
      })
      if (suggested.outcome !== 'ignored') {
        this.#log('telegram_rule_suggestion_turn', {
          outcome: suggested.outcome, suggestion_id: suggested.suggestion_id,
        })
        return { kind: 'suggestion_answer', outcome: suggested.outcome, replied: suggested.replied }
      }
    }
    return null
  }

  async deliverOutboxItem(item: OutboxItem, chatId: string): Promise<OutboundReplyOutcome> {
    const text = item.content ?? ''
    const observation = await this.#deps.dispatch(
      // reply_to=null：这是**主动发言**，不是应答 —— 不拿 reply_to 撒谎换额度。
      { type: 'messenger.send', params: { text, context_id: chatId, reply_to: null } },
      { context: { origin: 'autonomous', exemption: upstreamBudgetedDelivery() } },
    )
    const data = (typeof observation.data === 'object' && observation.data !== null)
      ? observation.data as Record<string, unknown>
      : {}
    const messageId = observation.success ? data.message_id : null
    if (messageId !== null && messageId !== undefined) {
      this.#log('chat_outbox_delivered_telegram', {
        id: item.id, kind: item.kind, message_id: messageId, chars: text.length,
      })
      return 'delivered'
    }
    if (data.undelivered_recorded !== true) {
      // transport 自己没记账 —— 补上，好让"一条出站消息要么有 message_id，要么在
      // 未送达账本里"继续**没有第三种**。
      recordUndelivered({
        contextId: chatId,
        text,
        error: String(data.reason ?? data.error ?? observation.error ?? 'not_delivered'),
        source: 'chat_outbox',
      })
    }
    return 'undelivered'
  }

  /**
   * 长轮询间隙的一次消费。返回推进后的游标。
   *
   * **游标推进在结局落定之后** —— 一条消息要么拿到 message_id，要么已经进了未送达
   * 账本（于是 U1 把它回灌成她的经验），才算走完；游标这时才落盘。代价是进程若在
   * "发出去了"和"游标落盘"之间崩溃，下一次启动会重投这一条。这是 U0 的同款取舍：
   * **丢话之害 > 偶发重复之害** —— 一条重复消息 Kevin 一眼认得出并忽略，一条丢掉
   * 的话没有任何人能事后发现。
   *
   * §forbidden：这里只投递"从未出过站的"（游标之后的账本条目），**绝不碰未送达
   * 账本** —— 重说是她的认知决定，不是这条循环的机械行为。
   */
  #serialOutbox<T>(run: () => Promise<T>): Promise<T> {
    const result = this.#outboxLock.then(() => {
      if (this.#closed) throw new Error('outbound_closed')
      return run()
    })
    this.#outboxLock = result.catch(() => {})
    return result
  }

  async close(): Promise<void> {
    this.#closed = true
    await this.#outboxLock
  }

  /** 入队和消费共享一把锁；先持久化，再等待该条实际投递结果。 */
  deliverFollowup(content: string): Promise<OutboundReplyOutcome> {
    return this.#serialOutbox(async () => {
      if (!this.#deps.ownerChannelKey()) return 'undelivered'
      // 首启游标必须先定，再入队，不能把刚产生的跟进当历史跳过。
      this.#outboxCursor ??= initOutboxCursor(this.#deps.logEvent)
      const item = appendOutbox(content, 'followup', { logEvent: this.#deps.logEvent })
      let outcome: OutboundReplyOutcome = 'undelivered'
      while (this.#outboxCursor < item.id) {
        const before: number = this.#outboxCursor
        await this.#consumeOutbox((id, result) => { if (id === item.id) outcome = result })
        if (this.#outboxCursor === before) break
      }
      return outcome
    })
  }

  consumeOutboxOnce(): Promise<number> {
    return this.#serialOutbox(() => this.#consumeOutbox())
  }

  async #consumeOutbox(onDelivery?: (id: number, result: OutboundReplyOutcome) => void): Promise<number> {
    let cursor = this.#outboxCursor
    if (cursor === null) cursor = initOutboxCursor(this.#deps.logEvent)
    const page = readOutboxAfter(cursor, OUTBOX_BATCH_LIMIT, {
      ...(this.#deps.logEvent === undefined ? {} : { logEvent: this.#deps.logEvent }),
    })
    const messages = page.messages
    if (messages.length === 0) {
      this.#outboxCursor = cursor
      return cursor
    }
    const chatId = this.#deps.ownerChannelKey()
    const deliverable = outboxDeliverableKinds()
    for (const item of messages) {
      const itemId = Number(item.id ?? 0)
      const kind = item.kind
      if (!deliverable.includes(String(kind))) {
        // 跳过要留痕（`approval_request` 是旧 surface 遗物 —— 从这条路再投一遍
        // 就是同一个问题问两次）。**游标照推**：它已经被裁决过了。
        this.#log('chat_outbox_skipped', { id: itemId, kind, reason: 'kind_not_deliverable' })
        cursor = itemId
        saveOutboxCursor(cursor)
        continue
      }
      if (!chatId) {
        // 没有 owner 的 telegram 绑定就没有"往哪儿投"的答案。**游标不推进**：
        // 这些话还没出过站，绑定补上之后它们仍该被说出去。绑定只读、绝不在这里
        // 写（与入站的绑定闸同一条纪律）。
        this.#log('chat_outbox_no_owner_binding', {
          pending: messages.length, first_id: itemId,
        })
        this.#outboxCursor = cursor
        return cursor
      }
      const result = await this.deliverOutboxItem(item, chatId)
      onDelivery?.(itemId, result)
      cursor = itemId
      saveOutboxCursor(cursor)
    }
    this.#outboxCursor = cursor
    return cursor
  }
}

export function outboxNotificationSink(
  logEvent?: (n: string, f: Record<string, unknown>) => void,
): (content: string, kind: string) => void {
  return (content, kind) => {
    appendOutbox(content, kind, { ...(logEvent === undefined ? {} : { logEvent }) })
  }
}
