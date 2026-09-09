export function interactiveWindowS(): number {
  const raw = process.env.LYKOI_INTERACTIVE_WINDOW_S
  if (raw === undefined || raw === '') return 120
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : 120
}

/** 进程内的到期时刻（毫秒）；null = 从未标记过。 */
let _activeUntilMs: number | null = null

export function markActive(windowSeconds?: number, now?: Date): void {
  const window = windowSeconds === undefined ? interactiveWindowS() : windowSeconds
  _activeUntilMs = (now ?? new Date()).getTime() + window * 1000
}

export function isActive(now?: Date): boolean {
  if (_activeUntilMs === null) return false
  return (now ?? new Date()).getTime() < _activeUntilMs
}

export function _resetInteractiveLockForTest(): void {
  _activeUntilMs = null
}
