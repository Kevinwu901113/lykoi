/**
 * 大脑 ↔ 宿主的线协议（WO-M5-ORGAN-BROWSER D-1）。
 *
 * 两个进程：大脑侧插件（`./index.ts`，lykoi 用户）与宿主守护进程
 * （`./host.ts`，lykoi-browser 用户）。它们之间只有一条本地 Unix socket，
 * 上面跑 NDJSON —— 一行一条消息，请求 `{id, op, args}`，响应
 * `{id, ok, data | error}`。
 *
 * 纪律：
 *  - **宿主串行**。第二个并发请求立即回 `busy`，不排队 —— 一双手同一时刻只能
 *    看一个页面，排队会让"她以为自己在看 A，其实在看 B"。
 *  - **宿主不可达不抛**。连接 2s 打不通 → 大脑侧 handler 返回
 *    `browser_host_unreachable`，认知照常往下走（器官是手不是心脏）。
 *  - 本文件**零 I/O、零 env**：只有类型、常量与两个纯编解码函数。
 */

// ============================== 动作 ↔ op ==============================

/** 身体图式里的器官标识（`BodySchemaRegistry.register` 的 organId）。 */
export const ORGAN_ID = 'browser'

/**
 * v1 接真身的三个动作（Kevin 2026-09-02 spec 决断：只读两项 + 一次性调研读页）。
 * 其余六项（browser.click/type/screenshot、research_browser.open/extract_links/
 * screenshot）**保持替身** —— 她要用会落 `capability_gap{not_wired}`，那正是 v2
 * 词汇的输入。
 */
export const ORGAN_ACTIONS = [
  'browser.navigate',
  'browser.get_text',
  'research_browser.read_text',
] as const

export type OrganAction = (typeof ORGAN_ACTIONS)[number]

/** 宿主认识的 op（含 `health`：不动浏览器，只回活着）。 */
export const OPS = ['health', 'navigate', 'get_text', 'research_read_text'] as const

export type HostOp = (typeof OPS)[number]

export const OP_SET: ReadonlySet<string> = new Set(OPS)

/** 动作类型 → 宿主 op。`research_browser.open` **刻意不在表里**（D-2）。 */
export const ACTION_TO_OP: Readonly<Record<OrganAction, HostOp>> = Object.freeze({
  'browser.navigate': 'navigate',
  'browser.get_text': 'get_text',
  'research_browser.read_text': 'research_read_text',
})

// ============================== 消息 ==============================

export interface HostRequest {
  id: string
  op: HostOp
  args: Record<string, unknown>
}

export interface HostResponse {
  id: string
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  /** 出错时的可读细节（域名/原因码；**永不含页面文本、永不含完整 URL**）。 */
  detail?: string
}

// ============================== 错误码 ==============================

/**
 * 全部错误码。大脑侧 handler 把它们**当结果返回**（`{ok:false,error}`）而不是抛
 * —— 红线 #5：被拦下的动作以结果回到她身上。
 */
export const HOST_ERRORS = Object.freeze({
  /** 宿主正在处理另一个请求（串行纪律）。 */
  busy: 'busy',
  /** socket 连不上/宿主没起来。**大脑侧生成**，不来自宿主。 */
  unreachable: 'browser_host_unreachable',
  /** op 超时（宿主自愈：关页/关上下文，不留僵尸）。 */
  timeout: 'timeout',
  /** SSRF/URL 判定拒绝（scheme/端口/IP 字面量/内网地址/被禁主机名）。 */
  blockedUrl: 'blocked_url',
  /** 导航后 final_url 的 eTLD+1 与请求不同 —— 停止加载、不读文本（D-4）。 */
  redirectOffDomain: 'redirect_off_domain',
  /** 参数缺失或畸形（大脑侧就拦下，不打扰宿主）。 */
  badRequest: 'bad_request',
  /** 宿主不认识的 op。 */
  unknownOp: 'unknown_op',
  /** `get_text` 时当前没有页（还没 navigate，或上一次导航被拦下）。 */
  noPage: 'no_page',
  /** 导航本身失败（DNS/连接/协议错）。 */
  navigationFailed: 'navigation_failed',
  /** 宿主内部异常。 */
  internal: 'internal_error',
} as const)

export type HostErrorCode = (typeof HOST_ERRORS)[keyof typeof HOST_ERRORS]

// ============================== 时间预算 ==============================

/** 连接超时（D-1）：2s 打不通就当宿主不可达，大脑侧零阻塞。 */
export const CONNECT_TIMEOUT_MS = 2000

/** op 超时缺省（D-7）。宿主配置可覆盖；大脑侧用它算等回包的上限。 */
export const DEFAULT_TIMEOUTS = Object.freeze({
  navigate: 30_000,
  getText: 15_000,
  research: 45_000,
})

/** 大脑侧等回包 = op 预算 + 这一段余量（宿主自愈也要时间）。 */
export const RESPONSE_GRACE_MS = 5000

/** op → 该 op 的超时字段名。 */
export const OP_TIMEOUT_KEY: Readonly<Record<HostOp, 'navigate' | 'getText' | 'research'>>
  = Object.freeze({
    health: 'getText',
    navigate: 'navigate',
    get_text: 'getText',
    research_read_text: 'research',
  })

// ============================== NDJSON 编解码 ==============================

/** 一条消息 → 一行（含换行符）。消息里出现换行会被 JSON 转义，行永远不撕。 */
export function encodeLine(message: HostRequest | HostResponse): string {
  return JSON.stringify(message) + '\n'
}

/** 一行 → 一条消息；解析不出或不是对象 → null（调用方 fail closed）。 */
export function decodeLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
  return parsed as Record<string, unknown>
}

/**
 * 增量行切分器（socket 数据是流，不是消息）。返回一个把 chunk 喂进去、吐出完整
 * 行的函数。单行上限 `maxLineBytes`：超了就把缓冲清空并报错 —— 不给对端用一行
 * 无限长的 JSON 把宿主内存撑爆的机会。
 */
export function createLineSplitter(
  onLine: (line: string) => void,
  opts: { maxLineBytes?: number; onOverflow?: () => void } = {},
): (chunk: string) => void {
  const maxLineBytes = opts.maxLineBytes ?? 4 * 1024 * 1024
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    let idx = buffer.indexOf('\n')
    while (idx !== -1) {
      const line = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 1)
      onLine(line)
      idx = buffer.indexOf('\n')
    }
    if (buffer.length > maxLineBytes) {
      buffer = ''
      opts.onOverflow?.()
    }
  }
}
