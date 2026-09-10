/** Browser's Runtime plugin: register local-socket handlers for the lifetime of this fiber.
 * The host owns Chrome and browser data; Runtime owns capability presence and its body schema.
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { connect, type Socket } from 'node:net'
import type { AuditService } from 'lykoi-audit'
import { registeredDomain } from 'lykoi-kernel'
import type { RuntimeService } from 'lykoi-contracts'
import {
  ACTION_TO_OP, CONNECT_TIMEOUT_MS, DEFAULT_TIMEOUTS, HOST_ERRORS, OP_TIMEOUT_KEY,
  ORGAN_ACTIONS, ORGAN_ID, RESPONSE_GRACE_MS, createLineSplitter, decodeLine, encodeLine,
  type HostOp, type OrganAction,
} from './protocol.ts'

export * from './protocol.ts'
export * from './untrusted.ts'

// ============================== 客户端 ==============================

/** 一次调用的结果：与宿主响应同形，`ok:false` 时永远带 `error`。 */
export interface CallResult {
  ok: boolean
  data?: Record<string, unknown>
  error?: string
  detail?: string
}

export interface HostClientOptions {
  socketPath: string
  /** 等回包的上限（缺省 = op 预算 + RESPONSE_GRACE_MS）。测试用。 */
  timeouts?: { navigate: number; getText: number; research: number }
  connectTimeoutMs?: number
}

/**
 * 宿主客户端：**每次调用开一条连接，用完就关**。
 *
 * 不做连接池，是因为宿主本来就串行 —— 池子只会把"第二个请求"藏在大脑侧排队，
 * 而 D-1 要的恰恰是让它以 `busy` 立刻回到她身上。
 */
export class BrowserHostClient {
  #socketPath: string
  #timeouts: { navigate: number; getText: number; research: number }
  #connectTimeoutMs: number
  #seq = 0

  constructor(opts: HostClientOptions) {
    this.#socketPath = opts.socketPath
    this.#timeouts = opts.timeouts ?? { ...DEFAULT_TIMEOUTS }
    this.#connectTimeoutMs = opts.connectTimeoutMs ?? CONNECT_TIMEOUT_MS
  }

  get socketPath(): string {
    return this.#socketPath
  }

