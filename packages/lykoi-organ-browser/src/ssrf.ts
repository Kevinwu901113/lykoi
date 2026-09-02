/**
 * SSRF / URL 判定器（WO-M5-ORGAN-BROWSER D-5 第一道，白皮书 §24）。
 *
 * **纯函数模块**：除了注入进来的解析器，本文件没有任何 I/O、没有 env、没有全局
 * 状态。解析器经构造函数注入（`new SsrfGuard({ resolve })`），生产构造用
 * `nodeLookupResolver()`（真 `dns.lookup(host,{all:true})`），测试注入自己的表。
 * **配置面（yml / host.json）没有任何一条路径能换掉它** —— 换判定器只能改源码，
 * 于是它跟着 manifest 一起被 root 签。
 *
 * fail closed 的方向在本文件里只有一个：**判不准就拒**。URL 解析不出来拒、
 * 解析器抛拒、解析出零个地址拒、地址串解析不成 IP 也拒。
 *
 * 判定不只在顶层导航：`context.route('**')` 对每个子请求与每一跳重定向调同一个
 * `check()`（driver.ts），不过就 abort。配了代理照样先判 —— 代理不是豁免。
 */

// ============================== 拒绝原因 ==============================

export const SSRF_REASONS = Object.freeze({
  /** URL 根本解析不出来。 */
  malformedUrl: 'malformed_url',
  /** scheme 不是 http/https（blob: data: file: javascript: ftp: … 全在这里落地）。 */
  schemeNotAllowed: 'scheme_not_allowed',
  /** 端口不是 80/443 也不是省略。 */
  portNotAllowed: 'port_not_allowed',
  /** 主机是 IP 字面量（v4 或 v6）—— v1 一律拒，不管它是不是公网地址。 */
  ipLiteral: 'ip_literal',
  /** 主机名在禁表：localhost / *.localhost / *.local / *.internal / *.home.arpa。 */
  blockedHostname: 'blocked_hostname',
  /** 单标签主机名（`intranet`、`router`）—— 内网名字的典型形态。 */
  singleLabelHost: 'single_label_host',
  /** 解析器抛了。 */
  resolveFailed: 'resolve_failed',
  /** 解析出零个地址。 */
  noAddress: 'no_address',
  /** 解析出的地址里有一个落在内网/保留段（DNS rebinding 形态在这里被挡）。 */
  privateAddress: 'private_address',
} as const)

export type SsrfReason = (typeof SSRF_REASONS)[keyof typeof SSRF_REASONS]

// ============================== IP 解析 ==============================

/**
 * 严格点分十进制 → 四字节；不是就 null。
 * **前导零一律拒**（`010.0.0.1` 在不同解析器里是 8.0.0.1 还是 10.0.0.1 说不准，
 * 说不准就拒）。
 */
export function parseIpv4(text: string): number[] | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null
    if (part.length > 1 && part.startsWith('0')) return null
    const value = Number(part)
    if (value > 255) return null
    out.push(value)
  }
  return out
}

/** IPv6 文本 → 十六字节；不是就 null。支持 `::` 压缩与内嵌 v4 尾巴。 */
export function parseIpv6(text: string): number[] | null {
  let body = text.trim().toLowerCase()
  if (body.startsWith('[') && body.endsWith(']')) body = body.slice(1, -1)
  // zone id（fe80::1%eth0）：截掉再判 —— 带 zone 的一定是链路本地，下面照样拒。
  const percent = body.indexOf('%')
  if (percent !== -1) body = body.slice(0, percent)
  if (!body.includes(':')) return null

  const doubleColon = body.indexOf('::')
  if (doubleColon !== -1 && body.indexOf('::', doubleColon + 1) !== -1) return null

  const expand = (chunk: string): string[] => (chunk === '' ? [] : chunk.split(':'))
  let head: string[]
  let tail: string[]
  if (doubleColon === -1) {
    head = expand(body)
    tail = []
  } else {
    head = expand(body.slice(0, doubleColon))
    tail = expand(body.slice(doubleColon + 2))
  }

  const bytes: number[] = []
  const pushGroups = (groups: string[], into: number[]): boolean => {
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i]!
      const isLast = i === groups.length - 1
      if (isLast && group.includes('.')) {
        const v4 = parseIpv4(group)
        if (v4 === null) return false
        into.push(...v4)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return false
      const value = Number.parseInt(group, 16)
      into.push((value >> 8) & 0xff, value & 0xff)
    }
    return true
  }

  const headBytes: number[] = []
  const tailBytes: number[] = []
  if (!pushGroups(head, headBytes)) return null
  if (!pushGroups(tail, tailBytes)) return null
  const fill = 16 - headBytes.length - tailBytes.length
  if (doubleColon === -1) {
    if (fill !== 0) return null
  } else if (fill < 0) {
    return null
  }
  bytes.push(...headBytes)
  for (let i = 0; i < Math.max(fill, 0); i += 1) bytes.push(0)
  bytes.push(...tailBytes)
  return bytes.length === 16 ? bytes : null
}

