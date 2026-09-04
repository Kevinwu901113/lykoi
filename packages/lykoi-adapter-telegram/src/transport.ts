/**
 * 传输层纪律（resources/telegram_transport.py 逐字对拍；SK-81）。
 *
 * 一句话版本：**一条出站消息只有两种结局 —— 有 message_id（送达），或在未送达
 * 账本（`./outbox`）里。没有第三种。** 下面每一条机制都长在 `Transport` seam
 * 以下，所以每个调用方（chat 回复代发 / `messenger.send` 动作 / S3 审批问答 /
 * L5 建议问答 / 出站投递线）不改一行就全都继承。
 *
 * **token 纪律**（活体点名的最硬失败模式）：bot token 只用于拼请求 URL，**永不**
 * 插进日志行、异常消息或返回载荷 —— 下面每条错误路径给出的都是**类别**
 * （异常类名 / HTTP 状态），绝不是 `String(exc)` 或请求 URL，因为 HTTP 客户端的
 * 异常会把完整请求 URL（含 token）嵌进它的字符串形态。`trustEnv=false`：环境里
 * 的 HTTP(S)_PROXY 绝不许悄悄改道一条 URL 里带着 token 的请求。
 *
 * **HTTP 那一跳仍是注入 seam**（`HttpPost`）：本文件没有缺省实现，一条可达真网
 * 的代码路径都没有。M4 前置 #8 起真身住在 `./http`（`createFetchHttpPost`），
 * 且**只在生产装配面被选中**（`./production` 的 apply）——测试永远注 fake。
 *
 * **零 env 读取**（M4 前置 #8 逐字）：本文件一个 `process.env` 都没有。代理这
 * 一位只能由装配面显式递进来；`LYKOI_TELEGRAM_PROXY` 的 unset 检查在 GK-6 门里。
 */
import { appendUndelivered, type UndeliveredRecord } from './outbox.ts'

export const API_BASE = 'https://api.telegram.org'
export const TOKEN_ENV_VAR = 'LYKOI_TELEGRAM_BOT_TOKEN'
/**
 * 出站代理的 env 名。**本包永不读它**（M4 前置 #8：transport 零 env 读取）——
 * 名字留在源码里是有作用的：GK-6 的钉面是**扫出来的**（`scanEnvReads` 扫每个包
 * 的 src 里的 `LYKOI_` 字面量），所以这一行正是让门把它钉成 `unset` 类的那条
 * 依据。设了它就是一条外泄通道（URL 里带着 token），生产必须未设。
 */
export const PROXY_ENV_VAR = 'LYKOI_TELEGRAM_PROXY'

/**
 * 一个 429 至多重试这么多次（每次 honour `retry_after`）才放弃 —— 有界，好让
 * 一个被持续限流的调用挂不住调用方。**429 走单独一条路**：它不吃下面的网络
 * 重试序列（那条只给网络故障）。
 */
export const MAX_RATE_LIMIT_RETRIES = 3

// --- WO-U0 ①：sendMessage 重试语义 -------------------------------------------
// 背景（2026-08-12）：chat_reply 已记账，sendMessage 却 ConnectError 丢件 ——
// 她以为自己说了，他从没收到，谁都无从得知。
//
// 失败分两类，分类**唯一的用途是记录，不是决定要不要重试**：
//   * 确定未发出（Connect/ConnectTimeout/Proxy —— TCP/代理这一层就没连上，请求
//     根本没到 Telegram）：重发绝无重复之虞。
//   * 歧义（ReadTimeout / RemoteProtocol / 其它半途死：请求发出去了，回应没读
//     回来 —— Telegram 可能已经处理并投递了）：重发**可能**产生一条重复。
//
// 取舍钉死在这里：**丢话之害 > 偶发重复之害**。一条重复消息 Kevin 一眼就能识别
// 并忽略，一条丢掉的话没有任何人能事后发现。所以歧义类**也重试**，只是事件里
// 标 `ambiguous=true`，让事后对账知道那条重复是从哪来的。
//
// 退避 2/5/15/30s、至多 4 次重试，总睡眠 52s ≤ 60s 的总窗 —— 一次对话回复能容忍
// 的时延上限；超过这个窗口，与其继续悄悄重试，不如落成②的"未送达"记录。
export const SEND_RETRY_BACKOFF_S: readonly number[] = [2.0, 5.0, 15.0, 30.0]
/**
 * 连不上 = 请求确定没到 Telegram。其余一律按歧义处理（宁可把一次确定失败误标成
 * 歧义，不可把一次歧义误标成确定 —— 前者只是记录保守了）。
 */
