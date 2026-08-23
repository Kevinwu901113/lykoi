/**
 * lykoi-llm-deepseek — CF-B6 剥头版 DeepSeek adapter（M1 波次 2 交付①）。
 *
 * 取舍（蓝图 CF-B6 + WO-M0-DSH-STUDY §7.2 选项 a）：上游
 * `@deepseek-ai/dsh-llm-deepseek@0.1.1-rc.2` 的 lib 产物是可读的 esbuild 输出
 * （保留符号名与注释），假名头的产生与附着共 6 个干净改动点，故走「vendor 其源 +
 * 剥头」而非自写薄 adapter——上游的 SSE 解析/重试/超时/last-good 配置降级
 * （WO-M0-DSH-STUDY §3.1 形态）全部逐字保留。
 *
 * 剥除面（正本见 ../vendor/index.js 文件头，6 处均有行内标记）：
 * - `x-deepseek-harness-user-id`（每请求实例假名头）——删；
 * - `x-deepseek-harness-session-id`（会话假名头）——删；
 * - `@deepseek-ai/dsh-anonymous-user-id` 依赖——随之整体移除（不进依赖树）；
 * - UA 归因头 `deepseek-harness/<version>`（attributionHeaders）——CF-B6 定案保留。
 *
 * 形态不变（WO-M0-DSH-STUDY §3.1）：插件不提供服务，而是向 ctx.llm（LlmRuntime）
 * 注册 provider 路由 `deepseek-official`；凭据走 apiKeyEnv 环境引用按请求解析，
 * 永不落明文（蓝图纪律 5）；settings/credentials/attachments 三个 seam 保持可选。
 */
export {
  name,
  inject,
  Config,
  apply,
  DeepSeekAdapter,
  PUBLIC_BASE_URL,
  resolveAdapterOptions,
} from '../vendor/index.js'
export type { DeepSeekConfig, DeepSeekCatalogModel } from '../vendor/index.js'
