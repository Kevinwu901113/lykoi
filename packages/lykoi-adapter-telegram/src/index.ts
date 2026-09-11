import type { OwnerInteraction } from 'lykoi-contracts'
import { outboundCapabilities } from './resources.ts'

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { AuditService } from 'lykoi-audit'
import type { IngressService, InboundPart } from 'lykoi-ingress'
import { markActive } from 'lykoi-kernel'
import type { LykoiMemoryService } from 'lykoi-memory'
import { readFileSync } from 'node:fs'
import { mkdir, open, rename } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type {
  AskAboutResult,
  DelegatedAsk,
  OutboundOrgan,
  OutboundReplyResult,
  OutboundReplyOutcome,
  OutboundTurnContext,
} from './device.ts'
import { setTransport as setMessengerTransport, type MessengerTransport } from './messenger.ts'
import { TelegramPollError, type TelegramSendOptions } from './transport.ts'

export * from './device.ts'
export * from './messenger.ts'
export * from './outbox.ts'
export * from './resources.ts'
export * from './transport.ts'

// ============================== 传输接口（可替换） ==============================

export interface TelegramMessage {
  messageId: number | string

  chatId?: string

  senderId?: string
  text?: string
  ts?: string

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

  undelivered_recorded?: boolean
  /** 同源透传：失败是否**可能已送达**（网络类不确定失败，事后对账用）。 */
  ambiguous?: boolean

  parts?: number
}

export interface TelegramTransport {

  poll(offset: number, options: { timeoutS: number }): Promise<TelegramUpdate[]>

  send(
    chatId: string,
    text: string,
    replyTo: string | null,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult>
}

export interface TelegramAdapterCounters {
  polls: number
  inbound: number

  droppedUnbound: number

  droppedMalformed: number

  duplicates: number
  /** D-06：edited_message 忽略数。 */
  editedIgnored: number
  sent: number
  sendFailed: number
}

export interface MessengerAdapterService {
  /** 当前单传输实例负责的通道。 */
  readonly channel: string

