/**
 * kernel 遥测注入位（shared/log.log_event 对应物）。
 *
 * 事件流是**遥测不是控制流**（SK-08：telemetry 永不可顶替 immutable sink）：
 * 这里的事件在新体统一收到 lykoi-audit 的 JSONL（M2 TODO#4 的 auditLogEvent
 * 词汇：type=事件名），但 dispatch 的审计**门**走的是显式注入的 immutable
 * sink（kernel/dispatch.ts），两条通道结构分立 —— 遥测写失败不拦任何动作，
 * immutable 写失败 fail CLOSED。
 *
 * 缺省 no-op：kernel 是非插件库模块（CF-B1），不知道 audit 服务的存在；
 * 接线方（lykoi-wake / lykoi-converse 的 apply）把 auditLogEvent 递进来。
 */

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
