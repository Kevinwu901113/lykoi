/**
 * 插件面接线测试：heart/beat 事件 → 一拍；lykoiLlm 词汇映射（system 槽收拢
 * 前导 system 段）；logEvent → audit（W2 TODO#4）；rw 句柄随 fiber 开合
 * （W1 TODO#9 定案）。全 fake 服务（心脏/LLM/audit），state 走合成 fixture。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import { DECIDE_SYSTEM_PROMPT } from 'lykoi-decide'
import type { HeartService } from 'lykoi-heart'
import type { LykoiLlmService } from 'lykoi-llm'
import { DatabaseSync } from 'node:sqlite'
import * as wake from '../src/index.ts'
import { makeStore } from './fixture.ts'

/** D-FIX-1：装配面只给路径（owner 域 TOML）；内容 = TEST_PERSONA 的文件形态。 */
const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

async function waitUntil(cond: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('waitUntil: timeout')
    await sleep(2)
  }
}

test('插件端到端：heart/beat → 六阶段一拍（fake heart/LLM/audit + 合成 state）', async () => {
  const { store, path } = makeStore()
  store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: new Date() })
  store.close() // 插件自己持有 rw 句柄（W1 TODO#9）

  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)

  let pendingBeats = 1
  const heart: Pick<HeartService, 'claim' | 'nextAt' | 'pending'> = {
    get pending() {
      return pendingBeats
    },
    get nextAt() {
      return new Date(Date.now() + 30 * 60_000).toISOString()
    },
    claim() {
      const beats = pendingBeats
      pendingBeats = 0
      return { beats }
    },
  }
  ctx.provide('heart', heart)

  const llmCalls: { system: string | undefined; messageCount: number; runId: string }[] = []
  const llm: Pick<LykoiLlmService, 'call'> = {
    async call(options, meta) {
      llmCalls.push({
        system: options.system,
        messageCount: options.messages.length,
        runId: meta.runId,
      })
      return { text: JSON.stringify({ decision: { kind: 'rest', reason: '就想歇着' } }), reasoningLength: 0 }
    },
  }
  ctx.provide('lykoiLlm', llm)

  const fiber = await ctx.plugin(wake, {
    dbPath: path,
    personaToml: PERSONA_TOML,
    route: 'mock',
    model: 'mock-model',
    checkIntervalMs: 3_600_000, // cheap tick 驱动不进本测试
  })
  assert.ok(ctx.get('wake'), 'wake 服务在位')

  ctx.emit('heart/beat', { source: 'interval', pending: 1, at: new Date().toISOString() })
  await waitUntil(() => audit.events.some((e) => e.type === 'autonomy_wake'))

  // LLM 词汇映射：前导 system 段（persona 内核 + decide 契约）收进 system 槽；
  // user 快照是唯一 message；runId 贯穿。
  assert.equal(llmCalls.length, 1)
  assert.ok(llmCalls[0]!.system!.includes(DECIDE_SYSTEM_PROMPT))
  assert.ok(llmCalls[0]!.system!.includes('我是 Lykoi'))
  assert.equal(llmCalls[0]!.messageCount, 1)

  // 拍的账面落在 state 副本：completed run + 两条经验。
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const run = db.prepare('SELECT status, id FROM autonomy_runs').get() as { status: string; id: string }
    assert.equal(run.status, 'completed')
    assert.equal(llmCalls[0]!.runId, run.id, 'budget runId 贯穿（SA-172）')
    const n = (db.prepare('SELECT COUNT(*) AS n FROM experiences').get() as { n: number }).n
    assert.equal(n, 2, 'wake_action + action_result')
  } finally {
    db.close()
  }

  // W2 TODO#4：事件注入位统一收到 audit.record（type=事件名）。
  const types = audit.events.map((e) => e.type)
  assert.ok(types.includes('wake_inner_applied'))
  assert.ok(types.includes('autonomy_wake'))

  // 再 emit 一次：claim=0 → idle，不再有新 run。
  ctx.emit('heart/beat', { source: 'interval', pending: 1, at: new Date().toISOString() })
  await sleep(20)
  const db2 = new DatabaseSync(path, { readOnly: true })
  try {
    assert.equal((db2.prepare('SELECT COUNT(*) AS n FROM autonomy_runs').get() as { n: number }).n, 1)
  } finally {
    db2.close()
  }

  await fiber.dispose() // rw 句柄随 fiber 关（可逆副作用）
  assert.equal(ctx.get('wake'), undefined)
})

