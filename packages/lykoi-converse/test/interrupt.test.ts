import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuditEvent } from 'lykoi-audit'
import { DurableIngress, type InboundPart } from 'lykoi-ingress'
import { handleTurn, RunAbortedError, withDeadline, type ConverseLlmResult, type ConverseMessage, type ConverseDeps } from '../src/index.ts'
import { makeConversation, envelope } from './fixture.ts'

const BASE = Date.parse('2026-09-07T00:00:00Z')
const part = (n: number, overrides: Partial<InboundPart> = {}): InboundPart => ({
  inboundId: `in-${n}`, channel: 'telegram', platformMessageId: `${n}`, platformUpdateId: `${n}`,
  userId: 'owner', contextId: 'peer', isOwner: true, text: `原文${n}`,
  receivedAt: new Date(BASE + n * 100).toISOString(), ...overrides,
})
async function until(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return
    await new Promise<void>(resolve => setImmediate(resolve))
  }
  assert.fail('expected asynchronous boundary was not reached')
}
function harness(deps: Partial<ConverseDeps> = {}) {
  const calls: { signal?: AbortSignal; messages: ConverseMessage[]; resolve: (value: ConverseLlmResult) => void; reject: (error: Error) => void }[] = []
  const h = makeConversation({ cycleTimeoutS: 0, ...deps, llm: (messages, options) => new Promise((resolve, reject) => {
    calls.push({ messages, signal: options.signal, resolve, reject })
  }) })
  const events: AuditEvent[] = []
  const audit = { async record(event: AuditEvent) { events.push(event) } }
  const sent: { text: string; anchor: string }[] = []
  const telegram = {
    async routeOwnerMessage() { return null }, outboundWired() { return true },
    async sendReply(_peer: string, text: string, anchor: string) { sent.push({ text, anchor }); return { outcome: 'delivered' } },
    async send(_peer: string, text: string, anchor: string) { sent.push({ text, anchor }); return { sent: true } },
  }
  const ctx = { audit, get(name: string) { return name === 'messenger' ? telegram : undefined } } as unknown as Context
  const ingress = new DurableIngress({ dbPath: join(mkdtempSync(join(tmpdir(), 'sched-')), 'spool.db'),
    audit, autoStart: false, now: () => new Date(BASE + 5_000) })
  ingress.registerInterruptor({ canInterrupt: id => h.conversation.canInterrupt(id), interrupt: id => h.conversation.interrupt(id) })
  ingress.registerExecutor((turn, { runId }) => handleTurn(ctx, h.conversation, turn, runId))
  return { ...h, ingress, calls, events, sent }
}
const reply = { content: envelope() }

test('同 turn r0 abort→r1 reply：终局只有一次；迟到工具回包零副作用', async () => {
  let dispatches = 0
  const h = harness({ dispatchFn: (async () => { dispatches++; return { success: true, data: {}, error: null } }) as never })
  const first = await h.ingress.accept(part(1))
  await h.ingress.tick(new Date(BASE + 2_000))
  await until(() => h.calls.length === 1)
  const second = await h.ingress.accept(part(2))
  assert.equal(second.turnId, first.turnId)
  await until(() => h.calls.length === 2)
  assert.equal(h.calls[0]!.signal!.aborted, true)
  h.calls[1]!.resolve(reply)
  await h.ingress.drain()
  const aborts = h.events.filter(e => e.type === 'converse/run_aborted')
  const terminals = h.events.filter(e => e.type === 'converse/turn_terminal')
  assert.equal(aborts.length, 1)
  assert.equal(aborts[0]!.reason, 'revision')
  assert.equal(aborts[0]!.run_id, `run:${first.turnId}:r0`)
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0]!.run_id, `run:${first.turnId}:r1`)
  assert.equal(terminals[0]!.status, 'completed')
  assert.deepEqual(terminals[0]!.inbound_ids, ['in-1', 'in-2'])
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0]!.anchor, '2')
  h.calls[0]!.resolve({ content: envelope({ decision: { kind: 'tool_call', reason: '', tool: { name: 'research_browser.read_text', arguments: { url: 'https://example.com' } } } }) })
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(dispatches, 0)
  assert.equal(h.events.filter(e => e.type === 'converse/turn_terminal').length, 1)
  assert.equal(h.events.some(e => e.type === 'converse/turn_failed'), false)
  await h.ingress.close(); h.store.close()
})

