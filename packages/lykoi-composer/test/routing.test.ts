import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { fixture, node, definition } from './helpers.ts'
import { semanticRoutingPreset } from '../src/presets.ts'
import {
  ComposerEngine,
  ComposerStore,
  validateDefinition,
  jevModel,
  httpClient,
  compatibleModel
} from '../src/index.ts'
import { checkDecision, responseJson } from '../src/providers.ts'
import { ensureWorkspace } from '../src/builtins.ts'
import type { Config, Json, Model } from '../src/contracts.ts'
const ref = (node: string, ...path: string[]): Json => ({
  $ref: { node, path }
})
function answer(choice = 'fast', confidence = 0.9): Config {
  return {
    route: {
      type: 'choice',
      choice,
      confidence,
      probabilities: {
        fast: choice === 'fast' ? 0.95 : 0.05,
        deep: choice === 'deep' ? 0.95 : 0.05
      }
    }
  }
}
async function start(
  f: ReturnType<typeof fixture>,
  d = semanticRoutingPreset(),
  input: Json = { task: 'original task' }
) {
  f.store.saveDefinition(d, 0, f.registry)
  const instance = f.store.createInstance(d.id),
    r = f.engine.start(instance.id, input)
  await f.engine.idle(r.id)
  return f.store.run(r.id)
}
for (const route of ['fast', 'deep'])
  test(`semantic routing executes only ${route} and retains typed original input`, async () => {
    let decisions = 0,
      computations = 0
    const f = fixture(async (resource) =>
      resource.id === 'router'
        ? {
            async decide(state) {
              decisions++
              assert.equal(state, 'original task')
              return { answers: answer(route) }
            }
          }
        : ({
            async compute(messages) {
              computations++
              assert.equal(resource.id, route + '_model')
              assert.equal(messages[1].content, 'original task')
              return { kind: 'finish', result: route }
            }
          } as Model)
    )
    try {
      const run = await start(f)
      assert.equal(run.status, 'succeeded')
      assert.equal(run.result, route)
      assert.deepEqual(
        run.skipped?.sort(),
        [route === 'fast' ? 'deep' : 'fast', 'review'].sort()
      )
      assert.equal(decisions, 1)
      assert.equal(computations, 1)
      assert.equal(
        f.store
          .operations(run.id)
          .some((op) => run.skipped?.includes(op.nodeId)),
        false
      )
    } finally {
      await f.close()
    }
  })
