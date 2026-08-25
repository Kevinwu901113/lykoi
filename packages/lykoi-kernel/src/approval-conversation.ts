/**
 * 对话式审批接线（WO-S3）—— 「她需要一个 yes」与 Kevin 的聊天之间的那根线
 * （kernel/approval_conversation.py 逐字对拍；SK-30..35 / S-61..S-63）。
 *
 * 在这个模块之前，对话式审批的两半都已存在，而且哪一半都没接到任何东西上：
 *
 * * `dispatch` 返回 `needs_approval`，调用方把它记进日志 —— 从没有人问过 Kevin；
 * * `approval_interpreter.handleAnswer` 能读懂一个答复，但只有测试调用过它，
 *   而且没有任何 pending 记录带着 `question_message_id` 供一次 reply-to 解析。
 *
 * 两条腿住在这里，也只住在这里：
 *
 * * `requestApproval` —— **问的一腿**。动作需要一个 yes → 把它说成一句话 → 发给
 *   已绑定的所有者 → 把待批动作连同问句那条消息的 id 一起记下来。
 * * `handleOwnerAnswer` —— **答的一腿**。所有者说了句话 → 把它归属到一条问句 →
 *   判读 → 执行 / 追问 / 记下这次拒绝。
 *
 * **为什么在这里而不在 dispatch**。`dispatch` 是一个动作进、一个观察出；它没有
 * 所有者、没有对话，也不知道问句该落在哪个聊天里。问是一个**对话作用域**的行为
 * —— 它需要一个 `context_id`，并且它自己发出另一个动作（`messenger.send`）。把它
 * 塞进 `dispatch` 会让一次 dispatch 调用递归地执行另一次 dispatch，而那正是本模块
 * 绝不能造出来的那个环。所以 `dispatch` 继续返回 `needs_approval`（一个字没改），
 * 而**拥有一场对话的调用方** —— 今天是 Telegram 设备 —— 把那个观察交给
 * `requestApproval`。
 *
 * **分层**。本模块永不 import 资源。它发出的每条消息都以
 * `dispatch(Action("messenger.send", ...))` 出去，所以她的问句、追问和回执继承与
 * 她做的其它一切相同的审批门、不可变审计与打扰预算。`dispatch` 保持是唯一碰资源
 * 实现的模块。
 *
 * **没有递归（success criterion 6 / S-63）**。从这里发出的 `messenger.send` 永不
 * 会自己被升级成一句新问句。若那次发送回来是 `needs_approval`（即缺了 §2b 的所有
 * 者预授权），本模块记下"这句问句送不出去"然后**停止**。一次问因此永远生不出
 * 第二次问。
 *
 * **发送失败的原子性 —— 先发后排（SK-30 / S-61）**。两个失败方向不对称：
 *
 * * *排了但没发出去* —— 队列里挂着一条没人被问过的问题。它一直待到 TTL 过期，更
 *   糟的是 `pendingActions()` 会数它：Kevin 现在给出的**每一个别的**答复都会解析
 *   成 `ambiguous_multiple`，因为有两条悬置问题而他只看得见一条。一条未送达的
 *   问句毒化每一条真问句的消歧。
 * * *发了但没排上* —— Kevin 看见一句背后没有记录的问句。它的代价是一条让人困惑
 *   的消息，被限定在那一次交流里，而且在它发生的那一刻就可被检测（enqueue 抛了），
 *   所以我们可以在下一行把它撤回。
 *
 * 所以顺序是：查有没有一条一模一样的问题已经悬着 → 发 → 排；发送失败意味着动作被
 * 拒（deny-by-default，不排队，入账），排队失败则发一条撤回，好让 Kevin 不至于
 * 干等一条已经不存在的问句。剩下那个真正无从挽回的窗口（撤回本身也失败）入账，
 * 并且**不留任何队列条目** —— 失败方向仍然是"她不做这件事"。
 *
 * Python→TS 形态适配：模块级 `dispatch` import → `createApprovalConversation`
 * 工厂注入（新体 dispatch 是 `createDispatch(deps)` 的产物，没有模块级单例）。
 */
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
/** 16 字，sha256 77da6f54…（GK-5 定案：对 denied 也说"过期"，**照抄不加宽**）。 */
export const EXPIRED_REPLY = '那条已经过期了, 要我重新问吗?'

