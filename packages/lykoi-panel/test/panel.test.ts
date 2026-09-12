import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import { createInstance, instanceEnvironment } from '../../../profile/instance-state.ts'
import { instanceEntries, drainInstance } from '../../../profile/assembly.ts'
import * as panel from '../src/index.ts'

const repo = new URL('../../../', import.meta.url).pathname

test('real Cordis services share Panel history, tasks, skills and lifecycle', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-panel-'))
  const instance = createInstance({ registry: join(root, 'instances'), id: 'panel-test', ownerName: '合成测试者',
    definition: resolve(repo, 'packages/lykoi-decide/test/fixtures/instance/persona.toml') })
  // Reuse the runnable local profile, overriding only ephemeral port and task timing.
  const entries = instanceEntries(resolve(repo, 'profile/cordis.panel.yml'), instance)
  const panelEntry = entries.find(e => e.id === 'panel')!; panelEntry.config = { port: 0 }
  entries.find(e => e.id === 'tasks')!.config!.intervalMs = 60000
  const oldEnv = { ...process.env }
  Object.assign(process.env, instanceEnvironment(instance))
  const ctx = new Context()
  ctx.provide('lykoiInstance', instance)
  ctx.baseUrl = new URL('../../../profile/instance-worker.ts', import.meta.url).href
  await ctx.plugin(Loader, { baseUrl: ctx.baseUrl })
  let started = false
  try {
    await ctx.loader.root.update(entries); await ctx.loader.await(); started = true
    assert.ok(ctx.get('panel'), 'Panel must mount through the normal loader')
    const url = ctx.panel.url
    async function get(path: string) { const res = await fetch(url + '/api/' + path); assert.equal(res.status, 200); return res.json() as Promise<any> }
    async function post(path: string, input: unknown) {
      const res = await fetch(url + '/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url }, body: JSON.stringify(input) })
      assert.equal(res.status, 200, await res.clone().text()); return res.json() as Promise<any>
    }
    const before = await get('state')
    assert.equal(before.instance.id, instance.id); assert.equal(before.history.length, 0)
    const text = '保留原文\n<script>window.pwned=true</script> 这是一次 HTTP 对话。'
    const reply = await post('chat', { text })
    assert.equal(reply.outcome.kind, 'reply')
    assert.match(reply.reply, /本地 Panel 体验实例/)
    assert.equal(JSON.parse(ctx.converse.history(1)[0]!.content).user, text)
    assert.equal((await get('state')).history.length, 1)
    assert.ok(ctx.mind.view().events.some(e => e.content === text), 'same Mind inbox receives the HTTP turn')

    await post('task', { command: 'create', text: '一个可以暂停的合成任务' })
    const task = ctx.tasks.list()[0]!
    assert.equal(task.origin, 'user')
    await post('task', { command: 'pause', id: task.id })
    assert.equal(ctx.tasks.get(task.id).status, 'paused')
    await post('task', { command: 'update', id: task.id, text: '完整新要求\n第二行不得丢失' })
    assert.equal(ctx.tasks.get(task.id).requirements, '完整新要求\n第二行不得丢失')
    assert.equal(ctx.tasks.get(task.id).status, 'paused')
    assert.equal((await get('task?id=' + task.id)).task.id, task.id)
    await post('task', { command: 'cancel', id: task.id })
    assert.equal(ctx.tasks.get(task.id).status, 'cancelled')

    const saved = await ctx.lykoiRuntime.invoke('skill.save', { title: '验收方法', summary: '合成来源', body: '<script>这只是文本</script>\n核对真实状态。', source: { kind: 'user', reference: 'panel-test' } }) as { id: string }
    assert.equal((await get('skills?query=验收')).skills[0].id, saved.id)
    const method = await get('skills?id=' + saved.id)
    const original = JSON.parse(readFileSync(join(instance.stateRoot, 'skills', saved.id + '.json'), 'utf8'))
    assert.deepEqual(method, original, 'Panel reads the actual Skill file through its service')

    const retire = ctx.lykoiRuntime.register({ organId: 'test', sideEffects: [], capabilities: [{ name: 'test.read', description: 'temporary', inputSchema: { type: 'object' }, handler: async () => ({}) }] })
    assert.ok((await get('state')).capabilities.some((c: any) => c.name === 'test.read'))
    retire()
    assert.ok(!(await get('state')).capabilities.some((c: any) => c.name === 'test.read'))

    for (const headers of [{ Origin: 'https://untrusted.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await fetch(url + '/api/state', { headers })).status, 403)
    }
    const invalidHost = await new Promise<number>(resolve => {
      const req = request(url + '/api/state', { headers: { Host: 'untrusted.example' } }, res => { res.resume(); resolve(res.statusCode!) }); req.end()
    })
    assert.equal(invalidHost, 403)
    assert.equal((await fetch(url + '/api/task', { method: 'POST', body: 'text=bad' })).status, 415)
    assert.equal((await fetch(url + '/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400)
    assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"text":""}' })).status, 400)
    assert.equal((await fetch(url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(70000) }) })).status, 413)
    assert.equal((await fetch(url + '/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"command":"invoke","id":"terminal.exec"}' })).status, 400)
    assert.equal((await fetch(url + '/api/skills?offset=-1')).status, 400)
    const html = await fetch(url); assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/)
    assert.match(await html.text(), /方法库/)
    assert.equal((await fetch(url + '/app.js')).headers.get('content-type'), 'text/javascript; charset=utf-8')

    let executed = false
    const removeTerminal = ctx.lykoiRuntime.register({ organId: 'test-terminal', sideEffects: [], capabilities: [{
      name: 'terminal.exec', description: 'synthetic approval probe', inputSchema: { type: 'object' },
      handler: async () => { executed = true; return {} },
    }] })
    const probeReply = JSON.stringify({ meaning_assessment: [], decision: {
      kind: 'tool_call', tool: { name: 'terminal.exec', arguments: { command: 'synthetic-no-execution' } }, reason: 'test approval boundary',
    } })
    await ctx.loader.root.update(entries.map(e => e.id === 'chat-model' ? { ...e, config: { ...e.config, replyText: probeReply } } : e)); await ctx.loader.await()
    const blocked = await post('chat', { text: '合成审批测试' })
    assert.equal(blocked.outcome.kind, 'ask_pending')
    assert.equal(blocked.approvalStatus, 'unavailable', 'no transport must not masquerade as an approval question sent')
    assert.equal(executed, false)
    removeTerminal()

    await ctx.loader.root.update(entries.filter(e => e.id !== 'skill')); await ctx.loader.await()
    assert.equal((await get('state')).skills, null)
    assert.equal((await fetch(url + '/api/skills')).status, 503)

    // Removing the plugin releases its port without retiring cognition or state.
    await ctx.loader.root.update(entries.filter(e => e.id !== 'panel')); await ctx.loader.await()
    assert.equal(ctx.get('panel'), undefined)
    await assert.rejects(fetch(url))
    const reloaded = await ctx.plugin(panel, { port: Number(new URL(url).port) })
    assert.equal(ctx.panel.url, url)
    assert.equal((await get('state')).history.length, 2)
    assert.equal((await get('state')).tasks[0].status, 'cancelled')
    await reloaded.dispose()
    assert.equal(ctx.get('panel'), undefined)
  } finally {
    if (started) await drainInstance(ctx)
    else await ctx.loader.root.stop()
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    rmSync(root, { recursive: true, force: true })
  }
})
