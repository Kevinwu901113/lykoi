/**
 * lykoi-adapter-telegram/production — 生产传输接线（M4 前置 #8：接真 HTTP）。
 *
 * M1 波次 2 这里只有一副骨架（poll/send 一律 reject，"零真网"纪律下不许出现
 * 可达真网的代码路径）。M4 把真身接上，做法是**桥**而不是重写：
 *
 *   设备层 seam（`TelegramTransport`：poll/send，camelCase）
 *        ↑ 本文件这一层薄桥（形状转换，零策略）
 *   Bot API 真身（`BotApiTransport`：transport.ts，SK-81 的全部纪律都在里面）
 *        ↑ HTTP 注入 seam（`HttpPost`）
 *   真 `fetch`（`./http` 的 `createFetchHttpPost` —— **唯一**指向真网的实现）
 *
 * 为什么是桥：SK-81 的四条纪律（重试仅 sendMessage / 429 单路 honour
 * retry_after / token 零外泄 / 未送达账本与经验回灌）**已经**长在
 * `BotApiTransport` 里并且有红测钉着。重写一遍等于把它们复制一遍，然后两份各自
 * 漂移。这里一行策略都不加：只做形状转换与真 fetch 的**选择**。
 *
 * **真 fetch 只在这里被选中**：整棵树里除本文件外没有第二处引用
 * `createFetchHttpPost`，所以「测试零真网」不是靠自觉，是靠没有别的入口。
 *
 * 凭据纪律不变：token 走 env 引用（`tokenEnv`），永不落配置、永不落日志、
 * 永不回显；无 token 即拒起。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createFetchHttpPost } from './http.ts'
import { BotApiTransport, TelegramPollError } from './transport.ts'
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
    // 无 token 即拒起（transport.py:213-215 语义；错误信息不含任何 token 材料）。
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

  /**
   * S-01 长轮询。`offset` 即 Bot API 的 ack。错误分类与降噪都在
   * `BotApiTransport` 里 —— 这里失败**即抛**（`TelegramPollError`），退避在设备层
   * 循环（WO-FIX-POLLBACKOFF-01 D-1）。
   *
   * 从前这里把失败转成空批，于是「HTTP 快速失败 → 空批 → 立刻再来一次」以一个
   * HTTP 往返（实测约 290ms）为节拍热循环，直到平台恢复。现在失败落进循环的
   * `catch`，那条 1→60s 的指数退避（成功即复位）才真的生效。游标语义不变：失败
   * 不推进游标，那些 update 下一轮还在（平台侧未 ack）。
   *
   * 抛出的错误只带**类别**与数字 `status`，不带 URL / token / 原始异常文本。
   */
  async poll(offset: number, options: { timeoutS: number }): Promise<TelegramUpdate[]> {
    const result = await this.#api.pollUpdates({ offset, timeoutS: options.timeoutS })
    if (result.error !== undefined) throw new TelegramPollError(result.error)
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

  /**
   * 出站。两种结局（有 message_id / 进未送达账本）已经由 `sendMessage` 保证 ——
   * 这里只把结果换个形状。`error` **只取类别**，绝不取任何原始异常文本。
   */
  async send(chatId: string, text: string, replyTo: string | null): Promise<TelegramSendResult> {
    const result = await this.#api.sendMessage({ contextId: chatId, text, replyTo })
    if (result.message_id === null) {
      return {
        messageId: null,
        sent: false,
        error: result.error ?? 'send_failed',
      }
    }
    return { messageId: result.message_id, sent: true }
  }
}

export const name = 'lykoi-telegram-transport'
export const inject: string[] = []

export interface Config {
  /** bot token 的 env 引用名（学 dsh credentials 的 apiKeyEnv 形态）。 */
  tokenEnv: string
  /**
   * 出站代理。**缺省空串 = 直连**，且这一位只能从装配面来 —— 传输层自身零 env
   * 读取（M4 前置 #8），`LYKOI_TELEGRAM_PROXY` 的 unset 检查在 GK-6 门里。
   * 非空 = undici `ProxyAgent`（`./http` 文件头④：每一次请求都带 dispatcher，
   * 结构上不存在「配了代理却静默直连」；URL 不合法 = 构造期抛）。生产网络事实
   * （2026-08-31 取证）：主机直连 api.telegram.org 不通，必须经内网代理箱。
   */
  proxy: string
}

export const Config: Schema<Config> = Schema.object({
  tokenEnv: Schema.string().default('LYKOI_TELEGRAM_BOT_TOKEN'),
  proxy: Schema.string().default(''),
})

export function apply(ctx: Context, config: Config) {
  const transport = new ProductionTelegramTransport(process.env[config.tokenEnv], {
    proxy: config.proxy,
  })
  ctx.provide('telegramTransport', transport)
}
