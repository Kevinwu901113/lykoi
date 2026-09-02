/**
 * Action dispatch —— 认知到资源的唯一通路（kernel/dispatch.py 逐字对拍；
 * SK-01..12）。
 *
 * `dispatch` 收一个 Action，按动作类型前缀路由到资源（browser.* → browser、
 * terminal.* → terminal）并返回 Observation。未知动作类型是编程错误、抛；
 * 资源运行期失败是正常结局、以 Observation(success=false) 返回。
 *
 * CF-B2 退役不迁（SK-14）：活体的 Core R2A / execution_session / shadow 分支
 * 整块不存在于新体 —— G-10 已消灭该缺陷出生面，dispatch 主链只剩 guardian
 * 审计门与策略判定两件事。
 *
 * sink 注入（新体形态）：活体从 root-owned guardian 目录 import audit_sink；
 * 新体的 immutable sink = lykoi-audit（append-only JSONL；root 属主 + chattr +a
 * 的权限模型归 M3-W4，不在插件树内），经 createDispatch 显式注入 —— 测试可注
 * 入写失败的模拟。遥测（telemetry.logEvent）永不可顶替它（SK-08）。
 */
import { randomUUID } from 'node:crypto'
import { label as exemptionLabel } from './exemption.ts'
import { check, isHardGated } from './approval.ts'
import { auditSessionId } from './delegation.ts'
import { assertNoSecrets, redact, redactObj } from './redaction.ts'
import { logEvent } from './telemetry.ts'

function _nowIso(): string {
  return new Date().toISOString() // realtime-allow: governance audit stamp, real wall-clock (INC)
}

// --- immutable audit health（SK-08） -----------------------------------------
// 专职 immutable sink 是**唯一**的不可篡改审计；事件流是遥测，永不可顶替它。
// immutable 写失败即进入 degraded 态。因为 pre-dispatch 审计是一道**门**
// （fail closed），sink 不可用期间没有任何带副作用的动作能跑 —— 直到一次写
// 成功为止。进程级状态（新体单进程 —— 活体两进程各持一份，这里一份覆盖全部）。
const _AUDIT_DEGRADED: { degraded: boolean; reason: string | null } = { degraded: false, reason: null }

/**
 * 前一次 immutable 写失败且 sink 至今没再收下一次写，为 true。degraded 期间
 * 带副作用的 dispatch 被拒。
 */
export function auditDegraded(): boolean {
  return _AUDIT_DEGRADED.degraded
}

/** 测试面：重置进程级审计健康态。 */
export function _resetAuditHealthForTest(): void {
  _AUDIT_DEGRADED.degraded = false
  _AUDIT_DEGRADED.reason = null
}

function _enterDegraded(reason: string): void {
  if (!_AUDIT_DEGRADED.degraded || _AUDIT_DEGRADED.reason !== reason) {
    logEvent('audit_degraded', { reason })
  }
  _AUDIT_DEGRADED.degraded = true
  _AUDIT_DEGRADED.reason = reason
}

function _clearDegraded(): void {
  if (_AUDIT_DEGRADED.degraded) logEvent('audit_recovered')
  _AUDIT_DEGRADED.degraded = false
  _AUDIT_DEGRADED.reason = null
}

// --- 类型 --------------------------------------------------------------------

export interface Action {
  type: string
  params: Record<string, unknown>
}

/**
 * 委托上下文 —— 一次 origin="delegated" 派发背后的四个事实（SK-04）。
 *
 * 冻结设计 phase2_joint_design_v1_2026-08-09.md §3.2 逐字四字段。与 exemption
 * 同理，它骑在 **CONTEXT** 上而不是 params 上，这就是全部安全论证：context 由
 * 已知代码路径构造，params 可以被模型输出或环境内容塑形。
 *
 * frozen：一次派发的委托身份在派发中途不可改写（构造即 Object.freeze）。
 */
export class DelegationRef {
  readonly contractId: string // -> delegation_contracts.id
  readonly agentUserId: string // -> users(role='agent')，审计里的身份
  readonly isolationDomain: string // os_user:lykoi-agent-N | lxd:agent-N
  readonly depth: number // <= 合同 max_delegation_depth（本单硬顶见 kernel delegation）

