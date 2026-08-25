/**
 * 通知队列语义（SK-56..58；GK-1 / GK-8）+ interactive_lock（S-17）+
 * proactive_chat 账本（红线 #5）。
 *
 * 数据纪律：state 全走 tmpdir；她的行内容零输出（断言只看 id / origin / 结构）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  AUTONOMOUS_COOLDOWN_S, AUTONOMOUS_DAILY_CAP, NOTIFICATIONS_MAX_KEEP,
  NOTIFICATION_OUTBOX_KIND, THROTTLE_POLICIES, _autonomousThrottle,
  _resetInteractiveLockForTest, getNotification, getNotifications, interactiveWindowS,
  isActive, loadNotificationState, markActive, markReplied,
  notificationOutboxDelivery, notificationsPath, notificationsRemainingToday,
  proactiveRemainingToday, PROACTIVE_CHAT_COOLDOWN_H, PROACTIVE_CHAT_DAILY_CAP,
  proactiveChatLedgerPath, sendNotification, setNotificationOutboxDelivery,
  setNotificationOutboxSink, trySend, unreadCount,
} from '../src/index.ts'
import { captureTelemetry, isolateKernelState } from './fixture.ts'

const T = (iso: string) => new Date(iso)

function isolate(): string {
  const dir = isolateKernelState()
  process.env.LYKOI_PROACTIVE_CHAT_LEDGER = `${dir}/proactive_chat.json`
  setNotificationOutboxDelivery(false)
  setNotificationOutboxSink(null)
  _resetInteractiveLockForTest()
  return dir
}

// ============================== SK-56/57 节流 ==============================

test('SK-57 常量与政策表：CAP=2/UTC 日、冷却 2h、表里只有 autonomous 一行', () => {
  assert.equal(AUTONOMOUS_DAILY_CAP, 2)
  assert.equal(AUTONOMOUS_COOLDOWN_S, 7200)
  assert.equal(NOTIFICATIONS_MAX_KEEP, 500)
  assert.deepEqual(Object.keys(THROTTLE_POLICIES), ['autonomous'])
})

test('SK-57 **缺表 origin 不节流是显式政策**（owner 回执/调度器告警绝不静默丢）', () => {
  isolate()
  const telemetry = captureTelemetry()
  // system / interactive / scheduler 连发 5 条：一条都不被挡。
  for (const origin of ['system', 'interactive', 'scheduler', 'system', 'scheduler']) {
    const notif = sendNotification('x', { origin, now: T('2026-08-25T10:00:00Z') })
    assert.equal(notif.throttled, undefined, `${origin} 不该被节流`)
  }
  assert.equal(unreadCount(), 5)
  assert.equal(telemetry.filter((e) => e.name === 'notification_throttled').length, 0)
})

test('SK-57 autonomous 三道闸从**持久队列**现算：日上限 → 冷却 → 同题去重（判定序逐字）', () => {
  isolate()
  // ① 冷却：两条相隔 1h < 2h
  const first = sendNotification('晚上那件事', {
    origin: 'autonomous', now: T('2026-08-25T01:00:00Z'),
  })
  assert.equal(first.throttled, undefined)
  const cooled = sendNotification('另一件事', {
    origin: 'autonomous', now: T('2026-08-25T02:00:00Z'),
  })
  assert.deepEqual([cooled.throttled, cooled.reason], [true, 'cooldown'])
  // ② 同题去重（过了冷却、同一天、同一内容 —— 大小写与首尾空白归一）
  const dedup = sendNotification('  晚上那件事  ', {
    origin: 'autonomous', now: T('2026-08-25T04:00:00Z'),
  })
  assert.deepEqual([dedup.throttled, dedup.reason], [true, 'dedup'])
  // ③ 换个题目过得去 → 今日第 2 条
  const second = sendNotification('新的一件事', {
    origin: 'autonomous', now: T('2026-08-25T04:00:00Z'),
  })
  assert.equal(second.throttled, undefined)
  // ④ 日上限：第 3 条被 daily_cap 挡（判定序最前，所以理由是 daily_cap 不是 cooldown）
  const third = sendNotification('第三件事', {
    origin: 'autonomous', now: T('2026-08-25T23:00:00Z'),
  })
  assert.deepEqual([third.throttled, third.reason], [true, 'daily_cap'])
  // ⑤ 跨 UTC 日重置
  const nextDay = sendNotification('第二天的事', {
    origin: 'autonomous', now: T('2026-08-26T09:00:00Z'),
  })
  assert.equal(nextDay.throttled, undefined)
})

test('SK-57 节流扛得住重启：判定纯粹从持久文件现算（换一个进程视角照样挡）', () => {
  isolate()
  sendNotification('a', { origin: 'autonomous', now: T('2026-08-25T01:00:00Z') })
  // 模拟"重启"：不带任何内存态，直接对着文件里的 items 跑判定函数。
  const items = JSON.parse(readFileSync(notificationsPath(), 'utf8')).items
  assert.equal(_autonomousThrottle(items, 'b', T('2026-08-25T02:00:00Z')), 'cooldown')
  assert.equal(_autonomousThrottle(items, 'a', T('2026-08-25T05:00:00Z')), 'dedup')
  assert.equal(_autonomousThrottle(items, 'b', T('2026-08-25T05:00:00Z')), null)
})

test('SK-57 坏 ts 的行被跳过（Python fromisoformat 抛 → continue 的等价面）', () => {
  const items = [
    { origin: 'autonomous', ts: 'not-a-date', content: 'x' },
    { origin: 'autonomous', content: 'y' }, // 无 ts
    { origin: 'system', ts: '2026-08-25T01:00:00Z', content: 'z' }, // 非 autonomous
  ]
  assert.equal(_autonomousThrottle(items, 'q', T('2026-08-25T02:00:00Z')), null)
})

// ============================== GK-1 / SK-58 ==============================

test('GK-1 持久 next_id：环形淘汰后 id **不复用**（活体 max+1 的错绑面消灭）', () => {
  isolate()
  // 直接铺一份接近上限的 v2 文件（内容占位，不是她的行）。
  const items = Array.from({ length: NOTIFICATIONS_MAX_KEEP }, (_, i) => ({
    id: i + 1, ts: '2026-08-25T00:00:00.000Z', content: `n${i}`, read: true, origin: 'system',
  }))
  writeFileSync(notificationsPath(), JSON.stringify({ version: 2, next_id: 501, items }))
  const notif = sendNotification('新的', { origin: 'system', now: T('2026-08-25T10:00:00Z') })
  assert.equal(notif.id, 501)
  const state = loadNotificationState()
  assert.equal(state.items.length, NOTIFICATIONS_MAX_KEEP) // 最旧的滚出
  assert.equal(state.items[0]!.id, 2)
  assert.equal(state.next_id, 502) // 单调，绝不回头
})

test('GK-1 v1 裸 list 就地迁移：读零副作用，下一次 append 才落 v2', () => {
  isolate()
  writeFileSync(notificationsPath(), JSON.stringify([
    { id: 3, ts: '2026-08-25T00:00:00.000Z', content: 'old', read: false, origin: 'system' },
  ]))
  const before = readFileSync(notificationsPath(), 'utf8')
  assert.equal(loadNotificationState().next_id, 4)
  assert.equal(readFileSync(notificationsPath(), 'utf8'), before, '读必须零副作用')
  const notif = sendNotification('新的', { origin: 'system' })
  assert.equal(notif.id, 4)
  assert.equal(JSON.parse(readFileSync(notificationsPath(), 'utf8')).version, 2)
})

test('SK-58 markReplied：首写获胜幂等 + 已滚出的 id 静默 no-op', () => {
  isolate()
  const telemetry = captureTelemetry()
  const notif = sendNotification('呼唤', { origin: 'autonomous', now: T('2026-08-25T01:00:00Z') })
  const id = Number(notif.id)
  assert.equal(markReplied(id, 42, T('2026-08-25T02:00:00Z')), true)
  // 重复答复 = no-op，且不覆盖首写
  assert.equal(markReplied(id, 99, T('2026-08-25T03:00:00Z')), false)
  const row = getNotification(id)!
  assert.equal(row.reply_history_id, 42)
  assert.equal(row.replied_ts, '2026-08-25T02:00:00.000Z')
  // 不存在（已滚出队列）的 id：静默 no-op，不抛
  assert.equal(markReplied(99999, 1), false)
  assert.equal(telemetry.filter((e) => e.name === 'notification_replied').length, 1)
})

test('读面：unread_only / mark_read / unreadCount（notifications.py:131-151 逐字）', () => {
  isolate()
  sendNotification('a', { origin: 'system' })
  sendNotification('b', { origin: 'system' })
  assert.equal(getNotifications(true).length, 2)
  assert.equal(getNotifications(true, true).length, 2) // 这一次把它们标读
  assert.equal(getNotifications(true).length, 0)
  assert.equal(getNotifications(false).length, 2)
  assert.equal(unreadCount(), 0)
})

test('快照读面 notificationsRemainingToday：从权威队列现算（视图不是执行点）', () => {
  isolate()
  assert.equal(notificationsRemainingToday(T('2026-08-25T10:00:00Z')), 2)
  sendNotification('a', { origin: 'autonomous', now: T('2026-08-25T01:00:00Z') })
  assert.equal(notificationsRemainingToday(T('2026-08-25T10:00:00Z')), 1)
  sendNotification('b', { origin: 'autonomous', now: T('2026-08-25T05:00:00Z') })
  assert.equal(notificationsRemainingToday(T('2026-08-25T10:00:00Z')), 0)
  // 非 autonomous 的通知不占这个额度
  sendNotification('c', { origin: 'system', now: T('2026-08-25T10:00:00Z') })
  assert.equal(notificationsRemainingToday(T('2026-08-25T10:00:00Z')), 0)
  // 跨 UTC 日重置
  assert.equal(notificationsRemainingToday(T('2026-08-26T00:00:01Z')), 2)
})

// ============================== GK-8 开关 ==============================

test('GK-8：kind=notification 并入投递线 **默认关**（开启 = Kevin 决断项）', () => {
  isolate()
  const delivered: [string, string][] = []
  setNotificationOutboxSink((content, kind) => delivered.push([content, kind]))
  assert.equal(notificationOutboxDelivery(), false, '缺省必须是关 —— 不自作主张改到达行为')
  sendNotification('一条通知', { origin: 'system' })
  assert.deepEqual(delivered, [], '关着的时候 sink 一次都不该被调到（pull 模型逐字保持）')

  setNotificationOutboxDelivery(true)
  sendNotification('另一条通知', { origin: 'system' })
  assert.deepEqual(delivered, [['另一条通知', NOTIFICATION_OUTBOX_KIND]])
  setNotificationOutboxDelivery(false)
})

test('GK-8：被节流的通知**不进**投递线（挡下就是挡下）', () => {
  isolate()
  const delivered: string[] = []
  setNotificationOutboxSink((content) => delivered.push(content))
  setNotificationOutboxDelivery(true)
  sendNotification('a', { origin: 'autonomous', now: T('2026-08-25T01:00:00Z') })
  const blocked = sendNotification('b', { origin: 'autonomous', now: T('2026-08-25T01:30:00Z') })
  assert.equal(blocked.throttled, true)
  assert.deepEqual(delivered, ['a'])
  setNotificationOutboxDelivery(false)
})

// ============================== S-17 interactive_lock ==============================

test('S-17 interactive_lock：缺席标记读作 inactive；markActive 开窗；窗口过期即失效', () => {
  isolate()
  assert.equal(isActive(T('2026-08-25T10:00:00Z')), false, '从未标记过 = 不活动')
  markActive(120, T('2026-08-25T10:00:00Z'))
  assert.equal(isActive(T('2026-08-25T10:01:00Z')), true)
  assert.equal(isActive(T('2026-08-25T10:01:59Z')), true)
  assert.equal(isActive(T('2026-08-25T10:02:00Z')), false, '到点即失效（严格小于）')
})

test('S-17 窗口秒数读 env（活体同名 LYKOI_INTERACTIVE_WINDOW_S，缺省 120）', () => {
  isolate()
  assert.equal(interactiveWindowS(), 120)
  process.env.LYKOI_INTERACTIVE_WINDOW_S = '30'
  assert.equal(interactiveWindowS(), 30)
  process.env.LYKOI_INTERACTIVE_WINDOW_S = '乱写的'
  assert.equal(interactiveWindowS(), 120, '读不懂就回缺省，不是 NaN')
  delete process.env.LYKOI_INTERACTIVE_WINDOW_S
})

// ============================== proactive_chat 账本 ==============================

test('主动开口预算：日 1 条 / 冷却 6h，原子占用；快照读面从账本现算', () => {
  isolate()
  assert.equal(PROACTIVE_CHAT_DAILY_CAP, 1)
  assert.equal(PROACTIVE_CHAT_COOLDOWN_H, 6.0)
  assert.equal(proactiveRemainingToday(T('2026-08-25T10:00:00Z')), 1)
  assert.equal(trySend(T('2026-08-25T23:00:00Z')), null, '首次占用成功')
  assert.equal(proactiveRemainingToday(T('2026-08-25T23:30:00Z')), 0)
  // 同一天第二条：日上限最前（哪怕冷却也没过，理由仍是 daily_cap）
  assert.equal(trySend(T('2026-08-25T23:30:00Z')), 'daily_cap')
  // 跨 UTC 日：日上限重置了，但两次相隔仅 3h < 6h → cooldown
  assert.equal(trySend(T('2026-08-26T02:00:00Z')), 'cooldown')
  assert.equal(trySend(T('2026-08-26T06:00:00Z')), null, '冷却过了 → 新的一天第一条')
})

test('主动开口账本**坏账本当空**（与 GK-2 的 pending 坏文件"照抄可见崩溃"刻意相反）', () => {
  isolate()
  writeFileSync(proactiveChatLedgerPath(), '{ 这不是 JSON')
  assert.equal(proactiveRemainingToday(T('2026-08-25T10:00:00Z')), 1)
  assert.equal(trySend(T('2026-08-25T10:00:00Z')), null)
  assert.ok(existsSync(proactiveChatLedgerPath()))
})
