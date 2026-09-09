/** Cordis conversation assembly, ingress routing and delivery outcomes. */
import { JSON_MAX_ATTEMPTS } from 'lykoi-llm'

import { sequenceUtterances } from './sequencer.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { resolve } from 'node:path'
import {
  createAssistantMessage, createMessage,
  createUserMessage, ReasoningEffortId, type Message,
} from '@deepseek-ai/dsh-llm'
import { LlmFinishError } from 'lykoi-llm'
import type { MessengerAdapterService } from 'lykoi-adapter-telegram'
import type { TurnExecutionResult, UserTurn } from 'lykoi-ingress'
import {
  OutboundOrgan, OutboundUnavailableError, markUndeliveredSurfaced,
  outboxNotificationSink, setMessengerLogEvent, setTransportLogEvent,
  setUndeliveredExperienceSink, unsurfacedUndelivered, appendOutbox,
} from 'lykoi-adapter-telegram'
import {
  loadPersona, OrganInventoryCache, type LogEvent,
} from 'lykoi-decide'
import { stagedInstructions } from 'lykoi-learn'
import {
  createApprovalConversation, createDispatch, createSuggestionConversation,
  getNotifications, markReplied as kernelMarkReplied,
  markActive as markInteractiveActive, pendingCount,
  APPROVAL_RUN_PREFIX,
  setApprovalAuditSink,
  setApprovalInterpretLlm, setIdentityBindingLookup, setOwnerBindingLookup, setKernelLogEvent,
  setNotificationOutboxDelivery,
  setNotificationOutboxSink,
  type ApprovalConversation, type SuggestionConversation,
} from 'lykoi-kernel'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { recordExperience } from 'lykoi-reflow'
import { collectRestartClues, latestRestartEvent, recordDeployEvent, recordRestartEvent } from 'lykoi-snapshot'
import {
  ContextBudgetError, Conversation, selfStateBlock,
  type CycleResult, type ConverseDispatchFn, type ConverseLlmFn, type ConverseLlmResult,
} from './conversation.ts'
import {
  VISION_SEAM_EVENT, createDescribeImage, createVisionCompletion, visionSeamState,
} from './vision.ts'
import { ContinuationRunner, type ContinuationsService } from './continuation.ts'
import { failureReason, isTransientInterpretFailure } from './failure.ts'
import { type ConverseMessage } from './contract.ts'
import { D01_DEFAULTS, runInterpretWithDeadline, RunAbortedError } from './deadline.ts'
import { stripMarkup } from './hygiene.ts'
import {
  cycleFailure, type CycleOutcome, SYSTEM_FAILURE_NOTICE, type TurnFailReason, type TurnOutcome, type TurnStatus,
} from './outcome.ts'

export * from './contract.ts'
export * from './conversation.ts'
export * from './deadline.ts'
export * from './exemption.ts'
export * from './hygiene.ts'
export * from './continuation.ts'
export * from './failure.ts'
export * from './outcome.ts'
export * from './prompts.ts'
export * from './vision.ts'

export const name = 'lykoi-converse'
// audit/lykoiLlm 硬依赖；telegram 经 ctx.get 可选消费（telegram 默认 disabled
// 时本插件照常挂载、安静待命 —— dsh 形态的可选 seam）。
export const inject = ['audit', 'ingress', 'lykoiLlm', 'lykoiRuntime']

export interface Config {
  /** state 副本路径（golden devstate 永远只读 —— 生产接治理侧发的可写副本）。 */
  dbPath: string

  personaToml: string
  /** LLM 路由（budget 同词汇）与模型。 */
  route: string
  model: string
  /** 开机标记文件（restart 叙事的 prev-boot 对照）。 */
  restartMarker: string
  /** 演化叙事 flag 文件（存在才注入；空串 = 回路关闭）。 */
  narrativeFlag: string

  restartRepoRoot: string
  /**
   * restart 线索采集的 systemd 单元名（downtime 问它上次什么时候停的）。
   * 空串 = 不采 downtime（dev 缺省）。
   */
  restartUnit: string

  notificationOutboxDelivery: boolean

  /** 判读调用（approval 解释器，T=0/400 tokens 那条）单次超时秒数。 */
  interpretTimeoutS: number
  /** 判读调用有界重试次数（1 = 至多两次尝试，最坏 timeout×2）。 */
  interpretRetries: number
  /** 一个对话周期（信封 + 工具派发全程）的整体超时秒数。 */
  cycleTimeoutS: number

