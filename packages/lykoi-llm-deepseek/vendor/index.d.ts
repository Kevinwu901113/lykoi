/**
 * 手写声明文件：只覆盖 lykoi 侧实际消费的导出面。
 * 运行时正本是同目录 index.js（vendored @deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2，
 * CF-B6 剥头版，改动点见其文件头）；上游不随包发 .d.ts 源（lib/types 仅覆盖内部模块），
 * 此处按 bundle 实际导出与上游 Config schema 如实声明，不扩不减语义。
 */
import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

export interface DeepSeekCatalogModel {
  id: string
  name?: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  inputModalities?: ('text' | 'image')[]
  imagePixelBudget?: number
  imageMaxBytes?: number
  imageDetail?: 'auto' | 'low'
}

export interface DeepSeekConfig {
  /** 凭据=环境引用（credential-ref），按请求解析；配置里永不放明文 key。 */
  apiKeyEnv?: string
  baseURL?: string
  thinking?: 'enabled' | 'disabled'
  reasoningEffort?: 'off' | 'low' | 'high' | 'max'
  maxTokens?: number
  defaultContextWindow?: number
  models?: DeepSeekCatalogModel[]
  streamIdleTimeoutMs?: number
  maxRequestFilesBytes?: number
  maxInlineRequestImageBytes?: number
  maxImagesPerRequest?: number
  imageOffloadByteQuantum?: number
  inlineImageOffloadByteQuantum?: number
  imageOffloadCountQuantum?: number
  filesApiTimeoutMs?: number
  fileExpiresAfterSeconds?: number
  fileRefreshMarginSeconds?: number
  fileQuotaCleanupBatch?: number
  retryPolicy?: unknown
}

export const name: string
export const inject: string[]
export const PUBLIC_BASE_URL: string
export const Config: Schema<DeepSeekConfig>

export class DeepSeekAdapter {
  constructor(config: unknown)
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

export function apply(ctx: Context, config?: DeepSeekConfig): void
export function resolveAdapterOptions(config: DeepSeekConfig, environment?: unknown): unknown
