import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { mkdir, open, readFile, type FileHandle } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

export interface AuditEvent {
  type: string
  ts?: string
  [key: string]: unknown
}

export interface AuditService {

  record(event: AuditEvent): Promise<void>
  /**
   * 带稳定 event id 的幂等投影。用于 SQLite 已有 canonical 终态、JSONL 需要崩溃补账
   * 的窄场景；普通遥测仍用 record。返回 true 表示本次实际追加。
   */
  recordOnce?(eventId: string, event: AuditEvent): Promise<boolean>
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
  #onceIds: Set<string> | null = null
  #needsLineBoundary = false
  #disposed = false

  constructor(path: string) {
    this.#path = path
  }

  #open(): Promise<FileHandle> {
    if (this.#handle) return Promise.resolve(this.#handle)
    if (!this.#opening) {
      const opening = (async () => {
        await mkdir(dirname(this.#path), { recursive: true })

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

  async #append(event: AuditEvent): Promise<void> {
    if (this.#disposed) {
      throw new Error('lykoi-audit: sink disposed (fiber unloaded); refusing to record')
    }
    const line = { ts: new Date().toISOString(), ...event }

    const buf = Buffer.from((this.#needsLineBoundary ? '\n' : '') + JSON.stringify(line) + '\n', 'utf8')
    const handle = await this.#open()
    const { bytesWritten } = await handle.write(buf, 0, buf.length)
    if (bytesWritten !== buf.length) {
      this.#needsLineBoundary = true
      // 部分写意味着行可能被撕裂——fail-closed，抛给调用方。
      throw new Error(
        `lykoi-audit: partial write (${bytesWritten}/${buf.length} bytes) to ${this.#path}`,
      )
    }
    this.#needsLineBoundary = false
    if (this.#onceIds !== null && typeof event.event_id === 'string') {
      this.#onceIds.add(event.event_id)
    }
  }

  #enqueue<T>(write: () => Promise<T>): Promise<T> {
    const prev = this.#tail
    const job = (async () => {
      // 进程内串行：等待前序写完成（前序失败不阻断本次；错误已传播给前序调用方）。
      await prev.catch(() => {})
      return await write()
    })()
    this.#tail = job.catch(() => {})
    return job
  }

  record(event: AuditEvent): Promise<void> {
    if (typeof event?.type !== 'string' || event.type.length === 0) {
      return Promise.reject(new TypeError('lykoi-audit: event.type must be a non-empty string'))
    }
    return this.#enqueue(async () => await this.#append(event))
  }

  async #loadOnceIds(): Promise<Set<string>> {
    if (this.#onceIds !== null) return this.#onceIds
    const ids = new Set<string>()
    let raw = ''
    try {
      raw = await readFile(this.#path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    this.#needsLineBoundary = raw.length > 0 && !raw.endsWith('\n')
    for (const line of raw.split('\n')) {
      if (line.length === 0 || !line.includes('"event_id"')) continue
      try {
        const row = JSON.parse(line) as { event_id?: unknown }
        if (typeof row.event_id === 'string') ids.add(row.event_id)
      } catch { /* crash 遗留的撕裂尾行不是成功事件，允许补写完整行 */ }
    }
    this.#onceIds = ids
    return ids
  }

  recordOnce(eventId: string, event: AuditEvent): Promise<boolean> {
    if (typeof eventId !== 'string' || eventId.length === 0) {
      return Promise.reject(new TypeError('lykoi-audit: eventId must be a non-empty string'))
    }
    if (typeof event?.type !== 'string' || event.type.length === 0) {
      return Promise.reject(new TypeError('lykoi-audit: event.type must be a non-empty string'))
    }
    return this.#enqueue(async () => {
      if (this.#disposed) throw new Error('lykoi-audit: sink disposed; refusing to record')
      const ids = await this.#loadOnceIds()
      const duplicate = ids.has(eventId)
      if (!duplicate) await this.#append({ ...event, event_id: eventId })
      // SQLite 只有在 JSONL 真正落盘后才能标记已投影。sync 失败后的同 ID 重试也要 sync。
      await (await this.#open()).sync()
      ids.add(eventId)
      return !duplicate
    })
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
