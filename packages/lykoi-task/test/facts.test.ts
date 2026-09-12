import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { taskFacts } from 'lykoi-runtime/task-facts'
import { TaskStore } from '../src/store.ts'
import { TaskRuntime } from '../src/runtime.ts'
import { taskCapabilities } from '../src/index.ts'
import type { CharacterTasks } from 'lykoi-contracts'

for (const state of ['sent', 'failed', 'unknown'] as const) test(`revised scheduled facts remain accurate before and after ${state} delivery`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'task-facts-'))
  const store = new TaskStore(join(root, 'task.sqlite'), 'fixture', root)
  let now = new Date('2026-09-12T00:00:00Z')
  const runtime = new TaskRuntime(store, { maxActions: 1, intervalMs: 1000, now: () => now,
    reason: async () => { throw new Error('scheduled delivery needs no model') },
    dispatch: async () => { throw new Error('unexpected dispatch') },
    deliver: async task => { assert.equal(task.delivery?.content, 'NEW D'); return { state, receipt: state === 'sent' ? { messageId: 47 } : undefined, error: state === 'sent' ? undefined : 'fixture' } },
  })
  t.after(async () => { await runtime.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const original = store.create({ goal: 'send OLD C', message: { text: 'OLD C', delaySeconds: 120 } }, now)
  now = new Date('2026-09-12T00:00:30Z')
  const revised = store.create({ taskId: original.id, goal: 'send NEW D', message: { text: 'NEW D' } }, now)
  const caps = taskCapabilities({ get: (id: string) => store.get(id), list: () => store.list() } as unknown as CharacterTasks)
  const read = async () => await caps.find(c => c.name === 'task.get')!.handler({ id: original.id }) as ReturnType<typeof taskFacts>
  const before = await read()
  assert.equal(before.history.originalGoal, 'send OLD C')
  assert.equal('goal' in before, false)
  assert.equal(before.requirements, 'send NEW D')
  assert.equal(before.scheduledMessage?.text, 'NEW D')
  assert.equal(before.scheduledMessage?.dueAt, original.scheduledMessage?.dueAt)
  assert.equal(before.snapshot.revision, revised.revision)
  assert.equal(before.delivery, null)
  assert.deepEqual(await caps.find(c => c.name === 'task.list')!.handler({}), [before])
  now = new Date(original.scheduledMessage!.dueAt)
  await runtime.scan()
  const after = await read()
  assert.equal(after.status, 'completed')
  assert.equal(after.delivery?.state, state)
  assert.equal(after.delivery?.content, 'NEW D')
  assert.equal(after.delivery?.attempts, 1)
  const events: ReturnType<typeof taskFacts>[] = []
  store.relay(e => events.push(JSON.parse(e.content)))
  const completion = events.find(e => e.status === 'completed' && e.delivery?.state === 'pending')!
  assert.ok(completion)
  assert.equal(completion.snapshot.kind, 'event')
  assert.equal(completion.requirements, 'send NEW D')
  assert.equal(completion.scheduledMessage?.text, 'NEW D')
  assert.equal(events.at(-1)?.delivery?.state, state)
  store.edit(original.id, task => { task.checkpoint = 'read again' }, now)
  store.relay(() => assert.fail('unchanged delivery must not replay'))
  assert.equal(completion.delivery?.state, 'pending', 'past event must remain a past snapshot')
})
