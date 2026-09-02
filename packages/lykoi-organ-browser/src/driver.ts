/**
 * 器官驱动层（WO-M5-ORGAN-BROWSER D-2/D-3/D-4/D-5/D-6）。
 *
 * 两层刻意分开：
 *  - `BrowserBackend` / `BackendContext` / `BackendPage` —— **纯抽象**，描述
 *    "一个浏览器能做的四件事"（导航、读 URL/标题、取正文、截图）。
 *  - `BrowserOrganDriver` —— **全部策略住在这里**：SSRF 判定（顶层 + 每个子
 *    请求）、跳转出域中止、下载取消、不可信包装、文本上限、超时与自愈、截图落盘。
 *
 * 分开的理由不是好看：策略是本单的安全面，它必须在**没有 Chrome 的机器上**也能
 * 被红测钉住。假 backend 实现同一组接口，redirect / download / isolation 三个
 * 测试于是不需要真浏览器。
 *
 * `PlaywrightBackend` 是唯一碰 playwright-core 的地方（文件末尾）。
 */
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { registeredDomain } from 'lykoi-kernel'
import { HOST_ERRORS, type HostOp } from './protocol.ts'
import type { SsrfGuardLike } from './ssrf.ts'
import { DEFAULT_MAX_CHARS, clampMaxChars, wrapUntrusted } from './untrusted.ts'

// ============================== backend 抽象 ==============================

export interface BackendPage {
  /** 导航到 url；超时由调用方与 backend 双管（backend 自带的更早触发更好）。 */
  goto(url: string, timeoutMs: number): Promise<void>
  /** 当前地址（跳转之后的那个）。 */
  currentUrl(): string
  title(): Promise<string>
  /** `document.body.innerText`（脚本/样式天然不在里面）。 */
  bodyText(timeoutMs: number): Promise<string>
  screenshot(absolutePath: string): Promise<void>
  close(): Promise<void>
}

export interface BackendContext {
  page(): Promise<BackendPage>
  /** 子请求与每一跳重定向的判定钩子：返回 false 即 abort。 */
  setRequestFilter(filter: (url: string) => Promise<boolean>): Promise<void>
  /** 下载拦截钩子：一律 cancel，只留一条审计。 */
  setDownloadHandler(
    handler: (info: { url: string; suggestedName: string }) => void,
  ): Promise<void>
  close(): Promise<void>
  readonly closed: boolean
}

export interface BrowserBackend {
  /** 持久上下文（有登录态；单 tab）。同一个进程里复用。 */
  persistent(): Promise<BackendContext>
  /** 一次性上下文：与持久上下文**零共享** cookies / storage / cache。 */
  ephemeral(): Promise<BackendContext>
  shutdown(): Promise<void>
}

// ============================== 出域判定（纯函数） ==============================