  constructor(fields: { contractId: string; agentUserId: string; isolationDomain: string; depth: number }) {
    this.contractId = fields.contractId
    this.agentUserId = fields.agentUserId
    this.isolationDomain = fields.isolationDomain
    this.depth = fields.depth
    Object.freeze(this)
  }
}

export type DispatchOrigin = 'interactive' | 'autonomous' | 'scheduler' | 'system' | 'delegated'

/**
 * 谁发起了动作、在哪个运行时边界内（SK-03）。
 *
 * origin 是调用的出处 —— interactive 聊天回合、autonomous 醒拍、后台
 * scheduler、内部 system 任务、或 delegated 子代理。runId 把一串自主动作系回
 * 产生它们的那次醒。**没有默认值**：每次 dispatch 必须声明 origin，动作不可能
 * 因缺省而丢失出处（TS 字面量联合钉五值；运行时 dispatch 对缺 context 抛）。
 *
 * exemption（WO-U3 ② / P1）是可选的结构章：标记本次调用是审批机器（E1）、
 * 在场应答（E2）或已收预算的投递线（E3）。它骑在 CONTEXT 上不骑 params 上，
 * 这个位置就是全部安全论证。见 exemption.ts。
 *
 * delegation（WO-GW-01 ③，设计 §3.2）是第五个 origin 的强制随行：origin ==
 * "delegated" 时必须携带 DelegationRef，否则派发被拒（见 dispatch）。其余四个
 * origin 恒 null，且那四个 origin 的每条审计行与从前逐字节相同 —— 委托栏只在
 * ref 真的在场时才加进记录。
 */
export interface DispatchContext {
  origin: DispatchOrigin
  runId?: string | null
  exemption?: unknown
  delegation?: DelegationRef | null
}

export interface Observation {
  success: boolean
  data: Record<string, unknown>
  error: string | null
}

// --- 动作面（SK-01） ----------------------------------------------------------

// 可派发动作的**完整**面。_resolve 在碰资源命名空间之前拒绝任何不在此表的名字，
// 所以仅仅被 import 进资源模块的辅助函数（例如裸 transport 函数）永远变不成
// 动作类型。加一个动作 = 在这里加一行 —— 一次自觉的、可评审的扩面，由治理
// 不变量测试钉死。18 项逐字（browser 5 + terminal.exec + research_browser 4 +
// autonomy 2 + notify.owner + messenger 2 + delegation 3）；分级不写在这张表
// 里，这张表只决定"可不可达"。TS 形态 = 字面量联合类型 + 运行时 Set 双钉。
export const KNOWN_ACTION_LIST = [
  'browser.navigate',
  'browser.get_text',
  'browser.click',
  'browser.type',
  'browser.screenshot',
  'terminal.exec',
  'research_browser.open',
  'research_browser.read_text',
  'research_browser.extract_links',
  'research_browser.screenshot',
  'autonomy.queue_notification',
  // WO-NIGHT-01/B3: 主动开口 — 自主路径的对话消息(chat_outbox kind=proactive)。
  // 显式扩面: action surface 12 -> 13, 治理闭合测试同步改动。
  'autonomy.initiate_chat',
  'notify.owner',
  // WO-P2-S1A: messenger 资源层 — 她自己的 IM 器官, 经 dispatch 发消息/读消息。
  // 显式扩面: action surface 13 -> 15, 治理闭合测试同步改动。
  'messenger.send',
  'messenger.read',
  // WO-GW-01: Delegation Gateway 最小闭环 (设计 §3.2)。
  // 显式扩面: action surface 15 -> 18, 治理闭合测试同步改动。
  // dispatch 默认落到审批门 (ask), status/collect 是 approval.DELEGATION_READONLY
  // 里的两条只读免询项 —— 分级不写在这张表里, 这张表只决定"可不可达"。
  'delegation.dispatch',
  'delegation.status',
  'delegation.collect',
] as const

export type KnownAction = (typeof KNOWN_ACTION_LIST)[number]

export const KNOWN_ACTIONS: ReadonlySet<string> = new Set(KNOWN_ACTION_LIST)

// --- 资源注册表（注入面） -----------------------------------------------------

