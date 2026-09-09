import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { ImmutableAuditSink } from './dispatch.ts'
import { logEvent } from './telemetry.ts'

export const STATES: readonly string[] = [
  'draft', 'dispatched', 'running', 'collected', 'verified', 'rejected', 'expired',
]

export const TRANSITIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  draft: new Set(['dispatched', 'rejected', 'expired']),
  dispatched: new Set(['running', 'rejected', 'expired']),
  running: new Set(['collected', 'rejected', 'expired']),
  // collected 之后合同已经不再执行，过期没有意义 —— 待判的收据必须被判。
  collected: new Set(['verified', 'rejected']),
  verified: new Set([]),
  rejected: new Set([]),
  expired: new Set([]),
}

export const TERMINAL_STATES: ReadonlySet<string> = new Set(
  Object.entries(TRANSITIONS).filter(([, nexts]) => nexts.size === 0).map(([state]) => state),
)

export const VERDICTS: readonly string[] = ['accepted', 'rejected']

export const MAX_DELEGATION_DEPTH = 1
export const MAX_CHILD_AGENTS = 0

export const AGENT_ROLE = 'agent'

/** 委托台账的基类异常。 */
export class DelegationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationError'
  }
}

export class ContractStateError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'ContractStateError'
  }
}

/** 委托深度越界 —— 子代理再委托（设计 §3.4 max_child_agents=0）。 */
export class DelegationDepthError extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationDepthError'
  }
}

export class DelegationAuditUnavailable extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationAuditUnavailable'
  }
}

function _nowIso(): string {
  return new Date().toISOString() // realtime-allow: governance audit stamp, real wall-clock
}

export function auditSessionId(contractId: string): string {
  return `dsess_${contractId}`
}

export function newContractId(): string {
  return `dc_${randomUUID().replaceAll('-', '')}`
}

// --- 深度闸 -------------------------------------------------------------------

/**
 * 委托者处在 depth 时，还能不能再发起一次委托？她自己是 depth 0，发出去的子
 * 代理是 depth 1。MAX_DELEGATION_DEPTH = 1 于是等价于设计 §3.4 的
 * max_child_agents = 0：depth 1 的子代理**没有**发起委托的路径 —— 不是"默认
 * 不给"而是这里直接抛。
 */
export function assertDelegatable(depth: unknown): void {
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < 0) {
    throw new DelegationDepthError(`depth must be a non-negative int, got ${JSON.stringify(depth)}`)
  }
  if (depth + 1 > MAX_DELEGATION_DEPTH) {
    throw new DelegationDepthError(
      `delegation depth ${depth + 1} exceeds MAX_DELEGATION_DEPTH=`
      + `${MAX_DELEGATION_DEPTH} (max_child_agents=${MAX_CHILD_AGENTS}: `
      + 'a delegated sub-agent may not delegate again)',
    )
  }
}

export type ContractRow = Record<string, unknown> & {
  id: string
  requester: string
  state: string
  agent_user_id: string
}

export type ReceiptRow = Record<string, unknown> & {
  id: string
  contract_id: string
  verdict: string | null
}

export interface DelegationLedgerOptions {
  /** memory.db 路径（治理侧发的可写副本；golden devstate 永远只读）。 */
  dbPath: string

  sink: ImmutableAuditSink | null
}

export class DelegationLedger {
  #db: DatabaseSync
  #sink: ImmutableAuditSink | null

  constructor(opts: DelegationLedgerOptions) {
    this.#db = new DatabaseSync(opts.dbPath)
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.#db.exec('PRAGMA busy_timeout = 10000')
    this.#sink = opts.sink
  }

  close(): void {
    this.#db.close()
  }

