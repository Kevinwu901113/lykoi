/** Real-model acceptance on a disposable instance; Telegram HTTP endpoint is controlled locally. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as runtime from 'lykoi-runtime'
import * as budget from 'lykoi-budget'
import * as llm from 'lykoi-llm'
import * as provider from 'lykoi-llm-deepseek'
import * as tasks from 'lykoi-task'
import * as converse from 'lykoi-converse'
import * as ingress from 'lykoi-ingress'
import { BotApiTransport, outboundCapabilities, setTransport, _reserveProactiveSlot, messengerLedgerPath } from 'lykoi-adapter-telegram'
import { createInstance, instanceEnvironment } from '../instance-state.ts'

assert.equal(process.env.LYKOI_FOLLOWUP_LIVE, '1'); assert.ok(process.env.DEEPSEEK_API_KEY)
const root = mkdtempSync(join(tmpdir(), 'lykoi-followup-live-'))
const instance = createInstance({ registry: join(root, 'instances'), id: 'followup', definition: resolve('packages/lykoi-decide/test/fixtures/instance/persona.toml'), ownerName: '验收者', telegramSenderId: '1' })
Object.assign(process.env, instanceEnvironment(instance))
const records: Array<{ type: string; data: any }> = []
const record = (type: string, data: unknown) => { records.push({ type, data }); writeFileSync(join(root, 'evidence.json'), JSON.stringify(records, null, 2)); console.log(type, type === 'root' ? JSON.stringify(data) : '') }
const originalFetch = globalThis.fetch
globalThis.fetch = async (url, init) => {
  if (String(url).endsWith('/chat/completions') && typeof init?.body === 'string') record('model_wire', JSON.parse(init.body))
  return originalFetch(url, init)
}
record('root', { root, model: 'deepseek-flash' })
const received: Array<{ at: number; payload: any }> = []
const server = createServer(async (req, res) => {
  let body = ''; for await (const chunk of req) body += chunk
  const receipt = { at: Date.now(), payload: JSON.parse(body) }; received.push(receipt); record('http_received', receipt)
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, result: { message_id: received.length, date: Math.floor(Date.now() / 1000) } }))
})
await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
const ctx = new Context(); ctx.provide('lykoiInstance', instance)
ctx.provide('audit', { record: async event => record('audit', event) })
const fibers: any[] = []
try {
  fibers.push(await ctx.plugin(runtime)); fibers.push(await ctx.plugin(LlmRuntime))
  fibers.push(await ctx.plugin(budget, { ledgerPath: join(instance.stateRoot, 'budget.json'), dailyTotalTokens: 80000, dailyRouteTokens: {} }))
  fibers.push(await ctx.plugin(provider, { thinking: 'enabled', reasoningEffort: 'low', maxTokens: 4096 }))
  fibers.push(await ctx.plugin(llm))
  const original = ctx.lykoiLlm.call.bind(ctx.lykoiLlm)
  ctx.lykoiLlm.call = async (options, meta) => {
    record('model_input', { messages: options.messages, system: options.system, meta })
    const result = await original({ ...options, signal: AbortSignal.timeout(90000) }, meta)
    record('model_output', { text: result.text, usage: result.usage }); return result
  }
  fibers.push(await ctx.plugin(ingress, { dbPath: join(instance.stateRoot, 'ingress.sqlite'), idleWindowMs: 1, hardWindowMs: 1, autoStart: false }))
  fibers.push(await ctx.plugin(tasks, { dbPath: join(instance.stateRoot, 'tasks.sqlite'), memoryPath: join(instance.stateRoot, 'memory.db'), root: join(instance.stateRoot, 'tasks'), personaToml: instance.personaPath, route: 'deepseek-official', model: 'deepseek-flash', maxActions: 4, intervalMs: 1000 }))
  // Only the unused outbound poll binding is inert. Task delivery uses Converse's real binding,
  // Runtime, kernel, messenger resource and BotApiTransport below; no console override.
  ctx.provide('messenger', { wireOutbound: () => () => {} })
  ctx.lykoiRuntime.register({ organId: 'messenger', capabilities: outboundCapabilities(), sideEffects: [] })
  setTransport(new BotApiTransport({ token: 'synthetic', apiBase: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,
    post: async (url, payload) => {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await response.json(); return { status: response.status, json: () => data }
    },
  }))
  assert.equal(_reserveProactiveSlot(), null); const ledger = readFileSync(messengerLedgerPath(), 'utf8')
  fibers.push(await ctx.plugin(converse, { dbPath: join(instance.stateRoot, 'memory.db'), personaToml: instance.personaPath,
    route: 'deepseek-official', model: 'deepseek-flash', restartMarker: join(root, 'restart.json'), narrativeFlag: '', restartRepoRoot: '', restartUnit: '', notificationOutboxDelivery: false,
    interpretTimeoutS: 30, interpretRetries: 1, cycleTimeoutS: 180, visionRoute: 'disabled', visionModel: 'disabled' }))
  const text = '最后做一次单次延迟送达测试：请先简短确认，然后从收到本消息起至少60秒后，在这里另发一条“P5部署验收：延迟送达成功”。只执行一次，不循环，不运行命令，不修改文件。能力做不到就直说，不要提前发送成功句。'
  const start = Date.now(); record('request', { text, start })
  const reply = await ctx.converse.conversation.send(text, { runId: 'followup-acceptance', turnId: 'turn:fixture:1' })
  record('reply', { reply, outcome: ctx.converse.conversation.lastCycleOutcome(), tasks: ctx.tasks.list() })
  assert.equal(ctx.tasks.list().length, 1, 'promise must create durable work')
  const id = ctx.tasks.list()[0]!.id
  while (Date.now() < start + 180000 && ctx.tasks.get(id).delivery?.state !== 'sent') {
    const task = ctx.tasks.get(id)
    if (task.status === 'failed' || (task.status === 'waiting' && task.wait?.kind !== 'due')) throw new Error(`unexpected task state: ${JSON.stringify(task)}`)
    await delay(250)
  }
  const task = ctx.tasks.get(id); record('task', { task, operations: ctx.tasks.history(id) })
  assert.equal(task.delivery?.state, 'sent')
  assert.equal(received.length, 1); assert.equal(received[0]!.payload.text, 'P5部署验收：延迟送达成功')
  assert.ok(received[0]!.at - start >= 60000, 'must respect the requested minimum delay')
  assert.equal(ctx.tasks.history(id).operations.length, 0, 'host-delivered text needs no command, file or messaging capability')
  await ctx.tasks.scan(); await delay(1500); assert.equal(received.length, 1)
  assert.equal(readFileSync(messengerLedgerPath(), 'utf8'), ledger)
  record('passed', { elapsedMs: received[0]!.at - start, received: received.length })
} finally {
  await ctx.get('tasks')?.close()
  for (const fiber of fibers.reverse()) await fiber.dispose()
  setTransport(null)
  globalThis.fetch = originalFetch
  await new Promise<void>(ok => server.close(() => ok()))
}
