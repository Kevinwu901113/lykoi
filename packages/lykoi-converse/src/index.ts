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
  createAssistantMessage, createMessage,
  createUserMessage, ReasoningEffortId, type Message,
} from '@deepseek-ai/dsh-llm'
import { LlmFinishError } from 'lykoi-llm'
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
  wiredActionCatalog, getNotifications, markReplied as kernelMarkReplied,
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
  ContextBudgetError, Conversation, composeSurfaceReply, selfStateBlock,
  type ConverseDispatchFn, type ConverseLlmFn, type ConverseLlmResult,
} from './conversation.ts'
import {
  VISION_SEAM_EVENT, createDescribeImage, createVisionCompletion, visionSeamState,
} from './vision.ts'
import { ContinuationRunner, type ContinuationsService } from './continuation.ts'
import { failureReason } from './failure.ts'
import { ENVELOPE_RETRY_MAX, type ConverseMessage } from './contract.ts'
import { D01_DEFAULTS, runInterpretWithDeadline } from './deadline.ts'
import { stripMarkup } from './hygiene.ts'
import {
  SYSTEM_FAILURE_NOTICE, type TurnFailReason, type TurnOutcome, type TurnStatus,
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
    /** WO-CONTINUATION-01：跟进消费者（wake 的 cheap tick 经它扫描）。 */
    continuations: ContinuationsService
  }
}