  #tx<T>(fn: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = fn()
      this.#db.exec('COMMIT')
      return result
    } catch (exc) {
      try {
        this.#db.exec('ROLLBACK')
      } catch {
        /* 回滚失败时原异常仍是权威 */
      }
      throw exc
    }
  }

  async #audit(event: string, contractId: string, fields: Record<string, unknown>): Promise<void> {
    const record = {
      type: event,
      ts: _nowIso(),
      contract_id: contractId,
      session_id: auditSessionId(contractId),
      ...fields,
    }
    if (this.#sink === null) {
      logEvent('audit_unavailable', { stage: event, contract_id: contractId, reason: 'audit_sink_unavailable' })
      throw new DelegationAuditUnavailable(`${event}: audit sink unavailable`)
    }
    try {
      await this.#sink.record(record)
    } catch (exc) {

      if (exc instanceof Error && typeof (exc as NodeJS.ErrnoException).code === 'string') {
        logEvent('audit_unavailable', { stage: event, contract_id: contractId, error: exc.message })
        throw new DelegationAuditUnavailable(`${event}: ${exc.message}`)
      }
      throw exc
    }
  }

  ensureAgentUser(agentUserId: string, displayName: string | null = null): string {
    this.#tx(() => {
      this.#db.prepare(
        'INSERT OR IGNORE INTO users (id, display_name, role, created_at, status) '
        + "VALUES (?,?,?,?,'active')",
      ).run(agentUserId, displayName ?? agentUserId, AGENT_ROLE, _nowIso())
    })
    const row = this.#db.prepare('SELECT role FROM users WHERE id = ?').get(agentUserId) as
      | { role: string }
      | undefined
    if (row === undefined) {
      throw new DelegationError(`agent user ${JSON.stringify(agentUserId)} could not be created`)
    }
    if (row.role !== AGENT_ROLE) {
      // 一个已存在的 owner_primary / group_member id 被拿来当子代理用 —— 拒绝。
      // 这正是 §2.1 防错映射要挡的那件事，失败方向是拒绝而不是"就用它吧"。
      throw new DelegationError(
        `user ${JSON.stringify(agentUserId)} exists with role ${JSON.stringify(row.role)}, not ${JSON.stringify(AGENT_ROLE)}`,
      )
    }
    return agentUserId
  }

  async createContract(opts: {
    requester: string
    contractYaml: string
    agentUserId: string
    depth?: number
    contractId?: string | null
  }): Promise<ContractRow> {
    const depth = opts.depth ?? 0
    assertDelegatable(depth)
    const contractId = opts.contractId ?? newContractId()
    this.ensureAgentUser(opts.agentUserId)
    const now = _nowIso()
    await this.#audit('delegation_contract_created', contractId, {
      requester: opts.requester,
      agent_user_id: opts.agentUserId,
      state: 'draft',
      depth,
      child_depth: depth + 1,
      contract_bytes: Buffer.byteLength(opts.contractYaml, 'utf8'),
    })
    this.#tx(() => {
      this.#db.prepare(
        'INSERT INTO delegation_contracts '
        + '(id, requester, contract_yaml, state, agent_user_id, created_at, updated_at) '
        + "VALUES (?,?,?,'draft',?,?,?)",
      ).run(contractId, opts.requester, opts.contractYaml, opts.agentUserId, now, now)
    })
    logEvent('delegation_contract_created', { contract_id: contractId, requester: opts.requester })
    return this.getContract(contractId)!
  }

  getContract(contractId: string): ContractRow | null {
    const row = this.#db.prepare('SELECT * FROM delegation_contracts WHERE id = ?').get(contractId)
    return row === undefined ? null : ({ ...row } as ContractRow)
  }

  listContracts(state: string | null = null): ContractRow[] {
    const rows
      = state === null
        ? this.#db.prepare('SELECT * FROM delegation_contracts ORDER BY created_at, id').all()
        : this.#db
          .prepare('SELECT * FROM delegation_contracts WHERE state = ? ORDER BY created_at, id')
          .all(state)
    return rows.map((row) => ({ ...row }) as ContractRow)
  }

  async transition(contractId: string, newState: string, opts: { reason?: string } = {}): Promise<ContractRow> {
    if (!STATES.includes(newState)) {
      throw new ContractStateError(`unknown contract state ${JSON.stringify(newState)}`)
    }
    const current = this.getContract(contractId)
    if (current === null) {
      throw new ContractStateError(`unknown contract ${JSON.stringify(contractId)}`)
    }
    const fromState = current.state
    if (!TRANSITIONS[fromState]?.has(newState)) {
      throw new ContractStateError(
        `illegal transition ${JSON.stringify(fromState)} -> ${JSON.stringify(newState)} for ${JSON.stringify(contractId)}`
        + (TERMINAL_STATES.has(fromState) ? ' (terminal state)' : ''),
      )
    }
    await this.#audit('delegation_state_changed', contractId, {
      from_state: fromState,
      to_state: newState,
      requester: current.requester,
      agent_user_id: current.agent_user_id,
      reason: opts.reason ?? '',
    })
    const now = _nowIso()

    const changed = this.#tx(() =>
      this.#db.prepare(
        'UPDATE delegation_contracts SET state = ?, updated_at = ? WHERE id = ? AND state = ?',
      ).run(newState, now, contractId, fromState).changes)
    if (!changed) {
      throw new ContractStateError(
        `contract ${JSON.stringify(contractId)} moved out of ${JSON.stringify(fromState)} concurrently`,
      )
    }
    logEvent('delegation_state_changed', { contract_id: contractId, from_state: fromState, to_state: newState })
    return this.getContract(contractId)!
  }

  // --- 执行收据 (设计 §3.2 / 19.1) ---------------------------------------------

  /** 给合同挂一条执行收据。evidence 存 JSON 文本（库上有 json_valid CHECK）。 */
  async addReceipt(
    contractId: string,
    evidence: Record<string, unknown> | string,
    opts: { receiptId?: string | null } = {},
  ): Promise<ReceiptRow> {
    const contract = this.getContract(contractId)
    if (contract === null) {
      throw new ContractStateError(`unknown contract ${JSON.stringify(contractId)}`)
    }
    const evidenceJson = typeof evidence === 'string' ? evidence : JSON.stringify(evidence)
    try {
      JSON.parse(evidenceJson)
    } catch (exc) {
      // 库的 CHECK 也会拒，但错在这里更早、更能说清楚
      throw new DelegationError(`receipt evidence is not valid JSON: ${exc instanceof Error ? exc.message : String(exc)}`)
    }
    const receiptId = opts.receiptId ?? `rc_${randomUUID().replaceAll('-', '')}`
    await this.#audit('delegation_receipt_recorded', contractId, {
      receipt_id: receiptId,
      contract_state: contract.state,
      evidence_bytes: Buffer.byteLength(evidenceJson, 'utf8'),
    })
    const now = _nowIso()
    this.#tx(() => {
      this.#db.prepare(
        'INSERT INTO execution_receipts '
        + '(id, contract_id, evidence_json, verdict, verified_at, created_at) '
        + 'VALUES (?,?,?,NULL,NULL,?)',
      ).run(receiptId, contractId, evidenceJson, now)
    })
    logEvent('delegation_receipt_recorded', { contract_id: contractId, receipt_id: receiptId })
    return this.getReceipt(receiptId)!
  }

  getReceipt(receiptId: string): ReceiptRow | null {
    const row = this.#db.prepare('SELECT * FROM execution_receipts WHERE id = ?').get(receiptId)
    return row === undefined ? null : ({ ...row } as ReceiptRow)
  }

  listReceipts(contractId: string): ReceiptRow[] {
    return this.#db
      .prepare('SELECT * FROM execution_receipts WHERE contract_id = ? ORDER BY created_at, id')
      .all(contractId)
      .map((row) => ({ ...row }) as ReceiptRow)
  }

  async setVerdict(receiptId: string, verdict: string): Promise<ReceiptRow> {
    if (!VERDICTS.includes(verdict)) {
      throw new DelegationError(`unknown verdict ${JSON.stringify(verdict)}`)
    }
    const receipt = this.getReceipt(receiptId)
    if (receipt === null) {
      throw new DelegationError(`unknown receipt ${JSON.stringify(receiptId)}`)
    }
    if (receipt.verdict !== null) {
      throw new DelegationError(
        `receipt ${JSON.stringify(receiptId)} already carries verdict ${JSON.stringify(receipt.verdict)}`,
      )
    }
    await this.#audit('delegation_receipt_verdict', receipt.contract_id, {
      receipt_id: receiptId,
      verdict,
    })
    const now = _nowIso()
    const changed = this.#tx(() =>
      this.#db.prepare(
        'UPDATE execution_receipts SET verdict = ?, verified_at = ? WHERE id = ? AND verdict IS NULL',
      ).run(verdict, now, receiptId).changes)
    if (!changed) {
      throw new DelegationError(`receipt ${JSON.stringify(receiptId)} was judged concurrently`)
    }
    logEvent('delegation_receipt_verdict', { receipt_id: receiptId, verdict })
    return this.getReceipt(receiptId)!
  }
}