/**
 * 四字节地址在不在禁段（D-5 第一道逐条）：
 * `0.0.0.0/8`、`10/8`、`100.64/10`、`127/8`、`169.254/16`、`172.16/12`、
 * `192.168/16`、`224/4`、`240/4`、`255.255.255.255`。
 * （最后三条合并成 `a >= 224`：224/4 = 224–239，240/4 = 240–255，广播地址在
 * 240/4 里面。）
 */
export function isBlockedIpv4(bytes: readonly number[]): boolean {
  const [a, b] = bytes as [number, number, number, number]
  if (a === 0) return true
  if (a === 10) return true
  if (a === 127) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  if (a === 169 && b === 254) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a >= 224) return true
  return false
}

/**
 * 十六字节地址在不在禁段：`::`、`::1`、`fc00::/7`、`fe80::/10`、`ff00::/8`；
 * IPv4-mapped（`::ffff:a.b.c.d`）/ IPv4-compatible / 6to4（`2002::/16`）/
 * Teredo（`2001:0::/32`）取内嵌 v4 再按 v4 判。
 */
export function isBlockedIpv6(bytes: readonly number[]): boolean {
  const allZero = bytes.every((byte) => byte === 0)
  if (allZero) return true // ::
  const isLoopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1
  if (isLoopback) return true // ::1
  if ((bytes[0]! & 0xfe) === 0xfc) return true // fc00::/7
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true // fe80::/10
  if (bytes[0] === 0xff) return true // ff00::/8

  const embedded = embeddedIpv4(bytes)
  if (embedded !== null) return isBlockedIpv4(embedded)
  return false
}

/** IPv4-mapped / IPv4-compatible / 6to4 / Teredo 里那四个字节，没有就 null。 */
export function embeddedIpv4(bytes: readonly number[]): number[] | null {
  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0)
  // ::ffff:a.b.c.d（IPv4-mapped）
  if (firstTenZero && bytes[10] === 0xff && bytes[11] === 0xff) return bytes.slice(12, 16)
  // ::a.b.c.d（IPv4-compatible，已废弃但解析器仍认）
  if (firstTenZero && bytes[10] === 0 && bytes[11] === 0) return bytes.slice(12, 16)
  // 2002:a.b.c.d::/16（6to4）
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return bytes.slice(2, 6)
  // 2001:0000:a.b.c.d（Teredo：内嵌 v4 在末四字节，按位取反存放）
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) {
    return bytes.slice(12, 16).map((byte) => byte ^ 0xff)
  }
  return null
}

/** 一个地址串该不该拒。**解析不出来 = 拒**（fail closed）。 */
export function isBlockedAddress(address: string): boolean {
  const text = (address ?? '').trim()
  if (!text) return true
  const v4 = parseIpv4(text)
  if (v4 !== null) return isBlockedIpv4(v4)
  const v6 = parseIpv6(text)
  if (v6 !== null) return isBlockedIpv6(v6)
  return true
}

// ============================== 主机名 ==============================

/** 是不是 IP 字面量（v4 或 v6，含方括号形态）。 */
export function isIpLiteral(host: string): boolean {
  const text = (host ?? '').trim()
  if (!text) return false
  if (parseIpv4(text) !== null) return true
  if (text.includes(':')) return true // 裸 v6 或 [v6]：URL 里冒号只可能是 v6
  return false
}

/** 主机名禁表（D-5）：`localhost` / `*.localhost` / `*.local` / `*.internal` / `*.home.arpa`。 */
export const BLOCKED_HOST_SUFFIXES: readonly string[] = Object.freeze([
  'localhost', 'local', 'internal', 'home.arpa',
])

/** 归一：小写、去尾点。 */
export function normalizeHost(host: string): string {
  return (host ?? '').trim().toLowerCase().replace(/\.+$/, '')
}

export function isBlockedHostname(host: string): boolean {
  const normalized = normalizeHost(host)
  if (!normalized) return true
  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (normalized === suffix || normalized.endsWith('.' + suffix)) return true
  }
  return false
}

