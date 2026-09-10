import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { PiRunner, type RunnerConfig, type RunnerReceipt } from '../src/client.ts'

async function until(runner: PiRunner, id: string, match: (r: RunnerReceipt) => boolean) {
  const end = Date.now() + 10000
  while (Date.now() < end) { const receipt = await runner.request(id, 'status'); if (match(receipt)) return receipt; await delay(30) }
  throw new Error('runner did not reach expected state')
}
function fixture(t: { after(fn: () => void): void }, prompt: string) {
  const root = mkdtempSync(join(tmpdir(), 'pi-runner-test-')), workspace = join(root, 'workspace'); mkdirSync(workspace)
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const config: RunnerConfig = { operationId: 'op-test', taskId: 'task-test', instanceId: 'A', workspace, prompt,
    command: [process.execPath, fileURLToPath(new URL('./fake-pi.ts', import.meta.url))], provider: 'fixture', model: 'fixture', timeoutMs: 15000, maxTurns: 8, agentDir: root }
  return { root, workspace, config }
}
test('host process exit and reconstruction preserves the original execution without relaunch', async t => {
  const { root, workspace, config } = fixture(t, 'report content')
  const client = new URL('../src/client.ts', import.meta.url).href
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `import { PiRunner } from ${JSON.stringify(client)}; new PiRunner(${JSON.stringify(root)}).start(${JSON.stringify(config)}, {})`])
  const restored = new PiRunner(root)
  restored.start(config, {})
  const receipt = await until(restored, config.operationId, r => r.state === 'succeeded')
  assert.equal(receipt.sessionId, 'fixture-session')
  assert.equal(readFileSync(join(workspace, 'starts.txt'), 'utf8'), 'start\n')
  assert.equal(readFileSync(join(workspace, 'runner-result.txt'), 'utf8'), 'report content')
})
test('cancel waits for Pi to report idle and retains a confirmed cancellation receipt', async t => {
  const { root, workspace, config } = fixture(t, 'slow'), runner = new PiRunner(root)
  runner.start(config, {})
  await until(runner, config.operationId, r => r.state === 'running' && Boolean(r.sessionId))
  const cancelled = await runner.request(config.operationId, 'cancel')
  assert.equal(cancelled.state, 'cancelled')
  assert.equal((await new PiRunner(root).request(config.operationId, 'status')).state, 'cancelled')
  assert.equal(readFileSync(join(workspace, 'starts.txt'), 'utf8'), 'start\n')
})

test('actual Runner registration inherits approval gate and writes one real delegation receipt', async t => {
  const { createStateFixture } = await import('lykoi-memory/testing')
  const { DelegationLedger, createDispatch } = await import('lykoi-kernel')
  const { CapabilityRuntime } = await import('lykoi-runtime')
  const { runnerCapabilities } = await import('../src/index.ts')
  const { root, workspace, config } = fixture(t, 'ledger report'), db = join(root, 'memory.db')
  createStateFixture(db)
  const sink = { record: async () => {} }, ledger = new DelegationLedger({ dbPath: db, sink }), runner = new PiRunner(root)
  t.after(() => ledger.close())
  const runtime = new CapabilityRuntime(() => {}, { version: 1, id: 'A', origin: 'created', createdAt: new Date().toISOString(), definitionHash: 'test', personaPath: 'test', stateRoot: root })
  let charges = 0
  const charged = new Set<string>()
  runtime.register({ organId: 'pi', sideEffects: [], capabilities: runnerCapabilities(runner, ledger,
    { ...config, root, dbPath: db, credentialEnv: [], budgetRoute: 'fixture' }, { gate: async () => {}, usage: () => ({ day: '', totalTokens: 0, routeTokens: 0 }), charge: async input => { if (!charged.has(input.receiptId!)) { charged.add(input.receiptId!); charges++ } } }) })
  const dispatch = createDispatch({ sink, resources: runtime.resources }), action = { type: 'delegation.dispatch', params: { prompt: config.prompt } }
  assert.equal((await dispatch(action, { context: { origin: 'interactive' } })).error, 'needs_approval')
  assert.equal(ledger.listContracts().length, 0)
  const started = await dispatch(action, { preApproved: true, context: { origin: 'interactive', execution: { instanceId: 'A', taskId: config.taskId, operationId: config.operationId, workspace } } })
  assert.equal(started.success, true); assert.equal(started.data.pending, true)
  await until(runner, config.operationId, r => r.state === 'succeeded')
  const status = await runtime.invoke('delegation.status', { contract_id: config.operationId }) as { receipts: unknown[] }
  await runtime.invoke('delegation.collect', { contract_id: config.operationId })
  assert.equal(status.receipts.length, 1); assert.equal(charges, 1)
  assert.equal(ledger.getContract(config.operationId)!.state, 'collected')
  assert.equal(ledger.listReceipts(config.operationId)[0]!.verdict, null, 'Pi exit does not certify the user goal')
})