test('W5 接线：restart 权威源（SA-165 第一拍浮出、第二拍消化）+ G-7 器官清单真源入自主侧', async () => {
  const { store, path } = makeStore()
  // 器官身份轴真源：identity_bindings 登记一条 owner 绑定（channel_key 不出读面）。
  const { DatabaseSync: Raw } = await import('node:sqlite')
  const raw = new Raw(path)
  raw.prepare(
    `INSERT INTO identity_bindings (user_id, channel, channel_key, verified_by, created_at)
     VALUES ('user_001', 'telegram', '1001', 'owner_console', '2026-08-24T00:00:00+00:00')`,
  ).run()
  raw.close()
  // restart 事件（W5 生产者）：她睡了一觉刚醒。
  const { recordRestartEvent } = await import('lykoi-snapshot')
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  recordRestartEvent(store, {
    markerPath: join(mkdtempSync(join(tmpdir(), 'lykoi-wake-restart-')), 'marker.json'),
    now: new Date(),
  })
  store.close()

  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  let pendingBeats = 1
  ctx.provide('heart', {
    get pending() {
      return pendingBeats
    },
    get nextAt() {
      return new Date(Date.now() + 30 * 60_000).toISOString()
    },
    claim() {
      const beats = pendingBeats
      pendingBeats = 0
      return { beats }
    },
  } satisfies Pick<HeartService, 'claim' | 'nextAt' | 'pending'>)

  const captured: { system?: string; userText: string }[] = []
  ctx.provide('lykoiLlm', {
    async call(options) {
      const first = options.messages[0]!.content[0] as { type: string; text?: string }
      captured.push({
        ...(options.system === undefined ? {} : { system: options.system }),
        userText: first.text ?? '',
      })
      return { text: JSON.stringify({ decision: { kind: 'rest', reason: '就想歇着' } }), reasoningLength: 0 }
    },
  } satisfies Pick<LykoiLlmService, 'call'>)

  const fiber = await ctx.plugin(wake, {
    dbPath: path,
    personaToml: PERSONA_TOML,
    route: 'mock',
    model: 'mock-model',
    checkIntervalMs: 3_600_000,
  })

  ctx.emit('heart/beat', { source: 'interval', pending: 1, at: new Date().toISOString() })
  await waitUntil(() => audit.events.some((e) => e.type === 'autonomy_wake'))

  // G-7：器官清单进自主侧 system 槽（独处的她也知道自己长着什么）；
  // D5：寻址标识（chat id）零出现。
  assert.ok(captured[0]!.system!.includes('[器官清单(只读)]'))
  assert.ok(captured[0]!.system!.includes('- telegram: owner — 所有者, 也是你的主用户'))
  assert.equal(captured[0]!.system!.includes('1001'), false, 'channel_key 不进任何呈现面')
  // SA-165：重启后第一拍快照带「刚刚醒来」。
  assert.ok(captured[0]!.userText.includes('刚刚醒来'))
  assert.ok(captured[0]!.userText.includes('这是你第一次醒来（没有更早的启动记录）。'))

  // 第二拍：last_wake_at 已推进 → 事件被消化，键不再出现（严格大于语义）。
  pendingBeats = 1
  ctx.emit('heart/beat', { source: 'interval', pending: 1, at: new Date().toISOString() })
  await waitUntil(() => captured.length >= 2)
  assert.equal(captured[1]!.userText.includes('刚刚醒来'), false)

  await fiber.dispose()
})
