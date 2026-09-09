/** Budgeted LLM service. JSON protocol recovery is bounded here; every provider attempt is gated and charged. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { extractJson, repairTrailingClosers, JSON_RETRY_NUDGE } from './json.ts'

import type { Context } from '@deepseek-ai/cordis'
import type {
  FinishReason,
  GenerateOptions,
  LlmFailure,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {} from 'lykoi-budget'

export interface LlmCallMeta {
  /** run 归因：这次调用属于哪一次运行/决策周期（budget.charge 的 runId）。 */
  runId: string
}

export interface ResponseFormat {
  type: 'json_object'
}

export type LykoiGenerateOptions = GenerateOptions & {
  responseFormat?: ResponseFormat
}

export interface LlmCallResult {
  /** 全部 text-delta 拼接。 */
  text: string
  /** 适配器在终止 finish 前报告的用量；缺席时以 0 记账。 */
  usage?: TokenUsage

  finish?: FinishReason

  reasoningLength: number
}

/**
 * 失败类 finish 的词表 —— 出处是 `@deepseek-ai/dsh-llm@0.1.1-rc.2` 的
 * `FinishReasonMap`（`lib/types/types.d.ts:94-114`）：五个 kind 里恰好两个带
 * `failure: LlmFailure` —— `'aborted'` 与 `'error'`；另外三个
 * （`'stop'` / `'tool-calls'` / `'max-tokens'`）是无 failure 的正常终止。
 *
 * 同一划分也是 LlmRuntime 自己的口径：`adapterFailureChunk`（`lib/index.js`）
 * 把 adapter 的抛值归一成 `aborted`（signal 已 abort 或 `code === 'ABORTED'`）
 * 或 `error`；`lib/invariant.js` 的未闭合块检查同样只对这两个 kind 放行。
 *
 * `FinishReasonMap` 是 merge-extensible 的：将来插件新增的 kind **不**在此表内，
 * 按非失败类原样带出 —— 本层不替别人猜语义。
 */
export const FAILURE_FINISH_KINDS = ['error', 'aborted'] as const

/** 失败类 finish 的 kind（{@link FAILURE_FINISH_KINDS} 的成员类型）。 */
export type FailureFinishKind = (typeof FAILURE_FINISH_KINDS)[number]

/** 失败类 finish 的 reason 全量（必带 `failure: LlmFailure`）。 */
export type FailureFinishReason = Extract<FinishReason, { kind: FailureFinishKind }>

/** finish.reason 是否属于失败类词表（缺席 finish = 不是失败类）。 */
export function isFailureFinish(reason: FinishReason | undefined): reason is FailureFinishReason {
  return reason !== undefined && (FAILURE_FINISH_KINDS as readonly string[]).includes(reason.kind)
}

export class LlmFinishError extends Error {
  /** 终止原因全量（dsh-llm 词汇原样，含 `failure` 的 code/status/requestId）。 */
  readonly reason: FailureFinishReason
  /** 归因路由（= `GenerateOptions.provider`，与 budget 记账同一个 route）。 */
  readonly route: string
  /** adapter 在终止前报告的用量；缺席即 undefined（记账已按 0 发生）。 */
  readonly usage?: TokenUsage
  /** 抛出前已拼接到的 text-delta 长度（码点数；事故里的那个 `''` 就是 0）。 */
  readonly textLength: number

  readonly reasoningLength: number

  constructor(input: {
    reason: FailureFinishReason
    route: string
    usage?: TokenUsage
    textLength: number
    reasoningLength: number
  }) {
    const failure: LlmFailure = input.reason.failure
    super(
`lykoi-llm: model call finished with ${input.reason.kind} `
      + `(route=${input.route} code=${failure.code}`
      + (failure.status === undefined ? '' : ` status=${failure.status}`)
      + ` text_chars=${input.textLength}): ${failure.message}`,
    )
    this.name = 'LlmFinishError'
    this.reason = input.reason
    this.route = input.route
    if (input.usage !== undefined) this.usage = input.usage
    this.textLength = input.textLength
    this.reasoningLength = input.reasoningLength
  }
}

export interface LykoiLlmService {
  /**
   * 一次非流式模型调用。结构保证：
   * gate(route) → ctx.llm.stream(options) → charge(usage)。
   * gate 拒绝（BudgetExceeded）时调用不发生；调用发生后无论成败必记账。
   *
   * 失败类 finish（error/aborted）在 charge **之后**抛 {@link LlmFinishError}
   * ——「调用发生后必记账、记账先于抛出」的次序对失败类 finish 同样成立。
   */
  call(options: LykoiGenerateOptions, meta: LlmCallMeta): Promise<LlmCallResult>
}

declare module'@deepseek-ai/cordis' {
  interface Context {
    lykoiLlm: LykoiLlmService
  }
}

