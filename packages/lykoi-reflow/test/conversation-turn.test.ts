/**
 * conversationTurnReflow（W3#2 → W5；reflow.py:294-323 逐字）：对话回合经验 +
 * normal_interaction + reply_to 关联戳 + contact_answered 唯一写入点只接不改；
 * 对话轮与自主拍两条回流路径的**写集对拍分立**。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { tableDigests, changedTables } from 'lykoi-memory/testing'
import {
  conversationTurnReflow, executeAndReflow, emptyNotifications,
  type NotificationsView, type WakeCounts,
} from '../src/index.ts'
import { makeStore, makeDecision, minutesAfter, T0 } from './fixture.ts'

const NOW = minutesAfter(T0, 5)

function pendingCall(ts: string): NotificationsView {
  return { getNotifications: () => [{ ts, origin: 'autonomous' }] }
}

test('一轮 → 一条 conversation 经验（模板逐字含 80 字裁剪）+ normal_interaction；无未决呼唤零 contact 写', () => {
  const { store } = makeStore()
  try {
    const longUser = '长'.repeat(100)
    conversationTurnReflow({
      store, notifications: emptyNotifications,
      userText: longUser, replyText: '我在', historyId: 7, now: NOW,
    })
    const exp = store.recentExperiences(5)
    assert.equal(exp.length, 1)
    assert.equal(exp[0]!.source, 'conversation')
    assert.equal(
      exp[0]!.content,
      `和 Kevin 聊了一轮(history #7):他说「${'长'.repeat(80)}…」,我答「我在」`,
    )
    const causes = store.recentRegulationEvents(null, 10).map((r) => r.cause).sort()
    assert.deepEqual(causes, ['experience_recorded', 'normal_interaction'])
  } finally {
    store.close()
  }
})

test('contact_answered 只接不改（SA-71 唯一写入点）：有未决呼唤 → 落账+mind_contact_answered(via=chat_turn)；幂等', () => {
  const { store } = makeStore()
  const events: [string, Record<string, unknown>][] = []
  try {
    const notifications = pendingCall('2026-08-24T09:00:00+00:00')
    conversationTurnReflow({
      store, notifications, userText: '在吗', replyText: '在', historyId: 1, now: NOW,
      logEvent: (n, f) => events.push([n, f]),
    })
    assert.deepEqual(events.filter(([n]) => n === 'mind_contact_answered'), [
      ['mind_contact_answered', { via: 'chat_turn' }],
    ])
    // 第二轮：呼唤已解决 → no-op（regulation_events 账本兼作耐重启标记）。
    events.length = 0
    conversationTurnReflow({
      store, notifications, userText: '还在吗', replyText: '在', historyId: 2,
      now: minutesAfter(NOW, 1),
    })
    assert.equal(
      store.recentRegulationEvents(null, 20).filter((r) => r.cause === 'contact_answered').length,
      1,
    )
  } finally {
    store.close()
  }
})

test('reply_to 关联（via=reply_to）：markReplied 接口位被调 + 经验内容携带引用（ts 缺席=?/null=None）', () => {
  const { store } = makeStore()
  const marked: [number, number][] = []
  const events: [string, Record<string, unknown>][] = []
  try {
    conversationTurnReflow({
      store, notifications: pendingCall('2026-08-24T09:00:00+00:00'),
      userText: '刚看到你的消息', replyText: '嗯', historyId: 9, now: NOW,
      replyToNotification: { id: 42, ts: '2026-08-24T08:30:00+00:00' },
      markReplied: (id, historyId) => marked.push([id, historyId]),
      logEvent: (n, f) => events.push([n, f]),
    })
    assert.deepEqual(marked, [[42, 9]])
    const exp = store.recentExperiences(1)[0]!
    assert.ok(exp.content.endsWith('——这是他在回应我 2026-08-24T08:30:00+00:00 的主动呼唤(通知 #42)'))
    assert.deepEqual(events.filter(([n]) => n === 'mind_contact_answered'), [
      ['mind_contact_answered', { via: 'reply_to' }],
    ])
  } finally {
    store.close()
  }
  // ts 键缺席 → '?'（Python .get('ts','?') 逐字对应）。
  const second = makeStore()
  try {
    conversationTurnReflow({
      store: second.store, notifications: emptyNotifications,
      userText: 'u', replyText: 'r', historyId: 3, now: NOW,
      replyToNotification: { id: 5 },
    })
    assert.ok(second.store.recentExperiences(1)[0]!.content.includes('回应我 ? 的主动呼唤(通知 #5)'))
  } finally {
    second.store.close()
  }
})

test('写集对拍分立：对话轮只动 experiences+regulation_*；自主拍另有 concerns 点亮/autonomy_notes 面', async () => {
  // 对话轮写集。
  const conv = makeStore()
  try {
    const before = tableDigests(conv.path)
    conversationTurnReflow({
      store: conv.store, notifications: emptyNotifications,
      userText: 'u', replyText: 'r', historyId: 1, now: NOW,
    })
    assert.deepEqual(
      changedTables(before, tableDigests(conv.path)),
      ['experience_class', 'experiences', 'integration_state', 'regulation_events', 'regulation_field'],
      '对话轮回流的写集恰如此（experience_class/integration_state 是 rw 经验写入点'
      + '同事务的 L1 分类与 pending 计数 —— W4 落点）——零 concerns、零 autonomy_notes、零 dispatch',
    )
  } finally {
    conv.store.close()
  }
  // 自主拍写集（record_note，最小外部面）：多出 autonomy_notes。
  const wake = makeStore()
  try {
    const before = tableDigests(wake.path)
    const counts: WakeCounts = { action: 0, external_read: 0, notification: 0 }
    await executeAndReflow(
      makeDecision({ kind: 'record_note', content: '一条笔记', reason: '' }),
      'run-1', counts,
      {
        store: wake.store, now: NOW,
        dispatchFn: async () => ({ success: false, error: 'unused' }),
      },
    )
    assert.deepEqual(
      changedTables(before, tableDigests(wake.path)),
      ['autonomy_notes', 'experience_class', 'experiences', 'integration_state',
        'regulation_events', 'regulation_field', 'sqlite_sequence'],
      '自主拍（record_note）与对话轮的写集分立可辨（多出 autonomy_notes）',
    )
  } finally {
    wake.store.close()
  }
})
