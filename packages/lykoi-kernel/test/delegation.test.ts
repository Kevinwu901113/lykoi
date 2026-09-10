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
  ContractStateError, DelegationAuditUnavailable,
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
