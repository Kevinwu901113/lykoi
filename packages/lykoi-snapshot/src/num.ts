/**
 * 快照与决策文本使用的数值格式工具。当前舍入结果会进入模型上下文。
 * 迁移来源见 governance/archive/runtime-slimdown-01-history.md；更换数值策略需评估上下文变化。
 */

/**
 * 按 double 的精确十进制展开舍入，恰在半点时取偶。
 * 在现有用途（ndigits ≤ 3）下，绝对值 ≥ 2^-48 可用 toFixed(100) 精确展开；
 * 更小值舍入为正负零。历史数值样例仍保留在 test/num.test.ts。
 */
export function pyRound(value: number, ndigits: number): number {
  if (!Number.isFinite(value)) return value
  if (!Number.isInteger(ndigits) || ndigits < 0 || ndigits > 20) {
    throw new TypeError('pyRound: ndigits must be an integer in [0, 20]')
  }
  if (value === 0) return value
  const neg = value < 0
  const exact = Math.abs(value).toFixed(100) // 精确十进制展开（域见上）
  const dot = exact.indexOf('.')
  const intPart = exact.slice(0, dot)
  const frac = exact.slice(dot + 1)
  const keep = frac.slice(0, ndigits).padEnd(ndigits, '0')
  const rest = frac.slice(ndigits)
  // rest 与 "5000…" 比较：> 半点进位，< 舍去，恰为半点 → 取偶。
  let roundUp: boolean
  const restTrim = rest.replace(/0+$/, '')
  if (restTrim === '') {
    roundUp = false
  } else if (restTrim[0]! > '5') {
    roundUp = true
  } else if (restTrim[0]! < '5') {
    roundUp = false
  } else if (restTrim.length > 1) {
    roundUp = true // 5 后还有非零位 → 超半点
  } else {
    // 精确平局：看保留的最后一位（ndigits=0 时看整数末位）的奇偶
    const lastKept = ndigits > 0 ? keep[ndigits - 1]! : intPart[intPart.length - 1]!
    roundUp = Number(lastKept) % 2 === 1
  }
  let digits = BigInt(intPart + keep)
  if (roundUp) digits += 1n
  let str = digits.toString().padStart(ndigits + 1, '0')
  const out = ndigits > 0 ? `${str.slice(0, -ndigits)}.${str.slice(-ndigits)}` : str
  const parsed = Number(out) // 正确舍入解析（同 Python 回程的 strtod）
  return neg ? -parsed : parsed
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