  visionRoute: string
  visionModel: string
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
  personaToml: Schema.string().required(),
  route: Schema.string().default('mock'),
  model: Schema.string().default('mock-model'),
  restartMarker: Schema.string().default('var/restart-marker.json'),
  narrativeFlag: Schema.string().default(''),
  restartRepoRoot: Schema.string().default(''),
  restartUnit: Schema.string().default(''),
  notificationOutboxDelivery: Schema.boolean().default(false), // GK-8：默认关

  interpretTimeoutS: Schema.number().default(D01_DEFAULTS.interpretTimeoutS),
  interpretRetries: Schema.number().default(D01_DEFAULTS.interpretRetries),
  cycleTimeoutS: Schema.number().default(D01_DEFAULTS.cycleTimeoutS),
  // vision 路由位：缺省**空串 = 没填**（不是 disabled —— 两者必须分得开）。
  visionRoute: Schema.string().default(''),
  visionModel: Schema.string().default(''),
})

export const TURN_LLM_CALLS_MAX = JSON_MAX_ATTEMPTS
/** 一次审批答复回合的判读调用上限（快通道为 0）。 */
export const APPROVAL_INTERPRET_CALLS_MAX = 1

/** 服务面：console/测试可直达回合入口。 */
export interface ConverseService {
  conversation: Conversation

  approval: ApprovalConversation

  suggestion: SuggestionConversation
}

declare module'@deepseek-ai/cordis' {
  interface Context {
    converse: ConverseService

    continuations: ContinuationsService
  }
}

// --- LLM seam → lykoiLlm（gate 前置 / charge 后置的结构保证在那一层） ---

// 级成散文，回填对不上号），但探针 v3/v4（2026-09-03 19:30-19:42）实测：
// 历史里一旦出现这种原生工具帧，DeepSeek adapter 三病同源地退化——
// json_object 遇到就吐 65 个空格（v3）、reasoning_content 回传时对着这段
// 历史 400（J）、无 json 时把 DSML 原生工具调用标记直接泄漏进 content
// （19:19 沉默）。J/K/L 三次分头止血都是在下游猜代偿，这一单换根：把工具
// 步渲染回契约信封本就要求的**文本**形状——assistant 一条文本帧（信封
// JSON.stringify）、工具结果一条 user 文本帧（`[工具结果 <name>] …`）。
// 不声明 tools（本来也没声明）。v4 验证：思考×json 四组合各两次，八次全部

// 提示词块与 dsh-llm 完全无关。

