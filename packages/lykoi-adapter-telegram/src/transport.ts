import type { DocumentSend } from './document.ts'
import { appendUndelivered, type UndeliveredRecord } from './outbox.ts'

export const API_BASE = 'https://api.telegram.org'
export const TOKEN_ENV_VAR = 'LYKOI_TELEGRAM_BOT_TOKEN'

export const PROXY_ENV_VAR = 'LYKOI_TELEGRAM_PROXY'

/**
 * 一个 429 至多重试这么多次（每次 honour `retry_after`）才放弃 —— 有界，好让
 * 一个被持续限流的调用挂不住调用方。**429 走单独一条路**：它不吃下面的网络
 * 重试序列（那条只给网络故障）。
 */
export const MAX_RATE_LIMIT_RETRIES = 3

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
let _experienceOwner = '所有者'
export function setUndeliveredExperienceSink(fn: RecordExperienceFn | null, options: { ownerName?: string } = {}): void {
  _recordExperience = fn
  _experienceOwner = options.ownerName ?? '所有者'
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

function _recordUndeliveredExperience(record: UndeliveredRecord): void {
  const content
    = `我想对 ${_experienceOwner} 说的话没能送出去(${record.error}，未送达记录 #${record.id}）：`
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

export const TELEGRAM_TEXT_MAX = 4096

const WHITESPACE = /\s/
const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff
const isLowSurrogate = (unit: number): boolean => unit >= 0xdc00 && unit <= 0xdfff

export function splitForTelegram(text: string, max: number = TELEGRAM_TEXT_MAX): string[] {
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('splitForTelegram: max must be a positive integer')
  }
  if (text.length <= max) return [text]
  const parts: string[] = []
  let rest = text
  while (rest.length > max) {
    const window = rest.slice(0, max)
    let cut = -1
    const paragraph = window.lastIndexOf('\n\n')
    if (paragraph >= 0) cut = paragraph + 2
    if (cut < 1) {
      const line = window.lastIndexOf('\n')
      if (line >= 0) cut = line + 1
    }
    if (cut < 1) {
      for (let i = max - 1; i >= 0; i -= 1) {
        if (WHITESPACE.test(window[i]!)) { cut = i + 1; break }
      }
    }
    if (cut < 1) {
      cut = max
      if (cut > 1 && isHighSurrogate(rest.charCodeAt(cut - 1)) && isLowSurrogate(rest.charCodeAt(cut))) {
        cut -= 1
      }
    }
    parts.push(rest.slice(0, cut))
    rest = rest.slice(cut)
  }
  parts.push(rest)
  return parts
}

export interface HttpResponse {
  status: number
  /** 解析失败时抛（对应 httpx 的 `response.json()` ValueError）。 */
  json(): unknown
}

/** 一次 POST。抛出的错误的 `name` 就是分类（DEFINITE_FAILURE_ERRORS 比对它）。 */
export type HttpPost = (
  url: string, payload: Record<string, unknown> | FormData, opts: { timeoutS?: number },
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

  async #postApi(
    method: string,
    payload: Record<string, unknown> | FormData,
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

  async sendDocument(opts: DocumentSend): Promise<{ message_id: string | null; sent: boolean; [key: string]: unknown }> {
    const payload = new FormData()
    payload.set('chat_id', opts.contextId)
    payload.set('document', new Blob([new Uint8Array(opts.bytes)], { type: 'application/octet-stream' }), opts.filename)
    if (opts.replyTo) payload.set('reply_parameters', JSON.stringify({ message_id: Number(opts.replyTo) }))
    // A timed-out upload may already have arrived. No automatic network replay.
    const result = await this.#postApi('sendDocument', payload)
    const message = result.result as Record<string, unknown> | undefined
    const messageId = message?.message_id
    if (result.ok !== true || typeof messageId !== 'number' || !Number.isSafeInteger(messageId) || messageId <= 0) {
      const error = result.error ?? 'missing_delivery_receipt'
      const ambiguous = Boolean(result.ambiguous) || result.ok === true || error === 'bad_response' || (result.status ?? 0) >= 500
      recordUndelivered({ contextId: opts.contextId, text: '[file attachment]', error, ambiguous,
        attempts: Number(result.attempts ?? 1), source: 'telegram_transport.send_document' })
      return { sent: false, message_id: null, error, ambiguous, undelivered_recorded: true }
    }
    logEvent('telegram_document_sent', { context_id: opts.contextId, message_id: String(messageId), bytes: opts.bytes.length })
    return { sent: true, message_id: String(messageId), context_id: opts.contextId, bytes: opts.bytes.length }
  }

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
    parts: number
  }> {
    const segments = splitForTelegram(opts.text, TELEGRAM_TEXT_MAX)
    const parts = segments.length
    if (parts >= 2) {
      // D-4：零正文——只有段数与全文字数。
      logEvent('telegram_transport_split', { parts, chars: opts.text.length })
    }
    let replyToId: number | null = null
    if (opts.replyTo !== null && opts.replyTo !== undefined) {
      const n = Number.parseInt(String(opts.replyTo), 10)
      // 不是 Telegram 的 message id（例如我们自己的本地 ref）→ 略去，照样发。
      if (Number.isFinite(n)) replyToId = n
    }
    let firstMessageId: string | null = null
    let firstTs: unknown
    for (let k = 0; k < parts; k += 1) {
      const payload: Record<string, unknown> = { chat_id: opts.contextId, text: segments[k] }
      // D-3：reply_to_message_id 只带在第一段。
      if (k === 0 && replyToId !== null) payload.reply_to_message_id = replyToId
      const result = await this.#postApi('sendMessage', payload, {
        retryBackoff: SEND_RETRY_BACKOFF_S,
      })
      if (result.ok !== true) {
        const partial = k > 0
        const category = (result.error as string | undefined) || 'send_failed'
        const error = partial ? 'partial_delivery' : category
        recordUndelivered({
          contextId: opts.contextId,
          // D-3：账本记的是**尚未送出**的部分（第一段就失败 = 全文，与从前同）。
          text: segments.slice(k).join(''),
          error: partial ? error : ((result.error_type as string | undefined) || category),
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
          parts,
        }
      }
      if (k === 0) {
        const message = (result.result ?? {}) as Record<string, unknown>
        const messageId = message.message_id
        firstMessageId = messageId === undefined || messageId === null ? null : String(messageId)
        firstTs = message.date
      }
    }
    return { message_id: firstMessageId, context_id: opts.contextId, ts: firstTs, parts }
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
    // Preserve platform chat type for downstream routing.
    ...(chat.type === undefined ? {} : { chat_type: String(chat.type) }),
    sender_id: sender.id === undefined || sender.id === null ? null : String(sender.id),
    text: typeof message.text === 'string' ? message.text : '',
    ...(message.date === undefined ? {} : { date: Number(message.date) }),
  }

  if (quoted !== undefined && quoted !== null) normalized.reply_to_message_id = String(quoted)
  return normalized
}