test('low confidence human wait survives reopen without redoing decision or running unselected models', async () => {
  let decisions = 0
  const f = fixture(async (resource) =>
    resource.id === 'router'
      ? {
          async decide() {
            decisions++
            return { answers: answer('deep', 0.2) }
          }
        }
      : {
          async compute() {
            throw new Error('unselected model invoked')
          }
        }
  )
  try {
    const run = await start(f)
    assert.equal(run.status, 'waiting')
    assert.equal(run.wait?.nodeId, 'review')
    assert.match(run.wait!.prompt, /original task/)
    await f.engine.close()
    const reopened = new ComposerStore(join(f.root, 'state.sqlite'))
    const engine = new ComposerEngine(reopened, f.registry, {
      workspaceRoot: join(f.root, 'workspaces'),
      resourceFactory: async () => {
        throw new Error('replayed resource')
      }
    })
    try {
      await engine.recover()
      await engine.resolve(run.id, run.wait!.operationId, { approved: true })
      await engine.idle(run.id)
      assert.equal(reopened.run(run.id).status, 'succeeded')
      assert.deepEqual(reopened.run(run.id).result, { approved: true })
      assert.equal(decisions, 1)
      assert.deepEqual(reopened.run(run.id).skipped?.sort(), ['deep', 'fast'])
    } finally {
      await engine.close()
      reopened.close()
    }
  } finally {
    await f.close()
  }
})
test('decision failure uses explicit fallback; invalid input fails before provider call', async () => {
  let calls = 0
  const f = fixture(async () => ({
    async decide() {
      calls++
      throw new Error('unavailable')
    }
  }))
  try {
    const run = await start(f)
    assert.equal(run.status, 'waiting')
    assert.equal(run.wait?.nodeId, 'review')
    assert.deepEqual(run.outputs.decision, {
      answers: {},
      error: 'decision_unavailable'
    })
    const i = f.store.instances()[0],
      bad = f.engine.start(i.id, { task: 12 })
    await f.engine.idle(bad.id)
    assert.equal(f.store.run(bad.id).status, 'failed')
    assert.equal(calls, 1)
    assert.equal(f.store.run(bad.id).wait, undefined)
  } finally {
    await f.close()
  }
})
test('mutually exclusive merge rejects multiple active inputs rather than selecting an arbitrary result', async () => {
  const f = fixture()
  try {
    const d = definition()
    d.nodes = [
      node('a', 'output.value'),
      node('b', 'output.value'),
      node('merge', 'flow.merge')
    ]
    d.edges = [
      { from: 'a', to: 'merge' },
      { from: 'b', to: 'merge' }
    ]
    d.output = 'merge'
    const run = await start(f, d, 'x')
    assert.equal(run.status, 'failed')
    assert.match(run.error!, /multiple active/)
  } finally {
    await f.close()
  }
})
test('typed mappings, JSON parsing and single-pass template references compose without stringifying objects', async () => {
  const f = fixture()
  try {
    const d = definition()
    const parse = node('parse', 'data.transform', { mode: 'parse-json' }),
      map = node('map', 'data.transform', { mode: 'identity' }),
      template = node('text', 'text.template', {
        template: '{{input}} / {{nodes.parse.count}}'
      })
    map.input = { count: ref('parse', 'count'), flags: ref('parse', 'flags') }
    d.nodes = [parse, map, template]
    d.edges = [
      { from: 'parse', to: 'map' },
      { from: 'map', to: 'text' }
    ]
    d.output = 'text'
    const run = await start(f, d, '{"count":2,"flags":[true,false]}')
    assert.equal(run.status, 'succeeded')
    assert.deepEqual(run.outputs.map, { count: 2, flags: [true, false] })
    assert.equal(run.result, '{"count":2,"flags":[true,false]} / 2')
  } finally {
    await f.close()
  }
})
test('save rejects forward references, unlabeled conditional exits, capability mismatch and reserved ids', async () => {
  const f = fixture()
  try {
    for (const change of [
      (d: ReturnType<typeof semanticRoutingPreset>) => {
        d.nodes[1].input = ref('fast')
      },
      (d: ReturnType<typeof semanticRoutingPreset>) => {
        delete d.edges[2].branch
      },
      (d: ReturnType<typeof semanticRoutingPreset>) => {
        d.nodes[1].resources.model = 'fast_model'
      },
      (d: ReturnType<typeof semanticRoutingPreset>) => {
        d.nodes[0].id = 'constructor'
      },
      (d: ReturnType<typeof semanticRoutingPreset>) => {
        d.nodes[1].input = { $ref: { node: 'start', path: ['constructor'] } }
      }
    ]) {
      const d = semanticRoutingPreset()
      change(d)
      assert.throws(() => validateDefinition(d, f.registry))
    }
  } finally {
    await f.close()
  }
})
test('deterministic direct file tools work without model calls and still preserve action limits', async () => {
  const f = fixture()
  try {
    const d = definition()
    const writer = node('writer', 'workspace.write'),
      reader = node('reader', 'workspace.read')
    writer.invocation = reader.invocation = 'workflow'
    writer.resources.workspace = reader.resources.workspace = 'files'
    writer.input = { path: 'report.txt', content: ref('$input', 'task') }
    reader.input = { path: ref('writer', 'path') }
    d.nodes = [writer, reader]
    d.edges = [{ from: 'writer', to: 'reader' }]
    d.output = 'reader'
    const run = await start(f, d, { task: 'deterministic content' })
    assert.equal(run.status, 'succeeded')
    assert.equal(run.result, 'deterministic content')
    assert.equal(
      readFileSync(
        join(f.root, 'workspaces', run.instanceId, 'files', 'report.txt'),
        'utf8'
      ),
      'deterministic content'
    )
    d.execution.maxActions = 1
    f.store.saveDefinition(d, 1, f.registry)
    const i = f.store.createInstance(d.id),
      capped = f.engine.start(i.id, { task: 'limit' })
    await f.engine.idle(capped.id)
    assert.equal(f.store.run(capped.id).status, 'failed')
    assert.match(f.store.run(capped.id).error!, /budget/)
  } finally {
    await f.close()
  }
})
test('JEV adapter sends official state/questions shape and validates decision receipts', async () => {
  let request: any, url: any
  const model = jevModel(
    { baseUrl: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
    'fixture-key',
    (async (u, init) => {
      url = u
      request = init
      return Response.json({ model: 'jev-test', answers: answer() })
    }) as typeof fetch
  )
  const q = semanticRoutingPreset().nodes[1].config.questions as Config
  const value = await model.decide(
    { task: 'x' },
    q,
    new AbortController().signal
  )
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone')
  assert.equal(request.redirect, 'error')
  assert.deepEqual(JSON.parse(request.body), {
    model: 'jev-latest',
    state: { task: 'x' },
    questions: q
  })
  assert.equal(request.headers.authorization, 'Bearer fixture-key')
  assert.ok(!request.body.includes('fixture-key'))
  assert.deepEqual((value as Config).answers, answer())
  const undeclared = answer()
  ;(undeclared.route as Config).choice = 'undeclared'
  assert.throws(() => checkDecision({ answers: undeclared }, q), /undeclared/)
  const invalid = answer()
  ;(invalid.route as Config).confidence = 2
  assert.throws(() => checkDecision({ answers: invalid }, q), /confidence/)
  await assert.rejects(responseJson(new Response('x'.repeat(1048577))), /1 MiB/)
})
test('HTTP resource bounds credential destination, blocks redirects and accepts JSON responses', async () => {
  let request: any,
    url: any,
    calls = 0
  const http = httpClient(
    { baseUrl: 'https://example.test/api' },
    'fixture-key',
    (async (u, init) => {
      calls++
      url = u
      request = init
      return Response.json({ ok: true })
    }) as typeof fetch
  )
  const signal = new AbortController().signal
  assert.deepEqual(
    await http.request('search?q=a', 'POST', { query: 'a' }, signal),
    { ok: true }
  )
  assert.equal(String(url), 'https://example.test/api/search?q=a')
  assert.equal(request.redirect, 'error')
  for (const path of [
    'https://foreign.test/',
    '//foreign.test',
    '../escape',
    '\\foreign.test'
  ])
    await assert.rejects(http.request(path, 'GET', null, signal), /resource/)
  assert.equal(calls, 1)
})
test('Core JSON output validates schema and human callbacks reject wrong field types', async () => {
  const f = fixture(
    async () =>
      ({
        async compute() {
          return { kind: 'finish', result: '{"action":"approve"}' }
        }
      }) as Model
  )
  try {
    const d = definition()
    d.nodes = d.nodes.slice(1)
    d.edges = [
      { from: 'core', to: 'wait' },
      { from: 'wait', to: 'output' }
    ]
    const schema = {
      type: 'object',
      properties: { action: { type: 'string', enum: ['approve', 'reject'] } },
      required: ['action'],
      additionalProperties: false
    }
    d.nodes[0].config.outputFormat = 'json'
    d.nodes[0].config.outputSchema = schema
    d.nodes[1].config.schema = schema
    const run = await start(f, d, 'task')
    assert.deepEqual(run.outputs.core, { action: 'approve' })
    await assert.rejects(
      f.engine.resolve(run.id, run.wait!.operationId, { action: 'other' }),
      /enum/
    )
    await f.engine.resolve(run.id, run.wait!.operationId, { action: 'reject' })
    await f.engine.idle(run.id)
    assert.deepEqual(f.store.run(run.id).result, { action: 'reject' })
    let payload: any
    const compatible = compatibleModel(
      { baseUrl: 'http://localhost/v1', model: 'json' },
      undefined,
      (async (_u, init: any) => {
        payload = JSON.parse(init.body)
        return Response.json({ choices: [{ message: { content: '{}' } }] })
      }) as typeof fetch
    )
    await compatible.compute([], [], new AbortController().signal, {
      json: true
    })
    assert.deepEqual(payload.response_format, { type: 'json_object' })
  } finally {
    await f.close()
  }
})
test('unselected workflow tools have no operation intention and cannot produce side effects', async () => {
  let f: ReturnType<typeof fixture>
  f = fixture(async (r, instance) =>
    r.type === 'workspace'
      ? ensureWorkspace(join(f.root, 'workspaces', instance, r.id))
      : {
          async decide() {
            return { answers: answer() }
          }
        }
  )
  try {
    const d = semanticRoutingPreset(),
      writer = node('deep', 'workspace.write')
    writer.invocation = 'workflow'
    writer.resources.workspace = 'files'
    writer.input = { path: 'unexpected.txt', content: 'must not run' }
    d.nodes = d.nodes.map((n) =>
      n.id === 'deep'
        ? writer
        : n.id === 'fast'
          ? node('fast', 'output.value')
          : n
    )
    d.resources.push({ id: 'files', type: 'workspace', config: {} })
    const run = await start(f, d)
    assert.equal(run.status, 'succeeded')
    assert.ok(run.skipped?.includes('deep'))
    assert.equal(
      f.store.operations(run.id).some((o) => o.nodeId === 'deep'),
      false
    )
  } finally {
    await f.close()
  }
})

test('an interrupted decision requires a verified native receipt and is never automatically reissued', async () => {
  let factories = 0
  const f = fixture(async () => {
    factories++
    throw new Error('unexpected replay')
  })
  try {
    const d = semanticRoutingPreset()
    f.store.saveDefinition(d, 0, f.registry)
    const i = f.store.createInstance(d.id),
      r = f.store.createRun(i.id, { task: 'original task' })
    f.store.editRun(r.id, (run) => {
      run.status = 'running'
      run.outputs.start = run.input
    })
    const operationId = `${r.id}:decision:invoke`
    f.store.startOperation({
      id: operationId,
      runId: r.id,
      nodeId: 'decision',
      component: 'model.decision',
      version: '1.0.0',
      input: 'original task',
      status: 'started'
    })
    await f.engine.recover()
    assert.equal(f.store.run(r.id).wait?.reason, 'unknown')
    await assert.rejects(
      f.engine.resolve(r.id, operationId, { kind: 'finish', result: 'route' }),
      /answers/
    )
    await f.engine.resolve(r.id, operationId, { answers: answer('fast', 0.2) })
    await f.engine.idle(r.id)
    assert.equal(f.store.run(r.id).wait?.nodeId, 'review')
    assert.equal(factories, 0)
    await f.engine.resolve(
      r.id,
      f.store.run(r.id).wait!.operationId,
      'verified final result'
    )
    await f.engine.idle(r.id)
    assert.equal(f.store.run(r.id).status, 'succeeded')
    assert.equal(
      f.store.operations(r.id).filter((op) => op.nodeId === 'decision').length,
      1
    )
  } finally {
    await f.close()
  }
})
