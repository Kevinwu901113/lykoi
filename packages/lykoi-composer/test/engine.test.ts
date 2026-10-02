import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComposerStore, ComposerEngine, compatibleModel } from '../src/index.ts'
import { ensureWorkspace } from '../src/builtins.ts'
import { createApi } from '../src/server.ts'
import type { Model, Json } from '../src/contracts.ts'
import { definition, fixture, node } from './helpers.ts'

test('definition revisions conflict correctly; old run keeps its version and wait survives database reopen', async () => {
  const f = fixture()
  try {
    const d = definition()
    f.store.saveDefinition(d, 0, f.registry)
    const instance = f.store.createInstance(d.id),
      run = f.engine.start(instance.id, 'topic')
    await f.engine.idle(run.id)
    assert.equal(f.store.run(run.id).status, 'waiting')
    assert.match(String(f.store.run(run.id).outputs.core), /v1: topic/)
    d.nodes[0].config.template = 'v2: {{input}}'
    f.store.saveDefinition(d, 1, f.registry)
    assert.throws(() => f.store.saveDefinition(d, 1, f.registry), /conflict/)
    assert.equal(f.store.run(run.id).version.revision, 1)
    await f.engine.close()
    // Separate connection and engine reconstruct from disk, not the old engine's maps.
    const reopened = new ComposerStore(join(f.root, 'state.sqlite'))
    const engine = new ComposerEngine(reopened, f.registry, {
      workspaceRoot: join(f.root, 'workspaces')
    })
    try {
      await engine.recover()
      const waiting = reopened.run(run.id)
      await engine.resolve(
        run.id,
        waiting.wait!.operationId,
        'verified old result'
      )
      await engine.idle(run.id)
      assert.equal(reopened.run(run.id).result, 'verified old result')
      assert.equal(reopened.run(run.id).version.revision, 1)
      const newer = engine.start(instance.id, 'topic')
      await engine.idle(newer.id)
      assert.equal(reopened.run(newer.id).version.revision, 2)
      assert.match(String(reopened.run(newer.id).outputs.core), /v2: topic/)
    } finally {
      await engine.close()
      reopened.close()
    }
  } finally {
    await f.close()
  }
})

test('callbacks deduplicate, reject foreign operations, and preserve pause until explicit resume', async () => {
  const f = fixture()
  try {
    f.store.saveDefinition(definition(), 0, f.registry)
    const instance = f.store.createInstance('test'),
      a = f.engine.start(instance.id, 'a'),
      b = f.engine.start(instance.id, 'b')
    await Promise.all([f.engine.idle(a.id), f.engine.idle(b.id)])
    const operation = f.store.run(a.id).wait!.operationId
    await assert.rejects(
      f.engine.resolve(b.id, operation, 'foreign'),
      /ownership/
    )
    f.engine.pause(a.id)
    await f.engine.resolve(a.id, operation, 'ok')
    assert.equal(f.store.run(a.id).status, 'paused')
    await f.engine.resolve(a.id, operation, 'ok')
    await assert.rejects(
      f.engine.resolve(a.id, operation, 'changed'),
      /conflicts/
    )
    await f.engine.resume(a.id)
    await f.engine.idle(a.id)
    assert.equal(f.store.run(a.id).result, 'ok')
    await f.engine.resolve(a.id, operation, 'ok') // Repeated delivery after completion is still acknowledged.
    assert.equal(
      f.store.traces(a.id).filter((e) => e.type === 'operation.resolved')
        .length,
      1
    )
  } finally {
    await f.close()
  }
})

