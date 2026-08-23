/** SA-77/78：衰减双算法数值样例 + 不可合并性。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ABANDON_THRESHOLD,
  applyDeltaValue,
  clamp01,
  DECAY_RATE_PER_HOUR,
  decayCharge,
  decayValue,
  THOUGHT_CHARGE_DECAY,
  THOUGHT_LAPSE_SALIENCE,
  THOUGHT_OPEN_CAP,
  THOUGHT_SNAPSHOT_TOP,
} from '../src/index.ts'

test('SA-77：DECAY_RATE_PER_HOUR 四值逐字', () => {
  assert.deepEqual(DECAY_RATE_PER_HOUR, {
    coherence: 0.01,
    load: 0.03,
    relational_tension: 0.02,
    exploration_hunger: 0.008,
  })
})

test('SA-77：regress 数值样例 baseline+(v-baseline)*exp(-rate*h)', () => {
  // coherence: baseline 0.7, rate 0.01, v=0.9, h=10 → 0.7 + 0.2*e^-0.1
  assert.equal(decayValue('coherence', 0.9, 10), 0.7 + 0.2 * Math.exp(-0.1))
  // 从下方回归：load baseline 0.2, rate 0.03, v=0.0, h=5 → 0.2 - 0.2*e^-0.15
  assert.equal(decayValue('load', 0.0, 5), 0.2 + (0.0 - 0.2) * Math.exp(-0.15))
  // 长时衰减渐近 baseline（不越过）
  const longRun = decayValue('relational_tension', 1.0, 10_000)
  assert.ok(Math.abs(longRun - 0.3) < 1e-9)
})

test('SA-77：accumulate 数值样例 v+rate*h（只升不降），clamp01 封顶', () => {
  assert.equal(decayValue('exploration_hunger', 0.1, 5), 0.1 + 0.008 * 5)
  assert.equal(decayValue('exploration_hunger', 0.9, 1_000), 1.0) // clamp01
  // 0→0.6 约 3 天（75 小时整）
  assert.ok(Math.abs(decayValue('exploration_hunger', 0.0, 75) - 0.6) < 1e-12)
})

test('SA-77：hours_elapsed <= 0 → clamp01(value) 原样（不外推未来）', () => {
  assert.equal(decayValue('coherence', 0.55, 0), 0.55)
  assert.equal(decayValue('coherence', 0.55, -3), 0.55)
  assert.equal(decayValue('coherence', 1.7, 0), 1.0) // clamp 面
})

test('clamp01 / applyDeltaValue（regulation.py:139-140, :156-158）', () => {
  assert.equal(clamp01(-0.2), 0.0)
  assert.equal(clamp01(1.2), 1.0)
  assert.equal(clamp01(0.42), 0.42)
  assert.equal(applyDeltaValue(0.5, 0.04), 0.54)
  assert.equal(applyDeltaValue(0.98, 0.06), 1.0)
  assert.equal(applyDeltaValue(0.05, -0.3), 0.0)
})

test('SA-78：decay_charge 线性按拍衰减，floor 0', () => {
  assert.equal(THOUGHT_CHARGE_DECAY, 0.04)
  assert.equal(decayCharge(0.5, 1), 0.46)
  assert.equal(decayCharge(0.5, 3), 0.5 - 0.04 * 3)
  assert.equal(decayCharge(0.05, 2), 0.0) // max(0.0, …)
})

test('SA-78：beats <= 0 是 no-op 不返还（attention can only be paid forward）', () => {
  assert.equal(decayCharge(0.5, 0), 0.5)
  assert.equal(decayCharge(0.5, -4), 0.5) // 负拍不得把 charge 加回去
})

test('SA-78：decay_charge 与 decay_value 是两个函数（不可合并的可见断言）', () => {
  // regress 语义会把值拉向 baseline；charge 衰减永远单调向 0 —— 两者对同输入给不同答案。
  assert.notEqual(decayCharge(0.0, 1), decayValue('coherence', 0.0, 1))
  assert.equal(decayCharge(0.0, 1), 0.0)
})

test('念头常量（SA-175/177 消费面）', () => {
  assert.equal(THOUGHT_OPEN_CAP, 7)
  assert.equal(ABANDON_THRESHOLD, 0.15)
  assert.equal(THOUGHT_LAPSE_SALIENCE, 0.2)
  assert.equal(THOUGHT_SNAPSHOT_TOP, 3)
})