export const DEFINITE_FAILURE_ERRORS: readonly string[] = [
  'ConnectError', 'ConnectTimeout', 'ProxyError',
]

/** getUpdates 错误降噪：同类错误连击只记首条 + 每第 10 条（都带 streak 计数）。 */
export const POLL_ERROR_LOG_EVERY = 10

/**
 * 一次 getUpdates 失败（WO-FIX-POLLBACKOFF-01 D-1）。**设备层的长轮询循环靠它
 * 认出"这一轮不是空批，是失败"**，从而进 catch 走那条 1→60s 的指数退避 ——
 * 在它之前失败被转成空批，三层各自以为退避归别人管，结果一层都没退。
 *
 * **token 纪律**（本文件文件头那条）在这里同样是硬的：只带 `category`
 * （`pollUpdates` 的 `error` 字面值）与可选的数字 `status`，`message` 是
 * 固定模板 —— 绝不带 URL、token、原始异常文本。
 */
export class TelegramPollError extends Error {
  /** `network_error` / `api_error` / `bad_response` / `rate_limited`。 */
  readonly category: string
  /** HTTP 状态（有就带；纯数字，不带任何文本）。 */
  readonly status?: number

  constructor(category: string, status?: number) {
    super(`getUpdates failed: ${category}`)
    this.name = 'TelegramPollError'
    this.category = category
    if (status !== undefined) this.status = status
  }
}

/** 未送达记录里正文只留摘要（前 200 字）；事件里只留字数。 */
export const TEXT_SUMMARY_CHARS = 200

// --- WO-U1 ①：未送达 → 经验 --------------------------------------------------
// 标签与档次钉在这里，便于日后按判据版本回查：换标签会改变这条经验进 working
// 还是 archive。
export const UNDELIVERED_EXPERIENCE_SOURCE = 'conversation'
export const UNDELIVERED_SALIENCE = 0.6

export type LogEventFn = (name: string, fields: Record<string, unknown>) => void

let _logEvent: LogEventFn = () => {}
/** 接线方注入遥测出口（缺省 no-op；遥测不是控制流）。 */
export function setTransportLogEvent(fn: LogEventFn | null): void {
  _logEvent = fn ?? (() => {})
}
function logEvent(name: string, fields: Record<string, unknown> = {}): void {
  try { _logEvent(name, fields) } catch { /* 遥测失败静默 */ }
}

/**
 * 经验回灌注入位（`mind.reflow.record_experience` 对应物 —— Phase-2 **唯一**的
 * 经验写入点，它同时把 load 抬起来）。**不直接碰 store**：单写者纪律。
 */
export type RecordExperienceFn = (
  source: string, content: string, opts: { salience: number },
) => number | string | null

let _recordExperience: RecordExperienceFn | null = null
export function setUndeliveredExperienceSink(fn: RecordExperienceFn | null): void {
  _recordExperience = fn
}

/**
 * 把一条**没送出去**的出站消息落到磁盘，并发 `telegram_send_undelivered`。
 *
 * 事件与记录在同一个函数里，所以不存在"记了表没发事件"或反过来的半截状态。
 * `text` **只在文件里留摘要（前 200 字），事件里只留字数** —— 事件流是给运维
 * 看的，消息正文属于对话。记录 9 字段：ts / context_id / text_summary / chars /
 * error / ambiguous / attempts / source（+ 落盘分配的 id）。
 */
export function recordUndelivered(opts: {
  contextId: string
  text: string
  error: string
  ambiguous?: boolean
  attempts?: number
  source?: string
  now?: Date
  /** 内部标记：缺省 true；系统失败回执传 false。 */
  recordUndeliveredExperience?: boolean
}): UndeliveredRecord {
  const text = opts.text ?? ''
  const record = appendUndelivered({
    ts: (opts.now ?? new Date()).toISOString(),
    context_id: String(opts.contextId),
    // Python `text[:200]` 是码点切片。
    text_summary: [...text].slice(0, TEXT_SUMMARY_CHARS).join(''),
    chars: text.length,
    error: opts.error,
    ambiguous: Boolean(opts.ambiguous),
    attempts: opts.attempts ?? 1,
    source: opts.source ?? 'messenger.send',
  })
  logEvent('telegram_send_undelivered', {
    id: record.id,
    context_id: record.context_id,
    chars: record.chars,
    error: record.error,
    ambiguous: record.ambiguous,
    attempts: record.attempts,
    source: record.source,
  })
  if (opts.recordUndeliveredExperience ?? true) {
    _recordUndeliveredExperience(record)
  }
  return record
}

