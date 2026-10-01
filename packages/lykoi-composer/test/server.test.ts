import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { fixture } from './helpers.ts'
import { createComposerServer } from '../src/server.ts'

test('real local HTTP serves UI and refuses foreign Host, Origin and non-JSON writes', async () => {
  const f = fixture(),
    server = createComposerServer(f.store, f.registry, f.engine)
  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const port = (server.address() as { port: number }).port
    const send = (path: string, headers: Record<string, string> = {}, method = 'GET', body?: string) =>
      new Promise<{ status: number; headers: any; text: string }>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
          let text = ''
          res.on('data', (chunk) => {
            text += chunk
          })
          res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }))
        })
        req.on('error', reject)
        req.end(body)
      })
    const index = await send('/')
    assert.equal(index.status, 200)
    assert.match(index.text, /Agent Composer/)
    assert.match(index.headers['content-security-policy'], /frame-ancestors 'none'/)
    assert.equal((await send('/app.js')).status, 200)
    assert.equal((await send('/api/catalog')).status, 200)
    assert.equal((await send('/api/catalog', { host: 'foreign.example' })).status, 400)
    assert.equal((await send('/api/catalog', { origin: 'https://foreign.example' })).status, 400)
    assert.equal((await send('/api/runs', { 'content-type': 'text/plain' }, 'POST', '{}')).status, 400)
    assert.equal(
      (
        await send(
          '/api/runs',
          { 'content-type': 'application/json', origin: 'http://localhost:9999' },
          'POST',
          '{}'
        )
      ).status,
      400
    )
  } finally {
    await new Promise<void>((r) => server.close(() => r()))
    await f.close()
  }
})
