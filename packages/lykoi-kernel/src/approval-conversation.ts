import {
  consumePending, enqueuePending, findLivePending, findPendingByQuestion,
  pendingActions, pendingState, recentDenial, resolvePending, resolveScopeKey,
  setQuestionMessageId,
} from './approval.ts'
import * as interpreter from './approval-interpreter.ts'
import type { DispatchFunction, DispatchOrigin, Observation } from './dispatch.ts'
import { approvalMachinery } from './exemption.ts'
import { logEvent } from './telemetry.ts'

// --- 她说的话（SPEC-KERNEL §2 A 段 10 条逐字） --------------------------------
// 复述具体动作不是客气：一个对着光秃秃的「可以吗」回「可以」的所有者，事后授权了
// 一件谁也指不出来的事。
/** 30 字，sha256 886f07bf…。 */
export const QUESTION_TEMPLATE = '有件事得你点头我才做: {description}。可以吗?'
/** 51 字，sha256 a7019f4a…。 */
export const RETRACT_TEMPLATE = '刚才那个问题先作废 —— 我这边没记住它({reason}), 所以这件事我不做了。要的话你再说一次。'
/** 8 字，sha256 0356d3db…。 */
export const DENY_CONFIRM = '好, 这次不做。'

export const EXPIRED_REPLY = '那条已经过期了, 要我重新问吗?'

export const EXEC_OK_TEMPLATE = '做完了: {description}\n\n{output}'
/** 25 字，sha256 193cdb34…。 */
export const EXEC_OK_NO_OUTPUT = '做完了: {description}\n(没有输出)'
/** 32 字，sha256 ab98ae11…。 */
export const EXEC_FAIL_TEMPLATE = '跑了, 但出错了: {description}\n\n{error}'
/** 30 字，sha256 84cb462f…。 */
export const EXEC_SKIPPED_TEMPLATE = '这条我没能执行({reason}) —— 要的话你再说一次。'

// 聊天不是终端：一条打印出一兆字节的命令绝不能变成一兆字节的 Telegram 消息。
// 截断要**显式告知**，绝不静默 —— 「输出到这里为止」本身就是他需要的信息。
export const RESULT_MAX_CHARS = 1500
/** 22 字，sha256 14d81780…。 */
export const RESULT_TRUNCATED = '\n…(输出还有, 这里只显示前 {n} 字)'

// 审计事件（与六元组 approval_interaction 同一个 immutable sink）。
export const AUDIT_QUESTION = 'approval_question'
export const AUDIT_ANSWER_ROUTED = 'approval_answer_routed'
export const AUDIT_EXECUTION = 'approval_execution'

/**
 * 她问出口的确切words。由解释器自己的 `describeAction` 构建，于是问句、追问和
 * 答复被判读时所对着的提示词，三者对动作的描述完全一致。
 */
export function questionText(actionType: string, params: Record<string, unknown> | null = null): string {
  return QUESTION_TEMPLATE.replace('{description}', interpreter.describeAction(actionType, params ?? {}))
}

export interface SendResult {
  sent: boolean
  message_id: string | null
  reason: string | null
}

export interface RequestApprovalResult {
  status: 'asked' | 'already_pending' | 'quiet_period' | 'send_failed' | 'enqueue_failed'
  pending_id: string | null
  question_message_id: string | null
  scope_key: string | null
  reason?: string | null
}

export interface HandleOwnerAnswerResult {
  outcome: 'ignored' | 'expired' | 'clarify' | 'granted' | 'execute_once' | 'denied'
  pending_id: string | null
  executed: boolean
  replied: boolean
  scope_key: string | null
}

export interface ExecutionResult {
  executed: boolean
  reason: string | null
  observation: Observation | null
}

export interface ApprovalConversation {
  requestApproval(
    actionType: string,
    params: Record<string, unknown>,
    opts: {
      contextId: string
      replyTo?: string | null
      origin?: string
      runId?: string | null
      run_id?: string | null
      turn_id?: string | null
      actionId?: string | null
      correlationId?: string | null
      now?: Date
    },
  ): Promise<RequestApprovalResult>
  handleOwnerAnswer(
    answerText: string,
    opts: {
      contextId: string
      replyTo?: string | number | null
      messageId?: string | number | null
      now?: Date
    },
  ): Promise<HandleOwnerAnswerResult>
  /** 测试/接线可见的回执渲染（纯函数）。 */
  executionReport(record: Record<string, unknown>, execution: ExecutionResult): string
}

/**
 * 她的回复引用他的消息 —— 这同时也是把它排除在主动打扰预算之外的东西
 * （S1A：回答 Kevin 不算打扰他）。
 */
function _replyRef(messageId: string | number | null | undefined): string | null {
  return messageId === null || messageId === undefined ? null : String(messageId)
}