  /** 发一个 op，等一行回来。**永不抛** —— 任何故障都变成 `{ok:false,error}`。 */
  call(op: HostOp, args: Record<string, unknown> = {}): Promise<CallResult> {
    const id = `${process.pid}-${++this.#seq}`
    const budget = this.#timeouts[OP_TIMEOUT_KEY[op]] + RESPONSE_GRACE_MS
    return new Promise<CallResult>((resolve) => {
      let settled = false
      let socket: Socket | null = null
      let connectTimer: ReturnType<typeof setTimeout> | null = null
      let responseTimer: ReturnType<typeof setTimeout> | null = null

      const finish = (result: CallResult): void => {
        if (settled) return
        settled = true
        if (connectTimer !== null) clearTimeout(connectTimer)
        if (responseTimer !== null) clearTimeout(responseTimer)
        socket?.destroy()
        resolve(result)
      }

      try {
        socket = connect(this.#socketPath)
      } catch (exc) {
        finish({ ok: false, error: HOST_ERRORS.unreachable, detail: errorText(exc) })
        return
      }
      socket.setEncoding('utf8')

      // 连接超时与回包超时是两段：前者说"宿主不在"，后者说"宿主在但没回话"。
      connectTimer = setTimeout(() => {
        finish({ ok: false, error: HOST_ERRORS.unreachable, detail: 'connect timeout' })
      }, this.#connectTimeoutMs)

      socket.on('error', (err) => {
        finish({ ok: false, error: HOST_ERRORS.unreachable, detail: errorText(err) })
      })
      socket.on('close', () => {
        finish({ ok: false, error: HOST_ERRORS.unreachable, detail: 'socket closed' })
      })
      socket.on('connect', () => {
        if (connectTimer !== null) clearTimeout(connectTimer)
        connectTimer = null
        responseTimer = setTimeout(() => {
          finish({ ok: false, error: HOST_ERRORS.timeout, detail: 'no response' })
        }, budget)
        socket?.write(encodeLine({ id, op, args }))
      })
      const feed = createLineSplitter((line) => {
        const parsed = decodeLine(line)
        if (parsed === null) {
          finish({ ok: false, error: HOST_ERRORS.internal, detail: '宿主回了非法行' })
          return
        }
        // id 对不上就丢掉：一条连接一个请求，对不上的行不是我的回包。
        if (typeof parsed.id === 'string' && parsed.id !== '' && parsed.id !== id) return
        finish({
          ok: parsed.ok === true,
          data: (typeof parsed.data === 'object' && parsed.data !== null && !Array.isArray(parsed.data))
            ? parsed.data as Record<string, unknown>
            : undefined,
          error: typeof parsed.error === 'string' ? parsed.error : undefined,
          detail: typeof parsed.detail === 'string' ? parsed.detail : undefined,
        })
      })
      socket.on('data', (chunk) => feed(String(chunk)))
    })
  }
}

function errorText(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

// ============================== 动作 handler ==============================

export type OrganLogEvent = (name: string, fields: Record<string, unknown>) => void

/** 只落 eTLD+1，永不落完整 URL（D-6）。取不出来就 `unknown`。 */
export function auditDomain(rawUrl: unknown): string {
  if (typeof rawUrl !== 'string' || rawUrl === '') return 'unknown'
  try {
    return registeredDomain(new URL(rawUrl).hostname) || 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 动作参数 → 宿主 args。大脑侧只搬运，判定全在宿主（单一事实源）。 */
function toArgs(action: OrganAction, params: Record<string, unknown>): Record<string, unknown> {
  if (action === 'browser.get_text') {
    return params.max_chars === undefined ? {} : { max_chars: params.max_chars }
  }
  const args: Record<string, unknown> = { url: params.url }
  if (action === 'research_browser.read_text' && params.max_chars !== undefined) {
    args.max_chars = params.max_chars
  }
  return args
}

/**
 * 造一个动作的真身 handler。
 *
 * 返回值形状：成功 `{ok:true, ...宿主 data}`（`_executeDecision` 会把它整个包成
 * `Observation.data`，于是 reflow 的 explore 读得到 `observation.data.text`）；
 * 失败 `{ok:false, error, detail?}`。两条路都是**返回**，不是抛。
 */
export function createOrganHandler(
  action: OrganAction,
  client: BrowserHostClient,
  logEvent: OrganLogEvent,
): (params: Record<string, unknown>) => Promise<Record<string, unknown>> {
  const op = ACTION_TO_OP[action]
  return async (params: Record<string, unknown> = {}) => {
    const started = Date.now()
    const needsUrl = action !== 'browser.get_text'
    const url = params.url
    if (needsUrl && (typeof url !== 'string' || url.trim() === '')) {
      logEvent('browser_action', {
        op, domain: 'unknown', status: HOST_ERRORS.badRequest,
        chars: 0, duration_ms: Date.now() - started, truncated: false,
      })
      return { ok: false, error: HOST_ERRORS.badRequest, detail: 'url 必填' }
    }
    const result = await client.call(op, toArgs(action, params))
    const data = result.data ?? {}
    logEvent('browser_action', {
      op,
      // get_text 没带 url —— 用宿主回的 final_url 算域（同样只到 eTLD+1）。
      domain: auditDomain(needsUrl ? url : (data.final_url ?? data.url)),
      status: result.ok ? 'ok' : (result.error ?? HOST_ERRORS.internal),
      chars: typeof data.chars === 'number' ? data.chars : 0,
      duration_ms: Date.now() - started,
      truncated: data.truncated === true,
    })
    if (!result.ok) {
      return { ok: false, error: result.error ?? HOST_ERRORS.internal, detail: result.detail }
    }
    return { ok: true, ...data }
  }
}

/** Register handlers and their body schema as one Runtime-owned lifetime. */
export function wireBrowserOrgan(
  client: BrowserHostClient,
  logEvent: OrganLogEvent,
  runtime: RuntimeService,
): () => void {
  return runtime.register({
    organId: ORGAN_ID,
    capabilities: ORGAN_ACTIONS.map(action => ({
      name: action,
      description: action === 'browser.navigate' ? 'Open a URL in the persistent browser.' : action === 'browser.get_text' ? 'Read the current browser page after navigating.' : 'Read a URL in an isolated research browser.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, max_chars: { type: 'integer', minimum: 1 } },
        required: action === 'browser.get_text' ? [] : ['url'], additionalProperties: false },
      handler: createOrganHandler(action, client, logEvent),
    })),
    sideEffects: [],
  })
}

export const name = 'lykoi-organ-browser'
export const inject = ['audit', 'lykoiRuntime']

export interface Config {
  /** 宿主 Unix socket（生产 `/run/lykoi-browser/host.sock`）。大脑侧只有这一项。 */
  socketPath: string
}

export const Config: Schema<Config> = Schema.object({
  socketPath: Schema.string().default('/run/lykoi-browser/host.sock'),
})

export function apply(ctx: Context, config: Config) {
  const audit = ctx.audit as AuditService
  const logEvent: OrganLogEvent = (type, fields) => {
    audit.record({ type, channel: 'telemetry', ...fields }).catch((err: unknown) => {
      ctx.logger.error('lykoi-organ-browser: audit record failed: %s', String(err))
    })
  }
  const client = new BrowserHostClient({ socketPath: config.socketPath })

  ctx.effect(() => wireBrowserOrgan(client, logEvent, ctx.lykoiRuntime), 'browser capabilities')
  logEvent('browser_organ_wired', {
    organ: ORGAN_ID, actions: [...ORGAN_ACTIONS], socket_path: config.socketPath,
  })
}
