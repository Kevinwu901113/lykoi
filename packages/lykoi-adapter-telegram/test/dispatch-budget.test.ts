import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRuntime } from 'lykoi-runtime'
import { createDispatch, approvalMachinery, inPresenceReply, upstreamBudgetedDelivery, createSuggestionConversation, type SuggestionStore, proactiveRemainingToday, getNotifications } from 'lykoi-kernel'
import { outboundCapabilities, setTransport, messengerLedgerPath, _reserveProactiveSlot, BotApiTransport } from '../src/index.ts'
import { initiateChat, notifyOwner } from '../src/resources.ts'
import { isolateOutboundState } from '../src/testing.ts'

test('kernel admission crosses Runtime to actual HTTP transport; E1/E2/E3 do not spend proactive quota', async t => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-dispatch-budget-'))
  isolateOutboundState(root)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'approval-rules.json')
  t.after(() => { setTransport(null); rmSync(root, { recursive: true, force: true }) })
  const received: any[] = []
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    received.push(JSON.parse(body)); res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ ok: true, result: { message_id: received.length } }))
  })
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  t.after(() => new Promise<void>((ok, fail) => server.close(e => e ? fail(e) : ok())))
  setTransport(new BotApiTransport({ token: 'fixture', apiBase: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,
    post: async (url, payload) => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json(); return { status: response.status, json: () => data }
    },
  }))
  const runtime = new CapabilityRuntime()
  runtime.register({ organId: 'messenger', capabilities: outboundCapabilities(), sideEffects: [] })
  const dispatch = createDispatch({ sink: { record: async () => {} }, resources: runtime.resources })
  assert.equal(_reserveProactiveSlot(), null)
  const before = readFileSync(messengerLedgerPath(), 'utf8')
  const action = { type: 'messenger.send', params: { context_id: 'owner', text: 'follow-up', reply_to: null } }
  for (const exemption of [approvalMachinery(), upstreamBudgetedDelivery(), inPresenceReply('owner')]) {
    const result = await dispatch(action, { context: { origin: 'interactive', exemption } })
    assert.equal(result.success, true); assert.equal(result.data.sent, true)
  }
  assert.equal(received.length, 3); assert.ok(received.every(r => r.text === 'follow-up' && r.reply_to_message_id == null))
  assert.equal(readFileSync(messengerLedgerPath(), 'utf8'), before)
  // A model cannot pass admission in JSON. Wrong-peer E2 likewise has no budget coverage.
  for (const exemption of [{ category: 'E3' }, inPresenceReply('another-owner'), undefined]) {
    const result = await dispatch({ ...action, params: { ...action.params, messageBudget: 'exempt', admission: { messageBudget: 'exempt' } } },
      { context: { origin: 'interactive', exemption }, preApproved: true })
    assert.equal(result.data.sent, false); assert.equal(result.data.reason, 'daily_cap')
  }
  const quoted = await dispatch({ ...action, params: { ...action.params, reply_to: 'old-message' } }, { context: { origin: 'interactive' }, preApproved: true })
  assert.equal(quoted.data.reason, 'daily_cap'); assert.equal(received.length, 3)
  writeFileSync(process.env.LYKOI_APPROVAL_RULES!, JSON.stringify({ always_allow: [], always_deny: ['messenger.send'], ask: [] }))
  const denied = await dispatch(action, { context: { origin: 'interactive', exemption: approvalMachinery() }, preApproved: true })
  assert.equal(denied.data.denied, true); assert.equal(received.length, 3)
})

function fixture(t: import('node:test').TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-shared-budget-')); isolateOutboundState(root)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  writeFileSync(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['messenger.send', 'notify.owner'], always_deny: [], ask: [] }))
  let sends = 0
  setTransport({ sendMessage: async () => ({ message_id: String(++sends), sent: true }), fetchUpdates: async () => ({ messages: [], count: 0 }) })
  t.after(() => { setTransport(null); rmSync(root, { recursive: true, force: true }) })
  const runtime = new CapabilityRuntime()
  runtime.register({ organId: 'messenger', capabilities: outboundCapabilities(), sideEffects: [] })
  const dispatch = createDispatch({ resources: runtime.resources, sink: { record: async () => {} } })
  const send = () => dispatch({ type: 'messenger.send', params: { text: 'direct', context_id: 'owner' } }, { context: { origin: 'interactive' } })
  return { root, runtime, dispatch, send, sends: () => sends }
}