/**
 * WO-U1 ①：未送达不只是运维的账，也是**她的**一件事。
 *
 * U0 让这件事有账可查，但账本是给运维读的；她读不到，就等于没发生 —— 8-12 那批
 * 冤案的最后一环。这里把同一件事落成一条经验，于是它进消化预算、进整合管线，
 * 长期成为"我说过的话有时会掉在半路"这种可学习的经验。
 *
 * `source="conversation"`：experience_class 的判据是"这条记录里有没有外部世界
 * 注入的新信息"，而 WORKING_SOURCES 只认 conversation / environment。这条记录
 * 正是外部世界（传输层）对她一次开口给出的回音，并且它属于她与 Kevin 的交互本身
 * ——所以 conversation 是唯一贴切又必然进 working 池的既有标签。**不新造 source。**
 * salience 0.6 取中档（与 reflow 的 SILENCE_SALIENCE 同档）。
 *
 * 写入路径遵守**单写者纪律**：经注入的 reflow 入口，不直接碰 store。
 * **失败被吞但不静默**：记一条 telemetry —— 未送达的账本记录已经落定，不能因为
 * 经验写不进去而把一次投递失败升级成异常。
 */
function _recordUndeliveredExperience(record: UndeliveredRecord): void {
  const content
    = `我想对 Kevin 说的话没能送出去(${record.error}，未送达记录 #${record.id}）：`
    + `「${record.text_summary}」`
  try {
    const sink = _recordExperience
    if (sink === null) throw new Error('undelivered experience sink is not wired')
    const experienceId = sink(UNDELIVERED_EXPERIENCE_SOURCE, content, {
      salience: UNDELIVERED_SALIENCE,
    })
    logEvent('telegram_undelivered_experience', {
      id: record.id, experience_id: experienceId,
    })
  } catch (exc) { // 账已经记上了，经验写失败不许拖垮投递路径
    logEvent('telegram_undelivered_experience_failed', {
      id: record.id, error_type: exc instanceof Error ? exc.name : 'Error',
    })
  }
}

// ============================================================================
// Bot API 传输真身（HTTP 那一跳是注入 seam —— 本波零真网）
// ============================================================================

export interface HttpResponse {
  status: number
  /** 解析失败时抛（对应 httpx 的 `response.json()` ValueError）。 */
  json(): unknown
}

/** 一次 POST。抛出的错误的 `name` 就是分类（DEFINITE_FAILURE_ERRORS 比对它）。 */
export type HttpPost = (
  url: string, payload: Record<string, unknown>, opts: { timeoutS?: number },
) => Promise<HttpResponse>

export type SleepFn = (seconds: number) => Promise<void>

/**
 * 设备内部的出站标记，不是配置项：未注明时仍记录未送达经验；只有系统失败回执
 * 明确关闭经验回灌，同时保留未送达账本与 telegram 传输审计。
 */
export interface TelegramSendOptions {
  recordUndeliveredExperience?: boolean
}

export interface PostResult {
  ok: boolean
  error?: string
  error_type?: string
  ambiguous?: boolean
  attempts?: number
  status?: number
  [key: string]: unknown
}

export interface BotApiTransportOptions {
  token: string
  /** HTTP seam —— 生产实现经治理复核后接；测试注 fake。 */
  post: HttpPost
  proxy?: string
  timeoutS?: number
  apiBase?: string
  /** 退避睡眠 seam（测试注即时返回，实弹里是真等待）。 */
  sleep?: SleepFn
}

/** Telegram 更新的归一化形状（`_normalize_update` 对应物）。 */
export interface NormalizedMessage {
  message_id: number | string | null
  chat_id: string
  chat_type?: string
  sender_id: string | null
  text: string
  date?: number
  /** WO-S3：他回的是**哪一条** —— 归属消歧的锚。可选键，不引用就不出现。 */
  reply_to_message_id?: string
}

