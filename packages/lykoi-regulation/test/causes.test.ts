/**
 * SA-74/75：15 条 CAUSES 逐字断言（SPEC-MIND §4.2 表）。
 * 每条一断言 —— 数值散落即失去可校准性，这张表是移植时最不可妥协的一张。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { CAUSES } from '../src/index.ts'

test('SA-74：CAUSES 恰 15 条', () => {
  assert.equal(Object.keys(CAUSES).length, 15)
})

const EXPECTED: [string, string, number][] = [
  ['integration_completed', 'coherence', +0.15],
  ['suspension_resolved', 'coherence', +0.10],
  ['experience_backlog', 'coherence', -0.10],
  ['suspension_overdue', 'coherence', -0.05],
  ['narrative_conflict', 'coherence', -0.15],
  ['experience_recorded', 'load', +0.04],
  ['action_taken', 'load', +0.06],
  ['integration_digested', 'load', -0.30],
  ['rested', 'load', -0.10],
  ['owner_silence_anomaly', 'relational_tension', +0.15],
  ['contact_unanswered', 'relational_tension', +0.20],
  ['normal_interaction', 'relational_tension', -0.10],
  ['contact_answered', 'relational_tension', -0.15],
  ['concern_lit_unfollowed', 'exploration_hunger', +0.05],
  ['explore_completed', 'exploration_hunger', -0.40],
]

for (const [cause, variable, delta] of EXPECTED) {
  test(`SA-74：${cause} → (${variable}, ${delta})`, () => {
    assert.deepEqual(CAUSES[cause], [variable, delta])
  })
}

test('SA-75：CAUSES 覆盖四个变量各自的升降因（无孤立方向）', () => {
  for (const name of ['coherence', 'load', 'relational_tension', 'exploration_hunger']) {
    const deltas = Object.values(CAUSES).filter(([t]) => t === name).map(([, d]) => d)
    assert.ok(deltas.some((d) => d > 0), `${name} 应有升因`)
    assert.ok(deltas.some((d) => d < 0), `${name} 应有降因`)
  }
})
