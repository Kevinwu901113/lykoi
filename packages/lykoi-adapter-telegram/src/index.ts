/**
 * lykoi-adapter-telegram — 哑适配器（M1 波次 2 交付③）。
 *
 * 行为规格正本：治理仓库 WO-M0-SPEC-CONV §1 与 S-01..S-11（代码注释标条目号）。
 * 适配器保持零认知：只做传输 + 来源盖章（消息带 user_id/context_id/isOwner 出适配器），
 * 回复内容归 lykoi-converse-min（M1）/ lykoi-decide（M2），不归这里。
 *
 * 传输层是接口（TelegramTransport，poll/send），可替换：
 * - 生产实现（./production）M4 前置 #8 起接真 HTTP：它桥到 `BotApiTransport`，
 *   HTTP 那一跳是 `./http` 的真 fetch —— **整棵树里唯一**指向真网的实现，且
 *   只在那一个装配面被选中（无 token 即拒起）；
 * - 测试全部用内存 fake（./testing）或注入的 `HttpPost` 驱动。
 *
 * 本波不做（工单明示）：出站游标语义（无 outbox）→ 一切出站都是应答，
 * send 的 reply_to 必带（SPEC §7.1：reply_to 非 None 即不计打扰预算的应答路径）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { AuditService } from 'lykoi-audit'
import type { LykoiMemoryService } from 'lykoi-memory'
import { readFileSync } from 'node:fs'
import { mkdir, open, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { DelegatedAsk, OutboundOrgan } from './device.ts'
import { setTransport as setMessengerTransport, type MessengerTransport } from './messenger.ts'
import { TelegramPollError } from './transport.ts'

export * from './device.ts'
export * from './messenger.ts'
export * from './outbox.ts'
export * from './resources.ts'
export * from './transport.ts'

// ============================== 传输接口（可替换） ==============================

export interface TelegramMessage {
  messageId: number | string
  /** 缺失 → S-05 静默丢。 */
  chatId?: string
  /** 缺失 → S-05 静默丢。 */
  senderId?: string
  text?: string
  ts?: string
  /**
   * WO-S3 / M3-W3：他回的是**哪一条**（`reply_to_message.message_id` 的归一化
   * 形态）。归属消歧的唯一锚 —— 审批答复与建议答复都只认它。可选键：不引用任何
   * 东西的消息保持它一直以来的形状。
   */
  replyToMessageId?: string
}

export interface TelegramUpdate {
  updateId: number
  message?: TelegramMessage
  /** D-06（修正版）：编辑消息 ≠ 新回合——忽略并落审计行。 */
  editedMessage?: TelegramMessage
}

export interface TelegramSendResult {
  messageId: string | null
  sent: boolean
  error?: string
}

export interface TelegramTransport {
  /** S-01：长轮询。offset = cursor+1 本身即平台侧 ack（双重去重第一道，S-02）。 */
  poll(offset: number, options: { timeoutS: number }): Promise<TelegramUpdate[]>
  /**
   * 出站。`replyTo` 为 null = 主动出站（M3-W3 起真的存在：chat_outbox 投递线与
   * 审批/建议问句都走 `reply_to=null`，照常吃 messenger 的主动打扰预算）。
   */
  send(chatId: string, text: string, replyTo: string | null): Promise<TelegramSendResult>
}

// ============================== 盖章后的入站消息 ==============================

/** 来源盖章：消息离开适配器时必带 user_id / context_id（工单③）。 */
export interface InboundMessage {
  userId: string
  contextId: string
  /** S-09：严格窄于 bound——owner_primary 的 telegram 绑定；任一未知即 false。 */
  isOwner: boolean
  text: string
  /** 入站 message_id：出站应答 reply_to 的锚（SPEC §1.2：只存在于设备层）。 */
  messageId: string
  updateId: number
  ts?: string
}

