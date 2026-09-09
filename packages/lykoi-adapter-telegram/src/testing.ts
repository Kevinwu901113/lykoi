import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { MessengerTransport } from './messenger.ts'

import type { TelegramSendResult, TelegramTransport, TelegramUpdate } from './index.ts'
import { splitForTelegram } from './transport.ts'

export interface RecordedSend {
  chatId: string
  text: string

  replyTo: string | null
}

export class MemoryTelegramTransport implements TelegramTransport {
  /** 平台侧的 update 仓（ack 之前一直可重发——长轮询语义）。 */
  #updates: TelegramUpdate[] = []

  readonly pollOffsets: number[] = []
  readonly sends: RecordedSend[] = []
  /** 置为非 null 让 send 走失败分支。 */
  failNextSendWith: string | null = null
  #nextMessageId = 9000

  readonly #maxChars: number | undefined

  constructor(options: { maxChars?: number } = {}) {
    this.#maxChars = options.maxChars
  }

  queueUpdate(update: TelegramUpdate): void {
    this.#updates.push(update)
  }

  async poll(offset: number, _options: { timeoutS: number }): Promise<TelegramUpdate[]> {
    this.pollOffsets.push(offset)

    return this.#updates.filter((u) => u.updateId >= offset)
  }

  async send(chatId: string, text: string, replyTo: string | null): Promise<TelegramSendResult> {
    if (this.failNextSendWith !== null) {
      const error = this.failNextSendWith
      this.failNextSendWith = null

      return { messageId: null, sent: false, error, undelivered_recorded: false }
    }
    const segments = this.#maxChars === undefined ? [text] : splitForTelegram(text, this.#maxChars)
    const messageId = `m${++this.#nextMessageId}`
    segments.forEach((segment, k) => {
      // D-6 与 D-3 同形：replyTo 只在第一段；每段各占一个 message id。
      this.sends.push({ chatId, text: segment, replyTo: k === 0 ? replyTo : null })
      if (k > 0) this.#nextMessageId += 1
    })
    if (segments.length >= 2) return { messageId, sent: true, parts: segments.length }
    return { messageId, sent: true }
  }
}

export function isolateOutboundState(dir: string): string {
  const at = (name: string) => `${dir}/${name}`
  process.env.LYKOI_CHAT_OUTBOX = at('chat_outbox.json')
  process.env.LYKOI_TELEGRAM_UNDELIVERED = at('telegram_undelivered.json')
  process.env.LYKOI_TELEGRAM_OUTBOX_CURSOR = at('telegram_outbox.cursor')
  process.env.LYKOI_MESSENGER_LEDGER = at('messenger_outbound.json')
  process.env.LYKOI_MESSENGER_TRANSPORT_LOG = at('messenger_transport.jsonl')
  process.env.LYKOI_PROACTIVE_CHAT_LEDGER = at('proactive_chat.json')
  process.env.LYKOI_NOTIFICATIONS = at('notifications.json')
  return dir
}

/** Explicit local archive transport for tests; never a production fallback. */
export class ArchiveMessengerTransport implements MessengerTransport {
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
