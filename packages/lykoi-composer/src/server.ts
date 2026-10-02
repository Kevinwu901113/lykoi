import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { ComposerEngine } from './engine.ts'
import type { ComposerStore } from './store.ts'
import type { ComponentRegistry } from './registry.ts'
import { assertJson } from './definition.ts'
import { semanticRoutingPreset } from './presets.ts'

/** HTTP-independent router, also exercised by integration tests. */
export function createApi(
  store: ComposerStore,
  registry: ComponentRegistry,
  engine: ComposerEngine
) {
  return async (
    method: string,
    path: string,
    body: any = {}
  ): Promise<unknown> => {
    if (method === 'GET' && path === '/api/presets/routing')
      return semanticRoutingPreset()
    if (method === 'GET' && path === '/api/catalog') return registry.catalog()
    if (method === 'GET' && path === '/api/definitions')
      return store.definitions()
    if (method === 'GET' && path === '/api/instances') return store.instances()
    if (method === 'GET' && path === '/api/runs') return store.runs()
    if (method === 'POST' && path === '/api/definitions')
      return store.saveDefinition(
        body.definition,
        body.expectedRevision,
        registry
      )
    if (method === 'POST' && path === '/api/instances')
      return store.createInstance(body.agentId)
    if (method === 'POST' && path === '/api/runs') {
      assertJson(body.input)
      return engine.start(body.instanceId, body.input)
    }
    const match =
      /^\/api\/runs\/([a-zA-Z0-9-]+)(?:\/(trace|pause|resume|cancel|resolve))?$/.exec(
        path
      )
    if (match) {
      const [, id, action] = match
      if (method === 'GET' && !action)
        return { run: store.run(id), operations: store.operations(id) }
      if (method === 'GET' && action === 'trace') return store.traces(id)
      if (method === 'POST' && action === 'pause') return engine.pause(id)
      if (method === 'POST' && action === 'resume') return engine.resume(id)
      if (method === 'POST' && action === 'cancel') return engine.cancel(id)
      if (method === 'POST' && action === 'resolve') {
        assertJson(body.value)
        return engine.resolve(id, body.operationId, body.value)
      }
    }
    throw new Error('API route not found')
  }
}
async function readBody(req: IncomingMessage) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw new Error('JSON content-type required')
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > 1048576) throw new Error('request body exceeds 1 MiB')
    chunks.push(chunk)
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  assertJson(value)
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('expected an object request')
  return value
}
export function createComposerServer(
  store: ComposerStore,
  registry: ComponentRegistry,
  engine: ComposerEngine
) {
  const api = createApi(store, registry, engine)
  const publicRoot = fileURLToPath(new URL('../public/', import.meta.url))
  const server = createServer((req, res) => {
    void serve(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  async function serve(req: IncomingMessage, res: ServerResponse) {
    res.setHeader(
      'content-security-policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    )
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('cache-control', 'no-store')
    try {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]
      if (!hosts.includes(req.headers.host ?? ''))
        throw new Error('invalid local host')
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}`
      )
        throw new Error('cross-origin request refused')
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw new Error('cross-site request refused')
      const path = new URL(req.url ?? '/', `http://${req.headers.host}`)
        .pathname
      if (path.startsWith('/api/')) {
        const result = await api(
          req.method ?? 'GET',
          path,
          req.method === 'POST' ? await readBody(req) : undefined
        )
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8'
        })
        res.end(JSON.stringify(result))
        return
      }
      const files: Record<string, [string, string]> = {
        '/': ['index.html', 'text/html'],
        '/app.js': ['app.js', 'text/javascript'],
        '/graph-editor.js': ['graph-editor.js', 'text/javascript'],
        '/style.css': ['style.css', 'text/css']
      }
      if (req.method !== 'GET' || !files[path]) {
        res.writeHead(404)
        res.end()
        return
      }
      const [file, mime] = files[path]
      res.writeHead(200, { 'content-type': `${mime}; charset=utf-8` })
      res.end(await readFile(`${publicRoot}${file}`))
    } catch (error) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
      res.end(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'request failed'
        })
      )
    }
  }
  return server
}
