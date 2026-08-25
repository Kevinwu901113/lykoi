/**
 * M3-W3 接线（wake 侧）：④快照三读数换真源 + ⑤interactive_lock 接 wake 仲裁。
 *
 * 数据纪律：治理 state 全走 tmpdir；golden devstate 不触。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  _resetInteractiveLockForTest, isActive, markActive, notificationsRemainingToday,
  pendingCount, proactiveRemainingToday, sendNotification, trySend,
  enqueuePending, setKernelLogEvent,
} from 'lykoi-kernel'
import { wakeOnce, type WakeDeps } from '../src/index.ts'
import { fakeHeart, stubMessageDeps, stubSnapshotDeps } from './fixture.ts'

const T = (iso: string) => new Date(iso)

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-wake-w3-'))
  process.env.LYKOI_APPROVAL_RULES = join(dir, 'approval_rules.json')
  process.env.LYKOI_STANDING_GRANTS = join(dir, 'standing_grants.json')
  process.env.LYKOI_PENDING_ACTIONS = join(dir, 'pending_actions.json')
  process.env.LYKOI_NOTIFICATIONS = join(dir, 'notifications.json')
  process.env.LYKOI_PROACTIVE_CHAT_LEDGER = join(dir, 'proactive_chat.json')
  delete process.env.LYKOI_PENDING_TTL_S
  setKernelLogEvent(null)
  _resetInteractiveLockForTest()
  return dir
}

// ============================== ⑤ interactive_lock ==============================

/** 一个只到仲裁那一步就该停下的 deps —— 后面每一步都会大声失败。 */
function arbitrationOnlyDeps(shouldYield: () => boolean): WakeDeps {
  const explode = () => {
    throw new Error('让位之后不该再往下走一步')
  }
  return {
    store: {
      autonomyActionsLastHour: explode,
    } as unknown as WakeDeps['store'],
    clock: { now: () => T('2026-08-25T10:00:00Z') },
    heart: fakeHeart([3]),
    llm: explode as unknown as WakeDeps['llm'],
    snapshotDeps: stubSnapshotDeps(),
    messageDeps: stubMessageDeps(),
    logEvent: () => {},
    dispatchFn: explode as unknown as WakeDeps['dispatchFn'],
    shouldYieldToChat: shouldYield,
  }
}

test('⑤ interactive_lock 接 wake 仲裁：对话活着 → yielded（零 LLM 零表写）', async () => {
  isolate()
  markActive(120, T('2026-08-25T09:59:00Z')) // 一分钟前有一轮对话
  const out = await wakeOnce(arbitrationOnlyDeps(() => isActive(T('2026-08-25T10:00:00Z'))))
  assert.deepEqual(out, { status: 'yielded', beats: 3 })
})

test('⑤ 窗口过了就不再让位：这一拍照常往下走（让位是礼让，不是硬抢占）', async () => {
  isolate()
  markActive(120, T('2026-08-25T09:00:00Z')) // 一小时前 —— 窗口早过了
  assert.equal(isActive(T('2026-08-25T10:00:00Z')), false)
  // 仲裁放行 → 下一步 autonomyActionsLastHour 会炸（证明真的走过去了）
  await assert.rejects(
    () => wakeOnce(arbitrationOnlyDeps(() => isActive(T('2026-08-25T10:00:00Z')))),
    /让位之后不该再往下走一步/,
  )
})

test('⑤ DK-11 落法：被让掉的拍**就此丢弃**（不回灌心脏），下一拍从新基线数起', async () => {
  isolate()
  markActive(120, T('2026-08-25T09:59:00Z'))
  const heart = fakeHeart([3, 1])
  const deps = { ...arbitrationOnlyDeps(() => isActive(T('2026-08-25T10:00:00Z'))), heart }
  const first = await wakeOnce(deps)
  assert.deepEqual(first, { status: 'yielded', beats: 3 })
  // 第二转：claim 只给出新攒的 1 拍 —— 被让掉的 3 拍没有被回灌
  const second = await wakeOnce(deps)
  assert.deepEqual(second, { status: 'yielded', beats: 1 })
})

// ============================== ④ 快照三读数换真源 ==============================

test('④ approval 读数接 kernel pendingCount：随真的悬置动作变（不再恒 0）', () => {
  isolate()
  assert.equal(pendingCount({ now: T('2026-08-25T10:00:00Z') }), 0)
  enqueuePending('terminal.exec', { command: 'ls' }, {
    origin: 'interactive', now: T('2026-08-25T10:00:00Z'),
  })
  assert.equal(pendingCount({ now: T('2026-08-25T10:00:00Z') }), 1)
  // TTL（900s）过了就不再计入 —— 这个数就是"她现在真的在等几个 yes"
  assert.equal(pendingCount({ now: T('2026-08-25T10:20:00Z') }), 0)
})

test('④ notifications 读数接通知账本；proactive 读数接 proactive_chat 账本', () => {
  isolate()
  const now = T('2026-08-25T12:00:00Z')
  assert.equal(notificationsRemainingToday(now), 2)
  assert.equal(proactiveRemainingToday(now), 1)
  sendNotification('她想说的一件事', { origin: 'autonomous', now: T('2026-08-25T01:00:00Z') })
  assert.equal(notificationsRemainingToday(now), 1, 'dev 静态视图恒 2 的假设解除')
  assert.equal(trySend(T('2026-08-25T02:00:00Z')), null)
  assert.equal(proactiveRemainingToday(now), 0, 'dev 静态视图恒 1 的假设解除')
})
