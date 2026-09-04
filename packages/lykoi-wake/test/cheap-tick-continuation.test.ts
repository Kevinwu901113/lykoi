/**
 * WO-CONTINUATION-01 D-3：cheap tick 一拍 = SA-67 cheapTick + 跟进账簿扫描。
 * 两段互不牵连；扫描拒绝只落 continuation/scan_failed；无扫描面时零副作用。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyNotifications } from 'lykoi-reflow'
import { runCheapTick } from '../src/index.ts'

const T0 = new Date(Date.UTC(2026, 8, 4, 12, 0, 0, 0))

function harness() {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const store = {
    // cheapTick 的读面：无历史、无经历 → 两项侦测都不触发，不写调节。
    getRecentHistoryOfType: () => [],
    latestExperienceTs: () => null,
    applyRegulationCause: () => { throw new Error('must not regulate on an empty board') },
  }
  return {
    events,
    store,
    logEvent: (name: string, fields?: Record<string, unknown>) => { events.push({ name, fields: fields ?? {} }) },
  }
}

test('有扫描面 → scan(now) 被调一次，now 原样透传', async () => {
  const h = harness()
  const calls: Date[] = []
  runCheapTick({
    store: h.store as never, notifications: emptyNotifications, now: T0, logEvent: h.logEvent,
    continuations: { scan: async (now) => { calls.push(now); return { claimed: 0 } } },
  })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(calls, [T0])
  assert.deepEqual(h.events.filter((e) => e.name.startsWith('continuation/')), [])
})

test('无扫描面 → 零副作用；扫描拒绝 → continuation/scan_failed{error_name}，不抛', async () => {
  const quiet = harness()
  runCheapTick({ store: quiet.store as never, notifications: emptyNotifications, now: T0, logEvent: quiet.logEvent })
  assert.deepEqual(quiet.events.filter((e) => e.name.startsWith('continuation/')), [])

  const rejecting = harness()
  runCheapTick({
    store: rejecting.store as never, notifications: emptyNotifications, now: T0, logEvent: rejecting.logEvent,
    continuations: { scan: async () => { throw new RangeError('db') } },
  })
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(rejecting.events.filter((e) => e.name.startsWith('continuation/')), [{
    name: 'continuation/scan_failed', fields: { error_name: 'RangeError' },
  }])

  const throwing = harness()
  runCheapTick({
    store: throwing.store as never, notifications: emptyNotifications, now: T0, logEvent: throwing.logEvent,
    continuations: { scan: () => { throw new TypeError('sync') } },
  })
  assert.deepEqual(throwing.events.filter((e) => e.name.startsWith('continuation/')), [{
    name: 'continuation/scan_failed', fields: { error_name: 'TypeError' },
  }])
})