/**
 * `messenger.Transport` 的真身 + `pollUpdates`（设备专用的长轮询原语；
 * `messenger.read` 仍走 `fetchUpdates`）。
 */
export class BotApiTransport {
  #token: string
  #proxy: string
  #apiBase: string
  #timeoutS: number
  #post: HttpPost
  #sleep: SleepFn
  /** ④ 的连击状态：{errorType, streak, since} —— 只给 getUpdates 用。 */
  #pollErrorStreak: { errorType: string; streak: number; since: number } | null = null

  constructor(options: BotApiTransportOptions) {
    // 无 token 即拒起（错误信息不含任何 token 材料）。
    if (typeof options.token !== 'string' || options.token.length === 0) {
      throw new Error(`BotApiTransport requires a bot token (${TOKEN_ENV_VAR})`)
    }
    this.#token = options.token
    // M4 前置 #8：**零 env 读取**。代理只能由装配面显式递进来（今天生产递空串
    // = 直连；GK-6 把代理 env 钉成必须未设，所以这里读 env 等于给那道钉开后门）。
    this.#proxy = (options.proxy ?? '').trim()
    this.#apiBase = options.apiBase ?? API_BASE
    this.#timeoutS = options.timeoutS ?? 30.0
    this.#post = options.post
    this.#sleep = options.sleep ?? ((s) => new Promise((r) => setTimeout(r, s * 1000)))
  }

  /** 代理只读回显（token 绝不回显）。 */
  get proxy(): string { return this.#proxy }

  #url(method: string): string {
    return `${this.#apiBase}/bot${this.#token}/${method}`
  }

  // --- ④ getUpdates 错误降噪（只影响日志，不影响任何时序） -------------------