// 模块级导出（而非留在 `apply()` 内的闭包）纯为可测性：provider 显式传参、
// 不捕获 `config`，方便 test/wire.test.ts 直接单测 id→name 回退与 DSML 剥净
// 两条防御分支——真实调用路径（下面 `apply()` 里的 `llm`）与测试走的是
// 同一份实现，不是复刻一份影子逻辑。
export function toDshEnvelopeMessages(
  sliced: readonly ConverseMessage[],
  provider: { route: string; model: string },
): Message[] {
  // id → 工具名，供下面 tool 结果帧的 `[工具结果 <name>]` 解析——文本帧下
  // dsh-llm wire 上不再有原生 CallId 可看，工具名只能从这张预建表回查；
  // 找不到（理论上不会，除非历史被截断只留半截）就回退成 tool_call_id。
  const toolNameById = new Map<string, string>()
  for (const mm of sliced) {
    if (mm.role === 'assistant' && mm.tool_calls) {
      for (const c of mm.tool_calls) toolNameById.set(c.id, c.function.name)
    }
  }
  const out: Message[] = []
  for (const m of sliced) {
    if (m.role === 'user') {
      out.push(createUserMessage({
        content: [{ type: 'text', text: m.content ?? '' }],
        source: { kind: 'user' },
      }))
      continue
    }
    if (m.role === 'assistant') {
      if (m.tool_calls !== undefined && m.tool_calls.length > 0) {
        // 多 call 时按顺序各渲染一条 assistant 文本帧（现实里 cycleCall
        // 一次只造一条 call，这里仍按数组处理，不假设长度恒为 1）。
        for (const c of m.tool_calls) {
          let parsedArgs: unknown
          try {
            parsedArgs = JSON.parse(c.function.arguments)
          } catch {
            // 解析失败（理论上不会，call 本就是我们自己 JSON.stringify 出
            // 来的）：把原字符串塞进 arguments，不许整条渲染失败。
            parsedArgs = c.function.arguments
          }
          const text = JSON.stringify({
            decision: {
              kind: 'tool_call',
              tool: { name: c.function.name, arguments: parsedArgs },
            },
          })
          out.push(createAssistantMessage({
            content: [{ type: 'text', text }],
            source: { provider: provider.route, model: provider.model },
          }))
        }
        continue
      }
      out.push(createAssistantMessage({
        content: [{ type: 'text', text: m.content ?? '' }],
        source: { provider: provider.route, model: provider.model },
      }))
      continue
    }
    if (m.role === 'tool') {
      const name = toolNameById.get(m.tool_call_id ?? '') ?? (m.tool_call_id ?? '')
      // stripMarkup：库里已落的 DSML 机器标记不许经工具结果回灌回上下文

      const text = `[工具结果 ${name}] ${stripMarkup(m.content ?? '')}`
      out.push(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: 'lykoi-converse' },
      }))
      continue
    }
    // 中/尾部 system（收尾提示、信封契约 —— 契约必须留在生成点前的最后位置，
    // CACHE-INVERT；不并进 system 槽）。
    out.push(createMessage({
      role: 'system',
      content: [{ type: 'text', text: m.content ?? '' }],
      source: { kind: 'plugin', plugin: 'lykoi-converse' },
    }))
  }
  return out
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

  const boundChannel = store.ownerBinding()?.channel
  const transportChannel = (ctx.get('messenger') as MessengerAdapterService | undefined)?.channel
  if (boundChannel && transportChannel && boundChannel !== transportChannel) {
    store.close()
    throw new Error('converse: owner binding channel does not match messenger transport')
  }

  // 注入位 —— wake 与本插件递的是同一 db 的等价读点，后设者胜、语义相同）。
  setKernelLogEvent(logEvent)
  setIdentityBindingLookup((channel, channelKey) => store.identityBindingUserId(channel, channelKey))
  setOwnerBindingLookup(() => store.ownerBinding())

  // The launch binding pins both plugins to the instance definition snapshot.
  const persona = loadPersona(resolve(config.personaToml))

  // Creation applies seeds once. Startup restores the existing experience.

  // `recordRestartEvent` 那边缺席即省略，**绝不编造**。dev profile 两个采集配置
  // 都留空 → 只带得到 INVOCATION_ID，与 W5 的行为完全一致（零行为变更）。
  const restartNow = new Date()
  const clues = collectRestartClues({
    repoRoot: config.restartRepoRoot || process.cwd(),
    unit: config.restartUnit || undefined,
    now: restartNow,
    // 仓库根没配就别去跑 git：dev 里跑出来的是**开发机的** HEAD，那不是她的代码事实。
    run: config.restartRepoRoot ? undefined : () => { throw new Error('restart clue collection disabled') },
    logEvent,
  })
  recordRestartEvent(store, {
    ownerName: persona.owner?.name ?? persona.voice.address_owner,
    markerPath: resolve(config.restartMarker),
    now: restartNow,
    clues,
    logEvent,
  })

  recordDeployEvent({
    repoRoot: config.restartRepoRoot || process.cwd(),
    unit: config.restartUnit || undefined,
    now: restartNow,
    clues,
    logEvent,
  })

  // Dispatch and capability rendering share the same live Runtime view.
  const resources = ctx.lykoiRuntime.resources
  const wiredCatalog = ctx.lykoiRuntime.catalog
  const organs = new OrganInventoryCache({
    persona,
    bindings: () => store.identityBindingInventory(),
    catalog: wiredCatalog,
    logEvent,
  })
  ctx.effect(() => ctx.lykoiRuntime.onChange(() => organs.invalidate()), 'capability view')

  // closed 在 kernel 内）。

  // autonomy 2），其余 13 个动作仍是 W1 显式替身（感知/执行器官归 M5）。
  setMessengerLogEvent(logEvent)
  setTransportLogEvent(logEvent)
  // U1 ①：未送达 → 她的经验，走 reflow 的**单写者入口**（不直接碰 store）。

  // 一次开口的回音），方向是 outbound → 第二轴推导为 executed，而不是"别人告诉
  // 我的"（user_reported）。渠道值仍由 transport 侧给（'conversation'，不新造）。
  setUndeliveredExperienceSink((source, content, opts) => recordExperience(
    store, source as 'conversation', content,
    { salience: opts.salience, conversationDirection: 'outbound', now: new Date() },
  ), { ownerName: persona.voice.address_owner })

  setNotificationOutboxSink(outboxNotificationSink(logEvent))

  // 而这一条必须**看得见且被 manifest 钉住**：它改的是通知怎么到达 Kevin。
  setNotificationOutboxDelivery(config.notificationOutboxDelivery)
  const kernelDispatch = createDispatch({ sink: ctx.audit, resources })
  let conversation!: Conversation
  const dispatchFn: ConverseDispatchFn = async (action, context) => {
    const observation = await kernelDispatch(
      { type: action.type, params: action.params },
      {
        context: {
          origin: 'interactive',
          run_id: context.run_id ?? conversation.currentRunId() ?? null,
          turn_id: context.turn_id ?? conversation.currentTurnId() ?? null,
        },
      },
    )
    return { success: observation.success, data: observation.data, error: observation.error }
  }

  // --- LLM seam → lykoiLlm（gate 前置 / charge 后置的结构保证在那一层） ---
  const llm: ConverseLlmFn = async (messages, opts): Promise<ConverseLlmResult> => {
    // 前导 system 段收进单一 system 槽（'\n\n' 连接，装配序保持）；其余逐条映射。
    let i = 0
    const systemParts: string[] = []
    while (i < messages.length && messages[i]!.role === 'system') {
      systemParts.push(messages[i]!.content ?? '')
      i += 1
    }

    const result = await ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: toDshEnvelopeMessages(messages.slice(i), { route: config.route, model: config.model }),
      ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.responseFormat === null || opts.responseFormat === undefined
        ? {}
        : { responseFormat: opts.responseFormat }),

      // **真的断**，而不只是上面不等了（连接与 tokens 都不再挂着）。
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),

      // reasoningEffort` 本就存在，这里只做 opaque brand 的转换（不改调用
      // 签名）。缺席 = 键根本不出现在 wire body 上，同 responseFormat/signal 的
      // 口径。
      ...(opts.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(opts.reasoningEffort) }),
    }, { runId: opts.runId })
    return {
      content: result.text,
      finishReason: result.finish?.kind ?? null,
      promptTokens: result.usage?.inputTokens ?? null,
      completionTokens: result.usage?.outputTokens ?? null,
      extraKeys: [], // dsh-llm 面拿不到原始响应键集（reasoning_content 探测归 M3 adapter）

      // u3_cycle_retried/u3_cycle_failed 记账。
      reasoningLength: result.reasoningLength,
    }
  }

  // ⑦ vision 的真调用形状（cognition/llm_router.describe_image）。

  // 回路）。所以装配面这一位有三态，而这里按态分叉：
  //   - `disabled`     → 决定不开：**零真模型调用**，describeImage 直接抛
  //                      VisionDisabledError（Conversation 的 vision_error 分支
  //                      接住 —— 她知道自己这次没看见，而不是收到凭空的描述）。
  //   - `unconfigured` → 装配面漏填：同样零调用、同样抛，但事件与措辞分开，
  //                      运维能区分「决定不开」与「忘了填」。
  //   - `wired`        → 走 visionRoute/visionModel 那一对（仍是同一个 lykoiLlm
  //                      入口 —— 闸与账长在调用路径里，绕开本层即绕开预算）。
  const visionState = visionSeamState(config.visionRoute, config.visionModel)
  logEvent(VISION_SEAM_EVENT, {
    state: visionState,
    // 零正文口径：只记这一位「是什么状态」，不把路由/模型名当内容记。
    route_set: config.visionRoute.trim() !== '',
    model_set: config.visionModel.trim() !== '',
  })
  // 守卫在**调用之前**（createVisionCompletion）：不是发出去再丢响应。
  const visionCompletion = createVisionCompletion({
    state: visionState,
    call: async (messages) => {
      const result = await ctx.lykoiLlm.call({
        provider: config.visionRoute,
        model: config.visionModel,
        messages: messages.map((m) => createUserMessage({
          content: m.content.map((part) => part.type === 'text'
            ? { type: 'text' as const, text: part.text ?? '' }
            // dsh 词汇里图片是一段带 url 的内容块；vendor 侧的 serialize 认它。
            : { type: 'text' as const, text: part.image_url?.url ?? '' }),
          source: { kind: 'user' },
        })),
      }, { runId: `vision-${Date.now()}` })
      return { content: result.text }
    },
  })

  conversation = new Conversation({
    runOwned: work => ctx.lykoiRuntime.run(work),
    store,
    persona,
    llm,
    logEvent,
    organs,

    // ≥ SELF_STATE_DEVIATION_MIN 时出块；now 由 Conversation 的时钟递入。
    selfState: (now) => selfStateBlock(store, now),
    restartEvent: () => latestRestartEvent(store),

    // False)` 的结构化子集 —— `_pending_contact_ts` 的读面），markReplied 同批。
    notifications: { getNotifications: () => getNotifications(false) as { ts?: string | null; origin?: string | null }[] },

    markReplied: (notificationId, historyId, now) => {
      kernelMarkReplied(notificationId, historyId, now)
    },
    // U1 ②：未送达账本的读面接真（生产侧 = 出站器官的 recordUndelivered 单写者）。
    undelivered: {
      unsurfaced: (limit) => unsurfacedUndelivered(null, limit),
      markSurfaced: (ids) => { markUndeliveredSurfaced(ids, { logEvent }) },
    },
    // chat_outbox.append 接真（进度出站队列 —— 消费者是设备层的投递线）。
    postProgress: (content) => { appendOutbox(content, 'followup', { logEvent }) },

    describeImage: createDescribeImage({ completion: visionCompletion }),

    markActive: () => { markInteractiveActive() },
    dispatchFn, // M3-W1 已接真 kernel（audit 落在 dispatch 层）
    // The action gate reads current Runtime registration on each dispatch.
    wiredActions: ctx.lykoiRuntime.actions,
    capabilityRevision: () => ctx.lykoiRuntime.revision,

    // 时 Schema 缺省 = D01_DEFAULTS.cycleTimeoutS（源码单一出处）。
    cycleTimeoutS: config.cycleTimeoutS,
    ...(config.narrativeFlag ? { narrativeFlagPath: resolve(config.narrativeFlag) } : {}),
  })

  setApprovalAuditSink(ctx.audit)

  //   判读跑在既有 MAIN 路由的配置上）。归因新增的是 **run 维度**——
  //   `approval-interpret-<action_type>`，于是 budget 账上"审批判读花了多少"可
  //   单独看见，而 route 会计一个桶都没多。T=0/400 由 kernel 侧钉死，这里原样
  //   转发（断言见 kernel test/approval-interpreter.test.ts）。

  //   （AbortSignal 形态 —— signal 递进 dsh-llm 的 `GenerateOptions.signal`，
  //   于是超时不只是"这边不等了"，是真把那一跳掐掉）+ 有界重试。失败方向由
  //   kernel 那侧钉死：`interpret` 的五失败路之一是「transport 抛 → unclear」，
  //   所以从这里抛出去永不 approve、永不挡路，只是"这次问不到"。
  setApprovalInterpretLlm(async (messages, opts) => {
    const systemParts: string[] = []
    let i = 0
    while (i < messages.length && messages[i]!.role === 'system') {
      systemParts.push(messages[i]!.content)
      i += 1
    }

    const actionType = opts.runId.startsWith(`${APPROVAL_RUN_PREFIX}-`)
      ? opts.runId.slice(APPROVAL_RUN_PREFIX.length + 1)
      : opts.runId
    const result = await runInterpretWithDeadline(actionType, {
      timeoutS: config.interpretTimeoutS,
      retries: config.interpretRetries,
      shouldRetry: isTransientInterpretFailure,
      logEvent,
    }, (signal) => ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: messages.slice(i).map((m) => createUserMessage({
        content: [{ type: 'text', text: m.content }],
        source: { kind: 'plugin', plugin: 'lykoi-converse' },
      })),
      maxTokens: opts.maxTokens, // = INTERPRET_MAX_TOKENS
      temperature: opts.temperature, // = INTERPRET_TEMPERATURE
      // 加派项⑥同批接通：判读输出是一份 schema，json 强制照样通到 wire。
      ...(opts.responseFormat === null || opts.responseFormat === undefined
        ? {}
        : { responseFormat: { type: 'json_object' as const } }),
      signal, // D-01：超时即 abort，那一跳真的断（连接与 tokens 都不再挂着）
    }, { runId: opts.runId }))
    return { content: result.text }
  })
  // ③两条腿共享**同一个** kernel dispatch —— 问句/追问/回执都以她自己的
  //   messenger.send 出去（E1 章在 kernel 的 _send 漏斗里盖）。
  const approval = createApprovalConversation({ dispatch: kernelDispatch })

  const suggestion = createSuggestionConversation({
    dispatch: kernelDispatch,
    store,
    stagedInstructions: (row, opts) => stagedInstructions(row, { answerText: opts.answerText }),
    completion: async (messages, opts) => {
      const result = await ctx.lykoiLlm.call({
        provider: config.route,
        model: config.model,
        system: messages[0]!.content, // 三消息切分：第一条恒为 system 规则
        messages: messages.slice(1).map((m) => createUserMessage({
          content: [{ type: 'text', text: m.content }],
          source: { kind: 'plugin', plugin: 'lykoi-converse' },
        })),
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        ...(opts.responseFormat === null ? {} : { responseFormat: { type: 'json_object' as const } }),
        // 归因走 run 维度（与审批判读同法：账上看得见，route 会计不膨胀）。
      }, { runId: 'rule-suggestion-answer' })
      return { content: result.text }
    },
  })

  ctx.provide('converse', { conversation, approval, suggestion })

  // 登记发生在 handleTurn.finally（回合终局之后）；扫描由 wake 的 cheap tick
  // （600 s）与登记后的 kick 驱动；启动时先把上个进程留下的 running 行收账。
  const continuations = new ContinuationRunner({
    runOwned: work => ctx.lykoiRuntime.run(work),
    store,
    conversation,
    audit: ctx.audit,
    messenger: () => ctx.get('messenger') as MessengerAdapterService | undefined,
    canDeliver: () => (ctx.get('messenger') as MessengerAdapterService | undefined)?.outboundWired() === true,
    deliver: async (content) => {
      const messenger = ctx.get('messenger') as MessengerAdapterService | undefined
      if (!messenger?.outboundWired()) return 'dispatch_failed'
      return messenger.deliverFollowup(content)
    },
    now: () => new Date(),
    onError: (where, err) => {
      ctx.logger.error('lykoi-converse: continuation %s failed: %s', where, String(err))
      logEvent('continuation/runner_failed', { where, error_name: err instanceof Error ? err.name : 'unknown' })
    },
  })
  ctx.provide('continuations', continuations)
  ctx.effect(() => {
    const now = new Date()
    ctx.lykoiRuntime.run(() => continuations.recoverOnStartup(now)
      .then(() => continuations.scan(new Date())))
      .catch((err) => {
        ctx.logger.error('lykoi-converse: continuation startup failed: %s', String(err))
        logEvent('continuation/runner_failed', { where: 'startup', error_name: err instanceof Error ? err.name : 'unknown' })
      })
    return () => {}
  }, 'lykoi-converse continuation startup')

  // transport` 的同一手法在启动时打通）。telegram 默认 disabled 时这段整段不跑，
  // 本插件照常挂载、安静待命。
  ctx.inject(['messenger'], (scope) => {
    const messenger = scope.get('messenger') as MessengerAdapterService
    scope.effect(() => {
      const unwire = messenger.wireOutbound(new OutboundOrgan({
        dispatch: kernelDispatch,
        ownerChannelKey: () => store.ownerBinding()?.channel_key ?? null,
        approval,
        suggestion,
        logEvent,
      }))
      continuations.kick()
      return unwire
    }, 'converse outbound binding')
  })

  ctx.ingress.registerInterruptor?.({
    canInterrupt: runId => conversation.canInterrupt(runId),
    interrupt: runId => conversation.interrupt(runId),
  })
  ctx.ingress.registerExecutor(async (turn, { runId }) =>
    await handleTurn(ctx, conversation, turn, runId, continuations))
}

