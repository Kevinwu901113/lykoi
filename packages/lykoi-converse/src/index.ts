/**
 * lykoi-converse —— 对话路径插件（M2 W5：由 M1 lykoi-converse-min 演进）。
 *
 * M1 的它是管线证明（占位提示词、零装配）；W5 起它是她的对话心智：
 * 真装配器（三段带十二块，S-23..S-34）+ 信封周期（S-35..S-53 + G-10 修正版）
 * + 回合骨架 + conversationTurnReflow。改名理由（蓝图"原包演进为治理缺省；
 * 若改名给出理由"）：包名是插件树里的公开身份，"-min" 在 M1 特指"非心智的
 * 管线证明"—— 让她的对话心智永远顶着这个名字，是让名字说谎。
 *
 * 链路：适配器盖章的入站 → Conversation.send（装配 → 信封 → 四选一）→
 * 适配器 send（reply_to=入站 message_id，SPEC §7.1 应答路径 —— 不计打扰预算）。
 * 每步落 audit 行（D-08：只记长度/哈希，零正文）；budget 有账（lykoiLlm 的
 * 结构保证：gate 前置、charge 后置）。
 *
 * 出生序（surface/app.py 模块加载序对应）：seedPersona（首次 persona 投影
 * 之前）→ recordRestartEvent（建 Conversation 之前 —— 她这辈子的第一条
 * system prompt 就带着重启叙事）→ Conversation。**seedConcerns 不在这里**：
 * 那是显式的 owner 侧引导步骤（mind/bootstrap 语义：going live is an explicit
 * owner-side step, not an import side effect）。record_deploy_event（git sha
 * 盖章）随 M3 生产部署接线。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import {
  createAssistantMessage, createMessage, createUserMessage, type Message,
} from '@deepseek-ai/dsh-llm'
import type {} from 'lykoi-llm'
import type { InboundMessage, TelegramAdapterService } from 'lykoi-adapter-telegram'
import {
  loadPersona, seedPersona, OrganInventoryCache, type LogEvent,
} from 'lykoi-decide'
import {
  createDispatch, kernelActionCatalog, setIdentityBindingLookup, setKernelLogEvent,
  unwiredResources,
} from 'lykoi-kernel'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { emptyNotifications } from 'lykoi-reflow'
import { latestRestartEvent, recordRestartEvent } from 'lykoi-snapshot'
import {
  ContextBudgetError, Conversation, composeSurfaceReply,
  type ConverseDispatchFn, type ConverseLlmFn, type ConverseLlmResult,
} from './conversation.ts'
import type { ConverseMessage } from './contract.ts'

export * from './contract.ts'
export * from './conversation.ts'
export * from './exemption.ts'
export * from './hygiene.ts'
export * from './prompts.ts'

export const name = 'lykoi-converse'
// audit/lykoiLlm 硬依赖；telegram 经 ctx.get 可选消费（telegram 默认 disabled
// 时本插件照常挂载、安静待命 —— dsh 形态的可选 seam）。
export const inject = ['audit', 'lykoiLlm']

export interface Config {
  /** state 副本路径（golden devstate 永远只读 —— 生产接治理侧发的可写副本）。 */
  dbPath: string
  /** persona TOML 路径（owner 域；装载失败 = 启动即炸，SA-156 fail-fast）。 */
  personaToml: string
  /** LLM 路由（budget 同词汇）与模型。 */
  route: string
  model: string
  /** 开机标记文件（restart 叙事的 prev-boot 对照）。 */
  restartMarker: string
  /** 演化叙事 flag 文件（存在才注入；空串 = 回路关闭）。 */
  narrativeFlag: string
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
  personaToml: Schema.string().required(),
  route: Schema.string().default('mock'),
  model: Schema.string().default('mock-model'),
  restartMarker: Schema.string().default('var/restart-marker.json'),
  narrativeFlag: Schema.string().default(''),
})

/** 服务面：console/测试可直达回合入口。 */
export interface ConverseService {
  conversation: Conversation
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    converse: ConverseService
  }
}