  #notePollError(errorType: string): void {
    let streak = this.#pollErrorStreak
    if (streak === null || streak.errorType !== errorType) {
      // 换了一种错误 = 新的一段连击。上一段若还开着，它不算"恢复"，就此收口。
      streak = { errorType, streak: 0, since: Date.now() }
      this.#pollErrorStreak = streak
    }
    streak.streak += 1
    const n = streak.streak
    if (n === 1 || n % POLL_ERROR_LOG_EVERY === 0) {
      logEvent('telegram_transport_network_error', {
        method: 'getUpdates', error_type: errorType, streak: n,
      })
    }
  }

  #notePollOk(): void {
    const streak = this.#pollErrorStreak
    if (streak === null) return
    this.#pollErrorStreak = null
    logEvent('telegram_poll_recovered', {
      error_type: streak.errorType,
      streak: streak.streak,
      duration_s: Math.round((Date.now() - streak.since) / 100) / 10,
    })
  }

  /**
   * POST 一次 Bot API 调用。成功返回解析后的 JSON body，任何失败返回结构化的
   * `{ok: false, error: <类别>}` —— **本方法永不抛，也永不返回原始异常文本**。
   *
   * `retryBackoff`（WO-U0 ①）是网络故障的重试退避序列，空 = 不重试。**只有
   * sendMessage 传它**：getUpdates 的重连节奏归设备的长轮询循环管，本单不动。
   *
   * 「归设备的长轮询循环管」这句在 WO-FIX-POLLBACKOFF-01 之前是空头支票：
   * `pollUpdates` 的失败被 `./production` 转成空批，循环看不见失败，退避永不触发。
   * D-1 起 `production.poll` 失败即抛 `TelegramPollError`，那条循环的 1→60s 指数
   * 退避才真的接住它 —— 这句现在为真。本层仍不加任何 getUpdates 重试/退避。
   */
  async #postApi(
    method: string,
    payload: Record<string, unknown>,
    opts: { timeoutS?: number; retryBackoff?: readonly number[] } = {},
  ): Promise<PostResult> {
    const retryBackoff = opts.retryBackoff ?? []
    const isPoll = method === 'getUpdates'
    let attempts = 0
    let networkFailures = 0
    for (;;) {
      attempts += 1
      let response: HttpResponse
      try {
        response = await this.#post(this.#url(method), payload, {
          ...(opts.timeoutS === undefined ? { timeoutS: this.#timeoutS } : { timeoutS: opts.timeoutS }),
        })
      } catch (exc) {
        networkFailures += 1
        // token 纪律：只取**类别**（异常类名），绝不取 String(exc)/URL。
        const errorType = exc instanceof Error ? exc.name : 'Error'
        // 分类只决定 ambiguous 标记，不决定重不重试 —— 见文件头①的取舍。
        const ambiguous = !DEFINITE_FAILURE_ERRORS.includes(errorType)
        if (isPoll) {
          this.#notePollError(errorType)
        } else if (networkFailures <= retryBackoff.length) {
          const backoff = retryBackoff[networkFailures - 1]!
          logEvent('telegram_send_retry', {
            method, attempt: networkFailures, error_type: errorType, ambiguous,
            backoff_s: backoff,
          })
          await this.#sleep(backoff)
          continue
        } else {
          logEvent('telegram_transport_network_error', {
            method, error_type: errorType, attempts: networkFailures, ambiguous,
          })
        }
        return {
          ok: false, error: 'network_error', error_type: errorType,
          ambiguous, attempts: networkFailures,
        }
      }
      // HTTP 层通了就算恢复（429/api_error 是另一回事）。
      if (isPoll) this.#notePollOk()
      if (response.status === 429) {
        let retryAfter = 1.0
        try {
          const body = response.json() as Record<string, unknown>
          const params = (body?.parameters ?? {}) as Record<string, unknown>
          const raw = Number(params.retry_after)
          if (Number.isFinite(raw)) retryAfter = raw
        } catch { /* 解析不出就用缺省 1s */ }
        logEvent('telegram_transport_rate_limited', { method, retry_after: retryAfter, attempt: attempts })
        if (attempts > MAX_RATE_LIMIT_RETRIES) return { ok: false, error: 'rate_limited' }
        await this.#sleep(retryAfter)
        continue
      }
      let data: Record<string, unknown>
      try {
        data = response.json() as Record<string, unknown>
      } catch {
        logEvent('telegram_transport_bad_response', { method, status: response.status })
        return { ok: false, error: 'bad_response' }
      }
      if (response.status >= 400 || data?.ok !== true) {
        logEvent('telegram_transport_api_error', { method, status: response.status })
        return { ok: false, error: 'api_error', status: response.status }
      }
      return data as PostResult
    }
  }

  /**
   * `messenger.Transport.send_message` 真身。失败 = 终局，而**终局不许静默**：
   * 这里是所有出站调用方共同的最后一道关口，所以记在这一层就等于全都记上了。
   */
  async sendMessage(opts: {
    contextId: string
    text: string
    replyTo?: string | null
  } & TelegramSendOptions): Promise<{
    message_id: string | null
    context_id: string
    sent?: boolean
    ts?: unknown
    error?: string
    ambiguous?: boolean
    undelivered_recorded?: boolean
  }> {
    const payload: Record<string, unknown> = { chat_id: opts.contextId, text: opts.text }
    if (opts.replyTo !== null && opts.replyTo !== undefined) {
      const n = Number.parseInt(String(opts.replyTo), 10)
      // 不是 Telegram 的 message id（例如我们自己的本地 ref）→ 略去，照样发。
      if (Number.isFinite(n)) payload.reply_to_message_id = n
    }
    const result = await this.#postApi('sendMessage', payload, {
      retryBackoff: SEND_RETRY_BACKOFF_S,
    })
    if (result.ok !== true) {
      const error = (result.error as string | undefined) || 'send_failed'
      recordUndelivered({
        contextId: opts.contextId,
        text: opts.text,
        error: (result.error_type as string | undefined) || error,
        ambiguous: Boolean(result.ambiguous),
        attempts: Number(result.attempts ?? 1),
        source: 'telegram_transport.send_message',
        recordUndeliveredExperience: opts.recordUndeliveredExperience,
      })
      return {
        message_id: null,
        context_id: opts.contextId,
        sent: false,
        error,
        ambiguous: Boolean(result.ambiguous),
        // 调用方据此知道"未送达"已经落过账了，不必再记一笔（③）。
        undelivered_recorded: true,
      }
    }
    const message = (result.result ?? {}) as Record<string, unknown>
    const messageId = message.message_id
    return {
      message_id: messageId === undefined || messageId === null ? null : String(messageId),
      context_id: opts.contextId,
      ts: message.date,
    }
  }

  /** 非消费性的近期更新读（不推进 offset）—— `messenger.read` 的后端。 */
  async fetchUpdates(opts: { contextId?: string | null; limit?: number } = {}): Promise<{
    messages: NormalizedMessage[]
    count: number
    error?: string
  }> {
    const limit = opts.limit ?? 20
    const result = await this.#postApi('getUpdates', { limit, timeout: 0 })
    if (result.ok !== true) {
      return { messages: [], count: 0, ...(result.error === undefined ? {} : { error: result.error }) }
    }
    const contextId = opts.contextId ?? null
    const messages: NormalizedMessage[] = []
    for (const raw of (result.result as Record<string, unknown>[] | undefined) ?? []) {
      const m = normalizeUpdate(raw)
      if (m !== null && (contextId === null || m.chat_id === contextId)) messages.push(m)
    }
    return { messages, count: messages.length }
  }

  /**
   * 一次长轮询 `getUpdates`（offset 含义 = Bot API 自己的去重：传 offset 就 ack
   * 了它以下的全部 update，Telegram 不再重发）。HTTP 客户端超时垫在服务端长轮询
   * 秒数之上，好让这段等待本身永远不被误当成一次网络故障。
   *
   * 失败时 `status` 随 `error` 一起透出（WO-FIX-POLLBACKOFF-01 R-1a）：没有它，
   * 平台 5xx 与限流在设备层账面上都只是一个 `api_error`，落地读数分不开。**只
   * 透传，不解释**：`#postApi` 给什么就是什么，且只在它确实是数字时才带上 ——
   * token 纪律不变（状态码是数字，不是文本，泄不出 URL 与 token）。
   */
  async pollUpdates(opts: { offset: number; timeoutS?: number }): Promise<{
    updates: { update_id: unknown; message: NormalizedMessage | null }[]
    error?: string
    /** HTTP 状态（仅失败分支、仅数字）。`network_error` 这类没有它的失败不带。 */
    status?: number
  }> {
    const timeout = opts.timeoutS ?? 25
    const result = await this.#postApi(
      'getUpdates', { offset: opts.offset, timeout }, { timeoutS: timeout + 10.0 },
    )
    if (result.ok !== true) {
      return {
        updates: [],
        ...(result.error === undefined ? {} : { error: result.error }),
        ...(typeof result.status === 'number' ? { status: result.status } : {}),
      }
    }
    const updates: { update_id: unknown; message: NormalizedMessage | null }[] = []
    for (const raw of (result.result as Record<string, unknown>[] | undefined) ?? []) {
      updates.push({ update_id: raw.update_id, message: normalizeUpdate(raw) })
    }
    return { updates }
  }
}

