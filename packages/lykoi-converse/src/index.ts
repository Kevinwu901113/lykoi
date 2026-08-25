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
  CallId, createAssistantMessage, createMessage, createToolResultMessage,
  createUserMessage, type Message,
} from '@deepseek-ai/dsh-llm'
import type {} from 'lykoi-llm'
import type { InboundMessage, TelegramAdapterService } from 'lykoi-adapter-telegram'
import {
  loadPersona, seedPersona, OrganInventoryCache, type LogEvent,
} from 'lykoi-decide'
import {
  createApprovalConversation, createDispatch, kernelActionCatalog,
  INTERPRET_MAX_TOKENS, INTERPRET_TEMPERATURE, setApprovalAuditSink,
  setApprovalInterpretLlm, setIdentityBindingLookup, setKernelLogEvent,
  unwiredResources, type ApprovalConversation,
} from 'lykoi-kernel'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { emptyNotifications } from 'lykoi-reflow'
import { latestRestartEvent, recordRestartEvent } from 'lykoi-snapshot'
import {
  ContextBudgetError, Conversation, composeSurfaceReply,
  type ConverseDispatchFn, type ConverseLlmFn, type ConverseLlmResult,
} from './conversation.ts'
import { ENVELOPE_RETRY_MAX, type ConverseMessage } from './contract.ts'

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

/**
 * D-01 有界重试的**超时预算容纳位**（M3-W2 立位；生产值 M4 定）。
 *
 * 一个对话回合最多发起 `ENVELOPE_RETRY_MAX + 1` 次信封调用（not_json 才重试，
 * 一次为限）；owner 的一次审批答复再另计**至多一次**判读调用（快通道跳 LLM，
 * 所以是上限不是常量）。设备/网关侧的单回合超时必须容得下这个乘数，否则一次
 * 本来会成功的重试会在传输层被切成静默失败 —— 那恰好是 D-01 想消灭的那种
 * "看不见的断点"。
 *
 * 刻意**不**在这里写秒数：单次调用上限与回合硬顶是生产配置（cordis.yml，
 * M3-W4/M4），猜一个数比留空更坏。设备侧配置面（lykoi-adapter-telegram 的
 * pollTimeoutS 等）在接线时对着这个乘数核。
 */
export const TURN_LLM_CALLS_MAX = ENVELOPE_RETRY_MAX + 1
/** 一次审批答复回合的判读调用上限（快通道为 0）。 */
export const APPROVAL_INTERPRET_CALLS_MAX = 1

