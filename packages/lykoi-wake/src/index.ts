/**
 * lykoi-wake — wake 编排插件（M2 波次 3 交付③；cognition/autonomous.py 的
 * AutonomySupervisor 对应物，按 G-2 心脏转正后的形态）。
 *
 * 六阶段顺序不可重排（SA-169；顺序本身是语义）：
 *
 *   heart.claim →（yielded / hourly_cap 仲裁）→ maintain(moment) → read(纯读推演)
 *   → buildMessages → lykoi-llm.call（route=autonomous_cognition，origin=
 *   autonomous_wake 经 budget runId 贯穿，SA-172）→ evaluateMessage →
 *   executeAndReflow → applyInner（在 execute **之后**，SA-31：畸形 inner 不可能
 *   影响决策，且 applyInner 永不抛——它的失败不能让拍失败）→ finishRun /
 *   记时钟 / bumpWakesSince → autonomy_wake 事件。
 *
 * G-2（DA-02 定案）：`decision.next_wake_after_minutes` → `clamp_rest` →
 * `set_autonomy_next_wake` 的决策链整体不存在——节律全归 lykoi-heart；
 * autonomy_state.next_wake_at 降格为**档案列**（存心脏对外可观测的下一拍，
 * 没有任何调度读者），last_wake_at 仍是 restart 叙事（SA-165）的读数。
 * clamp_rest / MIN·MAX_REST_MIN 的调度语义全部在 lykoi-heart。
 *
 * SA-170：一拍失败被完整接住——写 failed run（decision={"error":…}）+ 档案时钟
 * + bump_wakes_since + autonomy_wake_failed；SA-171：整合与专注在 wake 之后串行
 * 驱动、只在 status=='completed' 时、各自吞掉一切异常（W4 接真机器，本波接口位）。
 *
 * cheap tick 驱动（SA-67）：600s 限频（CheapTickDriver），失败只落
 * `cheap_tick_failed` 不致命。
 *
 * W1 TODO#9（rw 插件化形态）定案：rw 保持库形态（lykoi-memory/rw 的
 * ReadWriteMemory），**wake 编排插件是它在插件树里的持有者**——句柄经
 * ctx.effect 开合（fiber 卸载即关），不另立 rw 插件；lykoi-memory 插件入口
 * 保持只读（R-01 三重防写不动）。
 *
 * W2 TODO#4（logEvent 统一接 audit）：snapshot / decide / reflow 的事件注入位
 * 全部经 `auditLogEvent` 适配器收到 lykoi-audit（audit.record 的 JSONL 行，
 * type=事件名）。
 */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AuditService } from 'lykoi-audit'
import {
  applyInner, buildCandidates, buildMessages, buildPersonaPrompt, evaluateMessage,
  OrganInventoryCache, parsePersonaData, serializeDecision,
  type BuildMessagesDeps, type ChatMessage, type Decision, type LogEvent, type SnapshotLike,
} from 'lykoi-decide'
import { DEFAULT_BASELINE_MIN } from 'lykoi-heart'
import {
  createDispatch, isActive as chatIsActive, kernelActionCatalog,
  notificationsRemainingToday, pendingCount, proactiveRemainingToday,
  setIdentityBindingLookup, setKernelLogEvent,
} from 'lykoi-kernel'
import {
  outboundOrganResources, setMessengerLogEvent, setTransportLogEvent,
} from 'lykoi-adapter-telegram'
import { maybeRunFocusCycle, maybeRunIntegration } from 'lykoi-learn'
import type {} from 'lykoi-llm'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import {
  cheapTick, CHEAP_TICK_INTERVAL_S, emptyNotifications, executeAndReflow,
  type DispatchFn, type NotificationsView, type WakeCounts,
} from 'lykoi-reflow'
import {
  HOURLY_ACTION_CAP, maintain, read, unprocessedRestartEvent, type SnapshotDeps,
} from 'lykoi-snapshot'
import { systemClock, type Clock } from './clock.ts'

export * from './clock.ts'
export { HOURLY_ACTION_CAP }

