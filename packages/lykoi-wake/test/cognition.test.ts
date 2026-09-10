import test from 'node:test'
import assert from 'node:assert/strict'
import { wakeOnce } from '../src/index.ts'
import { T0, makeStore, makeWakeDeps, rawOpen } from './fixture.ts'

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


for (const maxActions of [0, 1]) for (const closingKind of ['record_note', 'tool_call']) {
  test(`budget ${maxActions}: unexecuted closing ${closingKind} is not persisted as the actual decision`, async () => {
    const { store, path } = makeStore()
    const id = store.createConcern('interest', '观察试验', { weight: 0.5, origin: 'seed', now: T0 })
    let requests = 0, calls = 0
    const { deps, log } = makeWakeDeps({ store, reply: '{}', overrides: {
      maxActions,
      wiredActions: new Set(['specimen.lookup']),
      capabilities: () => [{ name: 'specimen.lookup', description: 'Read specimen', inputSchema: { type: 'object' } }],
      dispatchFn: async () => { calls++; return { success: true, data: { observed: 'ACTUAL' } } },
      llm: async () => {
        requests++
        const closing = requests > maxActions
        return { content: JSON.stringify({ meaning_assessment: [{ item: '观察试验', meaning: '读取实际观察', concern_id: id, pull: 0.5 }],
          decision: { kind: closing ? closingKind : 'tool_call', content: closing ? 'UNEXECUTED_CLOSING' : 'ACTUAL',
            tool: { name: 'specimen.lookup', arguments: {} }, reason: '观察试验' },
          ...(closing ? { inner: { thoughts: [{ content: 'UNEXECUTED_CLOSING', kind: 'observation' }], resolve: [] } } : {}),
        }) }
      },
    } })
    try {
      const result = await wakeOnce(deps)
      assert.equal(result.status, 'budget_exhausted')
      assert.equal(requests, maxActions + 1); assert.equal(calls, maxActions)
      assert.equal(result.decision, maxActions ? 'tool_call' : undefined)
      const db = rawOpen(path)
      try {
        const row = db.prepare('SELECT decision, action_count, status FROM autonomy_runs WHERE id = ?').get('run-wake-test')!
        assert.equal(row.status, 'failed'); assert.equal(row.action_count, maxActions)
        if (maxActions === 0) assert.equal(row.decision, null)
        else {
          const persisted = JSON.parse(String(row.decision))
          assert.equal(persisted.kind, 'tool_call')
          assert.ok(!String(row.decision).includes('UNEXECUTED_CLOSING'))
        }
      } finally { db.close() }
      assert.ok(!store.openThoughts().some(t => t.content.includes('UNEXECUTED_CLOSING')))
      assert.ok(!store.recentExperiences(20).some(e => e.content.includes('UNEXECUTED_CLOSING')))
      const event = log.events.find(([name]) => name === 'autonomy_wake')!
      assert.equal(event[1].decision, maxActions ? 'tool_call' : null)
    } finally { store.close() }
  })
}
