import test from 'node:test'
import assert from 'node:assert/strict'
import { runCognition } from '../src/cognition.ts'

test('shared loop feeds each real observation to the next decision and stops without extra action', async () => {
  const observations: number[] = []
  const result = await runCognition<number, number, number>({ maxActions: 3,
    reason: async () => observations.length === 2 ? { kind: 'finish', result: observations[1]! } : { kind: 'act', action: (observations.at(-1) ?? 1) + 1 },
    act: async n => n * 2, observe: n => { observations.push(n) },
  })
  assert.deepEqual(observations, [4, 10])
  assert.deepEqual(result, { status: 'finished', result: 10, actions: 2 })
})
test('budget prevents the next side effect; errors and cancellation remain explicit', async () => {
  let calls = 0
  const options = { maxActions: 1, reason: async () => ({ kind: 'act' as const, action: 1 }), act: async () => ++calls, observe: () => {} }
  assert.deepEqual(await runCognition(options), { status: 'budget_exhausted', actions: 1 })
  assert.equal(calls, 1)
  await assert.rejects(runCognition({ ...options, act: async () => { throw new Error('actual failure') } }), /actual failure/)
  await assert.rejects(runCognition({ ...options, signal: AbortSignal.abort() }), /abort/i)
})