/** Maximum provider attempts for a JSON response, including the initial request. */
export const JSON_MAX_ATTEMPTS = 3
export class LlmJsonError extends Error {
  constructor() { super('lykoi-llm: provider did not return valid JSON'); this.name = 'LlmJsonError' }
}

class LykoiLlm implements LykoiLlmService {
  #ctx: Context

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  async call(options: LykoiGenerateOptions, meta: LlmCallMeta): Promise<LlmCallResult> {
    const attempts = options.responseFormat?.type === 'json_object' ? JSON_MAX_ATTEMPTS : 1
    for (let attempt = 0; attempt < attempts; attempt++) {
      options.signal?.throwIfAborted()
      let request = options
      if (attempt > 0) {
        const { responseFormat: _format, ...rest } = options
        request = { ...rest, messages: [...options.messages, createUserMessage({
          content: [{ type: 'text', text: JSON_RETRY_NUDGE }], source: { kind: 'user' },
        })] }
      }
      let result: LlmCallResult
      try {
        result = await this.#callOnce(request, meta)
      } catch (error) {
        if (attempts > 1 && error instanceof LlmFinishError && error.reason.failure.code === 'EMPTY_RESPONSE') {
          options.signal?.throwIfAborted()
          if (attempt + 1 < attempts) continue
        }
        throw error
      }
      options.signal?.throwIfAborted()
      if (attempts === 1) return result
      try {
        return { ...result, text: JSON.stringify(extractJson(result.text)) }
      } catch {
        // Only missing syntax closers may be repaired. A truncated string would
        // invent content, so it must go through a fresh, budgeted generation.
        const repaired = result.finish?.kind === 'max-tokens' ? null : repairTrailingClosers(result.text)
        if (repaired) return { ...result, text: repaired.text }
        this.#ctx.logger.debug('llm_json_invalid run=%s attempt=%d text_chars=%d', meta.runId, attempt + 1, [...result.text].length)
      }
    }
    throw new LlmJsonError()
  }

  async #callOnce(options: LykoiGenerateOptions, meta: LlmCallMeta): Promise<LlmCallResult> {
    if (typeof meta?.runId !== 'string' || meta.runId.length === 0) {
      throw new TypeError('lykoi-llm: call requires meta.runId for run attribution')
    }
    // ① 前置闸：结构保证——gate 抛 BudgetExceeded 时下面的 stream 根本不会发生。
    await this.#ctx.budget.gate(options.provider)
    options.signal?.throwIfAborted()

    let text = ''
    let reasoningLength = 0
    let usage: TokenUsage | undefined
    let finish: FinishReason | undefined
    let thrown: unknown
    let hasThrown = false
    try {
      // ② 调用：dsh-llm 词汇原样使用（provider 路由选 adapter，chunk 流消费）。
      for await (const chunk of this.#ctx.llm.stream(options) as AsyncIterable<StreamChunk>) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
        } else if (chunk.type === 'reasoning-delta') {

          reasoningLength += [...chunk.text].length
        } else if (chunk.type === 'usage') {
          usage = chunk.usage
        } else if (chunk.type === 'finish') {
          finish = chunk.reason
        }
      }
    } catch (err) {
      // LlmRuntime 已把 adapter 失败归一成终止 finish chunk；这里接住的是
      // 中间件/消费侧异常。记账仍要发生（tokens 可能已经花出去了）。
      hasThrown = true
      thrown = err
    }

    const chargeInput = {
      route: options.provider,
      runId: meta.runId,
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    }
    try {
      await this.#ctx.budget.charge(chargeInput)
    } catch (err) {
      if (!hasThrown) throw err
      // 原始调用错误优先抛出；记账错误不淹没但要留痕。
      this.#ctx.logger.error('lykoi-llm: charge failed after stream error: %s', String(err))
    }
    if (hasThrown) throw thrown

    // 归一成终止 finish chunk 不外抛，本层若原样带出，失败就成了一个静默的
    // 返回值 —— 调用方拿到空 text 继续跑，报错晚两层。位置刻意在 ③ 之后：
    // charge 已经发生，记账口径一个字不变（与 hasThrown 路径同序）。

    if (isFailureFinish(finish)) {
      throw new LlmFinishError({
        reason: finish,
        route: options.provider,
        ...(usage ? { usage } : {}),
        textLength: [...text].length,
        reasoningLength,
      })
    }

    return { text, reasoningLength, ...(usage ? { usage } : {}), ...(finish ? { finish } : {}) }
  }
}

export const name = 'lykoi-llm'
// 依赖显式化：llm（dsh-llm LlmRuntime）与 budget（治理地基②）就绪才加载。
export const inject = ['llm', 'budget']

export function apply(ctx: Context) {
  ctx.provide('lykoiLlm', new LykoiLlm(ctx))
}
