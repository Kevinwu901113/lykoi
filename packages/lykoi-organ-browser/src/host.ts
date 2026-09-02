/**
 * 宿主守护进程（WO-M5-ORGAN-BROWSER D-1/D-6/D-7）。
 *
 * 它跑在**另一个 OS 用户**（`lykoi-browser`）的**另一个 systemd 单元**里，持有
 * Chrome 与持久 profile，只经 `/run/lykoi-browser/host.sock`（0660，组 lykoi）
 * 听大脑说话。**大脑侧永不 spawn Chrome** —— 这是白皮书 §17.3 的隔离等价边界在
 * 本单的物理落法：她的手长在另一个身份上，那个身份读不到 `/home/lykoi/state`，
 * 也读不到禁区里的任何一份密钥。
 *
 * 三条纪律：
 *  - **零 env**：配置只从 `--config <path>` 指的那份 JSON 来（GK-6 的
 *    `scanEnvReads` 扫 packages 下每个包的 src，本文件里 `process.env` 一次都不出现）。
 *  - **串行**：同一时刻只处理一个请求，第二个立即回 `busy`。
 *  - **超时即自愈**：超时返回 `timeout` 并把页/上下文关掉，不留僵尸。
 */
import { chmodSync, existsSync, unlinkSync } from 'node:fs'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { createServer as createHttpServer, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createServer as createSocketServer, type Server as SocketServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BrowserOrganDriver, PlaywrightBackend } from './driver.ts'
import {
  DEFAULT_TIMEOUTS, HOST_ERRORS, OP_SET, createLineSplitter, decodeLine, encodeLine,
  type HostOp, type HostResponse,
} from './protocol.ts'
import { SsrfGuard, nodeLookupResolver } from './ssrf.ts'
import { DEFAULT_MAX_CHARS, clampMaxChars } from './untrusted.ts'

// ============================== 配置（D-7） ==============================

export interface HostConfig {
  socketPath: string
  executablePath: string
  userDataDir: string
  dataDir: string
  proxy: string | null
  maxChars: number
  screenshotRetentionDays: number
  screencast: { enabled: boolean; listen: string }
  timeouts: { navigate: number; getText: number; research: number }
}

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = raw[key]
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`lykoi-browser host.json: 缺少必填字段 ${key}`)
  }
  return value
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

/** JSON → 配置。四个路径字段必填（缺了就大声抛，不给"默认到某个地方"的机会）。 */
export function loadHostConfig(raw: unknown): HostConfig {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('lykoi-browser host.json: 顶层必须是一个对象')
  }
  const doc = raw as Record<string, unknown>
  const screencastRaw = (doc.screencast ?? {}) as Record<string, unknown>
  const timeoutsRaw = (doc.timeouts ?? {}) as Record<string, unknown>
  const proxy = typeof doc.proxy === 'string' && doc.proxy.trim() ? doc.proxy.trim() : null
  return {
    socketPath: requireString(doc, 'socketPath'),
    executablePath: requireString(doc, 'executablePath'),
    userDataDir: requireString(doc, 'userDataDir'),
    dataDir: requireString(doc, 'dataDir'),
    proxy,
    maxChars: clampMaxChars(doc.maxChars, DEFAULT_MAX_CHARS),
    screenshotRetentionDays: positiveInt(doc.screenshotRetentionDays, 7),
    screencast: {
      enabled: screencastRaw.enabled === true,
      listen: typeof screencastRaw.listen === 'string' && screencastRaw.listen
        ? screencastRaw.listen
        : '127.0.0.1:9223',
    },
    timeouts: {
      navigate: positiveInt(timeoutsRaw.navigate, DEFAULT_TIMEOUTS.navigate),
      getText: positiveInt(timeoutsRaw.getText, DEFAULT_TIMEOUTS.getText),
      research: positiveInt(timeoutsRaw.research, DEFAULT_TIMEOUTS.research),
    },
  }
}

