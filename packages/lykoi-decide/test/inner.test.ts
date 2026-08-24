/**
 * inner 通道（SA-25..30）：sanitizeInner 永不抛/有界扫描/白名单/bool 双排除/
 * 注意力域第一道闸；applyInner 永不抛/容量软拒/事件名 source 派生。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyInner,
  sanitizeInner,
  type ApplyInnerStore,
  type LogEvent,
} from '../src/index.ts'

const EMPTY = { thoughts: [], resolve: [] }

test('SA-26：非 dict → 空缺省；两个空列表完全合法（永不抛）', () => {
  assert.deepEqual(sanitizeInner(null, { injectedIds: [] }), EMPTY)
  assert.deepEqual(sanitizeInner('inner', { injectedIds: [] }), EMPTY)
  assert.deepEqual(sanitizeInner([1, 2], { injectedIds: [] }), EMPTY)
  assert.deepEqual(sanitizeInner({}, { injectedIds: [] }), EMPTY)
  assert.deepEqual(sanitizeInner({ thoughts: 'x', resolve: 'y' }, { injectedIds: [] }), EMPTY)
})

test('SA-25：kind 白名单 5 项、每次至多 2 条、content ≤200 码点', () => {
  const ok = (content: string, kind = 'question') => ({ content, kind, charge_hint: 0.6 })
  const out = sanitizeInner({
    thoughts: [
      ok('t1'),
      { content: 't-bad-kind', kind: 'daydream' }, //         白名单外 → 丢
      { content: '', kind: 'intent' }, //                     空 → 丢
      { content: '   ', kind: 'intent' }, //                  strip 后空 → 丢
      { content: 'x'.repeat(201), kind: 'intent' }, //        超长 → 丢
      { content: 42, kind: 'intent' }, //                     非字符串 → 丢
      ok('t2', 'observation'),
      ok('t3-overflow'), //                                   已满 2 条 → 不收
    ],
    resolve: [],
  }, { injectedIds: [] })
  assert.deepEqual(out.thoughts.map((t) => [t.content, t.kind]), [
    ['t1', 'question'], ['t2', 'observation'],
  ])
  // 恰 200 码点合法
  const exact = sanitizeInner({
    thoughts: [{ content: '长'.repeat(200), kind: 'intent' }], resolve: [],
  }, { injectedIds: [] })
  assert.equal(exact.thoughts.length, 1)
})

test('SA-26：有界扫描 —— 只看前 8 条，第 9 条起即使合法也不收', () => {
  const junk = { content: 42, kind: 'intent' } // 合法形状之外的填充
  const out = sanitizeInner({
    thoughts: [
      ...Array.from({ length: 8 }, () => junk),
      { content: '第 9 条合法但在界外', kind: 'intent' },
    ],
    resolve: [],
  }, { injectedIds: [] })
  assert.deepEqual(out.thoughts, [])
})

test('SA-27：charge_hint 的 bool 显式排除 → 0.5；数值/数字串夹 [0,1]；坏值回落 0.5', () => {
  const one = (charge_hint: unknown) => sanitizeInner({
    thoughts: [{ content: 't', kind: 'intent', charge_hint }], resolve: [],
  }, { injectedIds: [] }).thoughts[0]!.charge_hint
  assert.equal(one(true), 0.5) //   bool ⊂ int 的坑在闸上点名
  assert.equal(one(false), 0.5)
  assert.equal(one(0.8), 0.8)
  assert.equal(one('0.7'), 0.7) //  Python float('0.7') 同向
  assert.equal(one(1.5), 1.0)
  assert.equal(one(-3), 0.0)
  assert.equal(one('abc'), 0.5)
  assert.equal(one(null), 0.5)
  // 缺席 → 0.5
  const absent = sanitizeInner({
    thoughts: [{ content: 't', kind: 'intent' }], resolve: [],
  }, { injectedIds: [] })
  assert.equal(absent.thoughts[0]!.charge_hint, 0.5)
})

test('related_concern_hint：int 非 bool 才留，否则 null', () => {
  const one = (hint: unknown) => sanitizeInner({
    thoughts: [{ content: 't', kind: 'intent', related_concern_hint: hint }], resolve: [],
  }, { injectedIds: [] }).thoughts[0]!.related_concern_hint
  assert.equal(one(7), 7)
  assert.equal(one(true), null)
  assert.equal(one(1.5), null)
  assert.equal(one('7'), null)
  assert.equal(one(null), null)
})

test('SA-27/28：resolve —— bool 显式排除；id 必须 ∈ 注入集（第一道注意力闸）', () => {
  const out = sanitizeInner({
    thoughts: [],
    resolve: [true, false, 42, 99, 7, 'x', 1.5],
  }, { injectedIds: [42, 7] })
  assert.deepEqual(out.resolve, [42, 7])
  // fail-closed：注入集空/缺 → 全丢
  assert.deepEqual(
    sanitizeInner({ resolve: [42] }, { injectedIds: null }).resolve, [])
})

function fakeStore(behavior: {
  create?: (content: string) => number | null
  resolveOk?: Set<number>
}): { store: ApplyInnerStore; created: unknown[][]; resolved: unknown[][] } {
  const created: unknown[][] = []
  const resolved: unknown[][] = []
  return {
    created,
    resolved,
    store: {
      createThought(content, kind, source, opts) {
        created.push([content, kind, source, opts.relatedConcernId, opts.chargeHint, opts.now])
        return behavior.create ? behavior.create(content) : created.length
      },
      resolveThought(id, injectedIds) {
        resolved.push([id, new Set(injectedIds)])
        return behavior.resolveOk ? behavior.resolveOk.has(id) : true
      },
    },
  }
}

const NOW = new Date('2026-08-20T12:00:00Z')

test('SA-29：applyInner —— 创建/了结/容量软拒/异常折软拒，summary 形状', () => {
  const { logEvent, events } = ((): { logEvent: LogEvent; events: [string, Record<string, unknown>][] } => {
    const events: [string, Record<string, unknown>][] = []
    return { logEvent: (n, f) => void events.push([n, f]), events }
  })()
  const { store } = fakeStore({
    create: (content) => {
      if (content === 'cap') return null //                  容量软拒
      if (content === 'boom') throw new Error('bad row') //  异常 → rejected
      return 101
    },
    resolveOk: new Set([42]),
  })
  const summary = applyInner({
    thoughts: [
      { content: 'ok', kind: 'intent', related_concern_hint: 7, charge_hint: 0.6 },
      { content: 'cap', kind: 'question', related_concern_hint: null, charge_hint: 0.5 },
    ],
    resolve: [42, 99],
  }, { source: 'wake', injectedIds: [42, 99], store, now: NOW, logEvent })
  assert.deepEqual(summary, {
    created: [101],
    resolved: [42],
    rejected_resolve: [99],
    rejected_create: [{
      thought: { content: 'cap', kind: 'question', related_concern_hint: null, charge_hint: 0.5 },
      reason: 'capacity',
    }],
  })
  // SA-30：事件名由 source 派生
  assert.deepEqual(events, [['wake_inner_applied', {
    created: 1, resolved: 1, rejected_resolve: 1, rejected_create: 1,
  }]])
})

test('SA-29：createThought 抛错被折为 rejected_create（永不抛）', () => {
  const { store } = fakeStore({
    create: (content) => {
      if (content === 'boom') throw new Error('unknown thought kind')
      return 7
    },
  })
  const summary = applyInner({
    thoughts: [
      { content: 'boom', kind: 'intent', related_concern_hint: null, charge_hint: 0.5 },
      { content: 'fine', kind: 'intent', related_concern_hint: null, charge_hint: 0.5 },
    ],
    resolve: [],
  }, { source: 'conversation', injectedIds: [], store, now: NOW })
  assert.deepEqual(summary.created, [7])
  assert.equal(summary.rejected_create![0]!.reason, 'unknown thought kind')
})

test('SA-30：source 派生事件名（wake/conversation 字节不变；无 rejected_create 键省略）', () => {
  const events: [string, Record<string, unknown>][] = []
  const { store } = fakeStore({})
  const summary = applyInner(
    { thoughts: [], resolve: [] },
    {
      source: 'conversation', injectedIds: [], store, now: NOW,
      logEvent: (n, f) => void events.push([n, f]),
    },
  )
  assert.equal(events[0]![0], 'conversation_inner_applied')
  assert.ok(!('rejected_create' in summary)) // 有拒建时才有该键
  assert.deepEqual(summary, { created: [], resolved: [], rejected_resolve: [] })
})
