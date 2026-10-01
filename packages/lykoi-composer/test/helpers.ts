import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ComposerStore, ComponentRegistry, ComposerEngine, builtins } from '../src/index.ts'
import type { AgentDefinition, NodeDefinition } from '../src/contracts.ts'
import type { ResourceFactory } from '../src/engine.ts'

export const node = (id: string, component: string, config = {}): NodeDefinition => ({
  id,
  component,
  version: '1.0.0',
  config,
  resources: {},
  tools: []
})
export function definition(): AgentDefinition {
  const prompt = node('prompt', 'text.template', { template: 'v1: {{input}}' }),
    core = node('core', 'model.core', { system: 'test' })
  core.resources.model = 'model'
  return {
    id: 'test',
    name: 'Test Agent',
    nodes: [prompt, core, node('wait', 'human.wait', { prompt: 'confirm' }), node('output', 'output.value')],
    edges: [
      { from: 'prompt', to: 'core' },
      { from: 'core', to: 'wait' },
      { from: 'wait', to: 'output' }
    ],
    output: 'output',
    resources: [
      { id: 'model', type: 'model', config: { provider: 'demo' } },
      { id: 'files', type: 'workspace', config: {} }
    ],
    execution: { mode: 'single', maxActions: 2, timeoutMs: 5000 }
  }
}
export function fixture(resourceFactory?: ResourceFactory) {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-composer-'))
  const store = new ComposerStore(join(root, 'state.sqlite'), () => '2026-10-01T00:00:00.000Z')
  const registry = new ComponentRegistry((id, version) => store.required(id, version))
  const remove = new Map(builtins.map((c) => [c.id, registry.register(c)]))
  const engine = new ComposerEngine(store, registry, {
    workspaceRoot: join(root, 'workspaces'),
    resourceFactory
  })
  return {
    root,
    store,
    registry,
    engine,
    remove,
    async close() {
      await engine.close()
      store.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
}