/** `--config <path>` / `--config=<path>`。没有就抛 —— 宿主没有"默认配置"。 */
export function parseConfigPath(argv: readonly string[]): string {
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]!
    if (item === '--config') {
      const next = argv[i + 1]
      if (typeof next === 'string' && next) return next
      throw new TypeError('lykoi-browser host: --config 后面要跟配置文件路径')
    }
    if (item.startsWith('--config=')) {
      const value = item.slice('--config='.length)
      if (value) return value
      throw new TypeError('lykoi-browser host: --config= 后面要跟配置文件路径')
    }
  }
  throw new TypeError('lykoi-browser host: 必须用 --config <path> 指定配置文件')
}

export async function readHostConfig(path: string): Promise<HostConfig> {
  const text = await readFile(path, 'utf8')
  return loadHostConfig(JSON.parse(text))
}

// ============================== 截图滚动删除（D-6） ==============================

/**
 * 删掉 `shots/` 下超过 `retentionDays` 天的日目录。返回删掉的目录名（可测）。
 * 目录名不是 `YYYYMMDD` 的一律不动 —— 清理器绝不做模糊匹配（报告 §3.5 纪律同向）。
 */
export async function pruneShots(
  shotsRoot: string,
  retentionDays: number,
  now: Date,
): Promise<string[]> {
  let entries: string[]
  try {
    entries = await readdir(shotsRoot)
  } catch {
    return []
  }
  const cutoff = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    - retentionDays * 86_400_000
  const removed: string[] = []
  for (const entry of entries) {
    if (!/^\d{8}$/.test(entry)) continue
    const year = Number(entry.slice(0, 4))
    const month = Number(entry.slice(4, 6))
    const day = Number(entry.slice(6, 8))
    const stamp = Date.UTC(year, month - 1, day)
    if (!Number.isFinite(stamp) || stamp >= cutoff) continue
    try {
      await rm(join(shotsRoot, entry), { recursive: true, force: true })
      removed.push(entry)
    } catch {
      // 删不掉不算故障：下一小时再试。
    }
  }
  return removed
}

// ============================== screencast（D-6） ==============================

export interface ScreencastHub {
  server: HttpServer
  push(jpegBase64: string): void
  listen(): Promise<void>
  close(): Promise<void>
}

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * MJPEG（`multipart/x-mixed-replace`）实时画面，**只绑 127.0.0.1**，Kevin 经
 * ssh 隧道看。绑到非回环地址一律抛 —— 画面是"给一个人看"的东西，不是一条服务。
 */
