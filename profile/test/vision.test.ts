import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { createInstance, instanceEnvironment } from '../instance-state.ts'
import { instanceEntries, drainInstance } from '../assembly.ts'

function png() {
  const chunk = (type: string, data: Buffer) => { const payload = Buffer.concat([Buffer.from(type), data]), size = Buffer.alloc(4), crc = Buffer.alloc(4); size.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(payload)); return Buffer.concat([size, payload, crc]) }
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0]))), chunk('IEND', Buffer.alloc(0))])
}

test('Panel upload reaches a budgeted image adapter as a durable image block and returns through Converse', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-vision-')), previous = { ...process.env }
  const instance = createInstance({ registry: join(root, 'instances'), id: 'vision', ownerName: 'Owner', definition: new URL('../../packages/lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname })
  Object.assign(process.env, instanceEnvironment(instance))
  const ctx = new Context(); ctx.provide('lykoiInstance', instance); ctx.baseUrl = new URL('../instance-worker.ts', import.meta.url).href
  await ctx.plugin(Loader, { baseUrl: ctx.baseUrl })
  let calls = 0
  try {
    const entries = instanceEntries(new URL('../cordis.panel.yml', import.meta.url).pathname, instance).map(e => e.id === 'panel' ? { ...e, config: { port: 0 } }
      : e.id === 'converse' ? { ...e, config: { ...e.config, visionRoute: 'vision-proof', visionModel: 'image' } } : e)
    await ctx.loader.root.update(entries); await ctx.loader.await()
    class ProofAdapter extends LlmAdapter {
      async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, inputModalities: ['text', 'image'] as const } }
      async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
        calls++
        const block = options.messages.flatMap(m => m.content).find(b => b.type === 'image')
        assert.ok(block && block.type === 'image', 'base64 in a text block must not pass')
        assert.equal(block.attachment.width, 1); assert.equal(block.attachment.height, 1)
        const stored = await ctx.attachments.readImage(block.attachment)
        assert.ok(stored.data.length > 0)
        const text = '合成视觉验收：收到真实 1×1 像素图片。'
        yield { type: 'block-start', index: 0, blockType: 'text' }; yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }; yield { type: 'finish', reason: { kind: 'stop' } }
      }
    }
    const retireVision = ctx.llm.registerAdapter(['vision-proof'], new ProofAdapter())
    const response = await fetch(ctx.panel.url + '/api/chat/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '看看图片', image: { data: png().toString('base64'), mediaType: 'image/png' } }) })
    assert.equal(response.status, 200, await response.clone().text())
    assert.equal(calls, 1)
    assert.ok(ctx.converse.history(1)[0]!.content.includes('收到真实 1×1'))
    assert.ok(!ctx.converse.history(1)[0]!.content.includes('base64'))
    retireVision()
    class TextOnly extends LlmAdapter {
      async resolveModel(provider: string, model: string) { return { provider, id: model, name: model, inputModalities: ['text'] as const } }
      async *stream(): AsyncIterable<StreamChunk> { throw new Error('text-only provider must not receive a vision call') }
    }
    ctx.llm.registerAdapter(['vision-proof'], new TextOnly())
    const refused = await fetch(ctx.panel.url + '/api/chat/image', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '不能假装看见', image: { data: png().toString('base64'), mediaType: 'image/png' } }) })
    assert.equal(refused.status, 500); assert.equal(calls, 1); assert.equal(ctx.converse.history(50).length, 1)
    await ctx.loader.root.update(entries.filter(e => e.id !== 'attachments')); await ctx.loader.await()
    assert.equal(ctx.converse.visionAvailable(), false)
    assert.equal((await fetch(ctx.panel.url + '/api/chat/image', { method: 'POST' })).status, 503)
    assert.equal(calls, 1)
  } finally {
    await drainInstance(ctx)
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous); rmSync(root, { recursive: true, force: true })
  }
})
