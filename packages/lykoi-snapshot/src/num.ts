/**
 * 数值口径工具（W2）：Python 舍入与 statistics.median 的忠实对应物。
 *
 * 快照里的每个 round(...) 都是她看见的字节的一部分（SA-38/39 的数值面），
 * 所以不能用 JS 的 toFixed/Math.round 近似 —— 两者在精确平局（tie）上的
 * 行为与 Python round() 不同（Python = 对精确二进制值做十进制 round-half-even，
 * CPython double_round via _Py_dg_dtoa）。
 */

/**
 * Python 3 `round(value, ndigits)` 的对应物：把 double 的**精确**十进制展开
 * 在 ndigits 位处舍入，恰在半点时取偶（banker's rounding），再正确解析回 double。
 *
 * 精确域说明：|value| ≥ 2^-48 时 `toFixed(100)` 即精确展开（double 的小数位数
 * ≤ 100）；更小的值在本包的用途（ndigits ≤ 3）下结果恒为 ±0，不受影响。
 * golden 对拍见 test/num.test.ts（值由 CPython 逐位生成）。
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

/** Python `statistics.median` 对应物：升序后奇数取中位、偶数取中间两数均值。 */
export function median(values: readonly number[]): number {
  if (values.length === 0) {
    throw new TypeError('median: no data')
  }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid]!
  return (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Python `f"{x:+.2f}"` 的对应物（CAUSES 插值链的渲染面，SA-13）。 */
export function plusFixed2(x: number): string {
  const sign = x < 0 || Object.is(x, -0) ? '-' : '+'
  return sign + Math.abs(x).toFixed(2)
}

/** Python `len(str)` / 切片按码点（CJK 之外含增补面字符时与 UTF-16 单元不同）。 */
export function codePoints(text: string): string[] {
  return [...text]
}
