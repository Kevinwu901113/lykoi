/**
 * lykoi-llm/mock — M1 波次 1 的 mock adapter。
 *
 * 形态照抄 WO-M0-DSH-STUDY §3.1（dsh-llm-deepseek）：插件不提供服务，
 * 而是向 ctx.llm（LlmRuntime）注册 provider 路由；重复注册由 runtime 抛
 * DUPLICATE_ADAPTER；注册随 fiber 注销（registerAdapter 文档承诺）。
 *
 * 波次 2 由 CF-B6 vendored 的 lykoi-llm-deepseek（剥头版）替换本路由。
 * 用量固定可配 → profile 红测的算术是确定性的。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import Schema from '@deepseek-ai/schemastery'

export interface MockAdapterOptions {
  replyText: string
  promptTokens: number
  completionTokens: number
}

export class MockAdapter extends LlmAdapter {
  /** 实际发生的 stream 次数——「gate 拒绝时调用不发生」的观测点。 */
  calls = 0
  #options: MockAdapterOptions

  constructor(options: MockAdapterOptions) {
    super()
    this.#options = options
  }

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    const { replyText, promptTokens, completionTokens } = this.#options
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: replyText }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: replyText } }
    // dsh-llm 契约：usage 在终止 finish 之前发出。
    yield {
      type: 'usage',
      usage: { inputTokens: promptTokens, outputTokens: completionTokens },
    }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

export const name = 'lykoi-llm-mock'
export const inject = ['llm']

export interface Config {
  /** 注册到 LlmRuntime 的 provider 路由名。 */
  provider: string
  replyText: string
  /** 每次调用固定报告的用量（确定性红测算术）。 */
  promptTokens: number
  completionTokens: number
}

export const Config: Schema<Config> = Schema.object({
  provider: Schema.string().default('mock'),
  replyText: Schema.string().default('lykoi mock reply'),
  promptTokens: Schema.number().default(21),
  completionTokens: Schema.number().default(13),
})

export function apply(ctx: Context, config: Config) {
  // 注册路由；disposer 随 fiber 注销（见 dsh-llm registerAdapter 文档）。
  ctx.llm.registerAdapter([config.provider], new MockAdapter({
    replyText: config.replyText,
    promptTokens: config.promptTokens,
    completionTokens: config.completionTokens,
  }))
}
