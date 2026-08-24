/**
 * 三层门 check 判定全序 10 步（SK-15..21）+ GT-4 红测 + 硬 deny 胜过批准红测 +
 * E1/E2/E3 在 check 末位承重的结构测试（SK-47/48）+ GK-7 delegated 空集地板。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { writeFileSync } from 'node:fs'
import {
  _policyDecision, _setPolicyCoreForTest, approvalMachinery, check,
  DELEGATED_ALLOWED, DELEGATION_READONLY, inPresenceReply, isHardGated,
  rulesPath, SCHEDULER_ALLOWED, upstreamBudgetedDelivery, validateRules,
} from '../src/index.ts'
import { isolateKernelState } from './fixture.ts'

function writeRules(rules: unknown): void {
  writeFileSync(rulesPath(), JSON.stringify(rules))
}

test('①硬 deny 压过一切（含所有者批准 —— 硬 deny 胜过批准红测）', () => {
  isolateKernelState()
  _setPolicyCoreForTest({
    hardDecision: (t) => (t === 'browser.navigate' ? 'deny' : null),
    capabilityProfile: () => null,
  })
  writeRules({ always_allow: ['browser.navigate'], always_deny: [], ask: [] })
  assert.equal(check('browser.navigate', 'interactive'), 'deny')
  // SK-06：check→deny 恒 deny —— pre_approved=true 翻不过硬 deny。
  assert.equal(_policyDecision('browser.navigate', 'interactive', true), 'deny')
})

test('GT-4 红测：autonomous 请求 terminal.exec = deny 不是 ask（②能力 deny 先于⑤硬 ask）', () => {
  isolateKernelState()
  assert.equal(check('terminal.exec', 'autonomous'), 'deny')
  assert.equal(check('delegation.dispatch', 'autonomous'), 'deny')
  // 同一动作 interactive 落硬 ask —— 差异恰好证明先后序。
  assert.equal(check('terminal.exec', 'interactive'), 'ask')
})

test('③live always_deny 胜过④能力 allow（live 只能收紧）+ 胜过批准', () => {
  isolateKernelState()
  writeRules({
    always_allow: [], always_deny: [], ask: [],
    autonomous: { always_allow: [], always_deny: ['messenger.send'] },
  })
  // messenger.send ∈ AUTONOMOUS_ALLOWED（能力 allow），但 autonomous 子块的
  // always_deny 先说话（SK-17：子块只收紧）。
  assert.equal(check('messenger.send', 'autonomous'), 'deny')
  assert.equal(_policyDecision('messenger.send', 'autonomous', true), 'deny')
})

test('④能力 allow：autonomous 白名单内、未收紧 → allow（不再看 live allow）', () => {
  isolateKernelState()
  assert.equal(check('research_browser.read_text', 'autonomous'), 'allow')
  assert.equal(check('autonomy.queue_notification', 'autonomous'), 'allow')
  assert.equal(check('autonomy.initiate_chat', 'autonomous'), 'allow')
})

test('⑤硬 ask 是 interactive 地板：always_allow 含硬门成员时硬门仍 ask（SK-18 红测）', () => {
  isolateKernelState()
  writeRules({ always_allow: ['terminal.exec', 'delegation.dispatch'], always_deny: [], ask: [] })
  assert.equal(check('terminal.exec', 'interactive'), 'ask')
  assert.equal(check('delegation.dispatch', 'interactive'), 'ask')
  // pre_approved 才是那一次的合法出口（SK-06 四值）。
  assert.equal(_policyDecision('terminal.exec', 'interactive', true), 'pre_approved')
})

test('⑥live always_allow：精确 + 类别通配', () => {
  isolateKernelState()
  writeRules({ always_allow: ['browser.*'], always_deny: ['browser.type'], ask: [] })
  assert.equal(check('browser.navigate', 'interactive'), 'allow')
  assert.equal(check('browser.type', 'interactive'), 'deny') // specific deny wins over category allow
})

test('⑦DELEGATION_READONLY：代码常量非规则行；翻不动 always_deny；对受地板 origin 无效（SK-21）', () => {
  isolateKernelState()
  assert.deepEqual(new Set(DELEGATION_READONLY), new Set(['delegation.status', 'delegation.collect']))
  assert.equal(check('delegation.status', 'interactive'), 'allow')
  assert.equal(check('delegation.collect', 'interactive'), 'allow')
  writeRules({ always_allow: [], always_deny: ['delegation.status'], ask: [] })
  assert.equal(check('delegation.status', 'interactive'), 'deny') // ③ 先说话
  // autonomous/scheduler/delegated 的能力面在②就已 deny。
  assert.equal(check('delegation.collect', 'autonomous'), 'deny')
  assert.equal(check('delegation.collect', 'scheduler'), 'deny')
  assert.equal(check('delegation.collect', 'delegated'), 'deny')
})

test('⑧scoped grant：精确串相等消费；被塞的 terminal.exec@… 行什么都授不出（SK-22）', () => {
  isolateKernelState()
  writeRules({
    always_allow: [
      'messenger.send@channel:telegram:42',
      'terminal.exec@type:whatever', // planted —— 硬 ask 在⑤先返回
    ],
    always_deny: [],
    ask: [],
  })
  assert.equal(check('messenger.send', 'interactive', { context_id: '42' }), 'allow')
  assert.equal(check('messenger.send', 'interactive', { context_id: '43' }), 'ask')
  assert.equal(check('messenger.send', 'interactive'), 'ask') // 无 params → 无键 → 无授权
  assert.equal(check('terminal.exec', 'interactive', { cmd: 'ls' }), 'ask')
})

test('⑨E1/E2/E3 covers 在 check 末位承重（SK-47/48 消费位结构测试）', () => {
  isolateKernelState()
  // 默认 ask 的纯文本出站 —— E 章是唯一能翻它的东西，且只翻它。
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }), 'ask')
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, approvalMachinery()), 'allow')
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, upstreamBudgetedDelivery()), 'allow')
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, inPresenceReply('c9')), 'allow')
  // E2 收件人必须是来话对端（精确相等）。
  assert.equal(check('messenger.send', 'interactive', { context_id: 'other' }, inPresenceReply('c9')), 'ask')
  // 模型自报无效：字符串/字典不是 Exemption。
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, 'E1'), 'ask')
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, { category: 'E1' }), 'ask')
  // E 章救不了硬门动作（⑤先返回）、翻不动 always_deny（③先返回）、
  // 也放不宽豁免面外的工具动作（covers 自身拒绝）。
  assert.equal(check('terminal.exec', 'interactive', {}, approvalMachinery()), 'ask')
  writeRules({ always_allow: [], always_deny: ['messenger.send'], ask: [] })
  assert.equal(check('messenger.send', 'interactive', { context_id: 'c9' }, approvalMachinery()), 'deny')
  writeRules({ always_allow: [], always_deny: [], ask: [] })
  assert.equal(check('browser.navigate', 'interactive', { url: 'https://a.com' }, approvalMachinery()), 'ask')
})

test('⑩默认 ask（origin 缺省 interactive —— 单参调用不变）', () => {
  isolateKernelState()
  assert.equal(check('browser.navigate'), 'ask')
  assert.equal(check('messenger.read'), 'ask')
})

test('scheduler 地板 = {notify.owner}，deny-by-default，被塞的 always_allow 放不宽（SK-16）', () => {
  isolateKernelState()
  assert.deepEqual([...SCHEDULER_ALLOWED], ['notify.owner'])
  assert.equal(check('notify.owner', 'scheduler'), 'allow')
  writeRules({ always_allow: ['browser.navigate', 'messenger.send'], always_deny: [], ask: [] })
  assert.equal(check('browser.navigate', 'scheduler'), 'deny')
  assert.equal(check('messenger.send', 'scheduler'), 'deny')
})

test('GK-7：delegated origin 显式地板 = 空集 frozenset —— 全动作面 deny（比活体收紧；列追认）', () => {
  isolateKernelState()
  assert.equal(DELEGATED_ALLOWED.size, 0)
  writeRules({ always_allow: ['messenger.send', 'browser.*'], always_deny: [], ask: [] })
  for (const actionType of ['messenger.send', 'browser.navigate', 'delegation.status', 'notify.owner']) {
    assert.equal(check(actionType, 'delegated'), 'deny', `${actionType} 必须在②被地板拒绝`)
  }
})

test('core 缺失 fail CLOSED：check 全落 ask（interactive）、autonomous 全 deny、is_hard_gated 全真（SK-16/20）', () => {
  isolateKernelState()
  _setPolicyCoreForTest(null)
  writeRules({ always_allow: ['browser.navigate'], always_deny: [], ask: [] })
  // 硬地板 fail closed 成 "ask"：连 always_allow 也抬不动（⑤先返回）。
  assert.equal(check('browser.navigate', 'interactive'), 'ask')
  assert.equal(check('messenger.read', 'interactive'), 'ask')
  // autonomous 面缩到零。
  assert.equal(check('research_browser.read_text', 'autonomous'), 'deny')
  assert.equal(check('messenger.send', 'autonomous'), 'deny')
  // 全表硬门（SK-20：core 缺失 fail closed 到 ask 也是硬门）。
  assert.ok(isHardGated('browser.navigate'))
  assert.ok(isHardGated('messenger.send'))
})

test('validateRules：顶层键钉死 + autonomous 子块形状（SK-18）', () => {
  assert.deepEqual(validateRules({ always_allow: [], always_deny: [], ask: [] }), [])
  assert.deepEqual(
    validateRules({ always_allow: [], always_deny: [], ask: [], autonomous: { always_allow: ['a.b'], always_deny: [] } }),
    [],
  )
  assert.ok(validateRules([]).length > 0)
  assert.ok(validateRules({ always_allow: [], always_deny: [], ask: [], extra: [] }).some((p) => p.includes('unknown top-level')))
  assert.ok(validateRules({ always_allow: 'no', always_deny: [], ask: [] }).some((p) => p.includes('always_allow')))
  assert.ok(validateRules({ always_allow: [], always_deny: [], ask: [], autonomous: { nope: 1 } }).some((p) => p.includes('unknown autonomous')))
  assert.ok(validateRules({ always_allow: [], always_deny: [], ask: [], autonomous: 3 }).some((p) => p.includes('autonomous block')))
})
