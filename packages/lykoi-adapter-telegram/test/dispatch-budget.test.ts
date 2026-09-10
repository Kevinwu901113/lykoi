import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRuntime } from 'lykoi-runtime'
import { createDispatch, approvalMachinery, inPresenceReply, upstreamBudgetedDelivery } from 'lykoi-kernel'
import { outboundCapabilities, setTransport, messengerLedgerPath, _reserveProactiveSlot, BotApiTransport } from '../src/index.ts'
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
  assert.equal(received.length, 3)
  writeFileSync(process.env.LYKOI_APPROVAL_RULES!, JSON.stringify({ always_allow: [], always_deny: ['messenger.send'], ask: [] }))
  const denied = await dispatch(action, { context: { origin: 'interactive', exemption: approvalMachinery() }, preApproved: true })
  assert.equal(denied.data.denied, true); assert.equal(received.length, 3)
})