export function apply(ctx: Context, config: Config) {
  const logEvent: LogEvent = (eventName, fields) => {
    // 事件流是遥测不是控制流 —— 写失败不打断回合。
    ctx.audit.record({ type: eventName, ...fields }).catch((err) => {
      ctx.logger.error('lykoi-converse: audit record failed: %s', String(err))
    })
  }
  const store = new ReadWriteMemory(resolve(config.dbPath), { logEvent })
  ctx.effect(() => () => store.close(), 'lykoi-converse rw handle')

  // M3-W1 接线：kernel 遥测出口 + scope key 的 identity_bindings 读点（进程级
  // 注入位 —— wake 与本插件递的是同一 db 的等价读点，后设者胜、语义相同）。
  setKernelLogEvent(logEvent)
  setIdentityBindingLookup((channel, channelKey) => store.identityBindingUserId(channel, channelKey))

  const persona = loadPersona(resolve(config.personaToml))

  // --- 出生序（文件头注释） ---
  seedPersona(store, { now: new Date() })
  recordRestartEvent(store, {
    markerPath: resolve(config.restartMarker),
    now: new Date(),
    // SA-164：读不到的线索省略绝不编造 —— git HEAD/downtime 采集器归 M3 生产
    // 接线；systemd invocation id 环境可读就带上。
    clues: { invocationId: process.env.INVOCATION_ID ?? null },
    logEvent,
  })

  const organs = new OrganInventoryCache({
    bindings: () => store.identityBindingInventory(),
    // M3-W1 接线：真 catalog —— kernel KNOWN_ACTIONS + 不可变治理核 is_hard_gated。
    catalog: kernelActionCatalog,
    logEvent,
  })

  // M3-W1 接线：真 kernel dispatch。origin 由接线方盖章（converse=interactive，
  // S-55：origin 永不由模型给）；immutable sink = lykoi-audit（审计门 fail
  // closed 在 kernel 内）；资源注册表 = W1 显式替身（器官真身随 W3/M5 波）。
  const kernelDispatch = createDispatch({ sink: ctx.audit, resources: unwiredResources() })
  const dispatchFn: ConverseDispatchFn = async (action) => {
    const observation = await kernelDispatch(
      { type: action.type, params: action.params },
      { context: { origin: 'interactive' } },
    )
    return { success: observation.success, data: observation.data, error: observation.error }
  }

  // --- LLM seam → lykoiLlm（gate 前置 / charge 后置的结构保证在那一层） ---
  const toDshMessage = (m: ConverseMessage): Message => {
    if (m.role === 'user') {
      return createUserMessage({
        content: [{ type: 'text', text: m.content ?? '' }],
        source: { kind: 'user' },
      })
    }
    if (m.role === 'assistant') {
      // 历史里的 assistant 帧。tool_calls 合成帧的 wire 原生形态（tool-call
      // block）随 M3 真 adapter 路由接线 —— 此处折为文本帧（unwired dispatch
      // 下生产不可达，测试经 Conversation 直连 seam 不走这里）。TODO(M3)。
      const text = m.tool_calls
        ? `[tool_calls] ${m.tool_calls.map((c) => c.function.name).join(', ')}`
        : (m.content ?? '')
      return createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: config.route, model: config.model },
      })
    }
    if (m.role === 'tool') {
      return createUserMessage({
        content: [{ type: 'text', text: `[工具结果] ${m.content ?? ''}` }],
        source: { kind: 'plugin', plugin: 'lykoi-converse' },
      })
    }
    // 中/尾部 system（收尾提示、信封契约 —— 契约必须留在生成点前的最后位置，
    // CACHE-INVERT；不并进 system 槽）。
    return createMessage({
      role: 'system',
      content: [{ type: 'text', text: m.content ?? '' }],
      source: { kind: 'plugin', plugin: 'lykoi-converse' },
    })
  }

  const llm: ConverseLlmFn = async (messages, opts): Promise<ConverseLlmResult> => {
    // 前导 system 段收进单一 system 槽（'\n\n' 连接，装配序保持）；其余逐条映射。
    let i = 0
    const systemParts: string[] = []
    while (i < messages.length && messages[i]!.role === 'system') {
      systemParts.push(messages[i]!.content ?? '')
      i += 1
    }
    // S-52 注：opts.responseFormat 的 wire 映射（response_format=json_object）
    // 随 M3 真 adapter 路由 —— dsh-llm GenerateOptions 今天没有这一位；钮本身
    // （envelopeJsonMode，默认开）与调用形状契约已立，fake LLM 测试断言 seam 值。
    const result = await ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: messages.slice(i).map(toDshMessage),
      ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
    }, { runId: opts.runId })
    return {
      content: result.text,
      finishReason: result.finish?.kind ?? null,
      promptTokens: result.usage?.inputTokens ?? null,
      completionTokens: result.usage?.outputTokens ?? null,
      extraKeys: [], // dsh-llm 面拿不到原始响应键集（reasoning_content 探测归 M3 adapter）
    }
  }

  const conversation = new Conversation({
    store,
    persona,
    llm,
    logEvent,
    organs,
    restartEvent: () => latestRestartEvent(store),
    notifications: emptyNotifications, // M3-W3 接 kernel 通知队列（markReplied 同批）
    dispatchFn, // M3-W1 已接真 kernel（audit 落在 dispatch 层）
    ...(config.narrativeFlag ? { narrativeFlagPath: resolve(config.narrativeFlag) } : {}),
  })

  ctx.provide('converse', { conversation })

  ctx.on('lykoi/telegram/inbound', async (message) => {
    await handleTurn(ctx, conversation, message)
  })
}

