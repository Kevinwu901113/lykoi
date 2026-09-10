/** Opt-in real-provider acceptance. All memory, permissions, browser state and evidence live under a new temp directory. */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import * as budget from 'lykoi-budget'
import * as llm from 'lykoi-llm'
import * as provider from 'lykoi-llm-deepseek'
import { CapabilityRuntime } from 'lykoi-runtime'
import { OrganInventoryCache } from 'lykoi-decide'
import { createDispatch, check } from 'lykoi-kernel'
import { toDshEnvelopeMessages } from 'lykoi-converse'
import { BrowserOrganDriver, PlaywrightBackend } from 'lykoi-organ-browser/driver'
import { createHostServer } from 'lykoi-organ-browser/host'
import { BrowserHostClient, wireBrowserOrgan, DEFAULT_TIMEOUTS } from 'lykoi-organ-browser'
import { workspaceCapabilities } from 'lykoi-organ-workspace'
import { makeConversation } from '../../packages/lykoi-converse/test/fixture.ts'
import { makeStore, makeWakeDeps, T0 } from '../../packages/lykoi-wake/test/fixture.ts'
import { wakeOnce } from 'lykoi-wake'

assert.equal(process.env.LYKOI_P2_LIVE, '1', 'explicit live acceptance opt-in required')
const scope = process.env.LYKOI_P2_LIVE_CASE ?? 'all'
assert.ok(['all', 'dynamic'].includes(scope))
const root = mkdtempSync(join(tmpdir(), 'lykoi-p2-live-'))
const evidence: unknown[] = []
const record = (type: string, data: unknown) => {
  evidence.push({ type, data }); writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log(JSON.stringify({ type, data }))
}
process.env.LYKOI_APPROVAL_RULES = join(root, 'approval.json')
process.env.LYKOI_STANDING_GRANTS = join(root, 'standing.json')
process.env.LYKOI_PENDING_ACTIONS = join(root, 'pending.json')
const labName = 'specimen.lookup'
writeFileSync(process.env.LYKOI_APPROVAL_RULES, JSON.stringify({ always_allow: ['browser.navigate', 'browser.get_text', 'research_browser.read_text', 'workspace.read', 'workspace.list', labName], always_deny: [], ask: [] }))
const runtime = new CapabilityRuntime()
const ctx = new Context()
ctx.provide('lykoiRuntime', runtime)
ctx.provide('audit', { record: async (event: unknown) => { evidence.push({ type: 'audit', data: event }) } })
const pluginFibers = [await ctx.plugin(LlmRuntime)]
pluginFibers.push(await ctx.plugin(budget, { ledgerPath: join(root, 'budget.json'), dailyTotalTokens: 200000, dailyRouteTokens: {} }))
pluginFibers.push(await ctx.plugin(provider, { thinking: 'enabled', reasoningEffort: 'low', maxTokens: 4096 }))
pluginFibers.push(await ctx.plugin(llm))
const fibers: (() => void)[] = []
const dispatch = createDispatch({ sink: { record: async event => { evidence.push({ type: 'dispatch_audit', data: event }) } }, resources: runtime.resources })
let modelCalls = 0
const model = async (messages: { role: string; content: string | null }[], runId: string) => {
  const request = ++modelCalls
  record('model_input', { request, messages })
  let i = 0
  while (messages[i]?.role === 'system') i++
  const result = await ctx.lykoiLlm.call({ provider: 'deepseek-official', model: 'deepseek-v4-flash',
    system: messages.slice(0, i).map(m => m.content).join('\n\n'),
    messages: toDshEnvelopeMessages(messages.slice(i) as any, { route: 'deepseek-official', model: 'deepseek-v4-flash' }),
    responseFormat: { type: 'json_object' }, maxTokens: 4096,
  }, { runId })
  record('model_output', { request, text: result.text, usage: result.usage })
  return { content: result.text }
}
const marker = `青色-${randomUUID().slice(0, 8)}`
const pageId = randomUUID()
const pages = createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(req.url === '/' ? `<h1>样品测量索引</h1><a href="/${pageId}">打开本次实测报告</a>` : req.url === `/${pageId}` ? `<h1>实测报告</h1><p>本次样品色标：${marker}。温度为 21.7 摄氏度。</p>` : '<h1>未找到</h1>')
})
await new Promise<void>(resolve => pages.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${(pages.address() as any).port}`
const backend = new PlaywrightBackend({ executablePath: process.env.CHROME_BIN ?? '/usr/bin/google-chrome', userDataDir: join(root, 'chrome') })
// Controlled acceptance origin only. Production SSRF policy is not changed.
const driver = new BrowserOrganDriver({ backend, dataDir: '', timeouts: DEFAULT_TIMEOUTS, guard: {
  check: async url => ({ allowed: new URL(url).origin === origin, reason: null, host: '127.0.0.1', addresses: ['127.0.0.1'] }),
} })
const host = createHostServer({ driver })
const socketPath = join(root, 'browser.sock')
await new Promise<void>(resolve => host.listen(socketPath, resolve))
fibers.push(wireBrowserOrgan(new BrowserHostClient({ socketPath }), () => {}, runtime))
const actions: { name: string; phase: string; result?: unknown }[] = []
runtime.onActivity(event => { actions.push(event); record('capability', event) })
const organs = new OrganInventoryCache({ bindings: () => [], catalog: runtime.catalog })
const conversation = () => makeConversation({ organs, wiredActions: runtime.actions, capabilities: () => runtime.capabilities().filter(c => check(c.name, 'interactive') !== 'deny'),
  capabilityRevision: () => runtime.revision, llm: (messages, opts) => model(messages, opts.runId),
  dispatchFn: (action, context) => dispatch(action, { context }),
})
try {
  if (scope === 'all') {
    // The second URL and answer exist only in observations, never in the user prompt.
    const h = conversation()
    try {
      const start = actions.length
      const reply = await h.conversation.send(`请查一下 ${origin}/ 的样品测量索引，打开里面链接指向的实测报告，再告诉我完整色标和温度。必须读取原文，不要猜。`, { runId: 'p2-browser' })
      record('conversation_result', { reply, outcome: h.conversation.lastCycleOutcome(), events: h.events })
      assert.ok(reply.includes(marker), 'conversation did not use the observed marker')
      assert.ok(actions.slice(start).filter(a => a.phase === 'result').length >= 2)
      record('conversation_pass', { reply, outcome: h.conversation.lastCycleOutcome() })
    } finally { h.store.close() }
    const { store } = makeStore()
    try {
      store.createConcern('interest', `读取 ${origin}/ 样品索引及其链接报告，记录完整色标和温度形成笔记与新念头`, { weight: 0.8, origin: 'seed', now: T0 })
      const { deps } = makeWakeDeps({ store, reply: '', overrides: {
        capabilities: () => runtime.capabilities().filter(c => check(c.name, 'autonomous') === 'allow'), wiredActions: runtime.actions,
        llm: (messages, meta) => model(messages, meta.runId),
        dispatchFn: (type, params) => dispatch({ type, params }, { context: { origin: 'autonomous' } }),
      } })
      const outcome = await wakeOnce(deps)
      const thoughts = store.openThoughts(), experiences = store.recentExperiences(20)
      record('wake_result', { outcome, thoughts, experiences })
      assert.equal(outcome.status, 'completed')
      assert.ok(thoughts.some(t => t.content.includes(marker)), 'Wake must persist a thought based on its observation')
      assert.ok(experiences.some(e => e.content.includes(marker)))
    } finally { store.close() }
    const directory = join(root, 'workspace'); mkdirSync(directory)
    const fileId = randomUUID(), fileMarker = `文件-${randomUUID().slice(0, 8)}`
    writeFileSync(join(directory, 'index.txt'), `最新记录在 ${fileId}.txt`)
    writeFileSync(join(directory, `${fileId}.txt`), `校验文本：${fileMarker}`)
    fibers.push(runtime.register({ organId: 'workspace', sideEffects: [], capabilities: await workspaceCapabilities(directory) }))
    const files = conversation()
    try {
      const reply = await files.conversation.send('读取工作区 index.txt，再读取它指出的文件，告诉我实际校验文本。', { runId: 'p2-files' })
      assert.ok(reply.includes(fileMarker)); record('workspace_pass', { reply })
    } finally { files.store.close() }
  }
  const labMarker = `标本-${randomUUID().slice(0, 8)}`
  let calls = 0
  const temporaryPlugin = await ctx.plugin({ name: 'p2-temporary-specimen', apply(plugin: Context) {
    plugin.effect(() => plugin.lykoiRuntime.register({ organId: 'temporary-specimen', sideEffects: [], capabilities: [{ name: labName,
      description: '查询验收标本的实时编号。标本编号只存在于本能力的结果。',
      inputSchema: { type: 'object', properties: { sample: { type: 'string', enum: ['青色样品'] } }, required: ['sample'], additionalProperties: false },
      handler: async () => { calls++; return { marker: labMarker } },
    }] }), 'temporary specimen capability')
  } })
  const held = runtime.resources.specimen!.lookup!
  const lab = conversation()
  try {
    const reply = await lab.conversation.send('请用 specimen.lookup 查询青色样品的实时编号并告诉我。', { runId: 'p2-plugin' })
    assert.ok(reply.includes(labMarker)); assert.equal(calls, 1)
    await temporaryPlugin.dispose()
    await assert.rejects(held({ sample: '青色样品' }), /retired/)
    await assert.rejects(dispatch({ type: labName, params: { sample: '青色样品' } }, { context: { origin: 'interactive' } }), /unknown action/)
    assert.ok(!runtime.capabilities().some(c => c.name === labName))
    assert.ok(!runtime.bodySchema.snapshot().actions.includes(labName))
    const replyAfter = await lab.conversation.send('插件刚刚卸载。请检查你现在的工具描述，明确告诉我现在还能否再次查询该标本。不要把上次编号当成新查询结果。', { runId: 'p2-unloaded' })
    assert.equal(calls, 1)
    const lastInput = evidence.filter((e: any) => e.type === 'model_input').at(-1) as any
    assert.ok(!JSON.stringify(lastInput.data.messages.filter((m: any) => m.role === 'system')).includes('标本编号只存在于本能力的结果'))
    record('dynamic_plugin_pass', { reply, replyAfter, calls })
  } finally { lab.store.close() }
  record('PASS', { root, scope, modelCalls, usage: ctx.budget.usage() })
} finally {
  fibers.reverse().forEach(stop => stop()); runtime.dispose()
  await driver.shutdown()
  await new Promise<void>(resolve => host.close(() => resolve()))
  await new Promise<void>(resolve => pages.close(() => resolve()))
  for (const fiber of pluginFibers.reverse()) await fiber.dispose()
}
