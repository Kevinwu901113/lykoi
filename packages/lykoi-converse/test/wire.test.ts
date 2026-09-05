/**
 * tool_calls wire 映射（M2 遗留 #13 → M3-W2 → WO-FIX-TOOLFRAME-01 翻面）。
 *
 * M3-W2 当年把这一跳收口成 dsh 词汇的**原生形态**（assistant 帧带 `tool-call`
 * block、结果帧是 `createToolResultMessage`），理由是折文本会把"她决定动手"
 * 从结构降级成散文。这条理由本身没错，但探针 v3/v4（2026-09-03）实测：历史
 * 里一旦出现原生 tool-call/tool-result 帧，DeepSeek adapter 会退化——
 * json_object 遇到就吐 65 个空格、reasoning_content 回传时 400、无 json 时
 * 把 DSML 原生工具调用标记直接泄漏进 content。三病同源，根就是这一跳的原生
 * 渲染。WO-FIX-TOOLFRAME-01 D-1 把它换回**文本帧**：assistant 一条文本帧
 * （信封 JSON.stringify）、工具结果一条 user 文本帧（`[工具结果 <name>] …`）。
 * `#messages` 内部形状（role 'assistant'/tool_calls、role 'tool'/
 * tool_call_id）一字不动——只是发给 dsh-llm 那一跳换了渲染。
 *
 * 本文件断言三层：① 接线层（index.ts 的 `toDshEnvelopeMessages`，模块级导出
 * 纯为可测性）把合成 tool_calls/tool 帧渲染成文本帧、不再出现原生 block；
 * ② id→工具名解析（含找不到时回退 id）与 DSML 剥净这两条防御分支；③ 用完全
 * 绕开 index.ts 的 `makeConversation`/`FakeLlm` 夹具证明 `#messages` 本身没变
 * （D-2）。①走真实 ctx/plugin 装配（捕获型 adapter，照 lykoi-llm/mock 的
 * 形态），②③是轻量单测。
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
import { toDshEnvelopeMessages, type ConverseMessage } from '../src/index.ts'
import { FIXTURE_PERSONA_TOML, envelope, seedBinding, makeConversation } from './fixture.ts'

const PERSONA_TOML = FIXTURE_PERSONA_TOML

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

test('WO-FIX-TOOLFRAME-01 D-4 翻面：assistant tool_calls → assistant 文本帧（信封 JSON）；tool 结果 → user 文本帧（[工具结果 <name>] 前缀）；无原生 tool-call/tool-result block；契约 system 仍最后一条', async () => {
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
  // D-1 翻面的核心断言：dsh 原生 tool-call/tool-result block 一个都不许出现——
  // 这两种 block 正是探针 v3/v4 定位到的三病同源（json_object 遇到就空白、
  // reasoning_content 回传 400、DSML 泄漏）。
  assert.equal(toolCalls.length, 0, 'assistant 帧不许再带原生 tool-call block')
  assert.equal(toolResults.length, 0, '工具结果不许再是原生 tool-result 帧')

  // assistant 文本帧：正文是契约 tool_call 信封形状的 JSON，内容与 cycleCall
  // 造的那次调用一致（tool.name / tool.arguments）。用 findIndex 定位而不是
  // 硬编码「倒数第 N 条」——`#volatileTail`（S-25：相关记忆/念头/**当前时间**/
  // 有话没送出去/self-state）在契约之前恒插一条 `[当前时间] …` system 帧，
  // 这条帧与本单无关但确实占了一个位置，所以「倒数第三/二条」在这份 fixture
  // 下实测是「倒数第四/三条」——按内容定位，断言不随易变尾部的长度漂移。
  const assistantIdx = second.messages.findIndex((m) => {
    if (m.role !== 'assistant' || m.content.length !== 1 || m.content[0]!.type !== 'text') return false
    try {
      const parsed = JSON.parse((m.content[0] as { text: string }).text)
      return parsed?.decision?.kind === 'tool_call'
    } catch {
      return false
    }
  })
  assert.ok(assistantIdx >= 0, '必须能找到一条 assistant 文本帧，正文是 tool_call 信封')
  const assistantMsg = second.messages[assistantIdx]!
  const assistantEnvelope = JSON.parse((assistantMsg.content[0]! as { text: string }).text)
  assert.equal(assistantEnvelope.decision.tool.name, 'research_read_text')
  assert.equal(assistantEnvelope.decision.tool.arguments.url, 'https://example.com/a')

  // 工具结果紧跟在 assistant 那条**正后面**（S-29：调用与结果同生共死、相邻
  // 成对）：user 文本帧，`[工具结果 research_read_text] ` 前缀 + 工具帧原文
  // （fixture 里 tool 帧内容 = kernel dispatch 的回执文本，本条只核前缀，不
  // 重复断言回执正文的完整形状）。
  const toolResultMsg = second.messages[assistantIdx + 1]!
  assert.equal(toolResultMsg.role, 'user')
  assert.equal(toolResultMsg.content.length, 1)
  const toolResultText = (toolResultMsg.content[0]! as { type: 'text'; text: string }).text
  assert.ok(
    toolResultText.startsWith('[工具结果 research_read_text] '),
    `期望 [工具结果 research_read_text] 前缀，实际：${toolResultText.slice(0, 60)}`,
  )

  // 最后一条：契约 system（CACHE-INVERT 不破——契约必须留在生成点前的最后
  // 位置，不因 D-1 换了工具帧渲染就挪位）。用契约文本的固定开头核实这条
  // 确实是契约本身，不是易变尾部的其它 system 帧。
  const lastMsg = second.messages.at(-1)!
  assert.equal(lastMsg.role, 'system')
  const lastText = (lastMsg.content[0]! as { type: 'text'; text: string }).text
  assert.ok(lastText.startsWith('上面是你此刻的全部处境'), '契约必须是生成点前最后一条')

  // 折文本的三种历史形态**一个都不许再出现**：M3-W2 之前的老折文本
  // （`[tool_calls]`）、裸 `[工具结果]`（没有 name，本单要求必须带 name）。
  const allText = JSON.stringify(second.messages)
  assert.ok(!allText.includes('[tool_calls]'))
  assert.ok(!allText.includes('[工具结果]'))

  // --- M4-W1 同批：装配面的两件事在**同一次真装配**里核 ---
  // ① D-01 的 AbortSignal 形态通到 wire：周期那条边的 signal 递进
  //    `GenerateOptions.signal`，撞线时这一跳真的断（不是只有上面不等了）。
  const withSignal = adapter.seen.filter((o) => o.signal instanceof AbortSignal)
  assert.equal(withSignal.length, adapter.seen.length, '每一次信封调用都要带周期 signal')
  assert.equal(adapter.seen[0]!.signal!.aborted, false, '没撞线就不该是 aborted')
  // ③ WO-FIX-TOOLSTEP-01 D-1（WO-FIX-THINKPOLICY-01 D-5 翻面）：这一位测的
  //    始终是「converse 到底往 dsh 的 GenerateOptions 上放了什么」，而不只是
  //    lykoi-converse 内部那个 opts 对象。TOOLSTEP-01 时的读数是 step 0 不带
  //    键、step>=1 恒 'off'；THINKPOLICY-01 D-3 撤掉了那个 per-step 覆盖
  //    （它绕的 400 已由 TOOLFRAME-01 根除），推理档位只剩 adapter 一个主人，
  //    于是**两跳都不带这个键** —— 档位由 profile 的显式 config 决定，
  //    converse 这一层不许再改口。
  assert.equal('reasoningEffort' in adapter.seen[0]!, false)
  assert.equal('reasoningEffort' in adapter.seen[1]!, false)
  // ② vision 位读到的是**显式 disabled**（装配期落一条，运维看得见这是决定）。
  const seam = audit.events.filter((e) => e.type === 'vision_seam_state')
  assert.equal(seam.length, 1)
  assert.equal(seam[0]!.state, 'disabled')
  assert.equal(seam[0]!.route_set, true)
})

