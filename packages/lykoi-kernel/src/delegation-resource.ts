/**
 * Delegation Gateway 资源薄壳 —— 委托的发起 / 查看 / 收集，走既有 dispatch 管线
 * （resources/delegation.py 逐字对拍；SK-67）。
 *
 * 冻结设计 §3.2：新资源 delegation.* 走现有 dispatch 管线 —— **自动继承**审批门
 * （approval）、immutable audit 门（fail closed）、redaction。"自动继承"这四个
 * 字是本模块存在的全部理由，也是它这么薄的理由：三道门一道都不在这里实现。
 * dispatch 在调到这里之前已经算完策略、落完 intent 审计；它们对 delegation.*
 * 生效**不是因为本模块做了什么**，而是因为 dispatch 对所有动作类型一视同仁。
 *
 * ## 分级
 *
 * - delegation.dispatch —— **硬门 (ask)**：policy core HARD_ASK_TYPES 已含它
 *   （活体取证，SK-68），她发起委托必须过审批。免询路径三件套封堵：
 *   scope.UNSCOPABLE（常设授权的 scope key 被拿掉，grantStanding 永远拒绝）、
 *   exemption.EXEMPT_ACTION_TYPES（只含 messenger.send，E 章覆盖不到委托）、
 *   HARD_ASK_TYPES（不可变那层）。
 * - delegation.status / delegation.collect —— 只读，免询。落点是
 *   approval.DELEGATION_READONLY，咨询位置与 always_allow 同层，它既翻不动
 *   always_deny，也翻不动能力面（autonomous/scheduler/delegated 早已返回）。
 *
 * ## 边界（接口位）
 *
 * 本模块**不启动任何进程、不碰 broker、不碰 secrets** —— Runner 出生环境与凭证
 * 句柄是 M5 传输面的领地。delegation.dispatch 在本波的语义因此是"把一张合同从
 * draft 推到 dispatched 并落账"，执行器接线是后续波往 dispatched 这个状态上挂
 * 的东西。这不是半成品，是设计 §5 把步 3 切成两半的那条缝。注册进 dispatch 的
 * 资源注册表由接线方决定（handler 注册表就位 = 本工厂；生产接线随 M5）。
 */
import {
  DelegationLedger,
  MAX_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH,
  assertDelegatable,
  auditSessionId,
} from './delegation.ts'
import type { ResourceHandler } from './dispatch.ts'

// 派发一张合同时，委托者（她）所处的深度。她是根，所以 0；子代理是 1。
// 本单没有任何路径能把它变成别的值 —— 见 assertDelegatable 与下面 depth 那段。
export const REQUESTER_DEPTH = 0

// 默认的委托发起方标识（设计 §3.2 requester 列: lykoi | governance）。
export const DEFAULT_REQUESTER = 'lykoi'

function _require(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (!value || typeof value !== 'string') {
    throw new Error(`delegation action requires a non-empty ${JSON.stringify(key)}`)
  }
  return value
}

/** Python `int(params.get("depth") or 0)` 对应：失败方向 = 抛（绝不静默当 0）。 */
function _depthOf(raw: unknown): number {
  if (raw === undefined || raw === null || raw === 0 || raw === '' || raw === false) return 0
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new Error(`invalid depth ${JSON.stringify(raw)}`)
    return Math.trunc(raw)
  }
  if (typeof raw === 'string' && /^-?\d+$/.test(raw.trim())) return Number.parseInt(raw.trim(), 10)
  throw new Error(`invalid depth ${JSON.stringify(raw)}`)
}