type TurnResolution =
  | { kind: 'failure'; reason: TurnFailReason }
  | {
    kind: 'empty'
    cycleOutcome: CycleOutcome | null
    askSent: boolean
  }
  | { kind: 'delivery'; outcome: 'delivered' | 'undelivered' | 'needs_approval' | 'dispatch_failed' }
  | { kind: 'no_transport' }

function resolveTurnOutcome(input: TurnResolution): Pick<TurnOutcome, 'status' | 'reason'> {
  if (input.kind === 'failure') return { status: 'failed', reason: input.reason }
  if (input.kind === 'no_transport') return { status: 'failed', reason: 'no_transport' }
  if (input.kind === 'delivery') {
    if (input.outcome === 'delivered') return { status: 'completed', reason: null }
    if (input.outcome === 'needs_approval') {
      return { status: 'deferred', reason: 'approval_pending' }
    }
    return { status: 'failed', reason: 'delivery_failed' }
  }
  const failure = cycleFailure(input.cycleOutcome)
  if (failure) return { status: 'failed', reason: failure }
  if (input.askSent || input.cycleOutcome?.kind === 'ask_pending') {
    return { status: 'deferred', reason: 'approval_pending' }
  }
  return { status: 'intentional_silence', reason: null }
}

const NOTICE_REASONS = new Set<TurnFailReason>([
'outbound_unavailable', 'envelope_failed', 'missing_tool', 'tool_budget_exhausted', 'llm_failed',
'deadline_exceeded', 'context_budget', 'budget_exceeded', 'unknown',
])

