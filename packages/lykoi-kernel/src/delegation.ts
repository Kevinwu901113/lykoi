/**
 * Delegation Gateway 合同台账 —— 状态机 + delegation_* 审计事件
 * （kernel/delegation.py 逐字对拍；SK-61..66）。
 *
 * 冻结设计 = phase2_joint_design_v1_2026-08-09.md §3.2/§3.4（2026-08-09 Kevin
 * 批复冻结）。本模块是阶段 2 步 3 的**数据面**：一张合同从 draft 走到 verified
 * 的每一步都在这里落库、并在同一步落一条不可篡改的审计。执行面（Runner 出生
 * 环境、broker 票据）是 M5 的领地，本模块一行都不碰。
 *
 * ## 为什么台账在 kernel 而不在 mind
 *
 * mind 是她的状态层 —— 调节场、关切、经验、念头，全部是"她自己的东西"。一张
 * 委托合同不是她的心理状态，它是**治理事实**：谁在什么权限边界内、代表谁、跑
 * 了什么。它的读者是审批门与审计。表本身仍落在同一个 memory.db（一个库、一条
 * 迁移链是既定纪律）—— 新体经注入的 dbPath 直连（DDL 单一出处
 * lykoi-memory/testing 的合成 fixture + 治理侧真库既有 _V15 表）。
 *
 * ## 三条硬规矩
 *
 * 1. **每一次状态迁移一条审计，写在落库之前（fail closed；SK-62）。**审计写
 *    失败 ⇒ 状态不变、抛 DelegationAuditUnavailable。方向刻意选成"账可能多于
 *    事实"（崩溃窗口里可能留下一条已记录但未提交的迁移），与 dispatch 的
 *    pre-dispatch 审计门同一个失败方向：副作用永不先于记录发生。
 *
 * 2. **非法迁移由代码拒绝，非法取值由库拒绝（SK-61 双层）。**七态 CHECK 在
 *    DDL 里，TRANSITIONS 在这里。两层都要：CHECK 挡不住 verified → running
 *    这种合法取值之间的乱跳，而纯代码状态机挡不住一个 raw sqlite shell。
 *
 * 3. **深度上限写死 1、子代理不得再委托（SK-63）。**设计 §3.4 的
 *    max_child_agents 首版 = 0。这不是"默认值"而是一道**闸**：
 *    assertDelegatable 对 depth >= 1 的委托者直接拒绝，"子代理再发起委托"这条
 *    路在数据面上根本不存在。
 *
 * ## 审计 session id（SK-66）
 *
 * 设计 §3.1 要求 "session id 全程携带"。**不新增列**（两张表逐字照 §3.2），
 * session id 由 contract_id 确定性派生（auditSessionId）：永远可从任一条审计
 * 行反推回合同；不可能与合同不一致（没有第二份真相）；broker 票据绑
 * contract_id 拿到的正是同一个键。
 */
import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { ImmutableAuditSink } from './dispatch.ts'
import { logEvent } from './telemetry.ts'

// --- 状态机 (设计 §3.2 的七态 CHECK；SK-61) -----------------------------------

export const STATES: readonly string[] = [
  'draft', 'dispatched', 'running', 'collected', 'verified', 'rejected', 'expired',
]

// 合法迁移。读法：key 是当前态，value 是允许去的下一态。
//
// 主干是设计 §3.2 CHECK 的书写顺序 draft -> dispatched -> running -> collected
// -> verified，每一级都可以横向掉进 rejected（复核不过 / owner 撤销）或 expired
// （合同过期）。三个终态没有出边 —— 一张判过的合同不会复活，重来是**新合同**
// （新的 contract_id、新的审批、新的审计 session）。
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

// --- 深度闸 (设计 §3.4 防镀金；SK-63) -----------------------------------------
// max_child_agents 首版 = 0：子代理不得再委托。MAX_DELEGATION_DEPTH 是同一件事
// 在 depth 轴上的表达 —— 她（depth 0）可以委托出 depth 1；depth 1 的子代理再
// 委托会撞上 assertDelegatable。
export const MAX_DELEGATION_DEPTH = 1
export const MAX_CHILD_AGENTS = 0

// 子代理身份行的角色。users.role 的 CHECK 枚举（迁移 _V10，设计 §2.1）里本来
// 就有它 —— 对 users **一列不加**。
export const AGENT_ROLE = 'agent'