test('最多两次 revision；第三条新输入正常排队，r2 不再被打断', async () => {
  const h = harness()
  await h.ingress.accept(part(1)); await h.ingress.tick(new Date(BASE + 2_000))
  await until(() => h.calls.length === 1)
  await h.ingress.accept(part(2)); await until(() => h.calls.length === 2)
  await h.ingress.accept(part(3)); await until(() => h.calls.length === 3)
  const queued = await h.ingress.accept(part(4))
  assert.equal(queued.turnId, 'turn:in-4')
  assert.equal(h.calls[2]!.signal!.aborted, false)
  h.calls[2]!.resolve(reply)
  await h.ingress.tick(new Date(BASE + 5_000))
  await until(() => h.calls.length === 4)
  h.calls[3]!.resolve(reply)
  await h.ingress.drain()
  assert.equal(h.events.filter(e => e.type === 'converse/run_aborted').length, 2)
  assert.equal(h.events.filter(e => e.type === 'converse/turn_terminal').length, 2)
  // 迟到失败同样不能变成 unhandledRejection 或污染新 run。
  h.calls[0]!.reject(new Error('late failure')); h.calls[1]!.resolve(reply)
  await new Promise<void>(resolve => setImmediate(resolve))
  await h.ingress.close(); h.store.close()
})

test('工具首次派发之后只排队；即使后续 LLM 仍在等也不可打断', async () => {
  let dispatches = 0
  const h = harness({ dispatchFn: (async () => { dispatches++; return { success: true, data: { text: 'evidence' }, error: null } }) as never })
  await h.ingress.accept(part(1)); await h.ingress.tick(new Date(BASE + 2_000))
  await until(() => h.calls.length === 1)
  h.calls[0]!.resolve({ content: envelope({ decision: { kind: 'tool_call', reason: '', tool: { name: 'research_browser.read_text', arguments: { url: 'https://example.com' } } } }) })
  await until(() => h.calls.length === 2)
  assert.equal(dispatches, 1)
  assert.equal(h.conversation.canInterrupt('run:turn:in-1:r0'), false)
  const next = await h.ingress.accept(part(2))
  assert.notEqual(next.turnId, 'turn:in-1')
  h.calls[1]!.resolve(reply)
  await h.ingress.tick(new Date(BASE + 5_000))
  await until(() => h.calls.length === 3)
  h.calls[2]!.resolve(reply); await h.ingress.drain()
  assert.equal(h.events.filter(e => e.type === 'converse/run_aborted').length, 0)
  await h.ingress.close(); h.store.close()
})

test('不同 peer、非 owner、显式审批 reply_to 不修订当前 run', async () => {
  const h = harness()
  await h.ingress.accept(part(1)); await h.ingress.tick(new Date(BASE + 2_000))
  await until(() => h.calls.length === 1)
  for (const p of [part(2, { contextId: 'other' }), part(3, { userId: 'member', isOwner: false }), part(4, { replyToPlatformMessageId: 'approval-question' })]) {
    assert.notEqual((await h.ingress.accept(p)).turnId, 'turn:in-1')
  }
  assert.equal(h.calls[0]!.signal!.aborted, false)
  h.calls[0]!.resolve(reply); await h.ingress.drain()
  await h.ingress.close(); h.store.close()
})

test('background 不接受 interrupt；已取消 external signal 不启动 LLM', async () => {
  const h = harness()
  const pending = h.conversation.send('internal', { background: true, runId: 'background' })
  await until(() => h.calls.length === 1)
  assert.equal(h.conversation.interrupt('background'), false)
  h.calls[0]!.resolve(reply); await pending
  const controller = new AbortController(); controller.abort(new RunAbortedError())
  let calls = 0
  await assert.rejects(withDeadline('test', 0, async () => { calls++; return 'never' }, controller.signal), RunAbortedError)
  assert.equal(calls, 0)
  await h.ingress.close(); h.store.close()
})