/** URL → 主机名；解析不出来返回空串。 */
export function hostOf(url: string): string {
  try {
    const parsed = new URL(url)
    const host = parsed.hostname
    return host.startsWith('[') && host.endsWith(']')
      ? host.slice(1, -1).toLowerCase()
      : host.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * D-4：请求 URL 与 final_url 的 eTLD+1 不同 = 出域。
 *
 * eTLD+1 直接用 kernel 的 `registeredDomain`（`lykoi-kernel/src/scope.ts`）——
 * 与审批门算 `domain:<eTLD+1>` scope key 用的是**同一个切分器**。两处各写一份
 * 的那天，就是"批准的域"和"器官认的域"开始分叉的那天。
 *
 * `www.` 前缀差异天然不算出域（`www.example.com` 与 `example.com` 的 eTLD+1
 * 都是 `example.com`）。判不出来（空主机名）**算出域**（fail closed）。
 */
export function isOffDomain(requestedUrl: string, finalUrl: string): boolean {
  const from = registeredDomain(hostOf(requestedUrl))
  const to = registeredDomain(hostOf(finalUrl))
  if (!from || !to) return true
  return from !== to
}

/** 只给审计用的域名（**永不落完整 URL**，D-6）。 */
export function domainOf(url: string): string {
  return registeredDomain(hostOf(url))
}

// ============================== 截图路径 ==============================

function twoDigits(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/**
 * `shots/YYYYMMDD/<ts>-<op>.png`（相对 dataDir）。按天分目录是为了滚动删除能
 * 整目录扔，不用逐文件读 mtime。
 */
export function shotRelPath(op: string, now: Date): string {
  const day = `${now.getUTCFullYear()}${twoDigits(now.getUTCMonth() + 1)}${twoDigits(now.getUTCDate())}`
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return join('shots', day, `${stamp}-${op}.png`)
}

// ============================== 驱动 ==============================

export type OpResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string; detail?: string }

export type DriverEmit = (name: string, fields: Record<string, unknown>) => void

export interface DriverTimeouts {
  navigate: number
  getText: number
  research: number
}

export interface BrowserOrganDriverOptions {
  backend: BrowserBackend
  guard: SsrfGuardLike
  /** 截图落这里（`<dataDir>/shots/...`）。空串 = 不截图（测试用）。 */
  dataDir: string
  maxChars?: number
  timeouts: DriverTimeouts
  emit?: DriverEmit
  now?: () => Date
}

class DeadlineError extends Error {}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  // 输的那一边稍后再 reject 时不许变成 unhandled rejection。
  promise.catch(() => {})
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DeadlineError('deadline')), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function errorText(exc: unknown): string {
  return exc instanceof Error ? exc.message : String(exc)
}

/**
 * 三个动作的真身。每个方法都返回 `OpResult` —— **从不抛**：被拦下的动作要以
 * 结果回到她身上（红线 #5），异常只在宿主自己的日志里。
 */
export class BrowserOrganDriver {
  #backend: BrowserBackend
  #guard: SsrfGuardLike
  #dataDir: string
  #maxChars: number
  #timeouts: DriverTimeouts
  #emit: DriverEmit
  #now: () => Date
  #persistentContext: BackendContext | null = null
  #persistentPage: BackendPage | null = null

  constructor(opts: BrowserOrganDriverOptions) {
    this.#backend = opts.backend
    this.#guard = opts.guard
    this.#dataDir = opts.dataDir
    this.#maxChars = clampMaxChars(opts.maxChars, DEFAULT_MAX_CHARS)
    this.#timeouts = opts.timeouts
    this.#emit = opts.emit ?? (() => {})
    this.#now = opts.now ?? (() => new Date())
  }

  // --- 上下文装配（两个上下文共用同一套钩子） ---

  async #arm(context: BackendContext, op: HostOp): Promise<void> {
    // D-5①：判定不只在顶层导航 —— 每个子请求与每一跳重定向同样判定，不过就 abort。
    await context.setRequestFilter(async (url) => {
      const verdict = await this.#guard.check(url)
      if (!verdict.allowed) {
        this.#emit('browser_subrequest_blocked', {
          op, reason: verdict.reason, domain: domainOf(url),
        })
      }
      return verdict.allowed
    })
    // D-5②：下载一律取消，只留审计（不落文件名、只落长度）。
    await context.setDownloadHandler((info) => {
      this.#emit('browser_download_blocked', {
        url_domain: domainOf(info.url),
        suggested_name_len: (info.suggestedName ?? '').length,
      })
    })
  }

  async #ensurePersistent(): Promise<BackendPage> {
    if (this.#persistentContext === null || this.#persistentContext.closed) {
      this.#persistentContext = await this.#backend.persistent()
      this.#persistentPage = null
      await this.#arm(this.#persistentContext, 'navigate')
    }
    if (this.#persistentPage === null) {
      this.#persistentPage = await this.#persistentContext.page()
    }
    return this.#persistentPage
  }

  /** 自愈：把当前页扔掉（超时/出域之后不留一个半死的 tab）。登录态在 profile 里，不受影响。 */
  async #dropPersistentPage(): Promise<void> {
    const page = this.#persistentPage
    this.#persistentPage = null
    if (page === null) return
    try {
      await page.close()
    } catch {
      // 关不掉就算了：下一次 navigate 会开新页；这里绝不把自愈变成第二个故障源。
    }
  }

  /** 当前有没有一张可读的页（`get_text` 的前提）。 */
  hasPage(): boolean {
    return this.#persistentPage !== null
  }

  async #shoot(page: BackendPage, op: HostOp): Promise<string | null> {
    if (!this.#dataDir) return null
    const rel = shotRelPath(op, this.#now())
    const absolute = join(this.#dataDir, rel)
    try {
      await mkdir(dirname(absolute), { recursive: true })
      await page.screenshot(absolute)
      return rel
    } catch (exc) {
      // 观察面坏了不该让她读不成网页：落一条事件，动作照常成功。
      this.#emit('browser_screenshot_failed', { op, error: errorText(exc) })
      return null
    }
  }

  // --- browser.navigate（D-2） ---

  async navigate(rawUrl: string): Promise<OpResult> {
    const verdict = await this.#guard.check(rawUrl)
    if (!verdict.allowed) {
      this.#emit('browser_url_blocked', {
        op: 'navigate', reason: verdict.reason, domain: domainOf(rawUrl),
      })
      return { ok: false, error: HOST_ERRORS.blockedUrl, detail: verdict.reason ?? 'blocked' }
    }
    let page: BackendPage
    try {
      page = await this.#ensurePersistent()
    } catch (exc) {
      return { ok: false, error: HOST_ERRORS.internal, detail: errorText(exc) }
    }
    try {
      await withDeadline(page.goto(rawUrl, this.#timeouts.navigate), this.#timeouts.navigate)
    } catch (exc) {
      await this.#dropPersistentPage()
      if (exc instanceof DeadlineError) return { ok: false, error: HOST_ERRORS.timeout }
      return { ok: false, error: HOST_ERRORS.navigationFailed, detail: errorText(exc) }
    }
    const finalUrl = page.currentUrl()
    if (isOffDomain(rawUrl, finalUrl)) {
      const from = domainOf(rawUrl)
      const to = domainOf(finalUrl)
      this.#emit('browser_redirect_off_domain', { op: 'navigate', from, to })
      // 停止加载、不读文本：把页扔掉，`get_text` 随后落 no_page（她没有落地）。
      await this.#dropPersistentPage()
      return { ok: false, error: HOST_ERRORS.redirectOffDomain, detail: `${from}->${to}` }
    }
    let title = ''
    try {
      title = await withDeadline(page.title(), this.#timeouts.getText)
    } catch {
      title = ''
    }
    const screenshot = await this.#shoot(page, 'navigate')
    return { ok: true, data: { url: rawUrl, final_url: finalUrl, title, screenshot } }
  }

  // --- browser.get_text（D-2：读当前页，不导航） ---

  async getText(maxChars?: unknown): Promise<OpResult> {
    const page = this.#persistentPage
    if (page === null) return { ok: false, error: HOST_ERRORS.noPage }
    const url = page.currentUrl()
    let raw: string
    let title = ''
    try {
      raw = await withDeadline(page.bodyText(this.#timeouts.getText), this.#timeouts.getText)
      title = await withDeadline(page.title(), this.#timeouts.getText)
    } catch (exc) {
      if (exc instanceof DeadlineError) {
        await this.#dropPersistentPage()
        return { ok: false, error: HOST_ERRORS.timeout }
      }
      return { ok: false, error: HOST_ERRORS.internal, detail: errorText(exc) }
    }
    const wrapped = wrapUntrusted({
      url, title, body: raw, maxChars: clampMaxChars(maxChars, this.#maxChars),
    })
    const screenshot = await this.#shoot(page, 'get_text')
    return {
      ok: true,
      data: {
        url,
        title,
        text: wrapped.text,
        chars: wrapped.chars,
        truncated: wrapped.truncated,
        untrusted: wrapped.untrusted,
        screenshot,
      },
    }
  }

  // --- research_browser.read_text（D-2/D-3：全新一次性上下文，用完即毁） ---

  async researchReadText(rawUrl: string, maxChars?: unknown): Promise<OpResult> {
    const verdict = await this.#guard.check(rawUrl)
    if (!verdict.allowed) {
      this.#emit('browser_url_blocked', {
        op: 'research_read_text', reason: verdict.reason, domain: domainOf(rawUrl),
      })
      return { ok: false, error: HOST_ERRORS.blockedUrl, detail: verdict.reason ?? 'blocked' }
    }
    let context: BackendContext | null = null
    try {
      context = await this.#backend.ephemeral()
      await this.#arm(context, 'research_read_text')
      const page = await context.page()
      try {
        await withDeadline(page.goto(rawUrl, this.#timeouts.research), this.#timeouts.research)
      } catch (exc) {
        if (exc instanceof DeadlineError) return { ok: false, error: HOST_ERRORS.timeout }
        return { ok: false, error: HOST_ERRORS.navigationFailed, detail: errorText(exc) }
      }
      const finalUrl = page.currentUrl()
      if (isOffDomain(rawUrl, finalUrl)) {
        const from = domainOf(rawUrl)
        const to = domainOf(finalUrl)
        this.#emit('browser_redirect_off_domain', { op: 'research_read_text', from, to })
        return { ok: false, error: HOST_ERRORS.redirectOffDomain, detail: `${from}->${to}` }
      }
      let raw: string
      let title = ''
      try {
        raw = await withDeadline(page.bodyText(this.#timeouts.research), this.#timeouts.research)
        title = await withDeadline(page.title(), this.#timeouts.research)
      } catch (exc) {
        if (exc instanceof DeadlineError) return { ok: false, error: HOST_ERRORS.timeout }
        return { ok: false, error: HOST_ERRORS.internal, detail: errorText(exc) }
      }
      const wrapped = wrapUntrusted({
        url: finalUrl, title, body: raw, maxChars: clampMaxChars(maxChars, this.#maxChars),
      })
      const screenshot = await this.#shoot(page, 'research_read_text')
      return {
        ok: true,
        data: {
          url: rawUrl,
          final_url: finalUrl,
          title,
          text: wrapped.text,
          chars: wrapped.chars,
          truncated: wrapped.truncated,
          untrusted: wrapped.untrusted,
          screenshot,
        },
      }
    } catch (exc) {
      return { ok: false, error: HOST_ERRORS.internal, detail: errorText(exc) }
    } finally {
      // D-3：一次性上下文在响应发出**之前**必须关掉，异常路径也要。
      if (context !== null) {
        try {
          await context.close()
        } catch (exc) {
          this.#emit('browser_ephemeral_close_failed', { error: errorText(exc) })
        }
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.#dropPersistentPage()
    const context = this.#persistentContext
    this.#persistentContext = null
    if (context !== null) {
      try {
        await context.close()
      } catch {
        // 关停路径不制造第二个故障。
      }
    }
    try {
      await this.#backend.shutdown()
    } catch {
      // 同上。
    }
  }
}

// ============================== Playwright 真身 ==============================
//
// 本节是**整个包里唯一** import playwright-core 的地方。上面的策略层对它一无所知，
// 所以 redirect / download / isolation 三个红测跑在没有 Chrome 的机器上也是真测试。
//
// 依赖纪律（派工单 §1）：只装 `playwright-core`（零传递依赖、无 postinstall、
// 不下载浏览器），驱动的是系统那一份 Google Chrome（`executablePath`）。
// `playwright` 全家桶靠 postinstall 拉浏览器，与 `npm ci --ignore-scripts` 的
// 部署纪律直接冲突，永不引入。

import { chromium } from 'playwright-core'
import type { Browser, BrowserContext as PwContext, Page as PwPage } from 'playwright-core'

/** 一帧 screencast（base64 JPEG）。只对持久上下文出画面（D-6）。 */
export type ScreencastSink = (jpegBase64: string) => void

export interface PlaywrightBackendOptions {
  /** 系统 Chrome 可执行文件（生产 `/usr/bin/google-chrome`）。 */
  executablePath: string
  /** 持久 profile 目录（登录态住这里；大脑从不读它）。 */
  userDataDir: string
  /** 出站代理；给了也**先过 SSRF 判定**（代理不是豁免，D-5①）。 */
  proxy?: string | undefined
  /**
   * 缺省 true。真 Chrome 二进制上 Playwright 的 `headless: true` 走的就是
   * Chrome 的新版无头（`--headless=new`），即 D-7 写的 `headless: 'new'`。
   */
  headless?: boolean
  /** 额外命令行参数（smoke 测试的 `--host-resolver-rules` 从这里进，不进 host.json）。 */
  extraArgs?: readonly string[]
}

const BASE_ARGS: readonly string[] = Object.freeze([
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-component-update',
  '--disable-background-networking',
  '--disable-sync',
  '--mute-audio',
])

class PlaywrightPage implements BackendPage {
  #page: PwPage

  constructor(page: PwPage) {
    this.#page = page
  }

  /** 底层 Page（宿主装 screencast 时要它；策略层碰不到）。 */
  raw(): PwPage {
    return this.#page
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    await this.#page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' })
  }

  currentUrl(): string {
    return this.#page.url()
  }

  title(): Promise<string> {
    return this.#page.title()
  }

  bodyText(_timeoutMs: number): Promise<string> {
    // 字符串形态的 evaluate：不引 DOM 类型进这棵 lib=es2023 的树。
    // innerText 天生不含 script/style 的内容（D-5④"脚本/样式不入文"）。
    return this.#page.evaluate<string>('document.body ? document.body.innerText : ""')
  }

  async screenshot(absolutePath: string): Promise<void> {
    await this.#page.screenshot({ path: absolutePath, fullPage: false })
  }

  async close(): Promise<void> {
    await this.#page.close()
  }
}

class PlaywrightContext implements BackendContext {
  #context: PwContext
  #closeExtra: (() => Promise<void>) | null
  #onPage: ((page: PlaywrightPage) => Promise<void>) | null
  #closed = false

  constructor(
    context: PwContext,
    opts: {
      closeExtra?: () => Promise<void>
      onPage?: (page: PlaywrightPage) => Promise<void>
    } = {},
  ) {
    this.#context = context
    this.#closeExtra = opts.closeExtra ?? null
    this.#onPage = opts.onPage ?? null
    this.#context.on('close', () => {
      this.#closed = true
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  async page(): Promise<BackendPage> {
    // 单 tab：persistent context 起来时自带一页，有就用，没有才新开。
    const existing = this.#context.pages()
    const raw = existing.length > 0 ? existing[0]! : await this.#context.newPage()
    const page = new PlaywrightPage(raw)
    if (this.#onPage !== null) await this.#onPage(page)
    return page
  }

  async setRequestFilter(filter: (url: string) => Promise<boolean>): Promise<void> {
    await this.#context.route('**', async (route) => {
      let allowed = false
      try {
        allowed = await filter(route.request().url())
      } catch {
        allowed = false // 判定本身炸了 = 拒（fail closed）
      }
      try {
        if (allowed) await route.continue()
        else await route.abort('blockedbyclient')
      } catch {
        // route 已经被浏览器收走（页面关了/导航跑了）——不是故障。
      }
    })
  }

  async setDownloadHandler(
    handler: (info: { url: string; suggestedName: string }) => void,
  ): Promise<void> {
    const attach = (page: PwPage): void => {
      page.on('download', (download) => {
        try {
          handler({ url: download.url(), suggestedName: download.suggestedFilename() })
        } catch {
          // 审计回调不许挡住 cancel。
        }
        void download.cancel().catch(() => {})
      })
    }
    for (const page of this.#context.pages()) attach(page)
    this.#context.on('page', attach)
  }

  async close(): Promise<void> {
    if (this.#closed) return
    this.#closed = true
    try {
      await this.#context.close()
    } finally {
      if (this.#closeExtra !== null) await this.#closeExtra()
    }
  }
}

/**
 * 系统 Chrome 后端。
 *
 * 持久上下文 = `launchPersistentContext(userDataDir)`（登录态）；
 * 一次性上下文 = **另起一个 Chrome 进程**（`launch()` + `newContext()`），
 * 用完连浏览器一起关。D-3 明说"两个 Chrome 进程可接受"—— 零共享比省一个进程重要。
 */
export class PlaywrightBackend implements BrowserBackend {
  #opts: PlaywrightBackendOptions
  #persistent: PlaywrightContext | null = null
  #screencastSink: ScreencastSink | null = null

  constructor(opts: PlaywrightBackendOptions) {
    this.#opts = opts
  }

  /** 装/卸 screencast 出口（D-6：只对持久上下文开画面）。 */
  setScreencastSink(sink: ScreencastSink | null): void {
    this.#screencastSink = sink
  }

  #launchOptions(): Record<string, unknown> {
    const args = [...BASE_ARGS, ...(this.#opts.extraArgs ?? [])]
    const options: Record<string, unknown> = {
      executablePath: this.#opts.executablePath,
      headless: this.#opts.headless ?? true,
      args,
      acceptDownloads: false, // D-5②：v1 无任何文件落到宿主外
      chromiumSandbox: true,
    }
    if (this.#opts.proxy) options.proxy = { server: this.#opts.proxy }
    return options
  }

  async persistent(): Promise<BackendContext> {
    if (this.#persistent !== null && !this.#persistent.closed) return this.#persistent
    const context = await chromium.launchPersistentContext(
      this.#opts.userDataDir,
      this.#launchOptions(),
    )
    this.#persistent = new PlaywrightContext(context, {
      onPage: (page) => this.#startScreencast(context, page),
    })
    return this.#persistent
  }

  async ephemeral(): Promise<BackendContext> {
    const browser: Browser = await chromium.launch(this.#launchOptions())
    const context = await browser.newContext({ acceptDownloads: false })
    return new PlaywrightContext(context, { closeExtra: () => browser.close() })
  }

  async shutdown(): Promise<void> {
    const persistent = this.#persistent
    this.#persistent = null
    if (persistent !== null) await persistent.close()
  }

  /**
   * CDP screencast（D-6 观察面）。装不上就算了 —— 画面是试用期的方便，
   * 不是动作的前提；它绝不许把一次导航拖红。
   */
  async #startScreencast(context: PwContext, page: PlaywrightPage): Promise<void> {
    const sink = this.#screencastSink
    if (sink === null) return
    try {
      const session = await context.newCDPSession(page.raw())
      session.on('Page.screencastFrame', (frame: unknown) => {
        const payload = frame as { data?: string; sessionId?: number }
        try {
          if (typeof payload.data === 'string') sink(payload.data)
        } catch {
          // sink 抛不许影响帧确认。
        }
        if (payload.sessionId !== undefined) {
          void session.send('Page.screencastFrameAck', { sessionId: payload.sessionId })
            .catch(() => {})
        }
      })
      await session.send('Page.startScreencast', {
        format: 'jpeg', quality: 55, maxWidth: 1280, maxHeight: 800, everyNthFrame: 2,
      })
    } catch {
      // 无头 Chrome 上 screencast 可能不可用：静默降级，动作照跑。
    }
  }
}
