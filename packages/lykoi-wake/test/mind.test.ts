import test from 'node:test'
import assert from 'node:assert/strict'
import { join, dirname } from 'node:path'
import { MindStore } from 'lykoi-runtime/mind'
import { wakeOnce } from '../src/index.ts'
import { makeStore, makeWakeDeps, T0 } from './fixture.ts'

test('pure episodes continue with zero actions, survive restart and consume later evidence', async () => {
  const { store, path } = makeStore(), mindPath = join(dirname(path), 'mind.sqlite')
  let mind = new MindStore(mindPath, () => T0), calls = 0
  const run = async () => {
    const { deps } = makeWakeDeps({ store, reply: '{}', overrides: {
      mind, runIdFn: () => `mind-run-${calls}`, maxActions: 0, dispatchFn: async () => { throw new Error('pure thought must not dispatch') },
      llm: async messages => {
        calls++
        const context = messages.map(m => m.content).join('\n')
        const previous = mind.view().records[0]
        if (previous) assert.ok(context.includes(previous.understanding))
        const event = mind.view().events[0]
        const understanding = event ? '第二案例推翻统一流程假设，应保留领域差异' : calls === 1 ? '发现共同模式，尚需比较' : '共同模式可能只适用于部分领域'
        return { content: JSON.stringify({ decision: { kind: 'contemplate', reason: '继续未解决的问题' }, mind: {
          records: [{ id: 'methods', revision: previous?.revision ?? 0, kind: 'thought', topic: '是否可泛化', understanding,
            open: '待比较', evidence: event ? ['case:A', event.id] : ['case:A'], links: [], status: 'open', reconsiderAt: null, basis: 'inferred', scope: '方法研究' }],
          acknowledge: event ? [event.id] : [], continue: calls === 1,
        } }) }
      },
    } })
    return wakeOnce(deps)
  }
  try {
    assert.equal((await run()).status, 'completed'); assert.equal(calls, 2)
    mind.close(); mind = new MindStore(mindPath, () => T0)
    mind.receive({ id: 'case:B', source: 'task', reference: 'task:B', content: '不同领域流程相反', createdAt: T0.toISOString() })
    assert.equal((await run()).status, 'completed'); assert.equal(calls, 3)
    assert.equal(mind.view().events.length, 0)
    assert.ok(mind.view().records[0]!.understanding.includes('推翻'))
    assert.equal(store.autonomyActionsLastHour({ now: T0 }), 0)
  } finally { mind.close(); store.close() }
})
