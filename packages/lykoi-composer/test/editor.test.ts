import test from 'node:test'
import assert from 'node:assert/strict'
import { definition, fixture } from './helpers.ts'
import { validateDefinition } from '../src/index.ts'
// Browser-native JS module; imported dynamically to keep the project's TS scope unchanged.
const graph = await import(
  new URL('../public/graph-editor.js', import.meta.url).href
)

test('editor admission matches runtime type/cycle constraints and preserves branch topology', async () => {
  const f = fixture()
  try {
    const d = definition()
    const spec = (node: (typeof d.nodes)[number]) =>
      f.registry.get(node.component, node.version)
    assert.match(
      graph.connectionError(
        d,
        (n: (typeof d.nodes)[number]) => ({
          ...spec(n),
          input: n.id === 'prompt' ? 'text' : spec(n).input
        }),
        'output',
        'prompt'
      ),
      /类型不兼容/
    )
    assert.match(graph.connectionError(d, spec, 'output', 'core'), /环路/)
    assert.equal(graph.connectionError(d, spec, 'prompt', 'wait'), '')
    d.edges = d.edges.filter((edge) => edge.to !== 'wait')
    d.edges.push({ from: 'prompt', to: 'wait' })
    d.editor = {
      positions: graph.arrangeGraph(d, spec),
      viewport: { x: 0, y: 0, zoom: 0.7 }
    }
    const saved = f.store.saveDefinition(d, 0, f.registry)
    assert.equal(
      saved.definition.edges.filter((edge) => edge.from === 'prompt').length,
      2
    )
    assert.deepEqual(f.store.definition(d.id).definition.editor, d.editor)
    const instance = f.store.createInstance(d.id)
    const run = f.engine.start(instance.id, 'hello')
    await f.engine.idle(run.id)
    assert.equal(f.store.run(run.id).status, 'waiting')
    const pinned = structuredClone(
      f.store.run(run.id).version.definition.editor
    )
    d.editor.positions.core.x = 999
    f.store.saveDefinition(d, 1, f.registry)
    assert.deepEqual(
      f.store.run(run.id).version.definition.editor,
      pinned,
      'editing layout cannot mutate a pinned run'
    )
    for (const editor of [
      {
        positions: { absent: { x: 0, y: 0 } },
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      { positions: {}, viewport: { x: 0, y: 0, zoom: 0 } },
      {
        positions: { core: { x: 'bad', y: 0 } },
        viewport: { x: 0, y: 0, zoom: 1 }
      }
    ])
      assert.throws(
        () => validateDefinition({ ...d, editor }, f.registry),
        /editor geometry/
      )
  } finally {
    await f.close()
  }
})

test('zoom anchors the pointer in graph space and clamps extreme wheel input', () => {
  const viewport = { x: -120, y: 50, zoom: 0.5 },
    pointer = { x: 480, y: 200 }
  const world = graph.toWorld(pointer, viewport)
  assert.deepEqual(
    graph.toWorld(pointer, graph.zoomViewport(viewport, pointer, 2)),
    world
  )
  assert.equal(graph.zoomViewport(viewport, pointer, 1e20).zoom, 1.8)
  assert.equal(graph.zoomViewport(viewport, pointer, 1e-20).zoom, 0.25)
})
