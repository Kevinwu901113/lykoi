import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateMessage, serializeDecision } from '../src/index.ts'

test('accepted decisions persist their actual choice and visible references without demotion metadata', () => {
  const decision = evaluateMessage({ content: JSON.stringify({
    meaning_assessment: [{ item: '一条关切', meaning: '', concern_id: 7, pull: 0.6 }],
    decision: { kind: 'explore', url: 'https://example.org', reason: '一条关切' },
  }) }, [{ kind: 'explore', weight: 1, cost: '', note: '' }], { injectedConcernIds: [7] })
  const persisted = JSON.parse(serializeDecision(decision))
  assert.equal(persisted.kind, 'explore')
  assert.deepEqual(persisted.grounded_concern_ids, [7])
  for (const retired of ['demoted', 'demote_why', 'original_kind', 'next_wake_after_minutes']) {
    assert.equal(retired in persisted, false)
  }
  assert.equal(serializeDecision(decision), serializeDecision(decision))
})
