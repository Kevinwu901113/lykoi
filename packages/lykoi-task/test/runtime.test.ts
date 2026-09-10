import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TaskStore } from '../src/store.ts'
import { TaskRuntime, type TaskDependencies } from '../src/runtime.ts'

function fixture(t: { after(fn: () => void): void }, overrides: Partial<TaskDependencies> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-')), db = join(root, 'memory.db')
  new DatabaseSync(db).close()
  const store = new TaskStore(db, 'A', root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const runtime = new TaskRuntime(store, { maxActions: 2, intervalMs: 0,
    reason: async () => ({ kind: 'finish', result: { status: 'continue', checkpoint: 'one run' } }),
    dispatch: async () => ({ success: true }), ...overrides })
  return { root, db, store, runtime }
}

test('restore cannot create an empty replacement memory DB', t => {
  const { root } = fixture(t)
  assert.throws(() => new TaskStore(join(root, 'missing.db'), 'A', root), /ENOENT/)
})

test('claim is durable and exclusive across connections; instance mismatch fails', t => {
  const { store, db, root } = fixture(t)
  const task = store.create({ goal: 'research' }), other = new TaskStore(db, 'A', root)
  try {
    assert.ok(store.claim(task.id)); assert.equal(other.claim(task.id), null)
    assert.throws(() => new TaskStore(db, 'B', root), /another character/)
  } finally { other.close() }
})

test('repeat followup updates the existing work and paused tasks stay paused', async t => {
  const { store, runtime } = fixture(t)
  const a = store.create({ goal: 'research', originTurnId: 'turn' })
  await runtime.control(a.id, 'pause')
  const b = store.create({ goal: 'research', requirements: 'include tests' })
  assert.equal(a.id, b.id); assert.equal(b.status, 'paused'); assert.equal(b.revision, 2)
  await runtime.scan(); assert.equal(store.runs(a.id).length, 0)
})

test('budget ends a run, not the task; the next run sees persisted observations', async t => {
  let calls = 0
  const { store, runtime } = fixture(t, {
    maxActions: 1,
    reason: async ({ operations }) => {
      if (calls === 1 && operations.length) assert.deepEqual(operations[0]!.observation, { page: 'real result' })
      return { kind: 'act', action: { name: 'browser.read', args: {} } }
    },
    dispatch: async () => { calls++; return { page: 'real result' } },
  })
  const task = store.create({ goal: 'research' })
  await runtime.scan(); assert.equal(store.get(task.id).status, 'waiting')
  await runtime.scan(); assert.equal(calls, 2); assert.equal(store.runs(task.id).length, 2)
})

test('crash after external effect before checkpoint never blindly replays', async t => {
  let calls = 0
  const { store, runtime } = fixture(t, { dispatch: async () => { calls++; return {} } })
  const task = store.create({ goal: 'publish' }), run = store.claim(task.id)!
  store.intent(task.id, run.id, 'publish.once', {})
  await runtime.recover(); await runtime.scan()
  assert.equal(calls, 0); assert.equal(store.get(task.id).status, 'waiting')
  assert.equal(store.operations(task.id)[0]!.status, 'unknown')
})

test('recover by querying the original operation then continue with its actual result', async t => {
  let executions = 0
  const { store, runtime } = fixture(t, {
    reconcile: async op => ({ status: 'completed', observation: { originalOperation: op.id, artifact: 'report.md' } }),
    dispatch: async () => { executions++; return {} },
  })
  const task = store.create({ goal: 'write report' }), run = store.claim(task.id)!
  const op = store.intent(task.id, run.id, 'runner.start', {})
  await runtime.recover(); await runtime.scan()
  assert.equal(executions, 0); assert.equal(store.operations(task.id)[0]!.status, 'completed')
  assert.deepEqual(store.operations(task.id)[0]!.observation, { originalOperation: op.id, artifact: 'report.md' })
})

test('latest requirements invalidate a stale completion', async t => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const { store, runtime } = fixture(t, { reason: async () => {
    await gate
    return { kind: 'finish', result: { status: 'completed', checkpoint: 'old', content: 'old answer', artifacts: [] } }
  } })
  const task = store.create({ goal: 'report' }), running = runtime.advance(task.id)
  store.update(task.id, 'also cover security'); release(); await running
  assert.equal(store.get(task.id).status, 'pending'); assert.equal(store.get(task.id).delivery, null)
})

test('cancel during an action persists its late result without starting another action', async t => {
  let started!: () => void, release!: () => void, calls = 0
  const startedPromise = new Promise<void>(r => { started = r }), gate = new Promise<void>(r => { release = r })
  const { store, runtime } = fixture(t, {
    reason: async () => ({ kind: 'act', action: { name: 'file.write', args: {} } }),
    dispatch: async () => { calls++; started(); await gate; return { written: true } },
  })
  const task = store.create({ goal: 'report' }), running = runtime.advance(task.id)
  await startedPromise; await runtime.control(task.id, 'cancel'); release(); await running
  assert.equal(calls, 1); assert.equal(store.get(task.id).status, 'cancelled')
  assert.deepEqual(store.operations(task.id)[0]!.observation, { written: true })
})

