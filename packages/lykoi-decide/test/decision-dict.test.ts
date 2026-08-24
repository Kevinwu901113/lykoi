/**
 * SA-04（G-2 后）：as_dict 五值 drop-list 语义重述 + 序列化字节稳定性
 * （W1 TODO#6 口径定案的测试面）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DECISION_FIELD_ORDER,
  decisionToDict,
  evaluateMessage,
  serializeDecision,
  type Candidate,
  type Decision,
} from '../src/index.ts'

const CANDS: Candidate[] = [
  { kind: 'explore', weight: 0.5, cost: 'c', note: 'n' },
  { kind: 'rest', weight: 0.5, cost: '0', note: 'n' },
]

function base(): Decision {
  return {
    kind: 'rest',
    content: null,
    url: null,
    thread_id: null,
    concern_id: null,
    reason: '',
    meaning_assessment: [],
    grounded_concern_ids: [],
    demoted: false,
    demote_why: null,
    original_kind: null,
    inner: { thoughts: [], resolve: [] },
    injected_thought_ids: [],
    envelope: {},
  }
}

test('drop-list 五值：None/[]/""/{}/inner 哨兵全被滤；demoted:false 恒保留', () => {
  const dict = decisionToDict(base())
  // 最小 rest decision：只剩 kind + demoted（false 不等于任何 drop 值）
  assert.deepEqual(dict, { kind: 'rest', demoted: false })
  assert.deepEqual(Object.keys(dict), ['kind', 'demoted'])
})

test('G-2：字段面 14 项且不含 next_wake_after_minutes（DA-04 随之消失）', () => {
  assert.equal(DECISION_FIELD_ORDER.length, 14)
  assert.ok(!(DECISION_FIELD_ORDER as readonly string[]).includes('next_wake_after_minutes'))
  assert.ok(!('next_wake_after_minutes' in base()))
})

test('非空字段按声明序进 dict；inner 非哨兵时保留', () => {
  const d = base()
  d.kind = 'explore'
  d.url = 'https://x.example'
  d.reason = '有理由'
  d.meaning_assessment = [{ item: '条目甲乙丙', meaning: '', pull: 0.5 }]
  d.grounded_concern_ids = [7]
  d.inner = {
    thoughts: [{ content: 't', kind: 'intent', related_concern_hint: null, charge_hint: 0.5 }],
    resolve: [],
  }
  d.injected_thought_ids = [2, 5]
  const dict = decisionToDict(d)
  assert.deepEqual(Object.keys(dict), [
    'kind', 'url', 'reason', 'meaning_assessment', 'grounded_concern_ids',
    'demoted', 'inner', 'injected_thought_ids',
  ])
})

test('字节稳定性：envelope {} 入 drop-list 后自主路径序列化字节不变（WO-U3 ①）', () => {
  const viaEvaluate = evaluateMessage({
    content: JSON.stringify({
      meaning_assessment: [{ item: '未整合数 3', meaning: '', concern_id: 7, pull: 0.6 }],
      decision: { kind: 'explore', url: 'https://x.example', reason: '未整合数 3' },
    }),
  }, CANDS, { injectedConcernIds: [7], injectedThoughtIds: [5, 2] })
  // 自主路径不传 envelopeFields → envelope 恒 {} 且被滤掉：
  const expected = '{"kind":"explore","url":"https://x.example","reason":"未整合数 3",'
    + '"meaning_assessment":[{"item":"未整合数 3","meaning":"","concern_id":7,"pull":0.6}],'
    + '"grounded_concern_ids":[7],"demoted":false,"injected_thought_ids":[2,5]}'
  assert.equal(serializeDecision(viaEvaluate), expected)
  // 幂等：两次序列化逐字节相同
  assert.equal(serializeDecision(viaEvaluate), serializeDecision(viaEvaluate))
  // envelope 显式置回 {} 与从未设置字节相同（"{} 加入 drop-list 后一个字节都不变"）
  const clone = { ...viaEvaluate, envelope: {} }
  assert.equal(serializeDecision(clone), expected)
})

test('降级后的 dict：demote 四字段可见、grounded 清空后被滤', () => {
  const d = evaluateMessage({
    content: JSON.stringify({
      meaning_assessment: [{ item: '未整合数 3', meaning: '', concern_id: 7, pull: 0.6 }],
      decision: { kind: 'tend_inner', content: 'x', reason: '未整合数 3' },
    }),
  }, CANDS, { injectedConcernIds: [7] }) // tend_inner 不在候选表 → demote
  const dict = decisionToDict(d)
  assert.equal(dict.kind, 'rest')
  assert.equal(dict.demoted, true)
  assert.equal(dict.demote_why, 'kind_not_in_candidates')
  assert.equal(dict.original_kind, 'tend_inner')
  assert.ok(!('grounded_concern_ids' in dict)) // 清空后落入 [] 档被滤
})
