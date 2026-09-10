import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { check, createDispatch } from 'lykoi-kernel'
import { CapabilityRuntime } from '../src/index.ts'

test('a dynamic capability requires an autonomous rule; deny and hard boundaries still win', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'p2-autonomous-'))
  const previous = process.env.LYKOI_APPROVAL_RULES
  process.env.LYKOI_APPROVAL_RULES = join(directory, 'rules.json')
  const runtime = new CapabilityRuntime()
  let calls = 0
  const stop = runtime.register({ organId: 'specimen', sideEffects: [], capabilities: [{
    name: 'specimen.lookup', description: 'Read a specimen', inputSchema: { type: 'object' },
    handler: async () => { calls++; return { value: 'observed' } },
  }] })
  const rules = (allow: string[], deny: string[] = []) => writeFileSync(process.env.LYKOI_APPROVAL_RULES!, JSON.stringify({
    always_allow: ['specimen.lookup'], always_deny: [], ask: [], autonomous: { always_allow: allow, always_deny: deny },
  }))
  const visible = () => runtime.capabilities().filter(c => check(c.name, 'autonomous') === 'allow')
  const dispatch = createDispatch({ resources: runtime.resources, sink: { record: async () => {} } })
  const invoke = () => dispatch({ type: 'specimen.lookup', params: {} }, { context: { origin: 'autonomous' } })
  try {
    rules([])
    assert.deepEqual(visible(), [])
    assert.equal(check('specimen.lookup', 'autonomous'), 'deny')
    assert.equal((await invoke()).success, false); assert.equal(calls, 0)
    rules(['specimen.lookup'])
    assert.deepEqual(visible().map(c => c.name), ['specimen.lookup'])
    assert.equal((await invoke()).data.value, 'observed'); assert.equal(calls, 1)
    rules(['specimen.*'], ['specimen.lookup'])
    assert.deepEqual(visible(), [])
    assert.equal((await invoke()).success, false); assert.equal(calls, 1)
    rules(['specimen.*', 'terminal.exec', 'delegation.dispatch'])
    assert.equal(check('specimen.lookup', 'autonomous'), 'allow')
    assert.equal(check('terminal.exec', 'autonomous'), 'deny')
    assert.equal(check('delegation.dispatch', 'autonomous'), 'deny')
    assert.equal(check('specimen.lookup', 'scheduler'), 'deny')
    assert.equal(check('specimen.lookup', 'delegated'), 'deny')
    rules([])
    assert.deepEqual(visible(), [], 'revocation applies without restarting')
    rules(['specimen.lookup']); stop()
    assert.deepEqual(visible(), [])
    await assert.rejects(invoke(), /unknown action/)
  } finally {
    runtime.dispose(); rmSync(directory, { recursive: true, force: true })
    if (previous === undefined) delete process.env.LYKOI_APPROVAL_RULES; else process.env.LYKOI_APPROVAL_RULES = previous
  }
})
