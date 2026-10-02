import type { AgentDefinition, Json, NodeDefinition } from './contracts.ts'
const ref = (node: string, ...path: string[]): Json => ({
  $ref: { node, path }
})
const node = (
  id: string,
  component: string,
  config: NodeDefinition['config'] = {}
): NodeDefinition => ({
  id,
  component,
  version: '1.0.0',
  config,
  resources: {},
  tools: []
})
export function semanticRoutingPreset(): AgentDefinition {
  const start = node('start', 'flow.input', {
    schema: {
      type: 'object',
      properties: { task: { type: 'string' } },
      required: ['task'],
      additionalProperties: false
    }
  })
  const decision = node('decision', 'model.decision', {
    questions: {
      route: {
        type: 'choice',
        instructions: '判断任务应该由哪条路线处理。',
        criteria: {
          fast: '简单问答与短文本处理',
          deep: '需要多步推理的复杂任务'
        }
      }
    },
    onError: 'fallback'
  })
  decision.resources.model = 'router'
  decision.input = ref('start', 'task')
  const branch = node('route', 'flow.branch', {
    cases: ['fast', 'deep'].map((id) => ({
      id,
      conditions: [
        { path: ['answers', 'route', 'confidence'], op: 'gte', value: 0.7 },
        { path: ['answers', 'route', 'choice'], op: 'eq', value: id }
      ]
    })),
    default: 'review'
  })
  const fast = node('fast', 'model.core', { system: '简洁回答用户任务。' }),
    deep = node('deep', 'model.core', {
      system: '认真分析用户任务，给出有依据的回答。'
    })
  for (const n of [fast, deep]) {
    n.resources.model = n.id + '_model'
    n.input = ref('start', 'task')
  }
  const review = node('review', 'human.wait', {
    prompt:
      '决策不确定或服务不可用，请检查任务并提供最终结果：\n{{nodes.start.task}}'
  })
  const merge = node('merge', 'flow.merge'),
    output = node('output', 'output.value')
  return {
    id: 'semantic_routing',
    name: '语义路由 · 手动决策演示',
    nodes: [start, decision, branch, fast, deep, review, merge, output],
    edges: [
      { from: 'start', to: 'decision' },
      { from: 'decision', to: 'route' },
      ...['fast', 'deep', 'review'].map((id) => ({
        from: 'route',
        to: id,
        branch: id
      })),
      ...['fast', 'deep', 'review'].map((id) => ({ from: id, to: 'merge' })),
      { from: 'merge', to: 'output' }
    ],
    output: 'output',
    resources: [
      {
        id: 'router',
        type: 'model',
        config: {
          provider: 'decision-fixture',
          answers: {
            route: {
              type: 'choice',
              choice: 'fast',
              confidence: 0.9,
              probabilities: { fast: 0.95, deep: 0.05 }
            }
          }
        }
      },
      { id: 'fast_model', type: 'model', config: { provider: 'demo' } },
      { id: 'deep_model', type: 'model', config: { provider: 'demo' } }
    ],
    execution: { mode: 'single', maxActions: 4, timeoutMs: 60000 }
  }
}