  send(
    contextId: string,
    text: string,
    replyTo: string,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult>
  /** 手动驱动一轮长轮询（测试与外驱接口）；返回本轮处理的 update 数。 */
  pollOnce(): Promise<number>
  counters(): Readonly<TelegramAdapterCounters>
  cursor(): number

  deliverFollowup(content: string): Promise<OutboundReplyOutcome>
  wireOutbound(organ: OutboundOrgan): () => void | Promise<void>

  sendReply(
    contextId: string,
    text: string,
    replyTo: string | null,
    context?: OutboundTurnContext,
  ): Promise<OutboundReplyResult>

  askAbout(
    action: DelegatedAsk,
    contextId: string,
    replyTo: string | null,
    context?: OutboundTurnContext,
  ): Promise<AskAboutResult>

  consumeOutboxOnce(): Promise<void>
  /** 出站器官是否已接线（converse 的 `device_side_wired` 账面取值源）。 */
  outboundWired(): boolean

  routeOwnerMessage(input: {
    text: string
    contextId: string
    replyTo: string | null
    messageId: string
  }): Promise<OwnerInteraction | null>
  /**
   * messenger 的 transport 真身（`messenger._TRANSPORT = transport` 对应物）。
   * `replyTo` 可为 null —— 主动出站走这里，裸 `send` 是它的 reply-only 门面。
   */
  transportSend(
    contextId: string,
    text: string,
    replyTo: string | null,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult>
}

/** @deprecated 使用 MessengerAdapterService；保留一版类型兼容。 */
export type TelegramAdapterService = MessengerAdapterService

declare module '@deepseek-ai/cordis' {
  interface Context {
    messenger: MessengerAdapterService
    telegramTransport: TelegramTransport
  }
}

interface ArchiveItem {
  kind: 'messenger_inbound'
  ts: string
  context_id: string
  sender_id: string
  text: string

  reply_to: string | null
  source_ref_id: string
  id: number
}

interface ArchiveFile {
  next_id: number
  items: ArchiveItem[]
}

const INBOUND_MAX_KEEP = 200

const INITIAL_BACKOFF_S = 1.0
const MAX_BACKOFF_S = 60.0

/** `runPollLoop` 要的那一点点 logger 面（`ctx.logger` 结构上就是它的超集）。 */
export interface PollLoopLogger {
  warn(format: string, ...param: unknown[]): void
}

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

export class OutboundUnavailableError extends Error {
  constructor() { super('outbound organ is not wired'); this.name = 'OutboundUnavailableError' }
}

export class TelegramAdapter implements MessengerAdapterService {
  readonly channel = 'telegram'
  #transport: TelegramTransport
  #audit: AuditService
  #ingress: IngressService
  #memory: LykoiMemoryService
  #cursorPath: string
  #archivePath: string
  #pollTimeoutS: number
  #cursor: number
  #bootTime = Date.now()
  #catchingUp = true
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

  #outbound: OutboundOrgan | null = null

  constructor(_ctx: Context, options: {
    transport: TelegramTransport
    audit: AuditService
    ingress: IngressService
    memory: LykoiMemoryService
    cursorPath: string
    archivePath: string
    pollTimeoutS: number
  }) {
    this.#transport = options.transport
    this.#audit = options.audit
    this.#ingress = options.ingress
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

  async deliverFollowup(content: string): Promise<OutboundReplyOutcome> {
    return this.#requireOutbound().deliverFollowup(content)
  }

  wireOutbound(organ: OutboundOrgan): () => void | Promise<void> {
    this.#outbound = organ
    return async () => {
      if (this.#outbound === organ) this.#outbound = null
      await organ.close()
    }
  }

  outboundWired(): boolean {
    return this.#outbound !== null
  }

  async routeOwnerMessage(input: {
    text: string
    contextId: string
    replyTo: string | null
    messageId: string
  }): Promise<OwnerInteraction | null> {
    if (this.#outbound === null) return null
    return await this.#outbound.routeOwnerMessage(input)
  }

  #requireOutbound(): OutboundOrgan {
    if (this.#outbound === null) {
      throw new OutboundUnavailableError()
    }
    return this.#outbound
  }

  async sendReply(
    contextId: string,
    text: string,
    replyTo: string | null,
    context?: OutboundTurnContext,
  ): Promise<OutboundReplyResult> {
    return await this.#requireOutbound().sendReply({
      contextId, text, replyTo,
      ...(context === undefined ? {} : context),
    })
  }

  async askAbout(
    action: DelegatedAsk,
    contextId: string,
    replyTo: string | null,
    context?: OutboundTurnContext,
  ): Promise<AskAboutResult> {
    return await this.#requireOutbound().askAbout(action, {
      contextId, replyTo,
      ...(context === undefined ? {} : context),
    })
  }

