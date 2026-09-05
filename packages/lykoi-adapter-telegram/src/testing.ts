/**
 * lykoi-adapter-telegram/testing — 内存 fake transport（仅测试装配用，不进 profile）。
 *
 * 模拟平台侧语义：poll(offset) 只返回 updateId >= offset 的 update
 * （S-01/S-02 第一道：offset 即 Bot API 的 ack——平台不再重发 < offset 的 update）。
 */
import type { TelegramSendResult, TelegramTransport, TelegramUpdate } from './index.ts'

export interface RecordedSend {
  chatId: string
  text: string
  replyTo: string
}

export class MemoryTelegramTransport implements TelegramTransport {
  /** 平台侧的 update 仓（ack 之前一直可重发——长轮询语义）。 */
  #updates: TelegramUpdate[] = []
  /** 每次 poll 收到的 offset（S-01 断言观测点）。 */
  readonly pollOffsets: number[] = []
  readonly sends: RecordedSend[] = []
  /** 置为非 null 让 send 走失败分支。 */
  failNextSendWith: string | null = null
  #nextMessageId = 9000

  queueUpdate(update: TelegramUpdate): void {
    this.#updates.push(update)
  }

  async poll(offset: number, _options: { timeoutS: number }): Promise<TelegramUpdate[]> {
    this.pollOffsets.push(offset)
    // 平台侧 ack 模拟：< offset 的一律不再重发（S-02 第一道）。
    return this.#updates.filter((u) => u.updateId >= offset)
  }

  async send(chatId: string, text: string, replyTo: string): Promise<TelegramSendResult> {
    if (this.failNextSendWith !== null) {
      const error = this.failNextSendWith
      this.failNextSendWith = null
      // WO-FIX-UNDELIVERED-BRIDGE-01 D-2：假体不记账 → 明说 false，与生产面同形。
      return { messageId: null, sent: false, error, undelivered_recorded: false }
    }
    this.sends.push({ chatId, text, replyTo })
    return { messageId: `m${++this.#nextMessageId}`, sent: true }
  }
}

/**
 * 测试用的**出站 state 隔离**（数据纪律：她的 state 一个字节都不许落进仓库树）。
 *
 * 把出站器官全部持久面的 env 钉到一个 tmpdir 上，返回同一个目录。生产路径面的
 * 统一钉法（GK-6 的 env 钉面收紧）归 W4 的完整性门 —— 这里只是测试侧的等价物。
 */
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
