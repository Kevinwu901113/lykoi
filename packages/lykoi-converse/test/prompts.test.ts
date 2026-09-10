import assert from 'node:assert/strict'
import test from 'node:test'
import { CapabilityRuntime } from 'lykoi-runtime'
import { envelopeSystemPrompt, envelopeToolNames, renderToolTable, buildEnvelopeMessages, ASK_FALLBACK } from '../src/index.ts'

test('only live registrations supply names, descriptions and input schema; no tools before registration', () => {
  const runtime = new CapabilityRuntime()
  assert.deepEqual(envelopeToolNames(), [])
  const stop = runtime.register({ organId: 'temporary', sideEffects: [], capabilities: [{
    name: 'weather.lookup', description: 'Read weather for a city', inputSchema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }, handler: async () => ({ temperature: 21 }),
  }] })
  assert.deepEqual(envelopeToolNames(runtime.actions, runtime.capabilities()), ['weather.lookup'])
  const rendered = envelopeSystemPrompt(runtime.actions, runtime.capabilities())
  assert.ok(rendered.includes('Read weather for a city')); assert.ok(rendered.includes('"required":["city"]'))
  assert.ok(rendered.includes(renderToolTable(runtime.actions, runtime.capabilities())))
  stop()
  assert.ok(!buildEnvelopeMessages([], runtime.actions, undefined, runtime.capabilities()).at(-1)!.content!.includes('weather.lookup'))
})

test('E4-3：信封装配保留用户原文中的模板字符', async () => {
  const { FIXTURE_PERSONA } = await import('./fixture.ts')
  const raw = '请逐字保留 {owner}、{owner_name}、{self} 和 Kevin'
  const messages = buildEnvelopeMessages([{ role: 'user', content: raw }], undefined, FIXTURE_PERSONA)
  assert.equal(messages.find(m => m.role === 'user')!.content, raw)
  assert.ok(messages.filter(m => m.role === 'system').every(m => !/\{owner\}|Kevin|Lykoi/.test(m.content ?? '')))
})

test('approval clarification exposes no internal HTTP endpoint', () => {
  assert.ok(!ASK_FALLBACK.includes('/approvals'))
  assert.ok(!ASK_FALLBACK.toUpperCase().includes('POST'))
})
