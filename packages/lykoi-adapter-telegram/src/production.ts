import type { DocumentSend } from './document.ts'
import { readFileSync } from 'node:fs'
import { parseDeploy } from './deployment.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createFetchHttpPost } from './http.ts'
import {
  BotApiTransport, TelegramPollError, type TelegramSendOptions,
} from './transport.ts'
import type { TelegramSendResult, TelegramTransport, TelegramUpdate } from './index.ts'

/**
 * 设备层 seam 的生产实现。**零策略**：每个方法都是一次形状转换加一次
 * `BotApiTransport` 调用。
 */
export class ProductionTelegramTransport implements TelegramTransport {
  /** token 只活在 `BotApiTransport` 的私有字段里，本类连存都不存。 */
  #api: BotApiTransport
  /** 长轮询秒数之上的 HTTP 垫高由 BotApiTransport 自己加（timeoutS + 10）。 */

  constructor(token: string | undefined, options: {
    api?: BotApiTransport
    apiBase?: string
    /** 出站代理（显式配置驱动）。空串 = 直连；非空 = undici `ProxyAgent`
     * （`./http` 文件头④，每请求带 dispatcher）；URL 不合法 = 构造期抛。 */
    proxy?: string
  } = {}) {
    if (options.api !== undefined) {
      this.#api = options.api
      return
    }

    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(
        'lykoi-adapter-telegram/production: refusing to start without a bot token '
        + '(set the env var named by config.tokenEnv; credentials are env references, never plaintext config)',
      )
    }
    const proxy = options.proxy ?? ''
    this.#api = new BotApiTransport({
      token,
      // 唯一的真网选择点。
      post: createFetchHttpPost({ proxy }),
      proxy,
      ...(options.apiBase === undefined ? {} : { apiBase: options.apiBase }),
    })
  }

  async sendDocument(opts: DocumentSend) {
    return await this.#api.sendDocument(opts)
  }

  async poll(offset: number, options: { timeoutS: number }): Promise<TelegramUpdate[]> {
    const result = await this.#api.pollUpdates({ offset, timeoutS: options.timeoutS })
    if (result.error !== undefined) throw new TelegramPollError(result.error, result.status)
    const updates: TelegramUpdate[] = []
    for (const raw of result.updates) {
      const message = raw.message
      const update: TelegramUpdate = { updateId: Number(raw.update_id) }
      if (message !== null) {
        update.message = {
          messageId: String(message.message_id ?? ''),
          chatId: message.chat_id,
          senderId: message.sender_id ?? '',
          text: message.text,
          ...(message.date === undefined ? {} : { ts: new Date(message.date * 1000).toISOString() }),
          ...(message.reply_to_message_id === undefined
            ? {}
            : { replyToMessageId: message.reply_to_message_id }),
        }
      }
      updates.push(update)
    }
    return updates
  }

  async send(
    chatId: string,
    text: string,
    replyTo: string | null,
    options?: TelegramSendOptions,
  ): Promise<TelegramSendResult> {
    const result = await this.#api.sendMessage({
      contextId: chatId,
      text,
      replyTo,
      ...(options === undefined ? {} : options),
    })
    if (result.message_id === null) {
      return {
        messageId: null,
        sent: false,
        error: result.error ?? 'send_failed',

        ...(result.undelivered_recorded === undefined
          ? {}
          : { undelivered_recorded: result.undelivered_recorded }),
        ...(result.ambiguous === undefined ? {} : { ambiguous: result.ambiguous }),
        ...(result.parts >= 2 ? { parts: result.parts } : {}),
      }
    }

    return { messageId: result.message_id, sent: true, ...(result.parts >= 2 ? { parts: result.parts } : {}) }
  }
}

export const name = 'lykoi-telegram-transport'
export const inject: string[] = []

export interface Config {
  /** bot token 的 env 引用名（学 dsh credentials 的 apiKeyEnv 形态）。 */
  tokenEnv: string

  proxy: string
  /** proxy=deployment 时定位部署文件；其余模式不读。 */
  deploymentFile?: string
}

export const Config: Schema<Config> = Schema.object({
  tokenEnv: Schema.string().default('LYKOI_TELEGRAM_BOT_TOKEN'),
  proxy: Schema.string().default(''),
  deploymentFile: Schema.string().default(''),
})

export function resolveDeploymentProxy(config: Pick<Config, 'proxy' | 'deploymentFile'>): string {
  if (config.proxy !== 'deployment') return config.proxy
  if (!config.deploymentFile) throw new Error('deploy.toml: deploymentFile is required for deployment proxy')
  const proxy = parseDeploy(readFileSync(config.deploymentFile, 'utf8'), config.deploymentFile).telegram_proxy
  if (!proxy) throw new Error('deploy.toml: [telegram].proxy is required for deployment proxy')
  return proxy
}

export function apply(ctx: Context, config: Config) {
  const transport = new ProductionTelegramTransport(process.env[config.tokenEnv], {
    proxy: resolveDeploymentProxy(config),
  })
  ctx.provide('telegramTransport', transport)
}
