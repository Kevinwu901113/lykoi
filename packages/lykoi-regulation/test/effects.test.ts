/** SA-79/80：八 effects 与阈值边界（恰好等于阈值不触发 —— 严格不等号）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cognitiveEffects,
  EXPLORATION_WEIGHT_BONUS,
  LOAD_BUDGET_MULTIPLIER,
  RELATIONSHIP_WEIGHT_BONUS,
  REGISTRY,
  THRESHOLDS,
  type RegulationValues,
} from '../src/index.ts'

function neutral(overrides: Partial<RegulationValues> = {}): RegulationValues {
  return {
    coherence: REGISTRY.coherence.baseline,
    load: REGISTRY.load.baseline,
    relational_tension: REGISTRY.relational_tension.baseline,
    exploration_hunger: REGISTRY.exploration_hunger.baseline,
    ...overrides,
  }
}

test('SA-79：THRESHOLDS 五值逐字 + 三常量', () => {
  assert.deepEqual(THRESHOLDS, {
    coherence_low: 0.4,
    load_high: 0.7,
    load_high_integration: 0.9,
    tension_high: 0.6,
    hunger_high: 0.6,
  })
  assert.equal(RELATIONSHIP_WEIGHT_BONUS, 0.2)
  assert.equal(EXPLORATION_WEIGHT_BONUS, 0.2)
  assert.equal(LOAD_BUDGET_MULTIPLIER, 0.5)
})

test('SA-80：中性态（全 baseline）八键全不触发', () => {
  assert.deepEqual(cognitiveEffects(neutral()), {
    force_inner_tending: false,
    flag_low_coherence: false,
    budget_multiplier: 1.0,
    prefer_rest: false,
    trigger_early_integration: false,
    relationship_weight_bonus: 0.0,
    unlock_proactive_contact: false,
    exploration_weight_bonus: 0.0,
  })
})

test('SA-79 边界：coherence == 0.4 恰好等于 → 不触发（严格 <）', () => {
  const at = cognitiveEffects(neutral({ coherence: 0.4 }))
  assert.equal(at.force_inner_tending, false)
  assert.equal(at.flag_low_coherence, false)
  const below = cognitiveEffects(neutral({ coherence: 0.39999 }))
  assert.equal(below.force_inner_tending, true)
  assert.equal(below.flag_low_coherence, true)
})

test('SA-79 边界：load == 0.7 恰好等于 → 不触发（严格 >）', () => {
  const at = cognitiveEffects(neutral({ load: 0.7 }))
  assert.equal(at.prefer_rest, false)
  assert.equal(at.budget_multiplier, 1.0)
  const above = cognitiveEffects(neutral({ load: 0.70001 }))
  assert.equal(above.prefer_rest, true)
  assert.equal(above.budget_multiplier, 0.5)
})

test('SA-80 P4-01 分离：load ∈ (0.7, 0.9] 只推休息不提前整合；== 0.9 不触发整合', () => {
  const mid = cognitiveEffects(neutral({ load: 0.8 }))
  assert.equal(mid.prefer_rest, true)
  assert.equal(mid.trigger_early_integration, false)
  const at = cognitiveEffects(neutral({ load: 0.9 }))
  assert.equal(at.prefer_rest, true)
  assert.equal(at.trigger_early_integration, false) // 恰好 0.9 不触发（严格 >）
  const above = cognitiveEffects(neutral({ load: 0.90001 }))
  assert.equal(above.prefer_rest, true)
  assert.equal(above.trigger_early_integration, true) // > 0.9 两者兼有
})

test('SA-79 边界：tension == 0.6 恰好等于 → 不触发（严格 >）', () => {
  const at = cognitiveEffects(neutral({ relational_tension: 0.6 }))
  assert.equal(at.relationship_weight_bonus, 0.0)
  assert.equal(at.unlock_proactive_contact, false)
  const above = cognitiveEffects(neutral({ relational_tension: 0.60001 }))
  assert.equal(above.relationship_weight_bonus, 0.2)
  assert.equal(above.unlock_proactive_contact, true)
})

test('SA-79 边界：hunger == 0.6 恰好等于 → 不触发（严格 >）', () => {
  assert.equal(cognitiveEffects(neutral({ exploration_hunger: 0.6 })).exploration_weight_bonus, 0.0)
  assert.equal(
    cognitiveEffects(neutral({ exploration_hunger: 0.60001 })).exploration_weight_bonus,
    0.2,
  )
})

test('SA-80：八键齐全且无多余键', () => {
  assert.deepEqual(Object.keys(cognitiveEffects(neutral())).sort(), [
    'budget_multiplier',
    'exploration_weight_bonus',
    'flag_low_coherence',
    'force_inner_tending',
    'prefer_rest',
    'relationship_weight_bonus',
    'trigger_early_integration',
    'unlock_proactive_contact',
  ])
})
