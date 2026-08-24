/**
 * scope key 全表（SK-69）：messenger user:/channel: 降级不放宽、domain eTLD+1
 * 刻意偏窄、UNSCOPABLE → null、退化键 type:。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_CHANNEL, registeredDomain, resolveScopeKey, scopeKey,
  setIdentityBindingLookup, UNSCOPABLE,
} from '../src/index.ts'
import { captureTelemetry, isolateKernelState } from './fixture.ts'

test('UNSCOPABLE = {terminal.exec, delegation.dispatch} → null（免询封堵三件套之一，SK-68）', () => {
  isolateKernelState()
  assert.deepEqual(new Set(UNSCOPABLE), new Set(['terminal.exec', 'delegation.dispatch']))
  assert.equal(scopeKey('terminal.exec', { cmd: 'ls' }), null)
  assert.equal(scopeKey('delegation.dispatch', { contract_yaml: 'x', agent_user_id: 'a' }), null)
})

test('messenger.send：绑定塌 user:、未绑定停 channel:、无 context_id 无键', () => {
  isolateKernelState()
  setIdentityBindingLookup((channel, key) => (channel === 'telegram' && key === '1001' ? 'user_001' : null))
  assert.equal(scopeKey('messenger.send', { context_id: '1001' }), 'user:user_001')
  assert.equal(scopeKey('messenger.send', { context_id: '2002' }), 'channel:telegram:2002')
  assert.equal(scopeKey('messenger.send', { context_id: 7, channel: 'irc' }), 'channel:irc:7')
  assert.equal(scopeKey('messenger.send', {}), null)
  assert.equal(scopeKey('messenger.send', { context_id: '' }), null)
  assert.equal(DEFAULT_CHANNEL, 'telegram')
})

test('messenger.send 降级不放宽：绑定读点抛 → 停在更窄的 channel 键 + 遥测', () => {
  isolateKernelState()
  const events = captureTelemetry()
  setIdentityBindingLookup(() => {
    throw new Error('db locked')
  })
  assert.equal(scopeKey('messenger.send', { context_id: '1001' }), 'channel:telegram:1001')
  assert.ok(events.some((e) => e.name === 'scope_binding_lookup_failed'))
})

test('registeredDomain：eTLD+1 刻意偏窄（普通两标签 / 注册级三标签 / IP / IPv6 / 单标签）', () => {
  assert.equal(registeredDomain('sub.example.com'), 'example.com')
  assert.equal(registeredDomain('a.b.example.com'), 'example.com')
  assert.equal(registeredDomain('www.something.co.uk'), 'something.co.uk')
  assert.equal(registeredDomain('x.y.co.uk'), 'y.co.uk')
  assert.equal(registeredDomain('shop.example.com.br'), 'example.com.br')
  // 表外但命中启发式（两字母 ccTLD + 注册级 SLD）→ 保三标签（偏窄）。
  assert.equal(registeredDomain('a.foo.co.zz'), 'foo.co.zz')
  assert.equal(registeredDomain('192.168.1.1'), '192.168.1.1')
  assert.equal(registeredDomain('::ffff:1.2.3.4'), '::ffff:1.2.3.4')
  assert.equal(registeredDomain('localhost'), 'localhost')
  assert.equal(registeredDomain('EXAMPLE.Com.'), 'example.com')
})

test('domain 键：url/target 双取位、无 scheme 也解析、坏输入无键', () => {
  isolateKernelState()
  assert.equal(scopeKey('browser.navigate', { url: 'https://news.example.com/a?b=1' }), 'domain:example.com')
  assert.equal(scopeKey('research_browser.open', { target: 'sub.foo.co.uk/path' }), 'domain:foo.co.uk')
  assert.equal(scopeKey('browser.navigate', { url: 'http://user:pw@host.example.org:8080/x' }), 'domain:example.org')
  assert.equal(scopeKey('browser.navigate', { url: '' }), null)
  assert.equal(scopeKey('browser.navigate', {}), null)
  assert.equal(scopeKey('browser.navigate', { url: 42 as unknown as string }), null)
})

test('退化键 type:<action_type>（其余有副作用者；宽度 = 既有无 scope 的 always_allow 行）', () => {
  isolateKernelState()
  assert.equal(scopeKey('browser.click', {}), 'type:browser.click')
  assert.equal(scopeKey('notify.owner', { message: 'hi' }), 'type:notify.owner')
  assert.equal(scopeKey('delegation.status', {}), 'type:delegation.status')
})

test('resolveScopeKey：params null → null；scope 抛 → null + 遥测（fail-soft 薄包装）', () => {
  isolateKernelState()
  assert.equal(resolveScopeKey('messenger.send', null), null)
  const events = captureTelemetry()
  setIdentityBindingLookup(null)
  // toString 抛的 context_id 逼出 fail-soft 路径：算不出的键就是没有键。
  const explosive = { toString: () => { throw new Error('boom') } }
  assert.equal(resolveScopeKey('messenger.send', { context_id: explosive }), null)
  assert.ok(events.some((e) => e.name === 'scope_key_failed'))
})
