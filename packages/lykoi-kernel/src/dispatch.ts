import { randomUUID } from 'node:crypto'
import { label as exemptionLabel, covers as exemptionCovers } from './exemption.ts'
import { check, isHardGated } from './approval.ts'
import { auditSessionId } from './delegation.ts'
import { assertNoSecrets, redact, redactObj } from './redaction.ts'
import { logEvent } from './telemetry.ts'

function _nowIso(): string {
  return new Date().toISOString() // realtime-allow: governance audit stamp, real wall-clock (INC)
}

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

export class DelegationRef {
  readonly contractId: string // -> delegation_contracts.id
  readonly agentUserId: string // -> users(role='agent')，审计里的身份
  readonly isolationDomain: string // os_user:lykoi-agent-N | lxd:agent-N
  readonly depth: number

  constructor(fields: { contractId: string; agentUserId: string; isolationDomain: string; depth: number }) {
    this.contractId = fields.contractId
    this.agentUserId = fields.agentUserId
    this.isolationDomain = fields.isolationDomain
    this.depth = fields.depth
    Object.freeze(this)
  }
}

export type DispatchOrigin = 'interactive' | 'autonomous' | 'scheduler' | 'system' | 'delegated'

export interface DispatchContext {
  origin: DispatchOrigin
  execution?: CapabilityExecutionContext
  /**
   * D-2d：认知回合关联的 snake_case ID。`runId` 保留给既有调用方；当两种
   * 拼法同时出现时，snake_case 值只作为审计透传的显式新值（包括 null）。
   */
  run_id?: string | null
  turn_id?: string | null
  runId?: string | null
  exemption?: unknown
  delegation?: DelegationRef | null
}

export interface Observation {
  success: boolean
  data: Record<string, unknown>
  error: string | null
}

import type { CapabilityExecutionContext, ResourceHandler, ResourceRegistry } from 'lykoi-contracts'
export type { ResourceHandler, ResourceRegistry } from 'lykoi-contracts'

/** Derive the dispatch view from installed handlers. Permissions remain independent. */
export function wiredActionCatalog(resources: ResourceRegistry): {
  knownActions: readonly string[]
  isHardGated(actionType: string): boolean
} {
  const knownActions = Object.entries(resources).flatMap(([prefix, methods]) => Object.keys(methods).map(method => `${prefix}.${method}`)).filter((actionType) => {
    const [prefix, method] = actionType.split('.', 2) as [string, string]
    const handler = resources[prefix]?.[method]
    return typeof handler === 'function'
  })
  return {
    knownActions,
    isHardGated: (actionType: string) => isHardGated(actionType),
  }
}

export function _resolve(actionType: string, resources: ResourceRegistry): ResourceHandler {
  const idx = actionType.indexOf('.')
  const prefix = idx === -1 ? actionType : actionType.slice(0, idx)
  const method = idx === -1 ? '' : actionType.slice(idx + 1)
  if (!prefix || !method) {
    throw new Error(`malformed action.type: ${JSON.stringify(actionType)}`)
  }
  const resource = resources[prefix]
  if (!Object.hasOwn(resources, prefix) || resource === undefined) {
    throw new Error(`unknown action prefix ${JSON.stringify(prefix)} in ${JSON.stringify(actionType)}`)
  }
  const handler = resource[method]
  if (!Object.hasOwn(resource, method) || typeof handler !== 'function') {
    throw new Error(`unknown action ${JSON.stringify(actionType)}`)
  }
  return handler
}

export interface ImmutableAuditSink {
  record(event: { type: string; [key: string]: unknown }): Promise<void>
}

function _expectedSinkFailure(exc: unknown): boolean {
  return exc instanceof Error && typeof (exc as NodeJS.ErrnoException).code === 'string'
}

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

/**
 * D-2d：把 DispatchContext 的回合 ID 映射到 immutable action 账。
 *
 * `runId` 是既有 camelCase 输入，继续映射到既有 `run_id` 栏；新 snake_case
 * `run_id` 在被显式提供时优先，因而显式 null 不会被旧值覆盖。`turn_id` 不
 * 参与判定，也不在调用方未提供时制造一个新字段（JSONL 序列化结果保持不变）。
 */
