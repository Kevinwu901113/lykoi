import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityRuntime } from 'lykoi-runtime'
import { envelope, makeConversation } from './fixture.ts'

test('Conversation consumes observations, recovers from invalid arguments, and sees retirement before its next call', async () => {
  const runtime = new CapabilityRuntime()
  const activities: string[] = []
  runtime.onActivity(e => { activities.push(e.phase) })
  let executions = 0
  const stop = runtime.register({ organId: 'lab', sideEffects: [], capabilities: [{
    name: 'lab.lookup', description: 'Find the sample by integer index.',
    inputSchema: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'], additionalProperties: false },
    handler: async p => { executions++; return { sample: `OBS_${p.index}` } },
  }] })
  const held = runtime.resources.lab!.lookup!
  const h = makeConversation({ wiredActions: runtime.actions, capabilities: () => runtime.capabilities(),
    dispatchFn: async action => {
      try { return { success: true, data: await runtime.invoke(action.type, action.params) as Record<string, unknown>, error: null } }
      catch (error) { return { success: false, data: {}, error: String(error) } }
    },
  })
  const act = (index: unknown) => ({ content: envelope({ decision: { kind: 'tool_call', tool: { name: 'lab.lookup', arguments: { index } }, reason: '他问我在不在' } }) })
  h.llm.push(act('bad'))
  h.llm.push(call => {
    assert.match(JSON.stringify(call.messages), /integer/)
    assert.equal(executions, 0)
    return act(741)
  })
  h.llm.push(call => {
    assert.match(JSON.stringify(call.messages), /OBS_741/)
    stop()
    return act(742) // Selected while installed, retired before dispatch.
  })
  h.llm.push(call => {
    const definition = call.messages.filter(m => m.role === 'system').map(m => m.content).join('\n')
    assert.ok(!definition.includes('Find the sample by integer index.'))
    return { content: envelope({ decision: { kind: 'reply', content: '实测 OBS_741；后续能力已卸载，无法查询。', reason: '他问我在不在' } }) }
  })
  try {
    assert.match(await h.conversation.send('查一下样品', { runId: 'open' }), /OBS_741/)
    assert.equal(executions, 1)
    assert.deepEqual(activities, ['started', 'failed', 'started', 'result'])
    await assert.rejects(held({ index: 743 }), /retired/)
    await assert.rejects(runtime.invoke('lab.lookup', { index: 743 }), /not registered/)
  } finally { runtime.dispose(); h.store.close() }
})
