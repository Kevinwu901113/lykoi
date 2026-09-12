import { ProxyAgent, FormData as UndiciFormData, fetch as undiciFetch } from 'undici'
import type { HttpPost, HttpResponse } from './transport.ts'

/** `fetch` 的最小面（生产按 proxy 有无选内建或 undici 的 fetch；测试注 fake）。 */
export type FetchLike = (url: string, init: {
  method: string
  headers: Record<string, string>
  body: string | FormData | UndiciFormData
  signal: AbortSignal
  /** 代理路径的钉面：`proxy` 非空时每次请求必带（undici `ProxyAgent`）。 */
  dispatcher?: unknown
}) => Promise<{ status: number; text(): Promise<string> }>

/** 缺省请求超时（秒）——调用方基本都显式传，这只是兜底。 */
export const DEFAULT_HTTP_TIMEOUT_S = 30

/**
 * 「确定没发出去」的底层错误码 —— 连接根本没建立起来，重发绝无重复之虞。
 *
 * 只收**无歧义**的那几个（transport.ts 文件头的保守方向：宁可把一次确定失败
 * 误标成歧义，不可把一次歧义误标成确定）。`ETIMEDOUT`/`ECONNRESET` 都可能发生
 * 在请求已经送到之后，所以**不在此列**。
 */
export const DEFINITE_CONNECT_CODES: readonly string[] = Object.freeze([
  'ECONNREFUSED', // 对面端口没人听
  'ENOTFOUND', // DNS 没解析出来
  'EAI_AGAIN', // DNS 暂时失败
  'EHOSTUNREACH',
  'ENETUNREACH',
])

/** 上层 `DEFINITE_FAILURE_ERRORS` 认的类名（确定未发出）。 */
const CONNECT_ERROR = 'ConnectError'
/** 歧义类：请求可能已经到了 Telegram，回应没读回来。 */
const TIMEOUT_ERROR = 'TimeoutError'
const TRANSPORT_ERROR = 'TransportError'

/** 从一条 fetch 失败里挖出底层 errno（undici 把它挂在 `cause` 上）。 */
function errorCode(exc: unknown): string {
  let node: unknown = exc
  for (let depth = 0; depth < 4 && node !== null && node !== undefined; depth += 1) {
    const code = (node as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
    node = (node as { cause?: unknown }).cause
  }
  return ''
}

/**
 * 把一条原始传输异常换成一条**干净**的错误：`name` = 类别，`message` = 固定
 * 文案（含类别与 errno，**不含 URL、不含原始 message、不含 cause**）。
 *
 * 这是 token 纪律的物理落点：原始对象在这里被丢掉，之后谁也拿不到它 ——
 * 上层就算把整个错误 JSON 化落盘，也漏不出一个 token 字节。
 */
export function sanitizeTransportError(exc: unknown): Error {
  const code = errorCode(exc)
  const rawName = exc instanceof Error ? exc.name : ''
  let name: string
  if (rawName === 'TimeoutError' || rawName === 'AbortError' || code === 'UND_ERR_HEADERS_TIMEOUT'
    || code === 'UND_ERR_BODY_TIMEOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') {
    // 超时一律歧义：请求可能已经送到并被投递了。
    name = TIMEOUT_ERROR
  } else if (DEFINITE_CONNECT_CODES.includes(code)) {
    name = CONNECT_ERROR
  } else {
    name = TRANSPORT_ERROR
  }
  // 文案里只有类别与 errno —— 两者都不可能含 token。
  const error = new Error(`telegram transport failure (${name}${code === '' ? '' : `, ${code}`})`)
  error.name = name
  return error
}

/**
 * `proxy` 字符串 → `ProxyAgent`。构造期校验：不是合法 URL、或 scheme 不是
 * http/https（socks 等 `ProxyAgent` 不支持）→ 抛。**错误措辞永不含代理值**：
 * 代理 URL 可能带 `user:pass@`，回显它与回显 token 同罪。
 */
function buildProxyDispatcher(proxy: string): ProxyAgent {
  let parsed: URL
  try {
    parsed = new URL(proxy)
  } catch {
    throw new Error(
      'lykoi-adapter-telegram: proxy is not a valid URL (value withheld — it may carry credentials)',
    )
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    // scheme 是安全可回显的（不含地址与凭据）。
    throw new Error(
      `lykoi-adapter-telegram: proxy scheme "${parsed.protocol}" is not supported `
      + '(http/https only; value withheld — it may carry credentials)',
    )
  }
  return new ProxyAgent(proxy)
}

/**
 * 造一个真网 `HttpPost`。
 *
 * `proxy` 空串 = 直连（内建 fetch）；非空 = undici `ProxyAgent`，每请求带
 * `dispatcher`（见文件头④）；URL 不合法 = 构造期抛，不拖到第一次请求。
 * `fetch` 可注入 —— 红测拿它验证「超时形态 / token 不外泄 / 零 env / 代理
 * dispatcher 必在」，生产缺省按 proxy 有无选内建或 undici 的 fetch。
 */
export function createFetchHttpPost(options: {
  fetch?: FetchLike
  proxy?: string
  defaultTimeoutS?: number
} = {}): HttpPost {
  const proxy = (options.proxy ?? '').trim()
  const dispatcher = proxy === '' ? undefined : buildProxyDispatcher(proxy)
  const doFetch = options.fetch ?? (dispatcher === undefined
    ? (globalThis.fetch as unknown as FetchLike)
    : (undiciFetch as unknown as FetchLike))
  const fallbackTimeoutS = options.defaultTimeoutS ?? DEFAULT_HTTP_TIMEOUT_S

  return async function post(url, payload, opts): Promise<HttpResponse> {
    const timeoutS = opts.timeoutS ?? fallbackTimeoutS
    // 每次请求一条自己的边（`AbortSignal.timeout` 到点抛 TimeoutError）。
    const signal = AbortSignal.timeout(Math.max(1, Math.round(timeoutS * 1000)))
    // External undici brands FormData by its own class. Native FormData would
    // otherwise become the literal string "[object FormData]" on the proxy path.
    let body: string | FormData | UndiciFormData = payload instanceof FormData ? payload : JSON.stringify(payload)
    if (payload instanceof FormData && dispatcher !== undefined) {
      const multipart = new UndiciFormData()
      for (const [key, value] of payload.entries()) {
        if (typeof value === 'string') multipart.append(key, value)
        else multipart.append(key, value, value.name)
      }
      body = multipart
    }
    let status: number
    let text: string
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: payload instanceof FormData ? {} : { 'content-type': 'application/json' },
        body,
        signal,
        // proxy 非空 = 每次请求必带 dispatcher（注入的测试 fetch 同样收到 ——
        // 红测拿这一位钉「配了代理就不存在静默直连」）。
        ...(dispatcher === undefined ? {} : { dispatcher }),
      })
      status = response.status
      // `HttpResponse.json()` 是**同步**的（httpx 的形态），所以正文在这里读完。
      // 读正文本身也在同一条超时边下 —— 半截响应不会把调用方挂住。
      text = await response.text()
    } catch (exc) {
      throw sanitizeTransportError(exc) // 原始对象到此为止（token 纪律）
    }
    return {
      status,
      // 解析失败即抛（上层 `bad_response` 路径接住，且不取任何 message）。
      json: () => JSON.parse(text) as unknown,
    }
  }
}