// --- WO-FIX-APPROVAL-UX ①：执行完主动回报 ------------------------------------
// 2026-08-12：Kevin 批了一条 `terminal.exec`，它跑了，然后她什么也没说。
// `granted`/`execute_once` 是四个分支里**唯一**从不开口的那个 —— clarify 发追问、
// denied 发确认、expired 说明情况，而真的**做了事**的那个分支把自己的观察丢在了
// 地上。他不得不再发一条消息才知道发生了什么。做完了就说一声, 并且把结果带出来。
/** 28 字，sha256 5598a0de…。 */
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
      actionId?: string | null
      correlationId?: string | null
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
  const trimmed = text.replace(/\s+$/, '') // Python str.rstrip()
  const chars = [...trimmed]
  if (chars.length <= RESULT_MAX_CHARS) return trimmed
  return chars.slice(0, RESULT_MAX_CHARS).join('')
    + RESULT_TRUNCATED.replace('{n}', String(RESULT_MAX_CHARS))
}

/**
 * 一次观察里值得给他看的那部分（SK-33 取值序）。已知的携带结果的键优先（一条
 * shell 命令的 stdout/stderr 正是他要的东西），然后才是朴素 dump —— 永不空手，
 * 也永不无界。
 */
export function _resultBody(data: unknown): string {
  if (data === null || data === undefined) return ''
  if (typeof data === 'string') return _truncate(data)
  // 非 dict 一律走"能读的那个形态"：数组/其它容器用 JSON（Python 的 str(list)
  // 对应物），标量用 String。Observation.data 的类型面本来就是 dict，这两支是
  // 防御位 —— 但防御位也不许把东西渲染成 "[object Object]"。
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

/**
 * 一句话 + 输出（SK-33 四分支）。用问句被问出去时的**同一个** `describeAction`
 * 构建，于是「做完了」点的正是他说 yes 的那件事。
 */
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

/**
 * 装配审批对话机。dispatch 注入（Python 是模块级 import；新体 dispatch 由
 * `createDispatch(deps)` 造出来，所以两条腿共享调用方递进来的那一个）。
 */
export function createApprovalConversation(deps: ApprovalConversationDeps): ApprovalConversation {
  /**
   * 一条出站消息，作为她自己的 `messenger.send` 动作（SK-31）。
   *
   * 返回 `{sent, message_id, reason}`。任何一种拒绝 —— 策略 `ask`/`deny`、打扰
   * 节流、传输错误 —— 在这里都是一个正常结局，**永不是一句新的审批问句**
   * （criterion 6 / S-63）。
   *
   * WO-U3 ② / P1 E1：这个漏斗是**审批机器自己的嘴**，所以每条经它离开的消息都
   * 带 E1 章 —— 免对话门，全量入 audit。今天这个章什么也没改变（判据②d 实测：
   * 这次发送对 live 规则已经解析成 `allow`）；它在 U3 的开关把「说」变成一个
   * decide-信封动作的那一刻起承重，因为那时一句没盖章的问句会对自己 gate。
   * 结构来源标记：盖章的是**这条代码路径**，不是问句的内容。
   */
  async function _send(contextId: string, text: string, replyTo: string | null): Promise<SendResult> {
    const observation = await deps.dispatch(
      { type: 'messenger.send', params: { text, context_id: contextId, reply_to: replyTo } },
      { context: { origin: 'interactive', exemption: approvalMachinery() } },
    )
    const data = (typeof observation.data === 'object' && observation.data !== null)
      ? observation.data as Record<string, unknown>
      : {}
    if (!observation.success) {
      const reason = data.needs_approval
        ? 'needs_approval'
        : (observation.error || 'send_failed')
      // 刻意终止：问的这条路不问它自己的问（S-63）。
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

  // --- 问的一腿（SK-30） -----------------------------------------------------

  /**
   * 就一个她还不能做的动作问所有者。
   *
   * 返回 `{status, pending_id, question_message_id, scope_key}`，`status` 是：
   *
   * * `asked`           —— 问句已送达、动作已排队、等他；
   * * `already_pending` —— 一条一模一样的问句已经悬着；
   * * `quiet_period`    —— 他在 `approval.DENIAL_QUIET_H` 内拒过这个范围；
   *   不再追着问（approval_model_v1 §3）；
   * * `send_failed`     —— 够不着他 → 动作被拒；
   * * `enqueue_failed`  —— 问句已撤回 → 动作被拒。
   *
   * **每一个非 `asked` 状态都意味着动作不跑。从这里没有任何执行出口。**
   */
  async function requestApproval(
    actionType: string,
    params: Record<string, unknown>,
    opts: {
      contextId: string
      replyTo?: string | null
      origin?: string
      runId?: string | null
      actionId?: string | null
      correlationId?: string | null
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
    if (scopeKey && recentDenial(actionType, scopeKey) !== null) {
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
    const delivery = await _send(contextId, text, replyTo)
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
        runId: opts.runId ?? null,
        questionMessageId: delivery.message_id,
        questionText: text,
      })
    } catch (exc) {
      // 一个写不下去的队列 = 一句必须收回的问句（S-62）。
      logEvent('approval_enqueue_failed', {
        action_type: actionType, error: exc instanceof Error ? exc.message : String(exc),
      })
      await _send(
        contextId,
        RETRACT_TEMPLATE.replace('{reason}', exc instanceof Error ? exc.name : 'Error'),
        replyTo,
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

  // --- 答的一腿（SK-32..34） -------------------------------------------------

  /**
   * 把一个被批准的待批动作**恰好跑一次**（SK-32）。
   *
   * 原子性点是 `consumePending` 而不是这个函数：它在跨进程文件锁下（新体：单进程
   * 串行读-改-写）盖上 `consumed_at` 并拒绝第二次认领，于是两个赛跑的答复（或
   * 同一个答复到达两次）恰好产生一次执行。记录留在台账里、标成已消费 —— 丢掉它
   * 会抹掉那个让一句重复的「可以」能被认出是在答一件已了结的事的事实。
   */
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

  /**
   * 告诉他发生了什么（SK-33）。绝不让一次投递问题改写"动作已经跑过了"这个事实
   * —— 执行在这个函数被调用**之前**就已经完成并入账，所以这里的每一次失败都被
   * 记录然后吞掉。`_replyRef` 让这条回执免打扰预算。
   */
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

  /** 这个 reply-to 指着的那条**已消费/已过期/已拒绝**的问句，如果有的话（SK-34）。 */
  function _deadQuestion(replyTo: string | number | null | undefined, now: Date): Record<string, unknown> | null {
    const record = findPendingByQuestion(replyTo ?? null)
    if (record === null || pendingState(record, { now }) === 'live') return null
    return record
  }

  /**
   * 把所有者的一条消息经审批解释器路由（SK-34）。
   *
   * 调用方负责已经确定发件人**就是所有者** —— 本函数不做身份检查，也绝不能被
   * 任何其他人的消息触达（见活体 `telegram_device._handle_message`；新体设备侧
   * 承重归 W3）。
   *
   * 返回 `{outcome, pending_id, executed, replied, scope_key}`。`outcome` 是
   * `ignored`（不是在答任何东西 —— 调用方应把这条消息当作普通对话）、`expired`、
   * `clarify`、`granted`、`execute_once` 或 `denied`。除 `ignored` 以外的一切都
   * 意味着这条消息已被当作一个审批回合消费掉。
   */
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

    // dead question 最前拦（GK-5：EXPIRED_REPLY 单一文案照抄，对 denied 也说
    // "过期" —— DK-09 定案不加宽）。没有这一拦，答复被静默丢掉，而 Kevin 相信
    // 他答过了（S2 review leftover #3）。
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
        // 把追问链回**同一条** pending 动作（SK-29 问句单链）：他对这条新消息的
        // 回复必须解析到它所关于的那条问题。
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
