/**
 * lykoi-organ-browser —— 浏览器器官的**大脑侧**（Cordis 插件，跑在 lykoi 用户
 * 进程里；WO-M5-ORGAN-BROWSER D-1/D-6/D-9）。
 *
 * 这一半不碰 Chrome，一行都不。它只做四件事：
 *  1. 把三个动作 `browser.navigate` / `browser.get_text` /
 *     `research_browser.read_text` 的真身 handler 挂上 `registerOrganHandler`；
 *  2. 向身体图式 `BodySchemaRegistry` 登记 organ `browser`（注册即感知）；
 *  3. 每个动作经本地 Unix socket 发一行 NDJSON 给宿主，等一行回来；
 *  4. 落一条 `browser_action{op, domain, status, chars, duration_ms, truncated}`
 *     审计摘要 —— **不落页面文本、不落完整 URL**（只落 eTLD+1）。
 *
 * 三条纪律，全部是"她的体验"而不是"进程的方便"：
 *  - **不抛**。宿主没起来、被拦下、超时，一律以 `{ok:false, error}` 回到她身上
 *    （红线 #5）；抛错会变成 `Observation.success=false` 的一团黑，她读不出发生
 *    了什么。
 *  - **不阻塞**。连接 2s 打不通就是 `browser_host_unreachable`，认知继续走。
 *  - **卸载即消失**。dispose 先摘图式再摘 handler，替身归位 —— 没有幻肢
 *    （`docs/m3_schema_registry.md` GK-11）。
 *
 * 零 env（GK-6）：唯一配置是 yml 给的 `socketPath`。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { connect, type Socket } from 'node:net'
import type { AuditService } from 'lykoi-audit'
import { BodySchemaRegistry, KNOWN_ACTION_LIST, registeredDomain } from 'lykoi-kernel'
import { registerOrganHandler } from 'lykoi-adapter-telegram/resources'
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

/**
 * 接线：三个 handler 上身 + 身体图式登记。返回**注销器**（谁注册谁负责注销）。
 *
 * 顺序刻意：先图式后 handler，卸载时反过来 —— 任一时刻"图式里有"都蕴含
 * "handler 接得通"，反过来的那半拍才是幻肢。
 */
export function wireBrowserOrgan(
  client: BrowserHostClient,
  logEvent: OrganLogEvent,
  schema: BodySchemaRegistry,
): () => void {
  const disposeSchema = schema.register({
    organId: ORGAN_ID,
    actions: [...ORGAN_ACTIONS],
    // 大脑侧这一半没有任何副作用：Chrome、profile、截图全在宿主进程里。
    sideEffects: [],
  })
  for (const action of ORGAN_ACTIONS) {
    registerOrganHandler(action, createOrganHandler(action, client, logEvent))
  }
  let disposed = false
  return () => {
    if (disposed) return
    disposed = true
    disposeSchema()
    for (const action of ORGAN_ACTIONS) registerOrganHandler(action, null)
  }
}

// ============================== Cordis 插件 ==============================

declare module '@deepseek-ai/cordis' {
  interface Context {
    bodySchema: BodySchemaRegistry
  }
}

export const name = 'lykoi-organ-browser'
export const inject = ['audit']

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

  // 装配里还没有身体图式的生产实例（`registryActionCatalog` 零消费者，切换归
  // M5 总盘，m4_handoff §E 明令不由本单做）——那就由这里建一个挂上去，后来者
  // 复用同一张图式。**本单不切 catalog。**
  let schema = ctx.get('bodySchema') as BodySchemaRegistry | undefined
  if (schema === undefined) {
    schema = new BodySchemaRegistry({ vocabulary: KNOWN_ACTION_LIST })
    ctx.provide('bodySchema', schema)
  }

  const unwire = wireBrowserOrgan(client, logEvent, schema)
  ctx.effect(() => () => unwire(), 'lykoi-organ-browser handlers')
  logEvent('browser_organ_wired', {
    organ: ORGAN_ID, actions: [...ORGAN_ACTIONS], socket_path: config.socketPath,
  })
}
