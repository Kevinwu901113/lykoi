/**
 * lykoi-adapter-telegram — 哑适配器（M1 波次 2 交付③）。
 *
 * 行为规格正本：治理仓库 WO-M0-SPEC-CONV §1 与 S-01..S-11（代码注释标条目号）。
 * 适配器保持零认知：只做传输 + 来源盖章（消息带 user_id/context_id/isOwner 出适配器），
 * 回复内容归 lykoi-converse-min（M1）/ lykoi-decide（M2），不归这里。
 *
 * 传输层是接口（TelegramTransport，poll/send），可替换：
 * - 生产实现（./production）本波只写骨架不接真网（无 token 即拒起）；
 * - 测试全部用内存 fake（./testing）驱动。
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

// ============================== 传输接口（可替换） ==============================

export interface TelegramMessage {
  messageId: number | string
  /** 缺失 → S-05 静默丢。 */
  chatId?: string
  /** 缺失 → S-05 静默丢。 */
  senderId?: string
  text?: string
  ts?: string
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
  /** SPEC §7.1 出站：reply_to 必带（适配器层强制，见 TelegramAdapterService.send）。 */
  send(chatId: string, text: string, replyTo: string): Promise<TelegramSendResult>
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
  /** 出站（应答路径）。reply_to 必带——本波无 outbox/主动出站（SPEC §7.1）。 */
  send(contextId: string, text: string, replyTo: string): Promise<TelegramSendResult>
  /** 手动驱动一轮长轮询（测试与外驱接口）；返回本轮处理的 update 数。 */
  pollOnce(): Promise<number>
  counters(): Readonly<TelegramAdapterCounters>
  cursor(): number
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
  reply_to: null
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
      reply_to: null,
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
    // S-08 路由顺序位：审批回答 → 规则建议回答 → 普通对话。本波无审批/建议
    // （M3 接入时在此处、事件派发之前按序消费），当前一律进入普通对话级。
    // parallel：等待全部消费者处理完，才回到 pollOnce 推进游标（S-03 时序）。
    await this.#ctx.parallel('lykoi/telegram/inbound', stamped)
  }

  async send(contextId: string, text: string, replyTo: string): Promise<TelegramSendResult> {
    // SPEC §7.1（本波 S 语义）：出站 reply_to 必带——无 outbox、无主动出站，
    // 一切出站都是应答（reply_to 非 None 即不计打扰预算的那条合法路径）。
    if (typeof replyTo !== 'string' || replyTo.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires replyTo (M1 wave-2 has no outbox; every outbound is a reply — SPEC §7.1)')
    }
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
      // TODO(M3): 未送达账本（telegram_undelivered 形状，SPEC §7.2）随出站游标波引入；
      // 本波只计数+落审计。
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

  if (config.autoStart) {
    // 长轮询常驻循环：错误指数退避 1→60s，成功即复位（telegram_device.py:543-551）。
    ctx.effect(() => {
      const abort = new AbortController()
      const loop = (async () => {
        let backoffS = INITIAL_BACKOFF_S
        while (!abort.signal.aborted) {
          try {
            await adapter.pollOnce()
            backoffS = INITIAL_BACKOFF_S
          } catch (err) {
            ctx.logger.warn('lykoi-adapter-telegram: poll failed, backing off %ds: %s',
              backoffS, String(err))
            await new Promise<void>((resolveSleep) => {
              const timer = setTimeout(resolveSleep, backoffS * 1000)
              abort.signal.addEventListener('abort', () => {
                clearTimeout(timer)
                resolveSleep()
              }, { once: true })
            })
            backoffS = Math.min(backoffS * 2, MAX_BACKOFF_S)
          }
        }
      })()
      loop.catch(() => {})
      return () => abort.abort()
    }, 'lykoi-adapter-telegram poll loop')
  }
}
