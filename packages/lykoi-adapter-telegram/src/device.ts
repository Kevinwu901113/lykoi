/**
 * 出站器官的设备侧（resources/telegram_device.py 逐字对拍；SK-77/78/79/82 +
 * D-07 本体）。
 *
 * 哲学钉：这一层**不做任何判断**。它是一只长期在听的耳朵与一张接在耳朵旁边的
 * 嘴。它自己唯一决定的是一个**安全**闸（发信人必须已经绑定），永远不是一个
 * **行为**闸。就一个受门管的动作去问 owner 同样不是它自己的判断：判断是内核的
 * 门做的，这一层只拥有认知**在结构上不可能有**的那一件事实 —— **这个问句必须
 * 引用哪一条消息**（`askAbout`）。
 *
 * 投递是**她自己的动作**，不是这个守护进程的：出站一律经 `kernel.dispatch` 的
 * `messenger.send`，于是它继承审批门 / 不可变审计 / 打扰预算，与她做的其它一切
 * 一样。
 *
 * **D-07 本体（本波的头等修正）**：活体的 `_deliver_outbox_item` **直接调
 * transport**，绕开 dispatch —— 零 audit、零 approval.check、零章，是审计闭合面上
 * 唯一的洞。新体把那条线**拉回 dispatch**，出站盖 **E3 章**（"已在上游收过预算
 * 的投递线"）：预算已经在上游收过（`proactive_chat` 账本 / followup 是他自己起的
 * 任务），免的是**再问一遍**，账**照记**。
 */
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

// --- WO-REWIRE-PROACTIVE ①：chat_outbox 的消费端 -----------------------------
// 她的主动嘴（`autonomy.initiate_chat` / `promise_followup`）的产出排进
// chat_outbox。那张表在 2026-08-09 具身转向之前的消费者是 CLI/Mac 客户端（各持
// cursor 轮询）；转向之后 Telegram 是她唯一的社交躯体，而设备进程从不读那张表
// —— 于是 8-2~8-4 的 3 条 kind=proactive 死在信箱里，reflow 还告诉她"Kevin 打开
// 对话就会看到"（结构性假回执）。
//
// 消费端只能在**这个**进程里：Bot API 的单进程单写者纪律不许两个进程同时抢
// （长轮询 offset 会互相吞更新）。所以**嘴接在耳朵旁边，在长轮询的间隙消费**，
// 不碰长轮询本身的节奏。
export function outboxCursorPath(): string {
  return process.env.LYKOI_TELEGRAM_OUTBOX_CURSOR ?? 'var/state/telegram_outbox.cursor'
}

/**
 * 只投递"她自己要说的话"。`approval_request` 是旧 surface 续跑的遗物 —— 审批
 * 问答自 WO-S3 起由审批对话机在这个 chat 里自己问自己答，从这条路再投一遍就是
 * **同一个问题问两次**。**跳过要留痕**（`chat_outbox_skipped`），静默丢弃才是
 * 下一个八月的冤案。
 */
export const OUTBOX_DELIVERABLE_KINDS: readonly string[] = ['proactive', 'followup']

/**
 * 现役可投递 kind 表 = 基表 +（GK-8 开着时）`notification`。开关默认关，开启
 * = Kevin 决断项 —— 构建侧不自作主张改到达行为。
 */
export function outboxDeliverableKinds(): readonly string[] {
  return notificationOutboxDelivery()
    ? [...OUTBOX_DELIVERABLE_KINDS, NOTIFICATION_OUTBOX_KIND]
    : OUTBOX_DELIVERABLE_KINDS
}

/** 每轮间隙至多投这么多，免得一次积压把长轮询晾太久。 */
export const OUTBOX_BATCH_LIMIT = 20

/**
 * 已消费到的 chat_outbox id；`null` = 还没有游标（首启）**或游标损坏**。
 *
 * 两种情况归一个返回值是**故意的**：损坏的游标按首启处理 = 从当前 max id 起
 * （`initOutboxCursor`）。与**入站游标"损坏当 0"的取舍刻意相反**（SK-79）——
 * 入站重放一批 update 至多让她多回一次刚刚的话；出站从 0 重放会把账本里几十条
 * 陈货（含过期死链）一次性灌给 Kevin。**宁跳过不重复灌陈货。**
 */
