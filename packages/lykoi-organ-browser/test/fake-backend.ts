/**
 * 假 backend（不是测试文件，是夹具）。
 *
 * 它实现 `driver.ts` 的三个 backend 接口，于是 redirect / download / isolation /
 * untrusted 四个红测**不需要真 Chrome** —— 策略全在驱动层，这里只提供"一个浏览器
 * 会怎么回话"。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BackendContext, BackendPage, BrowserBackend } from '../src/driver.ts'

export interface FakeSite {
  /** 跳转之后的地址（缺省 = 请求地址本身）。 */
  finalUrl?: string
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
  closed = false
  screenshots: string[] = []

  constructor(sites: Record<string, FakeSite>) {
    this.#sites = sites
  }

  async goto(url: string, _timeoutMs: number): Promise<void> {
    const site = this.#sites[url] ?? {}
    if (site.delayMs) await new Promise((r) => setTimeout(r, site.delayMs))
    if (site.failWith) throw new Error(site.failWith)
    this.#site = site
    this.#url = site.finalUrl ?? url
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
  filter: ((url: string) => Promise<boolean>) | null = null
  downloadHandler: ((info: { url: string; suggestedName: string }) => void) | null = null
  #sites: Record<string, FakeSite>

  constructor(kind: 'persistent' | 'ephemeral', sites: Record<string, FakeSite>) {
    this.kind = kind
    this.#sites = sites
  }

  async page(): Promise<BackendPage> {
    if (this.pages.length === 0) this.pages.push(new FakePage(this.#sites))
    const page = this.pages[this.pages.length - 1]!
    if (page.closed) {
      const fresh = new FakePage(this.#sites)
      this.pages.push(fresh)
      return fresh
    }
    return page
  }

  async setRequestFilter(filter: (url: string) => Promise<boolean>): Promise<void> {
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
