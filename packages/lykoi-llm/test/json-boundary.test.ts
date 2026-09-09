import assert from 'node:assert/strict'
import test from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { apply, LlmJsonError, type LykoiGenerateOptions } from '../src/index.ts'

function fixture(replies: string[], opts: { abort?: AbortController; denySecond?: boolean; firstFailure?: string } = {}) {
  const ctx = new Context()
  const calls: LykoiGenerateOptions[] = []
  const charges: unknown[] = []
  let gates = 0
  ctx.provide('budget', {
    async gate() { if (++gates === 2 && opts.denySecond) throw new Error('budget denied') },
    async charge(input) { charges.push(input); opts.abort?.abort() },
    usage() { return { day: '', totalTokens: 0, routeTokens: 0 } },
  })
  ctx.provide('llm', { async *stream(request: LykoiGenerateOptions) {
    calls.push(request)
    yield { type: 'text-delta', text: replies[calls.length - 1] ?? '' }
    yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 3 } }
    yield { type: 'finish', reason: opts.firstFailure && calls.length === 1
      ? { kind: 'error', failure: { code: opts.firstFailure, message: 'provider failure' } } : { kind: 'stop' } }
  } } as unknown as Context['llm'])
  apply(ctx)
  const request: LykoiGenerateOptions = { provider: 'test', model: 'test',
    responseFormat: { type: 'json_object' },
    messages: [createUserMessage({ content: [{ type: 'text', text: 'JSON request' }], source: { kind: 'user' } })],
    ...(opts.abort ? { signal: opts.abort.signal } : {}),
  }
  return { svc: ctx.lykoiLlm, calls, charges, request }
}

test('JSON recovery belongs to provider boundary; each attempt is gated/charged and nudge does not mutate history', async () => {
  const f = fixture(['', '说明：{"decision":{"kind":"rest"}}'])
  const original = JSON.stringify(f.request)
  const result = await f.svc.call(f.request, { runId: 'run-json' })
  assert.equal(JSON.parse(result.text).decision.kind, 'rest')
  assert.equal(f.calls.length, 2)
  assert.equal(f.charges.length, 2)
  assert.equal(f.calls[0]!.responseFormat?.type, 'json_object')
  assert.equal('responseFormat' in f.calls[1]!, false)
  assert.equal(f.calls[1]!.messages.length, f.request.messages.length + 1)
  assert.equal(JSON.stringify(f.request), original)
  assert.ok(f.charges.every(c => (c as { runId: string }).runId === 'run-json'))
})

test('recovery exhaustion is an explicit failure after three charged attempts', async () => {
  const f = fixture(['', 'not JSON', '{"bad":'])
  await assert.rejects(f.svc.call(f.request, { runId: 'bad-json' }), LlmJsonError)
  assert.equal(f.calls.length, 3)
  assert.equal(f.charges.length, 3)
})

test('budget denial and cancellation prevent a recovery request', async () => {
  const denied = fixture([''], { denySecond: true })
  await assert.rejects(denied.svc.call(denied.request, { runId: 'budget' }), /budget denied/)
  assert.equal(denied.calls.length, 1)
  assert.equal(denied.charges.length, 1)
  const cancelled = fixture([''], { abort: new AbortController() })
  await assert.rejects(cancelled.svc.call(cancelled.request, { runId: 'cancelled' }), { name: 'AbortError' })
  assert.equal(cancelled.calls.length, 1)
  assert.equal(cancelled.charges.length, 1)
})

test('syntax-only repair costs no extra request; semantic-invalid JSON is not retried by provider', async () => {
  const repair = fixture(['{"decision":{"kind":"rest"}'])
  assert.equal(JSON.parse((await repair.svc.call(repair.request, { runId: 'repair' })).text).decision.kind, 'rest')
  assert.equal(repair.calls.length, 1)
  const semantic = fixture(['{"decision":{"kind":"made-up"}}'])
  assert.equal(JSON.parse((await semantic.svc.call(semantic.request, { runId: 'semantic' })).text).decision.kind, 'made-up')
  assert.equal(semantic.calls.length, 1)
  const plain = fixture(['plain text'])
  delete plain.request.responseFormat
  assert.equal((await plain.svc.call(plain.request, { runId: 'plain' })).text, 'plain text')
  assert.equal(plain.calls.length, 1)
})

test('only recoverable empty JSON responses retry; unrelated provider failures remain failures', async () => {
  const empty = fixture(['', '{}'], { firstFailure: 'EMPTY_RESPONSE' })
  assert.equal((await empty.svc.call(empty.request, { runId: 'empty' })).text, '{}')
  assert.equal(empty.calls.length, 2)
  assert.equal(empty.charges.length, 2)
  const unavailable = fixture([''], { firstFailure: 'NO_ADAPTER' })
  await assert.rejects(unavailable.svc.call(unavailable.request, { runId: 'unavailable' }), /NO_ADAPTER/)
  assert.equal(unavailable.calls.length, 1)
  assert.equal(unavailable.charges.length, 1)
})
