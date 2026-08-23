/**
 * lykoi-adapter-telegram/production — 生产传输骨架（M1 波次 2：不接真网）。
 *
 * 工单明示：生产实现本波**只写骨架不接真网**——poll/send 的真实 Bot API 传输
 * （getUpdates offset ack、sendMessage reply_to_message_id、重试序列
 * SEND_RETRY_BACKOFF_S=(2,5,15,30)、429 retry_after——SPEC §7.2）在后续波次
 * 经治理复核后接线；蓝图纪律 4（除 npm registry 外零网络）下本波不得出现可达
 * 真网的代码路径。
 *
 * 已落实的 S 语义：
 * - 无 token 即拒起（telegram_device.py:528 / transport.py:213-215：ValueError）。
 * - 凭据走 env 引用（tokenEnv），配置与代码里永不落明文 token（蓝图纪律 5）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { TelegramSendResult, TelegramTransport, TelegramUpdate } from './index.ts'

export class ProductionTelegramTransport implements TelegramTransport {
  /** token 仅存于实例私有字段，永不回显、永不入日志。 */
  #token: string

  constructor(token: string | undefined) {
    // 无 token 即拒起（transport.py:213-215 语义；错误信息不含任何 token 材料）。
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(
        'lykoi-adapter-telegram/production: refusing to start without a bot token '
        + '(set the env var named by config.tokenEnv; credentials are env references, never plaintext config)',
      )
    }
    this.#token = token
  }

  poll(_offset: number, _options: { timeoutS: number }): Promise<TelegramUpdate[]> {
    // TODO(后续波次，治理复核后)：fetch `${api}/bot<token>/getUpdates?offset&timeout`，
    // HTTP 客户端 timeout = timeoutS+10（S-01），错误分类+降噪（transport.py:232-261）。
    return Promise.reject(new Error(
      'lykoi-adapter-telegram/production: real-network transport is not wired in M1 wave 2 (skeleton only; blueprint discipline 4: zero network beyond npm registry)',
    ))
  }

  send(_chatId: string, _text: string, _replyTo: string): Promise<TelegramSendResult> {
    // TODO(后续波次)：sendMessage + reply_to_message_id（§7.1）+ 重试序列（§7.2）
    // + 未送达账本两结局（成功 message_id / record_undelivered）。
    return Promise.reject(new Error(
      'lykoi-adapter-telegram/production: real-network transport is not wired in M1 wave 2 (skeleton only)',
    ))
  }
}

export const name = 'lykoi-telegram-transport'
export const inject: string[] = []

export interface Config {
  /** bot token 的 env 引用名（学 dsh credentials 的 apiKeyEnv 形态）。 */
  tokenEnv: string
}

export const Config: Schema<Config> = Schema.object({
  tokenEnv: Schema.string().default('LYKOI_TELEGRAM_BOT_TOKEN'),
})

export function apply(ctx: Context, config: Config) {
  const transport = new ProductionTelegramTransport(process.env[config.tokenEnv])
  ctx.provide('telegramTransport', transport)
}
