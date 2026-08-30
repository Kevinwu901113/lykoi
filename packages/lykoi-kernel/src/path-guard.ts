/**
 * 路径守卫 —— symlink-safe 包含判定（guardian/path_guard.py 逐字迁；正本 =
 * 治理仓库 wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/path_guard.py）。
 *
 * 治理核其余部分建在这个原语上：symlink 或 ".." 偷不过一次前缀检查。
 * 活体纪律「imports nothing from the lykoi package」的新体对应物：本模块只
 * import `node:fs`/`node:path`，**不 import 任何本仓包**（含 lykoi-kernel 的
 * 其它模块）—— 它和 policy-core 一样住 GK-13 的 root 属主域，完整性门直接
 * import 它，所以它必须能在没有任何业务代码在场时独立成立。
 *
 * SK-74 逐字：解析失败当「在内」—— fail closed。一个 realpath 都算不出来的
 * 路径不该因为「算不出来」而被放行。
 */
import { realpathSync } from 'node:fs'
import { sep } from 'node:path'

/**
 * `path` 解析后等于 `base` 或落在其下 → true（realpath-safe）。
 * 解析异常 → **true**（当作在内，fail closed；path_guard.py:19-21 逐字）。
 */
export function isWithin(path: string, base: string): boolean {
  let real: string
  let baseReal: string
  try {
    real = realpathSync(path)
    baseReal = realpathSync(base)
  } catch {
    return true // unresolvable -> treat as inside (fail closed)
  }
  return real === baseReal || real.startsWith(baseReal + sep)
}

/** 落进任一禁区 → "deny"，否则 "allow"（path_guard.py:23-24 逐字）。 */
export function classify(path: string, denyZones: readonly string[]): 'deny' | 'allow' {
  return denyZones.some((base) => isWithin(path, base)) ? 'deny' : 'allow'
}
