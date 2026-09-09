import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { isUnwiredHandler } from 'lykoi-kernel'
import { CapabilityRuntime } from '../src/index.ts'
import * as runtimePlugin from '../src/index.ts'
import type { RuntimeService } from 'lykoi-contracts'

const registration = (result: string) => ({
  organId: 'test-browser', handlers: { 'browser.navigate': async () => result }, sideEffects: [],
})

test('two independent runtimes: same organ/action, separate body schemas and disposers', async () => {
  const a = new CapabilityRuntime(), b = new CapabilityRuntime()
  const stopA = a.register(registration('a'))
  b.register(registration('b'))
  assert.equal(await a.resources.browser!.navigate!({}), 'a')
  assert.equal(await b.resources.browser!.navigate!({}), 'b')
  stopA()
  assert.deepEqual(a.bodySchema.snapshot().actions, [])
  assert.equal(await b.resources.browser!.navigate!({}), 'b')
  a.dispose(); b.dispose()
})

test('held resource/catalog/set views update on register and dispose; held handlers cannot outlive their owner', async () => {
  const runtime = new CapabilityRuntime()
  const { resources, catalog, actions, bodySchema } = runtime
  const stop = runtime.register(registration('first'))
  const old = resources.browser!.navigate!
  assert.ok(actions.has('browser.navigate'))
  assert.deepEqual(catalog.knownActions, ['browser.navigate'])
  assert.deepEqual(bodySchema.snapshot().actions, ['browser.navigate'])
  stop()
  assert.ok(isUnwiredHandler(resources.browser!.navigate!))
  assert.equal(actions.size, 0)
  assert.deepEqual(catalog.knownActions, [])
  await assert.rejects(old({}), /capability retired/)
  runtime.register(registration('second'))
  stop() // stale disposer cannot remove the replacement.
  assert.equal(await resources.browser!.navigate!({}), 'second')
  await assert.rejects(old({}), /capability retired/)
  runtime.dispose()
  assert.throws(() => runtime.register(registration('third')), /disposed/)
})

test('invalid/duplicate registration has no partial handlers or body schema', () => {
  const runtime = new CapabilityRuntime()
  runtime.register(registration('one'))
  const before = runtime.bodySchema.snapshot()
  assert.throws(() => runtime.register(registration('two')), /already registered/)
  assert.throws(() => runtime.register({ organId: 'bad', handlers: {
    'terminal.exec': async () => null, 'unknown.execute': async () => null,
  }, sideEffects: [] }), /outside the vocabulary/)
  assert.deepEqual(runtime.bodySchema.snapshot(), before)
  assert.equal(runtime.actions.has('terminal.exec'), false)
  assert.throws(() => runtime.register({ organId: 'bad-effect', handlers: { 'terminal.exec': async () => null },
    sideEffects: [{ kind: 'file', target: 'test', reversible: true }] }), /no reverse/)
  assert.deepEqual(runtime.bodySchema.snapshot(), before)
  runtime.dispose()
})

test('registration readers cannot mutate sets/schema/resources; listener failure does not leak ownership', () => {
  const runtime = new CapabilityRuntime()
  runtime.onChange(() => { throw new Error('observer failed') })
  const stop = runtime.register(registration('ok'))
  assert.equal('add' in runtime.actions, false)
  assert.equal('register' in runtime.bodySchema, false)
  assert.throws(() => { (runtime.bodySchema.snapshot().actions as string[]).push('terminal.exec') }, TypeError)
  assert.throws(() => { (runtime.resources.browser as Record<string, unknown>).navigate = () => null }, TypeError)
  stop()
  assert.equal(runtime.actions.size, 0)
})

for (const order of ['consumer-first', 'provider-first'] as const) {
  test(`Cordis ${order}: delayed Runtime injection, plugin unload/reload and live consumer`, async () => {
    const ctx = new Context()
    let seen!: RuntimeService
    const consumer = { name: 'test-consumer', inject: ['lykoiRuntime'], apply(ctx: Context) { seen = ctx.lykoiRuntime } }
    if (order === 'consumer-first') await ctx.plugin(consumer)
    const runtimeFiber = await ctx.plugin(runtimePlugin)
    if (order === 'provider-first') await ctx.plugin(consumer)
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(seen)
    const organ = { name: 'test-organ', inject: ['lykoiRuntime'], apply(ctx: Context) {
      ctx.effect(() => ctx.lykoiRuntime.register(registration('cordis')))
    } }
    const fiber = await ctx.plugin(organ)
    const held = seen.resources.browser!.navigate!
    assert.equal(await held({}), 'cordis')
    await fiber.dispose()
    assert.deepEqual(seen.bodySchema.snapshot().actions, [])
    await assert.rejects(held({}), /retired/)
    const replacement = await ctx.plugin(organ)
    assert.equal(await seen.resources.browser!.navigate!({}), 'cordis')
    await runtimeFiber.dispose()
    assert.equal(seen.actions.size, 0)
    await replacement.dispose()
  })
}

test('Cordis isolate scopes can register identical names under one root', async () => {
  const root = new Context()
  const a = root.isolate('lykoiRuntime'), b = root.isolate('lykoiRuntime')
  const fa = await a.plugin(runtimePlugin), fb = await b.plugin(runtimePlugin)
  a.lykoiRuntime.register(registration('a'))
  b.lykoiRuntime.register(registration('b'))
  assert.notEqual(a.lykoiRuntime, b.lykoiRuntime)
  assert.equal(await a.lykoiRuntime.resources.browser!.navigate!({}), 'a')
  assert.equal(await b.lykoiRuntime.resources.browser!.navigate!({}), 'b')
  await fa.dispose()
  assert.equal(await b.lykoiRuntime.resources.browser!.navigate!({}), 'b')
  await fb.dispose()
})

test('telemetry observes a complete registration and retirement', () => {
  const observed: boolean[] = []
  const runtime = new CapabilityRuntime(() => {
    const present = runtime.actions.has('browser.navigate')
    assert.equal(runtime.bodySchema.snapshot().actions.includes('browser.navigate'), present)
    assert.equal(isUnwiredHandler(runtime.resources.browser!.navigate!), !present)
    observed.push(present)
  })
  const stop = runtime.register(registration('one'))
  stop()
  assert.deepEqual(observed, [true, false])
  runtime.dispose()
})

test('quiesce refuses new work and waits for a late result before retirement', async () => {
  const runtime = new CapabilityRuntime()
  let finish!: (value: string) => void
  const outcome = runtime.run(() => new Promise<string>(resolve => { finish = resolve }))
  await Promise.resolve()
  let drained = false
  const closing = runtime.quiesce().then(() => { drained = true })
  await assert.rejects(runtime.run(async () => 'new'), /stopping/)
  assert.equal(drained, false)
  finish('owned result')
  assert.equal(await outcome, 'owned result')
  await closing
  assert.equal(drained, true)
})