// --- LLM seam → lykoiLlm（gate 前置 / charge 后置的结构保证在那一层） ---
// WO-FIX-TOOLFRAME-01 D-1：assistant/tool_calls 帧与 tool 结果帧不再映成
// dsh 词汇的原生形态（ToolCallBlock / tool-result 帧）——那是 M3-W2 收口
// （M2 遗留 #13）当时的落点，理由本身没错（折文本把"她决定动手"从结构降
// 级成散文，回填对不上号），但探针 v3/v4（2026-09-03 19:30-19:42）实测：
// 历史里一旦出现这种原生工具帧，DeepSeek adapter 三病同源地退化——
// json_object 遇到就吐 65 个空格（v3）、reasoning_content 回传时对着这段
// 历史 400（J）、无 json 时把 DSML 原生工具调用标记直接泄漏进 content
// （19:19 沉默）。J/K/L 三次分头止血都是在下游猜代偿，这一单换根：把工具
// 步渲染回契约信封本就要求的**文本**形状——assistant 一条文本帧（信封
// JSON.stringify）、工具结果一条 user 文本帧（`[工具结果 <name>] …`）。
// 不声明 tools（本来也没声明）。v4 验证：思考×json 四组合各两次，八次全部
// 合法信封。`#messages` 内部形状（S-29 裁剪配对、回执探针、CallId 成对）
// 一字不动（D-2）——只是发给 dsh-llm 那一跳换了渲染，回填结果如何解析成
// 提示词块与 dsh-llm 完全无关。
//
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
      // （hygiene.ts 头注 S-32 半面）。
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

  // WO-FIX-LOOP-01 D-1b：只调一次 outboundOrganResources()，同一实例既喂
  // dispatch 又喂器官清单的动作轴——两处不再各摸各的资源注册表。
  const resources = outboundOrganResources()
  const wiredCatalog = wiredActionCatalog(resources)
  const organs = new OrganInventoryCache({
    bindings: () => store.identityBindingInventory(),
    // D-1b 改口：清单只列**真接得通**的动作子集（`wiredActionCatalog`），不再
    // 是 `kernelActionCatalog` 的 18 项全表。
    catalog: wiredCatalog,
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
  // WO-MEM-SOURCE-01：这条经验记的是**她自己**那句话没送出去（transport 对她
  // 一次开口的回音），方向是 outbound → 第二轴推导为 executed，而不是"别人告诉
  // 我的"（user_reported）。渠道值仍由 transport 侧给（'conversation'，不新造）。
  setUndeliveredExperienceSink((source, content, opts) => recordExperience(
    store, source as 'conversation', content,
    { salience: opts.salience, conversationDirection: 'outbound', now: new Date() },
  ))
  // GK-8 的落笔面（开关**默认关** —— 未开启时这个 sink 一次都不会被调到）。
  setNotificationOutboxSink(outboxNotificationSink(logEvent))
  // GK-8 开关本身走装配面（cordis.yml），不走 env —— env 钉面要求旋钮一律未设，
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
      messages: toDshEnvelopeMessages(messages.slice(i), { route: config.route, model: config.model }),
      ...(opts.maxTokens === undefined ? {} : { maxTokens: opts.maxTokens }),
      ...(opts.temperature === undefined ? {} : { temperature: opts.temperature }),
      ...(opts.responseFormat === null || opts.responseFormat === undefined
        ? {}
        : { responseFormat: opts.responseFormat }),
      // D-01（M4-W1）：周期那条边的 signal 一路递到 wire —— 周期撞线时这一跳
      // **真的断**，而不只是上面不等了（连接与 tokens 都不再挂着）。
      ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      // WO-FIX-TOOLSTEP-01 D-1：工具步之后那一跳关思考 —— `GenerateOptions.
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
      // WO-FIX-NOTJSON-01 D-4：lykoiLlm.call 的 LlmCallResult 已带
      // reasoningLength（WO-FIX-TOOLSTEP-01 D-2b）——原样透传，供
      // u3_cycle_retried/u3_cycle_failed 记账。
      reasoningLength: result.reasoningLength,
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

  conversation = new Conversation({
    store,
    persona,
    llm,
    logEvent,
    organs,
    // WO-PULSE-01 D-1（断点 ①③）：调节场四变量进对话 prompt —— 只在偏离基线
    // ≥ SELF_STATE_DEVIATION_MIN 时出块；now 由 Conversation 的时钟递入。
    selfState: (now) => selfStateBlock(store, now),
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
    // WO-FIX-LOOP-01 D-1d 传参：`#buildAction` 拿它挡未接线动作——不给 → 行为
    // 逐字节不变。
    wiredActions: new Set(wiredCatalog.knownActions),
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

  // --- WO-CONTINUATION-01：promise_followup 的消费者 ---
  // 登记发生在 handleTurn.finally（回合终局之后）；扫描由 wake 的 cheap tick
  // （600 s）与登记后的 kick 驱动；启动时先把上个进程留下的 running 行收账。
  const continuations = new ContinuationRunner({
    store,
    conversation,
    audit: ctx.audit,
    telegram: () => ctx.get('telegram') as TelegramAdapterService | undefined,
    postProgress: (content) => { appendOutbox(content, 'followup', { logEvent }) },
    now: () => new Date(),
    onError: (where, err) => {
      ctx.logger.error('lykoi-converse: continuation %s failed: %s', where, String(err))
      logEvent('continuation/runner_failed', { where, error_name: err instanceof Error ? err.name : 'unknown' })
    },
  })
  ctx.provide('continuations', continuations)
  ctx.effect(() => {
    const now = new Date()
    continuations.recoverOnStartup(now)
      .then(() => continuations.scan(new Date()))
      .catch((err) => {
        ctx.logger.error('lykoi-converse: continuation startup failed: %s', String(err))
        logEvent('continuation/runner_failed', { where: 'startup', error_name: err instanceof Error ? err.name : 'unknown' })
      })
    return () => {}
  }, 'lykoi-converse continuation startup')

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
    await handleTurn(ctx, conversation, message, continuations)
  })
}

type TurnResolution =
  | { kind: 'failure'; reason: TurnFailReason }
  | {
    kind: 'empty'
    cycleKind: NonNullable<ReturnType<Conversation['lastCycleOutcome']>>['kind'] | null
    askSent: boolean
  }
  | { kind: 'delivery'; outcome: 'delivered' | 'undelivered' | 'needs_approval' | 'dispatch_failed' }
  | { kind: 'no_transport' }

function resolveTurnOutcome(input: TurnResolution): Pick<TurnOutcome, 'status' | 'reason'> {
  if (input.kind === 'failure') return { status: 'failed', reason: input.reason }
  if (input.kind === 'no_transport') return { status: 'failed', reason: 'no_transport' }
  if (input.kind === 'delivery') {
    if (input.outcome === 'delivered') return { status: 'replied', reason: null }
    if (input.outcome === 'needs_approval') {
      return { status: 'deferred', reason: 'approval_pending' }
    }
    return { status: 'failed', reason: 'delivery_failed' }
  }
  if (input.cycleKind === 'envelope_failed') {
    return { status: 'failed', reason: 'envelope_failed' }
  }
  if (input.cycleKind === 'missing_tool') {
    return { status: 'failed', reason: 'missing_tool' }
  }
  if (input.cycleKind === 'tool_budget') {
    return { status: 'failed', reason: 'tool_budget_exhausted' }
  }
  if (input.askSent || input.cycleKind === 'ask_pending') {
    return { status: 'deferred', reason: 'approval_pending' }
  }
  return { status: 'intentional_silence', reason: null }
}

const NOTICE_REASONS = new Set<TurnFailReason>([
  'envelope_failed', 'missing_tool', 'tool_budget_exhausted', 'llm_failed',
  'deadline_exceeded', 'context_budget', 'budget_exceeded', 'unknown',
])

/** WO-CONTINUATION-01 D-2：只有这三种终局的 followup 才登记（失败回合的承诺不算数）。 */
const CONTINUATION_ELIGIBLE_STATUSES: ReadonlySet<TurnStatus>
  = new Set<TurnStatus>(['replied', 'intentional_silence', 'deferred'])

export async function handleTurn(
  ctx: Context,
  conversation: Conversation,
  message: InboundMessage,
  continuations?: ContinuationsService,
): Promise<void> {
  const started = performance.now()
  const inboundId = `tg:${message.updateId}`
  const turnId = inboundId
  const runId = `converse-${message.updateId}-${message.messageId}`
  let terminal: Pick<TurnOutcome, 'status' | 'reason'> | null = null
  let followupRegistered = false
  let askSent = false
  let noticeSent = false
  let replyChars = 0
  const sendFailureNotice = async (reason: TurnFailReason): Promise<void> => {
    if (!NOTICE_REASONS.has(reason)) return
    const telegram = ctx.get('telegram') as TelegramAdapterService | undefined
    if (telegram === undefined) return
    try {
      const sent = await telegram.send(
        message.contextId,
        SYSTEM_FAILURE_NOTICE(reason),
        message.messageId,
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

  // 隐私口径（D-08）：audit 行只带字数与来源盖章，不带正文。
  await ctx.audit.record({
    type: 'converse/received',
    turn_id: turnId,
    inbound_id: inboundId,
    updateId: message.updateId,
    contextId: message.contextId,
    userId: message.userId,
    isOwner: message.isOwner,
    chars: message.text.length,
  })
  // S-08 顺序位：审批回答 → 规则建议回答 → 普通对话。前两级仅 owner，随 M3
  // 审批/建议器官在**此处、回合之前**按序消费；当前一律进入普通对话级。

  try {
    const reply = await conversation.send(message.text, { runId, turnId })
    followupRegistered = conversation.hasFollowupRequest()

    const telegram = ctx.get('telegram') as TelegramAdapterService | undefined
    const deviceSideWired = telegram !== undefined && telegram.outboundWired()
    const delegatedAsk = deviceSideWired
      ? conversation.takeDelegatedAsk()
      : conversation.peekDelegatedAsk()
    if (delegatedAsk !== null) {
      await ctx.audit.record({
        type: 'converse/approval_request_pending',
        turn_id: turnId,
        runId,
        updateId: message.updateId,
        action_type: delegatedAsk.action_type,
        action_id: delegatedAsk.action_id,
        correlation_id: delegatedAsk.correlation_id,
        device_side_wired: deviceSideWired,
      })
    }

    const askAbout = async (): Promise<void> => {
      if (delegatedAsk === null || !deviceSideWired) return
      const asked = await telegram!.askAbout(
        delegatedAsk, message.contextId, message.messageId,
        { run_id: runId, turn_id: turnId },
      )
      askSent = asked.asked && asked.status === 'asked'
    }

    const surfaceReply = composeSurfaceReply(reply, pendingCount(), false)
    replyChars = surfaceReply.length
    if (surfaceReply.trim().length === 0) {
      await ctx.audit.record({
        type: 'converse/silence', turn_id: turnId, runId, updateId: message.updateId,
      })
      if (delegatedAsk !== null && telegram === undefined) {
        await ctx.audit.record({
          type: 'converse/no_transport', turn_id: turnId, runId, updateId: message.updateId,
        })
        terminal = resolveTurnOutcome({ kind: 'no_transport' })
      } else {
        await askAbout()
        terminal = resolveTurnOutcome({
          kind: 'empty',
          cycleKind: conversation.lastCycleOutcome()?.kind ?? null,
          askSent,
        })
      }
    } else {
      await ctx.audit.record({
        type: 'converse/reply', turn_id: turnId, runId,
        updateId: message.updateId, chars: surfaceReply.length,
      })
      if (telegram === undefined) {
        await ctx.audit.record({
          type: 'converse/no_transport', turn_id: turnId, runId, updateId: message.updateId,
        })
        terminal = resolveTurnOutcome({ kind: 'no_transport' })
      } else {
        if (deviceSideWired) {
          const delivered = await telegram.sendReply(
            message.contextId, surfaceReply, message.messageId,
            { run_id: runId, turn_id: turnId },
          )
          terminal = resolveTurnOutcome({ kind: 'delivery', outcome: delivered.outcome })
        } else {
          const delivered = await telegram.send(message.contextId, surfaceReply, message.messageId)
          terminal = resolveTurnOutcome({
            kind: 'delivery',
            outcome: delivered.sent ? 'delivered' : 'undelivered',
          })
        }
        try {
          await askAbout()
        } catch (askError) {
          // 答复已经交付，后续审批问句失败不能倒写本轮为失败，也不能再补一条
          // 系统失败回执；只落无正文的类别账，终局仍由已交付答复决定。
          await ctx.audit.record({
            type: 'converse/approval_request_failed',
            turn_id: turnId,
            run_id: runId,
            update_id: message.updateId,
            error_name: askError instanceof Error ? askError.name : 'unknown',
          })
        }
      }
    }
    if (terminal?.status === 'failed' && terminal.reason !== null) {
      await sendFailureNotice(terminal.reason as TurnFailReason)
    }
  } catch (err) {
    const reason = failureReason(err)
    if (err instanceof ContextBudgetError) {
      await ctx.audit.record({
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId: message.updateId,
        error: 'ContextBudgetError', kind: 'context_budget',
      })
    } else if (err instanceof LlmFinishError) {
      await ctx.audit.record({
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId: message.updateId,
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
        type: 'converse/turn_failed', turn_id: turnId, runId, updateId: message.updateId,
        error: err instanceof Error ? err.name : 'unknown',
      })
    }
    terminal = resolveTurnOutcome({ kind: 'failure', reason })
    await sendFailureNotice(reason)
  } finally {
    const outcome = terminal ?? resolveTurnOutcome({ kind: 'failure', reason: 'unknown' })
    // WO-CONTINUATION-01 D-2：终局落定后才登记（取走即清，S-60）；登记失败由
    // runner 自己落账并返回 null，终局照常。
    let continuationId: string | null = null
    if (continuations !== undefined && CONTINUATION_ELIGIBLE_STATUSES.has(outcome.status)) {
      const goal = conversation.takeFollowupRequest()
      if (goal !== null) {
        continuationId = continuations.register({ originTurnId: turnId, originRunId: runId, goal })
      }
    }
    await ctx.audit.record({
      type: 'turn/terminal',
      turn_id: turnId,
      inbound_id: inboundId,
      run_id: runId,
      update_id: message.updateId,
      message_id: message.messageId,
      context_id: message.contextId,
      user_id: message.userId,
      is_owner: message.isOwner,
      status: outcome.status,
      reason: outcome.reason,
      followup_registered: followupRegistered,
      ask_sent: askSent,
      notice_sent: noticeSent,
      reply_chars: replyChars,
      elapsed_ms: Math.max(0, Math.round(performance.now() - started)),
      continuation_id: continuationId,
    })
    if (continuationId !== null) continuations!.kick()
  }
}
