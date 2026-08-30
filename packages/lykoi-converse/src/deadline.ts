/**
 * D-01 超时预算 —— 三个旋钮的**唯一源码出处**与它们的强制机制（M4-W1 交付①）。
 *
 * 背景：G-10 给了信封周期一条有界重试（`ENVELOPE_RETRY_MAX`，只对 not_json），
 * 但**没有给任何一次调用一条时间上的边**。一次挂住的 completion 会把整个回合
 * 悬在那里 —— 她不回话、不沉默、也不失败，Kevin 看到的只是"没反应"。D-01 要
 * 消灭的正是这种"看不见的断点"：**每一次等待都有一个说得出口的上限**，超了就
 * 切断、落账、按失败方向收场（永不因为超时而放行任何东西）。
 *
 * 三个数（治理侧建议值，Kevin 2026-08-31「按现有建议默认值」授权采用；
 * docs/m4_blueprint.md §决断项定案）：
 *
 *  - `interpretTimeoutS = 30` —— 判读是 T=0/400 tokens 的小调用（经代理），30s
 *    有界。语义 =「一次审批问句判读 30s 问不到就算问不到」。
 *  - `interpretRetries = 1`  —— 与 G-10 信封 not_json 有界重试一次同形，不多不少。
 *    配超时 = 最坏 60s。
 *  - `cycleTimeoutS = 180`   —— 对话周期含信封调用 + 工具派发；活体实证存在 89s
 *    的合法长答（8-12 查证再回话那次），180s = 两倍余量。D1 的中位 <15s 仍是
 *    健康指标，不是杀线。
 *
 * **单一出处**：装配面（`profile/cordis*.yml` 的 `converse.config.*`）不给时，
 * Schema 缺省读的就是本文件这三个常量 —— 源码缺省与 profile 值同源同数，
 * 「profile 里那三行被删掉」不会悄悄换成另一套语义。
 *
 * 形态是 **AbortSignal**：`withDeadline` 造一个 controller，超时即 abort，并把
 * signal 递给被等待的那一方。dsh-llm 的 `GenerateOptions.signal` 收它 —— 于是
 * 切断不只是"这边不等了"，而是**真的把那一跳掐掉**（连接与 tokens 都不再挂着）。
 * 同时 `Promise.race` 保证：即使对面完全不理会 signal（一个挂死的 fake、一个
 * 不支持取消的适配器），调用方也**按时**拿回控制权。
 *
 * 事件风格对齐 G-10 的 `u3_cycle_failed`：`error_type` / `elapsed_ms` / `reason`
 * / `attempts`，**零正文**（D-08 口径），elapsed 与超时判定读**同一只表**
 * （同一次调用内的 `performance.now()` 两点差），不跨钟。
 */
import type { LogEvent } from 'lykoi-decide'

// --- 三旋钮的源码缺省（单一出处） --------------------------------------------

/** 判读调用（approval 解释器，T=0/400 tokens 那一条）的单次超时秒数。 */
export const D01_INTERPRET_TIMEOUT_S = 30
/** 判读调用的有界重试次数（1 = 至多两次尝试；与 ENVELOPE_RETRY_MAX 同形）。 */
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
  return performance.now() // realtime-allow: 时延量真实墙钟（与 G-10 周期时延同法）
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
 * `timeoutMs <= 0` = 不设限（原样 await，不造 controller、不排 timer）。
 */
export async function withDeadline<T>(
  what: string,
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) return await run(new AbortController().signal)
  const controller = new AbortController()
  const started = monotonicNowMs()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const exc = new DeadlineExceededError(what, timeoutMs, Math.round(monotonicNowMs() - started))
      controller.abort(exc)
      reject(exc)
    }, timeoutMs)
  })
  const running = run(controller.signal)
  // 输掉比赛的那条腿：拒绝已经被上面这条边代表过了，就地吞掉。
  running.catch(() => {})
  try {
    return await Promise.race([running, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

// --- 判读调用：超时 + 有界重试 -------------------------------------------------

export interface InterpretDeadline {
  /** 单次判读调用上限（秒）。 */
  timeoutS: number
  /** 有界重试次数（`retries=1` → 至多两次尝试）。 */
  retries: number
  logEvent: LogEvent
}

/**
 * 判读调用的 D-01 强制面（超时 + 有界重试 + 终局落账）。
 *
 * 失败方向由 kernel 那一侧钉死：`interpret` 的五失败路之一是「transport 抛
 * （超时/供应商/未接线）→ `unclear`」—— 所以这里**抛出去**就是安全的，
 * 永不 approve，永不挡路。本函数只负责三件事：按时切断、有界重试、把
 * elapsed 元数据落进事件流。
 *
 * 重试的判据与 G-10 同向：**偶发才重试**。超时与传输抛都属偶发（一次挂住的
 * 连接、一次 5xx），所以两者都重试一次；重试次数由旋钮定死，不看错误类别再
 * 加码 —— 有界的意思就是最坏时延算得出来（`timeoutS × (retries+1)`）。
 */
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
      if (attempt < retries) {
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
      // 终局：形状与 G-10 的 u3_cycle_failed 同族（error_type/elapsed_ms/
      // reason/attempts），**零正文**。
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
