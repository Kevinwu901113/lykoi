/**
 * Bot API 的 HTTP 那一跳（M4 前置 #8：真 `fetch` 接线）。
 *
 * W3 把这一跳做成注入 seam（`HttpPost`），本文件是**唯一**一个指向真网的实现。
 * 它只在生产装配面被选中（`./production` 的 `apply`）—— 测试永远注 fake，所以
 * 「零真网」在测试面依然成立，不是靠自觉，是靠没有别的实现可选。
 *
 * 四件事逐条钉死（前置 #8 的四样）：
 *
 * ①**真 fetch**：Node 24 内建 `fetch`（undici）。不引第三方 HTTP 客户端 ——
 *   冻结期不动 lock，也不给传输层加一个新的信任面。
 *
 * ②**超时**：每一次请求一条 `AbortSignal` 边（`timeoutS`）。撞线 = 那一跳真的
 *   断，抛 `TimeoutError`（歧义类 → 上层按"可能已投递"处理并重试，见 transport.ts
 *   文件头的取舍）。没有边的 HTTP 调用会把一次长轮询变成一次永久挂起。
 *
 * ③**`trust_env=false` 等价**：Node 内建 fetch **默认就不读** `HTTP(S)_PROXY`
 *   —— 只有显式 `NODE_USE_ENV_PROXY=1` 或调用 `http.setGlobalProxyFromEnv()`
 *   才会改道。本包两样都不做（红测扫源码钉死），于是「环境里的代理变量不许
 *   悄悄改道一条 URL 里带着 token 的请求」这件事在新体是**默认成立**的。
 *   本文件**零 env 读取**：一个 `process.env` 都没有（红测钉死）。
 *
 * ④**代理**：不支持，而且是**大声不支持**。Node 内建 fetch 要走代理只有 env
 *   一条路（`ProxyAgent` 不在任何公开模块里导出），而 env 那条路正是 GK-6 判定
 *   为"外泄通道"、生产必须未设的东西。所以配了代理 = 构造期就抛，绝不退化成
 *   一次静默的直连 —— 「以为走了代理，其实是裸奔」是最坏的失败模式。
 *   生产是否真的需要出网代理，属于部署面（W2）的事，见 W1 报告。
 *
 * **token 纪律**（本文件最硬的一条）：请求 URL 里含 bot token。所以这里
 * **绝不让任何原始异常逃出去** —— fetch 的失败对象（及其 `cause`）可能把
 * 请求 URL 嵌进字符串形态，一次 `String(exc)` 落日志就等于把 token 写进了
 * 磁盘。出口只有一种形状：一个 `name` = 类别、`message` = 固定文案的干净
 * Error（`sanitizeTransportError`），红测逐字节核它不含 token。
 */
import type { HttpPost, HttpResponse } from './transport.ts'

/** `fetch` 的最小面（生产用内建 fetch；测试注 fake，签名不必更宽）。 */
export type FetchLike = (url: string, init: {
  method: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
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
 * 造一个真网 `HttpPost`。
 *
 * `proxy` 非空 = 构造期抛（见文件头④：不静默退化成直连）。
 * `fetch` 可注入 —— 红测拿它验证「超时形态 / token 不外泄 / 零 env」，生产
 * 缺省是 Node 内建 fetch。
 */
export function createFetchHttpPost(options: {
  fetch?: FetchLike
  proxy?: string
  defaultTimeoutS?: number
} = {}): HttpPost {
  const proxy = (options.proxy ?? '').trim()
  if (proxy !== '') {
    // 措辞不含代理地址本身（它可能带凭据）。
    throw new Error(
      'lykoi-adapter-telegram: proxied egress is not implemented — Node built-in fetch '
      + 'can only be proxied through environment variables, and those are exactly what '
      + 'GK-6 pins as unset. Settle egress at the deployment layer (M4-W2).',
    )
  }
  const doFetch = options.fetch ?? (globalThis.fetch as unknown as FetchLike)
  const fallbackTimeoutS = options.defaultTimeoutS ?? DEFAULT_HTTP_TIMEOUT_S

  return async function post(url, payload, opts): Promise<HttpResponse> {
    const timeoutS = opts.timeoutS ?? fallbackTimeoutS
    // 每次请求一条自己的边（`AbortSignal.timeout` 到点抛 TimeoutError）。
    const signal = AbortSignal.timeout(Math.max(1, Math.round(timeoutS * 1000)))
    let status: number
    let text: string
    try {
      const response = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
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
