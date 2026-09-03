/**
 * M3-W1/W3 接线 e2e（出口判据）：自主拍 explore / initiate_chat / queue_notification
 * 三路经**真 kernel 门**落 audit —— wake 插件的 DispatchFn 是 createDispatch
 * 真身（origin=autonomous 由接线方盖章、runId 贯穿），每次外部动作在 immutable
 * sink 上留 action_dispatch（decision=allow，能力面④放行）+ action_result 对。
 *
 * **W3 换装**：`autonomy.initiate_chat` / `autonomy.queue_notification` 已是真身
 * （出站器官那一批），所以这两路现在**真的落到账本上**（proactive_chat 原子强制
 * / 通知队列节流）；`research_browser.read_text` 仍是 W1 显式替身（感知器官归
 * M5）。三道门与审计闭合先于器官成立这一条不变。
 *
 * **WO-FIX-LOOP-01 D-1c 改口**：`research_browser.read_text` 未接线，wake 现在
 * 把 `wiredActionCatalog(resources)` 喂给 `buildCandidates` —— explore 根本不
 * 再候选，模型仍选它 → 既有位点②（kind_not_in_candidates）降级为 rest，**不再
 * 走到 dispatch 替身**。第一拍的期望因此从"explore 大声失败"改为"降级 rest
 * 平安 completed"；这正是 D-1 这张工单要在 e2e 层验的行为。
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
import { isolateOutboundState } from 'lykoi-adapter-telegram/testing'
import { readOutboxAfter } from 'lykoi-adapter-telegram'
import { getNotifications } from 'lykoi-kernel'
import * as wake from '../src/index.ts'
import type { WakeService } from '../src/index.ts'
import { makeStore } from './fixture.ts'

/** D-FIX-1：装配面只给路径（owner 域 TOML）；内容 = TEST_PERSONA 的文件形态。 */
const PERSONA_TOML = new URL('./fixtures/persona.toml', import.meta.url).pathname

