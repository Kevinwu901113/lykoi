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
  OutboundOrgan, markUndeliveredSurfaced, outboundOrganResources,
  outboxNotificationSink, setMessengerLogEvent, setTransportLogEvent,
  setUndeliveredExperienceSink, unsurfacedUndelivered, appendOutbox,
} from 'lykoi-adapter-telegram'
import {
  getPersona, seedPersona, OrganInventoryCache, type LogEvent,
} from 'lykoi-decide'
import { stagedInstructions } from 'lykoi-learn'
import {
  createApprovalConversation, createDispatch, createSuggestionConversation,
  kernelActionCatalog, getNotifications, markReplied as kernelMarkReplied,
  markActive as markInteractiveActive, pendingCount,
  APPROVAL_RUN_PREFIX,
  INTERPRET_MAX_TOKENS, INTERPRET_TEMPERATURE, setApprovalAuditSink,
  setApprovalInterpretLlm, setIdentityBindingLookup, setKernelLogEvent,
  setNotificationOutboxDelivery,
  setNotificationOutboxSink,
  type ApprovalConversation, type SuggestionConversation,
} from 'lykoi-kernel'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { recordExperience } from 'lykoi-reflow'
import { collectRestartClues, latestRestartEvent, recordDeployEvent, recordRestartEvent } from 'lykoi-snapshot'
import {
  ContextBudgetError, Conversation, composeSurfaceReply,
  type ConverseDispatchFn, type ConverseLlmFn, type ConverseLlmResult,
} from './conversation.ts'
import {
  VISION_SEAM_EVENT, createDescribeImage, createVisionCompletion, visionSeamState,
} from './vision.ts'
import { ENVELOPE_RETRY_MAX, type ConverseMessage } from './contract.ts'
import { D01_DEFAULTS, runInterpretWithDeadline } from './deadline.ts'

export * from './contract.ts'
export * from './conversation.ts'
export * from './deadline.ts'
export * from './exemption.ts'
export * from './hygiene.ts'
export * from './prompts.ts'
export * from './vision.ts'

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
  /**
   * restart 线索采集的仓库根（`git rev-parse HEAD` 的 cwd）。M3-W4 生产采集器
   * （M2 遗留 #8）。空串 = 不采 HEAD（dev 缺省：采集失败与不采同一后果 = 省略）。
   */
  restartRepoRoot: string
  /**
   * restart 线索采集的 systemd 单元名（downtime 问它上次什么时候停的）。
   * 空串 = 不采 downtime（dev 缺省）。
   */
  restartUnit: string
  /**
   * **GK-8 决断项旋钮**（DK-12）：把 `kind=notification` 并进 chat_outbox 的
   * 投递线，让通知真的到达 Kevin 手上。
   *
   * 蓝图 GK-8 明定：做成开关、**默认关**、开启 = Kevin 决断项。开着会**改变
   * 到达行为**（从 pull 变 push），构建侧不自作主张。旋钮在这里露出来，是为了
   * 「开没开」成为一条**装配面上看得见、被完整性门 hash 钉住**的部署事实，
   * 而不是藏在某个进程里的运行期状态。
   */
  notificationOutboxDelivery: boolean
  /**
   * **D-01 三旋钮**（M4 前置 #6；Kevin 2026-08-31 授权采用治理建议值）。
   *
   * 语义不是工程参数是治理决定：「一次审批问句等多久才算问不到」「一个对话
   * 周期挂多久才算挂死」。缺省值 = `D01_DEFAULTS`（`deadline.ts`，源码单一
   * 出处）—— 装配面把这三行删掉不会换一套语义，只是回到同样的三个数。
   */
  /** 判读调用（approval 解释器，T=0/400 tokens 那条）单次超时秒数。 */
  interpretTimeoutS: number
  /** 判读调用有界重试次数（1 = 至多两次尝试，最坏 timeout×2）。 */
  interpretRetries: number
  /** 一个对话周期（信封 + 工具派发全程）的整体超时秒数。 */
  cycleTimeoutS: number
  /**
   * **vision 路由位**（M4 定案：显式 `disabled`）。deepseek-chat 无视觉面，
   * M4 不接真模型。`'disabled'` = 决定不开；空串 = **没填**（两者必须分得开，
   * 见 `visionSeamState`）—— 两种都零真模型调用，但事件流上是两回事。
   */
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
  // D-01 三旋钮：缺省 = 源码单一出处（deadline.ts），与 prod profile 同数。
  interpretTimeoutS: Schema.number().default(D01_DEFAULTS.interpretTimeoutS),
  interpretRetries: Schema.number().default(D01_DEFAULTS.interpretRetries),
  cycleTimeoutS: Schema.number().default(D01_DEFAULTS.cycleTimeoutS),
  // vision 路由位：缺省**空串 = 没填**（不是 disabled —— 两者必须分得开）。
  visionRoute: Schema.string().default(''),
  visionModel: Schema.string().default(''),
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
 * 秒数不在这里：它们是 D-01 的三旋钮（`deadline.ts` 的 `D01_DEFAULTS` = 源码
 * 单一出处，装配面 `converse.config.*` 可覆盖）。M4-W1 起三个数都已填实并在
 * 调用路径上被强制：判读 30s×(1+1 次重试)、周期 180s。设备侧配置面
 * （lykoi-adapter-telegram 的 pollTimeoutS 等）在接线时对着这个乘数核。
 */