export interface TelegramAdapterCounters {
  polls: number
  inbound: number
  /** S-06：未绑定丢弃累计（进程级计数，可观测）。 */
  droppedUnbound: number
  /** S-05：sender/chat 缺失静默丢（无事件；仅进程内计数可观测）。 */
  droppedMalformed: number
  /** S-02：进程侧去重命中。 */
  duplicates: number
  /** D-06：edited_message 忽略数。 */
  editedIgnored: number
  sent: number
  sendFailed: number
}

export interface TelegramAdapterService {
  /**
   * 裸出站（M1 的应答路径，reply_to 必带）—— **M3-W3 起它不再是回复的正路**：
   * 她的回复走 `sendReply`（经 dispatch，E2 盖章，SK-78 三分支结局）。本方法保留
   * 给不属于"她的一次动作"的传输面用途与既有测试。
   */
  send(contextId: string, text: string, replyTo: string): Promise<TelegramSendResult>
  /** 手动驱动一轮长轮询（测试与外驱接口）；返回本轮处理的 update 数。 */
  pollOnce(): Promise<number>
  counters(): Readonly<TelegramAdapterCounters>
  cursor(): number

  // --- M3-W3 出站器官（设备侧承重面） ---
  /**
   * 把出站器官接上（converse 的 apply 在装配好 kernel dispatch / 审批机 / 建议机
   * 之后递进来）。**晚绑定**是刻意的：设备层与认知层互为对方的下游，活体用
   * `messenger._TRANSPORT = transport` 的同一手法在启动时打通。
   */
  wireOutbound(organ: OutboundOrgan): void
  /** SK-78：她的回复 —— 经 dispatch、盖 E2 章、三分支结局。未接线即抛。 */
  sendReply(contextId: string, text: string, replyTo: string | null): Promise<void>
  /** SK-77：本轮撞门的动作在设备层问（reply_to=当轮入站 message_id）。未接线即抛。 */
  askAbout(action: DelegatedAsk, contextId: string, replyTo: string | null): Promise<void>
  /** SK-79：长轮询间隙消费一次出站队列（未接线 = no-op）。 */
  consumeOutboxOnce(): Promise<void>
  /** 出站器官是否已接线（converse 的 `device_side_wired` 账面取值源）。 */
  outboundWired(): boolean
  /**
   * messenger 的 transport 真身（`messenger._TRANSPORT = transport` 对应物）。
   * `replyTo` 可为 null —— 主动出站走这里，裸 `send` 是它的 reply-only 门面。
   */
  transportSend(contextId: string, text: string, replyTo: string | null): Promise<TelegramSendResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    telegram: TelegramAdapterService
    telegramTransport: TelegramTransport
  }
  interface Events {
    /** 盖章后的入站消息（parallel 派发：处理完才推进游标，S-03 的时序前提）。 */
    'lykoi/telegram/inbound'(message: InboundMessage): Promise<void> | void
  }
}

// ============================== 存档与游标的文件形状 ==============================

/** 入站存档条目：字段名保真 messenger_inbound 形状（SPEC §1.1 T3 / messenger.py:258-266）。 */
interface ArchiveItem {
  kind: 'messenger_inbound'
  ts: string
  context_id: string
  sender_id: string
  text: string
  /** M3-W3：入站引用（messenger.ingest_inbound 的 `reply_to` 字段，逐字同名）。 */
  reply_to: string | null
  source_ref_id: string
  id: number
}

interface ArchiveFile {
  next_id: number
  items: ArchiveItem[]
}

/** S-07：环形保留 200（messenger.py:227 _INBOUND_MAX_KEEP）。 */
const INBOUND_MAX_KEEP = 200
/** 长轮询错误退避（telegram_device.py:87-88）。 */
const INITIAL_BACKOFF_S = 1.0
const MAX_BACKOFF_S = 60.0

/** `runPollLoop` 要的那一点点 logger 面（`ctx.logger` 结构上就是它的超集）。 */
export interface PollLoopLogger {
  warn(format: string, ...param: unknown[]): void
}

