/**
 * `capability_gap`（WO-U2-SENSE-01）——位点③（reflow 没有执行分支）这一半。
 *
 * G-1 那条测的是「原拒绝语义 + 事件顺序」；这里补的是**对照组**：凡是 reflow
 * 真有分支的 kind，一律零 gap。缺口事件的价值全在于它罕见 —— 它一旦在正常拍
 * 上也响，就等于没响。
 *
 * 断言口径：事件名**精确相等**，不做子串匹配。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { executeAndReflow } from '../src/index.ts'
import { T0, eventLog, fakeDispatch, freshCounts, makeDecision, makeStore } from './fixture.ts'

const RUN = 'run-gap-test'

/** **精确匹配**（全等，非子串）。 */
function gaps(
  events: readonly [string, Record<string, unknown>][],
): Record<string, unknown>[] {
  return events.filter(([n]) => n === 'capability_gap').map(([, f]) => f)
}

test('位点③：kind 有词表位、reflow 无执行分支 → capability_gap(no_execution_branch, wake)', async () => {
  const { store } = makeStore()
  const log = eventLog()
  const status = await executeAndReflow(
    makeDecision({ kind: 'send_email', content: 'x' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
  )
  // 原语义逐字节不变：failed、零 dispatch、经验文案照旧。
  assert.equal(status, 'failed')
  assert.deepEqual(gaps(log.events), [{
    wanted: 'send_email', source: 'wake', run_id: RUN, reason: 'no_execution_branch',
  }])
})

test('位点③隐私：超长 kind 只落长度（wanted 是标签栏，不是正文栏）', async () => {
  const { store } = makeStore()
  const log = eventLog()
  const long = 'kind_'.repeat(9) // 45 码点
  await executeAndReflow(
    makeDecision({ kind: long }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
  )
  assert.equal(gaps(log.events)[0]!.wanted, `unrecognized:len${long.length}`)
})

test('对照组：reflow 有分支的 kind（rest/contemplate/record_note）→ **零** capability_gap', async () => {
  for (const kind of ['rest', 'contemplate', 'record_note']) {
    const { store } = makeStore()
    const log = eventLog()
    const status = await executeAndReflow(
      makeDecision({ kind, content: '一条笔记' }), RUN, freshCounts(),
      { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
    )
    assert.equal(status, 'completed', `${kind} 应正常收场`)
    assert.deepEqual(gaps(log.events), [], `${kind} 在位，不许报缺口`)
  }
})

test('对照组：logEvent 缺席时未知 kind 照样只是 failed —— 留痕缺席不改判', async () => {
  const { store } = makeStore()
  const status = await executeAndReflow(
    makeDecision({ kind: 'daydream' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.equal(status, 'failed')
})