  async consumeOutboxOnce(): Promise<void> {
    try {
      await this.#requireOutbound().consumeOutboxOnce()
    } catch (err) {
      await this.#audit.record({
        type: 'chat_outbox_consume_error',
        error_type: err instanceof Error ? err.name : 'Error',
      })
    }
  }

  async pollOnce(): Promise<number> {
    this.#counters.polls += 1
    const updates = await this.#transport.poll(this.#cursor + 1, { timeoutS: this.#catchingUp ? 0 : this.#pollTimeoutS })
    let processed = 0
    for (const update of updates) {

      if (!Number.isInteger(update.updateId)) continue
      if (update.updateId <= this.#cursor) {
        this.#counters.duplicates += 1
        continue
      }
      await this.#handleUpdate(update)

      this.#cursor = update.updateId
      await this.#persistCursor()

      await this.#ingress.kick()
      processed += 1
    }
    // 启动时用零等待拉尽积压；空批是确定性边界，不猜服务器批大小。
    if (this.#catchingUp && updates.length === 0) {
      await this.#ingress.finishReplay?.('telegram')
      this.#catchingUp = false
    }
    return processed
  }

  async #handleUpdate(update: TelegramUpdate): Promise<void> {

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
    const receivedAt = Date.now()

    const senderId = message.senderId
    const chatId = message.chatId
    if (typeof senderId !== 'string' || senderId.length === 0
      || typeof chatId !== 'string' || chatId.length === 0) {
      this.#counters.droppedMalformed += 1
      return
    }

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

    const isOwner = binding.role === 'owner_primary'

    const stamped: InboundPart = {
      inboundId: `telegram:${update.updateId}`,
      channel: 'telegram',
      platformMessageId: String(message.messageId),
      platformUpdateId: String(update.updateId),
      userId: binding.userId,
      contextId: chatId,
      isOwner,
      text,
      receivedAt: new Date(receivedAt).toISOString(),
      ...(this.#catchingUp && message.ts !== undefined && Date.parse(message.ts) < this.#bootTime
        ? { replay: true } : {}),
      ...(message.ts === undefined ? {} : { sourceTimestamp: message.ts }),
      ...(message.replyToMessageId === undefined
        ? {}
        : { replyToPlatformMessageId: message.replyToMessageId }),
    }
    // 传输层“收到”先留痕；是否已可靠接纳、归到哪个 turn 由紧随其后的
    // inbound/accepted 正本回答。正文仍不入 audit。
    await this.#audit.record({
      type: 'telegram/inbound',
      updateId: update.updateId,
      contextId: chatId,
      userId: binding.userId,
      isOwner,
      chars: text.length,
      inboundId: stamped.inboundId,
    })
    const accepted = await this.#ingress.accept(stamped, () => {
      // 入站已持久化即让 wake 礼让，不等审计 I/O 或排队的 cognition。
      markActive(undefined, new Date(receivedAt))
    })
    if (accepted.duplicate) {
      this.#counters.duplicates += 1
      return
    }
    this.#counters.inbound += 1
    // S-08 与 cognition 都由 UserTurn executor 在 FIFO 上处理；这里到 durable accept
    // 即返回，让 pollOnce 可以先推进 cursor，再收下一条外界消息。
  }

  async send(
    contextId: string,
    text: string,
    replyTo: string,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult> {

    if (typeof replyTo !== 'string' || replyTo.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires replyTo (this is the reply-only surface; proactive outbound goes through the outbound organ — SPEC §7.1)')
    }
    return await this.transportSend(contextId, text, replyTo, options)
  }

  async transportSend(
    contextId: string,
    text: string,
    replyTo: string | null,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult> {

    if (typeof text !== 'string' || text.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires non-empty text')
    }
    if (typeof contextId !== 'string' || contextId.length === 0) {
      throw new TypeError('lykoi-adapter-telegram: send requires non-empty contextId')
    }
    const result = await this.#transport.send(contextId, text, replyTo, options)
    if (result.sent && result.messageId !== null) {
      this.#counters.sent += 1
      await this.#audit.record({
        type: 'telegram/sent',
        contextId,
        replyTo,

        chars: text.length,
        messageId: result.messageId,
        parts: result.parts ?? 1,
      })
    } else {

      this.#counters.sendFailed += 1
      await this.#audit.record({
        type: 'telegram/send_failed',
        contextId,
        replyTo,
        chars: text.length,
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(result.parts === undefined ? {} : { parts: result.parts }),
      })
    }
    return result
  }

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
export const inject = ['audit', 'ingress', 'lykoiMemory', 'telegramTransport', 'lykoiRuntime']

export interface Config {
  cursorPath: string
  archivePath: string

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

        await adapter.consumeOutboxOnce()
      } catch (err) {
        deps.logger.warn('lykoi-adapter-telegram: poll failed, backing off %ds: %s',
          backoffS, String(err))

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
    ingress: ctx.ingress,
    memory: ctx.lykoiMemory,
    cursorPath: config.cursorPath,
    archivePath: config.archivePath,
    pollTimeoutS: config.pollTimeoutS,
  })
  ctx.provide('messenger', adapter)
  ctx.effect(() => ctx.lykoiRuntime.register({
    organId: 'telegram', capabilities: outboundCapabilities(), sideEffects: [],
  }), 'telegram capabilities')

  setMessengerTransport(messengerTransportBridge(adapter))
  ctx.effect(() => () => setMessengerTransport(null), 'lykoi-adapter-telegram messenger transport')

  if (config.autoStart) {

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

export function messengerTransportBridge(adapter: TelegramAdapterService): MessengerTransport {
  return {
    async sendMessage(opts) {
      const result = await adapter.transportSend(opts.contextId, opts.text, opts.replyTo ?? null)
      return {
        message_id: result.messageId,
        context_id: opts.contextId,
        sent: result.sent,
        ...(result.error === undefined ? {} : { error: result.error }),

        ...(result.undelivered_recorded === undefined
          ? {}
          : { undelivered_recorded: result.undelivered_recorded }),
        ...(result.ambiguous === undefined ? {} : { ambiguous: result.ambiguous }),
      }
    },
    async fetchUpdates() {
      return { messages: [], count: 0, error: 'unsupported_on_device_seam' }
    },
  }
}
