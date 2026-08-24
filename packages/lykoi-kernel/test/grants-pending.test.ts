/**
 * scoped grants / standing / denial（SK-22..26）+ pending 队列全生命周期
 * （SK-27..29）+ 写集坏文件姿态四档逐文件（R-14 / GK-2）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  bootstrapOwnerPreauthorization, check, conditionsFor, consumePending, DENIAL_QUIET_H,
  dropPending, enqueuePending, findLivePending, findPending, findPendingByQuestion,
  grantStanding, OWNER_PREAUTHORIZED_ACTIONS, pendingActions, pendingCount, pendingState,
  pendingTtlS, recentDenial, recordDenial, resolvePending, revokeStanding, rulesPath,
  setIdentityBindingLookup, setQuestionMessageId, splitScopedEntry, standingGrants,
  standingPath, sweepExpired, pendingPath, scopedEntry,
} from '../src/index.ts'
import { captureTelemetry, isolateKernelState, T0 } from './fixture.ts'

// ============================== grants（SK-22..25） ==============================

test('SK-23：grant 三拒绝 —— hard_gated / 无 scope key / 键含 *', () => {
  isolateKernelState()
  const events = captureTelemetry()
  assert.equal(grantStanding('terminal.exec', { cmd: 'ls' }), null)
  assert.equal(grantStanding('delegation.dispatch', {}), null)
  assert.equal(grantStanding('messenger.send', {}), null) // 无 context_id → 无键，绝不代以粗键
  assert.equal(grantStanding('messenger.send', null, { scopeKey: 'channel:telegram:*' }), null)
  const reasons = events.filter((e) => e.name === 'standing_grant_refused').map((e) => e.fields.reason)
  assert.deepEqual(reasons, ['hard_gated', 'hard_gated', 'no_scope_key', 'wildcard_key'])
  // 三拒绝零写入：连规则文件都没被碰出来。
  assert.equal(existsSync(rulesPath()), false)
})

test('SK-22/23：授权写规则行 + sidecar；幂等；消费精确串相等永不通配', () => {
  isolateKernelState()
  const record = grantStanding('messenger.send', { context_id: '42' }, {
    question: '能给他发吗', answer: '可以', conditions: ['别提我家地址'], now: T0,
  })
  assert.equal(record!.entry, 'messenger.send@channel:telegram:42')
  // conditions_for 注入面（Kevin 原话非机器约束）。
  assert.deepEqual(conditionsFor('messenger.send', { context_id: '42' }), ['别提我家地址'])
  assert.deepEqual(conditionsFor('messenger.send', { context_id: '9' }), [])
  // 幂等：重授刷新 sidecar（同 (type,key) 覆写 —— 活体语义）、规则恰一行不叠副本。
  grantStanding('messenger.send', { context_id: '42' }, { now: T0 })
  const allow = JSON.parse(readFileSync(rulesPath(), 'utf8')).always_allow as string[]
  assert.deepEqual(allow, ['messenger.send@channel:telegram:42'])
  assert.equal(standingGrants().length, 1)
  // 消费：恰这个 scope allow，别的 ask。
  assert.equal(check('messenger.send', 'interactive', { context_id: '42' }), 'allow')
  assert.equal(check('messenger.send', 'interactive', { context_id: '420' }), 'ask')
})

test('SK-19 _persist：scoped-grant 写不丢 autonomous 子块', () => {
  isolateKernelState()
  writeFileSync(rulesPath(), JSON.stringify({
    always_allow: [], always_deny: [], ask: [],
    autonomous: { always_allow: [], always_deny: ['messenger.send'] },
  }))
  grantStanding('browser.navigate', { url: 'https://example.com' }, { now: T0 })
  const doc = JSON.parse(readFileSync(rulesPath(), 'utf8'))
  assert.deepEqual(doc.autonomous, { always_allow: [], always_deny: ['messenger.send'] })
  assert.deepEqual(doc.always_allow, ['browser.navigate@domain:example.com'])
})

test('SK-24：revoke 恰删一行、立即生效；standing_grants 权威=规则行', () => {
  isolateKernelState()
  grantStanding('messenger.send', { context_id: 'a' }, { now: T0 })
  grantStanding('messenger.send', { context_id: 'b' }, { now: T0 })
  assert.equal(standingGrants().length, 2)
  assert.equal(revokeStanding('messenger.send', 'channel:telegram:a', { now: T0 }), true)
  assert.equal(revokeStanding('messenger.send', 'channel:telegram:a', { now: T0 }), false) // 已删
  assert.equal(check('messenger.send', 'interactive', { context_id: 'a' }), 'ask')
  const live = standingGrants()
  assert.equal(live.length, 1)
  assert.equal(live[0]!.scope_key, 'channel:telegram:b')
  // sidecar 里被撤销的记录盖 revoked_at 但不再是权威（authority = 规则行）。
  const sidecar = JSON.parse(readFileSync(standingPath(), 'utf8'))
  const revoked = sidecar.grants.find((g: Record<string, unknown>) => g.scope_key === 'channel:telegram:a')
  assert.ok(revoked.revoked_at)
})

test('SK-24 附：sidecar 条目无规则行 = 什么都不授（元数据永远不是权威）', () => {
  isolateKernelState()
  writeFileSync(standingPath(), JSON.stringify({
    grants: [{ entry: 'messenger.send@channel:telegram:x', action_type: 'messenger.send', scope_key: 'channel:telegram:x' }],
    denials: [],
  }))
  assert.equal(check('messenger.send', 'interactive', { context_id: 'x' }), 'ask')
  assert.equal(standingGrants().length, 0)
})

test('SK-25：record_denial advisory-only 不接 check；24h 静默窗；denials 尾 100', () => {
  isolateKernelState()
  recordDenial('messenger.send', 'channel:telegram:z', { answer: '不要', now: T0 })
  // 拒绝**不**变成 deny 规则：check 仍 ask。
  assert.equal(check('messenger.send', 'interactive', { context_id: 'z' }), 'ask')
  assert.equal(DENIAL_QUIET_H, 24.0)
  const within = new Date(T0.getTime() + 23 * 3600_000)
  const outside = new Date(T0.getTime() + 25 * 3600_000)
  assert.ok(recentDenial('messenger.send', 'channel:telegram:z', { now: within }))
  assert.equal(recentDenial('messenger.send', 'channel:telegram:z', { now: outside }), null)
  for (let i = 0; i < 105; i++) recordDenial('messenger.send', `channel:telegram:${i}`, { now: T0 })
  assert.equal(JSON.parse(readFileSync(standingPath(), 'utf8')).denials.length, 100)
})

test('SK-26：OWNER_PREAUTHORIZED bootstrap 函数体（不挂启动 —— M4 清单动作）', () => {
  isolateKernelState()
  assert.deepEqual([...OWNER_PREAUTHORIZED_ACTIONS], ['messenger.send'])
  // 无 owner 行 → 什么都不授、告知调用方。
  assert.deepEqual(bootstrapOwnerPreauthorization(null, {}), { owner_user_id: null, granted: [], already: [] })
  // 有 owner → 一条 user: 键授权；幂等重放报 already。
  const first = bootstrapOwnerPreauthorization('user_001', { now: T0 })
  assert.deepEqual(first, { owner_user_id: 'user_001', granted: ['messenger.send@user:user_001'], already: [] })
  const again = bootstrapOwnerPreauthorization(null, { ownerLookup: () => 'user_001', now: T0 })
  assert.deepEqual(again, { owner_user_id: 'user_001', granted: [], already: ['messenger.send@user:user_001'] })
  // 预授权走的是绑定后的 user 键：绑定命中才 allow，未绑定通道仍 ask（最窄默认）。
  setIdentityBindingLookup((c, k) => (c === 'telegram' && k === '1001' ? 'user_001' : null))
  assert.equal(check('messenger.send', 'interactive', { context_id: '1001' }), 'allow')
  assert.equal(check('messenger.send', 'interactive', { context_id: '9999' }), 'ask')
})

test('scopedEntry/splitScopedEntry 往返；平条目 null', () => {
  assert.equal(scopedEntry('messenger.send', 'user:u1'), 'messenger.send@user:u1')
  assert.deepEqual(splitScopedEntry('messenger.send@user:u1'), ['messenger.send', 'user:u1'])
  assert.equal(splitScopedEntry('browser.navigate'), null)
  assert.equal(splitScopedEntry('@key'), null)
  assert.equal(splitScopedEntry('type@'), null)
})

// ============================== pending（SK-27..29） ==============================

test('SK-27：enqueue 字段 12 项；(type, params) 去重同 id；TTL 900s env 可覆写', () => {
  isolateKernelState()
  assert.equal(pendingTtlS(), 900)
  const id = enqueuePending('terminal.exec', { cmd: 'ls' }, {
    origin: 'interactive', questionMessageId: 555, questionText: '要跑 ls 吗', now: T0,
  })
  const dup = enqueuePending('terminal.exec', { cmd: 'ls' }, { now: T0 })
  assert.equal(dup, id) // same action+params -> same grant
  const record = findPending(id)!
  assert.deepEqual(Object.keys(record).sort(), [
    'action_type', 'consumed_at', 'correlation_id', 'expires_at', 'id', 'origin',
    'params', 'params_hash', 'question_message_id', 'question_text', 'run_id', 'ts',
  ])
  assert.equal(record.question_message_id, '555')
  assert.equal(Date.parse(String(record.expires_at)) - T0.getTime(), 900_000)
  process.env.LYKOI_PENDING_TTL_S = '60'
  assert.equal(pendingTtlS(), 60)
  delete process.env.LYKOI_PENDING_TTL_S
})

test('SK-28：consume 原子认领四拒绝态 + ok 恰一次', () => {
  isolateKernelState()
  const id = enqueuePending('terminal.exec', { cmd: 'ls' }, { now: T0 })
  assert.deepEqual(consumePending('nope', { cmd: 'ls' }, { now: T0 }), ['missing', null])
  assert.deepEqual(consumePending(id, { cmd: 'rm -rf /' }, { now: T0 }), ['mismatch', null])
  const [ok, record] = consumePending(id, { cmd: 'ls' }, { now: T0 })
  assert.equal(ok, 'ok')
  assert.equal(record!.actor, 'owner')
  assert.deepEqual(consumePending(id, { cmd: 'ls' }, { now: T0 }), ['consumed', null]) // 不可重放
  const late = enqueuePending('browser.navigate', { url: 'https://x.com' }, { now: T0 })
  const after = new Date(T0.getTime() + 901_000)
  assert.deepEqual(consumePending(late, { url: 'https://x.com' }, { now: after }), ['expired', null])
})

test('SK-29：find 含死记录 / 判序 consumed>resolved>expired>live / 问句单链 / mark-only / sweep', () => {
  isolateKernelState()
  const id = enqueuePending('terminal.exec', { cmd: 'ls' }, { questionMessageId: 'm1', now: T0 })
  // 问句单链：追问改指最新消息。
  assert.equal(setQuestionMessageId(id, 'm2'), true)
  assert.equal(findPendingByQuestion('m1'), null)
  assert.equal(findPendingByQuestion('m2')!.id, id)
  // resolve mark-only：记录仍在文件、仍可按问句找到（死记录也答得上话）。
  assert.equal(resolvePending(id, 'denied', { now: T0 }), true)
  assert.equal(resolvePending(id, 'denied', { now: T0 }), false) // 已 resolved 不再改
  assert.equal(findPendingByQuestion('m2')!.resolved, 'denied')
  assert.equal(pendingState(findPending(id)!, { now: T0 }), 'resolved')
  assert.equal(pendingActions({ now: T0 }).length, 0) // 关了的记录永远答不成执行
  // 判序：consumed 压过时间流逝。
  const id2 = enqueuePending('browser.navigate', { url: 'https://x.com' }, { now: T0 })
  consumePending(id2, { url: 'https://x.com' }, { now: T0 })
  const muchLater = new Date(T0.getTime() + 3_600_000)
  assert.equal(pendingState(findPending(id2)!, { now: muchLater }), 'consumed')
  // sweep：过期未消费 → resolved="expired"，mark-only 幂等。
  const id3 = enqueuePending('browser.click', { selector: '#a' }, { now: T0 })
  assert.equal(sweepExpired({ now: muchLater }), 1)
  assert.equal(sweepExpired({ now: muchLater }), 0)
  const swept = findPending(id3)!
  assert.equal(swept.resolved, 'expired')
  assert.equal(pendingState(swept, { now: muchLater }), 'resolved')
  // findLivePending：只认活的。
  const id4 = enqueuePending('browser.type', { text: 'hi' }, { now: muchLater })
  assert.equal(findLivePending('browser.type', { text: 'hi' }, { now: muchLater })!.id, id4)
  assert.equal(findLivePending('browser.click', { selector: '#a' }, { now: muchLater }), null)
  assert.equal(pendingCount({ now: muchLater }), 1)
  // dropPending 存在且删行（活体端点语义原样）。
  dropPending(id4)
  assert.equal(findPending(id4), null)
})

// ============================== 坏文件姿态四档（R-14 / GK-2） ==============================

test('坏文件①approval_rules：fail CLOSED 空默认 + 事件，不崩溃（SK-19）', () => {
  isolateKernelState()
  const events = captureTelemetry()
  writeFileSync(rulesPath(), '{{{ not json')
  assert.equal(check('browser.navigate', 'interactive'), 'ask') // 空默认 → 默认 ask
  assert.ok(events.some((e) => e.name === 'approval_rules_invalid'))
  // schema 不合同样 fail closed。
  writeFileSync(rulesPath(), JSON.stringify({ always_allow: ['browser.navigate'], bogus_key: 1 }))
  assert.equal(check('browser.navigate', 'interactive'), 'ask')
})

test('坏文件②standing_grants：归零 + 事件；什么都不授（sidecar 非权威）', () => {
  isolateKernelState()
  const events = captureTelemetry()
  writeFileSync(standingPath(), 'garbage')
  assert.deepEqual(standingGrants(), [])
  assert.ok(events.some((e) => e.name === 'standing_grants_unreadable'))
  // 非 dict / 非 list 亦归零。
  writeFileSync(standingPath(), JSON.stringify([1, 2]))
  assert.deepEqual(standingGrants(), [])
  writeFileSync(standingPath(), JSON.stringify({ grants: 'no', denials: 3 }))
  assert.deepEqual(recentDenial('messenger.send', 'user:u', { now: T0 }), null)
})

test('坏文件③pending_actions：**无保护 —— 可见崩溃**（GK-2 照抄；不许顺手 try/catch）', () => {
  isolateKernelState()
  writeFileSync(pendingPath(), '{{{ not json')
  assert.throws(() => pendingActions({ now: T0 }), SyntaxError)
  assert.throws(() => enqueuePending('terminal.exec', { cmd: 'ls' }, { now: T0 }), SyntaxError)
  assert.throws(() => consumePending('x', {}, { now: T0 }), SyntaxError)
})
