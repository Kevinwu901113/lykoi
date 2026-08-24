/**
 * rw W4 面：store 层遥测接法（W3 新增 TODO#1 定案=构造注入，缺省 no-op）+
 * 学习环新增写面的库层语义（W4 各层测试之外的 store 直测面）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'

const T0 = new Date('2026-08-24T10:00:00Z')

function mk(withLog: boolean): {
  store: ReadWriteMemory
  events: [string, Record<string, unknown>][]
} {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-rw-w4-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  const events: [string, Record<string, unknown>][] = []
  const store = withLog
    ? new ReadWriteMemory(path, { logEvent: (n, f) => events.push([n, f]) })
    : new ReadWriteMemory(path)
  return { store, events }
}

test('遥测接法（W3 TODO#1 定案）：缺省 no-op——不注入照常写，注入后 store 内部事件位可见', () => {
  // 缺省：纯库形态，零遥测依赖。
  const plain = mk(false)
  try {
    const id = plain.store.recordExperience('conversation', 'x', { now: T0 })
    assert.ok(id > 0)
  } finally {
    plain.store.close()
  }
  // 注入：mind_experience 带 Python 逐字字段（id/source/salience/pending 旧口径）。
  const { store, events } = mk(true)
  try {
    store.recordExperience('conversation', 'x', { now: T0 })
    store.recordExperience('environment', 'y', { now: T0 }) // 旧口径 pending 不计 environment
    const mind = events.filter(([n]) => n === 'mind_experience').map(([, f]) => f)
    assert.deepEqual(mind.map((f) => f.pending), [1, 1])
    assert.deepEqual(mind[0], { id: 1, source: 'conversation', salience: 0.5, pending: 1 })
    // mind_regulation 事件位。
    store.applyRegulationCause('experience_recorded', { now: T0 })
    const reg = events.filter(([n]) => n === 'mind_regulation').map(([, f]) => f)
    assert.equal(reg.length, 1)
    assert.deepEqual([reg[0]!.name, reg[0]!.cause], ['load', 'experience_recorded'])
  } finally {
    store.close()
  }
})

test('thought_resolve_rejected 三条拒绝分支只有 store 自己分得清（注入定案的决定性理由）', () => {
  const { store, events } = mk(true)
  try {
    const t1 = store.createThought('念头', 'intent', 'wake', { now: T0 })!
    // 集外 → not_in_injected_set（零副作用，未开事务）。
    assert.equal(store.resolveThought(t1, []), false)
    // 不存在 → not_found。
    assert.equal(store.resolveThought(999, [999]), false)
    // 成功 → thought_resolved。
    assert.equal(store.resolveThought(t1, [t1]), true)
    // 非 open → not_open。
    assert.equal(store.resolveThought(t1, [t1]), false)
    const rejected = events.filter(([n]) => n === 'thought_resolve_rejected').map(([, f]) => f.reason)
    assert.deepEqual(rejected, ['not_in_injected_set', 'not_found', 'not_open'])
    assert.equal(events.filter(([n]) => n === 'thought_resolved').length, 1)
    // settle/archive 事件位（thoughts.py:201/241 逐字名）。
    store.settleThought(t1, 7)
    assert.deepEqual(events.at(-1), ['thought_settled', { id: t1, integration_id: 7 }])
    const t2 = store.createThought('另一个', 'question', 'wake', { now: T0 })!
    assert.equal(store.resolveThought(t2, [t2]), true)
    store.archiveThought(t2)
    assert.deepEqual(events.at(-1), ['thought_archived', { id: t2 }])
  } finally {
    store.close()
  }
})

test('getOpenThoughts 注意力序（charge DESC, ts ASC, id ASC）与 thoughtsAwaitingClearance（id 序）', () => {
  const { store } = mk(true)
  try {
    const a = store.createThought('弱', 'intent', 'wake', { chargeHint: 0.3, now: T0 })!
    const b = store.createThought('强', 'intent', 'wake', { chargeHint: 0.9, now: new Date(T0.getTime() + 1000) })!
    const c = store.createThought('同强较早', 'intent', 'wake', { chargeHint: 0.9, now: T0 })!
    assert.deepEqual(store.getOpenThoughts().map((r) => r.id), [c, b, a])
    store.resolveThought(a, [a])
    store.resolveThought(b, [b])
    assert.deepEqual(store.thoughtsAwaitingClearance().map((r) => r.id), [a, b])
  } finally {
    store.close()
  }
})

test('upsertInsight：(category, content) 去重——重复只刷 updated 返回原 id（SA-133 的库层前提）', () => {
  const { store } = mk(true)
  try {
    const i1 = store.upsertInsight('focus', '同一句', { now: T0 })
    const i2 = store.upsertInsight('focus', '同一句', { now: new Date(T0.getTime() + 5000) })
    const i3 = store.upsertInsight('preference', '同一句', { now: T0 }) // 类别不同 = 不同行
    assert.equal(i1, i2)
    assert.notEqual(i1, i3)
    const rows = store.getInsights('focus')
    assert.equal(rows.length, 1)
    assert.notEqual(rows[0]!.updated, rows[0]!.created)
  } finally {
    store.close()
  }
})

test('releaseConcern 三态：非 dormant 拒（ReleaseCandidacyError+事件）/ dormant 放行 / viaOwner 后门', () => {
  const { store, events } = mk(true)
  try {
    const c1 = store.createConcern('interest', 'a', { weight: 0.5, origin: 'grown', now: T0 })
    const c2 = store.createConcern('interest', 'b', { weight: 0.5, origin: 'grown', now: T0 })
    assert.throws(() => store.releaseConcern(c1, 'r', { now: T0 }), /ReleaseCandidacyError/)
    assert.ok(events.some(([n]) => n === 'release_rejected_non_dormant'))
    assert.throws(() => store.releaseConcern(c1, '  ', { now: T0 }), /requires a reason/)
    // owner 后门绕过候选闸（reason 校验仍在）。
    store.releaseConcern(c1, 'owner said so', { now: T0, viaOwner: true })
    assert.equal(store.listConcerns('released').length, 1)
    assert.throws(() => store.releaseConcern(c1, 'again', { now: T0, viaOwner: true }), /already released/)
    void c2
  } finally {
    store.close()
  }
})

test('bumpWakesSince 双计数器仍同源 +1（G-4 后为账面列；行为与 W3 对拍不变）', () => {
  const { store } = mk(true)
  try {
    assert.equal(store.bumpWakesSince({ now: T0 }), 1)
    assert.equal(store.bumpWakesSince({ now: T0 }), 2)
    assert.equal(store.getFocusWakesSince(), 2)
    store.resetFocusCycle({ now: T0 })
    assert.equal(store.getFocusWakesSince(), 0)
    assert.equal((store.getIntegrationState().wakes_since as number), 2)
  } finally {
    store.close()
  }
})
