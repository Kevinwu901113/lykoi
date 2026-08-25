/**
 * lykoi-llm — 薄注册层。
 *
 * 蓝图（docs/m1_blueprint.md 波次 1）：复用 dsh-llm 的 LlmRuntime 词汇
 * （WO-M0-DSH-STUDY §3.1：「插件=向 seam 注册路由」）；每次调用
 * **前必过 budget.gate、后必 budget.charge —— 这是结构保证不是约定，
 * 在封装层实现**：本服务是模型调用的唯一入口，闸与账长在调用路径里，
 * 绕开本层即绕开预算——
 * TODO(M3): 用 isolate/权限模型把裸 ctx.llm 对业务插件遮蔽掉，
 * 把「唯一入口」从纪律升级为物理边界；蓝图本波未定此机制，不擅自加。
 *
 * 词汇映射：dsh-llm TokenUsage.inputTokens/outputTokens →
 * budget.charge 的 promptTokens/completionTokens（蓝图口径）。
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  FinishReason,
  GenerateOptions,
  StreamChunk,
  TokenUsage,
} from '@deepseek-ai/dsh-llm'
import type {} from 'lykoi-budget'

export interface LlmCallMeta {
  /** run 归因：这次调用属于哪一次运行/决策周期（budget.charge 的 runId）。 */
  runId: string
}

/**
 * S-52 的 wire 位（M3-W3 加派项）。
 *
 * 上游 `GenerateOptions`（dsh-llm 0.1.1-rc.2）恰 12 字段，**没有** response_format。
 * 但 CF-B6 vendor 的 DeepSeek adapter 是**我们自己拼 HTTP payload** 的
 * （`requestWithMessages`：temperature/maxTokens 都在那里译成 wire 字段），所以
 * 这一位归我们译 —— vendor 改动点 7/7。本层只做**透传**：多出来的键随 options
 * 对象原样穿过 LlmRuntime（`adapterStream` 只对 messages 做投影，其余键整体 spread），
 * 落到 adapter 的 payload 构建处。
 *
 * 缺席即键不出现在 wire body 上（钮关 = 没有这个键，不是 null）。
 */
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
  /** 终止原因（error/aborted 也原样带出，由调用方裁决）。 */
  finish?: FinishReason
}

export interface LykoiLlmService {
  /**
   * 一次非流式模型调用。结构保证：
   * gate(route) → ctx.llm.stream(options) → charge(usage)。
   * gate 拒绝（BudgetExceeded）时调用不发生；调用发生后无论成败必记账。
   */
  call(options: LykoiGenerateOptions, meta: LlmCallMeta): Promise<LlmCallResult>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    lykoiLlm: LykoiLlmService
  }
}

class LykoiLlm implements LykoiLlmService {
  #ctx: Context

  constructor(ctx: Context) {
    this.#ctx = ctx
  }

  async call(options: LykoiGenerateOptions, meta: LlmCallMeta): Promise<LlmCallResult> {
    if (typeof meta?.runId !== 'string' || meta.runId.length === 0) {
      throw new TypeError('lykoi-llm: call requires meta.runId for run attribution')
    }
    // ① 前置闸：结构保证——gate 抛 BudgetExceeded 时下面的 stream 根本不会发生。
    await this.#ctx.budget.gate(options.provider)

    let text = ''
    let usage: TokenUsage | undefined
    let finish: FinishReason | undefined
    let thrown: unknown
    let hasThrown = false
    try {
      // ② 调用：dsh-llm 词汇原样使用（provider 路由选 adapter，chunk 流消费）。
      for await (const chunk of this.#ctx.llm.stream(options) as AsyncIterable<StreamChunk>) {
        if (chunk.type === 'text-delta') {
          text += chunk.text
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

    // ③ 后置记账：结构保证——调用发生后必 charge，成败一视同仁。
    // TODO(M2): usage 缺席（异常中断/适配器未报量）时按 0 记账；真实 adapter
    // 波次需要治理侧定夺是否引入保守估算，蓝图本波未定。
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

    return { text, ...(usage ? { usage } : {}), ...(finish ? { finish } : {}) }
  }
}

export const name = 'lykoi-llm'
// 依赖显式化：llm（dsh-llm LlmRuntime）与 budget（治理地基②）就绪才加载。
export const inject = ['llm', 'budget']

export function apply(ctx: Context) {
  ctx.provide('lykoiLlm', new LykoiLlm(ctx))
}