export const TURN_LLM_CALLS_MAX = ENVELOPE_RETRY_MAX + 1
/** 一次审批答复回合的判读调用上限（快通道为 0）。 */
export const APPROVAL_INTERPRET_CALLS_MAX = 1

/** 服务面：console/测试可直达回合入口。 */
export interface ConverseService {
  conversation: Conversation
  /**
   * 审批器官（M3-W2 接线，W3 起**设备侧已承重**）：那一层有当轮入站 message_id
   * （E2 分层），由它拿 `takeDelegatedAsk()` 的四项载荷调
   * `requestApproval(..., replyTo=入站 id)`，并把 owner 的来话按 S-08 三级路由的
   * 第一级交给 `handleOwnerAnswer`。
   */
  approval: ApprovalConversation
  /** 建议问答机（M3-W3；S-08 三级路由的第二级 + wake 侧的 `maybeAskOwner`）。 */
  suggestion: SuggestionConversation
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

  // D-CP-1（WO-CACHE-PERSONA）：走进程级缓存面（SA-156 每进程恰一份内核），
  // 不再直调 loadPersona —— 同进程只读+解析一次；且本插件与 wake 的
  // personaToml 一旦分叉，getPersona 的 path 守卫会启动即炸（而非静默错人格）。
  const persona = getPersona(resolve(config.personaToml))

