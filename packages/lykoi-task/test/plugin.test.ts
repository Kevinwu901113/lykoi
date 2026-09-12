import test from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { createStateFixture } from 'lykoi-memory/testing'
import { loadPersona, buildPersonaKernel } from 'lykoi-decide'
import { DatabaseSync } from 'node:sqlite'
import { CapabilityRuntime } from 'lykoi-runtime'
import * as workspace from 'lykoi-organ-workspace'
import * as taskPlugin from '../src/index.ts'

const definition = new URL('../../lykoi-decide/test/fixtures/instance/persona.toml', import.meta.url).pathname

test('Cordis task plugin owns state, uses real workspace observations, restores delivery and records one experience', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-plugin-')), db = join(root, 'memory.db')
  createStateFixture(db)
  const learned = new ReadWriteMemory(db)
  let acquired = 'I learned to inspect actual results before reporting completion.'
  learned.upsertInsight('persona', acquired, { now: new Date() })
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(root, 'grants.json')
  writeFileSync(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['workspace.write', 'workspace.read'], always_deny: [], ask: [] }))
  const instance = { version: 1 as const, id: 'A', origin: 'created' as const, createdAt: new Date().toISOString(), definitionHash: 'test', personaPath: definition, stateRoot: root }
  const request = { text: '先确认，再后台写报告', receivedAt: new Date().toISOString() }
  let calls = 0, deliveries = 0
  const setup = async () => {
    const ctx = new Context()
    ctx.provide('lykoiRuntime', new CapabilityRuntime(() => {}, instance))
    ctx.provide('audit', { record: async () => {} })
    ctx.provide('lykoiLlm', { call: async options => {
      calls++
      assert.ok((options.messages[0]!.content[0] as { text: string }).text.includes(buildPersonaKernel(loadPersona(definition))))
      assert.ok((options.messages[0]!.content[0] as { text: string }).text.includes(acquired))
      if (calls === 1) {
        acquired = 'My later experience changed how I summarize evidence.'
        learned.upsertInsight('persona', acquired, { now: new Date() })
      }
      const payload = JSON.parse((options.messages.at(-1)!.content[0] as { text: string }).text)
      assert.deepEqual(payload.output, { contentField: 'result.content', delivery: 'host_sends_separate_message_to_instance_owner', recipientAlreadyBound: true })
      assert.equal('delivery' in payload.task, false)
      assert.deepEqual(payload.task.request, { receivedAt: request.receivedAt })
      assert.ok(Number.isFinite(Date.parse(payload.task.createdAt)))
      assert.equal(payload.task.history.originalRequest, undefined)
      assert.equal(payload.task.goal, undefined)
      assert.equal(typeof payload.task.requirements, 'string')
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
    const tasks = await ctx.plugin(taskPlugin, { dbPath: join(root, 'tasks.sqlite'), memoryPath: db, root: join(root, 'tasks'), personaToml: definition, route: 'fixture', model: 'fixture', maxActions: 1, intervalMs: 60000 })
    ctx.tasks.bindInteractions({ requestApproval: async () => { throw new Error('unexpected approval') }, deliver: async () => { deliveries++; return { state: 'failed', error: 'fixture transport unavailable' } } })
    return { ctx, dispose: async () => { await ctx.tasks.close(); await tasks.dispose(); await organ.dispose() } }
  }
  try {
    let first = await setup()
    const task = first.ctx.tasks.create({ goal: 'write and verify report', request })
    await first.ctx.tasks.scan()
    assert.equal(first.ctx.tasks.get(task.id).status, 'waiting')
    assert.deepEqual(first.ctx.tasks.get(task.id).request, request)
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
    try { assert.equal(check.prepare("SELECT name FROM sqlite_master WHERE name='persistent_tasks'").get(), undefined); assert.equal(check.prepare('SELECT COUNT(*) AS n FROM experience_references WHERE reference=?').get(task.id)!.n, 1); assert.equal(check.prepare("SELECT COUNT(*) AS n FROM experiences WHERE source='action_result'").get()!.n, 1) }
    finally { check.close() }
  } finally { learned.close(); rmSync(root, { recursive: true, force: true }) }
})

test('Task cancellation retires the actual kernel approval and returns a small human receipt', async () => {
  const { enqueuePending, pendingActions, _setPolicyCoreForTest } = await import('lykoi-kernel')
  const root = mkdtempSync(join(tmpdir(), 'lykoi-task-receipt-')), db = join(root, 'memory.db')
  createStateFixture(db)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(root, 'grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(root, 'pending.json')
  _setPolicyCoreForTest(undefined)
  const instance = { version: 1 as const, id: 'A', origin: 'created' as const, createdAt: new Date().toISOString(), definitionHash: 'test', personaPath: definition, stateRoot: root }
  const ctx = new Context(); ctx.provide('lykoiRuntime', new CapabilityRuntime(() => {}, instance))
  ctx.provide('audit', { record: async () => {} })
  ctx.provide('lykoiLlm', { call: async () => ({ text: JSON.stringify({ kind: 'act', action: { name: 'test.read', args: {} } }), reasoningLength: 0 }) })
  ctx.lykoiRuntime.register({ organId: 'test', sideEffects: [], capabilities: [{ name: 'test.read', inputSchema: { type: 'object' }, description: 'read fixture', handler: async () => assert.fail('unapproved read') }] })
  const fiber = await ctx.plugin(taskPlugin, { dbPath: join(root, 'tasks.sqlite'), memoryPath: db, root: join(root, 'tasks'), personaToml: definition, route: 'fixture', model: 'fixture', maxActions: 1, intervalMs: 60000 })
  ctx.tasks.bindInteractions({ deliver: async () => ({ state: 'sent' }), requestApproval: async op => { enqueuePending(op.name, op.args, { actionId: op.operationId, correlationId: op.taskId }) } })
  try {
    const task = ctx.tasks.create({ goal: 'private goal', request: { text: 'PRIVATE_RAW_REQUEST', receivedAt: new Date().toISOString() } })
    await ctx.tasks.scan(); assert.equal(pendingActions().length, 1)
    enqueuePending('task.control', { id: task.id, command: 'resume' }, { actionId: 'old-resume' })
    const control = taskPlugin.taskCapabilities(ctx.tasks).find(c => c.name === 'task.control')!
    const receipt = await control.handler({ id: task.id, command: 'cancel' }) as { id: string; status: string; text: string }
    assert.equal(receipt.status, 'cancelled'); assert.match(receipt.text, /已取消/)
    assert.deepEqual(Object.keys(receipt).sort(), ['id', 'status', 'text'])
    assert.equal(pendingActions().length, 0); assert.equal(ctx.tasks.get(task.id).wait, null)
    const report = await ctx.tasks.command(`/task get ${task.id}`)
    assert.match(report!, /已取消/); assert.doesNotMatch(report!, /PRIVATE_RAW_REQUEST|workspace|requirements|\{/)
  } finally { await ctx.tasks.close(); await fiber.dispose(); rmSync(root, { recursive: true, force: true }) }
})

test('legacy task without original request keeps creation time and reads relevant Mind using latest requirements', async t => {
  const root = mkdtempSync(join(tmpdir(), 'task-legacy-facts-')), db = join(root, 'memory.db')
  createStateFixture(db)
  const ctx = new Context(), queries: (string | undefined)[] = []
  const instance = { version: 1 as const, id: 'A', origin: 'created' as const, createdAt: new Date().toISOString(), definitionHash: 'test', personaPath: definition, stateRoot: root }
  ctx.provide('lykoiRuntime', new CapabilityRuntime(() => {}, instance))
  ctx.provide('audit', { record: async () => {} })
  ctx.provide('mind', { view: (query?: string) => { queries.push(query); return { records: [], events: [] } }, receive: () => {} })
  let called = false
  ctx.provide('lykoiLlm', { call: async options => {
    called = true
    const task = JSON.parse((options.messages.at(-1)!.content[0] as { text: string }).text).task
    assert.equal(task.request, undefined)
    assert.ok(Number.isFinite(Date.parse(task.createdAt)))
    assert.equal(task.requirements, 'current scope')
    assert.equal(task.history.originalGoal, 'old scope')
    assert.equal(task.history.originalRequest, undefined)
    assert.equal(task.goal, undefined)
    return { text: JSON.stringify({ kind: 'finish', result: { status: 'completed', checkpoint: 'checked', content: 'done', artifacts: [] } }), reasoningLength: 0 }
  } })
  const fiber = await ctx.plugin(taskPlugin, { dbPath: join(root, 'tasks.sqlite'), memoryPath: db, root: join(root, 'tasks'), personaToml: definition, route: 'fixture', model: 'fixture', maxActions: 1, intervalMs: 60000 })
  t.after(async () => { await ctx.tasks.close(); await fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  const task = ctx.tasks.create({ goal: 'old scope' })
  ctx.tasks.update(task.id, 'current scope')
  await ctx.tasks.scan()
  assert.equal(called, true)
  assert.ok(queries.includes('current scope'))
  assert.equal(queries.includes('old scope'), false)
})

test('Task approval revision invalidates only matching unapproved operation and retains pause', async t => {
  const root=mkdtempSync(join(tmpdir(),'task-approval-revise-')),db=join(root,'memory.db');createStateFixture(db)
  process.env.LYKOI_APPROVAL_RULES=join(root,'rules.json');process.env.LYKOI_STANDING_GRANTS=join(root,'grants.json');process.env.LYKOI_PENDING_ACTIONS=join(root,'pending.json')
  const instance={version:1 as const,id:'A',origin:'created' as const,createdAt:new Date().toISOString(),definitionHash:'fixture',personaPath:definition,stateRoot:root}
  const ctx=new Context();ctx.provide('lykoiRuntime',new CapabilityRuntime(()=>{},instance));ctx.provide('audit',{record:async()=>{}})
  const action={name:'test.write',args:{text:'old'}}
  ctx.provide('lykoiLlm',{call:async()=>({text:JSON.stringify({kind:'act',action}),reasoningLength:0})})
  ctx.lykoiRuntime.register({organId:'test',sideEffects:[],capabilities:[{name:action.name,description:'fixture',inputSchema:{type:'object'},handler:async()=>assert.fail('old action must not execute')}]})
  const fiber=await ctx.plugin(taskPlugin,{dbPath:join(root,'tasks.sqlite'),memoryPath:db,root:join(root,'tasks'),personaToml:definition,route:'fixture',model:'fixture',maxActions:1,intervalMs:60000})
  t.after(async()=>{await ctx.tasks.close();await fiber.dispose();rmSync(root,{recursive:true,force:true})})
  let operation=''
  ctx.tasks.bindInteractions({deliver:async()=>({state:'sent'}),requestApproval:async op=>{operation=op.operationId}})
  const task=ctx.tasks.create({goal:'write a report'});await ctx.tasks.scan();assert.ok(operation)
  assert.equal(await ctx.tasks.reviseApproval(operation,'new text',{name:action.name,args:{text:'wrong'}}),false)
  assert.equal(ctx.tasks.get(task.id).revision,task.revision)
  await ctx.tasks.command(`/task pause ${task.id}`)
  assert.equal(await ctx.tasks.reviseApproval(operation,'C is now successful',action),true)
  const updated=ctx.tasks.get(task.id);assert.equal(updated.status,'paused');assert.match(updated.requirements,/C is now successful/)
  assert.equal(await ctx.tasks.reviseApproval(operation,'duplicate',action),false)
  await assert.rejects(ctx.tasks.approve(operation,action),/not awaiting approval/)
  assert.equal(ctx.tasks.history(task.id).operations.some(op=>(op as {status:string}).status==='approval'),false)
})


test('background completion retires control approvals but preserves independent reads', async t => {
  const { enqueuePending, pendingActions } = await import('lykoi-kernel')
  const root = mkdtempSync(join(tmpdir(), 'task-terminal-approval-')), db = join(root, 'memory.db')
  createStateFixture(db)
  process.env.LYKOI_APPROVAL_RULES = join(root, 'rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(root, 'grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(root, 'pending.json')
  const instance = { version: 1 as const, id: 'A', origin: 'created' as const, createdAt: new Date().toISOString(), definitionHash: 'fixture', personaPath: definition, stateRoot: root }
  const ctx = new Context()
  ctx.provide('lykoiRuntime', new CapabilityRuntime(() => {}, instance))
  ctx.provide('audit', { record: async () => {} })
  ctx.provide('lykoiLlm', { call: async () => ({ text: JSON.stringify({ kind: 'finish', result: { status: 'completed', checkpoint: 'verified', content: 'done', artifacts: [] } }), reasoningLength: 0 }) })
  const fiber = await ctx.plugin(taskPlugin, { dbPath: join(root, 'tasks.sqlite'), memoryPath: db, root: join(root, 'tasks'), personaToml: definition, route: 'fixture', model: 'fixture', maxActions: 1, intervalMs: 60000 })
  t.after(async () => { await ctx.tasks.close(); await fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  const task = ctx.tasks.create({ goal: 'finish background work' })
  enqueuePending('task.control', { id: task.id, command: 'resume' }, { actionId: 'obsolete-control' })
  enqueuePending('task.get', { id: task.id }, { actionId: 'read-status' })
  enqueuePending('task.history', { id: task.id }, { actionId: 'read-history' })
  await ctx.tasks.scan()
  assert.equal(ctx.tasks.get(task.id).status, 'completed')
  assert.deepEqual(pendingActions().map(p => p.id).sort(), ['read-history', 'read-status'])
})
