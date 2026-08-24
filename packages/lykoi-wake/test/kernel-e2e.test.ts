/**
 * M3-W1 接线 e2e（出口判据）：自主拍 explore / initiate_chat / queue_notification
 * 三路经**真 kernel 门**落 audit —— wake 插件的 DispatchFn 已是 createDispatch
 * 真身（origin=autonomous 由接线方盖章、runId 贯穿），每次外部动作在 immutable
 * sink 上留 action_dispatch（decision=allow，能力面④放行）+ action_result 对。
 * 资源仍是 W1 显式替身（器官未接线 → 大声失败 → 她拿到失败经验），三道门与
 * 审计闭合先于器官成立。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import type { HeartService } from 'lykoi-heart'
import type { LykoiLlmService } from 'lykoi-llm'
import { DatabaseSync } from 'node:sqlite'
import * as wake from '../src/index.ts'
import type { WakeService } from '../src/index.ts'
import { makeStore, TEST_PERSONA } from './fixture.ts'

function isolateKernelFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-kernel-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
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

test('三路自主动作经真门：action_dispatch(allow)+action_result 对、origin=autonomous、runId 贯穿', async () => {
  isolateKernelFiles()
  const { store, path } = makeStore()
  store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: new Date() })
  store.close() // 插件自己持有 rw 句柄

  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)

  let pendingBeats = 0
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

  // 三拍脚本：explore（带 url）→ initiate_chat → queue_notification。
  // 每个决定引用快照里的关切#1（meaning_assessment 接地 —— 否则 fail-closed
  // 降级 rest，SA-21），reason 含 assessment 条目原文。
  const grounded = (decision: Record<string, unknown>) => JSON.stringify({
    meaning_assessment: [{ item: '关切#1 词源学', meaning: '想推进它', concern_id: 1, pull: 0.5 }],
    decision: { reason: '关切#1 词源学 在拉我', ...decision },
  })
  const replies = [
    grounded({ kind: 'explore', url: 'https://example.com/read' }),
    grounded({ kind: 'initiate_chat', content: '想跟你说件事' }),
    grounded({ kind: 'queue_notification', content: '留一条话' }),
  ]
  let call = 0
  const llm: Pick<LykoiLlmService, 'call'> = {
    async call() {
      const text = replies[call]!
      call += 1
      return { text }
    },
  }
  ctx.provide('lykoiLlm', llm)

  const fiber = await ctx.plugin(wake, {
    dbPath: path,
    persona: {
      identity: { ...TEST_PERSONA.identity },
      voice: { ...TEST_PERSONA.voice },
      relationship: { ...TEST_PERSONA.relationship },
      personality: { traits: [...TEST_PERSONA.personality.traits], evolves: true },
      interests: { seeds: [...TEST_PERSONA.interests.seeds] },
    },
    route: 'mock',
    model: 'mock-model',
    checkIntervalMs: 3_600_000,
  })
  const service = ctx.get('wake') as WakeService

  const outcomes = []
  for (let i = 0; i < replies.length; i++) {
    pendingBeats = 1
    outcomes.push(await service.beat())
  }
  // 器官未接线：三拍都以 failed **决策结果**收场（不是拍级崩溃 —— 门与账在先）。
  assert.deepEqual(outcomes.map((o) => o.status), ['failed', 'failed', 'failed'])
  assert.deepEqual(outcomes.map((o) => o.decision), ['explore', 'initiate_chat', 'queue_notification'])

  // 三对 intent/result 落在 immutable sink（同一 lykoi-audit 服务）。
  const intents = audit.events.filter((e) => e.type === 'action_dispatch')
  const results = audit.events.filter((e) => e.type === 'action_result')
  assert.deepEqual(intents.map((e) => e.action_type), [
    'research_browser.read_text', 'autonomy.initiate_chat', 'autonomy.queue_notification',
  ])
  assert.equal(results.length, 3)
  const runIds = new Set<string>()
  for (const [i, intent] of intents.entries()) {
    assert.equal(intent.origin, 'autonomous') // 接线方盖章，永不由模型给
    assert.equal(intent.decision, 'allow') // 能力面④：三动作都在 AUTONOMOUS_ALLOWED
    assert.equal(intent.pre_approved, false)
    assert.equal(intent.exemption, null)
    assert.equal(typeof intent.run_id, 'string')
    runIds.add(intent.run_id as string)
    const result = results[i]!
    assert.equal(result.correlation_id, intent.correlation_id)
    assert.equal(result.run_id, intent.run_id)
    assert.equal(result.success, false) // 替身器官大声失败
    assert.match(String(result.error), /器官未接线/)
  }
  assert.equal(runIds.size, 3) // 一拍一个 run_id 贯穿

  // params 是 redacted 副本形态（explore 的 url 原样可见 —— 无密钥即无遮蔽）。
  assert.deepEqual(intents[0]!.params, { url: 'https://example.com/read' })

  // runId 与 autonomy_runs 台账对上（audit 链 ↔ 她的拍账同键）。
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare('SELECT id FROM autonomy_runs ORDER BY started_at').all() as { id: string }[]
    assert.deepEqual(new Set(rows.map((r) => r.id)), runIds)
    // 她的失败经验落账（没有结果也是结果）：三拍各 wake_action + action_result。
    const n = (db.prepare('SELECT COUNT(*) AS n FROM experiences').get() as { n: number }).n
    assert.equal(n, 6)
  } finally {
    db.close()
  }

  // GT-4 同门佐证：autonomous 面外动作在同一门上是 deny —— 经插件同款 dispatch
  // 不可达路径由 kernel 测试钉；此处断言三路都没有旁路（audit 之外零通道）。
  assert.equal(audit.events.filter((e) => e.type === 'delegation_context_invalid').length, 0)

  await fiber.dispose() // rw 句柄与 cheap tick 定时器随 fiber 关（可逆副作用）
})