  // --- 出生序（文件头注释） ---
  seedPersona(store, { now: new Date() })
  // M3-W4 接线（M2 遗留 #8）：restart 线索的**生产采集器**。
  // SA-164 纪律不变 —— 采集器每一样各自 try/catch，读不到就是 null，
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
    markerPath: resolve(config.restartMarker),
    now: restartNow,
    clues,
    logEvent,
  })
  // `record_deploy_event(unit=…)` 的新体对应物：运维事实进审计，不进她的 history。
  recordDeployEvent({
    repoRoot: config.restartRepoRoot || process.cwd(),
    unit: config.restartUnit || undefined,
    now: restartNow,
    clues,
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
  // closed 在 kernel 内）。
  // M3-W3 换装：资源注册表 = **出站器官真身**（messenger 2 + notify.owner +
  // autonomy 2），其余 13 个动作仍是 W1 显式替身（感知/执行器官归 M5）。
  setMessengerLogEvent(logEvent)
  setTransportLogEvent(logEvent)
  // U1 ①：未送达 → 她的经验，走 reflow 的**单写者入口**（不直接碰 store）。
  setUndeliveredExperienceSink((source, content, opts) => recordExperience(
    store, source as 'conversation', content, { salience: opts.salience, now: new Date() },
  ))
  // GK-8 的落笔面（开关**默认关** —— 未开启时这个 sink 一次都不会被调到）。
  setNotificationOutboxSink(outboxNotificationSink(logEvent))
  // GK-8 开关本身走装配面（cordis.yml），不走 env —— env 钉面要求旋钮一律未设，
  // 而这一条必须**看得见且被 manifest 钉住**：它改的是通知怎么到达 Kevin。
  setNotificationOutboxDelivery(config.notificationOutboxDelivery)
  const kernelDispatch = createDispatch({ sink: ctx.audit, resources: outboundOrganResources() })
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
    // S-52 **通到 wire**（M3-W3 加派项，治理复核 WO-M3-W2 §治理发现）。
    // W2 的实况仍然成立：dsh-llm 0.1.1-rc.2 的 `GenerateOptions` 恰 12 字段、
    // 没有 response_format。但 CF-B6 vendor 的 DeepSeek adapter **自己拼 HTTP
    // payload**（`requestWithMessages`），所以这一位由我们自家译码
    // （vendor 改动点 7/7）＋ lykoi-llm 注册层透传（`LykoiGenerateOptions`）。
    // 钮 = `envelopeJsonMode()`（默认开，读在调用点），钮关时**这个键根本不
    // 出现在 wire body 上** —— 不是 null，不是空对象。理由：活体把 json 模式
    // 列为 U3 缺陷①的**止血主力**，新体现有防线只剩 D-01 有界重试 + 契约强化。
    const result = await ctx.lykoiLlm.call({
      provider: config.route,
      model: config.model,
      ...(systemParts.length > 0 ? { system: systemParts.join('\n\n') } : {}),
      messages: messages.slice(i).map(toDshMessage),
      ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.responseFormat === null || opts.responseFormat === undefined
        ? {}
        : { responseFormat: opts.responseFormat }),
      // D-01（M4-W1）：周期那条边的 signal 一路递到 wire —— 周期撞线时这一跳
      // **真的断**，而不只是上面不等了（连接与 tokens 都不再挂着）。
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
    }, { runId: opts.runId })
    return {
      content: result.text,
      finishReason: result.finish?.kind ?? null,
      promptTokens: result.usage?.inputTokens ?? null,
      completionTokens: result.usage?.outputTokens ?? null,
      extraKeys: [], // dsh-llm 面拿不到原始响应键集（reasoning_content 探测归 M3 adapter）
    }
  }

  // ⑦ vision 的真调用形状（cognition/llm_router.describe_image）。
  //
  // **M4 定案：vision 位显式 disabled**（deepseek-chat 无视觉面，切换窗不开新
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

  const conversation = new Conversation({
    store,
    persona,
    llm,
    logEvent,
    organs,
    restartEvent: () => latestRestartEvent(store),
    // M3-W3 ③ contact 链接通：真 kernel 通知队列（`get_notifications(unread_only=
    // False)` 的结构化子集 —— `_pending_contact_ts` 的读面），markReplied 同批。
    notifications: { getNotifications: () => getNotifications(false) as { ts?: string | null; origin?: string | null }[] },
    // SK-58：首写获胜幂等；已滚出有界队列的 id 静默 no-op。**唯一写入点**在
    // conversationTurnReflow 的 contact_answered 那一支（reflow 侧已就位）。
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
    // ⑦ vision seam 接真形状（真模型那一跳仍是注入的 completion；本波零真网 →
    // 生产路由随 M4 的 cordis.yml，测试注 fake）。
    describeImage: createDescribeImage({ completion: visionCompletion }),
    // ⑤ interactive_lock：S-17 的两次 markActive 接真锁（wake 侧读同一个）。
    markActive: () => { markInteractiveActive() },
    dispatchFn, // M3-W1 已接真 kernel（audit 落在 dispatch 层）
    // D-01 第三旋钮：一个周期（信封调用 + 工具派发全程）的整体上限。装配面不给
    // 时 Schema 缺省 = D01_DEFAULTS.cycleTimeoutS（源码单一出处）。
    cycleTimeoutS: config.cycleTimeoutS,
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
  //   **D-01 第一、二旋钮就装在这个 wrapper 上**（M4-W1）：单次判读调用超时
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
    // runId = `approval-interpret-<action_type>`（kernel 侧拼；SK-36 的 run 维度）。
    // 事件里的 action_type 从它还原 —— 不新增 seam 参数。
    const actionType = opts.runId.startsWith(`${APPROVAL_RUN_PREFIX}-`)
      ? opts.runId.slice(APPROVAL_RUN_PREFIX.length + 1)
      : opts.runId
    const result = await runInterpretWithDeadline(actionType, {
      timeoutS: config.interpretTimeoutS,
      retries: config.interpretRetries,
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

  // --- M3-W3 接线：建议问答机（SK-49..55；GK-3/GK-10） ---
  // 铁律的第①层在**结构**上成立：kernel/suggestion-conversation.ts 一行
  // approval 写面 import 都没有（import 面静态测试钉死）。这里只递它三样东西：
  // 同一个 dispatch（问句/答复/撤回都以她自己的 messenger.send 出去，E1 章在
  // `_send` 漏斗里盖）、队列面（rule_suggestions 单写者是 rw）、以及
  // `stagedInstructions`（住在 lykoi-learn —— kernel 是 CF-B1 非插件库模块，
  // 反向 import 一次都不许，所以注入）。
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

  // --- M3-W3 接线：出站器官装进设备层（SK-77/78/79/82；D-07） ---
  // **晚绑定**：设备层与认知层互为对方的下游（活体用 `messenger._TRANSPORT =
  // transport` 的同一手法在启动时打通）。telegram 默认 disabled 时这段整段不跑，
  // 本插件照常挂载、安静待命。
  const telegramAtBoot = ctx.get('telegram') as TelegramAdapterService | undefined
  if (telegramAtBoot !== undefined) {
    telegramAtBoot.wireOutbound(new OutboundOrgan({
      dispatch: kernelDispatch,
      // 出站投递的 chat id 只认 P2-01 登记的 owner 绑定（只读；绝不在这里写）。
      ownerChannelKey: () => store.ownerChannelKey('telegram'),
      approval,
      suggestion,
      logEvent,
    }))
  }

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

  const telegram = ctx.get('telegram') as TelegramAdapterService | undefined
  const deviceSideWired = telegram !== undefined && telegram.outboundWired()

  // S-59/SK-77 顺序位：本轮撞门的动作已被认知侧做成四项载荷挂在 conversation 上
  // （一轮一份、取走即清；下一轮 send 开头会清场，所以它绝不会跨轮悬着）。
  // **取走并去问是设备层的活**（W3 已接）—— 只有那一层有当轮入站 message_id，
  // 而没有 reply_to 的问句按主动打扰计费、名额一耗尽当天余下的问句全部
  // undelivered → deny_by_default（8-19 六连拒的病灶）。设备层没接线时**不取走**
  // （取走 = 丢掉），只落一条零正文的账让缺口在事件流上看得见。
  const delegatedAsk = deviceSideWired
    ? conversation.takeDelegatedAsk()
    : conversation.peekDelegatedAsk()
  if (delegatedAsk !== null) {
    await ctx.audit.record({
      type: 'converse/approval_request_pending',
      runId,
      updateId: message.updateId,
      action_type: delegatedAsk.action_type, // D-08：只记类型，params 一个字不进事件流
      action_id: delegatedAsk.action_id,
      correlation_id: delegatedAsk.correlation_id,
      device_side_wired: deviceSideWired, // W3 接上之后这一栏翻成 true
    })
  }

  // D-04 装配点（W3 接权威源）：pending 的权威源 = kernel `pendingCount()`。
  // 横幅要不要出现是"对话面"的决定，与队列真身在不在无关；reply 为空时
  // **不加横幅** —— 沉默一路走到底，红测钉死。
  const surfaceReply = composeSurfaceReply(reply, pendingCount(), false)
  if (surfaceReply.trim().length === 0) {
    // 沉默是合法结局（有账没话）：u3_cycle_envelope/u3_cycle_failed 是它的账。
    await ctx.audit.record({ type: 'converse/silence', runId, updateId: message.updateId })
    // 沉默也可能有下文：那个还没被批准的动作仍然要问出去（SK-77 的"先说话后
    // 请示"里，"说话"是可以为空的 —— 空回复照旧是合法结局）。
    if (delegatedAsk !== null && deviceSideWired) {
      await telegram!.askAbout(delegatedAsk, message.contextId, message.messageId)
    }
    return
  }
  await ctx.audit.record({
    type: 'converse/reply', runId, updateId: message.updateId, chars: surfaceReply.length,
  })
  if (telegram === undefined) {
    await ctx.audit.record({ type: 'converse/no_transport', runId, updateId: message.updateId })
    return
  }
  // 顺序是自然的那个：**先说话，后请示**（SK-77）。
  // S-10 / SK-78：回复经 dispatch 出去，E2 章在设备层盖（reply_to=入站 message_id
  // —— 应答路径不计打扰预算）。设备层没接线时退回 M1 的裸传输面。
  if (deviceSideWired) {
    await telegram.sendReply(message.contextId, surfaceReply, message.messageId)
  } else {
    await telegram.send(message.contextId, surfaceReply, message.messageId)
  }
  // ……后请示：以**当轮入站 id** 为 reply_to 把撞门的那个动作问出去。
  if (delegatedAsk !== null && deviceSideWired) {
    await telegram.askAbout(delegatedAsk, message.contextId, message.messageId)
  }
}