function isolateKernelFiles(): void {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-kernel-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  // W3：出站器官的持久面同样钉进 tmpdir（数据纪律：仓库树零 state 写）。
  isolateOutboundState(dir)
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
  // 一拍一份脚本：**本拍的第一次调用**是决策，后续调用（W3 起 completed 拍会串行
  // 驱动整合/专注 —— SA-171）拿到空回，由那一侧吞成遥测。这样这个用例钉的仍然是
  // "三路动作经真门"，不被认知层新增的调用次数绑架。
  let scripted: string | null = null
  const llm: Pick<LykoiLlmService, 'call'> = {
    async call() {
      const text = scripted ?? ''
      scripted = null
      return { text, reasoningLength: 0 }
    },
  }
  ctx.provide('lykoiLlm', llm)

  const fiber = await ctx.plugin(wake, {
    dbPath: path,
    personaToml: PERSONA_TOML,
    route: 'mock',
    model: 'mock-model',
    checkIntervalMs: 3_600_000,
  })
  const service = ctx.get('wake') as WakeService

  const outcomes = []
  for (const reply of replies) {
    scripted = reply
    pendingBeats = 1
    outcomes.push(await service.beat())
  }
  // D-1c：第一拍模型选 explore，但 research_browser.read_text 未接线 → wake 喂
  // 给 buildCandidates 的 wiredActions 里没有它，explore 不候选 → 既有位点②
  // （kind_not_in_candidates）降级为 rest，平安 completed（不再走到 dispatch
  // 替身、不再大声失败）。后两拍的器官已换真身 → 原样 completed。
  assert.deepEqual(outcomes.map((o) => o.decision), ['rest', 'initiate_chat', 'queue_notification'])
  assert.deepEqual(outcomes.map((o) => o.status), ['completed', 'completed', 'completed'])
  // 降级走既有位点②：decision_ungrounded（why=kind_not_in_candidates）打头，
  // capability_gap（reason=kind_not_in_candidates,source=wake）随后补一笔 ——
  // 两条账都是既有安全网，D-1c 不新造、只是让 explore 真的走到这条既有路上。
  const ungrounded = audit.events.filter((e) => e.type === 'decision_ungrounded')
  assert.equal(ungrounded.length, 1)
  assert.equal(ungrounded[0]!.why, 'kind_not_in_candidates')
  assert.equal(ungrounded[0]!.original_kind, 'explore')
  const gaps = audit.events.filter((e) => e.type === 'capability_gap')
  assert.equal(gaps.length, 1)
  assert.equal(gaps[0]!.wanted, 'explore')
  assert.equal(gaps[0]!.reason, 'kind_not_in_candidates')
  assert.equal(gaps[0]!.source, 'wake')

  // 两对 intent/result 落在 immutable sink（同一 lykoi-audit 服务）—— rest 那拍
  // 从不调 dispatchFn，audit 上不留 action_dispatch/action_result。
  const intents = audit.events.filter((e) => e.type === 'action_dispatch')
  const results = audit.events.filter((e) => e.type === 'action_result')
  assert.deepEqual(intents.map((e) => e.action_type), [
    'autonomy.initiate_chat', 'autonomy.queue_notification',
  ])
  assert.equal(results.length, 2)
  const dispatchedRunIds = new Set<string>()
  for (const [i, intent] of intents.entries()) {
    assert.equal(intent.origin, 'autonomous') // 接线方盖章，永不由模型给
    assert.equal(intent.decision, 'allow') // 能力面④：两动作都在 AUTONOMOUS_ALLOWED
    assert.equal(intent.pre_approved, false)
    assert.equal(intent.exemption, null)
    assert.equal(typeof intent.run_id, 'string')
    dispatchedRunIds.add(intent.run_id as string)
    const result = results[i]!
    assert.equal(result.correlation_id, intent.correlation_id)
    assert.equal(result.run_id, intent.run_id)
  }
  // 两路都是 W3 换装的真身 —— 落到真账本上。
  assert.equal(results[0]!.success, true)
  assert.equal(results[1]!.success, true)
  const outbox = readOutboxAfter(0, 10)
  assert.equal(outbox.count, 1)
  assert.equal(outbox.messages[0]!.kind, 'proactive') // initiate_chat 交给投递线
  const notifications = getNotifications(false)
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0]!.origin, 'autonomous') // queue_notification 走节流那条政策
  assert.equal(dispatchedRunIds.size, 2) // 两路各自的 run_id 贯穿

  // params 是 redacted 副本形态（initiate_chat 的 content 原样可见 —— 无密钥即
  // 无遮蔽，run_id 贯穿本拍）；explore 那一拍从未到 dispatch，params 断言随之
  // 取消。
  assert.deepEqual(intents[0]!.params, {
    content: '想跟你说件事', run_id: intents[0]!.run_id,
  })

  // 三拍各有一个 run_id（含降级的第一拍——run_id 在 dispatch 之前就分配），
  // 但只有后两拍的 run_id 落进 audit 的 action_dispatch。
  const allRunIds = new Set(outcomes.map((o) => o.run_id))
  assert.equal(allRunIds.size, 3)
  for (const id of dispatchedRunIds) assert.ok(allRunIds.has(id))

  // runId 与 autonomy_runs 台账对上（audit 链 ↔ 她的拍账同键——三拍都建 run，
  // 不论该拍是否真的走到 dispatch）。
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const rows = db.prepare('SELECT id FROM autonomy_runs ORDER BY started_at').all() as { id: string }[]
    assert.deepEqual(new Set(rows.map((r) => r.id)), allRunIds)
    // 她的经验落账（没有结果也是结果）：三拍各 wake_action + action_result，
    // 与该拍是否走到 dispatch 无关（executeAndReflow 两处 recordExperience
    // 都是拍级无条件调用）。
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
