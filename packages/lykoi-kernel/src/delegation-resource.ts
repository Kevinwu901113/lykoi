import {
  DelegationLedger,
  MAX_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH,
  assertDelegatable,
  auditSessionId,
} from './delegation.ts'
import type { ResourceHandler } from './dispatch.ts'

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