export function loadOutboxCursor(): number | null {
  const path = outboxCursorPath()
  if (!existsSync(path)) return null
  let data: unknown
  try {
    data = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const raw = (data as Record<string, unknown>).last_outbox_id
  if (raw === undefined || raw === null) return null
  const n = typeof raw === 'number' ? Math.trunc(raw) : Number.parseInt(String(raw), 10)
  return Number.isFinite(n) ? n : null
}

export function saveOutboxCursor(lastOutboxId: number): void {
  writeJsonAtomicSync(outboxCursorPath(), { last_outbox_id: Math.trunc(lastOutboxId) })
}

/**
 * 已持久化的游标；没有（首启/损坏）则 = **那一刻账本里的 max id**。
 *
 * 这条消费路是新接的，账本里躺着的是**历史广播日志**，不是待发队列：那些陈货
 * 从来不是"等着被投递"的，是当年 CLI/Mac 已经渲染过（或早已过期）的记录。首启
 * 把它们全发出去等于凭空给 Kevin 灌一遍几天前的死链。所以起点是"**从现在起**"。
 *
 * 重启后走的是**已持久化**那一支：上次跑到哪就从哪接着，期间攒下的话照说不误。
 */
export function initOutboxCursor(logEvent?: (n: string, f: Record<string, unknown>) => void): number {
  const persisted = loadOutboxCursor()
  if (persisted !== null) return persisted
  const cursor = outboxNewestId()
  saveOutboxCursor(cursor)
  logEvent?.('chat_outbox_cursor_initialized', { cursor })
  return cursor
}

// ============================================================================
// 出站器官
// ============================================================================

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
  }): Promise<{ outcome: string; executed: boolean }>
}

export interface SuggestionLeg {
  handleOwnerAnswer(answerText: string, opts: {
    contextId: string
    replyTo?: string | number | null
    messageId?: string | number | null
  }): Promise<{ outcome: string; suggestion_id: number | null }>
}