export type ResourceHandler = (params: Record<string, unknown>) => Promise<unknown>
export type ResourceRegistry = Readonly<Record<string, Readonly<Record<string, ResourceHandler>>>>

/**
 * W1 的显式替身注册表：18 个动作的 (prefix, method) 全部就位（_resolve 的
 * "handler 可调用"不变量成立），但每个 handler 一调用就大声抛 —— 经
 * _execute_decision 的资源边界 catch 落成 Observation(success=false)。器官真身
 * 分批到来（messenger/notify/autonomy/telegram 出站 = M3-W3；browser/terminal/
 * research_browser = M5 感知与执行器官；delegation 传输面 = M5），届时逐一换成
 * 真 handler —— 三道门（策略/审计/遮蔽）不因此移动一行。
 *
 * WO-FIX-LOOP-01 D-1a：每个替身 handler 额外打一个不可枚举标记
 * （`UNWIRED_HANDLER_MARK`），供 `isUnwiredHandler` / `wiredActionCatalog`
 * 结构性识别"这是替身还是真身"——不改抛出的错误文案，不改 `_resolve`。
 */
const UNWIRED_HANDLER_MARK = Symbol.for('lykoi.kernel.unwired_handler')

function markUnwiredHandler(handler: ResourceHandler): ResourceHandler {
  Object.defineProperty(handler, UNWIRED_HANDLER_MARK, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  })
  return handler
}

/** 结构判定：这个 handler 是不是 `unwiredResources()` 造出来的替身（D-1a）。 */
export function isUnwiredHandler(handler: ResourceHandler): boolean {
  return (handler as unknown as Record<symbol, unknown>)[UNWIRED_HANDLER_MARK] === true
}

export function unwiredResources(): ResourceRegistry {
  const registry: Record<string, Record<string, ResourceHandler>> = {}
  for (const actionType of KNOWN_ACTION_LIST) {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    registry[prefix] ??= {}
    registry[prefix]![method] = markUnwiredHandler(async () => {
      throw new Error(`器官未接线: ${actionType} 的资源真身随 M3-W3/M5 器官波到来`)
    })
  }
  return registry
}

/**
 * D-1a：`resources` 里**真的接得通**的动作子集（`KNOWN_ACTION_LIST` 原序保留）。
 * 一个动作类型算"接得通"，当且仅当 `resources[prefix][method]` 存在、可调用、
 * 且未打 `UNWIRED_HANDLER_MARK`。`isHardGated` 与 `kernelActionCatalog` 同一
 * 实现——分级判定不因"接没接线"而改变。
 */
export function wiredActionCatalog(resources: ResourceRegistry): {
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
} {
  const knownActions = KNOWN_ACTION_LIST.filter((actionType) => {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    const handler = resources[prefix]?.[method]
    return typeof handler === 'function' && !isUnwiredHandler(handler)
  })
  return {
    knownActions,
    isHardGated: (actionType: string) => isHardGated(actionType),
  }
}

/**
 * 返回 actionType 的资源 handler 或抛（SK-02 四重拒绝全 raise）：
 * ①畸形类型 ②不在 KNOWN_ACTIONS ③未知资源前缀 ④handler 不可调用。
 */
export function _resolve(actionType: string, resources: ResourceRegistry): ResourceHandler {
  const idx = actionType.indexOf('.')
  const prefix = idx === -1 ? actionType : actionType.slice(0, idx)
  const method = idx === -1 ? '' : actionType.slice(idx + 1)
  if (!prefix || !method) {
    throw new Error(`malformed action.type: ${JSON.stringify(actionType)}`)
  }
  if (!KNOWN_ACTIONS.has(actionType)) {
    throw new Error(`unknown action ${JSON.stringify(actionType)}`)
  }
  const resource = resources[prefix]
  if (resource === undefined) {
    throw new Error(`unknown action prefix ${JSON.stringify(prefix)} in ${JSON.stringify(actionType)}`)
  }
  const handler = resource[method]
  if (typeof handler !== 'function') {
    throw new Error(`unknown action ${JSON.stringify(actionType)}`)
  }
  return handler
}

// --- immutable sink（注入） ---------------------------------------------------

