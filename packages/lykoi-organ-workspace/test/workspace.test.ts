import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CapabilityRuntime } from 'lykoi-runtime'
import { workspaceCapabilities } from '../src/index.ts'

test('workspace capabilities read/write, validate schema, reject escape and expose command artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'p2-workspace-'))
  const outside = await mkdtemp(join(tmpdir(), 'p2-outside-'))
  const runtime = new CapabilityRuntime()
  try {
    const stop = runtime.register({ organId: 'workspace', capabilities: await workspaceCapabilities(root), sideEffects: [] })
    await runtime.invoke('workspace.write', { path: 'note.txt', content: 'actual state' })
    assert.equal(await readFile(join(root, 'note.txt'), 'utf8'), 'actual state')
    assert.equal((await runtime.invoke('workspace.read', { path: 'note.txt' }) as any).text, 'actual state')
    await assert.rejects(runtime.invoke('workspace.write', { path: 'note.txt', content: 123 }), /expected string/)
    await writeFile(join(outside, 'private'), 'private')
    await symlink(outside, join(root, 'outside'))
    await assert.rejects(runtime.invoke('workspace.read', { path: '../private' }), /outside workspace/)
    await assert.rejects(runtime.invoke('workspace.read', { path: 'outside/private' }), /outside workspace/)
    await symlink(join(outside, 'missing'), join(root, 'broken'))
    await assert.rejects(runtime.invoke('workspace.write', { path: 'broken', content: 'escape' }), /ENOENT/)
    const result = await runtime.invoke('terminal.exec', { command: "printf 'verified'; printf '%20000s' 'end'" }) as any
    assert.equal(result.ok, true); assert.ok(result.artifact)
    assert.ok((await readFile(join(root, result.artifact), 'utf8')).endsWith('end'))
    const next = await runtime.invoke('workspace.read', { path: result.artifact, offset: 16000 }) as any
    assert.ok(next.text.endsWith('end'))
    const failure = await runtime.invoke('terminal.exec', { command: 'exit 7' }) as any
    assert.equal(failure.ok, false); assert.equal(failure.exitCode, 7)
    stop(); await assert.rejects(runtime.invoke('workspace.read', { path: 'note.txt' }), /not registered/)
  } finally { runtime.dispose(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('shell capability remains behind the existing kernel approval gate', async () => {
  const { createDispatch } = await import('lykoi-kernel')
  const root = await mkdtemp(join(tmpdir(), 'p2-command-gate-'))
  const previous = process.env.LYKOI_APPROVAL_RULES
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  await writeFile(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['terminal.exec'], always_deny: [], ask: [] }))
  const runtime = new CapabilityRuntime()
  try {
    runtime.register({ organId: 'workspace', capabilities: await workspaceCapabilities(root), sideEffects: [] })
    const events: string[] = []; runtime.onActivity(e => { events.push(e.phase) })
    const dispatch = createDispatch({ resources: runtime.resources, sink: { record: async () => {} } })
    const action = { type: 'terminal.exec', params: { command: 'printf approved' } }
    const blocked = await dispatch(action, { context: { origin: 'interactive' } })
    assert.equal(blocked.error, 'needs_approval'); assert.deepEqual(events, [])
    const result = await dispatch(action, { context: { origin: 'interactive' }, preApproved: true })
    assert.equal(result.success, true); assert.equal(result.data.output, 'approved')
  } finally {
    runtime.dispose(); await rm(root, { recursive: true, force: true })
    if (previous === undefined) delete process.env.LYKOI_APPROVAL_RULES; else process.env.LYKOI_APPROVAL_RULES = previous
  }
})