/** 服务面：console/测试可直达回合入口。 */
export interface ConverseService {
  conversation: Conversation
  /**
   * 审批器官（M3-W2 接线）：两条腿都已是真身。**设备侧承重归 W3** —— 那一层
   * 才有当轮入站 message_id（E2 分层），由它拿 `takeDelegatedAsk()` 的四项载荷
   * 调 `requestApproval(..., replyTo=入站 id)`，并把 owner 的来话按 S-08 三级
   * 路由的第一级交给 `handleOwnerAnswer`。本波把器官装配好并暴露在这里。
   */
  approval: ApprovalConversation
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
      // M3-W2 收口（M2 遗留 #13）：tool_calls 合成帧走 dsh 词汇的**原生形态**
      // （ToolCallBlock），不再折成 `[tool_calls] …` 文本。折文本把"她决定动手"
      // 从结构降级成一句散文 —— 对面模型看到的不是一次调用，回填的 tool 结果
      // 也就对不上号。原生映射后 assistant/tool 两帧由 CallId 成对，id 就是
      // 信封周期里 `cycleCall` 造的那个。
      if (m.tool_calls !== undefined && m.tool_calls.length > 0) {
        return createAssistantMessage({
          content: m.tool_calls.map((c) => ({
            type: 'tool-call' as const,
            id: CallId(c.id),
            name: c.function.name,
            arguments: c.function.arguments,
          })),
          source: { provider: config.route, model: config.model },
        })
      }
      return createAssistantMessage({
        content: [{ type: 'text', text: m.content ?? '' }],
        source: { provider: config.route, model: config.model },
      })
    }
    if (m.role === 'tool') {
      // 同上：结果帧走 createToolResultMessage（callId 绑回上面那次调用），
      // 不再折成 `[工具结果] …` 的 user 文本帧。
      return createToolResultMessage({
        callId: CallId(m.tool_call_id ?? ''),
        content: [{ type: 'text', text: m.content ?? '' }],
        isError: false,
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
    // S-52 wire 映射的实况（M3-W2 复核，如实留）：dsh-llm 0.1.1-rc.2 的
    // `GenerateOptions`（node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts
    // :332-368）**没有** response_format 这一位 —— provider/model/messages/
    // system/tools/temperature/maxTokens/stop/signal/sessionId/purpose 全表如此。
    // 所以钮（envelopeJsonMode，默认开）停在 seam 上：调用形状契约已立、fake
    // LLM 测试断言 seam 取值，wire 那一跳等 dsh 加字段或本体自带 adapter（TODO
    // 已列入 W2 报告，指向 W3/M4）。刻意**不**伪造一个字段塞进去 —— 一个不被
    // adapter 认识的键等于没强制，而"以为强制了"比"知道没强制"危险。
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

  // --- M3-W2 接线：审批器官（SK-30..46） ---
  // ①六元组与 approval_question/answer_routed/execution 走**同一个** immutable
  //   sink（lykoi-audit）—— 不是第二个 sink，只是第二个调用方（SK-35）。
  setApprovalAuditSink(ctx.audit)
  // ②判读 transport：**不新增路由**（SK-36 逐字：chat_completion 是唯一 transport，
  //   判读跑在既有 MAIN 路由的配置上）。归因新增的是 **run 维度**——
  //   `approval-interpret-<action_type>`，于是 budget 账上"审批判读花了多少"可
  //   单独看见，而 route 会计一个桶都没多。T=0/400 由 kernel 侧钉死，这里原样
  //   转发（断言见 kernel test/approval-interpreter.test.ts）。
  setApprovalInterpretLlm(async (messages, opts) => {
    const systemParts: string[] = []
    let i = 0
    while (i < messages.length && messages[i]!.role === 'system') {
      systemParts.push(messages[i]!.content)
      i += 1
    }
    const result = await ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: messages.slice(i).map((m) => createUserMessage({
        content: [{ type: 'text', text: m.content }],
        source: { kind: 'plugin', plugin: 'lykoi-converse' },
      })),
      maxTokens: opts.maxTokens, // = INTERPRET_MAX_TOKENS
      temperature: opts.temperature, // = INTERPRET_TEMPERATURE
      // opts.responseFormat 同 S-52：dsh wire 上今天没有这一位，见上面的实况注。
    }, { runId: opts.runId })
    return { content: result.text }
  })
  // ③两条腿共享**同一个** kernel dispatch —— 问句/追问/回执都以她自己的
  //   messenger.send 出去（E1 章在 kernel 的 _send 漏斗里盖）。
  const approval = createApprovalConversation({ dispatch: kernelDispatch })

  ctx.provide('converse', { conversation, approval })

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

  // S-59/S-77 顺序位：本轮撞门的动作已被认知侧做成四项载荷挂在 conversation 上
  // （`takeDelegatedAsk()`，一轮一份、取走即清；下一轮 send 开头会清场，所以它
  // 绝不会跨轮悬着）。**取走并去问是设备层的活**（W3）—— 只有那一层有当轮入站
  // message_id，而没有 reply_to 的问句按主动打扰计费、名额一耗尽当天余下的问句
  // 全部 undelivered → deny_by_default（8-19 六连拒的病灶）。本波不在这里代问，
  // 也不在这里把载荷取走（取走 = 丢掉）；只落一条**零正文**的账，让这个缺口在
  // 事件流上看得见而不是静默。
  const delegatedAsk = conversation.peekDelegatedAsk()
  if (delegatedAsk !== null) {
    await ctx.audit.record({
      type: 'converse/approval_request_pending',
      runId,
      updateId: message.updateId,
      action_type: delegatedAsk.action_type, // D-08：只记类型，params 一个字不进事件流
      action_id: delegatedAsk.action_id,
      correlation_id: delegatedAsk.correlation_id,
      device_side_wired: false, // W3 接上之后这一栏翻成 true
    })
  }

  // D-04 装配点：pending 的权威源 = kernel `pendingCount()`；接线随 W3 的设备
  // 侧（横幅要不要出现是"对话面"的决定，与队列真身在不在无关）。恒 0 前横幅
  // 不可能出现；出现后 reply 为空也**不加横幅** —— 沉默一路走到底，红测钉死。
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
  // ……后请示：审批问句顺序位。载荷已经在上面落过账（converse/approval_request_pending）；
  // **取走并以入站 id 为 reply_to 去问是设备层的活**（W3）—— 见上面那段注。
}
