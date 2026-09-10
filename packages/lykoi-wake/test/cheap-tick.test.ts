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

test('cheap tick still maintains state without owning task scheduling', () => {
  const h = harness()
  runCheapTick({ store: h.store as never, notifications: emptyNotifications, now: T0, logEvent: h.logEvent })
  assert.deepEqual(h.events, [])
})
