/**
 * lykoi-audit — 治理地基①：append-only 审计 sink（JSONL）。
 *
 * 行为正本：治理仓库 WO-M0-STATE-CONTRACT §6 R-16 —
 *   「audit.jsonl 的 append-only：O_APPEND 单次 write；保真：单次 write 一整行
 *    （不分片），否则多进程并发追加会交错。」
 *
 * M1 写 dev 路径（默认 var/audit.jsonl）；M3 接 /var/log 权限模型
 * （root 属主 + chattr +a 由治理特权层落，不在插件树内）。
 *
 * 纪律：
 * - 只以 O_APPEND（flag 'a'）打开；本模块不存在任何截断/重写代码路径（永不截断重写）。
 * - 进程内串行：record 挂在一条 promise 链上，先到先写。
 * - 写失败向调用方抛错（fail-closed 的地基；M3 权限模型在此之上）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, open, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

/**
 * 一条审计事件。`type` 必填；`ts` 缺省时由 sink 补 ISO-8601 UTC（毫秒 + Z）。
 * TODO(M3): 审计行的规范信封（actor/decision/evidence 等字段）由治理移植波定义；
 * M1 的 sink 保持哑管道，不发明信封 schema。
 */
export interface AuditEvent {
  type: string
  ts?: string
  [key: string]: unknown
}

export interface AuditService {
  /** 追加一行 JSON。串行、单次 write 一整行（R-16）；失败抛给调用方。 */
  record(event: AuditEvent): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    audit: AuditService
  }
}

class AuditWriter implements AuditService {
  #path: string
  #handle: FileHandle | null = null
  #opening: Promise<FileHandle> | null = null
  #tail: Promise<unknown> = Promise.resolve()
  #disposed = false

  constructor(path: string) {
    this.#path = path
  }

  #open(): Promise<FileHandle> {
    if (this.#handle) return Promise.resolve(this.#handle)
    if (!this.#opening) {
      const opening = (async () => {
        await mkdir(dirname(this.#path), { recursive: true })
        // R-16: O_APPEND 打开；'a' 是本模块唯一的打开方式，不存在截断路径。
        const handle = await open(this.#path, 'a')
        this.#handle = handle
        return handle
      })()
      // 打开失败不粘死：下一次 record 重试打开；本次失败照常抛给调用方。
      opening.catch(() => {
        if (this.#opening === opening) this.#opening = null
      })
      this.#opening = opening
    }
    return this.#opening
  }

  record(event: AuditEvent): Promise<void> {
    if (typeof event?.type !== 'string' || event.type.length === 0) {
      return Promise.reject(new TypeError('lykoi-audit: event.type must be a non-empty string'))
    }
    const prev = this.#tail
    const job = (async () => {
      // 进程内串行：等待前序写完成（前序失败不阻断本次；错误已传播给前序调用方）。
      await prev.catch(() => {})
      if (this.#disposed) {
        throw new Error('lykoi-audit: sink disposed (fiber unloaded); refusing to record')
      }
      const line = { ts: new Date().toISOString(), ...event }
      // R-16: 整行（含换行符）序列化为单个 buffer，单次 write 写入，不分片。
      const buf = Buffer.from(JSON.stringify(line) + '\n', 'utf8')
      const handle = await this.#open()
      const { bytesWritten } = await handle.write(buf, 0, buf.length)
      if (bytesWritten !== buf.length) {
        // 部分写意味着行可能被撕裂——fail-closed，抛给调用方。
        throw new Error(
          `lykoi-audit: partial write (${bytesWritten}/${buf.length} bytes) to ${this.#path}`,
        )
      }
    })()
    this.#tail = job.catch(() => {})
    return job
  }

  async dispose(): Promise<void> {
    this.#disposed = true
    const handle = this.#handle
    this.#handle = null
    this.#opening = null
    await this.#tail
    await handle?.close()
  }
}

export const name = 'lykoi-audit'
export const inject: string[] = []

export interface Config {
  /** JSONL 审计文件路径（相对进程 cwd 解析）。M1 dev 默认 var/audit.jsonl。 */
  path: string
}

export const Config: Schema<Config> = Schema.object({
  path: Schema.string().default('var/audit.jsonl'),
})

export function apply(ctx: Context, config: Config) {
  const writer = new AuditWriter(resolve(config.path))
  // 可逆副作用：fiber 卸载即关句柄；之后 record 一律拒绝（audit 不在 = 不许静默继续）。
  ctx.effect(() => () => writer.dispose(), 'lykoi-audit sink')
  ctx.provide('audit', writer)
}
