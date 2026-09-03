/**
 * tool_calls wire 原生映射收口（M2 遗留 #13 → M3-W2）。
 *
 * 断言的是**接线层**（index.ts 的 toDshMessage）把她的合成 tool_calls 帧映成
 * dsh 词汇的原生形态：assistant 帧带 `tool-call` block、结果帧是
 * `createToolResultMessage`（callId 绑回那次调用），而不是从前那两条折文本
 * （`[tool_calls] …` / `[工具结果] …`）。折文本会把"她决定动手"从结构降级成
 * 一句散文，对面模型看到的不是一次调用。
 *
 * 手法：注册一个**捕获型** adapter（照 lykoi-llm/mock 的形态），把每次
 * GenerateOptions 原样留下来，然后看第二次调用（第一次之后才有工具帧）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import * as budgetPlugin from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import { createStateFixture } from 'lykoi-memory/testing'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import * as converse from '../src/index.ts'
import { envelope, seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

/** 照抄真身（lykoi-llm-deepseek vendor）的 off 档形态，供 resolveModel 声明。 */
const OFF_REASONING_EFFORT = ReasoningEffortId('off')

class CapturingAdapter extends LlmAdapter {
  seen: GenerateOptions[] = []
  #reply: string

  constructor(reply: string) {
    super()
    this.#reply = reply
  }

  /**
   * D-1（WO-FIX-TOOLSTEP-01）：第二次起的信封调用会带 `reasoningEffort:'off'`
   * （dsh-llm 的 resolveCallWithInfo 要求 adapter 在 resolveModel 里报告过
   * 这个档位才放行），照真身形态声明，否则本测试的第二次调用会假摔成
   * LlmFinishError。
   */
  resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({
      provider,
      id: model,
      name: model,
      // 不给 defaultEffort：见 lykoi-llm/src/mock.ts 同款注释——否则 dsh-llm
      // 会在 step 0（没请求 reasoningEffort）也把这个键材化进 resolved
      // config，盖掉「D-1 只在 step>=1 才带这个键」这条断言要测的那一层。
      reasoning: {
        efforts: [{ id: OFF_REASONING_EFFORT, name: 'off' }],
      },
    })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.seen.push(options)
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: this.#reply }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: this.#reply } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return { events, async record(event) { events.push(event) } }
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

test('M2#13 收口：assistant tool_calls → dsh `tool-call` block；tool 结果 → tool-result 帧（callId 成对）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-wire-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  // Kevin 的笔：放行一个免询动作，好让周期走到**第二次**调用（第一次的历史里
  // 还没有工具帧）。
  writeFileSync(join(dir, 'approval_rules.json'), JSON.stringify({
    always_allow: ['research_browser.read_text'], always_deny: [], ask: [],
  }))

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
  const adapter = new CapturingAdapter(envelope({
    decision: {
      kind: 'tool_call',
      tool: { name: 'research_read_text', arguments: { url: 'https://example.com/a' } },
      reason: '他问我在不在',
    },
  }))
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(telegramAdapter, {
    cursorPath: join(dir, 'cursor.json'),
    archivePath: join(dir, 'inbound.json'),
    autoStart: false,
    pollTimeoutS: 25,
  })
  await ctx.plugin(converse, {
    dbPath, personaToml: PERSONA_TOML, route: 'mock', model: 'mock-model',
    restartMarker: join(dir, 'restart-marker.json'), narrativeFlag: '',
    restartRepoRoot: '', restartUnit: '', // M3-W4：dev/测试不采 git HEAD
    notificationOutboxDelivery: false, // GK-8 默认关
    // D-01 三旋钮（M4-W1）：与 cordis.prod.yml 同数；缺省也是这三个。
    interpretTimeoutS: 30,
    interpretRetries: 1,
    cycleTimeoutS: 180,
    // vision 位：M4 定案显式 disabled（零真模型调用）。
    visionRoute: "disabled",
    visionModel: "disabled",

  })
  const telegram = ctx.get('telegram') as TelegramAdapterService
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 900, chatId: '1001', senderId: '1001', text: '帮我读读那篇' },
  })
  assert.equal(await telegram.pollOnce(), 1)

  assert.ok(adapter.seen.length >= 2, '需要至少两次调用才看得到历史里的工具帧')
  const second = adapter.seen[1]!
  const blocks = second.messages.flatMap((m) => m.content)
  const toolCalls = blocks.filter((b) => b.type === 'tool-call')
  const toolResults = blocks.filter((b) => b.type === 'tool-result')
  assert.ok(toolCalls.length > 0, 'assistant 帧必须带原生 tool-call block')
  assert.equal(toolCalls.length, toolResults.length) // 成对
  const call = toolCalls[0]!
  assert.equal(call.name, 'research_read_text')
  assert.equal(JSON.parse(call.arguments).url, 'https://example.com/a')
  assert.equal(toolResults[0]!.toolCallId, call.id) // callId 绑回那次调用
  assert.equal(toolResults[0]!.isError, false)

  // 折文本的两条形态**一个都不许再出现**
  const allText = JSON.stringify(second.messages)
  assert.ok(!allText.includes('[tool_calls]'))
  assert.ok(!allText.includes('[工具结果]'))

  // --- M4-W1 同批：装配面的两件事在**同一次真装配**里核 ---
  // ① D-01 的 AbortSignal 形态通到 wire：周期那条边的 signal 递进
  //    `GenerateOptions.signal`，撞线时这一跳真的断（不是只有上面不等了）。
  const withSignal = adapter.seen.filter((o) => o.signal instanceof AbortSignal)
  assert.equal(withSignal.length, adapter.seen.length, '每一次信封调用都要带周期 signal')
  assert.equal(adapter.seen[0]!.signal!.aborted, false, '没撞线就不该是 aborted')
  // ③ WO-FIX-TOOLSTEP-01 D-1：`reasoningEffort:'off'` 真的通到 dsh 的
  //    GenerateOptions 这一跳（不只是 lykoi-converse 内部的 opts 对象）——
  //    第一次调用（step 0）一个字都不带这个键，第二次（step>=1，历史里已有
  //    工具帧）恒为 'off'。
  assert.equal('reasoningEffort' in adapter.seen[0]!, false)
  assert.equal(adapter.seen[1]!.reasoningEffort, 'off')
  // ② vision 位读到的是**显式 disabled**（装配期落一条，运维看得见这是决定）。
  const seam = audit.events.filter((e) => e.type === 'vision_seam_state')
  assert.equal(seam.length, 1)
  assert.equal(seam[0]!.state, 'disabled')
  assert.equal(seam[0]!.route_set, true)
})
