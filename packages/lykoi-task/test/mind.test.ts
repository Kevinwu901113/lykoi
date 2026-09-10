import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MindStore } from 'lykoi-runtime/mind'
import { TaskStore } from '../src/store.ts'
import { TaskRuntime } from '../src/runtime.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

test('outbox survives a receiver failure and crash after receipt; source and delivery remain independent', t => {
  const root = mkdtempSync(join(tmpdir(), 'task-mind-'))
  const store = new TaskStore(join(root, 'tasks.sqlite'), 'A', join(root, 'tasks')), mind = new MindStore(join(root, 'mind.sqlite'))
  t.after(() => { store.close(); mind.close(); rmSync(root, { recursive: true, force: true }) })
  const task = store.create({ goal: '自主研究', origin: 'autonomous', thoughtId: 'question', reason: '需要第二案例' })
  store.edit(task.id, current => { current.status = 'completed'; current.checkpoint = '第二案例不支持原假设' })
  assert.throws(() => store.relay(event => { mind.receive(event); throw new Error('crash after receipt') }), /crash/)
  store.relay(event => mind.receive(event))
  assert.equal(mind.view().events.length, 1)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_outbox').get()!.n, 0)
  assert.equal(store.get(task.id).origin, 'autonomous')
  assert.equal(store.get(task.id).delivery, null)
})
test('independent tasks run concurrently; cancelling one keeps its late result from completing it', async t => {
  const root = mkdtempSync(join(tmpdir(), 'parallel-tasks-')), store = new TaskStore(join(root, 'tasks.sqlite'), 'A', root)
  const started = new Set<string>(), both = deferred(), release = deferred()
  const runtime = new TaskRuntime(store, { maxActions: 1, intervalMs: 1000,
    reason: async ({ task }) => {
      started.add(task.id); if (started.size === 2) both.resolve()
      await release.promise
      return { kind: 'finish', result: { status: 'completed', checkpoint: 'verified', content: 'actual result', artifacts: [] } }
    }, dispatch: async () => { throw new Error('no external actions') },
  })
  t.after(async () => { release.resolve(); await runtime.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const a = store.create({ goal: 'A' }), b = store.create({ goal: 'B', origin: 'autonomous' })
  assert.notEqual(a.workspace, b.workspace)
  const scan = runtime.scan(); await both.promise
  await runtime.control(a.id, 'cancel'); release.resolve(); await scan
  assert.equal(store.get(a.id).status, 'cancelled')
  assert.equal(store.get(b.id).status, 'completed')
  assert.equal(store.get(b.id).delivery, null)
})