test('direct and queued proactive chat share quota in both orders; snapshot matches', async t => {
  const h = fixture(t)
  assert.equal((await h.send()).data.sent, true)
  assert.equal(proactiveRemainingToday(), 0)
  assert.equal((await initiateChat({ content: 'queued' })).reason, 'daily_cap')
  writeFileSync(messengerLedgerPath(), '[]')
  assert.equal((await initiateChat({ content: 'queued first' })).queued, true)
  assert.equal((await h.send()).data.reason, 'daily_cap')
  assert.equal(h.sends(), 1)
})

test('legacy ledger merges before any entry point admits, remains exhausted on subsequent reads', t => {
  fixture(t)
  const now = new Date(), earlier = new Date(now.getTime() - 1000).toISOString()
  writeFileSync(messengerLedgerPath(), JSON.stringify([earlier]))
  const legacy = process.env.LYKOI_MESSENGER_LEDGER!
  writeFileSync(legacy, JSON.stringify([now.toISOString()]))
  assert.equal(proactiveRemainingToday(now), 0)
  assert.deepEqual(JSON.parse(readFileSync(messengerLedgerPath(), 'utf8')), [earlier, now.toISOString()])
  assert.equal(existsSync(legacy), false); assert.equal(existsSync(legacy + '.migrated'), true)
  assert.equal(_reserveProactiveSlot(now), 'daily_cap')
  assert.equal(proactiveRemainingToday(now), 0)
})

test('unsolicited rule suggestion spends quota; approval machinery still works when exhausted', async t => {
  const h = fixture(t)
  let claimed = 0
  const store = { currentFocusCycleId: () => 1, ownerBinding: () => ({ channel: 'telegram', channel_key: 'owner' }),
    overdueAskedRuleSuggestions: () => [], outstandingAskedRuleSuggestions: () => [],
    nextPendingRuleSuggestion: () => ({ id: 1, suggestion_text: 'synthetic rule' }), markRuleSuggestionAsked: () => { claimed++; return true } } as unknown as SuggestionStore
  const suggestion = createSuggestionConversation({ dispatch: h.dispatch, store, stagedInstructions: () => '' })
  assert.equal(_reserveProactiveSlot(), null)
  assert.equal((await suggestion.maybeAskOwner()).status, 'send_failed'); assert.equal(claimed, 0)
  writeFileSync(messengerLedgerPath(), '[]')
  assert.equal((await suggestion.maybeAskOwner()).status, 'asked'); assert.equal(claimed, 1)
  assert.equal(proactiveRemainingToday(), 0)
  const approval = await h.dispatch({ type: 'messenger.send', params: { text: 'approval', context_id: 'owner' } }, { context: { origin: 'interactive', exemption: approvalMachinery() } })
  assert.equal(approval.data.sent, true); assert.equal(h.sends(), 2)
})

test('notification provenance is the trusted dispatch origin, never model params or default system', async t => {
  const h = fixture(t)
  for (const origin of ['interactive', 'scheduler', 'system'] as const) {
    const result = await h.dispatch({ type: 'notify.owner', params: { content: origin, origin: 'autonomous' } }, { context: { origin } })
    assert.equal(result.data.queued, true)
  }
  assert.deepEqual(getNotifications().map(n => n.origin), ['interactive', 'scheduler', 'system'])
  await assert.rejects(() => notifyOwner({ content: 'no context', origin: 'system' }), /trusted dispatch origin/)
  const denied = await h.dispatch({ type: 'notify.owner', params: { content: 'spoof', origin: 'system' } }, { context: { origin: 'autonomous' }, preApproved: true })
  assert.equal(denied.data.queued, undefined); assert.equal(getNotifications().length, 3)
})