// --- SA-172：route 与三条 origin 归因（llm_router.py:24,37-39 逐字） ------------
// route 回答"用了哪个模型"，origin 回答"是谁为了什么花的"——同一条
// autonomous_cognition 路由上挤着三个消费者（每拍决策、层1 整合、层2 专注），
// 光看 route 分不开它们的账；归因经 budget 的 runId 贯穿（一拍一个 run_id）。
export const AUTONOMOUS_COGNITION = 'autonomous_cognition'
export const ORIGIN_AUTONOMOUS_WAKE = 'autonomous_wake'
export const ORIGIN_AUTONOMOUS_INTEGRATE = 'autonomous_integrate'
export const ORIGIN_AUTONOMOUS_FOCUS = 'autonomous_focus'

// ============================== logEvent → audit（W2 TODO#4） ==============================

/**
 * 事件注入位的统一适配：log_event(name, fields) → audit.record({type: name, …})。
 * 事件流是遥测不是控制流——写失败不打断拍（错误交 onError 呈现）。
 *
 * **M3-W4（W2 TODO#6 定案）：显式分流盖章。** 遥测行与特权层 immutable 治理行
 * 落在同一个 audit.jsonl，且至少 `delegation_context_invalid` 一个名字两边都发、
 * 字段集不同。判别规则定案为：**带 `channel:'telemetry'` ⟺ 遥测行；不带 ⟺
 * 特权层治理行。** 定案理由（字段集会漂、失败方向、只动新体自造的那一半）写在
 * `lykoi-gate/src/vocabulary.ts` 顶注；完整性门检查项⑥b 的 V3 核这一枚盖章还在
 * 不在 —— 顺手删掉它，门当场红。
 *
 * 盖章位置在 `...fields` **之前**：`channel` 是保留字段，但发射点若真的传了同名
 * 字段，以发射点为准比在这里悄悄覆盖它更诚实（覆盖=门看得见的那一枚章还在，
 * 行里的却是另一个值）。词汇表纪律：发射点不许用 `channel` 这个字段名。
 */
export function auditLogEvent(audit: AuditService, onError?: (err: unknown) => void): LogEvent {
  return (name, fields) => {
    audit.record({ type: name, channel: 'telemetry', ...fields }).catch((err) => {
      onError?.(err)
    })
  }
}

// ============================== cheap tick 驱动（SA-67） ==============================

