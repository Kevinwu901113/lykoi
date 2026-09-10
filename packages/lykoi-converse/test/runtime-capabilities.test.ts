import test from 'node:test'
import assert from 'node:assert/strict'
import { CapabilityRuntime } from 'lykoi-runtime'
import { OrganInventoryCache } from 'lykoi-decide'
import { envelope, makeConversation } from './fixture.ts'

test('existing Conversation refreshes envelope tool hints and body inventory after register/unregister', async () => {
  const runtime = new CapabilityRuntime()
  const organs = new OrganInventoryCache({ bindings: () => [], catalog: runtime.catalog })
  const h = makeConversation({ organs, capabilities: () => runtime.capabilities(), wiredActions: runtime.actions, capabilityRevision: () => runtime.revision })
  const send = async (id: string) => {
    h.llm.push({ content: envelope() })
    await h.conversation.send('在吗', { runId: id, turnId: id })
    return h.llm.calls.at(-1)!.messages
  }
  try {
    const before = await send('before')
    assert.equal(before[0]!.content!.includes('browser.navigate'), false)
    const stop = runtime.register({ organId: 'browser', capabilities: Object.entries({ 'browser.navigate': async () => ({ ok: true }) }).map(([name, handler]) => ({ name, description: name, inputSchema: { type: 'object' as const }, handler })), sideEffects: [] })
    const during = await send('during')
    assert.equal(during[0]!.content, before[0]!.content, 'persona remains independent of registered tools')
    assert.ok(during.some(message => message.content?.includes('browser.navigate')))
    assert.ok(during.at(-1)!.content!.includes('browser.navigate'))
    stop()
    const after = await send('after')
    assert.equal(after[0]!.content!.includes('browser.navigate'), false)
    assert.equal(after.at(-1)!.content!.includes('browser.navigate'), false)
    assert.equal(after.some(message => message.content?.includes('browser.navigate')), false)
  } finally {
    runtime.dispose()
    h.store.close()
  }
})
