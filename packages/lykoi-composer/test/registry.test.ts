import test from 'node:test'
import assert from 'node:assert/strict'
import { definition, fixture } from './helpers.ts'
import { validateDefinition, ComponentRegistry, builtins } from '../src/index.ts'

test('definition validation rejects cycles, duplicate inputs, missing resources and embedded credentials', async () => {
  const f = fixture()
  try {
    const d = definition()
    validateDefinition(d, f.registry)
    for (const corrupt of [
      () => {
        const x = structuredClone(d)
        x.edges.push({ from: 'output', to: 'prompt' })
        return x
      },
      () => {
        const x = structuredClone(d)
        x.edges.push({ from: 'output', to: 'core' })
        return x
      },
      () => {
        const x = structuredClone(d)
        x.nodes[1].resources.model = 'missing'
        return x
      },
      () => {
        const x = structuredClone(d)
        x.resources[0].config.apiKey = 'never-store-this'
        return x
      },
      () => {
        const x = structuredClone(d)
        x.resources[1].config.root = '/other-instance'
        return x
      },
      () => {
        const x = structuredClone(d)
        x.nodes[0].tools = ['core']
        return x
      }
    ])
      assert.throws(() => validateDefinition(corrupt(), f.registry))
    const v = f.store.saveDefinition(d, 0, f.registry)
    v.definition.nodes[0].config.template = 'mutated'
    assert.equal(f.store.definition('test').definition.nodes[0].config.template, 'v1: {{input}}')
  } finally {
    await f.close()
  }
})

test('registration metadata is immutable, duplicates roll back, and held handlers retire with their provider', async () => {
  const registry = new ComponentRegistry(),
    component = { ...builtins[0], defaultConfig: { template: 'before' } }
  const dispose = registry.register(component),
    held = registry.get(component.id, component.version)
  component.defaultConfig.template = 'after'
  assert.equal(held.defaultConfig.template, 'before')
  assert.throws(() => {
    held.defaultConfig.template = 'bad'
  }, TypeError)
  assert.throws(() => registry.register(component), /duplicate/)
  assert.equal(registry.catalog().length, 1)
  dispose()
  dispose()
  await assert.rejects(
    held.invoke!(
      'input',
      { template: '{{input}}' },
      {
        instanceId: 'i',
        runId: 'r',
        operationId: 'o',
        signal: new AbortController().signal,
        resource() {
          throw new Error('none')
        }
      }
    ),
    /retired/
  )
})

test('controlled uninstall refuses unfinished runs but succeeds after cancellation', async () => {
  const f = fixture()
  try {
    f.store.saveDefinition(definition(), 0, f.registry)
    const i = f.store.createInstance('test'),
      r = f.engine.start(i.id, 'go')
    await f.engine.idle(r.id)
    assert.throws(f.remove.get('model.core')!, /unfinished/)
    f.engine.cancel(r.id)
    f.remove.get('model.core')!()
    assert.throws(() => f.engine.start(i.id, 'go'), /unavailable/)
  } finally {
    await f.close()
  }
})
