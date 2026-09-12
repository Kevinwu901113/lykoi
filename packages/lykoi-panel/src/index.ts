import type { Context } from '@deepseek-ai/cordis'
import type {} from 'lykoi-contracts'
import type {} from 'lykoi-converse'
import type {} from 'lykoi-heart'
import Schema from '@deepseek-ai/schemastery'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'

export const name = 'lykoi-panel'
export const inject = ['lykoiRuntime', 'converse']
export interface Config { port: number }
export const Config: Schema<Config> = Schema.object({ port: Schema.number().min(0).max(65535).step(1).default(3210) })
declare module '@deepseek-ai/cordis' { interface Context { panel: { url: string } } }

class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new HttpError(400, `${field} 不能为空`)
  return value
}
function offset(url: URL): number {
  const value = Number(url.searchParams.get('offset') ?? 0)
  if (!Number.isSafeInteger(value) || value < 0) throw new HttpError(400, 'offset 必须为非负整数')
  return value
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, '需要 JSON 请求')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length
    if (size > 65_536) { req.resume(); throw new HttpError(413, '请求超过 64 KiB') }
    chunks.push(chunk)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new HttpError(400, 'JSON 格式错误') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, '需要 JSON 对象')
  return value as Record<string, unknown>
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

/** An owner console. All state and operations remain with the injected services. */
export async function apply(ctx: Context, config: Config) {
  const assets = new Map([
    ['/', ['text/html; charset=utf-8', 'index.html']],
    ['/app.js', ['text/javascript; charset=utf-8', 'app.js']],
    ['/style.css', ['text/css; charset=utf-8', 'style.css']],
  ].map(([path, [type, file]]) => [path, { type, bytes: readFileSync(new URL(`../public/${file}`, import.meta.url)) }]))
  let port: number
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    handle(req, res).catch(error => {
      if (res.destroyed) return
      const status = error instanceof HttpError ? error.status : 500
      if (status === 500) ctx.logger.error('Panel request failed: %s', error instanceof Error ? error.message : String(error))
      json(res, { error: error instanceof HttpError ? error.message : '操作未完成，请查看运行日志。不要自动重复提交。' }, status)
    })
  })
  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Loopback is the owner trust boundary. Host + Origin prevent browser rebinding/CSRF.
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host ?? '')) throw new HttpError(403, '仅允许本机访问')
    const origin = `http://${req.headers.host}`
    if ((req.headers.origin !== undefined && req.headers.origin !== origin)
      || req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, '不允许跨站请求')
    const url = new URL(req.url!, origin)
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const asset = assets.get(url.pathname)!
      res.writeHead(200, { 'Content-Type': asset.type }); res.end(asset.bytes); return
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      const runtime = ctx.lykoiRuntime, heart = ctx.get('heart')
      json(res, {
        instance: runtime.instance ?? null,
        capabilities: runtime.capabilities(), organs: runtime.bodySchema.snapshot().organs, revision: runtime.revision,
        mind: ctx.get('mind')?.view() ?? null,
        tasks: ctx.get('tasks')?.list() ?? null,
        skills: ctx.get('skills')?.recent() ?? null,
        heart: heart ? { pending: heart.pending, nextAt: heart.nextAt } : null,
        history: ctx.converse.history(50),
      }); return
    }
    if (req.method === 'GET' && url.pathname === '/api/mind') {
      const mind = ctx.get('mind')
      if (!mind) throw new HttpError(503, 'Mind 插件未装配')
      json(res, mind.view(url.searchParams.get('query') ?? '', 100)); return
    }
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      const skills = ctx.get('skills')
      if (!skills) throw new HttpError(503, 'Skill 插件未装配')
      const id = url.searchParams.get('id')
      json(res, id ? skills.read(id) : skills.list(url.searchParams.get('query') ?? '', offset(url), 20)); return
    }
    if (req.method === 'GET' && url.pathname === '/api/task') {
      const tasks = ctx.get('tasks')
      if (!tasks) throw new HttpError(503, 'Task 插件未装配')
      const id = text(url.searchParams.get('id'), 'id')
      json(res, { task: tasks.get(id), ...tasks.history(id, offset(url), 20) }); return
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const input = await body(req), message = text(input.text, '消息')
      json(res, await ctx.converse.sendOwner(message)); return
    }
    if (req.method === 'POST' && url.pathname === '/api/task') {
      const input = await body(req), command = text(input.command, 'command')
      if (!['create', 'update', 'pause', 'resume', 'cancel', 'approve', 'retry-delivery'].includes(command)) throw new HttpError(400, '不支持的任务操作')
      const id = command === 'create' ? '' : text(input.id, 'id')
      if (/\s/.test(id)) throw new HttpError(400, 'id 不能包含空白')
      const content = ['create', 'update'].includes(command) ? text(input.text, '内容') : ''
      const tasks = ctx.get('tasks')
      if (!tasks) throw new HttpError(503, 'Task 插件未装配')
      // Use the audited owner command entry, not model capabilities or direct store writes.
      const receipt = await ctx.lykoiRuntime.run(() => tasks.command(`/task ${command} ${id} ${content}`.trim()))
      json(res, { receipt }); return
    }
    throw new HttpError(404, '没有这个入口')
  }
  await ctx.effect(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    port = (server.address() as { port: number }).port
    return () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
      server.closeIdleConnections()
    })
  }, 'Panel HTTP server')
  const url = `http://127.0.0.1:${port!}`
  ctx.provide('panel', { url })
  ctx.logger.info('Panel ready: %s', url)
}