/** lykoi-audit AuditService 的结构形状（kernel 不 import 插件包 —— CF-B1）。 */
export interface ImmutableAuditSink {
  record(event: { type: string; [key: string]: unknown }): Promise<void>
}

/**
 * SK-09：预期内的 sink 不可用（Python OSError 对应 = Node 带 errno `code` 的
 * 系统错误：权限/磁盘/append-only 拒绝）→ false；编程错误**不**伪装成审计不可
 * 用 —— 照常传播（pre-dispatch 顺序保证 handler 尚未跑）。
 */
function _expectedSinkFailure(exc: unknown): boolean {
  return exc instanceof Error && typeof (exc as NodeJS.ErrnoException).code === 'string'
}

/**
 * 往 immutable sink 追加一条记录。成功 true；仅对**预期内**的 sink 不可用返回
 * false：sink 缺席（null）或写失败带系统错误码。遥测用显式字段（不展开整条
 * record），record 里带 event 名的键永远撞不上 log_event 的位置参数（SK-09）。
 */
async function _immutableAudit(sink: ImmutableAuditSink | null, record: { type: string; [key: string]: unknown }): Promise<boolean> {
  if (sink === null) {
    logEvent('audit_unavailable', {
      stage: record.type,
      action_type: record.action_type,
      action_id: record.action_id,
      reason: 'audit_sink_unavailable',
    })
    return false
  }
  try {
    await sink.record(record)
    return true
  } catch (exc) {
    if (_expectedSinkFailure(exc)) {
      // expected sink failure (perm/disk/append-only) -> degrade
      logEvent('audit_unavailable', {
        stage: record.type,
        action_type: record.action_type,
        action_id: record.action_id,
        error: exc instanceof Error ? exc.message : String(exc),
      })
      return false
    }
    throw exc
  }
}

/**
 * WO-GW-01 ⑤：审计行上的委托身份栏 —— contract_id / session id 全程携带
 * （SK-12）。没有委托就返回**空 dict**，不是一栏 null。这是判据③"既有四个
 * origin 的行为逐字节不变"的实现细节：一条 interactive 的 audit 行 JSON 与
 * 本单之前一个字节都不差，因为根本没有多出来的键。
 */
function _delegationAuditFields(context: DispatchContext): Record<string, unknown> {
  const ref = context.delegation
  if (!(ref instanceof DelegationRef)) return {}
  return {
    delegation: {
      contract_id: ref.contractId,
      session_id: auditSessionId(ref.contractId),
      agent_user_id: ref.agentUserId,
      isolation_domain: ref.isolationDomain,
      depth: ref.depth,
    },
  }
}

// --- dispatch ----------------------------------------------------------------

export type PolicyDecision = 'allow' | 'ask' | 'deny' | 'pre_approved'

/**
 * 把审批 check 解析成一枚入账的判定标签（SK-06 四值）：
 * allow | ask | deny | pre_approved。
 *
 * params 是 RAW（未遮蔽）参数：scope key 由收件人/URL 算出，遮蔽会毁掉键赖以
 * 成立的那个标识。它们只用于导出那个键（WO-P2-S2），从不在这里落日志 ——
 * 审计行带遮蔽副本。check → deny 恒 deny：硬 deny 压过所有者批准。
 */
export function _policyDecision(
  actionType: string,
  origin: string,
  preApproved: boolean,
  params: Record<string, unknown> | null = null,
  exemption: unknown = null,
): PolicyDecision {
  const raw = check(actionType, origin, params, exemption)
  if (raw === 'deny') return 'deny'
  if (raw === 'ask') return preApproved ? 'pre_approved' : 'ask'
  return 'allow'
}

/**
 * 执行一枚判定（SK-10 四路）。deny/ask 永不触达 handler；allow 与 pre_approved
 * 跑它（资源边界失败是一次正常的失败观察）。
 */
