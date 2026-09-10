import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateFixture } from 'lykoi-memory/testing'
import { DatabaseSync } from 'node:sqlite'
import { CapabilityRuntime } from 'lykoi-runtime'
import * as workspace from 'lykoi-organ-workspace'
import * as taskPlugin from '../src/index.ts'

const definition = new URL('../../lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname

test('Cordis task plugin owns state, uses real workspace observations, restores delivery and records one experience', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-plugin-')), db = join(root, 'memory.db')
  createStateFixture(db)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(root, 'grants.json')
  writeFileSync(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['workspace.write', 'workspace.read'], always_deny: [], ask: [] }))
  const instance = { version: 1 as const, id: 'A', origin: 'created' as const, createdAt: new Date().toISOString(), definitionHash: 'test', personaPath: definition, stateRoot: root }
  let calls = 0, deliveries = 0
  const setup = async () => {
    const ctx = new Context()
    ctx.provide('lykoiRuntime', new CapabilityRuntime(() => {}, instance))
    ctx.provide('audit', { record: async () => {} })
    ctx.provide('lykoiLlm', { call: async options => {
      calls++
      const payload = JSON.parse((options.messages.at(-1)!.content[0] as { text: string }).text)
      const operations = payload.operations
      let decision: unknown
      if (!operations.length) decision = { kind: 'act', action: { name: 'workspace.write', args: { path: 'report.md', content: 'actual task result' } } }
      else if (operations.length === 1 && !payload.closing) decision = { kind: 'act', action: { name: 'workspace.read', args: { path: 'report.md' } } }
      else if (operations.length === 1) decision = { kind: 'finish', result: { status: 'continue', checkpoint: 'file created; inspect next run' } }
      else {
        assert.equal(operations.at(-1).observation.data.text, 'actual task result')
        decision = { kind: 'finish', result: { status: 'completed', checkpoint: 'read and verified actual task result', content: 'report.md 已完成', artifacts: ['report.md'] } }
      }
      return { text: JSON.stringify(decision), reasoningLength: 0 }
    } })
    const organ = await ctx.plugin(workspace, { directory: join(root, 'workspace') })
    const tasks = await ctx.plugin(taskPlugin, { dbPath: db, root: join(root, 'tasks'), personaToml: definition, route: 'fixture', model: 'fixture', maxActions: 1, intervalMs: 60000 })
    ctx.tasks.bindInteractions({ requestApproval: async () => { throw new Error('unexpected approval') }, deliver: async () => { deliveries++; return { state: 'failed', error: 'fixture transport unavailable' } } })
    return { ctx, dispose: async () => { await ctx.tasks.close(); await tasks.dispose(); await organ.dispose() } }
  }
  try {
    let first = await setup()
    const task = first.ctx.tasks.create({ goal: 'write and verify report' })
    await first.ctx.tasks.scan()
    assert.equal(first.ctx.tasks.get(task.id).status, 'waiting')
    const progress = first.ctx.tasks.get(task.id).checkpoint
    await first.dispose()
    first = await setup()
    assert.equal(first.ctx.tasks.get(task.id).checkpoint, progress)
    await first.ctx.tasks.control(task.id, 'resume')
    await first.ctx.tasks.scan()
    assert.equal(first.ctx.tasks.get(task.id).status, 'completed')
    assert.equal(first.ctx.tasks.get(task.id).delivery?.state, 'failed')
    assert.equal(readFileSync(join(root, 'tasks', task.id, 'workspace', 'report.md'), 'utf8'), 'actual task result')
    const before = calls
    first.ctx.tasks.bindInteractions({ requestApproval: async () => {}, deliver: async () => { deliveries++; return { state: 'sent', receipt: 'console' } } })
    first.ctx.tasks.retryDelivery(task.id); await first.ctx.tasks.scan()
    assert.equal(calls, before); assert.equal(deliveries, 2)
    await first.dispose()
    first = await setup(); await first.ctx.tasks.scan(); await first.dispose()
    const check = new DatabaseSync(db, { readOnly: true })
    try { assert.equal(check.prepare('SELECT COUNT(*) AS n FROM experience_references WHERE reference=?').get(task.id)!.n, 1); assert.equal(check.prepare("SELECT COUNT(*) AS n FROM experiences WHERE source='action_result'").get()!.n, 1) }
    finally { check.close() }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
