import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ComposerStore, ComponentRegistry, ComposerEngine } from '../src/index.ts'

test('SIGKILL after a real side effect restores an unknown operation without replay; verified receipt continues', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-composer-crash-'))
  let store: ComposerStore | undefined,
    engine: ComposerEngine | undefined,
    repeats = 0
  try {
    const killed = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL('./fixtures/crash.ts', import.meta.url)), root],
        { stdio: ['ignore', 'ignore', 'pipe'] }
      )
      let errorText = ''
      child.stderr.on('data', (chunk) => {
        errorText += chunk
      })
      child.once('error', reject)
      child.once('exit', (code, signal) =>
        code !== null ? reject(new Error(`fixture exited ${code}: ${errorText}`)) : resolve({ code, signal })
      )
    })
    assert.equal(killed.signal, 'SIGKILL')
    assert.equal(readFileSync(join(root, 'real-effect.txt'), 'utf8'), 'published exactly once')
    const id = readFileSync(join(root, 'run-id.txt'), 'utf8')
    store = new ComposerStore(join(root, 'state.sqlite'))
    const registry = new ComponentRegistry()
    registry.register({
      id: 'crash.effect',
      version: '1.0.0',
      title: 'effect',
      description: 'effect',
      kind: 'transform',
      effect: 'external',
      input: 'any',
      output: 'any',
      defaultConfig: {},
      resourceRoles: {},
      validate() {},
      invoke: async () => {
        repeats++
        return { status: 'completed', value: 'duplicate' }
      }
    })
    engine = new ComposerEngine(store, registry, { workspaceRoot: join(root, 'workspaces') })
    await engine.recover()
    await engine.recover()
    assert.equal(repeats, 0)
    assert.equal(store.run(id).wait!.reason, 'unknown')
    await engine.resolve(id, store.run(id).wait!.operationId, 'verified publication')
    await engine.idle(id)
    assert.equal(store.run(id).status, 'succeeded')
    assert.equal(store.run(id).result, 'verified publication')
    assert.equal(repeats, 0)
  } finally {
    await engine?.close()
    store?.close()
    rmSync(root, { recursive: true, force: true })
  }
})
