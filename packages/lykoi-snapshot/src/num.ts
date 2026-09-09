/** Decimal precision for model-facing numbers; raw persisted values remain unchanged. */
export function roundDecimal(value: number, ndigits: number): number {
  if (!Number.isInteger(ndigits) || ndigits < 0 || ndigits > 20) {
    throw new TypeError('roundDecimal: ndigits must be an integer in [0, 20]')
  }
  return Number(value.toFixed(ndigits))
}

/** 中位数：奇数取中间值，偶数取中间两数均值；不修改输入数组。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TypeError('median: no data')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** 带正负号的两位小数，用于候选动作的调节效果说明。 */
export function plusFixed2(x: number): string {
  const sign = x < 0 || Object.is(x, -0) ? '-' : '+'
  return sign + Math.abs(x).toFixed(2)
}