// --- WO-FIX-TOOLFRAME-01 D-4①②：toDshEnvelopeMessages 的两条防御分支 --------
//
// 直接单测这个模块级导出的纯函数（不经 ctx/plugin 装配）：provider 显式传参，
// 输入是 ConverseMessage[]（#messages 的原生形状），断言渲染出的文本帧。

test('WO-FIX-TOOLFRAME-01 D-4①：工具结果帧的 name 按 id 从预建映射解析；解析不到回退成 tool_call_id', () => {
  const provider = { route: 'mock', model: 'mock-model' }

  // 正常路：assistant tool_calls 帧就在同一份 sliced 数组里，id 对得上。
  const paired: ConverseMessage[] = [
    { role: 'user', content: '帮我读读那篇' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-abc', type: 'function', function: { name: 'research_read_text', arguments: '{"url":"https://a"}' } }],
    },
    { role: 'tool', content: '文章正文', tool_call_id: 'call-abc' },
  ]
  const pairedOut = toDshEnvelopeMessages(paired, provider)
  const pairedText = (pairedOut[2]!.content[0]! as { type: 'text'; text: string }).text
  assert.equal(pairedText, '[工具结果 research_read_text] 文章正文')

  // 找不到路：tool_call_id 在 sliced 数组里没有任何匹配的 assistant tool_calls
  // 帧（理论上不会发生——S-29 裁剪配对成对进出，出现即说明配对被破坏了）。
  // 回退成 tool_call_id 本身，而不是留空字符串或抛错——工具结果这一帧的语义
  // 比好看更要紧，宁可显示一个丑 id。
  const orphan: ConverseMessage[] = [
    { role: 'user', content: '帮我读读那篇' },
    { role: 'tool', content: '文章正文', tool_call_id: 'call-orphan-999' },
  ]
  const orphanOut = toDshEnvelopeMessages(orphan, provider)
  const orphanText = (orphanOut[1]!.content[0]! as { type: 'text'; text: string }).text
  assert.equal(orphanText, '[工具结果 call-orphan-999] 文章正文')
})