function _turnAuditFields(context: DispatchContext): Record<string, unknown> {
  return {
    run_id: context.run_id !== undefined ? context.run_id : context.runId ?? null,
    ...(context.turn_id === undefined ? {} : { turn_id: context.turn_id }),
  }
}

// --- dispatch ----------------------------------------------------------------

export type PolicyDecision = 'allow' | 'ask' | 'deny' | 'pre_approved'

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

async function _executeDecision(
  decision: PolicyDecision,
  action: Action,
  handler: ResourceHandler,
  safeParams: Record<string, unknown>,
  actionId: string,
  correlationId: string,
  execution: CapabilityExecutionContext | undefined,
  exemption: unknown,
  origin: string,
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
    data = await handler(action.params, execution, { origin, ...(exemptionCovers(action.type, action.params, exemption) ? { messageBudget: 'exempt' as const } : {}) })
  } catch (exc) {
    // resource-boundary failure -> normal failed observation
    return { success: false, data: {}, error: redact(exc instanceof Error ? exc.message : String(exc)) }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)
    && (data as Record<string, unknown>).ok === false) {
    const reason = (data as Record<string, unknown>).error
    return {
      success: false,
      data: redactObj(data) as Record<string, unknown>,
      // error 与 data 同过 redact：观察里的两处错误串不该一处遮一处不遮。
      error: typeof reason === 'string' ? redact(reason) : 'organ_failed',
    }
  }
  // Everything handed back to cognition is redacted first.
  return { success: true, data: redactObj(data) as Record<string, unknown>, error: null }
}

export interface DispatchDeps {
  /** immutable audit sink（lykoi-audit 注入；null = sink 不可用 → 门恒 fail closed）。 */
  sink: ImmutableAuditSink | null
  /** 资源注册表；未提供时为空，不虚构未安装能力。 */
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

export function createDispatch(deps: DispatchDeps): DispatchFunction {
  const resources = deps.resources ?? {}

  return async function dispatch(action, opts): Promise<Observation> {
    const context = opts.context
    if (!context || typeof context.origin !== 'string') {
      throw new TypeError('dispatch requires a context with an explicit origin (no default)')
    }
    const actionId = opts.actionId ?? randomUUID().replaceAll('-', '')
    const correlationId = opts.correlationId ?? randomUUID().replaceAll('-', '')
    const preApproved = opts.preApproved ?? false
    const handler = _resolve(action.type, resources)

    if (context.origin === 'delegated' && !(context.delegation instanceof DelegationRef)) {
      const refusal = {
        type: 'delegation_context_invalid',
        ts: _nowIso(),
        action_type: action.type,
        action_id: actionId,
        correlation_id: correlationId,
        origin: context.origin,
        ..._turnAuditFields(context),
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
    assertNoSecrets(action.params)
    const safeParams = redactObj(action.params) as Record<string, unknown> // 再 redact
    const decision = _policyDecision(
      action.type, context.origin, preApproved, action.params, context.exemption,
    )

    const exemptLabel = exemptionLabel(context.exemption)
    const requestTs = _nowIso()

    const intent = {
      type: 'action_dispatch',
      ts: requestTs,
      action_type: action.type,
      action_id: actionId,
      correlation_id: correlationId,
      origin: context.origin,
      ..._turnAuditFields(context),
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
    _clearDegraded()

    const observation = await _executeDecision(
      decision, action, handler, safeParams, actionId, correlationId, context.execution, context.exemption, context.origin,
    )

    const result = {
      type: 'action_result',
      ts: _nowIso(),
      action_type: action.type,
      action_id: actionId,
      correlation_id: correlationId,
      origin: context.origin,
      ..._turnAuditFields(context),
      decision,
      success: observation.success,
      error: observation.error,
      ..._delegationAuditFields(context),
    }

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
