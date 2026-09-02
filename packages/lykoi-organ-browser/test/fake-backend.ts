/**
 * 假 backend（不是测试文件，是夹具）。
 *
 * 它实现 `driver.ts` 的三个 backend 接口，于是 redirect / download / isolation /
 * untrusted 四个红测**不需要真 Chrome** —— 策略全在驱动层，这里只提供"一个浏览器
 * 会怎么回话"。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type {
  BackendContext, BackendPage, BrowserBackend, RequestInfo,
} from '../src/driver.ts'

export interface FakeSite {
  /** 跳转之后的地址（缺省 = 请求地址本身）。 */
  finalUrl?: string
  /**
   * 302 链（R-2）：从请求地址开始逐跳的目标地址。每一跳都会先过一次请求过滤器
   * （`isNavigation: true`、`redirectedFrom` = 上一跳），过滤器说不就地停下。
   *
   * ⚠ 这是 **backend 契约**，不是真 Chrome 今天的行为。实测（smoke ⑥⑦，
   *   playwright-core 1.60.0 + Chrome 152）：Chromium 的 `context.route('**')`
   *   **不为重定向 hop 回调**，所以 `PlaywrightContext` 上这条路走不通，出域实际
   *   由 driver 的 final_url 检查拦下。这里之所以照契约实现，是为了让驱动层
   *   "过滤器说不 → 落 redirect_off_domain" 这段逻辑本身可测，并在 backend 行为
   *   改善的那天立刻生效。**别把这些用例读成"真浏览器上跳转拦住了"。**
   */
  redirectChain?: readonly string[]
  title?: string
  body?: string
  /** goto 卡住多久（测超时）。 */
  delayMs?: number
  /** goto 直接抛（测导航失败路径）。 */
  failWith?: string
}

export class FakePage implements BackendPage {
  #sites: Record<string, FakeSite>
  #url = 'about:blank'
  #site: FakeSite = {}
  #context: FakeContext | null
  closed = false
  screenshots: string[] = []
  /** 真的被"发出去"过的地址（R-2 断言用：被拦的那一跳不该出现在这里）。 */
  fetched: string[] = []

  constructor(sites: Record<string, FakeSite>, context: FakeContext | null = null) {
    this.#sites = sites
    this.#context = context
  }

  async #pass(info: RequestInfo): Promise<boolean> {
    const filter = this.#context?.filter
    if (filter === undefined || filter === null) return true
    return filter(info)
  }

  async goto(url: string, _timeoutMs: number): Promise<void> {
    // 第一跳：她自己要去的地址。
    if (!await this.#pass({ url, isNavigation: true, redirectedFrom: null })) {
      throw new Error('net::ERR_BLOCKED_BY_CLIENT')
    }
    this.fetched.push(url)
    const site = this.#sites[url] ?? {}
    if (site.delayMs) await new Promise((r) => setTimeout(r, site.delayMs))
    if (site.failWith) throw new Error(site.failWith)
    // 后续每一跳：先过过滤器，过了才算"发出去"。
    let here = url
    for (const hop of site.redirectChain ?? []) {
      if (!await this.#pass({ url: hop, isNavigation: true, redirectedFrom: here })) {
        // 停在被拦的那一跳之前：URL 不变，目标站一个字节都没收到。
        throw new Error('net::ERR_BLOCKED_BY_CLIENT')
      }
      this.fetched.push(hop)
      here = hop
    }
    const landed = site.redirectChain !== undefined && site.redirectChain.length > 0
      ? (this.#sites[here] ?? {})
      : site
    this.#site = landed
    this.#url = landed.finalUrl ?? (site.redirectChain !== undefined ? here : url)
  }

  currentUrl(): string {
    return this.#url
  }

  async title(): Promise<string> {
    return this.#site.title ?? ''
  }

  async bodyText(_timeoutMs: number): Promise<string> {
    return this.#site.body ?? ''
  }

  async screenshot(absolutePath: string): Promise<void> {
    await mkdir(dirname(absolutePath), { recursive: true })
    await writeFile(absolutePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    this.screenshots.push(absolutePath)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

export class FakeContext implements BackendContext {
  kind: 'persistent' | 'ephemeral'
  closed = false
  pages: FakePage[] = []
  filter: ((info: RequestInfo) => Promise<boolean>) | null = null
  downloadHandler: ((info: { url: string; suggestedName: string }) => void) | null = null
  #sites: Record<string, FakeSite>

  constructor(kind: 'persistent' | 'ephemeral', sites: Record<string, FakeSite>) {
    this.kind = kind
    this.#sites = sites
  }

  async page(): Promise<BackendPage> {
    if (this.pages.length === 0) this.pages.push(new FakePage(this.#sites, this))
    const page = this.pages[this.pages.length - 1]!
    if (page.closed) {
      const fresh = new FakePage(this.#sites, this)
      this.pages.push(fresh)
      return fresh
    }
    return page
  }

  async setRequestFilter(filter: (info: RequestInfo) => Promise<boolean>): Promise<void> {
    this.filter = filter
  }

  async setDownloadHandler(handler: (info: { url: string; suggestedName: string }) => void): Promise<void> {
    this.downloadHandler = handler
  }

  async close(): Promise<void> {
    this.closed = true
  }

  /** 测试驱动：模拟浏览器抛出一次下载。 */
  fireDownload(url: string, suggestedName: string): void {
    this.downloadHandler?.({ url, suggestedName })
  }
}

export class FakeBackend implements BrowserBackend {
  sites: Record<string, FakeSite>
  persistentContexts: FakeContext[] = []
  ephemeralContexts: FakeContext[] = []
  shutdownCalls = 0

  constructor(sites: Record<string, FakeSite> = {}) {
    this.sites = sites
  }

  async persistent(): Promise<BackendContext> {
    const live = this.persistentContexts[this.persistentContexts.length - 1]
    if (live !== undefined && !live.closed) return live
    const context = new FakeContext('persistent', this.sites)
    this.persistentContexts.push(context)
    return context
  }

  async ephemeral(): Promise<BackendContext> {
    const context = new FakeContext('ephemeral', this.sites)
    this.ephemeralContexts.push(context)
    return context
  }

  async shutdown(): Promise<void> {
    this.shutdownCalls += 1
  }
}

/** 把一批主机名当公网（smoke 之外的测试都用它，免得摸真 DNS）。 */
export function tableResolver(table: Record<string, readonly string[]>) {
  return async (host: string): Promise<readonly string[]> => {
    const hit = table[host]
    if (hit === undefined) throw new Error(`fake resolver: 未登记的主机 ${host}`)
    return hit
  }
}