test('file result is verified; delivery failure retries only delivery', async t => {
  let calls = 0, sends = 0
  const { store, runtime } = fixture(t, {
    reason: async () => { calls++; return { kind: 'finish', result: { status: 'completed', checkpoint: 'verified', content: 'report ready', artifacts: ['report.md'] } } },
    deliver: async () => { if (++sends === 1) return { state: 'failed', error: 'transport unavailable' }; return { state: 'sent', receipt: { messageId: '123' } } },
  })
  const task = store.create({ goal: 'report' }); writeFileSync(join(task.workspace, 'report.md'), 'actual content')
  await runtime.scan()
  assert.equal(store.get(task.id).status, 'completed'); assert.equal(store.get(task.id).delivery?.state, 'failed')
  assert.equal(store.get(task.id).artifacts[0]?.bytes, 14)
  runtime.retryDelivery(task.id); await runtime.scan()
  assert.equal(calls, 1); assert.equal(sends, 2); assert.equal(store.get(task.id).delivery?.state, 'sent')
})

test('unconfirmed sending on restart requires verification, not automatic resend', async t => {
  let sends = 0
  const { store, runtime } = fixture(t, { deliver: async () => { sends++; return { state: 'sent' } } })
  const task = store.create({ goal: 'report' })
  store.edit(task.id, task => { task.status = 'completed'; task.delivery = { state: 'sending', attempts: 1, content: 'done', error: null } })
  await runtime.recover(); await runtime.scan()
  assert.equal(sends, 0); assert.equal(store.get(task.id).delivery?.state, 'unknown')
  assert.throws(() => runtime.retryDelivery(task.id), /confirmed failed/)
})

test('legacy migration is repeatable, preserves due time and does not replay interrupted work', t => {
  const { store } = fixture(t)
  store.db.exec(`CREATE TABLE pending_continuations(id TEXT PRIMARY KEY, origin_turn_id TEXT, goal TEXT, state TEXT, terminal_reason TEXT, created_at TEXT, due_at TEXT);
    INSERT INTO pending_continuations VALUES('p','turn','pending goal','pending',NULL,'2026-09-10','2099-01-01T00:00:00Z');
    INSERT INTO pending_continuations VALUES('r','turn','running goal','running',NULL,'2026-09-10','2026-09-10T00:00:00Z');
    INSERT INTO pending_continuations VALUES('d','turn','delivery goal','failed','delivery_failed','2026-09-10','2026-09-10T00:00:00Z');`)
  assert.equal(store.migrateContinuations(), 3); assert.equal(store.migrateContinuations(), 0)
  assert.equal(store.list().find(t => t.goal === 'pending goal')!.wait?.until, '2099-01-01T00:00:00.000Z')
  assert.equal(store.list().find(t => t.goal === 'running goal')!.wait?.kind, 'verification')
  assert.equal(store.list().find(t => t.goal === 'delivery goal')!.wait?.kind, 'verification')
})

test('approval is persisted, deferred to background, and does not resume a pause', async t => {
  let calls = 0
  const { store, runtime } = fixture(t, {
    cancel: async () => { throw new Error('an unstarted approval has no external execution to cancel') },
    reason: async ({ operations }) => operations.some(op => op.status === 'completed')
      ? { kind: 'finish', result: { status: 'continue', checkpoint: 'command observed' } }
      : { kind: 'act', action: { name: 'terminal.exec', args: { command: 'echo hi' } } },
    dispatch: async (_action, _context, approved) => { if (!approved) return { success: false, data: { needs_approval: true } }; calls++; return { success: true, data: { output: 'hi' } } },
  })
  const task = store.create({ goal: 'command' })
  await runtime.scan(); assert.equal(store.get(task.id).wait?.kind, 'approval')
  const op = store.operations(task.id)[0]!
  await runtime.control(task.id, 'pause'); assert.ok(runtime.approve(op.id))
  await runtime.scan(); assert.equal(calls, 0)
  await runtime.control(task.id, 'resume'); await runtime.scan(); assert.equal(calls, 1)
  assert.deepEqual(store.operations(task.id)[0]!.observation, { success: true, data: { output: 'hi' } })
  assert.throws(() => runtime.approve(op.id), /not awaiting approval/)
})

test('changing requirements retires a pending approval without performing its action', async t => {
  const { store, runtime } = fixture(t, {
    reason: async () => ({ kind: 'act', action: { name: 'terminal.exec', args: {} } }),
    dispatch: async () => ({ success: false, data: { needs_approval: true } }),
  })
  const task = store.create({ goal: 'command' }); await runtime.scan()
  const op = store.operations(task.id)[0]!
  store.update(task.id, 'different work')
  assert.throws(() => runtime.approve(op.id), /not awaiting approval/)
  assert.equal(store.get(task.id).status, 'pending')
})

