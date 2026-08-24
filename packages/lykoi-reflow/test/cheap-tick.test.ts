import test from 'node:test'
import assert from 'node:assert/strict'
import { formatPyIso } from 'lykoi-memory/rw'
import {
  cheapTick, notificationsReadReflow, pendingContactTs, resolveContactAnswered,
  emptyNotifications,
} from '../src/index.ts'
import {
  T0, causeSequence, eventLog, fakeNotifications, hoursBefore, makeStore,
} from './fixture.ts'

test('SA-72：_pending_contact_ts——最新 autonomous 通知 ts；regulation_events 是耐重启解决标记', () => {
  const { store } = makeStore()
  const older = formatPyIso(hoursBefore(T0, 30))
  const newer = formatPyIso(hoursBefore(T0, 25))
  const notif = fakeNotifications([
    { ts: older, origin: 'autonomous' },
    { ts: newer, origin: 'autonomous' },
    { ts: formatPyIso(hoursBefore(T0, 1)), origin: 'system' }, // 非 autonomous 不算
    { ts: null, origin: 'autonomous' }, //                        无 ts 不算
  ])
  assert.equal(pendingContactTs(store, notif), newer)
  // 解决标记落账后（>= latest）→ 无未决呼唤。
  store.applyRegulationCause('contact_answered', { now: T0 })
  assert.equal(pendingContactTs(store, notif), null)
  // 空队列恒 null。
  assert.equal(pendingContactTs(store, emptyNotifications), null)
})

test('SA-70：contact 超时 24h → contact_unanswered + silence 经验（salience 0.6）+ 事件；同一未决期幂等', () => {
  const { store } = makeStore()
  const pending = formatPyIso(hoursBefore(T0, 25))
  const notif = fakeNotifications([{ ts: pending, origin: 'autonomous' }])
  const log = eventLog()
  const out = cheapTick({ store, notifications: notif, now: T0, logEvent: log.logEvent })
  assert.deepEqual(out, { contact_unanswered: true, silence_anomaly: false })
  const exp = store.recentExperiences(1)[0]!
  assert.equal(exp.source, 'silence')
  assert.equal(exp.content, '我主动联系了 Kevin,超过 24 小时没有回应')
  assert.equal(exp.salience, 0.6)
  assert.deepEqual(causeSequence(store), ['contact_unanswered', 'experience_recorded'])
  assert.deepEqual(log.events, [['mind_contact_unanswered', { pending_since: pending }]])
  // 第二次 tick：contact_unanswered 事件本身就是解决标记 → 不再重复写。
  const again = cheapTick({ store, notifications: notif, now: T0, logEvent: log.logEvent })
  assert.deepEqual(again, { contact_unanswered: false, silence_anomaly: false })
  assert.deepEqual(causeSequence(store), ['contact_unanswered', 'experience_recorded'])
})

test('SA-70 边界：不足 24h 的未决呼唤不动账', () => {
  const { store } = makeStore()
  const notif = fakeNotifications([{ ts: formatPyIso(hoursBefore(T0, 23)), origin: 'autonomous' }])
  const out = cheapTick({ store, notifications: notif, now: T0 })
  assert.deepEqual(out, { contact_unanswered: false, silence_anomaly: false })
  assert.deepEqual(causeSequence(store), [])
})

test('SA-71：contact_answered 单写入点幂等——有未决才落账，重复调用不重复写；via 入事件', () => {
  const { store } = makeStore()
  const notif = fakeNotifications([{ ts: formatPyIso(hoursBefore(T0, 2)), origin: 'autonomous' }])
  const log = eventLog()
  // 无未决（空队列）→ no-op。
  assert.equal(
    resolveContactAnswered({ store, notifications: emptyNotifications, now: T0, via: 'chat_turn', logEvent: log.logEvent }),
    false,
  )
  assert.deepEqual(causeSequence(store), [])
  // 有未决 → 落账一次。
  assert.equal(
    resolveContactAnswered({ store, notifications: notif, now: T0, via: 'chat_turn', logEvent: log.logEvent }),
    true,
  )
  assert.deepEqual(causeSequence(store), ['contact_answered'])
  assert.deepEqual(log.events, [['mind_contact_answered', { via: 'chat_turn' }]])
  // 幂等：解决标记已 >= latest → 再调不写。
  assert.equal(
    resolveContactAnswered({ store, notifications: notif, now: T0, via: 'chat_turn', logEvent: log.logEvent }),
    false,
  )
  assert.deepEqual(causeSequence(store), ['contact_answered'])
})