async function _executeDecision(
  decision: PolicyDecision,
  action: Action,
  handler: ResourceHandler,
  safeParams: Record<string, unknown>,
  actionId: string,
  correlationId: string,
): Promise<Observation> {
  if (decision === 'deny') {
    // hard/rule deny wins even over an owner approval
    return { success: false, data: { denied: true }, error: 'denied by rule' }
  }
  if (decision === 'ask') {
    return {
      success: false,
      data: {
        needs_approval: true,
        action: { type: action.type, params: safeParams },
        action_id: actionId,
        correlation_id: correlationId,
      },
      error: 'needs_approval',
    }
  }
  let data: unknown
  try {
    data = await handler(action.params)
  } catch (exc) {
    // resource-boundary failure -> normal failed observation
    return { success: false, data: {}, error: redact(exc instanceof Error ? exc.message : String(exc)) }
  }
  // Everything handed back to cognition is redacted first.
  return { success: true, data: redactObj(data) as Record<string, unknown>, error: null }
}

export interface DispatchDeps {
  /** immutable audit sink（lykoi-audit 注入；null = sink 不可用 → 门恒 fail closed）。 */
  sink: ImmutableAuditSink | null
  /** 资源注册表；缺省 = unwiredResources()（W1 替身：门真、器官待长）。 */
  resources?: ResourceRegistry
}

export type DispatchFunction = (
  action: Action,
  opts: {
    context: DispatchContext
    preApproved?: boolean
    actionId?: string | null
    correlationId?: string | null
  },
) => Promise<Observation>

/**
 * 构造 dispatch（sink/资源注入后的形态；SK-07 审计闭合）：context 强制（无缺省
 * —— 略掉即抛，动作不可能默取一个 origin）。
 *
 * preApproved=true 是所有者对*这一次*动作的显式放行（经审批端点）：让一个
 * 本会 "ask" 的动作跑一次。硬 "deny" 照样拦 —— 永不可批的动作批也批不过。
 *
 * actionId/correlationId 对新动作在此铸造、批准后的重派原样穿回，一个动作的
 * 每条审计行 —— 首次尝试、审批、执行 —— 共享一个 correlation_id。每条审计行
 * 还带 context 的 origin/run_id 与策略 decision。
 *
 * 审计闭合：策略判定算完、动作意图+判定写进 IMMUTABLE sink，**然后**才可能有
 * handler 跑。那次写失败则 dispatch fail CLOSED（无 handler、
 * error="audit_unavailable"）—— 没有耐久的意图记录就绝不产生副作用。
 */
