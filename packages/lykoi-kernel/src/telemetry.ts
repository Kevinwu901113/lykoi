export type KernelLogEvent = (name: string, fields: Record<string, unknown>) => void

let _logEvent: KernelLogEvent = () => {}

/** 接线方（插件 apply）/测试设置遥测出口；null 恢复 no-op。 */
export function setKernelLogEvent(fn: KernelLogEvent | null): void {
  _logEvent = fn ?? (() => {})
}

/** kernel 内部统一发射点。发射失败由注入方自吞（遥测不是控制流）。 */
export function logEvent(name: string, fields: Record<string, unknown> = {}): void {
  try {
    _logEvent(name, fields)
  } catch {
    // 遥测失败静默：它永远不该改变任何治理判定的走向。
  }
}
