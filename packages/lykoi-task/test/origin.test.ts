import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createStateFixture } from 'lykoi-memory/testing'
import * as runtimePlugin from 'lykoi-runtime'
import * as workspacePlugin from 'lykoi-organ-workspace'
import * as tasksPlugin from '../src/index.ts'

test('real task plugin preserves autonomous origin through capability selection and kernel dispatch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'p5-origin-')), memoryPath = join(root, 'memory.db')
  createStateFixture(memoryPath)
  const previousRules = process.env.LYKOI_APPROVAL_RULES
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  writeFileSync(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['workspace.write'], always_deny: [], ask: [], autonomous: { always_allow: [], always_deny: [] } }))
  const persona = new URL('../../lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname
  const ctx = new Context()
  ctx.provide('lykoiInstance', { version: 1, id: 'test', origin: 'created', createdAt: '2026-09-10T00:00:00Z', definitionHash: 'fixture', stateRoot: root, personaPath: persona })
  ctx.provide('audit', { record: async () => {} })
  ctx.provide('lykoiLlm', { call: async options => {
    const payload = JSON.parse((options.messages.at(-1)!.content[0] as { text: string }).text)
    if (payload.task.origin === 'autonomous') assert.ok(!payload.capabilities.some((c: { name: string }) => c.name === 'workspace.write'))
    const op = payload.operations[0]
    const decision = !op ? { kind: 'act', action: { name: 'workspace.write', args: { path: 'result.txt', content: 'verified' } } }
      : op.observation.success ? { kind: 'finish', result: { status: 'completed', checkpoint: 'file saved', content: 'verified result', artifacts: ['result.txt'] } }
      : { kind: 'finish', result: { status: 'failed', checkpoint: 'write denied', reason: 'no autonomous permission' } }
    return { text: JSON.stringify(decision), reasoningLength: 0 }
  } })
  const runtime = await ctx.plugin(runtimePlugin)
  const workspace = await ctx.plugin(workspacePlugin, { directory: join(root, 'workspace') })
  const tasks = await ctx.plugin(tasksPlugin, { dbPath: join(root, 'tasks.sqlite'), memoryPath, root: join(root, 'tasks'), personaToml: persona, route: 'fixture', model: 'fixture', maxActions: 2, intervalMs: 60000 })
  try {
    ctx.mind.commit({ records: [{ id: 'research', revision: 0, kind: 'thought', topic: '研究', understanding: '需要一个案例', open: '收集资料', evidence: ['case:A'], links: [], status: 'open', reconsiderAt: null, basis: 'inferred', scope: '研究' }] }, 'wake', ctx.mind.view())
    const automatic = await ctx.lykoiRuntime.invoke('task.create', { goal: '研究', thoughtId: 'research', reason: '比较案例' }) as { id: string }
    await ctx.tasks.scan()
    assert.equal(ctx.tasks.get(automatic.id).status, 'failed')
    assert.equal(ctx.tasks.get(automatic.id).origin, 'autonomous')
    assert.equal(ctx.tasks.get(automatic.id).delivery, null)
    assert.equal(existsSync(join(root, 'tasks', automatic.id, 'workspace', 'result.txt')), false)
    assert.ok(ctx.mind.view().events.some(e => e.reference === automatic.id))
    const user = ctx.tasks.create({ goal: 'write the requested result' })
    await ctx.tasks.scan()
    assert.equal(ctx.tasks.get(user.id).status, 'completed')
    assert.equal(ctx.tasks.get(user.id).result, 'verified result')
    assert.equal(ctx.tasks.get(user.id).delivery?.state, 'pending')
  } finally {
    await tasks.dispose(); await workspace.dispose(); await runtime.dispose()
    if (previousRules === undefined) delete process.env.LYKOI_APPROVAL_RULES; else process.env.LYKOI_APPROVAL_RULES = previousRules
    rmSync(root, { recursive: true, force: true })
  }
})
