/**
 * 通知文件原语（W1 半面）：GK-1 持久 next_id（chat_outbox 同法）+ v1 就地迁移
 * + 坏文件无保护（R-14 第四档）+ 环形上限。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, writeFileSync } from 'node:fs'
import {
  appendNotification, loadNotificationState, NOTIFICATIONS_MAX_KEEP, notificationsPath,
  saveNotificationState,
} from '../src/index.ts'
import { isolateKernelState, T0 } from './fixture.ts'

test('GK-1：持久 next_id —— 淘汰/删除后 id 永不复用（DK-03 错绑面消灭）', () => {
  isolateKernelState()
  const first = appendNotification({ content: '第一条', origin: 'system' }, { now: T0 })
  const second = appendNotification({ content: '第二条', origin: 'autonomous', autonomy_run_id: 'run-1' }, { now: T0 })
  assert.equal(first.id, 1)
  assert.equal(second.id, 2)
  assert.equal(second.autonomy_run_id, 'run-1')
  // 模拟环形淘汰把两条都挤掉：活体 max+1 会把下一条又编成 1（错绑面）；
  // 新体 next_id 持久 —— 编成 3。
  const state = loadNotificationState()
  state.items = []
  saveNotificationState(state)
  const third = appendNotification({ content: '第三条', origin: 'system', kind: 'notification' }, { now: T0 })
  assert.equal(third.id, 3)
  assert.equal(third.kind, 'notification')
  // 记录形状（notifications.py:112-121 同形）。
  assert.deepEqual(Object.keys(third), ['id', 'ts', 'content', 'read', 'origin', 'kind'])
  assert.equal(third.read, false)
})

test('v1 裸 list 就地迁移（读零副作用，append 才落 v2）', () => {
  isolateKernelState()
  writeFileSync(notificationsPath(), JSON.stringify([
    { id: 1, ts: 'x', content: 'a', read: true, origin: 'system' },
    { id: 7, ts: 'y', content: 'b', read: false, origin: 'autonomous' },
  ]))
  const state = loadNotificationState()
  assert.equal(state.version, 2)
  assert.equal(state.next_id, 8) // max(id)+1
  assert.equal(state.items.length, 2)
  // 读不落盘：文件仍是 v1 裸 list。
  assert.ok(Array.isArray(JSON.parse(readFileSync(notificationsPath(), 'utf8'))))
  // append 后才持久 v2。
  const appended = appendNotification({ content: 'c', origin: 'system' }, { now: T0 })
  assert.equal(appended.id, 8)
  const onDisk = JSON.parse(readFileSync(notificationsPath(), 'utf8'))
  assert.equal(onDisk.version, 2)
  assert.equal(onDisk.next_id, 9)
})

test('坏文件④notifications：**无保护 —— 可见崩溃**（R-14；不许顺手 try/catch）', () => {
  isolateKernelState()
  writeFileSync(notificationsPath(), '{{{ not json')
  assert.throws(() => loadNotificationState(), SyntaxError)
  writeFileSync(notificationsPath(), JSON.stringify({ version: 2, items: 'not-a-list' }))
  assert.throws(() => loadNotificationState(), /invalid notifications state/)
})

test('环形上限 500：最旧滚出，next_id 照常前进', () => {
  isolateKernelState()
  const state = loadNotificationState()
  for (let i = 0; i < NOTIFICATIONS_MAX_KEEP; i++) {
    state.items.push({ id: state.next_id, ts: 't', content: `n${i}`, read: false, origin: 'system' })
    state.next_id += 1
  }
  saveNotificationState(state)
  const overflow = appendNotification({ content: '溢出的一条', origin: 'system' }, { now: T0 })
  const after = loadNotificationState()
  assert.equal(after.items.length, NOTIFICATIONS_MAX_KEEP)
  assert.equal(after.items[0]!.content, 'n1') // 最旧（n0）滚出
  assert.equal(after.items.at(-1)!.id, overflow.id)
  assert.equal(after.next_id, Number(overflow.id) + 1)
})