test('pending external work yields the task until reconciled, without another writer', async t => {
  let calls = 0, finished = false
  const { store, runtime } = fixture(t, {
    reason: async () => ({ kind: 'act', action: { name: 'runner.start', args: {} } }),
    dispatch: async () => { calls++; return { success: true, data: { pending: true } } },
    reconcile: async () => finished ? { status: 'completed', observation: { success: true, data: { artifact: 'report' } } } : { status: 'pending', detail: 'Pi is writing files' },
  })
  const task = store.create({ goal: 'report' }); await runtime.scan(); await runtime.scan()
  assert.equal(calls, 1); assert.equal(store.get(task.id).wait?.detail, 'Pi is writing files')
  finished = true; await runtime.reconcile(); assert.equal(store.get(task.id).status, 'pending')
})

test('identical failed execution is bounded across cognition runs', async t => {
  let calls = 0
  const { store, runtime } = fixture(t, {
    maxActions: 1,
    reason: async () => ({ kind: 'act', action: { name: 'broken.call', args: { same: true } } }),
    dispatch: async () => { calls++; return { success: false, error: 'unavailable' } },
  })
  const task = store.create({ goal: 'report' })
  await runtime.scan(); await runtime.scan(); await runtime.scan()
  assert.equal(calls, 2)
  assert.match((store.operations(task.id).at(-1)!.observation as { error: string }).error, /failed twice/)
})

test('actual Telegram transport rejection retries delivery without regenerating the artifact', async t => {
  const { BotApiTransport } = await import('lykoi-adapter-telegram/transport')
  let generates = 0, requests = 0
  const { root, store, runtime } = fixture(t, {
    reason: async () => { generates++; return { kind: 'finish', result: { status: 'completed', checkpoint: 'artifact checked', content: 'report ready', artifacts: ['report.md'] } } },
  })
  const before = process.env.LYKOI_TELEGRAM_UNDELIVERED
  process.env.LYKOI_TELEGRAM_UNDELIVERED = join(root, 'undelivered.json')
  t.after(() => { if (before === undefined) delete process.env.LYKOI_TELEGRAM_UNDELIVERED; else process.env.LYKOI_TELEGRAM_UNDELIVERED = before })
  const transport = new BotApiTransport({ token: 'synthetic-token', apiBase: 'https://example.invalid',
    post: async () => ++requests === 1 ? { status: 403, json: () => ({ ok: false, error_code: 403, description: 'blocked by fixture' }) }
      : { status: 200, json: () => ({ ok: true, result: { message_id: 42, date: 1 } }) },
  })
  runtime.deps.deliver = async task => {
    const result = await transport.sendMessage({ contextId: 'synthetic-owner', text: task.delivery!.content })
    return result.message_id ? { state: 'sent', receipt: result } : { state: result.ambiguous ? 'unknown' : 'failed', error: String(result.error) }
  }
  const task = store.create({ goal: 'report' }); writeFileSync(join(task.workspace, 'report.md'), 'verified file')
  await runtime.scan(); assert.equal(store.get(task.id).status, 'completed'); assert.equal(store.get(task.id).delivery?.state, 'failed')
  runtime.retryDelivery(task.id); await runtime.scan()
  assert.equal(generates, 1); assert.equal(requests, 2); assert.equal(store.get(task.id).delivery?.state, 'sent')
})

test('malformed persisted operation cannot disappear into an empty recovery', async t => {
  const { store, runtime } = fixture(t), task = store.create({ goal: 'publish' }), run = store.claim(task.id)!
  const op = store.intent(task.id, run.id, 'publish.once', {})
  store.db.prepare('UPDATE task_operations SET document=? WHERE id=?').run(JSON.stringify({ ...op, status: 'oops' }), op.id)
  await assert.rejects(() => runtime.recover(), /invalid persisted operation/)
  assert.equal(store.get(task.id).status, 'running')
})

test('invalid model wait is rejected without corrupting the task row', async t => {
  const { store, runtime } = fixture(t, { reason: async () => ({ kind: 'finish', result: { status: 'waiting', checkpoint: 'done step', wait: { kind: 'invented', detail: '??' } } } as never) })
  const task = store.create({ goal: 'research' }); await runtime.scan()
  assert.equal(store.get(task.id).status, 'failed')
  assert.match(store.get(task.id).failure!, /invalid persisted task wait/)
})

test('recovery keeps the newer cancellation result instead of stale running progress', async t => {
  const { store, runtime } = fixture(t, {
    reconcile: async () => ({ status: 'pending', detail: 'still running when queried' }),
    cancel: async (op, task) => {
      store.saveOperation({ ...op, status: 'completed', observation: { cancelled: true } })
      store.edit(task.id, current => { current.wait!.detail = 'stop confirmed' })
    },
  })
  const task = store.create({ goal: 'run work' }), run = store.claim(task.id)!
  const op = store.intent(task.id, run.id, 'runner.start', {})
  store.edit(task.id, current => {
    current.status = 'cancelled'
    current.wait = { kind: 'operation', operationId: op.id, detail: 'stopping' }
  })
  await runtime.recover()
  assert.equal(store.get(task.id).status, 'cancelled')
  assert.equal(store.get(task.id).wait!.detail, 'stop confirmed')
  assert.deepEqual(store.operation(op.id)!.observation, { cancelled: true })
})
