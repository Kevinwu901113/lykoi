import { realpathSync } from 'node:fs'
import { sep } from 'node:path'

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

export function classify(path: string, denyZones: readonly string[]): 'deny' | 'allow' {
  return denyZones.some((base) => isWithin(path, base)) ? 'deny' : 'allow'
}