/** 600s 限频闸（autonomous.py:303,311-312 的 last_cheap_tick 对应；首转即到期）。 */
export class CheapTickDriver {
  #lastTick = 0
  due(now: Date): boolean {
    if ((now.getTime() - this.#lastTick) / 1000 < CHEAP_TICK_INTERVAL_S) return false
    this.#lastTick = now.getTime()
    return true
  }
}

// ============================== 一拍（六阶段） ==============================

/** 心脏消费面（HeartService 的结构化子集）：claim 合并 + 可观测下一拍。 */
export interface HeartClaim {
  claim(): { beats: number }
  readonly nextAt: string | null
}

/** LLM 调用注入位（生产 = lykoi-llm 经插件接线；测试 = fake）。 */
export type LlmFn = (
  messages: ChatMessage[],
  meta: { runId: string; route: string; origin: string },
) => Promise<{ content: string | null }>

export interface WakeDeps {
  store: ReadWriteMemory
  clock: Clock
  heart: HeartClaim
  llm: LlmFn
  dispatchFn: DispatchFn
  snapshotDeps: SnapshotDeps
  messageDeps: BuildMessagesDeps
  logEvent: LogEvent
  /** 仲裁接口位（interactive_lock 对应；M3/W5 接真锁；缺省不让位）。 */
  shouldYieldToChat?: () => boolean
  /**
   * SA-171：层 1 整合（W4 已接真——插件面接 lykoi-learn.maybeRunIntegration；
   * 只在 completed 后被驱动，异常被吞）。runId = 本拍的 run_id（SA-172：origin
   * 三归因挤在同一路由上，账靠 runId 贯穿）。
   */
  integrate?: (info: { runId: string }) => Promise<void>
  /** SA-171：层 2 专注（W4 已接真——lykoi-learn.maybeRunFocusCycle；独立于层 1 的成败）。 */
  focus?: (info: { runId: string }) => Promise<void>
  /** run_id 源（缺省 uuid4().hex 对应物；测试注定值）。 */
  runIdFn?: () => string
}

export interface WakeOutcome {
  status: 'idle' | 'yielded' | 'rested' | 'completed' | 'failed'
  beats: number
  reason?: string
  run_id?: string
  decision?: string
  demoted?: boolean
  error?: string
  next_wake_at?: string | null
}

function defaultRunId(): string {
  return randomUUID().replaceAll('-', '') // uuid4().hex 同形态
}

/**
 * 心脏下一拍的档案值：heart.nextAt 可解析则用之；缺席/不可解析回落
 * moment + 默认基线拍（与 heart 的 DEFAULT_BASELINE_MIN 同源——G-8(a) fail-closed
 * 到默认拍的同向兜底）。
 */
function heartNextDate(heart: HeartClaim, moment: Date): Date {
  if (heart.nextAt) {
    const at = new Date(heart.nextAt)
    if (!Number.isNaN(at.getTime())) return at
  }
  return new Date(moment.getTime() + DEFAULT_BASELINE_MIN * 60_000)
}

/**
 * 档案时钟行（G-2 后语义）：next_wake_at 存心脏的对外读数（无调度读者），
 * last_wake_at = 她这次醒来的时刻（restart 叙事 SA-165 与镜像工具的读数）。
 */
function recordWakeClock(deps: WakeDeps, moment: Date): void {
  deps.store.setAutonomyNextWake(heartNextDate(deps.heart, moment), { now: moment })
  deps.store.setAutonomyLastWake(moment, { now: moment })
}

/**
 * 一拍（SA-169 六阶段）。心跳事件/显式驱动都汇到这里；claim 合并消费 =
 * 错过 N 拍一次醒（{beats: N} 进返回值可观测）。
 */
export async function wakeOnce(deps: WakeDeps): Promise<WakeOutcome> {
  // 阶段 1：claim（把积压拍全部取走；0 拍 = 这一转无事）。
  const { beats } = deps.heart.claim()
  if (beats === 0) return { status: 'idle', beats }

  // 阶段 2：仲裁。yield 是零 LLM 零表写的廉价分支。
  // **DK-11 已定（M3-W3）**：真锁接上（kernel/interactive-lock；Conversation 在
  // 回合开头与结尾各打一次 markActive）；被让掉的拍**不回灌心脏** —— claim 已经
  // 把积压拍取走了，于是它就此丢弃、等下一个基线拍。活体是 5 秒节律重试（聊天
  // 结束立刻醒），新体心跳更粗，让位的代价是"最多晚一个基线拍醒"。刻意如此：
  // 回灌会让她一让位就欠下一拍，聊得久了积压成串，反而在对话刚结束的那一刻炸出
  // 一连串补偿拍 —— 那正是让位本身想避免的打扰。
  if (deps.shouldYieldToChat?.() === true) {
    return { status: 'yielded', beats }
  }
  const moment = deps.clock.now()
  if (deps.store.autonomyActionsLastHour({ now: moment }) >= HOURLY_ACTION_CAP) {
    // hourly_cap 早退（autonomous.py:170-174）：档案时钟照写、autonomy_rest 落账。
    recordWakeClock(deps, moment)
    deps.logEvent('autonomy_rest', { reason: 'hourly_cap' })
    return { status: 'rested', beats, reason: 'hourly_cap', next_wake_at: deps.heart.nextAt }
  }

  // 阶段 2b：记账。一个 run_id = 一次 LLM 调用（R-CA-1 的记账点语义）。
  const runId = (deps.runIdFn ?? defaultRunId)()
  deps.store.startAutonomyRun(runId, { startedAt: moment })
  const counts: WakeCounts = { action: 0, external_read: 0, notification: 0 }

  let decision: Decision
  let status: 'completed' | 'failed'
  try {
    // 阶段 3：感知期维护——仲裁器的活，一拍恰好一次（SA-49）；maintain 返回它
    // 用的时刻，读的那一半拿同一个时刻（SA-36 两半共用 moment）。
    const m = maintain(deps.store, deps.snapshotDeps, moment)
    // 阶段 4：推演（纯读，G-9/SA-47 零写断言常驻本包测试）。
    const snap = read(deps.store, deps.snapshotDeps, m)
    const snapLike = snap as unknown as SnapshotLike
    const candidates = buildCandidates(snapLike)
    // 本拍注意力域（_perceive 对应物）：她在快照里真看到的 id 集（裁决 8）。
    const injectedThoughtIds = new Set(snap.念头.map((t) => t.id))
    const injectedConcernIds = new Set(snap.关切.map((c) => c.id))
    const injectedThreadIds = new Set(snap.叙事.线.map((t) => t.id))
    const messages = buildMessages(snapLike, candidates, deps.messageDeps)
    // 阶段 4b：一次 AUTONOMOUS_COGNITION 调用（SA-172：origin=autonomous_wake，
    // runId 贯穿 budget 记账）。
    const reply = await deps.llm(messages, {
      runId, route: AUTONOMOUS_COGNITION, origin: ORIGIN_AUTONOMOUS_WAKE,
    })
    decision = evaluateMessage({ content: reply.content }, candidates, {
      injectedThoughtIds,
      injectedConcernIds,
      injectedThreadIds,
      logEvent: deps.logEvent,
    })
    // 阶段 5：执行 + 回流。
    status = await executeAndReflow(decision, runId, counts, {
      store: deps.store, dispatchFn: deps.dispatchFn, now: m, logEvent: deps.logEvent,
    })
    // 阶段 6：inner 落地——在执行**之后**（SA-31/§5.5 §2：畸形 inner 不可能影响
    // 决策；applyInner 永不抛，它的失败不能让拍失败）。
    applyInner(decision.inner, {
      source: 'wake',
      injectedIds: injectedThoughtIds,
      store: deps.store,
      now: m,
      logEvent: deps.logEvent,
    })
  } catch (exc) {
    // SA-170：一拍失败被完整接住——one bad beat must not kill the loop。
    const failedAt = deps.clock.now()
    const error = exc instanceof Error ? exc.message : String(exc)
    deps.store.finishAutonomyRun(runId, {
      status: 'failed',
      finishedAt: failedAt,
      decision: JSON.stringify({ error }),
      nextWakeAt: heartNextDate(deps.heart, failedAt),
    })
    recordWakeClock(deps, failedAt)
    deps.store.bumpWakesSince({ now: failedAt })
    deps.logEvent('autonomy_wake_failed', { run_id: runId, error })
    return { status: 'failed', beats, run_id: runId, error, next_wake_at: deps.heart.nextAt }
  }

  // 阶段 7：收尾。完整 decision（含 meaning_assessment 与降级字段）持久化，
  // 每个非 rest 的理由都可回溯到快照状态。
  const finishedAt = deps.clock.now()
  deps.store.finishAutonomyRun(runId, {
    status,
    finishedAt,
    decision: serializeDecision(decision),
    nextWakeAt: heartNextDate(deps.heart, finishedAt),
    actionCount: counts.action,
    externalReadCount: counts.external_read,
    notificationCount: counts.notification,
  })
  recordWakeClock(deps, finishedAt)
  deps.store.bumpWakesSince({ now: finishedAt })
  deps.logEvent('autonomy_wake', {
    run_id: runId,
    decision: decision.kind,
    demoted: decision.demoted,
    actions: counts.action,
    status,
  })

  if (status === 'completed') {
    // SA-171：整合与专注串行、只在 completed、各自吞掉一切异常——回头想一件事
    // 永远不该杀掉心跳（真机器在 lykoi-learn，经插件面的闭包接入）。
    if (deps.integrate) {
      try {
        await deps.integrate({ runId })
      } catch (exc) {
        deps.logEvent('autonomy_integrate_failed', {
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
    }
    if (deps.focus) {
      try {
        await deps.focus({ runId })
      } catch (exc) {
        deps.logEvent('autonomy_focus_failed', {
          error: exc instanceof Error ? exc.message : String(exc),
        })
      }
    }
  }

  return {
    status,
    beats,
    run_id: runId,
    decision: decision.kind,
    demoted: decision.demoted,
    next_wake_at: deps.heart.nextAt,
  }
}

// ============================== 插件面 ==============================

/**
 * kernel dispatch 未接线（M3）时的显式替身：一切外部动作大声失败——
 * explore/initiate_chat/queue_notification 会以 failed / 结果经验落账，
 * 绝不静默成功（脑干边界在，只是通道还没长出来）。
 */
export const unwiredDispatch: DispatchFn = async (actionType) => ({
  success: false,
  error: `kernel dispatch 未接线(M3):${actionType} 不可达`,
})

export interface WakeService {
  /** 驱动一拍（心跳事件的消费口；也可显式调用观测）。 */
  beat(): Promise<WakeOutcome>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    wake: WakeService
  }
}

export const name = 'lykoi-wake'
export const inject = ['heart', 'lykoiLlm', 'audit']

export interface Config {
  /** state 副本路径（golden devstate 永远只读——生产接的是治理侧发的可写副本）。 */
  dbPath: string
  /**
   * persona 数据（parsePersonaData 的输入面）。TOML 装载器已在 lykoi-decide
   * （loadPersona/getPersona，W5）；wake 入 cordis.yml 时（M3，W3 TODO⑤）由
   * 治理配置面决定改配 personaToml 路径 —— 本插件当前不进 profile，不擅自改
   * 配置形状。
   */
  persona: Record<string, unknown>
  /** LLM 路由与模型（真实 adapter/model 归 M3 治理配置；route 缺省即归因科目）。 */
  route: string
  model: string
  /** cheap tick 驱动定时器间隔（毫秒；600s 限频闸在 CheapTickDriver）。 */
  checkIntervalMs: number
}

export const Config: Schema<Config> = Schema.object({
  dbPath: Schema.string().required(),
  persona: Schema.any().required(),
  route: Schema.string().default(AUTONOMOUS_COGNITION),
  model: Schema.string().default('mock-model'),
  checkIntervalMs: Schema.number().default(5_000),
})

export function apply(ctx: Context, config: Config) {
  const logEvent = auditLogEvent(ctx.audit, (err) => {
    ctx.logger.error('lykoi-wake: audit record failed: %s', String(err))
  })
  // W1 TODO#9 定案：wake 编排是 rw 句柄在插件树里的持有者（开在 load、关在卸载）。
  // W3 TODO#1 落地：store 层遥测经构造注入接 audit（thought_resolve_rejected /
  // focus_cycle_* / rule_suggestion_* 等 store 内部事件位由此可见）。
  const store = new ReadWriteMemory(resolve(config.dbPath), { logEvent })
  ctx.effect(() => () => store.close(), 'lykoi-wake rw handle')

  // M3-W1 接线：kernel 遥测出口 + scope key 的 identity_bindings 读点。
  setKernelLogEvent(logEvent)
  // M3-W3：出站器官的两个遥测出口（与 setKernelLogEvent 同一条"后设者胜、语义
  // 相同"的进程级注入纪律）——自主拍的 initiate_chat / queue_notification 走的是
  // 同一批 handler，所以它们的账也该进同一个 audit。
  setMessengerLogEvent(logEvent)
  setTransportLogEvent(logEvent)
  setIdentityBindingLookup((channel, channelKey) => store.identityBindingUserId(channel, channelKey))

  const persona = parsePersonaData(config.persona)
  const notifications: NotificationsView = emptyNotifications // M3-W3 接 kernel 通知队列
  const organs = new OrganInventoryCache({
    bindings: () => store.identityBindingInventory(),
    // M3-W1 接线：真 catalog —— kernel KNOWN_ACTIONS + 不可变治理核 is_hard_gated。
    catalog: kernelActionCatalog,
    logEvent,
  })

  // M3-W1 接线：真 kernel dispatch（reflow 的 DispatchFn 接口位在此换真身）。
  // origin 由接线方盖章（wake=autonomous —— 永不由模型给）；runId 贯穿审计行；
  // immutable sink = lykoi-audit（pre-dispatch 审计门 fail closed 在 kernel 内，
  // 红线 #5：被门拦下以**结果**回到她身上）。资源注册表 = W1 显式替身（器官
  // 真身随 W3/M5 波；替身 handler 大声抛 → 正常失败观察，绝不静默成功）。
  const kernelDispatch = createDispatch({ sink: ctx.audit, resources: outboundOrganResources() })
  const dispatchFn: DispatchFn = async (actionType, params, runId) => {
    const observation = await kernelDispatch(
      { type: actionType, params },
      { context: { origin: 'autonomous', runId } },
    )
    return { success: observation.success, data: observation.data, error: observation.error }
  }

  const llm: LlmFn = async (messages, meta) => {
    // dsh-llm 词汇映射：前导 system 段收进单一 system 槽（'\n\n' 连接——顺序
    // 保持 buildMessages 的装配序），其余消息作 user 段。
    let i = 0
    const systemParts: string[] = []
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
        source: { kind: 'user' },
      })),
    }, { runId: meta.runId })
    return { content: result.text }
  }

  const deps: WakeDeps = {
    store,
    clock: systemClock,
    heart: {
      claim: () => ctx.heart.claim(),
      get nextAt() {
        return ctx.heart.nextAt
      },
    },
    llm,
    dispatchFn, // M3-W1 已接真 kernel（origin=autonomous 由上面的适配器盖章）
    snapshotDeps: {
      // M3-W3 ④：三读数从 dev 静态视图**换真源**（W2 TODO#3 / 蓝图 W3 交付④）。
      //  - approval  = kernel 审批队列 `pendingCount()`（TTL 过期/已消费的行由
      //    `pendingActions` 自己滤掉，所以这个数就是"她现在真的在等几个 yes"）；
      //  - notifs    = 通知账本现算 max(0, AUTONOMOUS_DAILY_CAP - 今日 autonomous)
      //    ——**节流本身留在 kernel，这里是视图不是执行点**（SA-42 逐字）；
      //  - proactive = proactive_chat 账本现算（日 1 条；冷却由执行点兜底）。
      // 三个读数从此会随她真的做过什么而变 —— 恒定值那种"诚实呈现"是假的。
      approvalPendingCount: () => pendingCount(),
      notificationsRemainingToday: (now) => notificationsRemainingToday(now),
      proactiveRemainingToday: (now) => proactiveRemainingToday(now),
      unprocessedRestartEvent: (sinceIso) => unprocessedRestartEvent(store, sinceIso),
      logEvent,
    },
    // M3-W3 ⑤：仲裁接真锁（interactive_lock）。Conversation 在回合开头与结尾各
    // 打一次 markActive；这一拍读到窗口内有对话就**让位**（零 LLM 零表写）。
    // DK-11 语义（本波落法）：claim 已经把积压拍取走了，被让掉的拍**就此丢弃，
    // 等下一个基线拍** —— 不回灌心脏，否则聊得久了会积压成串，在对话刚结束时
    // 炸出一连串补偿拍，那正是让位想避免的打扰。
    shouldYieldToChat: () => chatIsActive(),
    messageDeps: {
      persona,
      acquired: () => buildPersonaPrompt(store),
      // G-7 收口（W5）：器官清单接真源 —— 身份/设备轴 = identity_bindings 登记处
      // （rw 读面，channel_key 物理不存在）；动作轴 = kernel KNOWN_ACTIONS（M3，
      // unwired = 空动作面 + isHardGated fail-closed）。独处的她和聊天的她读的是
      // 同一台 OrganInventoryCache 渲染器。
      organBlock: () => organs.block(),
    },
    logEvent,
    // SA-171 接真（W4）：整合与专注挂 lykoi-learn 的闸+周期。origin 分账
    // （SA-172）：同一 autonomous_cognition 路由上按 origin 记三本账，runId 用
    // 本拍的（一拍一个 run_id）。now 从 clock 取——学习环写面全显式传时刻（C-23）。
    integrate: async ({ runId }) => {
      await maybeRunIntegration({
        store, persona, logEvent, now: systemClock.now(),
        completion: (messages) => llm(messages, {
          runId, route: AUTONOMOUS_COGNITION, origin: ORIGIN_AUTONOMOUS_INTEGRATE,
        }),
      })
    },
    focus: async ({ runId }) => {
      await maybeRunFocusCycle({
        store, persona, logEvent, now: systemClock.now(),
        completion: (messages) => llm(messages, {
          runId, route: AUTONOMOUS_COGNITION, origin: ORIGIN_AUTONOMOUS_FOCUS,
        }),
      })
    },
  }

  const wake: WakeService = {
    beat: () => wakeOnce(deps),
  }

  // 心跳事件 → 一拍（claim 合并：连发的多个事件里第一拍取走全部积压）。
  ctx.on('heart/beat', () => {
    wake.beat().catch((err) => {
      // 拍外沿的账面失败（start_run 等）也不许杀树；活体这类失败由 systemd
      // 重启单元兜底，新体的对应物是留痕 + 下一拍照常。
      ctx.logger.error('lykoi-wake: beat crashed outside SA-170 net: %s', String(err))
      logEvent('autonomy_wake_crashed', { error: String(err) })
    })
  })

  // cheap tick 驱动（SA-67）：600s 限频、失败只 log 不致命。
  const driver = new CheapTickDriver()
  ctx.effect(() => {
    const timer = setInterval(() => {
      const now = systemClock.now()
      if (!driver.due(now)) return
      try {
        cheapTick({ store, notifications, now, logEvent })
      } catch (exc) {
        logEvent('cheap_tick_failed', { error: exc instanceof Error ? exc.message : String(exc) })
      }
    }, config.checkIntervalMs)
    return () => clearInterval(timer)
  }, 'lykoi-wake cheap tick driver')

  ctx.provide('wake', wake)
}