function _ignored(): HandleOwnerAnswerResult {
  return { outcome: 'ignored', pending_id: null, executed: false, replied: false, scope_key: null }
}

function _truncate(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  const chars = [...trimmed]
  if (chars.length <= RESULT_MAX_CHARS) return trimmed
  return chars.slice(0, RESULT_MAX_CHARS).join('')
    + RESULT_TRUNCATED.replace('{n}', String(RESULT_MAX_CHARS))
}

export function _resultBody(data: unknown): string {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return _truncate(data)

  if (Array.isArray(data)) {
    try {
      return _truncate(JSON.stringify(data))
    } catch {
      return _truncate(String(data))
    }
  }
  if (typeof data !== 'object') return _truncate(String(data))
  const obj = data as Record<string, unknown>
  const parts: string[] = []
  for (const key of ['stdout', 'output', 'result', 'text', 'content']) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim() !== '') parts.push(value.trim())
  }
  const stderr = obj.stderr
  if (typeof stderr === 'string' && stderr.trim() !== '') parts.push('stderr: ' + stderr.trim())
  if (parts.length > 0) return _truncate(parts.join('\n'))
  try {
    return _truncate(JSON.stringify(obj))
  } catch {
    return _truncate(String(obj))
  }
}

export function executionReport(
  record: Record<string, unknown> | null,
  execution: ExecutionResult,
): string {
  const description = interpreter.describeAction(
    String((record ?? {}).action_type ?? ''),
    ((record ?? {}).params as Record<string, unknown>) ?? {},
  )
  if (!execution.executed) {
    return EXEC_SKIPPED_TEMPLATE.replace('{reason}', execution.reason || '未知原因')
  }
  const observation = execution.observation
  if (observation === null || observation === undefined || !observation.success) {
    const error = (observation?.error ?? null) || '(没有错误信息)'
    const body = _resultBody(observation?.data ?? null)
    return EXEC_FAIL_TEMPLATE
      .replace('{description}', description)
      .replace('{error}', _truncate(`${error}\n${body}`.trim()))
  }
  const body = _resultBody(observation.data ?? null)
  if (!body) return EXEC_OK_NO_OUTPUT.replace('{description}', description)
  return EXEC_OK_TEMPLATE.replace('{description}', description).replace('{output}', body)
}

export interface ApprovalConversationDeps {
  /** kernel dispatch 真身（createDispatch 的产物）—— 本模块唯一的出口。 */
  dispatch: DispatchFunction
}

