import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ComposerStore, ComponentRegistry, ComposerEngine } from '../../src/index.ts'
const root = process.argv[2]!
const store = new ComposerStore(join(root, 'state.sqlite'))
const registry = new ComponentRegistry()
registry.register({
  id: 'crash.effect',
  version: '1.0.0',
  title: 'crash',
  description: 'crash',
  kind: 'transform',
  effect: 'external',
  input: 'any',
  output: 'any',
  defaultConfig: {},
  resourceRoles: {},
  validate() {},
  invoke: async () => {
    writeFileSync(join(root, 'real-effect.txt'), 'published exactly once', { flag: 'wx', flush: true })
    process.kill(process.pid, 'SIGKILL')
    return { status: 'completed', value: 'unreachable' }
  }
})
store.saveDefinition(
  {
    id: 'crash',
    name: 'Crash',
    nodes: [
      { id: 'effect', component: 'crash.effect', version: '1.0.0', config: {}, resources: {}, tools: [] }
    ],
    edges: [],
    output: 'effect',
    resources: [],
    execution: { mode: 'single', maxActions: 0, timeoutMs: 5000 }
  },
  0,
  registry
)
const instance = store.createInstance('crash')
const engine = new ComposerEngine(store, registry, { workspaceRoot: join(root, 'workspaces') })
const run = engine.start(instance.id, 'publish')
writeFileSync(join(root, 'run-id.txt'), run.id, { flush: true })
await engine.idle(run.id)
