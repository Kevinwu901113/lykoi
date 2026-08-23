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
      return { messageId: null, sent: false, error }
    }
    this.sends.push({ chatId, text, replyTo })
    return { messageId: `m${++this.#nextMessageId}`, sent: true }
  }
}