/** 单标签主机名（没有点）—— 内网短名的典型形态，一律拒。 */
export function isSingleLabelHost(host: string): boolean {
  return !normalizeHost(host).includes('.')
}

// ============================== 语法判定（不碰 DNS） ==============================

export interface UrlInspection {
  ok: boolean
  reason: SsrfReason | null
  /** 归一后的主机名（判不出来时为空串）。 */
  host: string
  scheme: string
}

export const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])
export const ALLOWED_PORTS: ReadonlySet<string> = new Set(['', '80', '443'])

/**
 * 只看 URL 本身的四条：能不能解析 / scheme / 端口 / 主机形态。
 * **不做 DNS**，所以它是同步纯函数，红测可以逐条钉。
 */
export function inspectUrl(raw: string): UrlInspection {
  const fail = (reason: SsrfReason, host = '', scheme = ''): UrlInspection =>
    ({ ok: false, reason, host, scheme })
  if (typeof raw !== 'string' || !raw.trim()) return fail(SSRF_REASONS.malformedUrl)
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return fail(SSRF_REASONS.malformedUrl)
  }
  const scheme = parsed.protocol.toLowerCase()
  if (!ALLOWED_SCHEMES.has(scheme)) return fail(SSRF_REASONS.schemeNotAllowed, '', scheme)
  if (!ALLOWED_PORTS.has(parsed.port)) return fail(SSRF_REASONS.portNotAllowed, '', scheme)
  let host = parsed.hostname
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  host = normalizeHost(host)
  if (!host) return fail(SSRF_REASONS.malformedUrl, '', scheme)
  if (isIpLiteral(host)) return fail(SSRF_REASONS.ipLiteral, host, scheme)
  if (isBlockedHostname(host)) return fail(SSRF_REASONS.blockedHostname, host, scheme)
  if (isSingleLabelHost(host)) return fail(SSRF_REASONS.singleLabelHost, host, scheme)
  return { ok: true, reason: null, host, scheme }
}

// ============================== 判定器 ==============================

/** 主机名 → 地址串列表。生产是 `dns.lookup(host,{all:true})`，测试注入表。 */
export type AddressResolver = (hostname: string) => Promise<readonly string[]>

export interface SsrfVerdict {
  allowed: boolean
  reason: SsrfReason | null
  host: string
  addresses: readonly string[]
}

export interface SsrfGuardLike {
  check(rawUrl: string): Promise<SsrfVerdict>
}

/**
 * 语法四条 + DNS 全地址逐个判。任一命中即拒。
 *
 * "公网主机名解析到私网地址"（DNS rebinding 形态）在这里被挡：语法四条全过、
 * 域名看起来人畜无害，但解析结果落在 `169.254.169.254` / `10/8` 里 → 拒。
 */
export class SsrfGuard implements SsrfGuardLike {
  #resolve: AddressResolver

  constructor(opts: { resolve: AddressResolver }) {
    if (typeof opts?.resolve !== 'function') {
      throw new TypeError('SsrfGuard: resolve 解析器必须经构造函数注入')
    }
    this.#resolve = opts.resolve
  }

  async check(rawUrl: string): Promise<SsrfVerdict> {
    const inspection = inspectUrl(rawUrl)
    if (!inspection.ok) {
      return { allowed: false, reason: inspection.reason, host: inspection.host, addresses: [] }
    }
    let addresses: readonly string[]
    try {
      addresses = await this.#resolve(inspection.host)
    } catch {
      return {
        allowed: false, reason: SSRF_REASONS.resolveFailed, host: inspection.host, addresses: [],
      }
    }
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return {
        allowed: false, reason: SSRF_REASONS.noAddress, host: inspection.host, addresses: [],
      }
    }
    for (const address of addresses) {
      if (isBlockedAddress(address)) {
        return {
          allowed: false,
          reason: SSRF_REASONS.privateAddress,
          host: inspection.host,
          addresses,
        }
      }
    }
    return { allowed: true, reason: null, host: inspection.host, addresses }
  }
}

/**
 * 生产解析器：真 `dns.lookup(host,{all:true})`。
 *
 * 用 lookup 而不是 resolve4/resolve6 是刻意的 —— 它走的是**浏览器等下真的会走
 * 的那条路**（/etc/hosts、nsswitch、系统解析器），于是"判定看到的地址"与
 * "Chrome 连出去的地址"是同一批。
 */
export function nodeLookupResolver(): AddressResolver {
  return async (hostname: string) => {
    const dns = await import('node:dns/promises')
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    return records.map((record) => record.address)
  }
}