test('WO-FIX-TOOLFRAME-01 D-4②：工具结果含 DSML 机器标记时，user 文本帧已剥净（S-32）', () => {
  const provider = { route: 'mock', model: 'mock-model' }
  const dsmlContent = '<｜｜DSML｜｜tool_calls>{"name":"x","arguments":"{}"}</｜｜DSML｜｜tool_calls>剩余正文'
  const sliced: ConverseMessage[] = [
    { role: 'user', content: '帮我读读那篇' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'research_read_text', arguments: '{"url":"https://a"}' } }],
    },
    { role: 'tool', content: dsmlContent, tool_call_id: 'call-1' },
  ]
  const out = toDshEnvelopeMessages(sliced, provider)
  const text = (out[2]!.content[0]! as { type: 'text'; text: string }).text
  assert.ok(!text.includes('｜｜DSML｜｜'), '机器标记不许经工具结果回灌回上下文')
  assert.equal(text, '[工具结果 research_read_text] 剩余正文')
})

// --- WO-FIX-TOOLFRAME-01 D-4③：#messages 内部形状不受 D-1 影响（D-2） --------
//
// `makeConversation`/`FakeLlm`（test/fixture.ts）完全绕开 index.ts 的
// wire 渲染——`h.llm.calls[i].messages` 就是 Conversation 内部喂给
// `ConverseLlmFn` 的原始 `ConverseMessage[]`。用它直接摸 `#messages`，证明
// `#executeCycleTool`/`#appendToolResult` 仍然 push 原生 role 'assistant'/
// tool_calls 与 role 'tool'/tool_call_id（D-2：本单一个字都没改这一层）。

test('WO-FIX-TOOLFRAME-01 D-4③：#messages 内部仍是原生 role tool / tool_calls 形状', async () => {
  const h = makeConversation({
    dispatchFn: async () => ({ success: true, data: { ok: true } }),
  })
  h.llm.push({ content: envelope({
    decision: {
      kind: 'tool_call',
      tool: { name: 'research_read_text', arguments: { url: 'https://a' } },
      reason: '他问我在不在',
    },
  }) })
  h.llm.push({ content: envelope({ decision: { kind: 'reply', content: '看完了', reason: '他问我在不在' } }) })
  const reply = await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(reply, '看完了')
  assert.equal(h.llm.calls.length, 2)

  const secondMessages = h.llm.calls[1]!.messages
  const toolCallMsg = secondMessages.find((m) => m.role === 'assistant' && m.tool_calls !== undefined)
  assert.ok(toolCallMsg, 'D-2：#executeCycleTool 仍 push {role:"assistant", content:null, tool_calls:[call]}')
  assert.equal(toolCallMsg!.content, null)
  assert.equal(toolCallMsg!.tool_calls![0]!.function.name, 'research_read_text')
  const callId = toolCallMsg!.tool_calls![0]!.id
  const toolResultMsg = secondMessages.find((m) => m.role === 'tool' && m.tool_call_id === callId)
  assert.ok(toolResultMsg, 'D-2：#appendToolResult 仍 push {role:"tool", tool_call_id, content}')
})
