import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TYPICAL_GAP_H,
  median,
  medianGapHours,
  plusFixed2,
  roundDecimal,
  sameWindowDays,
} from '../src/index.ts'

test('roundDecimal uses native decimal precision for model-facing values', () => {
  for (const sign of [1, -1]) {
    assert.equal(roundDecimal(sign * 0.125, 2), sign * 0.13)
    assert.equal(roundDecimal(sign * 0.375, 2), sign * 0.38)
    assert.equal(roundDecimal(sign * 123.456789, 2), sign * 123.46)
  }
  assert.equal(roundDecimal(0.1 + 0.2, 2), 0.3)
  assert.equal(roundDecimal(9.999999, 1), 10)
  assert.throws(() => roundDecimal(1, -1), TypeError)
})

test('median：奇取中、偶取均值', () => {
  assert.equal(median([1.5, 2.5, 3.5, 10.0]), 3.0)
  assert.equal(median([1.0, 2.0, 4.0, 8.0, 16.0]), 4.0)
  assert.equal(median([5]), 5)
  assert.throws(() => median([]), /no data/)
})

test('plusFixed2：带符号的两位小数', () => {
  assert.equal(plusFixed2(-0.4), '-0.40')
  assert.equal(plusFixed2(-0.1), '-0.10')
  assert.equal(plusFixed2(0.15), '+0.15')
  assert.equal(plusFixed2(0), '+0.00')
})

test('medianGapHours：样本 < MIN_GAP_SAMPLES+1（即 <6）→ 缺省 24.0', () => {
  const base = Date.parse('2026-08-20T00:00:00Z')
  const mk = (hours: number[]) => hours.map((h) => new Date(base + h * 3_600_000))
  assert.equal(medianGapHours(mk([0, 1, 2, 3, 4])), DEFAULT_TYPICAL_GAP_H) // 5 个样本
  // 6 个样本 → 相邻差 [1,2,3,4,5] 的中位数 = 3
  assert.equal(medianGapHours(mk([0, 1, 3, 6, 10, 15])), 3)
})

test('sameWindowDays：±2h 窗口按天计一次', () => {
  const now = new Date('2026-08-20T12:00:00Z')
  const stamps = [
    new Date('2026-08-19T13:30:00Z'), // day1 窗内（+1.5h）
    new Date('2026-08-19T11:00:00Z'), // day1 窗内（同一天只计一次）
    new Date('2026-08-18T15:00:00Z'), // day2 窗外（+3h）
    new Date('2026-08-17T10:00:00Z'), // day3 窗内（-2h 恰在界上，含端点）
    new Date('2026-08-01T12:00:00Z'), // 超出 14 天窗（day19）
  ]
  assert.equal(sameWindowDays(stamps, now), 2)
})