async function handleTurn(
  ctx: Context,
  conversation: Conversation,
  message: InboundMessage,
): Promise<void> {
  // 隐私口径（D-08）：audit 行只带字数与来源盖章，不带正文。
  await ctx.audit.record({
    type: 'converse/received',
    updateId: message.updateId,
    contextId: message.contextId,
    userId: message.userId,
    isOwner: message.isOwner,
    chars: message.text.length,
  })
  // S-08 顺序位：审批回答 → 规则建议回答 → 普通对话。前两级仅 owner，随 M3
  // 审批/建议器官在**此处、回合之前**按序消费；当前一律进入普通对话级。

  const runId = `converse-${message.updateId}-${message.messageId}`
  let reply: string
  try {
    reply = await conversation.send(message.text, { runId })
  } catch (err) {
    if (err instanceof ContextBudgetError) {
      // S-20：确定性失败（message_too_large），不调度重试；surface 文案通知归
      // M3 的对话面回执（本波设备侧无自动回执通道）。
      await ctx.audit.record({
        type: 'converse/turn_failed', runId, updateId: message.updateId,
        error: 'ContextBudgetError', kind: 'context_budget',
      })
      return
    }
    // S-21 同向：客户端/事件流只见泛化类别，str(exc) 不出内部日志。
    await ctx.audit.record({
      type: 'converse/turn_failed', runId, updateId: message.updateId,
      error: err instanceof Error ? err.name : 'unknown',
    })
    return
  }

  // D-04 装配点：pending 的权威源随 M3 审批器官（恒 0 前横幅不可能出现；
  // 出现后 reply 为空也**不加横幅** —— 沉默一路走到底，红测钉死）。
  const surfaceReply = composeSurfaceReply(reply, 0, false)
  if (surfaceReply.trim().length === 0) {
    // 沉默是合法结局（有账没话）：u3_cycle_envelope/u3_cycle_failed 是它的账。
    await ctx.audit.record({ type: 'converse/silence', runId, updateId: message.updateId })
    return
  }
  await ctx.audit.record({
    type: 'converse/reply', runId, updateId: message.updateId, chars: surfaceReply.length,
  })
  const telegram = ctx.get('telegram') as TelegramAdapterService | undefined
  if (telegram === undefined) {
    await ctx.audit.record({ type: 'converse/no_transport', runId, updateId: message.updateId })
    return
  }
  // S-10：先说话（reply_to=入站 message_id —— 应答路径不计打扰预算）……
  await telegram.send(message.contextId, surfaceReply, message.messageId)
  // ……后请示：审批问句顺序位（委托问句路 S-59 随 M3 审批器官；不留 stub 调用）。
}