/** delegation.* 三条 handler（注册进 dispatch 资源注册表的 delegation 前缀）。 */
export function createDelegationResource(ledger: DelegationLedger): Readonly<Record<string, ResourceHandler>> {
  return {
    /**
     * 发起一次委托：建合同（draft）→ 推到 dispatched。
     *
     * 到达这里时审批门已经放行（硬门 ask，所以这一步意味着 Kevin 就**这一次**
     * 点了头）。两次状态迁移各落一条 delegation_* 审计，fail closed。
     *
     * depth 是**委托者**的深度。params 里可以带，但带上来的值只会让它更严：
     * 子代理（depth>=1）传上来的任何东西都会撞上深度闸。它不是一个可以自报为
     * 0 的字段 —— max() 是那道闸的资源侧半边：方向永远是往严。真实深度由
     * Runner 在 DispatchContext.delegation 上盖章（代码路径，不是模型输出）。
     */
    async dispatch(params) {
      const contractYaml = _require(params, 'contract_yaml')
      const agentUserId = _require(params, 'agent_user_id')
      const requester = (typeof params.requester === 'string' && params.requester) || DEFAULT_REQUESTER
      const depth = Math.max(REQUESTER_DEPTH, _depthOf(params.depth))
      assertDelegatable(depth)

      let contract = await ledger.createContract({
        requester,
        contractYaml,
        agentUserId,
        depth,
      })
      contract = await ledger.transition(contract.id, 'dispatched', { reason: 'delegation.dispatch' })
      return {
        contract_id: contract.id,
        state: contract.state,
        agent_user_id: contract.agent_user_id,
        session_id: auditSessionId(contract.id),
        // 子代理再委托的深度上限，原样回给调用方 —— 合同里写明"你不能再往下发"。
        max_delegation_depth: MAX_DELEGATION_DEPTH,
        max_child_agents: MAX_CHILD_AGENTS,
      }
    },

    /**
     * 只读：一张合同（或全部合同）的状态。免询。不带 contract_id 就列全部 ——
     * 台账规模由 Gateway 自己的合同数决定，真需要分页时加 limit 是加法。
     */
    async status(params) {
      const contractId = params.contract_id
      if (contractId) {
        const contract = ledger.getContract(String(contractId))
        if (contract === null) throw new Error(`unknown contract ${JSON.stringify(contractId)}`)
        return {
          contract,
          receipts: ledger.listReceipts(String(contractId)),
        }
      }
      const state = params.state
      return { contracts: ledger.listContracts(state ? String(state) : null) }
    },

    /**
     * 收集一张合同的执行收据：挂收据 → 把合同推到 collected。免询（只读语义的
     * 收口动作：不产生任何**外部**副作用，只把子代理已交出的证据入账）。
     *
     * verdict **不在这里写**。设计 §3.2 末句把 verdict 定为验证平面的笔；本单
     * 只把唯一写入点建好（DelegationLedger.setVerdict），资源层不给它开口子 ——
     * 否则"收集"就顺手把"判定"也做了，单写者原则（9.4）当场破。
     */
    async collect(params) {
      const contractId = _require(params, 'contract_id')
      const evidence = params.evidence
      if (evidence === undefined || evidence === null) {
        throw new Error("delegation.collect requires 'evidence'")
      }
      let contract = ledger.getContract(contractId)
      if (contract === null) throw new Error(`unknown contract ${JSON.stringify(contractId)}`)

      const receipt = await ledger.addReceipt(
        contractId,
        evidence as Record<string, unknown> | string,
      )
      // 走**合法的边**，不抄近路。状态机里没有 dispatched -> collected 这条边，
      // 因为"跑过"是一个真实发生过的阶段；证据交上来本身就证明它跑过了，所以
      // 这里把那一步显式补上，而不是在 TRANSITIONS 里开一条捷径把它抹掉。
      // 两次迁移各落一条审计（每个状态迁移一条）。
      // collected/verified/rejected/expired 上再 collect 会由状态机抛 —— 这里不猜。
      if (contract.state === 'dispatched') {
        contract = await ledger.transition(contractId, 'running', {
          reason: 'delegation.collect (evidence implies the run happened)',
        })
      }
      if (contract.state !== 'collected') {
        contract = await ledger.transition(contractId, 'collected', { reason: 'delegation.collect' })
      }
      return {
        contract_id: contractId,
        state: contract.state,
        receipt_id: receipt.id,
        verdict: receipt.verdict,
        session_id: auditSessionId(contractId),
      }
    },
  }
}
