/**
 * M3-W1 接线 e2e（出口判据）：converse 的 ConverseDispatchFn 已是真 kernel
 * dispatch（origin=interactive 由接线方盖章）—— 信封点名的工具经**真三层门**：
 * ① 默认 ask → needs_approval → S-57 deferred + 落痕沉默收场（问句机随 W2 审批
 *   器官），audit 上 action_dispatch(decision=ask)+action_result 对；
 * ② live always_allow 放行 → W1 替身器官大声失败 → error 结果回填、周期继续，
 *   audit 上 decision=allow 的 intent/result 对。
 * 全链：fake 入站 → 盖章 → 装配 → fake LLM 信封 → 真 kernel 门 → audit。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import * as budgetPlugin from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import * as mockAdapter from 'lykoi-llm/mock'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import { createStateFixture } from 'lykoi-memory/testing'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import { MAX_TOOL_STEPS } from '../src/index.ts'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function isolateKernelFiles(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-kernel-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  return dir
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

function fakeMemory(): LykoiMemoryService {
  const bindings: Record<string, BindingResolution> = {
    'telegram:1001': { userId: 'user_001', role: 'owner_primary', userStatus: 'active' },
  }
  return {
    regulationField: () => [],
    activeConcerns: () => [],
    openThoughts: () => [],
    recentHistory: () => [],
    recentExperiences: () => [],
    identityBinding: (channel, key) => bindings[`${channel}:${key}`],
    autonomyState: () => undefined,
  }
}

/** 全链装配（e2e.test.ts 的 assemble 同款；mock LLM 固定信封）。 */
async function assemble(replyText: string) {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-kernel-db-'))
  const dbPath = join(dir, 'state.db')
  createStateFixture(dbPath)
  seedBinding(dbPath)
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory())
  ctx.provide('telegramTransport', transport)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(budgetPlugin, {
    ledgerPath: join(dir, 'budget.json'),
    dailyTotalTokens: 1_000_000,
    dailyRouteTokens: {},
  })
  await ctx.plugin(lykoiLlm)
  await ctx.plugin(mockAdapter, {
    provider: 'mock',
    replyText,
    promptTokens: 210,
    completionTokens: 34,
  })
  await ctx.plugin(telegramAdapter, {
    cursorPath: join(dir, 'cursor.json'),
    archivePath: join(dir, 'inbound.json'),
    autoStart: false,
    pollTimeoutS: 25,
  })
  await ctx.plugin(converse, {
    dbPath,
    personaToml: PERSONA_TOML,
    route: 'mock',
    model: 'mock-model',
    restartMarker: join(dir, 'restart-marker.json'),
    narrativeFlag: '',
  })
  const telegram = ctx.get('telegram') as TelegramAdapterService
  return { audit, transport, telegram }
}

function toolEnvelope(name: string, args: Record<string, unknown>): string {
  return envelope({
    decision: {
      kind: 'tool_call',
      tool: { name, arguments: args },
      reason: '他问我在不在', // 逐字引用 assessment.item → 接地
    },
  })
}

test('①interactive 默认 ask：撞审批门 → deferred 落痕 + 沉默收场；audit 上 ask 的 intent/result 对', async () => {
  isolateKernelFiles()
  const { audit, transport, telegram } = await assemble(
    toolEnvelope('browser_navigate', { url: 'https://example.com/page' }),
  )
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 100, chatId: 'chat-1', senderId: '1001', text: '帮我打开那个网页' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  // 撞门：不执行、不发话（S-57 安全侧：落痕 + 沉默；问句机随 W2）。
  assert.deepEqual(transport.sends, [])
  const types = audit.events.map((e) => String(e.type))
  assert.ok(types.includes('cycle_approval_gate_unwired'))
  assert.ok(types.includes('converse/silence'))

  // 真门的账：action_dispatch(decision=ask, origin=interactive) + action_result。
  const intents = audit.events.filter((e) => e.type === 'action_dispatch')
  assert.equal(intents.length, 1)
  const intent = intents[0]!
  assert.equal(intent.action_type, 'browser.navigate')
  assert.equal(intent.origin, 'interactive') // 接线方盖章，永不由模型给
  assert.equal(intent.decision, 'ask')
  assert.equal(intent.pre_approved, false)
  assert.deepEqual(intent.params, { url: 'https://example.com/page' })
  const results = audit.events.filter((e) => e.type === 'action_result')
  assert.equal(results.length, 1)
  assert.equal(results[0]!.success, false)
  assert.equal(results[0]!.error, 'needs_approval')
  assert.equal(results[0]!.correlation_id, intent.correlation_id)
})

test('②live always_allow 放行：真门 allow → W1 替身器官大声失败 → error 回填周期继续（工具预算收场）', async () => {
  const dir = isolateKernelFiles()
  // Kevin 的笔：往 live 规则写一行 always_allow（她自己没有写路径 —— 测试站在
  // owner 侧铺规则文件）。
  writeFileSync(join(dir, 'approval_rules.json'), JSON.stringify({
    always_allow: ['research_browser.read_text'], always_deny: [], ask: [],
  }))
  const { audit, transport, telegram } = await assemble(
    toolEnvelope('research_read_text', { url: 'https://example.com/article' }),
  )
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 101, chatId: 'chat-1', senderId: '1001', text: '帮我读读那篇文章' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  // 固定信封 = 每步都想再动手 → 工具预算烧完，安全侧沉默收场。
  const types = audit.events.map((e) => String(e.type))
  assert.ok(types.includes('u3_cycle_tool_budget_exhausted'))
  assert.ok(!types.includes('cycle_approval_gate_unwired'))

  // 每一步都是真门放行 + 替身器官大声失败：intent(allow)/result(失败) 成对。
  const intents = audit.events.filter((e) => e.type === 'action_dispatch')
  const results = audit.events.filter((e) => e.type === 'action_result')
  assert.equal(intents.length, MAX_TOOL_STEPS)
  assert.equal(results.length, MAX_TOOL_STEPS)
  for (const [i, intent] of intents.entries()) {
    assert.equal(intent.action_type, 'research_browser.read_text')
    assert.equal(intent.origin, 'interactive')
    assert.equal(intent.decision, 'allow') // live 文件放的行（⑥），不是能力面
    assert.equal(results[i]!.success, false)
    assert.match(String(results[i]!.error), /器官未接线/)
  }
})
