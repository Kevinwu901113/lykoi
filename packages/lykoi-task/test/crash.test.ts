import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { TaskStore } from '../src/store.ts'
import { TaskRuntime } from '../src/runtime.ts'

test('process death after a real side effect leaves an unknown operation that is not replayed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-crash-')), db = join(root, 'tasks.sqlite')
  new DatabaseSync(db).close()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const script = `
    import { appendFileSync } from 'node:fs'
    import { join } from 'node:path'
    import { TaskStore } from ${JSON.stringify(new URL('../src/store.ts', import.meta.url).href)}
    import { TaskRuntime } from ${JSON.stringify(new URL('../src/runtime.ts', import.meta.url).href)}
    const root = process.argv[1], store = new TaskStore(join(root, 'tasks.sqlite'), 'A', root)
    const task = store.create({ goal: 'publish once' })
    const runtime = new TaskRuntime(store, { maxActions: 1, intervalMs: 0,
      reason: async () => ({ kind: 'act', action: { name: 'publish.once', args: {} } }),
      dispatch: async () => {
        appendFileSync(join(root, 'effects.log'), 'published\\n', { flush: true })
        process.kill(process.pid, 'SIGKILL')
        await new Promise(() => {})
      },
    })
    await runtime.advance(task.id)
  `
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, root], { stdio: 'pipe' })
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk })
  const signal = await new Promise<NodeJS.Signals | null>((resolve, reject) => { child.on('error', reject); child.on('close', (_code, signal) => resolve(signal)) })
  assert.equal(signal, 'SIGKILL', stderr)
  const store = new TaskStore(db, 'A', root)
  try {
    const runtime = new TaskRuntime(store, { maxActions: 1, intervalMs: 0,
      reason: async () => { throw new Error('unverified work must not resume') },
      dispatch: async () => { throw new Error('external effect must not replay') },
    })
    await runtime.recover(); await runtime.scan(); await runtime.scan()
    assert.equal(readFileSync(join(root, 'effects.log'), 'utf8'), 'published\n')
    assert.equal(store.list()[0]!.wait?.kind, 'verification')
    assert.equal(store.operations(store.list()[0]!.id)[0]!.status, 'unknown')
  } finally { store.close() }
})