test('notificationsReadReflow：mark_read 走同一唯一写入点（via=mark_read）', () => {
  const { store } = makeStore()
  const notif = fakeNotifications([{ ts: formatPyIso(hoursBefore(T0, 2)), origin: 'autonomous' }])
  const log = eventLog()
  assert.equal(
    notificationsReadReflow({ store, notifications: notif, now: T0, logEvent: log.logEvent }),
    true,
  )
  assert.deepEqual(causeSequence(store), ['contact_answered'])
  assert.deepEqual(log.events, [['mind_contact_answered', { via: 'mark_read' }]])
})

/** 种一段规律的对话史：每 24h 一次，最后一次在 lastGapH 小时前。 */
function seedRhythm(store: ReturnType<typeof makeStore>['store'], lastGapH: number, days = 6): string {
  let lastTs = ''
  for (let i = days - 1; i >= 0; i--) {
    const at = hoursBefore(T0, lastGapH + i * 24)
    store.appendHistory('conversation', `对话样本 ${i}`, { now: at })
    lastTs = formatPyIso(at)
  }
  return lastTs
}

test('SA-68/69：沉默异常三条件全成立才写；每沉默期一次；文案与因逐字', () => {
  const { store } = makeStore()
  // 典型间隔 24h（5 个间隔样本 ≥ MIN_GAP_SAMPLES+1=6 个时间戳）；上次对话 49h 前
  // （49 ≥ 12 ✓；49 > 2×24 ✓；同时段 6 天 ≥ 3 ✓——样本在 now-1h 的时段上）。
  const lastTs = seedRhythm(store, 49)
  const log = eventLog()
  const out = cheapTick({ store, notifications: emptyNotifications, now: T0, logEvent: log.logEvent })
  assert.deepEqual(out, { contact_unanswered: false, silence_anomaly: true })
  const exp = store.recentExperiences(1)[0]!
  assert.equal(exp.source, 'silence')
  assert.equal(exp.salience, 0.6)
  assert.equal(
    exp.content,
    'Kevin 比平时安静:已经 49.0 小时没有互动(他这个时段通常在,典型间隔约 24.0 小时)',
  )
  assert.deepEqual(causeSequence(store), ['experience_recorded', 'owner_silence_anomaly'])
  assert.deepEqual(log.events, [['mind_silence_anomaly', { hours_quiet: 49 }]])
  assert.ok(store.latestExperienceTs('silence')! > lastTs, 'silence 经验晚于沉默起点')

  // SA-69：同一沉默期第二次 tick 不再写（latest silence >= last_ts）。
  const again = cheapTick({ store, notifications: emptyNotifications, now: T0 })
  assert.deepEqual(again, { contact_unanswered: false, silence_anomaly: false })
  assert.deepEqual(causeSequence(store), ['experience_recorded', 'owner_silence_anomaly'])
})

test('SA-68 三条件缺一不可：不足 2×typical / 时段不常在 → 不算异常', () => {
  // 条件②失败：typical 24h，上次 47h 前（47 < 48）。
  const a = makeStore()
  seedRhythm(a.store, 47)
  assert.deepEqual(
    cheapTick({ store: a.store, notifications: emptyNotifications, now: T0 }),
    { contact_unanswered: false, silence_anomaly: false },
  )
  // 条件③失败：历史样本在 now-12h 的时段（±2h 窗口外）→ usually_active 为假。
  const b = makeStore()
  for (let i = 5; i >= 0; i--) {
    b.store.appendHistory('conversation', `样本 ${i}`, { now: hoursBefore(T0, 61 + i * 24) })
  }
  assert.deepEqual(
    cheapTick({ store: b.store, notifications: emptyNotifications, now: T0 }),
    { contact_unanswered: false, silence_anomaly: false },
  )
})

test('SA-68：空对话史 → 静默不判（没有"他通常在"的证据基线）', () => {
  const { store } = makeStore()
  assert.deepEqual(
    cheapTick({ store, notifications: emptyNotifications, now: T0 }),
    { contact_unanswered: false, silence_anomaly: false },
  )
})