/** 委托台账的基类异常。 */
export class DelegationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationError'
  }
}

/** 非法的状态迁移（取值合法但这一步走不通），或对终态的再迁移。 */
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

/** 不可篡改审计写不进去 —— 状态**不迁移**（fail closed）。 */
export class DelegationAuditUnavailable extends DelegationError {
  constructor(message: string) {
    super(message)
    this.name = 'DelegationAuditUnavailable'
  }
}

function _nowIso(): string {
  return new Date().toISOString() // realtime-allow: governance audit stamp, real wall-clock
}

/**
 * 这张合同的审计 session id（设计 §3.1 "session id 全程携带"；SK-66）。
 * 确定性派生，不落列：任一条 delegation_* 审计行都能反推回合同，且不可能与
 * 合同不一致。broker 票据绑 contract_id 时拿到的是同一个键。
 */
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
  /** immutable sink（lykoi-audit 注入）；null = 每次迁移 fail closed 抛。 */
  sink: ImmutableAuditSink | null
}

/**
 * 台账句柄（活体是模块级函数 + 每调用开关连接；新体单进程持一条连接，C-01
 * 口径：foreign_keys ON / busy_timeout 10000 / 显式 BEGIN IMMEDIATE）。
 */
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

  /** C-02：显式 BEGIN IMMEDIATE → COMMIT，异常 ROLLBACK 后原样再抛。 */
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

  /**
   * 落一条 delegation_* 事件到注入的 immutable sink。**fail closed**（SK-62）。
   *
   * 事件名是**数据**不是枚举 —— sink 收任意 record 并 JSON 序列化（对新事件类
   * 零改动可用）。与 dispatch._immutableAudit 的差别只有一个：那边返回 bool 交
   * 调用方决定，这边直接抛。原因是这里没有"降级继续跑"的合理形态 —— 一次没有
   * 记录的状态迁移就是一条凭空出现的合同历史。
   */
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
      // 预期内的 sink 故障（权限/磁盘/append-only 拒绝）→ fail closed；
      // 编程错误照常传播（与 dispatch SK-09 同一分界）。
      if (exc instanceof Error && typeof (exc as NodeJS.ErrnoException).code === 'string') {
        logEvent('audit_unavailable', { stage: event, contract_id: contractId, error: exc.message })
        throw new DelegationAuditUnavailable(`${event}: ${exc.message}`)
      }
      throw exc
    }
  }

  // --- 子代理身份 (设计 §2.1；users 表既有，一列不加；SK-64) ------------------

  /**
   * 保证 users 里有这条 role='agent' 的身份行，返回它的 id。
   *
   * §2.1 的原话：owner 与主用户是**行、不是特例代码路径** —— 子代理同理。这里
   * 写的是一条普通数据行，INSERT OR IGNORE 幂等。
   *
   * 它**不能**碰 identity_bindings：§2.1 明令 agent 角色"永远不能绑定到
   * owner/主用户已用的 channel_key"，而最稳妥的兑现方式是这条路上根本没有写
   * 绑定表的代码。子代理在审计里有身份就够了（§2.1 末句）。
   */
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

  // --- 合同 -------------------------------------------------------------------

  /**
   * 建一张 draft 合同。审计先行（delegation_contract_created）。
   *
   * depth 是**委托者**所处的深度（她 = 0），先过 assertDelegatable 再落任何
   * 东西 —— 越界的委托连一行 draft 都不留（SK-63）。
   */
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

  /**
   * 把合同推到 newState。非法迁移抛 ContractStateError（SK-61/65）。
   * 顺序是**先审计后落库**（fail closed；SK-62）：审计写不进去就不迁移。
   */
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
    // WHERE state = from_state 让这一步在库层面是 compare-and-swap（SK-65）：两个
    // 写者同时推同一张合同时，后到的那个改 0 行而不是覆盖前一个的结果。
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

  /**
   * 验证平面写 verdict（SK-65）。设计 §3.2 末句：这是 procedures.reliability 与
   * 影子 evaluation_kind 的**唯一合法数据源** —— 回填是步 4 的事，本单只把这个
   * 唯一写入点建好。一条收据只判一次（verdict 非空即拒绝改判）。
   */
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