export function createScreencastHub(listenSpec: string): ScreencastHub {
  const idx = listenSpec.lastIndexOf(':')
  if (idx <= 0) throw new TypeError(`lykoi-browser screencast.listen 形如 127.0.0.1:9223，收到 ${listenSpec}`)
  const host = listenSpec.slice(0, idx).replace(/^\[|\]$/g, '')
  const port = Number(listenSpec.slice(idx + 1))
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new TypeError(`lykoi-browser screencast 只许绑回环地址，收到 ${host}`)
  }
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new TypeError(`lykoi-browser screencast.listen 端口非法：${listenSpec}`)
  }

  const boundary = 'lykoiframe'
  const viewers = new Set<ServerResponse>()
  const server = createHttpServer((req, res) => {
    if (req.url === '/stream') {
      res.writeHead(200, {
        'Content-Type': `multipart/x-mixed-replace; boundary=${boundary}`,
        'Cache-Control': 'no-store',
        Connection: 'close',
      })
      viewers.add(res)
      req.on('close', () => viewers.delete(res))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end('<!doctype html><meta charset="utf-8"><title>lykoi browser</title>'
      + '<body style="margin:0;background:#111"><img src="/stream" style="width:100%">')
  })

  return {
    server,
    push(jpegBase64: string) {
      if (viewers.size === 0) return
      let frame: Buffer
      try {
        frame = Buffer.from(jpegBase64, 'base64')
      } catch {
        return
      }
      const head = `--${boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
      for (const viewer of viewers) {
        try {
          viewer.write(head)
          viewer.write(frame)
          viewer.write('\r\n')
        } catch {
          viewers.delete(viewer)
        }
      }
    },
    listen(): Promise<void> {
      return new Promise((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, host === 'localhost' ? '127.0.0.1' : host, () => resolveListen())
      })
    },
    close(): Promise<void> {
      for (const viewer of viewers) {
        try {
          viewer.end()
        } catch {
          // 关停不制造第二个故障。
        }
      }
      viewers.clear()
      return new Promise((resolveClose) => server.close(() => resolveClose()))
    },
  }
}

// ============================== socket 服务 ==============================

export type HostLog = (name: string, fields: Record<string, unknown>) => void

/** 驱动层在宿主眼里的样子（测试注入假 driver）。 */
export interface HostDriverLike {
  navigate(url: string): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; detail?: string }>
  getText(maxChars?: unknown): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; detail?: string }>
  researchReadText(url: string, maxChars?: unknown): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string; detail?: string }>
}

export interface HostServerOptions {
  driver: HostDriverLike
  log?: HostLog
  startedAt?: number
}

/**
 * NDJSON over Unix socket 的服务端。**串行**：`busy` 是进程级的一个布尔量，不是
 * 每连接的 —— 两个连接同时说话，第二个照样立刻被回 `busy`。
 */
export function createHostServer(opts: HostServerOptions): SocketServer {
  const log = opts.log ?? (() => {})
  const startedAt = opts.startedAt ?? Date.now()
  let busy = false

  const handle = async (op: HostOp, args: Record<string, unknown>): Promise<Omit<HostResponse, 'id'>> => {
    if (op === 'health') {
      return {
        ok: true,
        data: { alive: true, pid: process.pid, uptime_s: Math.round((Date.now() - startedAt) / 1000) },
      }
    }
    if (op === 'navigate' || op === 'research_read_text') {
      const url = typeof args.url === 'string' ? args.url.trim() : ''
      if (!url) return { ok: false, error: HOST_ERRORS.badRequest, detail: 'url 必填' }
      const result = op === 'navigate'
        ? await opts.driver.navigate(url)
        : await opts.driver.researchReadText(url, args.max_chars)
      return result.ok
        ? { ok: true, data: result.data ?? {} }
        : { ok: false, error: result.error ?? HOST_ERRORS.internal, detail: result.detail }
    }
    const result = await opts.driver.getText(args.max_chars)
    return result.ok
      ? { ok: true, data: result.data ?? {} }
      : { ok: false, error: result.error ?? HOST_ERRORS.internal, detail: result.detail }
  }

  return createSocketServer((socket) => {
    socket.setEncoding('utf8')
    socket.on('error', () => {
      // 对端半路走掉不是宿主的故障。
    })
    const reply = (message: HostResponse): void => {
      try {
        socket.write(encodeLine(message))
      } catch {
        // 同上。
      }
    }
    const feed = createLineSplitter((line) => {
      const parsed = decodeLine(line)
      if (parsed === null) {
        reply({ id: '', ok: false, error: HOST_ERRORS.badRequest, detail: '不是一行合法 JSON' })
        return
      }
      const id = typeof parsed.id === 'string' ? parsed.id : ''
      const op = typeof parsed.op === 'string' ? parsed.op : ''
      if (!OP_SET.has(op)) {
        reply({ id, ok: false, error: HOST_ERRORS.unknownOp, detail: op })
        return
      }
      const args = (typeof parsed.args === 'object' && parsed.args !== null && !Array.isArray(parsed.args))
        ? parsed.args as Record<string, unknown>
        : {}
      if (busy) {
        log('browser_host_busy', { op })
        reply({ id, ok: false, error: HOST_ERRORS.busy })
        return
      }
      busy = true
      const started = Date.now()
      void handle(op as HostOp, args)
        .then((result) => {
          reply({ id, ...result })
          log('browser_host_op', {
            op, ok: result.ok, error: result.error ?? null, duration_ms: Date.now() - started,
          })
        })
        .catch((exc: unknown) => {
          reply({
            id,
            ok: false,
            error: HOST_ERRORS.internal,
            detail: exc instanceof Error ? exc.message : String(exc),
          })
        })
        .finally(() => {
          busy = false
        })
    }, {
      onOverflow: () => {
        reply({ id: '', ok: false, error: HOST_ERRORS.badRequest, detail: '单行过长' })
        socket.destroy()
      },
    })
    socket.on('data', (chunk) => feed(String(chunk)))
  })
}

// ============================== 入口 ==============================

function stdoutLog(name: string, fields: Record<string, unknown>): void {
  // journald 收得到就够了：宿主不写文件日志，也不碰大脑那条不可变审计链。
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event: name, ...fields }) + '\n')
}

export async function main(argv: readonly string[]): Promise<void> {
  const config = await readHostConfig(parseConfigPath(argv))
  await mkdir(config.userDataDir, { recursive: true })
  await mkdir(join(config.dataDir, 'shots'), { recursive: true })
  await mkdir(dirname(config.socketPath), { recursive: true })

  const backend = new PlaywrightBackend({
    executablePath: config.executablePath,
    userDataDir: config.userDataDir,
    proxy: config.proxy ?? undefined,
    headless: true,
  })
  const driver = new BrowserOrganDriver({
    backend,
    guard: new SsrfGuard({ resolve: nodeLookupResolver() }),
    dataDir: config.dataDir,
    maxChars: config.maxChars,
    timeouts: config.timeouts,
    emit: stdoutLog,
  })

  let hub: ScreencastHub | null = null
  if (config.screencast.enabled) {
    hub = createScreencastHub(config.screencast.listen)
    await hub.listen()
    backend.setScreencastSink((frame) => hub!.push(frame))
    stdoutLog('browser_screencast_listening', { listen: config.screencast.listen })
  }

  // D-6：启动时与每小时各滚动删除一次超期的截图日目录。
  const shotsRoot = join(config.dataDir, 'shots')
  const sweep = (): void => {
    void pruneShots(shotsRoot, config.screenshotRetentionDays, new Date())
      .then((removed) => {
        if (removed.length > 0) stdoutLog('browser_shots_pruned', { days: removed.length })
      })
      .catch(() => {})
  }
  sweep()
  const sweepTimer = setInterval(sweep, 3_600_000)
  sweepTimer.unref()

  if (existsSync(config.socketPath)) unlinkSync(config.socketPath)
  const server = createHostServer({ driver, log: stdoutLog })
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(config.socketPath, () => resolveListen())
  })
  chmodSync(config.socketPath, 0o660)
  stdoutLog('browser_host_listening', { socket: config.socketPath, pid: process.pid })

  const shutdown = (signal: string): void => {
    stdoutLog('browser_host_stopping', { signal })
    server.close()
    void driver.shutdown().finally(() => {
      void (hub === null ? Promise.resolve() : hub.close()).finally(() => {
        if (existsSync(config.socketPath)) {
          try {
            unlinkSync(config.socketPath)
          } catch {
            // systemd 的 RuntimeDirectory 收尾也会清它。
          }
        }
        process.exit(0)
      })
    })
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

/** 只在被直接执行时起服务；被 import（测试）时什么都不做。 */
const invokedDirectly = typeof process.argv[1] === 'string'
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((exc: unknown) => {
    stdoutLog('browser_host_start_failed', {
      error: exc instanceof Error ? exc.message : String(exc),
    })
    process.exit(1)
  })
}