test('single computation does not expose tools; bounded execution writes only its own instance workspace', async () => {
  const rootByInstance = new Map<string, string>()
  let offers: number[] = []
  let f: ReturnType<typeof fixture>
  f = fixture(async (resource, instanceId) => {
    if (resource.type === 'workspace') {
      const root = join(f.root, 'workspaces', instanceId, resource.id)
      rootByInstance.set(instanceId, root)
      return ensureWorkspace(root)
    }
    return {
      compute: async (messages, tools) => {
        offers.push(tools.length)
        if (messages.some((m) => m.role === 'tool') || !tools.length)
          return { kind: 'finish', result: instanceId }
        return {
          kind: 'act',
          action: {
            tool: tools[0].name,
            input: { path: 'report.txt', content: instanceId },
            callId: 'call-1'
          }
        }
      }
    } as Model
  })
  try {
    const d = definition()
    d.nodes = d.nodes.filter((n) => n.id !== 'wait')
    d.edges = [
      { from: 'prompt', to: 'core' },
      { from: 'core', to: 'output' }
    ]
    const writer = node('writer', 'workspace.write')
    writer.resources.workspace = 'files'
    d.nodes.push(writer)
    d.nodes[1].tools = ['writer']
    f.store.saveDefinition(d, 0, f.registry)
    const a = f.store.createInstance('test', 'instanceA'),
      b = f.store.createInstance('test', 'instanceB')
    const single = f.engine.start(a.id, 'hello')
    await f.engine.idle(single.id)
    assert.deepEqual(offers, [0])
    assert.equal(rootByInstance.size, 0)
    d.execution.mode = 'tools'
    f.store.saveDefinition(d, 1, f.registry)
    offers = []
    const ra = f.engine.start(a.id, 'hello'),
      rb = f.engine.start(b.id, 'hello')
    await Promise.all([f.engine.idle(ra.id), f.engine.idle(rb.id)])
    assert.equal(f.store.run(ra.id).status, 'succeeded')
    assert.equal(f.store.run(rb.id).status, 'succeeded')
    assert.equal(
      readFileSync(join(rootByInstance.get(a.id)!, 'report.txt'), 'utf8'),
      a.id
    )
    assert.equal(
      readFileSync(join(rootByInstance.get(b.id)!, 'report.txt'), 'utf8'),
      b.id
    )
    assert.notEqual(rootByInstance.get(a.id), rootByInstance.get(b.id))
  } finally {
    await f.close()
  }
})

test('two Cores share an explicitly bound instance resource; total action cap applies across Cores', async () => {
  let factories = 0,
    actions = 0
  const f = fixture(async () => {
    factories++
    return {
      compute: async (messages, tools) => {
        if (!tools.length || messages.some((m) => m.role === 'tool'))
          return { kind: 'finish', result: 'done' }
        return {
          kind: 'act',
          action: { tool: tools[0].name, input: null, callId: 'call' }
        }
      }
    } as Model
  })
  try {
    f.registry.register({
      id: 'test.tool',
      version: '1.0.0',
      title: 'test',
      description: 'test',
      kind: 'tool',
      effect: 'external',
      input: 'any',
      output: 'any',
      defaultConfig: {},
      resourceRoles: {},
      validate() {},
      invoke: async () => {
        actions++
        return { status: 'completed', value: 'receipt' }
      }
    })
    const coreA = node('a', 'model.core', { system: 'a' }),
      coreB = node('b', 'model.core', { system: 'b' })
    coreA.resources.model = coreB.resources.model = 'model'
    coreA.tools = coreB.tools = ['tool']
    const d = definition()
    d.nodes = [coreA, coreB, node('tool', 'test.tool')]
    d.edges = [{ from: 'a', to: 'b' }]
    d.output = 'b'
    d.execution = { mode: 'tools', maxActions: 1, timeoutMs: 5000 }
    f.store.saveDefinition(d, 0, f.registry)
    const i = f.store.createInstance('test'),
      r = f.engine.start(i.id, 'go')
    await f.engine.idle(r.id)
    assert.equal(f.store.run(r.id).status, 'succeeded')
    assert.equal(actions, 1)
    assert.equal(factories, 1)
    const other = f.store.createInstance('test'),
      r2 = f.engine.start(other.id, 'go')
    await f.engine.idle(r2.id)
    assert.equal(factories, 2)
  } finally {
    await f.close()
  }
})

test('malicious or nonconverging model cannot exceed action budget or invoke an unbound tool', async () => {
  let actions = 0
  const f = fixture(
    async () =>
      ({
        compute: async () => ({
          kind: 'act',
          action: { tool: 'tool', input: null, callId: 'call' }
        })
      }) as Model
  )
  try {
    f.registry.register({
      id: 'test.tool',
      version: '1.0.0',
      title: 'tool',
      description: 'tool',
      kind: 'tool',
      effect: 'external',
      input: 'any',
      output: 'any',
      defaultConfig: {},
      resourceRoles: {},
      validate() {},
      invoke: async () => {
        actions++
        return { status: 'completed', value: null }
      }
    })
    const d = definition()
    d.nodes = [d.nodes[1], node('tool', 'test.tool')]
    d.edges = []
    d.output = 'core'
    d.nodes[0].tools = ['tool']
    d.execution.mode = 'tools'
    d.execution.maxActions = 2
    f.store.saveDefinition(d, 0, f.registry)
    const i = f.store.createInstance('test'),
      r = f.engine.start(i.id, 'go')
    await f.engine.idle(r.id)
    assert.equal(actions, 2)
    assert.equal(f.store.run(r.id).status, 'failed')
    assert.match(f.store.run(r.id).error!, /budget/)
    d.nodes[0].tools = []
    f.store.saveDefinition(d, 1, f.registry)
    const unbound = f.engine.start(i.id, 'go')
    await f.engine.idle(unbound.id)
    assert.equal(actions, 2)
    assert.match(f.store.run(unbound.id).error!, /outside/)
  } finally {
    await f.close()
  }
})

