/**
 * evaluateMessage golden：解析链 11 步（§1.8）、契约破坏 raise vs 护栏 demote
 * 分野（SA-19）、demote 两条+优先级+清空 grounded（SA-21）、三快照闸 fail-closed
 * （SA-22）、参数化边界（SA-23）、envelope 原样抬入（SA-24）、G-2 字段不存在。
 * 红测路径 ≥8 条（路径×预期见各断言）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  evaluateMessage,
  extractJson,
  groundedEntries,
  type Candidate,
  type LogEvent,
} from '../src/index.ts'

const CANDS: Candidate[] = [
  { kind: 'explore', weight: 0.5, cost: 'c', note: 'n' },
  { kind: 'record_note', weight: 0.4, cost: 'c', note: 'n' },
  { kind: 'rest', weight: 0.5, cost: '0', note: 'n' },
]

function msg(payload: unknown): { content: string } {
  return { content: JSON.stringify(payload) }
}

function recorder(): { logEvent: LogEvent; events: [string, Record<string, unknown>][] } {
  const events: [string, Record<string, unknown>][] = []
  return { logEvent: (name, fields) => void events.push([name, fields]), events }
}

const GROUNDED = {
  meaning_assessment: [
    { item: '未整合数 3', meaning: '积压的经验值得看一眼', concern_id: 7, pull: 0.6 },
  ],
  decision: { kind: 'explore', url: 'https://example.org', reason: '积压的经验值得看一眼' },
}

test('红测 1：非 JSON → raise（消息含 content[:200] repr）', () => {
  assert.throws(
    () => evaluateMessage({ content: '我想想……不输出 JSON' }, CANDS),
    /autonomous model did not return a decision JSON: '我想想……不输出 JSON'/,
  )
})

test('红测 2：JSON 但非对象（数组）→ raise 顶层形状', () => {
  assert.throws(
    () => evaluateMessage({ content: '[1,2,3]' }, CANDS),
    /decision payload must be a JSON object with a 'decision' object/,
  )
})

test('红测 3：decision 键缺失或非对象 → raise 顶层形状', () => {
  assert.throws(
    () => evaluateMessage(msg({ meaning_assessment: [] }), CANDS),
    /decision payload must be a JSON object with a 'decision' object/,
  )
  assert.throws(
    () => evaluateMessage(msg({ decision: 'rest' }), CANDS),
    /decision payload must be a JSON object with a 'decision' object/,
  )
})

test('红测 4：kind 白名单外 → raise（不是降级 —— SA-19 分野）', () => {
  assert.throws(
    () => evaluateMessage(msg({ decision: { kind: 'dance' } }), CANDS),
    /unknown decision kind: 'dance'/,
  )
  assert.throws(
    () => evaluateMessage(msg({ decision: {} }), CANDS),
    /unknown decision kind: None/,
  )
})

test('红测 5：content 必填缺失 → raise；contemplate 刻意豁免（SA-02）', () => {
  assert.throws(
    () => evaluateMessage(msg({ decision: { kind: 'record_note', content: '  ' } }), CANDS),
    /record_note requires 'content'/,
  )
  // contemplate 不在 CONTENT_REQUIRED（纯内向，产出在 inner）—— 不因缺 content 抛
  const d = evaluateMessage(
    msg({ decision: { kind: 'contemplate', reason: '' } }),
    [...CANDS, { kind: 'contemplate', weight: 0.4, cost: 'c', note: 'n' }],
  )
  assert.equal(d.original_kind, 'contemplate') // 未接地照样降级，但不是 raise
})

test('红测 6：kind 不在候选表 → demote(kind_not_in_candidates) + 事件 + 清空 grounded', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: GROUNDED.meaning_assessment,
      decision: { kind: 'queue_notification', content: 'hi', reason: '积压的经验值得看一眼' },
    }),
    CANDS, // 表里没有 queue_notification
    { injectedConcernIds: [7], logEvent },
  )
  assert.equal(d.kind, 'rest')
  assert.equal(d.demoted, true)
  assert.equal(d.demote_why, 'kind_not_in_candidates')
  assert.equal(d.original_kind, 'queue_notification')
  assert.deepEqual(d.grounded_concern_ids, []) // 降级后不许再点亮任何关切
  assert.deepEqual(events, [['decision_ungrounded', {
    why: 'kind_not_in_candidates',
    original_kind: 'queue_notification',
    reason: '积压的经验值得看一眼',
  }]])
})

test('红测 7：reason 未逐字引用 → demote(reason_not_grounded)（SA-20/21）', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: [{ item: '未整合数 3', meaning: '积压的经验值得看一眼', pull: 0.5 }],
      decision: { kind: 'explore', url: 'https://x.example', reason: '我就是想出去逛逛' },
    }),
    CANDS, { logEvent },
  )
  assert.equal(d.kind, 'rest')
  assert.equal(d.demote_why, 'reason_not_grounded')
  assert.equal(events[0]![0], 'decision_ungrounded')
})

test('红测 8：demote 优先级 —— kind 不在表且未接地时先记 kind_not_in_candidates（SA-21）', () => {
  const d = evaluateMessage(
    msg({ decision: { kind: 'tend_inner', content: 'x', reason: '没有引用' } }),
    CANDS,
  )
  assert.equal(d.demote_why, 'kind_not_in_candidates')
})

test('safe_kind 免疫：rest 未接地也永不降级（SA-03）', () => {
  const d = evaluateMessage(
    msg({ decision: { kind: 'rest', reason: '随便一个没引用的理由' } }),
    CANDS,
  )
  assert.equal(d.kind, 'rest')
  assert.equal(d.demoted, false)
  assert.equal(d.demote_why, null)
})

test('红测 9：assessment 的 concern_id 越界 → 丢 id 留文本 + 事件 where=assessment（SA-22）', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: [
        { item: '快照条目甲', meaning: 'mmmm', concern_id: 99, pull: 0.4 },
        { item: '快照条目乙', meaning: 'nnnn', concern_id: 7, pull: '0.8' },
        { item: 3, meaning: null, concern_id: true, pull: 2.5 }, // 类型垃圾
        'not-a-dict',
      ],
      decision: { kind: 'explore', url: 'https://x.example', reason: '引用:快照条目甲' },
    }),
    CANDS, { injectedConcernIds: [7], logEvent },
  )
  // 越界 id 被丢但文本保留（文本接地不受 id 闸影响）
  assert.deepEqual(d.meaning_assessment, [
    { item: '快照条目甲', meaning: 'mmmm', pull: 0.4 },
    { item: '快照条目乙', meaning: 'nnnn', concern_id: 7, pull: 0.8 },
    { item: '3', meaning: '', pull: 1.0 }, // bool concern_id 被拒；pull 夹到 1
  ])
  assert.deepEqual(events, [
    ['grounding_concern_out_of_snapshot', { concern_id: 99, where: 'assessment' }],
  ])
  // 甲被引用但没有 concern_id → grounded 为空
  assert.deepEqual(d.grounded_concern_ids, [])
  assert.equal(d.demoted, false)
})

test('红测 10：decision.thread_id/concern_id 快照闸 → null + 事件 where=decision（SA-22）', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: GROUNDED.meaning_assessment,
      decision: {
        kind: 'explore', url: 'https://x.example', reason: '积压的经验值得看一眼',
        thread_id: 55, concern_id: 7,
      },
    }),
    CANDS,
    { injectedConcernIds: [7], injectedThreadIds: [1, 2], logEvent },
  )
  assert.equal(d.thread_id, null) // 55 ∉ {1,2}
  assert.equal(d.concern_id, 7)
  assert.deepEqual(events, [
    ['grounding_concern_out_of_snapshot', { where: 'decision', thread_id: 55 }],
  ])
  // fail-closed：不传注入集 → 一切 id 被丢
  const d2 = evaluateMessage(
    msg({
      meaning_assessment: GROUNDED.meaning_assessment,
      decision: {
        kind: 'explore', url: 'https://x.example', reason: '积压的经验值得看一眼', concern_id: 7,
      },
    }),
    CANDS,
  )
  assert.equal(d2.concern_id, null)
})

test('接地绿路：逐字引用 → grounded_concern_ids 收集被引条目的 concern_id', () => {
  const d = evaluateMessage(msg(GROUNDED), CANDS, { injectedConcernIds: [7] })
  assert.equal(d.kind, 'explore')
  assert.equal(d.demoted, false)
  assert.deepEqual(d.grounded_concern_ids, [7])
  assert.equal(d.url, 'https://example.org')
})

test('SA-20：GROUND_MIN_CHARS=4 —— 短于 4 码点的片段不算引用', () => {
  assert.deepEqual(
    groundedEntries([{ item: '三字条', meaning: '', pull: 0 }], '理由里有三字条'),
    [],
  )
  const four = [{ item: '四字条目', meaning: '', pull: 0 }]
  assert.deepEqual(groundedEntries(four, '理由里有四字条目'), four)
})

test('G-2：next_wake_after_minutes 不存在于 Decision（模型硬给也被无视）', () => {
  const d = evaluateMessage(
    msg({ ...GROUNDED, next_wake_after_minutes: 45 }),
    CANDS, { injectedConcernIds: [7] },
  )
  assert.ok(!('next_wake_after_minutes' in d))
  assert.ok(!Object.hasOwn(d, 'next_wake_after_minutes'))
})

test('SA-24：envelope 白名单原样抬入零解释；decision 层优先于顶层', () => {
  const d = evaluateMessage(
    msg({
      meaning_assessment: [],
      decision: { kind: 'silence', reason: '', tool: { name: 'x', args: [1] } },
      mood_pulse: 'warm',
    }),
    [{ kind: 'silence', weight: 0.5, cost: '0', note: 'n' }],
    {
      kinds: ['silence', 'reply'],
      contentRequired: ['reply'],
      safeKind: 'silence', // SA-23：对话情境四词汇表
      envelopeFields: ['tool', 'mood_pulse', 'absent_key'],
    },
  )
  assert.equal(d.kind, 'silence') // 对话 safe_kind 同样免疫
  assert.deepEqual(d.envelope, { tool: { name: 'x', args: [1] }, mood_pulse: 'warm' })
  assert.ok(!Object.hasOwn(d.envelope, 'absent_key'))
})

test('SA-32：injected_thought_ids 排序落账（审计可复现）', () => {
  const d = evaluateMessage(msg(GROUNDED), CANDS, {
    injectedConcernIds: [7],
    injectedThoughtIds: new Set([9, 2, 5]),
  })
  assert.deepEqual(d.injected_thought_ids, [2, 5, 9])
})

test('SA-18：两段式解析 —— 前后有杂文时取首 { 到末 } 的切片', () => {
  const wrapped = `好的，我的决定是：\n${JSON.stringify(GROUNDED)}\n以上。`
  const d = evaluateMessage({ content: wrapped }, CANDS, { injectedConcernIds: [7] })
  assert.equal(d.kind, 'explore')
  assert.deepEqual(extractJson('{"a": 1}'), { a: 1 })
})