export function createDispatch(deps: DispatchDeps): DispatchFunction {
  const resources = deps.resources ?? unwiredResources()

  return async function dispatch(action, opts): Promise<Observation> {
    const context = opts.context
    if (!context || typeof context.origin !== 'string') {
      throw new TypeError('dispatch requires a context with an explicit origin (no default)')
    }
    const actionId = opts.actionId ?? randomUUID().replaceAll('-', '')
    const correlationId = opts.correlationId ?? randomUUID().replaceAll('-', '')
    const preApproved = opts.preApproved ?? false
    const handler = _resolve(action.type, resources) // unknown action.type -> raise (not swallowed)
    // WO-GW-01 ③（SK-04）: origin="delegated" 必须带 DelegationRef。缺了就**拒绝
    // 派发并落账** —— 刻意不在 context 构造期抛：构造期抛异常留不下审计行，而
    // "有人试图以委托身份派发却说不出是哪张合同"恰恰是最该被记下来的一件事。
    // 位置在 policy / pre-dispatch 审计门**之前**：一个身份不完整的调用不该消耗
    // 策略判定，也不该在 intent 行里留下一个半截的委托身份。
    if (context.origin === 'delegated' && !(context.delegation instanceof DelegationRef)) {
      const refusal = {
        type: 'delegation_context_invalid',
        ts: _nowIso(),
        action_type: action.type,
        action_id: actionId,
        correlation_id: correlationId,
        origin: context.origin,
        run_id: context.runId ?? null,
        reason: 'delegation_required',
      }
      await _immutableAudit(deps.sink, refusal) // 已经是拒绝路径：sink 不可用不会放宽任何东西
      logEvent('delegation_context_invalid', { action_type: action.type, action_id: actionId })
      return {
        success: false,
        data: { delegation_required: true, action_id: actionId, correlation_id: correlationId },
        error: 'delegation_required',
      }
    }
    assertNoSecrets(action.params) // refuse secret plaintext in params（SK-05 先 assert）
    const safeParams = redactObj(action.params) as Record<string, unknown> // 再 redact
    const decision = _policyDecision(
      action.type, context.origin, preApproved, action.params, context.exemption,
    )
    // WO-U3 ②: P1 待遇的第二半 —— "全量入 immutable audit / 逐条入 audit"。豁免
    // 免掉的是**问**，从来不是**账**：一条免询出站在审计里必须比一条普通出站
    // 多一栏，而不是少一栏。非标记一律记 null（exemption.label）。
    const exemptLabel = exemptionLabel(context.exemption)
    const requestTs = _nowIso()

    const intent = {
      type: 'action_dispatch',
      ts: requestTs,
      action_type: action.type,
      action_id: actionId,
      correlation_id: correlationId,
      origin: context.origin,
      run_id: context.runId ?? null,
      params: safeParams,
      decision,
      pre_approved: preApproved,
      exemption: exemptLabel,
      ..._delegationAuditFields(context),
    }
    // PRE-DISPATCH IMMUTABLE AUDIT GATE — fail closed if the intent cannot be recorded.
    if (!(await _immutableAudit(deps.sink, intent))) {
      _enterDegraded('pre_dispatch_audit_failed')
      return {
        success: false,
        data: { audit_unavailable: true, action_id: actionId, correlation_id: correlationId },
        error: 'audit_unavailable',
      }
    }
    _clearDegraded() // the immutable sink just accepted a write -> healthy again

    // handler 异常（BaseException 对应）照常传播 —— 与活体一致，SK-10 的四路
    // 只包住资源边界（_executeDecision 内部 catch），判定引擎自身的失败不吞。
    const observation = await _executeDecision(
      decision, action, handler, safeParams, actionId, correlationId,
    )

    const result = {
      type: 'action_result',
      ts: _nowIso(),
      action_type: action.type,
      action_id: actionId,
      correlation_id: correlationId,
      origin: context.origin,
      run_id: context.runId ?? null,
      decision,
      success: observation.success,
      error: observation.error,
      ..._delegationAuditFields(context),
    }
    // POST-DISPATCH RESULT AUDIT — best-effort（SK-07 post 半面）。写失败无法
    // un-run handler，所以把观察标成未完全入账并降级 sink；下一次 pre-dispatch
    // 门会拒绝进一步副作用，直到一次写成功。编程错误照常传播（SK-09）。
    const resultAudited = await _immutableAudit(deps.sink, result)
    if (!resultAudited) {
      _enterDegraded('post_dispatch_audit_failed')
      if (typeof observation.data === 'object' && observation.data !== null) {
        observation.data.audit_degraded = true
      } else {
        return {
          success: observation.success,
          data: { value: observation.data, audit_degraded: true },
          error: observation.error,
        }
      }
    }
    return observation
  }
}

// --- 器官清单的动作轴（接线：M2 空动作面替身 → 真 catalog） -------------------

/**
 * `KNOWN_ACTION_LIST` 的只读派生视图：她**可派发**的动作全集 = KNOWN_ACTIONS；
 * 哪些永远绕不过 Kevin = 不可变治理核的 isHardGated（core 缺失 fail closed
 * 成全表硬门 —— 方向永远是往少了说）。
 *
 * **WO-FIX-LOOP-01 D-1a 改口**：这是"可派发全集"（词汇表 —— 这个动作类型合法、
 * `_resolve` 认得），**不是**"接得通全集"（图式 —— 这个器官此刻真的在位）。
 * W3 之后 18 项词汇里只有 5 项接了真传输面；生产两处（wake/converse）的器官
 * 清单已改喂 `wiredActionCatalog(resources)`（本单新增，见下），不再用本
 * catalog 渲染清单文本——本导出保留给测试与"合法动作全集"语境下的旧引用，
 * 不删。图式那一层是 `schema-registry.ts`；接线时点见
 * docs/m3_schema_registry.md §6/§7（`registryActionCatalog` 切换属 M5）。
 */
export const kernelActionCatalog: {
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
} = {
  knownActions: KNOWN_ACTION_LIST,
  isHardGated: (actionType: string) => isHardGated(actionType),
}
