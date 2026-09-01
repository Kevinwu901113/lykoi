/**
 * `capability_gap`（WO-U2-SENSE-01）——自主拍这一半的端到端贯穿。
 *
 * 单元测已经证明位点会发事件；这里证明的是**情境栏真的从 wakeOnce 贯穿到了
 * 事件里**：`source: 'wake'` 与本拍的 `run_id`。缺了它，一条缺口事件在
 * audit.jsonl 里就无从归属到哪一拍、哪条路 —— 那等于没记。
 *
 * 断言口径：事件名**精确相等**，不做子串匹配。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { wakeOnce } from '../src/index.ts'
import { T0, contemplateReply, makeStore, makeWakeDeps } from './fixture.ts'

/** **精确匹配**（全等，非子串）。 */
function gaps(
  events: readonly [string, Record<string, unknown>][],
): Record<string, unknown>[] {
  return events.filter(([n]) => n === 'capability_gap').map(([, f]) => f)
}

test('端到端：她要一个词表外的动作 → capability_gap 带 source=wake 与本拍 run_id', async () => {
  const { store } = makeStore()
  const { deps, log } = makeWakeDeps({
    store,
    reply: JSON.stringify({
      meaning_assessment: [],
      decision: { kind: 'send_email', content: '想给他写封信' },
    }),
    beats: [1],
  })
  const out = await wakeOnce(deps)

  // 原语义逐字节不变（SA-170）：契约破坏 → 这一拍 failed，不是悄悄降级。
  assert.equal(out.status, 'failed')
  assert.equal(log.names().includes('autonomy_wake_failed'), true)
  // 情境栏贯穿：runIdFn 固定成 run-wake-test（见 fixture）。
  assert.deepEqual(gaps(log.events), [{
    wanted: 'send_email', source: 'wake', run_id: 'run-wake-test', reason: 'unknown_kind',
  }])
})

test('对照组：正常的 contemplate 一拍（合法 + 在候选表 + 接地）→ **零** capability_gap', async () => {
  const { store } = makeStore()
  const cid = store.createConcern('interest', '词源学', {
    weight: 0.5, origin: 'seed', now: new Date(T0.getTime() - 3_600_000),
  })
  const { deps, log } = makeWakeDeps({
    store, reply: contemplateReply(cid, '词源学'), beats: [2],
  })
  const out = await wakeOnce(deps)

  assert.equal(out.status, 'completed')
  assert.deepEqual(gaps(log.events), [], '能力在位的一拍上不许有缺口噪声')
})

test('对照组：idle（心脏零拍）→ 零 capability_gap（没醒过就没有想要过）', async () => {
  const { store } = makeStore()
  const { deps, log } = makeWakeDeps({ store, reply: '{}', beats: [0] })
  const out = await wakeOnce(deps)
  assert.equal(out.status, 'idle')
  assert.deepEqual(gaps(log.events), [])
})
