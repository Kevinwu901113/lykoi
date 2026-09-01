/**
 * WO-LLM-FINISH-01 调用点落点实证（converse 侧）。
 *
 * 断言的不是 lykoi-llm 自己（那在 packages/lykoi-llm/test/llm.test.ts），而是
 * **新抛出的 LlmFinishError 落进 converse 既有的失败处理路径**：
 * 一次真装配（真 LlmRuntime + 真 budget + 真 converse 接线），adapter 以
 * `finish{error}` 收尾 →
 *   ① 回合在 `converse/turn_failed` 那一支被接住（handleTurn 的既有 catch），
 *      错误类别是 LlmFinishError，不是从前的「空 text 继续跑」；
 *   ② S-14 整轮回滚照常发生（chat_turn_rolled_back）；
 *   ③ budget 照样记了账（charge 先于抛出 —— 记账口径不变）；
 *   ④ pollOnce 正常返回，没有新的 unhandled rejection 面。
 *
 * 手法照抄 wire.test.ts 的真装配（同一套 fixture / env 隔离）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import * as budgetPlugin from 'lykoi-budget'
import * as lykoiLlm from 'lykoi-llm'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import { createStateFixture } from 'lykoi-memory/testing'
import * as telegramAdapter from 'lykoi-adapter-telegram'
import type { TelegramAdapterService } from 'lykoi-adapter-telegram'
import { MemoryTelegramTransport } from 'lykoi-adapter-telegram/testing'
import * as converse from '../src/index.ts'
import { seedBinding } from './fixture.ts'

const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

/**
 * 事故现场的形状：LlmRuntime 把 adapter 的选路失败归一成
 * `finish{kind:'error', failure:{code:'NO_ADAPTER'}}`，一个字都不外抛，
 * text 是空串。
 */
class FailingFinishAdapter extends LlmAdapter {
  calls = 0

  async *stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 0 } }
    yield {
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'no adapter registered for provider "mock"', code: 'NO_ADAPTER' },
      },
    }
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

test('WO-LLM-FINISH-01 落点：finish{error} → converse 既有失败路（turn_failed=LlmFinishError），charge 仍发生', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-converse-finish-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  writeFileSync(join(dir, 'approval_rules.json'), JSON.stringify({
    always_allow: [], always_deny: [], ask: [],
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
  const adapter = new FailingFinishAdapter()
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
    restartRepoRoot: '', restartUnit: '',
    notificationOutboxDelivery: false,
    interpretTimeoutS: 30,
    interpretRetries: 1,
    cycleTimeoutS: 180,
    visionRoute: 'disabled',
    visionModel: 'disabled',
  })
  const telegram = ctx.get('telegram') as TelegramAdapterService
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 900, chatId: '1001', senderId: '1001', text: '在吗' },
  })
  // ④ 入站这一跳照常返回 —— 新抛错没有制造新的 unhandled rejection 面。
  assert.equal(await telegram.pollOnce(), 1)
  assert.equal(adapter.calls, 1, '调用发生过（不是被闸拦下）')

  // ① 既有失败路：handleTurn 的 catch → converse/turn_failed，类别可辨。
  const failed = audit.events.filter((e) => e.type === 'converse/turn_failed')
  assert.equal(failed.length, 1)
  assert.equal(failed[0]!.error, 'LlmFinishError', '失败在唯一入口层就有名字')

  // ② S-14 回滚照常（失败回合不留半截轮）。
  assert.ok(
    audit.events.some((e) => e.type === 'chat_turn_rolled_back'),
    '既有回滚路径原样成立',
  )

  // ③ 记账仍然发生：charge 先于抛出（口径一个字不变）。
  const charges = audit.events.filter((e) => e.type === 'budget/charge')
  assert.equal(charges.length, 1)
  assert.equal(charges[0]!.route, 'mock')
  assert.equal(charges[0]!.promptTokens, 10)
  assert.equal(charges[0]!.completionTokens, 0)

  // 从前的病灶：空 text 被当作正常返回，周期在解码空串时才炸成 not_json。
  // 现在这条事件一条都不该出现 —— 失败在入口层就近发生。
  assert.equal(
    audit.events.filter((e) => e.type === 'u3_cycle_failed').length,
    0,
    '根因不再晚两层才以「解码空串」的形态出现',
  )
})
