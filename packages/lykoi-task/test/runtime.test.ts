import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TaskStore } from '../src/store.ts'
import { TaskRuntime, type TaskDependencies } from '../src/runtime.ts'

function fixture(t: { after(fn: () => void): void }, overrides: Partial<TaskDependencies> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-')), db = join(root, 'tasks.sqlite')
  new DatabaseSync(db).close()
  const store = new TaskStore(db, 'A', root)
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const runtime = new TaskRuntime(store, { maxActions: 2, intervalMs: 0,
    reason: async () => ({ kind: 'finish', result: { status: 'continue', checkpoint: 'one run' } }),
    dispatch: async () => ({ success: true }), ...overrides })
  return { root, db, store, runtime }
}

test('TaskStore creates independent storage and rejects corrupt bytes', t => {
  const { root } = fixture(t)
  const path = join(root, 'new-tasks.sqlite'), created = new TaskStore(path, 'A', root)
  created.close()
  writeFileSync(path, 'not a database')
  assert.throws(() => new TaskStore(path, 'A', root), /database/)
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
  const replay = store.create({ goal: 'research', originTurnId: 'turn' })
  assert.equal(replay.id, a.id); assert.equal(replay.revision, 1)
  assert.notEqual(store.create({ goal: 'research' }).id, a.id)
  const b = store.update(a.id, 'include tests')
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
  const { store, root } = fixture(t)
  const source = new DatabaseSync(join(root, 'memory.db')); t.after(() => source.close())
  source.exec(`CREATE TABLE pending_continuations(id TEXT PRIMARY KEY, origin_turn_id TEXT, goal TEXT, state TEXT, terminal_reason TEXT, created_at TEXT, due_at TEXT);
    INSERT INTO pending_continuations VALUES('p','turn','pending goal','pending',NULL,'2026-09-10','2099-01-01T00:00:00Z');
    INSERT INTO pending_continuations VALUES('r','turn','running goal','running',NULL,'2026-09-10','2026-09-10T00:00:00Z');
    INSERT INTO pending_continuations VALUES('d','turn','delivery goal','failed','delivery_failed','2026-09-10','2026-09-10T00:00:00Z');`)
  assert.equal(store.migrateContinuations(source), 3); assert.equal(store.migrateContinuations(source), 0)
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

test('the model can repeat an identical failed action across bounded runs', async t => {
  let calls = 0
  const { store, runtime } = fixture(t, {
    maxActions: 1,
    reason: async () => ({ kind: 'act', action: { name: 'broken.call', args: { same: true } } }),
    dispatch: async () => { calls++; return { success: false, error: 'unavailable' } },
  })
  const task = store.create({ goal: 'report' })
  await runtime.scan(); await runtime.scan(); await runtime.scan()
  assert.equal(calls, 3)
  assert.equal((store.operations(task.id).at(-1)!.observation as { error: string }).error, 'unavailable')
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

test('moving old Task tables preserves operations and delivery without leaving a second task ledger', t => {
  const { root } = fixture(t), memoryPath = join(root, 'old-memory.db')
  const old = new TaskStore(memoryPath, 'A', root)
  old.db.exec("CREATE TABLE memories(content TEXT); INSERT INTO memories VALUES('unchanged')")
  const task = old.create({ goal: 'preserve me', originTurnId: 'message-1' }), run = old.claim(task.id)!
  old.intent(task.id, run.id, 'external.write', { value: 1 })
  old.edit(task.id, current => { current.delivery = { state: 'failed', content: 'ready', attempts: 1, error: 'transport' } })
  const before = { task: old.get(task.id), runs: old.runs(task.id), operations: old.operations(task.id) }
  old.close()
  const target = new TaskStore(join(root, 'independent.sqlite'), 'A', root)
  try {
    target.migrateFromMemory(memoryPath); target.migrateFromMemory(memoryPath)
    assert.deepEqual({ task: target.get(task.id), runs: target.runs(task.id), operations: target.operations(task.id) }, before)
    assert.equal(target.create({ goal: 'same request', originTurnId: 'message-1' }).id, task.id)
    const source = new DatabaseSync(memoryPath, { readOnly: true })
    try {
      assert.equal(source.prepare("SELECT content FROM memories").get()!.content, 'unchanged')
      assert.equal(source.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('persistent_tasks','task_runs','task_operations')").get()!.n, 0)
    } finally { source.close() }
  } finally { target.close() }
})

test('due work receives a live clock across runs and restart; completion delivers once', async t => {
  const start = new Date('2026-09-11T00:00:00Z'); let now = start, deliveries = 0, reasons = 0
  const seen: string[] = []
  const deps: Partial<TaskDependencies> = {
    now: () => now,
    reason: async ({ now: clock }) => {
      reasons++; seen.push(clock.toISOString())
      return clock.getTime() < start.getTime() + 60000
        ? { kind: 'finish', result: { status: 'waiting', checkpoint: 'wait without a command', wait: { kind: 'due', until: new Date(start.getTime() + 60000).toISOString(), detail: 'requested lower bound' } } }
        : { kind: 'finish', result: { status: 'completed', checkpoint: 'time reached', content: 'delayed result', artifacts: [] } }
    },
    dispatch: async () => { throw new Error('no messaging, command or file operation required') },
    deliver: async task => { assert.equal(task.delivery!.content, 'delayed result'); deliveries++; return { state: 'sent', receipt: { message_id: 'confirmed' } } },
  }
  const { store, runtime, db, root } = fixture(t, deps)
  const request = { text: 'deliver after at least sixty seconds', receivedAt: start.toISOString() }
  const task = store.create({ goal: 'deliver later', request }, start)
  await runtime.scan(); assert.equal(store.get(task.id).wait?.kind, 'due'); await runtime.close()
  const reopened = new TaskStore(db, 'A', root); t.after(() => reopened.close())
  const restored = new TaskRuntime(reopened, { ...runtime.deps, ...deps }); await restored.recover()
  assert.deepEqual(reopened.get(task.id).request, request)
  now = new Date(start.getTime() + 59999); await restored.scan(); assert.equal(reasons, 1); assert.equal(deliveries, 0)
  now = new Date(start.getTime() + 60000); await restored.scan()
  assert.deepEqual(seen, [start.toISOString(), now.toISOString()]); assert.equal(deliveries, 1)
  assert.equal(reopened.get(task.id).delivery?.state, 'sent')
  await restored.scan(); assert.equal(deliveries, 1); await restored.close()
})

test('approval request failure is persistent and observable; explicit resume retries notification, not action', async t => {
  let requests = 0, actions = 0
  const { store, runtime } = fixture(t, {
    reason: async () => ({ kind: 'act', action: { name: 'messenger.read', args: { limit: 5 } } }),
    dispatch: async () => { actions++; return { success: false, data: { needs_approval: true } } },
    requestApproval: async () => { requests++; if (requests === 1) throw new Error('transport rejected') },
  })
  const task = store.create({ goal: 'inspect when permitted' })
  await runtime.scan()
  assert.equal(store.get(task.id).wait?.kind, 'approval'); assert.match(store.get(task.id).failure!, /transport rejected/)
  await runtime.control(task.id, 'resume')
  assert.equal(requests, 2); assert.equal(actions, 1); assert.equal(store.get(task.id).failure, null)
  assert.equal(store.get(task.id).wait?.kind, 'approval'); assert.equal(store.operations(task.id)[0]!.approved, false)
})

test('registered message waits from receipt time, survives restart/resume, and delivers exact bytes once without cognition', async t => {
  let now = new Date('2026-09-11T00:00:00Z')
  const sent: string[] = []
  const deps: Partial<TaskDependencies> = { now: () => now,
    reason: async () => { throw new Error('known message must not invoke cognition') },
    dispatch: async () => { throw new Error('known message must not invoke tools') },
    deliver: async task => { sent.push(task.delivery!.content); return { state: 'sent' } } }
  const { store, root, db, runtime } = fixture(t, deps)
  const text = ' 原文🙂\r\n第二行  '
  const task = store.create({ goal: 'send later', request: { text: 'wait then send', receivedAt: now.toISOString() }, message: { text, delaySeconds: 60 } }, new Date(now.getTime() + 15000))
  assert.equal(task.wait?.until, '2026-09-11T00:01:00.000Z')
  await runtime.control(task.id, 'resume'); await runtime.scan()
  assert.equal(store.get(task.id).status, 'waiting'); assert.deepEqual(sent, [])
  await runtime.close()
  const reopened = new TaskStore(db, 'A', root), resumed = new TaskRuntime(reopened, { maxActions: 2, intervalMs: 1000, reason: deps.reason!, dispatch: deps.dispatch!, ...deps })
  try {
    await resumed.recover()
    now = new Date('2026-09-11T00:00:59.999Z'); await resumed.scan(); assert.deepEqual(sent, [])
    now = new Date('2026-09-11T00:01:00.000Z'); await resumed.scan(); await resumed.scan()
    assert.deepEqual(sent, [text]); assert.equal(reopened.get(task.id).delivery?.state, 'sent')
    assert.equal(reopened.operations(task.id).length, 0)
  } finally { await resumed.close(); reopened.close() }
})

test('cancelled scheduled message never sends; revised and ordinary goals cannot deliver old text', async t => {
  let now = new Date('2026-09-11T00:00:00Z'), reasonCalls = 0
  const sent: string[] = []
  const { store, runtime } = fixture(t, { now: () => now,
    reason: async () => { reasonCalls++; return { kind: 'finish', result: { status: 'completed', checkpoint: 'new result', content: 'new cognitive result', artifacts: [] } } },
    deliver: async task => { sent.push(task.delivery!.content); return { state: 'sent' } } })
  const message = { text: 'old', delaySeconds: 60 }
  const cancelled = store.create({ goal: 'cancel me', message }, now)
  await runtime.control(cancelled.id, 'cancel')
  assert.equal(store.get(cancelled.id).wait, null)
  const updated = store.create({ goal: 'revise me', message }, now)
  store.create({ taskId: updated.id, goal: 'new message', message: { text: 'new exact text', delaySeconds: 120 } }, now)
  const ordinary = store.create({ goal: 'change to research', message }, now)
  store.update(ordinary.id, 'research instead', undefined, now)
  now = new Date('2026-09-11T00:01:00Z'); await runtime.scan()
  assert.deepEqual(sent, ['new cognitive result'])
  now = new Date('2026-09-11T00:02:00Z'); await runtime.scan(); await runtime.scan()
  assert.deepEqual(sent, ['new cognitive result', 'new exact text']); assert.equal(reasonCalls, 1)
  assert.equal(store.get(cancelled.id).status, 'cancelled')
  assert.throws(() => store.create({ goal: 'invalid', message: { text: 'x', delaySeconds: -1 } }), /delaySeconds/)
  assert.throws(() => store.create({ goal: 'self-chosen', origin: 'autonomous', message }), /user request/)
})

test('cancelling an approval wait closes the operation; a later approval cannot run it', async t => {
  const { store, runtime } = fixture(t, { requestApproval: async () => {},
    reason: async () => ({ kind: 'act', action: { name: 'messenger.read', args: { limit: 5 } } }),
    dispatch: async () => ({ data: { needs_approval: true } }) })
  const task = store.create({ goal: 'test approval' })
  await runtime.scan(); const op = store.operations(task.id)[0]!
  await runtime.control(task.id, 'cancel')
  assert.equal(store.get(task.id).status, 'cancelled'); assert.equal(store.get(task.id).wait, null)
  assert.equal(store.operation(op.id)!.status, 'completed')
  assert.throws(() => runtime.approve(op.id), /not awaiting approval/)
})

test('owner can cancel a completed result that has not entered transport yet', async t => {
  const { store, runtime } = fixture(t)
  const task = store.create({ goal: 'known output', message: { text: 'do not send', delaySeconds: 0 } }, new Date(0))
  await runtime.scan()
  assert.equal(store.get(task.id).status, 'completed'); assert.equal(store.get(task.id).delivery?.state, 'pending')
  await runtime.control(task.id, 'cancel')
  runtime.deps.deliver = async () => assert.fail('cancelled pending output must not enter transport')
  await runtime.scan()
  assert.equal(store.get(task.id).status, 'cancelled'); assert.equal(store.get(task.id).delivery, null)
})
