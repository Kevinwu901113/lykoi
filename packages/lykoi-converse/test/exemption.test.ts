/**
 * 策略豁免（S-69..S-73 + G-10 D-07 的 E3 类）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  approvalMachinery, covers, EXEMPT_ACTION_TYPES, inPresenceReply, label,
  upstreamBudgetedDelivery,
} from '../src/index.ts'

test('S-69：豁免只由类型携带 —— 字符串/字典/null 一律伪造不出来', () => {
  assert.equal(covers('messenger.send', {}, 'E1'), false)
  assert.equal(covers('messenger.send', {}, { category: 'E1' }), false)
  assert.equal(covers('messenger.send', {}, null), false)
  assert.equal(covers('messenger.send', {}, undefined), false)
})

test('S-70：豁免面恰 {messenger.send} —— 工具动作不因伴随应答而降级', () => {
  assert.deepEqual([...EXEMPT_ACTION_TYPES], ['messenger.send'])
  assert.equal(covers('terminal.exec', {}, approvalMachinery()), false)
  assert.equal(covers('browser.type', {}, upstreamBudgetedDelivery()), false)
})

test('E1 / E3 覆盖纯文本出站；E2 必须 peer 精确字符串相等（S-71）', () => {
  assert.equal(covers('messenger.send', {}, approvalMachinery()), true)
  assert.equal(covers('messenger.send', {}, upstreamBudgetedDelivery()), true)
  const e2 = inPresenceReply('chat-1')
  assert.equal(covers('messenger.send', { context_id: 'chat-1' }, e2), true)
  assert.equal(covers('messenger.send', { context_id: 'chat-2' }, e2), false)
  assert.equal(covers('messenger.send', {}, e2), false)
  // 空 context_id 抬成 null → 必然落空 → 回到原分级。
  const blank = inPresenceReply('')
  assert.equal(covers('messenger.send', { context_id: '' }, blank), false)
})

test('S-73：label —— 非标记记 null（豁免免掉的是问，从来不是账）', () => {
  assert.equal(label(approvalMachinery()), 'E1')
  assert.equal(label(inPresenceReply('c')), 'E2')
  assert.equal(label(upstreamBudgetedDelivery()), 'E3')
  assert.equal(label('E1'), null)
  assert.equal(label(null), null)
})
