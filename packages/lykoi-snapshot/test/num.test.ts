/**
 * 数值口径 golden：pyRound 对 CPython round() 逐值对拍（值由 python3 生成），
 * median 对 statistics.median，节律三纯函数的边界。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_TYPICAL_GAP_H,
  median,
  medianGapHours,
  plusFixed2,
  pyRound,
  sameWindowDays,
} from '../src/index.ts'

test('pyRound：CPython round() golden 对拍（含精确平局取偶）', () => {
  // [value, ndigits, python round() 结果]（python3 逐值生成）
  const golden: [number, number, number][] = [
    [0.125, 2, 0.12], //   精确平局（二进制可表示）→ 取偶 0.12
    [0.375, 2, 0.38], //   精确平局 → 取偶 0.38
    [-0.125, 2, -0.12], // 负数平局同规则
    [2.675, 2, 2.67], //   2.675 二进制略低于半点 → 舍
    [0.5, 0, 0.0], //      整数位平局 → 偶 0
    [1.5, 0, 2.0],
    [2.5, 0, 2.0],
    [0.7, 3, 0.7],
    [0.30000000000000004, 3, 0.3],
    [0.615, 2, 0.61], //   0.615 二进制略低于半点
    [1.0049999999, 2, 1.0],
    [0.045, 1, 0.0], //    0.045 二进制略低于半点
    [3.0 / 24.0, 2, 0.12], // days_since_lit 实战形态（恰 3h → 0.125 天）
    [0.15000000000000002, 3, 0.15],
    [27.5, 1, 27.5],
    [0.0005, 3, 0.001], // 二进制略高于半点 → 进
    [0.0015, 3, 0.002],
    [123.456789, 2, 123.46],
    [0.1 + 0.2, 2, 0.3],
    [9.999999, 1, 10.0],
  ]
  for (const [value, ndigits, expected] of golden) {
    assert.equal(pyRound(value, ndigits), expected, `pyRound(${value}, ${ndigits})`)
  }
})

test('median：statistics.median 语义（奇取中、偶取均值）', () => {
  assert.equal(median([1.5, 2.5, 3.5, 10.0]), 3.0)
  assert.equal(median([1.0, 2.0, 4.0, 8.0, 16.0]), 4.0)
  assert.equal(median([5]), 5)
  assert.throws(() => median([]), /no data/)
})

test('plusFixed2：Python f"{x:+.2f}" 形态（CAUSES 插值链渲染面）', () => {
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