test('pause allows an admitted result to commit but prevents the next component call; cancel stays terminal', async () => {
  let release: ((value: Json) => void) | undefined,
    started: (() => void) | undefined
  const admitted = new Promise<void>((r) => {
    started = r
  })
  const f = fixture()
  try {
    f.registry.register({
      id: 'test.slow',
      version: '1.0.0',
      title: 'slow',
      description: 'slow',
      kind: 'transform',
      effect: 'external',
      input: 'any',
      output: 'any',
      defaultConfig: {},
      resourceRoles: {},
      validate() {},
      invoke: async () => {
        started!()
        return {
          status: 'completed',
          value: await new Promise<Json>((r) => {
            release = r
          })
        }
      }
    })
    const d = definition()
    d.nodes = [node('slow', 'test.slow'), node('output', 'output.value')]
    d.edges = [{ from: 'slow', to: 'output' }]
    f.store.saveDefinition(d, 0, f.registry)
    const i = f.store.createInstance('test'),
      r = f.engine.start(i.id, 'go')
    await admitted
    f.engine.pause(r.id)
    release!('late receipt')
    await f.engine.idle(r.id)
    assert.equal(f.store.run(r.id).status, 'paused')
    assert.equal(f.store.run(r.id).outputs.slow, 'late receipt')
    assert.equal(f.store.run(r.id).outputs.output, undefined)
    f.engine.cancel(r.id)
    await assert.rejects(f.engine.resume(r.id), /pending|terminal/)
    assert.equal(f.store.run(r.id).status, 'cancelled')
  } finally {
    await f.close()
  }
})

test('deadline produces a durable unknown receipt, and shutdown does not hang on an unresponsive provider', async () => {
  const f = fixture(
    async () => ({ compute: () => new Promise(() => {}) }) as Model
  )
  try {
    const d = definition()
    d.execution.timeoutMs = 100
    f.store.saveDefinition(d, 0, f.registry)
    const i = f.store.createInstance('test'),
      r = f.engine.start(i.id, 'go')
    await f.engine.idle(r.id)
    assert.equal(f.store.run(r.id).status, 'waiting')
    assert.equal(f.store.run(r.id).wait!.reason, 'unknown')
    assert.ok((f.store.run(r.id).activeMs ?? 0) >= 80)
    await f.engine.close()
  } finally {
    await f.close()
  }
})

test('HTTP-independent API covers catalog → version → instance → run → wait → output', async () => {
  const f = fixture()
  try {
    const api = createApi(f.store, f.registry, f.engine)
    assert.equal(((await api('GET', '/api/catalog')) as unknown[]).length, 12)
    await api('POST', '/api/definitions', {
      definition: definition(),
      expectedRevision: 0
    })
    const instance = (await api('POST', '/api/instances', {
      agentId: 'test'
    })) as { id: string }
    const run = (await api('POST', '/api/runs', {
      instanceId: instance.id,
      input: 'hello'
    })) as {
      id: string
    }
    await f.engine.idle(run.id)
    const state = (await api('GET', `/api/runs/${run.id}`)) as any
    await api('POST', `/api/runs/${run.id}/resolve`, {
      operationId: state.run.wait.operationId,
      value: 'confirmed'
    })
    await f.engine.idle(run.id)
    assert.equal(f.store.run(run.id).result, 'confirmed')
    assert.ok(
      ((await api('GET', `/api/runs/${run.id}/trace`)) as unknown[]).length > 5
    )
  } finally {
    await f.close()
  }
})

test('OpenAI-compatible adapter keeps native tool frames and passes the deployment credential only to HTTP headers', async () => {
  let seen: any
  const fetcher = (async (_url: unknown, init: any) => {
    seen = init
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: 'c1',
                  function: {
                    name: 'write',
                    arguments: '{"path":"a","content":"b"}'
                  }
                }
              ]
            }
          }
        ]
      })
    )
  }) as typeof fetch
  const model = compatibleModel(
    { baseUrl: 'http://localhost/v1', model: 'test' },
    'test-only-key',
    fetcher
  )
  const result = await model.compute(
    [{ role: 'tool', content: 'receipt', tool_call_id: 'previous' }],
    [{ name: 'write', description: 'write', parameters: { type: 'object' } }],
    new AbortController().signal
  )
  assert.equal(result.kind, 'act')
  assert.equal(seen.headers.authorization, 'Bearer test-only-key')
  assert.equal(JSON.parse(seen.body).messages[0].role, 'tool')
  assert.ok(!seen.body.includes('test-only-key'))
})
