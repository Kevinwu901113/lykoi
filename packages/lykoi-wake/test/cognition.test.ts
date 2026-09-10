import test from 'node:test'
import assert from 'node:assert/strict'
import { wakeOnce } from '../src/index.ts'
import { T0, makeStore, makeWakeDeps } from './fixture.ts'

test('Wake reads an actual observation, chooses a next action, and persists its resulting thought', async () => {
  const { store } = makeStore()
  const id = store.createConcern('interest', '观察试验', { weight: 0.5, origin: 'seed', now: T0 })
  let requests = 0, actions = 0
  const { deps } = makeWakeDeps({ store, reply: '{}', overrides: {
    wiredActions: new Set(['research_browser.read_text']),
    capabilities: () => [{ name: 'research_browser.read_text', description: 'Read a page', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }],
    dispatchFn: async () => { actions++; return { success: true, data: { text: '实测结果：样品为青色，编号 OBS_741' } } },
    llm: async messages => {
      requests++
      const observed = messages.some(m => m.content.includes('OBS_741'))
      return { content: JSON.stringify({ meaning_assessment: [{ item: '观察试验', meaning: '理解实际样品', concern_id: id, pull: 0.5 }],
        decision: observed ? { kind: 'record_note', content: 'OBS_741 样品实际为青色', reason: '观察试验有了结果' } : { kind: 'tool_call', tool: { name: 'research_browser.read_text', arguments: { url: 'https://example.org/sample' } }, reason: '观察试验需要读取资料' },
        ...(observed ? { inner: { thoughts: [{ content: 'OBS_741 的实测颜色是青色', kind: 'observation' }], resolve: [] } } : {}),
      }) }
    },
  } })
  try {
    const result = await wakeOnce(deps)
    assert.equal(result.status, 'completed'); assert.equal(requests, 2); assert.equal(actions, 1)
    assert.ok(store.openThoughts().some(t => t.content.includes('OBS_741')))
    assert.ok(store.recentExperiences(10).some(e => e.content.includes('OBS_741')))
  } finally { store.close() }
})