/** 认知侧交出的待批动作载荷（SK-77 四项：**不含 message_id / reply_to / context_id**）。 */
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

  constructor(deps: OutboundOrganDeps) {
    this.#deps = deps
  }

  #log(name: string, fields: Record<string, unknown> = {}): void {
    this.#deps.logEvent?.(name, fields)
  }

  cursor(): number | null { return this.#outboxCursor }

  // --- SK-78：E2 盖章唯一点 = _send_reply -----------------------------------

  /**
   * 她的回复，作为她自己的动作发出（SK-78 三分支结局）。
   *
   * WO-U3 ② / P1 E2（在场应答）：这是对 user-authenticated 来话的**直接文本应答**，
   * 收件人恒等于来话对端 —— `contextId` 就是刚刚那条入站消息的 chat id，由设备层
   * 从长轮询结果里取出，**认知侧碰不到它**。所以这里是**唯一有资格盖 E2 章的
   * 地方**：只有在这一层，"对端是谁"才是一个结构事实而不是一个模型说法。
   *
   * 边界（附文 §2 E2）：主动发起不走这条路 —— 它走 chat_outbox 的投递线，那条路上
   * 没有 E2（是 E3）；工具动作各自 dispatch、各自分级，**不因这一章而降级**。
   *
   * 三分支结局：①送达（有 message_id）②未送达补记 ③needs_approval →
   * requestApproval（**排队等批 ≠ 未送达**：它还有下文，结局由审批那条腿交代）
   * ④dispatch 失败补记。
   */
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
      // WO-U0 ③：把"chat_reply 事件 ≠ 送达"那笔糊涂账修平。surface 的 chat_reply
      // 只说明她**生成**了这句话；这条消息真正到没到他手上，从此由这里的两个结局
      // 之一交代 —— 有 message_id 就是送达，否则落②的未送达表。
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
      // WO-S3 问的一腿：S1B 记一条日志就停了 —— 她自己的回复因为没人问过而无声
      // 死去。现在那个观察变成同一个 chat 里的一句问句，回复排队等他回答。
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

  // --- SK-77：审批问句在设备层发 ---------------------------------------------

  /**
   * 把认知侧交出来的待批动作问成一条**带 reply_to 的**问句。
   *
   * 镜像 `sendReply` 里那条早就存在的调用（她自己的回复需要审批时）：同一个
   * `requestApproval`、同一个 origin、同一个"以当轮入站 id 为 reply_to"。区别只在
   * 于被问的是一个工具动作而不是那条回复。
   *
   * **为什么问句在这一层**：`reply_to` 不是礼貌，是**打扰纪律的分界** —— 没有它
   * 的 `messenger.send` 按主动打扰计费（cap 1/UTC 日），名额一耗尽当天余下的问句
   * 全部 undelivered → deny_by_default（8-19 01:40 的 6 连拒）。而当轮入站
   * message_id **只有这一层有**：认知侧的请求体里从来没有它，也不该有（P1 E2
   * 分层 ——"对端是谁"只在这一层是结构事实）。所以认知侧交出的只有动作载荷，
   * **id 一个字节不进去**。
   *
   * 排队仍然只在 `requestApproval` 里发生，仍然是"先发后排"：本函数**不自己写
   * 队列，也不重试** —— 问不出去 = 那件事不做（deny-by-default），由那一侧交代结局。
   */
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

  // --- SK-82：S-08 三级路由的消费位 -------------------------------------------

  /**
   * owner 来话的前两级路由：审批答复 → 建议答复 → （返回 null 让调用方进普通
   * `/chat`）。
   *
   * **仅 `isOwner`**（严格窄于 `isBound`）：绑定了但不是 owner 的发信人是一个完全
   * 合法的通信对象，他写的任何东西都**不许**被读作一次审批（WO-S3 判据 5）。
   * owner 的一条什么也没答的消息回来是 `ignored`，落到同一条普通对话路径上，所以
   * **普通对话不受影响**。
   *
   * 返回非 null = 这条消息**已被消费**（前两级里有一级 outcome !== 'ignored'），
   * 并标明消费的是审批答复还是建议答复；调用方就此 return，不再当成一次普通对话。
   */
  async routeOwnerMessage(opts: {
    text: string
    contextId: string
    replyTo: string | number | null
    messageId: string | number | null
  }): Promise<'approval_answer' | 'suggestion_answer' | null> {
    const approval = this.#deps.approval
    if (approval !== undefined && approval !== null) {
      const routed = await approval.handleOwnerAnswer(opts.text, {
        contextId: opts.contextId, replyTo: opts.replyTo, messageId: opts.messageId,
      })
      if (routed.outcome !== 'ignored') {
        this.#log('telegram_approval_turn', {
          outcome: routed.outcome, executed: routed.executed,
        })
        return 'approval_answer' // 这条消息**就是**那次审批回合 —— 不再同时当成一次对话提示
      }
    }
    // WO-L5 答的一腿（规则建议队列）。同一形状，第二个队列：**只有 owner、只有
    // 在审批队列放行之后、且只在显式 reply-to 上**（建议问答机拒绝为任何触碰她
    // 自己权限边界的事去猜归属）。答了个空的回来是 ignored —— 零 DB 写、零 LLM
    // 调用 —— 落到下面那条普通 /chat 路径上，所以正常对话毫发无损。
    const suggestion = this.#deps.suggestion
    if (suggestion !== undefined && suggestion !== null) {
      const suggested = await suggestion.handleOwnerAnswer(opts.text, {
        contextId: opts.contextId, replyTo: opts.replyTo, messageId: opts.messageId,
      })
      if (suggested.outcome !== 'ignored') {
        this.#log('telegram_rule_suggestion_turn', {
          outcome: suggested.outcome, suggestion_id: suggested.suggestion_id,
        })
        return 'suggestion_answer' // 这条消息是那条建议的答复 —— 不再当成一次普通对话
      }
    }
    return null
  }

  // --- SK-79 / D-07：出站投递线 ------------------------------------------------

  /**
   * 把一条主动发言发出去 —— **经 dispatch，盖 E3 章**（D-07 本体）。
   *
   * 活体在这里直调 transport，两个理由：①打扰预算已经在上游收过一次
   * （`autonomy.initiate_chat` 过 proactive_chat 账本；followup 结果是他自己起的
   * 那个任务的下文），再过一次 messenger 的 proactive 频控是同一件事收两遍税；
   * ②`messenger.send` 的默认策略是 ask —— 那会为一条本就说给 Kevin 的话去问
   * Kevin 批不批。
   *
   * **两个理由都成立，绕开 dispatch 的做法不成立**：它同时丢掉了 audit。E3 章
   * 恰好只免掉"问"这一件事（check 第⑨步），**账照记** —— 于是 audit 闭合面上
   * 那个洞被补上，而上面两条理由一条不失。
   *
   * U0/U1 的机制全部照常继承，因为它们都在 transport 那一层以下：重试、未送达
   * 账本、以及 U1 把未送达落成她的经验。
   *
   * ⚠️ **已知副作用，刻意不在这里"顺手修好"**（TODO 已呈治理）：拉回 dispatch
   * 之后这条线会**再过一次** messenger 的 proactive 账本（`reply_to=null` →
   * `_reserveProactiveSlot`，SK-80 逐字），也就是活体直调 transport 时不收的那道
   * 税。**E3 不是预算旁路** —— SK-47 钉死"豁免免掉的是问，从来不是账"，拿它去
   * 跳账本就是把一个审计概念改写成一个额度概念。要不要给投递线单开一条免账通路
   * （专用动作名 / 按 exemption 类别扩 handler 契约 / 维持现状）是治理判断，不是
   * 构建判断。现状 = **收紧**（宁可她少说一条，也不凭空给自己开额度）。
   */
  async deliverOutboxItem(item: OutboxItem, chatId: string): Promise<void> {
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
      return
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
  async consumeOutboxOnce(): Promise<number> {
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
      await this.deliverOutboxItem(item, chatId)
      cursor = itemId
      saveOutboxCursor(cursor)
    }
    this.#outboxCursor = cursor
    return cursor
  }
}

/** GK-8 开启后通知并入投递线的落笔面（kernel 侧 `setNotificationOutboxSink` 递它）。 */
export function outboxNotificationSink(
  logEvent?: (n: string, f: Record<string, unknown>) => void,
): (content: string, kind: string) => void {
  return (content, kind) => {
    appendOutbox(content, kind, { ...(logEvent === undefined ? {} : { logEvent }) })
  }
}
