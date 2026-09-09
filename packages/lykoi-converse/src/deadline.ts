/** Deadlines and explicitly selected transient retries. JSON recovery belongs to lykoi-llm. */
import type { LogEvent } from 'lykoi-decide'

// --- 三旋钮的源码缺省（单一出处） --------------------------------------------

/** 判读调用（approval 解释器，T=0/400 tokens 那一条）的单次超时秒数。 */
export const D01_INTERPRET_TIMEOUT_S = 30
/** 判读调用的有界重试次数（1 = 至多两次尝试；仅限 retry predicate 允许的失败）。 */
export const D01_INTERPRET_RETRIES = 1
/** 一个对话周期（信封调用 + 工具派发全程）的整体超时秒数。 */
export const D01_CYCLE_TIMEOUT_S = 180

/** 三旋钮的成组形态（Schema 缺省与装配面读点共用这一份）。 */
export const D01_DEFAULTS = Object.freeze({
  interpretTimeoutS: D01_INTERPRET_TIMEOUT_S,
  interpretRetries: D01_INTERPRET_RETRIES,
  cycleTimeoutS: D01_CYCLE_TIMEOUT_S,
})

// --- 事件名（D-08 口径：零正文，只记时延/类别/次数） --------------------------

/** 判读调用最终失败（超时或传输抛）——与 `u3_cycle_failed` 同风格的终局事件。 */
export const INTERPRET_FAILURE_EVENT = 'approval_interpret_failed'
/** 判读调用的一次有界重试（与 `u3_cycle_retried` 同风格）。 */
export const INTERPRET_RETRY_EVENT = 'approval_interpret_retried'
/** 对话周期整体超时（`u3_cycle_` 前缀 = 门里声明的对话面 D-08 口径域）。 */
export const CYCLE_TIMEOUT_EVENT = 'u3_cycle_timeout'

// --- 超时本体 ------------------------------------------------------------------

/**
 * 一次等待撞上了它的上限。**不是**供应商错误、不是契约失败 —— 是"我们不再等了"
 * 这个决定本身，所以它有自己的类名，事件与断言都认它。
 */
export class DeadlineExceededError extends Error {
  /** 被切断的是哪一段等待（事件里的 `what`）。 */
  readonly what: string
  /** 当时生效的上限（毫秒）。 */
  readonly timeoutMs: number
  /** 实际等了多久（与判定读同一只表）。 */
  readonly elapsedMs: number

  constructor(what: string, timeoutMs: number, elapsedMs: number) {
    super(`${what}: deadline of ${timeoutMs}ms exceeded (waited ${elapsedMs}ms)`)
    this.name = 'DeadlineExceededError'
    this.what = what
    this.timeoutMs = timeoutMs
    this.elapsedMs = elapsedMs
  }
}

/** 毫秒计的单调读点（超时判定与 elapsed 元数据共用它 —— 播种与读取同钟）。 */
export function monotonicNowMs(): number {
  return performance.now()
}

/** 秒 → 毫秒；非有限/非正数 = 不设限（`0` 是「关掉这条边」的显式写法）。 */
export function deadlineMs(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.round(seconds * 1000)
}

/**
 * 给一段等待加一条边。
 *
 * `run` 收到一个 `AbortSignal`：超时即 abort（reason = 本次的
 * `DeadlineExceededError`），合作的一方（dsh-llm / fetch）据此真的掐断那一跳。
 * **不合作的一方也拦不住我们**：`Promise.race` 让调用方按时拿回控制权，输掉
 * 比赛的那条腿的拒绝被就地吞掉（否则它会在几十秒后变成一次 unhandledRejection，
 * 把一个已经处理过的超时炸成进程级噪音）。
 *
 * `timeoutMs <= 0` = 不设时间上限、不排 timer；仍响应显式 external 取消。
 */
export class RunAbortedError extends Error {
  readonly reason = 'revision'
  constructor() { super('run aborted for revision'); this.name = 'RunAbortedError' }
}

export async function withDeadline<T>(
  what: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController()
  const started = monotonicNowMs()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const stopped = new Promise<never>((_resolve, reject) => {
    const stop = (error: unknown) => { controller.abort(error); reject(error) }
    onAbort = () => stop(external!.reason)
    if (external?.aborted) onAbort()
    else external?.addEventListener('abort', onAbort, { once: true })
    if (timeoutMs > 0) timer = setTimeout(() => {
      stop(new DeadlineExceededError(what, timeoutMs, Math.round(monotonicNowMs() - started)))
    }, timeoutMs)
  })
  // 即使调用方传入已取消 signal，也由 Promise 链观察拒绝，不产生孤立 rejection。
  const running = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return run(controller.signal) })
  try {
    return await Promise.race([running, stopped])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (onAbort !== undefined) external?.removeEventListener('abort', onAbort)
  }
}

// --- 判读调用：超时 + 有界重试 -------------------------------------------------

export interface InterpretDeadline {
  /** 单次判读调用上限（秒）。 */
  timeoutS: number
  /** 有界重试次数（`retries=1` → 至多两次尝试）。 */
  retries: number
  /** Defaults to retrying only this wrapper's deadline. Callers may select transient transport failures. */
  shouldRetry?: (error: unknown) => boolean
  logEvent: LogEvent
}

/** Bound each interpretation attempt; only the selected error class may start another attempt. */
export async function runInterpretWithDeadline<T>(
  actionType: string,
  opts: InterpretDeadline,
  call: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeoutMs = deadlineMs(opts.timeoutS)
  const retries = Number.isFinite(opts.retries) && opts.retries > 0 ? Math.floor(opts.retries) : 0
  for (let attempt = 0; ; attempt += 1) {
    const started = monotonicNowMs()
    try {
      return await withDeadline('approval_interpret', timeoutMs, call)
    } catch (exc) {
      const elapsedMs = Math.round(monotonicNowMs() - started)
      const timedOut = exc instanceof DeadlineExceededError
      const reason = timedOut ? 'timeout' : 'error'
      const errorType = exc instanceof Error ? exc.name : 'Error'
      if (attempt < retries && (opts.shouldRetry?.(exc) ?? timedOut)) {
        opts.logEvent(INTERPRET_RETRY_EVENT, {
          action_type: actionType,
          attempt: attempt + 1,
          reason,
          error_type: errorType,
          elapsed_ms: elapsedMs,
          timeout_s: opts.timeoutS,
        })
        continue
      }

      opts.logEvent(INTERPRET_FAILURE_EVENT, {
        action_type: actionType,
        error_type: errorType,
        elapsed_ms: elapsedMs,
        reason,
        attempts: attempt + 1,
        timeout_s: opts.timeoutS,
        retries: retries,
      })
      throw exc
    }
  }
}