export function createApprovalConversation(deps: ApprovalConversationDeps): ApprovalConversation {

  async function _send(
    contextId: string,
    text: string,
    replyTo: string | null,
    turnContext: { run_id?: string | null; turn_id?: string | null } = {},
  ): Promise<SendResult> {
    const observation = await deps.dispatch(
      { type: 'messenger.send', params: { text, context_id: contextId, reply_to: replyTo } },
      {
        context: {
          origin: 'interactive',
          exemption: approvalMachinery(),
          ...(turnContext.run_id === undefined ? {} : { run_id: turnContext.run_id }),
          ...(turnContext.turn_id === undefined ? {} : { turn_id: turnContext.turn_id }),
        },
      },
    )
    const data = (typeof observation.data === 'object' && observation.data !== null)
      ? observation.data as Record<string, unknown>
      : {}
    if (!observation.success) {
      const reason = data.needs_approval
        ? 'needs_approval'
        : (observation.error || 'send_failed')

      logEvent('approval_message_undelivered', { reason, context_id: String(contextId) })
      return { sent: false, message_id: null, reason }
    }
    if (data.sent === false) { // messenger 自己的策略拒绝形状
      const reason = (data.reason as string | undefined) || 'throttled'
      logEvent('approval_message_undelivered', { reason, context_id: String(contextId) })
      return { sent: false, message_id: null, reason }
    }
    const messageId = data.message_id
    return {
      sent: true,
      message_id: messageId === null || messageId === undefined ? null : String(messageId),
      reason: null,
    }
  }

  async function requestApproval(
    actionType: string,
    params: Record<string, unknown>,
    opts: {
      contextId: string
      replyTo?: string | null
      origin?: string
      runId?: string | null
      run_id?: string | null
      turn_id?: string | null
      actionId?: string | null
      correlationId?: string | null
      // 静默期判定的时钟（缺省真钟；与 handleOwnerAnswer.now 同形）。recentDenial
      // 本就收 now，只是这里此前没透传 —— 固定夹具日期的测试因此在夹具+24h 后
      // 由绿转红（denial 记在 T0、判定却用真钟）。
      now?: Date
    },
  ): Promise<RequestApprovalResult> {
    const contextId = opts.contextId
    const replyTo = opts.replyTo ?? null
    const scopeKey = resolveScopeKey(actionType, params)

    // ① 去重
    const existing = findLivePending(actionType, params)
    if (existing !== null) {
      logEvent('approval_question_deduped', { action_type: actionType, pending_id: existing.id })
      return {
        status: 'already_pending',
        pending_id: String(existing.id),
        question_message_id: existing.question_message_id === null || existing.question_message_id === undefined
          ? null
          : String(existing.question_message_id),
        scope_key: scopeKey,
      }
    }

    // ② 静默期
    if (scopeKey && recentDenial(actionType, scopeKey, { now: opts.now }) !== null) {
      // 同范围短期内不再问 —— advisory，而且是往**安全**方向的 advisory：动作
      // 照样不发生，她只是不再唠叨。
      await interpreter.auditEvent(AUDIT_QUESTION, {
        stage: 'suppressed',
        action_type: actionType,
        scope_key: scopeKey,
        outcome: 'quiet_period',
        delivered: false,
      })
      logEvent('approval_question_suppressed', { action_type: actionType, scope_key: scopeKey })
      return { status: 'quiet_period', pending_id: null, question_message_id: null, scope_key: scopeKey }
    }

    // ③ 先发
    const text = questionText(actionType, params)
    const turnContext = {
      ...(opts.run_id === undefined ? {} : { run_id: opts.run_id }),
      ...(opts.turn_id === undefined ? {} : { turn_id: opts.turn_id }),
    }
    const delivery = await _send(contextId, text, replyTo, turnContext)
    if (!delivery.sent) {
      await interpreter.auditEvent(AUDIT_QUESTION, {
        stage: 'undelivered',
        action_type: actionType,
        scope_key: scopeKey,
        question_text: text,
        outcome: 'deny_by_default',
        delivered: false,
        reason: delivery.reason,
      })
      return {
        status: 'send_failed',
        pending_id: null,
        question_message_id: null,
        scope_key: scopeKey,
        reason: delivery.reason,
      }
    }

    // ④ 后排
    let pendingId: string
    try {
      pendingId = enqueuePending(actionType, params, {
        actionId: opts.actionId ?? null,
        correlationId: opts.correlationId ?? null,
        origin: opts.origin ?? 'interactive',
        runId: opts.run_id !== undefined ? opts.run_id : opts.runId ?? null,
        questionMessageId: delivery.message_id,
        questionText: text,
      })
    } catch (exc) {

      logEvent('approval_enqueue_failed', {
        action_type: actionType, error: exc instanceof Error ? exc.message : String(exc),
      })
      await _send(
        contextId,
        RETRACT_TEMPLATE.replace('{reason}', exc instanceof Error ? exc.name : 'Error'),
        replyTo,
        turnContext,
      )
      await interpreter.auditEvent(AUDIT_QUESTION, {
        stage: 'retracted',
        action_type: actionType,
        scope_key: scopeKey,
        question_text: text,
        outcome: 'deny_by_default',
        delivered: true,
        reason: exc instanceof Error ? exc.name : 'Error',
      })
      return {
        status: 'enqueue_failed',
        pending_id: null,
        question_message_id: delivery.message_id,
        scope_key: scopeKey,
      }
    }

    await interpreter.auditEvent(AUDIT_QUESTION, {
      stage: 'asked',
      action_type: actionType,
      scope_key: scopeKey,
      question_text: text,
      question_message_id: delivery.message_id,
      pending_id: pendingId,
      outcome: 'asked',
      delivered: true,
    })
    logEvent('approval_question_sent', { action_type: actionType, pending_id: pendingId })
    return {
      status: 'asked',
      pending_id: pendingId,
      question_message_id: delivery.message_id,
      scope_key: scopeKey,
    }
  }

  async function _executeOnce(record: Record<string, unknown>): Promise<ExecutionResult> {
    const [status, grant] = consumePending(
      String(record.id), (record.params as Record<string, unknown>) ?? {}, { actor: 'owner' },
    )
    if (status !== 'ok' || grant === null) {
      logEvent('approval_execution_skipped', { pending_id: record.id, status })
      await interpreter.auditEvent(AUDIT_EXECUTION, {
        action_type: record.action_type ?? null,
        pending_id: record.id,
        executed: false,
        reason: status,
      })
      return { executed: false, reason: status, observation: null }
    }
    // pre_approved=true + **原 origin** + action_id=grant id + correlation 透传重派。
    const observation = await deps.dispatch(
      {
        type: String(grant.action_type),
        params: (grant.params as Record<string, unknown>) ?? {},
      },
      {
        context: {
          // 原 origin —— 批准后的重派在**同一个** origin 下重新评估策略。
          origin: (grant.origin as DispatchOrigin | undefined) ?? 'interactive',
          runId: (grant.run_id as string | null) ?? null,
        },
        preApproved: true,
        actionId: String(grant.id),
        correlationId: (grant.correlation_id as string | null) ?? null,
      },
    )
    await interpreter.auditEvent(AUDIT_EXECUTION, {
      action_type: grant.action_type,
      pending_id: grant.id,
      correlation_id: grant.correlation_id ?? null,
      executed: true,
      success: observation.success,
      error: observation.error,
    })
    return { executed: true, reason: null, observation }
  }

  async function _reportExecution(
    contextId: string,
    record: Record<string, unknown>,
    execution: ExecutionResult,
    messageId: string | number | null | undefined,
  ): Promise<boolean> {
    let delivery: SendResult
    try {
      delivery = await _send(contextId, executionReport(record, execution), _replyRef(messageId))
    } catch (exc) {
      // 已经做完的事不因为"没说出口"而回滚
      logEvent('approval_result_report_failed', {
        pending_id: (record ?? {}).id ?? null,
        error: exc instanceof Error ? exc.name : 'Error',
      })
      return false
    }
    if (!delivery.sent) {
      logEvent('approval_result_report_failed', {
        pending_id: (record ?? {}).id ?? null,
        reason: delivery.reason,
      })
    }
    return delivery.sent
  }

  function _deadQuestion(replyTo: string | number | null | undefined, now: Date): Record<string, unknown> | null {
    const record = findPendingByQuestion(replyTo ?? null)
    if (record === null || pendingState(record, { now }) === 'live') return null
    return record
  }

  async function handleOwnerAnswer(
    answerText: string,
    opts: {
      contextId: string
      replyTo?: string | number | null
      messageId?: string | number | null
      now?: Date
    },
  ): Promise<HandleOwnerAnswerResult> {
    const contextId = opts.contextId
    const now = opts.now ?? new Date()

    const dead = _deadQuestion(opts.replyTo, now)
    if (dead !== null) {
      const delivery = await _send(contextId, EXPIRED_REPLY, _replyRef(opts.messageId))
      await interpreter.auditEvent(AUDIT_ANSWER_ROUTED, {
        outcome: 'expired',
        answer_text: answerText,
        action_type: dead.action_type ?? null,
        scope_key: resolveScopeKey(
          String(dead.action_type ?? ''), (dead.params as Record<string, unknown>) ?? {},
        ),
        pending_id: dead.id,
        state: pendingState(dead, { now }),
        executed: false,
        replied: delivery.sent,
      })
      logEvent('approval_answer_expired', { pending_id: dead.id, state: pendingState(dead, { now }) })
      return {
        outcome: 'expired',
        pending_id: String(dead.id),
        executed: false,
        replied: delivery.sent,
        scope_key: null,
      }
    }

    const pending = pendingActions({ now })
    if (pending.length === 0) return _ignored()

    const result = await interpreter.handleAnswer(answerText, {
      pendingQuestions: pending,
      ...(opts.replyTo === undefined ? {} : { replyTo: opts.replyTo }),
      now,
    })
    const outcome = result.outcome
    if (outcome === 'ignored') return _ignored()

    const record = result.question
    const pendingId = record === null ? null : (record.id === undefined ? null : String(record.id))
    let executed = false
    let replied = false

    if (outcome === 'clarify') {
      const followUp = await _send(contextId, result.clarify_text ?? '', _replyRef(opts.messageId))
      replied = followUp.sent
      if (pendingId && followUp.sent) {

        setQuestionMessageId(pendingId, followUp.message_id)
      }
    } else if (outcome === 'granted' || outcome === 'execute_once') {
      const execution = await _executeOnce(record!)
      executed = execution.executed
      // 做完就说 —— 引用他的批准，这也正是把它排除在主动打扰预算之外的东西
      // （S1A：回答 Kevin 不算打扰他）。
      replied = await _reportExecution(contextId, record ?? {}, execution, opts.messageId)
    } else if (outcome === 'denied') {
      // recordDenial（24h 静默期）已经在 handleAnswer 里发生；这里关掉队列条目
      // 并回一句短话。
      if (pendingId) resolvePending(pendingId, 'denied')
      const confirm = await _send(contextId, DENY_CONFIRM, _replyRef(opts.messageId))
      replied = confirm.sent
    }

    await interpreter.auditEvent(AUDIT_ANSWER_ROUTED, {
      outcome,
      answer_text: answerText,
      action_type: record === null ? null : (record.action_type ?? null),
      scope_key: result.scope_key,
      risk_level: result.risk_level,
      pending_id: pendingId,
      executed,
      replied,
      standing_grant_created: result.grant !== null,
    })
    logEvent('approval_answer_routed', { outcome, pending_id: pendingId, executed })
    return { outcome, pending_id: pendingId, executed, replied, scope_key: result.scope_key }
  }

  return { requestApproval, handleOwnerAnswer, executionReport }
}