/**
 * 一条 Telegram update 的 `message`，压平成本单其余部分要的字段；update 不带
 * message（频道帖/回调查询等，本单不管）时返回 null。
 */
export function normalizeUpdate(rawUpdate: Record<string, unknown>): NormalizedMessage | null {
  const message = (rawUpdate.message ?? rawUpdate.edited_message) as Record<string, unknown> | undefined
  if (!message) return null
  const chat = (message.chat ?? {}) as Record<string, unknown>
  const sender = (message.from ?? {}) as Record<string, unknown>
  const chatId = chat.id
  if (chatId === undefined || chatId === null) return null
  const quoted = ((message.reply_to_message ?? {}) as Record<string, unknown>).message_id
  const normalized: NormalizedMessage = {
    message_id: (message.message_id ?? null) as number | string | null,
    chat_id: String(chatId),
    // 预留给群聊接线（未实现）—— WO §forbidden。
    ...(chat.type === undefined ? {} : { chat_type: String(chat.type) }),
    sender_id: sender.id === undefined || sender.id === null ? null : String(sender.id),
    text: typeof message.text === 'string' ? message.text : '',
    ...(message.date === undefined ? {} : { date: Number(message.date) }),
  }
  // WO-S3：他回的是**哪一条**，是一句「可以」如何挂到某一条悬置问句上的全部依据。
  // 作为**可选键**加入 —— 不引用任何东西的消息保持它一直以来的归一化形状。
  if (quoted !== undefined && quoted !== null) normalized.reply_to_message_id = String(quoted)
  return normalized
}