/** R-12 手法的原子写：同目录临时文件 → fsync → rename。 */
async function writeJsonAtomic(path: string, value: unknown, seq: number): Promise<void> {
  const dir = dirname(path)
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.tmp-${process.pid}-${seq}-${Date.now()}.json`)
  const handle = await open(tmp, 'w')
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + '\n', 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await rename(tmp, path)
}

// ============================== 适配器实现 ==============================

export class TelegramAdapter implements TelegramAdapterService {
  #ctx: Context
  #transport: TelegramTransport
  #audit: AuditService
  #memory: LykoiMemoryService
  #cursorPath: string
  #archivePath: string
  #pollTimeoutS: number
  #cursor: number
  #archive: ArchiveFile
  #counters: TelegramAdapterCounters = {
    polls: 0,
    inbound: 0,
    droppedUnbound: 0,
    droppedMalformed: 0,
    duplicates: 0,
    editedIgnored: 0,
    sent: 0,
    sendFailed: 0,
  }
  #persistTail: Promise<unknown> = Promise.resolve()
  #seq = 0
  /** M3-W3：出站器官（晚绑定，见 wireOutbound）。 */
  #outbound: OutboundOrgan | null = null

  constructor(ctx: Context, options: {
    transport: TelegramTransport
    audit: AuditService
    memory: LykoiMemoryService
    cursorPath: string
    archivePath: string
    pollTimeoutS: number
  }) {
    this.#ctx = ctx
    this.#transport = options.transport
    this.#audit = options.audit
    this.#memory = options.memory
    this.#cursorPath = resolve(options.cursorPath)
    this.#archivePath = resolve(options.archivePath)
    this.#pollTimeoutS = options.pollTimeoutS
    this.#cursor = loadCursor(this.#cursorPath)
    this.#archive = loadArchive(this.#archivePath)
  }

  counters(): Readonly<TelegramAdapterCounters> {
    return { ...this.#counters }
  }

  cursor(): number {
    return this.#cursor
  }

  // --- M3-W3 出站器官面 ------------------------------------------------------

  wireOutbound(organ: OutboundOrgan): void {
    this.#outbound = organ
  }

  outboundWired(): boolean {
    return this.#outbound !== null
  }

  #requireOutbound(): OutboundOrgan {
    if (this.#outbound === null) {
      throw new Error(
        'lykoi-adapter-telegram: outbound organ is not wired (call wireOutbound first)',
      )
    }
    return this.#outbound
  }

  /** SK-78：她的回复经 dispatch 出去，E2 章在出站器官里盖。 */
  async sendReply(contextId: string, text: string, replyTo: string | null): Promise<void> {
    await this.#requireOutbound().sendReply({ contextId, text, replyTo })
  }

  /** SK-77：认知侧交出的待批动作，在**这一层**问成一条带 reply_to 的问句。 */
  async askAbout(action: DelegatedAsk, contextId: string, replyTo: string | null): Promise<void> {
    await this.#requireOutbound().askAbout(action, { contextId, replyTo })
  }

  /**
   * SK-79：长轮询间隙的一次出站消费。**自成一个 try** —— 出站这边出任何事
   * （账本损坏 / 游标文件不可写）都不许改长轮询的节奏，既不触发它的退避，也不
   * 让它少转一圈（§forbidden：嘴哑了不许把耳朵也带聋）。
   */
  async consumeOutboxOnce(): Promise<void> {
    if (this.#outbound === null) return
    try {
      await this.#outbound.consumeOutboxOnce()
    } catch (err) {
      await this.#audit.record({
        type: 'chat_outbox_consume_error',
        error_type: err instanceof Error ? err.name : 'Error',
      })
    }
  }

  /**
   * 一轮长轮询。S-01：offset=cursor+1（平台侧 ack）；S-02：进程侧
   * `update_id <= cursor → continue` 第二道去重；S-03：每条 update
   * **处理完毕之后**才推进并落盘游标（不是批量末尾）。处理中抛错 →
   * 该条不推进游标（重放方向：丢话之害 > 偶发重复之害，SPEC §1.2 崩溃语义）。
   */
  async pollOnce(): Promise<number> {
    this.#counters.polls += 1
    const updates = await this.#transport.poll(this.#cursor + 1, { timeoutS: this.#pollTimeoutS })
    let processed = 0
    for (const update of updates) {
      // S-02 第二道：进程侧去重（update_id 缺失/非法与重复同路：跳过不推进）。
      if (!Number.isInteger(update.updateId)) continue
      if (update.updateId <= this.#cursor) {
        this.#counters.duplicates += 1
        continue
      }
      await this.#handleUpdate(update)
      // S-03：逐条推进 + 落盘（处理完才推进）。
      this.#cursor = update.updateId
      await this.#persistCursor()
      processed += 1
    }
    return processed
  }

  async #handleUpdate(update: TelegramUpdate): Promise<void> {
    // D-06（修正版语义，工单明示）：edited_message 不是新回合——忽略并落审计行。
    // （活体现状是当新 message 处理，S-11；D-06 修正在本移植体生效。）
    if (update.editedMessage !== undefined && update.message === undefined) {
      this.#counters.editedIgnored += 1
      await this.#audit.record({
        type: 'telegram/edited_message_ignored',
        updateId: update.updateId,
      })
      return
    }
    const message = update.message
    // 非 message update（channel post / callback query 等）：不处理，游标照推（SPEC §1.2）。
    if (message === undefined) return

    // S-05：sender_id / chat_id 任一缺失 → 静默丢弃，无事件（仅进程内计数可观测）。
    const senderId = message.senderId
    const chatId = message.chatId
    if (typeof senderId !== 'string' || senderId.length === 0
      || typeof chatId !== 'string' || chatId.length === 0) {
      this.#counters.droppedMalformed += 1
      return
    }

    // S-06：未绑定发送者 → 丢弃 + 计数 + 落事件；绑定表只读（查询走 lykoi-memory，
    // 本适配器绝不写绑定——lykoi-memory 本身就没有写面，R-01）。
    const binding = this.#memory.identityBinding('telegram', senderId)
    if (binding === undefined) {
      this.#counters.droppedUnbound += 1
      await this.#audit.record({
        type: 'telegram/inbound_dropped_unbound',
        updateId: update.updateId,
        channel: 'telegram',
        // TODO(M3): senderId 是平台侧游离 id 非正文；audit 行是否收敛为哈希由治理定敏感度。
        senderId,
        droppedTotal: this.#counters.droppedUnbound,
      })
      return
    }

    // S-07：入站存档在 _is_bound 之后、任何路由之前；无去重；环形 200；
    // 畸形输入降级为空字段而非抛出。
    const ts = typeof message.ts === 'string' && message.ts.length > 0
      ? message.ts
      : new Date().toISOString()
    const text = typeof message.text === 'string' ? message.text : ''
    await this.#archiveInbound({
      kind: 'messenger_inbound',
      ts,
      context_id: chatId,
      sender_id: senderId,
      text,
      reply_to: message.replyToMessageId ?? null,
      source_ref_id: String(message.messageId),
      id: 0, // 由 #archiveInbound 分配
    })

    // S-09：owner 判定严格窄于绑定——必须是 owner_primary 的 telegram 绑定；
    // 任一侧未知即 false，永不默认 yes。
    const isOwner = binding.role === 'owner_primary'

    const stamped: InboundMessage = {
      userId: binding.userId,
      contextId: chatId,
      isOwner,
      text,
      messageId: String(message.messageId),
      updateId: update.updateId,
      ...(message.ts === undefined ? {} : { ts: message.ts }),
    }
    this.#counters.inbound += 1
    // 隐私：audit 行只带字数不带正文（SPEC §7.2 record_undelivered 的事件口径）。
    await this.#audit.record({
      type: 'telegram/inbound',
      updateId: update.updateId,
      contextId: chatId,
      userId: binding.userId,
      isOwner,
      chars: text.length,
    })
    // S-08 三级路由的**消费位**（SK-82，M3-W3 接真）：审批回答 → 规则建议回答 →
    // 普通对话。前两级**仅 `isOwner`**（严格窄于 `isBound`）：绑定了但不是 owner
    // 的发信人是完全合法的通信对象，他写的任何东西都不许被读作一次审批（判据 5）。
    // 前两级里任一 outcome !== 'ignored' 即**消费并 return** —— 这条消息就是那次
    // 回合，不再同时当成一次对话提示；两级都 ignored 则原样落到普通对话级
    // （零 DB 写、零 LLM 调用），所以正常对话毫发无损。
    if (isOwner && this.#outbound !== null) {
      const consumed = await this.#outbound.routeOwnerMessage({
        text,
        contextId: chatId,
        replyTo: message.replyToMessageId ?? null,
        messageId: String(message.messageId),
      })
      if (consumed) return
    }
    // parallel：等待全部消费者处理完，才回到 pollOnce 推进游标（S-03 时序）。
    await this.#ctx.parallel('lykoi/telegram/inbound', stamped)
  }

  async send(contextId: string, text: string, replyTo: string): Promise<TelegramSendResult> {
    // M1 §7.1 的 S 语义（保留）：这条**裸**出站面 reply_to 必带。M3-W3 起主动
    // 出站真的存在了（chat_outbox 投递线），它走的是 `transportSend`，不是这里。
    if (typeof replyTo !== 'string' || replyTo.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires replyTo (this is the reply-only surface; proactive outbound goes through the outbound organ — SPEC §7.1)')
    }
    return await this.transportSend(contextId, text, replyTo)
  }

  /**
   * M3-W3：**messenger 的 transport 真身**（活体 `messenger._TRANSPORT = transport`
   * 那一行的对应物）。她的每一条出站 —— 回复 / 审批问句 / 建议问句 / 投递线 ——
   * 最终都落到这里，因为 `messenger.send` 动作的 transport 在启动时被换成了它
   * （**单写者 = 设备层**：Bot API 的单进程单写者纪律不许两个写者同时抢）。
   *
   * `replyTo` 在这一层可以是 null（主动出站），这正是它与上面那条裸面的区别。
   */
  async transportSend(
    contextId: string, text: string, replyTo: string | null,
  ): Promise<TelegramSendResult> {
    // messenger.send 同源校验：text/context_id 空 → 错（messenger.py:197-201）。
    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires non-empty text')
    }
    if (typeof contextId !== 'string' || contextId.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires non-empty contextId')
    }
    const result = await this.#transport.send(contextId, text, replyTo)
    if (result.sent && result.messageId !== null) {
      this.#counters.sent += 1
      await this.#audit.record({
        type: 'telegram/sent',
        contextId,
        replyTo,
        chars: text.length,
        messageId: result.messageId,
      })
    } else {
      // M3-W3：未送达账本已就位（`transport.recordUndelivered` 是**唯一**产生入口）。
      // 这一层只计数+落审计 —— 记账由 `messenger.send` 的调用方按结局补
      // （SK-78/SK-79 的"两种结局，没有第三种"）。
      this.#counters.sendFailed += 1
      await this.#audit.record({
        type: 'telegram/send_failed',
        contextId,
        replyTo,
        chars: text.length,
        ...(result.error === undefined ? {} : { error: result.error }),
      })
    }
    return result
  }

  /** S-07 存档：环形 200；next_id 持久单调（C-28：max(next_id, max_item_id+1, 1)）。 */
  async #archiveInbound(item: ArchiveItem): Promise<void> {
    const id = Math.max(
      this.#archive.next_id,
      this.#archive.items.reduce((m, it) => Math.max(m, it.id), 0) + 1,
      1,
    )
    this.#archive.next_id = id + 1
    this.#archive.items.push({ ...item, id })
    if (this.#archive.items.length > INBOUND_MAX_KEEP) {
      this.#archive.items = this.#archive.items.slice(-INBOUND_MAX_KEEP)
    }
    await this.#persist(() => writeJsonAtomic(this.#archivePath, this.#archive, this.#seq++))
  }

  #persistCursor(): Promise<void> {
    // 游标持久化：键名保真 last_update_id（telegram_device.py:113）。
    return this.#persist(() =>
      writeJsonAtomic(this.#cursorPath, { last_update_id: this.#cursor }, this.#seq++))
  }

  #persist(job: () => Promise<void>): Promise<void> {
    const prev = this.#persistTail
    const run = (async () => {
      await prev.catch(() => {})
      await job()
    })()
    this.#persistTail = run.catch(() => {})
    return run
  }
}

/** S-04：游标损坏/缺失 → 0（重放方向；与出站游标刻意相反——本波无出站游标）。 */
function loadCursor(path: string): number {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return 0
  }
  try {
    const parsed = JSON.parse(raw) as { last_update_id?: unknown }
    const value = parsed?.last_update_id
    return Number.isInteger(value) && (value as number) >= 0 ? (value as number) : 0
  } catch {
    return 0
  }
}

/** 存档损坏 → 当空（§4 messenger_inbound 损坏语义）。 */
function loadArchive(path: string): ArchiveFile {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return { next_id: 1, items: [] }
  }
  try {
    const parsed = JSON.parse(raw) as ArchiveFile
    if (parsed === null || typeof parsed !== 'object' || !Array.isArray(parsed.items)
      || !Number.isInteger(parsed.next_id)) {
      return { next_id: 1, items: [] }
    }
    return parsed
  } catch {
    return { next_id: 1, items: [] }
  }
}

// ============================== cordis 插件面 ==============================

export const name = 'lykoi-adapter-telegram'
// 依赖显式化：audit（治理地基①）、lykoiMemory（绑定查询②d）、telegramTransport（传输 seam）。
export const inject = ['audit', 'lykoiMemory', 'telegramTransport']

export interface Config {
  cursorPath: string
  archivePath: string
  /** S-01：长轮询 timeout=25s（telegram_device.py:86）。 */
  pollTimeoutS: number
  /** 常驻轮询循环开关；测试用 pollOnce 手动驱动时置 false。 */
  autoStart: boolean
}

export const Config: Schema<Config> = Schema.object({
  cursorPath: Schema.string().default('var/telegram-cursor.json'),
  archivePath: Schema.string().default('var/telegram-inbound.json'),
  pollTimeoutS: Schema.number().default(25),
  autoStart: Schema.boolean().default(true),
})

/**
 * 长轮询常驻循环的循环体（WO-FIX-POLLBACKOFF-01 D-4）。
 *
 * 抽成函数**只为一件事**：`sleep` 可注入，于是退避序列 1→2→4→…→60、成功即复位
 * 这条节奏第一次能被红测钉住（从前它长在 `ctx.effect` 的闭包里，测试只能等真
 * 时钟）。除此之外一个参数都不加 —— 参数越多越像一个新的配置面，而本单明确不
 * 引入新的退避参数。
 *
 * 退避语义原样：`INITIAL_BACKOFF_S`=1 起，每次失败 `min(×2, 60)`，一次成功复位
 * （telegram_device.py:543-551）。
 */
export function runPollLoop(
  adapter: Pick<TelegramAdapterService, 'pollOnce' | 'consumeOutboxOnce'>,
  deps: {
    signal: AbortSignal
    /** 退避睡眠 seam（生产是定时器 + abort 提前唤醒；测试注记录器）。 */
    sleep: (seconds: number) => Promise<void>
    audit: AuditService
    logger: PollLoopLogger
  },
): Promise<void> {
  return (async () => {
    let backoffS = INITIAL_BACKOFF_S
    while (!deps.signal.aborted) {
      try {
        await adapter.pollOnce()
        backoffS = INITIAL_BACKOFF_S
        // SK-79：**嘴接在耳朵旁边** —— 长轮询的**间隙**消费出站队列，不碰
        // 长轮询本身的节奏。`consumeOutboxOnce` 自带 try（出站出任何事都不
        // 触发这里的退避，也不让长轮询少转一圈）。
        await adapter.consumeOutboxOnce()
      } catch (err) {
        deps.logger.warn('lykoi-adapter-telegram: poll failed, backing off %ds: %s',
          backoffS, String(err))
        // WO-FIX-POLLBACKOFF-01 D-2：退避这件事本身要在账面上留痕（在它之前
        // 长轮询失败只有 transport 侧的 `telegram_transport_api_error` 连发，
        // 看不出有没有退避、退了多久）。**自成一个 try**：审计写不进去也不许
        // 影响退避本身（口径同 consumeOutboxOnce）。
        try {
          await deps.audit.record({
            type: 'telegram/poll_backoff',
            // 消费者抛的 AggregateError 等一律归 unexpected（不是 getUpdates 失败）。
            category: err instanceof TelegramPollError ? err.category : 'unexpected',
            ...(err instanceof TelegramPollError && err.status !== undefined
              ? { status: err.status }
              : {}),
            backoff_s: backoffS,
          })
        } catch { /* 审计失败不改退避节奏 */ }
        await deps.sleep(backoffS)
        backoffS = Math.min(backoffS * 2, MAX_BACKOFF_S)
      }
    }
  })()
}

export function apply(ctx: Context, config: Config) {
  const adapter = new TelegramAdapter(ctx, {
    transport: ctx.telegramTransport,
    audit: ctx.audit,
    memory: ctx.lykoiMemory,
    cursorPath: config.cursorPath,
    archivePath: config.archivePath,
    pollTimeoutS: config.pollTimeoutS,
  })
  ctx.provide('telegram', adapter)
  // M3-W3：**这个进程的 `messenger.send` 从此真的说得出话**（活体
  // `messenger._TRANSPORT = transport` 那一行的对应物，telegram_device.py:529）。
  // 于是她的每一条出站 —— 回复 / 审批问句 / 建议问句 / 投递线 —— 都继承同一套
  // 审批门 / 不可变审计 / 打扰预算，因为它们全都是 `messenger.send` 动作。
  // **单写者纪律**：只有设备层做这次替换（Bot API 不许两个写者同时抢）。
  setMessengerTransport(messengerTransportBridge(adapter))
  ctx.effect(() => () => setMessengerTransport(null), 'lykoi-adapter-telegram messenger transport')

  if (config.autoStart) {
    // 长轮询常驻循环：错误指数退避 1→60s，成功即复位（telegram_device.py:543-551）。
    ctx.effect(() => {
      const abort = new AbortController()
      const loop = runPollLoop(adapter, {
        signal: abort.signal,
        // 真 sleep：定时器 + abort 提前唤醒（卸载时不许再等满一个 60s）。
        sleep: (seconds) => new Promise<void>((resolveSleep) => {
          const timer = setTimeout(resolveSleep, seconds * 1000)
          abort.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            resolveSleep()
          }, { once: true })
        }),
        audit: ctx.audit,
        logger: ctx.logger,
      })
      loop.catch(() => {})
      return () => abort.abort()
    }, 'lykoi-adapter-telegram poll loop')
  }
}

/**
 * `MessengerTransport`（资源层的窄协议）↔ 设备层的适配器桥。
 *
 * 活体是同一个对象两副面孔（`TelegramTransport` 同时实现 `send_message` /
 * `fetch_updates` / `poll_updates`）；新体的入站 seam（poll/send）在 M1 就定了形，
 * 所以这里用一层薄桥把两副面孔对上，而不是把 M1 的 seam 改形状。
 *
 * `fetchUpdates`（`messenger.read` 的后端）：M1 的 seam 上没有这个方法。返回空
 * 记录 + `unsupported` 标记 —— **如实说没有**，不假装读到了零条。真身随
 * `BotApiTransport`（本包 transport.ts，已实现 `fetchUpdates`）在生产接线时替入。
 */
export function messengerTransportBridge(adapter: TelegramAdapterService): MessengerTransport {
  return {
    async sendMessage(opts) {
      const result = await adapter.transportSend(opts.contextId, opts.text, opts.replyTo ?? null)
      return {
        message_id: result.messageId,
        context_id: opts.contextId,
        sent: result.sent,
        ...(result.error === undefined ? {} : { error: result.error }),
      }
    },
    async fetchUpdates() {
      return { messages: [], count: 0, error: 'unsupported_on_device_seam' }
    },
  }
}