const CONTINUATION_ELIGIBLE_STATUSES: ReadonlySet<TurnStatus>
  = new Set<TurnStatus>(['completed', 'intentional_silence', 'deferred'])

/** 保留每条原文，时间戳是投影元数据；不回写 parts 正本。 */
export function renderTurnParts(parts: UserTurn['parts'], replay = false): string {
  if (parts.length === 1 && !replay) return parts[0]!.text
  return parts.map(part =>`[${part.sourceTimestamp ?? part.receivedAt}]\n${part.text}`).join('\n')
}

export async function handleTurn(
  ctx: Context,
  conversation: Conversation,
  turn: UserTurn,
  runId: string,
  continuations?: ContinuationsService,
): Promise<TurnExecutionResult> {
  const started = performance.now()
  const turnId = turn.turnId
  const lastPart = turn.parts.at(-1)
  if (lastPart === undefined) throw new Error(`lykoi-converse: UserTurn ${turnId} has no parts`)
  const updateId = lastPart.platformUpdateId ?? null
  const replyAnchor = lastPart.platformMessageId
  let terminal: Pick<TurnOutcome, 'status' | 'reason'> | null = null
  let followupRegistered = false
  let followupGoal: string | null = null
  let askSent = false
  let noticeSent = false
  let replyChars = 0
  let routeComplete = false
  const sendFailureNotice = async (reason: TurnFailReason): Promise<void> => {
    if (!NOTICE_REASONS.has(reason)) return
    const messenger = ctx.get('messenger') as MessengerAdapterService | undefined
    if (messenger === undefined) return
    try {
      const sent = await messenger.send(
        turn.contextId,
        SYSTEM_FAILURE_NOTICE(reason),
        replyAnchor,
        // 系统回执仍须落未送达账本与 telegram 审计，但不应作为她的经历回灌记忆。
        { recordUndeliveredExperience: false },
      )
      noticeSent = sent.sent === true
    } catch (noticeError) {
      await ctx.audit.record({
        type: 'turn/notice_failed',
        turn_id: turnId,
        reason,
        error_name: noticeError instanceof Error ? noticeError.name : 'unknown',
      })
    }
  }

  await ctx.audit.record({
    type: 'converse/received',
    turn_id: turnId,
    inbound_id: turn.parts[0]!.inboundId,
    inbound_ids: turn.parts.map((part) => part.inboundId),
    platform_message_ids: turn.parts.map((part) => part.platformMessageId),
    updateId,
    contextId: turn.contextId,
    userId: turn.userId,
    isOwner: turn.isOwner,
    part_count: turn.parts.length,
    chars: turn.parts.reduce((total, part) => total + [...part.text].length, 0),
  })

  try {
    const messenger = ctx.get('messenger') as MessengerAdapterService | undefined
    if (messenger && !messenger.outboundWired()) throw new OutboundUnavailableError()

    // 不进入 cognition。parts[] 本身不改写，terminal 仍能反查整轮所有外界输入。
    const conversationalParts = [] as UserTurn['parts']
    let consumedReason: 'approval_answer' | 'suggestion_answer' | null = null
    for (const part of turn.parts) {
      const consumed = turn.isOwner && messenger !== undefined
        ? await messenger.routeOwnerMessage({
            text: part.text,
            contextId: part.contextId,
            replyTo: part.replyToPlatformMessageId ?? null,
            messageId: part.platformMessageId,
          })
        : null
      if (consumed === null) {
        conversationalParts.push(part)
      } else {
        consumedReason = consumed
        await ctx.audit.record({
          type: 'turn/part_consumed',
          turn_id: turnId,
          inbound_id: part.inboundId,
          platform_message_id: part.platformMessageId,
          reason: consumed,
        })
      }
    }
    routeComplete = true

    if (conversationalParts.length === 0) {
      terminal = { status: 'completed', reason: consumedReason }
    } else {
      // 唯一 render 边界：不改各 part 原文，以换行确定性拼接给既有单字符串模型面。
      const rendered = renderTurnParts(conversationalParts, turn.commitReason === 'restart_replay')
      let captured: CycleResult | undefined
      const reply = await conversation.send(rendered, { runId, turnId, onCycleResult: result => {
        captured = result
        if (messenger?.outboundWired()) conversation.takeDelegatedAsk()
        if (continuations !== undefined) conversation.takeFollowupRequest()
      } })
      // Compatibility for external test doubles/older Conversation implementations.
      const result: CycleResult = captured ?? {
        outcome: conversation.lastCycleOutcome(), followup: conversation.takeFollowupRequest(),
        delegatedAsk: conversation.peekDelegatedAsk(), utterances: reply ? [reply] : [],
      }
      const utterances = result.utterances
      followupGoal = result.followup
      followupRegistered = followupGoal !== null

    const deviceSideWired = messenger !== undefined && messenger.outboundWired()
    const delegatedAsk = result.delegatedAsk
    if (delegatedAsk !== null) {
      await ctx.audit.record({
        type: 'converse/approval_request_pending',
        turn_id: turnId,
        runId,
        updateId,
        action_type: delegatedAsk.action_type,
        action_id: delegatedAsk.action_id,
        correlation_id: delegatedAsk.correlation_id,
        device_side_wired: deviceSideWired,
      })
    }

    const askAbout = async (): Promise<void> => {
      if (delegatedAsk === null || !deviceSideWired) return
      const asked = await messenger!.askAbout(
        delegatedAsk, turn.contextId, replyAnchor,
        { run_id: runId, turn_id: turnId },
      )
      askSent = asked.asked && asked.status === 'asked'
    }

    const parts = utterances ?? (reply.trim() ? [reply] : [])
    replyChars = parts.reduce((sum, part) => sum + part.length, 0)
    if (parts.length === 0) {
      if (delegatedAsk !== null && messenger === undefined) {
        await ctx.audit.record({
          type: 'converse/no_transport', turn_id: turnId, runId, updateId,
        })
        terminal = resolveTurnOutcome({ kind: 'no_transport' })
      } else {
        await askAbout()
        terminal = resolveTurnOutcome({
          kind: 'empty',
          cycleOutcome: result.outcome,
          askSent,
        })
      }
    } else {
      await ctx.audit.record({
        type: 'converse/reply', turn_id: turnId, runId,
        updateId, chars: replyChars, utterances: parts.length,
      })
      if (messenger === undefined) {
        await ctx.audit.record({
          type: 'converse/no_transport', turn_id: turnId, runId, updateId,
        })
        terminal = resolveTurnOutcome({ kind: 'no_transport' })
      } else {
        const pending = pendingCount()
        if (pending > 0) {

          try { await messenger.send(turn.contextId, `[系统] 有 ${pending} 条待批准操作。`, replyAnchor, { recordUndeliveredExperience: false }) }
          catch { /* 系统提示失败不遮蔽她已经生成的答复。 */ }
        }
        const delivered = await sequenceUtterances(parts, async text => {
          if (deviceSideWired) return (await messenger.sendReply(
            turn.contextId, text, replyAnchor, { run_id: runId, turn_id: turnId },
          )).outcome
          return 'dispatch_failed'
        })
        terminal = deviceSideWired
          ? resolveTurnOutcome({ kind: 'delivery', outcome: delivered.outcome })
          : resolveTurnOutcome({ kind: 'failure', reason: 'outbound_unavailable' })
        await ctx.audit.record({
          type: 'converse/utterances_delivery', turn_id: turnId, run_id: runId,
          total: delivered.total, delivered: delivered.delivered, outcome: delivered.outcome,
        })
        try {
          await askAbout()
        } catch (askError) {
          // 答复已经交付，后续审批问句失败不能倒写本轮为失败，也不能再补一条
          // 系统失败回执；只落无正文的类别账，终局仍由已交付答复决定。
          await ctx.audit.record({
            type: 'converse/approval_request_failed',
            turn_id: turnId,
            run_id: runId,
            update_id: updateId,
            error_name: askError instanceof Error ? askError.name : 'unknown',
          })
        }
      }
    }
    }
    if (terminal?.status === 'failed' && terminal.reason !== null) {
      await sendFailureNotice(terminal.reason as TurnFailReason)
    }
  } catch (err) {
    if (err instanceof RunAbortedError) throw err // ingress 保留原 turn，另落 run_aborted
    const reason = failureReason(err)
    if (err instanceof ContextBudgetError) {
      await ctx.audit.record({
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId,
        error: 'ContextBudgetError', kind: 'context_budget',
      })
    } else if (err instanceof LlmFinishError) {
      await ctx.audit.record({
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId,
        error: err.name,
        kind: 'llm_finish',
        finish_code: err.reason.failure.code,
        finish_status: err.reason.failure.status ?? null,
        route: err.route,
        text_len: err.textLength,
        reasoning_len: err.reasoningLength,
      })
    } else {
      await ctx.audit.record({
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId,
        error: err instanceof Error ? err.name : 'unknown',
      })
    }
    terminal = resolveTurnOutcome({ kind: 'failure', reason })
    if (!routeComplete) {
      await ctx.audit.record({
        type: 'turn/route_failed',
        turn_id: turnId,
        error_name: err instanceof Error ? err.name : 'unknown',
      })
    }
    await sendFailureNotice(reason)
  }
  const outcome = terminal ?? resolveTurnOutcome({ kind: 'failure', reason: 'unknown' })

  // runner 自己落账并返回 null，终局照常。唯一 terminal 由 ingress 持久化后落审计。
  let continuationId: string | null = null
  if (continuations !== undefined && CONTINUATION_ELIGIBLE_STATUSES.has(outcome.status)) {
    const goal = followupGoal
    if (goal !== null) {
      continuationId = continuations.register({ originTurnId: turnId, originRunId: runId, goal })
    }
  }
  if (continuationId !== null) continuations!.kick()
  return {
    terminal: {
      status: outcome.status,
      reason: outcome.reason,
      followup_registered: followupRegistered,
      ask_sent: askSent,
      notice_sent: noticeSent,
      reply_chars: replyChars,
      elapsed_ms: Math.max(0, Math.round(performance.now() - started)),
      continuation_id: continuationId,
    },
  }
}
