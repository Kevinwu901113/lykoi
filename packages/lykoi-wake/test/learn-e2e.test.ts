/**
 * SA-171 接真端到端：一拍（fake LLM）驱动 wake → L2 整合 → L4 专注。
 * 断言六阶段之后的学习环事件序、三 origin 分账共用一拍 runId、以及"闸没开的
 * 拍零学习环调用"。store 遥测经构造注入同一事件槽（W3 TODO#1 的接线形态）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import {
  maybeRunFocusCycle, maybeRunIntegration, type ChatMessage as LearnChatMessage,
} from 'lykoi-learn'
import {
  AUTONOMOUS_COGNITION, ORIGIN_AUTONOMOUS_FOCUS, ORIGIN_AUTONOMOUS_INTEGRATE,
  ORIGIN_AUTONOMOUS_WAKE, wakeOnce, type WakeDeps,
} from '../src/index.ts'
import {
  T0, TEST_PERSONA, contemplateReply, eventLog, fakeDispatch, fakeHeart,
  stubMessageDeps, stubSnapshotDeps,
} from './fixture.ts'
import { VirtualClock } from '../src/clock.ts'

function integrationReply(experienceId: number, concernId: number): string {
  return JSON.stringify({
    experience_actions: [
      { experience_id: experienceId, operation: 'absorb', concern_id: concernId, note: '吸进睡眠关切' },
    ],
    concern_releases: [], new_concerns: [], narrative: null, thought_actions: [],
  })
}

const FOCUS_REPLY = JSON.stringify({
  outcome: 'advanced', conclusion: '睡眠质量和光照相关', revises_insight_id: null,
  conflicts: [], cited_experience_ids: [], new_concern: null, note: '回头想通了一点',
})

test('端到端一拍：completed 之后串行驱动 L2/L4——事件序、三 origin 同 runId、写面全落', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-learn-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  const log = eventLog()
  const of = (name: string) => log.events.filter(([n]) => n === name).map(([, f]) => f)
  const store = new ReadWriteMemory(path, { logEvent: log.logEvent })
  const clock = new VirtualClock(T0)
  try {
    const cid = store.createConcern('project', '睡眠质量', { weight: 0.6, origin: 'grown', now: T0 })
    const e1 = store.recordExperience('conversation', '和 Kevin 聊了睡眠质量', { now: T0 })

    const llmCalls: { origin: string; runId: string }[] = []
    const llm = async (messages: { role: string; content: string }[], meta: { runId: string; route: string; origin: string }) => {
      llmCalls.push({ origin: meta.origin, runId: meta.runId })
      if (meta.origin === ORIGIN_AUTONOMOUS_WAKE) return { content: contemplateReply(cid, '睡眠质量') }
      if (meta.origin === ORIGIN_AUTONOMOUS_INTEGRATE) return { content: integrationReply(e1, cid) }
      return { content: FOCUS_REPLY }
    }
    const completionFor = (origin: string, runId: string) =>
      (messages: LearnChatMessage[]) => llm(messages, { runId, route: AUTONOMOUS_COGNITION, origin })

    const deps: WakeDeps = {
      store,
      clock,
      heart: fakeHeart([1, 1], new Date(T0.getTime() + 30 * 60_000).toISOString()),
      llm: llm as WakeDeps['llm'],
      dispatchFn: fakeDispatch(),
      snapshotDeps: stubSnapshotDeps(log.logEvent),
      messageDeps: { ...stubMessageDeps(), persona: TEST_PERSONA },
      logEvent: log.logEvent,
      runIdFn: (() => {
        let n = 0
        return () => (n += 1, n === 1 ? 'run-e2e-w4' : `run-e2e-w4-${n}`)
      })(),
      // 与插件面 apply() 同一接线形态（SA-171/172）。
      integrate: async ({ runId }) => {
        await maybeRunIntegration({
          store, persona: TEST_PERSONA, logEvent: log.logEvent, now: clock.now(),
          completion: completionFor(ORIGIN_AUTONOMOUS_INTEGRATE, runId),
          integrationIdFn: () => 71,
        })
      },
      focus: async ({ runId }) => {
        await maybeRunFocusCycle({
          store, persona: TEST_PERSONA, logEvent: log.logEvent, now: clock.now(),
          completion: completionFor(ORIGIN_AUTONOMOUS_FOCUS, runId),
        })
      },
    }

    const outcome = await wakeOnce(deps)
    assert.equal(outcome.status, 'completed')

    // 三 origin 顺序分账、同一拍 runId 贯穿（SA-172）。
    assert.deepEqual(llmCalls, [
      { origin: 'autonomous_wake', runId: 'run-e2e-w4' },
      { origin: 'autonomous_integrate', runId: 'run-e2e-w4' },
      { origin: 'autonomous_focus', runId: 'run-e2e-w4' },
    ])

    // 事件序摘录：wake 收尾 → L2（消化+摘要+闸账）→ L4（开行+收行+闸账），严格此序。
    const names = log.names()
    const seq = ['autonomy_wake', 'mind_experiences_integrated', 'integration_completed_summary',
      'autonomy_integrate', 'focus_cycle_opened', 'focus_insight_recorded',
      'focus_cycle_finished', 'autonomy_focus']
    let cursor = -1
    for (const name of seq) {
      const at = names.indexOf(name, cursor + 1)
      assert.ok(at > cursor, `事件序缺位或乱序: ${name}（实际序: ${names.join(' → ')}）`)
      cursor = at
    }
    assert.equal(of('autonomy_integrate')[0]!.reason, 'scheduled') // 锚缺席=还没定过→到期
    assert.equal(of('autonomy_focus')[0]!.outcome, 'advanced')

    // 写面：经验消化、结论入影子、血缘可走回（含已整合经验——SA-109 检索域）。
    assert.equal(store.countIntakePending(), 0)
    const insights = store.listFocusInsights('shadow')
    assert.equal(insights.length, 1)
    assert.ok(store.lineageForProduct('insight', insights[0]!.insight_id as number)
      .some((r) => r.source_kind === 'experience' && r.source_id === String(e1)))

    // 第二拍（+1h）：整合锚已前进、专注锚已落 → 两台机器都不再被驱动（闸的对拍）。
    clock.set(new Date(T0.getTime() + 3_600_000))
    const second = await wakeOnce(deps)
    assert.equal(second.status, 'completed')
    assert.equal(of('autonomy_integrate').length, 1)
    assert.equal(of('autonomy_focus').length, 1)
    assert.equal(llmCalls.filter((c) => c.origin !== 'autonomous_wake').length, 2)
  } finally {
    store.close()
  }
})

test('SA-171 负测：一拍失败（wake LLM 炸）→ 学习环两台机器零调用（真机器接线下复核 W3 语义）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-learn-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  const log = eventLog()
  const store = new ReadWriteMemory(path, { logEvent: log.logEvent })
  const clock = new VirtualClock(T0)
  try {
    store.recordExperience('conversation', '有原料在等', { now: T0 })
    let learnCalls = 0
    const deps: WakeDeps = {
      store,
      clock,
      heart: fakeHeart([1]),
      llm: async () => {
        throw new Error('router down')
      },
      dispatchFn: fakeDispatch(),
      snapshotDeps: stubSnapshotDeps(log.logEvent),
      messageDeps: stubMessageDeps(),
      logEvent: log.logEvent,
      integrate: async () => {
        learnCalls += 1
      },
      focus: async () => {
        learnCalls += 1
      },
    }
    const outcome = await wakeOnce(deps)
    assert.equal(outcome.status, 'failed')
    assert.equal(learnCalls, 0)
    assert.ok(log.names().includes('autonomy_wake_failed'))
  } finally {
    store.close()
  }
})
