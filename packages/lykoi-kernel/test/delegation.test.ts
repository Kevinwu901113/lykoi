/**
 * 委托台账（SK-61..66）+ 资源薄壳（SK-67）：七态 CHECK+TRANSITIONS 双层、审计
 * 先行 fail closed、深度闸、ensure_agent_user、CAS、set_verdict 唯一写入点、
 * dsess_ 派生；薄壳三道门全继承（经真 dispatch 的 e2e）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import {
  ContractStateError, createDelegationResource, createDispatch, DelegationAuditUnavailable,
  DelegationDepthError, DelegationError, DelegationLedger, MAX_CHILD_AGENTS,
  MAX_DELEGATION_DEPTH, STATES, TERMINAL_STATES, TRANSITIONS, assertDelegatable,
  auditSessionId, newContractId,
} from '../src/index.ts'
import { fakeSink, ioError, isolateKernelState, type FakeSink } from './fixture.ts'

function makeLedger(): { ledger: DelegationLedger; sink: FakeSink; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-kernel-delegation-'))
  const dbPath = join(dir, 'state.db')
  createStateFixture(dbPath)
  const sink = fakeSink()
  const ledger = new DelegationLedger({ dbPath, sink })
  return { ledger, sink, dbPath }
}

function rawCount(dbPath: string, table: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
  } finally {
    db.close()
  }
}

test('SK-61：七态 + 迁移表双层 —— collected 后无 expired 边、三终态无出边；库层 CHECK 挡非法取值', async () => {
  const { ledger, dbPath } = makeLedger()
  assert.deepEqual([...STATES], ['draft', 'dispatched', 'running', 'collected', 'verified', 'rejected', 'expired'])
  assert.deepEqual(new Set(TERMINAL_STATES), new Set(['verified', 'rejected', 'expired']))
  assert.ok(!TRANSITIONS.collected!.has('expired')) // 待判的收据必须被判
  for (const state of TERMINAL_STATES) assert.equal(TRANSITIONS[state]!.size, 0)
  const contract = await ledger.createContract({ requester: 'lykoi', contractYaml: 'task: x', agentUserId: 'agent_a' })
  // 代码层：合法取值之间的乱跳被 TRANSITIONS 挡（draft → running 不通）。
  await assert.rejects(ledger.transition(contract.id, 'running'), ContractStateError)
  await assert.rejects(ledger.transition(contract.id, 'nonsense'), ContractStateError)
  await assert.rejects(ledger.transition('dc_missing', 'dispatched'), ContractStateError)
  // 库层：CHECK 挡非法取值（raw sqlite shell 也进不来）。
  const db = new DatabaseSync(dbPath)
  try {
    assert.throws(() => {
      db.prepare(
        "INSERT INTO delegation_contracts (id, requester, contract_yaml, state, agent_user_id, created_at, updated_at) VALUES ('dc_bad','lykoi','x','bogus','agent_a','t','t')",
      ).run()
    }, /CHECK/i)
  } finally {
    db.close()
  }
  // 终态无出边（错误信息带 terminal state）。
  await ledger.transition(contract.id, 'rejected', { reason: 'test' })
  await assert.rejects(ledger.transition(contract.id, 'dispatched'), /terminal state/)
  ledger.close()
})

test('SK-62：每次迁移一条审计**写在落库之前** fail closed —— sink 坏则状态不变、连 draft 不留', async () => {
  const { ledger, sink, dbPath } = makeLedger()
  sink.failWith = ioError()
  await assert.rejects(
    ledger.createContract({ requester: 'lykoi', contractYaml: 'task: x', agentUserId: 'agent_a' }),
    DelegationAuditUnavailable,
  )
  assert.equal(rawCount(dbPath, 'delegation_contracts'), 0) // 账写不进去 → 库一行不落
  sink.failWith = null
  const contract = await ledger.createContract({ requester: 'lykoi', contractYaml: 'task: x', agentUserId: 'agent_a' })
  sink.failWith = ioError()
  await assert.rejects(ledger.transition(contract.id, 'dispatched'), DelegationAuditUnavailable)
  assert.equal(ledger.getContract(contract.id)!.state, 'draft') // 状态不迁移
  // sink=null 同判。
  const nullLedger = new DelegationLedger({ dbPath, sink: null })
  await assert.rejects(nullLedger.transition(contract.id, 'dispatched'), DelegationAuditUnavailable)
  nullLedger.close()
  // 恢复后审计序：created → state_changed（先账后库）。
  sink.failWith = null
  await ledger.transition(contract.id, 'dispatched', { reason: 'go' })
  assert.deepEqual(sink.records.map((r) => r.type), ['delegation_contract_created', 'delegation_state_changed'])
  const changed = sink.records[1]!
  assert.equal(changed.from_state, 'draft')
  assert.equal(changed.to_state, 'dispatched')
  assert.equal(changed.session_id, auditSessionId(contract.id))
  ledger.close()
})

test('SK-63：depth 闸 MAX_DEPTH=1/MAX_CHILD=0；越界连 draft 都不留；非法 depth 抛', async () => {
  assert.equal(MAX_DELEGATION_DEPTH, 1)
  assert.equal(MAX_CHILD_AGENTS, 0)
  assertDelegatable(0) // 她（根）可以委托
  assert.throws(() => assertDelegatable(1), DelegationDepthError) // 子代理不得再委托
  assert.throws(() => assertDelegatable(-1), DelegationDepthError)
  assert.throws(() => assertDelegatable(1.5), DelegationDepthError)
  assert.throws(() => assertDelegatable(true as unknown as number), DelegationDepthError)
  const { ledger, sink, dbPath } = makeLedger()
  await assert.rejects(
    ledger.createContract({ requester: 'lykoi', contractYaml: 'x', agentUserId: 'agent_a', depth: 1 }),
    DelegationDepthError,
  )
  assert.equal(rawCount(dbPath, 'delegation_contracts'), 0)
  assert.equal(sink.records.length, 0) // 闸在审计之前：无账无库
  ledger.close()
})

test('SK-64：ensure_agent_user 幂等建 agent 行；既有非 agent 行拒绝；无 identity_bindings 写路径', () => {
  const { ledger, dbPath } = makeLedger()
  assert.equal(ledger.ensureAgentUser('agent_x', '侦查代理'), 'agent_x')
  assert.equal(ledger.ensureAgentUser('agent_x'), 'agent_x') // INSERT OR IGNORE 幂等
  // fixture 里 user_001 是 owner_primary —— 拿来当子代理用 = 拒绝。
  assert.throws(() => ledger.ensureAgentUser('user_001'), DelegationError)
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    const row = db.prepare("SELECT role FROM users WHERE id = 'agent_x'").get() as { role: string }
    assert.equal(row.role, 'agent')
    // 绑定表零行：这条路上根本没有写绑定表的代码（§2.1）。
    const n = (db.prepare('SELECT COUNT(*) AS n FROM identity_bindings').get() as { n: number }).n
    assert.equal(n, 0)
  } finally {
    db.close()
  }
  ledger.close()
})

test('SK-65：transition 库层 CAS；set_verdict 唯一写入点一判不改', async () => {
  const { ledger, dbPath } = makeLedger()
  const contract = await ledger.createContract({ requester: 'lykoi', contractYaml: 'x', agentUserId: 'agent_a' })
  await ledger.transition(contract.id, 'dispatched')
  // 并发失手模拟：绕过台账把状态改走 → CAS 改 0 行 → ContractStateError。
  const db = new DatabaseSync(dbPath)
  const flip = () => db.prepare(
    "UPDATE delegation_contracts SET state = 'running' WHERE id = ?",
  ).run(contract.id)
  try {
    // getContract 读到 dispatched 之后、UPDATE 之前状态被并发改走的窗口，用
    // 预先翻库模拟：transition 里 WHERE state='dispatched' 匹配不上。
    flip()
    await assert.rejects(ledger.transition(contract.id, 'running'), /moved out of|illegal transition/)
  } finally {
    db.close()
  }
  // 收据与 verdict。
  const receipt = await ledger.addReceipt(contract.id, { output: 'done' })
  assert.equal(receipt.verdict, null)
  const judged = await ledger.setVerdict(receipt.id, 'accepted')
  assert.equal(judged.verdict, 'accepted')
  await assert.rejects(ledger.setVerdict(receipt.id, 'rejected'), /already carries verdict/)
  await assert.rejects(ledger.setVerdict(receipt.id, 'maybe'), /unknown verdict/)
  await assert.rejects(ledger.setVerdict('rc_missing', 'accepted'), /unknown receipt/)
  // 坏 evidence 早抛（库 CHECK 之前说清楚）。
  await assert.rejects(ledger.addReceipt(contract.id, '{not json'), /not valid JSON/)
  ledger.close()
})

test('SK-66：audit_session_id = dsess_{contract_id} 确定性派生；id 形态 dc_/rc_', () => {
  assert.equal(auditSessionId('dc_abc'), 'dsess_dc_abc')
  assert.match(newContractId(), /^dc_[0-9a-f]{32}$/)
})

test('SK-67：资源薄壳 —— dispatch=draft→dispatched 两迁两账；collect 走合法边；verdict 不在资源层', async () => {
  const { ledger, sink } = makeLedger()
  const resource = createDelegationResource(ledger)
  const out = await resource.dispatch!({
    contract_yaml: 'task: recon', agent_user_id: 'agent_r',
  }) as Record<string, unknown>
  assert.equal(out.state, 'dispatched')
  assert.equal(out.session_id, auditSessionId(String(out.contract_id)))
  assert.equal(out.max_delegation_depth, 1)
  assert.equal(out.max_child_agents, 0)
  assert.deepEqual(sink.records.map((r) => r.type), ['delegation_contract_created', 'delegation_state_changed'])
  // depth 取 max 不信 params：子代理自报 depth 0 没用 —— 真实深度 >= 结构默认。
  // （params.depth=1 时闸直接抛：资源侧半边。）
  await assert.rejects(
    resource.dispatch!({ contract_yaml: 'x', agent_user_id: 'agent_r', depth: 1 }),
    DelegationDepthError,
  )
  await assert.rejects(
    resource.dispatch!({ contract_yaml: 'x', agent_user_id: 'agent_r', depth: 'abc' }),
    /invalid depth/,
  )
  // 缺参拒绝。
  await assert.rejects(resource.dispatch!({ agent_user_id: 'a' }), /contract_yaml/)
  // collect：dispatched → running → collected 两条合法边、每迁一账；verdict 保持 NULL。
  sink.records.length = 0
  const collected = await resource.collect!({
    contract_id: out.contract_id, evidence: { log: 'ran fine' },
  }) as Record<string, unknown>
  assert.equal(collected.state, 'collected')
  assert.equal(collected.verdict, null) // 收集不顺手判定（单写者原则）
  assert.deepEqual(sink.records.map((r) => r.type), [
    'delegation_receipt_recorded', 'delegation_state_changed', 'delegation_state_changed',
  ])
  // status 只读。
  const status = await resource.status!({ contract_id: out.contract_id }) as Record<string, unknown>
  assert.equal((status.contract as Record<string, unknown>).state, 'collected')
  assert.equal((status.receipts as unknown[]).length, 1)
  const all = await resource.status!({}) as Record<string, unknown>
  assert.equal((all.contracts as unknown[]).length, 1)
  await assert.rejects(resource.collect!({ contract_id: out.contract_id }), /'evidence'/)
  // collected 上再 collect：只补收据、状态不动（活体语义 —— 两个 if 都跳过）。
  const again = await resource.collect!({
    contract_id: out.contract_id, evidence: { again: true },
  }) as Record<string, unknown>
  assert.equal(again.state, 'collected')
  assert.equal((await resource.status!({ contract_id: out.contract_id }) as {
    receipts: unknown[]
  }).receipts.length, 2)
  // 终态上 collect：状态机抛（不猜）—— verified→collected 不是合法边。
  await ledger.transition(String(out.contract_id), 'verified')
  await assert.rejects(
    resource.collect!({ contract_id: out.contract_id, evidence: { late: true } }),
    ContractStateError,
  )
  ledger.close()
})

test('SK-67 三道门全继承：不调薄壳任何函数，三道门也照样落在 delegation.* 上（经真 dispatch e2e）', async () => {
  isolateKernelState()
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-kernel-delegation-'))
  const dbPath = join(dir, 'state.db')
  createStateFixture(dbPath)
  // 台账与 dispatch 共用同一个 immutable sink：一条链上的账落在一处。
  const sink = fakeSink()
  const ledger = new DelegationLedger({ dbPath, sink })
  const dispatch = createDispatch({
    sink,
    resources: { delegation: createDelegationResource(ledger) },
  })
  // 硬门：delegation.dispatch 默认 ask —— handler 不跑、零合同。
  const asked = await dispatch(
    { type: 'delegation.dispatch', params: { contract_yaml: 'task: x', agent_user_id: 'agent_e' } },
    { context: { origin: 'interactive' } },
  )
  assert.equal(asked.error, 'needs_approval')
  assert.equal(ledger.listContracts().length, 0)
  // Kevin 就这一次点头（pre_approved）→ 薄壳跑、台账动、四行账
  // （intent + created + state_changed + result）。
  const approved = await dispatch(
    { type: 'delegation.dispatch', params: { contract_yaml: 'task: x', agent_user_id: 'agent_e' } },
    { context: { origin: 'interactive' }, preApproved: true },
  )
  assert.equal(approved.success, true)
  assert.equal(approved.data.state, 'dispatched')
  assert.deepEqual(sink.records.map((r) => r.type), [
    'action_dispatch', 'action_result', // ask 那次
    'action_dispatch', 'delegation_contract_created', 'delegation_state_changed', 'action_result',
  ])
  // 只读两条免询直达。
  const status = await dispatch(
    { type: 'delegation.status', params: {} },
    { context: { origin: 'interactive' } },
  )
  assert.equal(status.success, true)
  // autonomous 够不着任何 delegation.*（能力面②）。
  const denied = await dispatch(
    { type: 'delegation.status', params: {} },
    { context: { origin: 'autonomous' } },
  )
  assert.equal(denied.error, 'denied by rule')
  ledger.close()
})
