/**
 * W2 补齐面测试：快照/决策消费的读写方法 + 懒衰减数值序 golden（W1 TODO#10 销账）。
 *
 * golden 数值来源：Python 3 在同一公式上逐位计算（struct.pack('>d')），
 * 断言 IEEE-754 位级相等 —— 衰减→delta 的数值次序与 mind/store.apply_regulation_cause
 * 完全一致（先把 updated_at 起算的懒衰减落到 value，再 apply_delta，再 clamp01）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ConcernCapError, ReadWriteMemory } from '../src/rw.ts'
import { makeWritableFixture, rawOpen } from './fixture.ts'

function doubleBits(x: number): string {
  const buf = new DataView(new ArrayBuffer(8))
  buf.setFloat64(0, x)
  let out = ''
  for (let i = 0; i < 8; i++) out += buf.getUint8(i).toString(16).padStart(2, '0')
  return out
}

const T0 = '2026-08-20T00:00:00+00:00'

test('listConcerns 排序 weight DESC, id；status 过滤；缺省全状态', () => {
  const rw = new ReadWriteMemory(makeWritableFixture())
  const now = new Date('2026-08-20T01:00:00Z')
  // fixture 自带 id=1 weight 0.5 active
  rw.createConcern('project', 'B', { weight: 0.9, origin: 'grown', now })
  rw.createConcern('question', 'C', { weight: 0.9, origin: 'grown', now })
  rw.createConcern('interest', 'D', { weight: 0.1, origin: 'floor', now })
  const active = rw.listConcerns('active')
  assert.deepEqual(active.map((c) => c.title), ['B', 'C', 'fixture-concern', 'D'])
  // 同权重平局按 id 升序（B 先于 C）
  assert.ok(active[0]!.id < active[1]!.id)
  const floors = rw.listConcerns(['active', 'dimming']).filter((c) => c.origin === 'floor')
  assert.deepEqual(floors.map((c) => c.title), ['D'])
  assert.equal(rw.listConcerns().length, 4)
  rw.close()
})

test('createConcern 校验红测：kind/origin/title/weight/cap', () => {
  const rw = new ReadWriteMemory(makeWritableFixture())
  const now = new Date('2026-08-20T01:00:00Z')
  assert.throws(() => rw.createConcern('nope', 'x', { weight: 0.5, origin: 'grown', now }),
    /unknown concern kind: 'nope'/)
  assert.throws(() => rw.createConcern('interest', 'x', { weight: 0.5, origin: 'nope', now }),
    /unknown concern origin: 'nope'/)
  assert.throws(() => rw.createConcern('interest', '  ', { weight: 0.5, origin: 'grown', now }),
    /concern title must be non-empty/)
  assert.throws(() => rw.createConcern('interest', 'x', { weight: 1.5, origin: 'grown', now }),
    /concern weight must be in \[0,1\]/)
  // cap=12：fixture 已有 1 条 active，再补 11 条到顶
  for (let i = 0; i < 11; i++) {
    rw.createConcern('interest', `fill-${i}`, { weight: 0.5, origin: 'grown', now })
  }
  assert.throws(
    () => rw.createConcern('interest', 'overflow', { weight: 0.5, origin: 'grown', now }),
    (err: unknown) => err instanceof ConcernCapError
      && /active concerns at cap \(12\); release one first — 取舍即生命/.test((err as Error).message),
  )
  rw.close()
})

test('markDimmingDormant：7/21 天严格大于；dimming 仅对 active；绝不 released', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  const ins = raw.prepare(
    `INSERT INTO concerns (kind, title, description, weight, origin, status, created_at, last_lit_at)
     VALUES ('interest', ?, '', 0.5, 'grown', ?, ?, ?)`,
  )
  // now = 2026-08-20T00:00:00Z；恰 7 天不变、7 天+1h → dimming、22 天 → dormant
  ins.run('exact-7d', 'active', '2026-08-13T00:00:00+00:00', '2026-08-13T00:00:00+00:00')
  ins.run('8d-active', 'active', '2026-08-12T23:00:00+00:00', '2026-08-12T23:00:00+00:00')
  ins.run('22d-active', 'active', '2026-07-29T00:00:00+00:00', '2026-07-29T00:00:00+00:00')
  ins.run('22d-dimming', 'dimming', '2026-07-29T00:00:00+00:00', '2026-07-29T00:00:00+00:00')
  ins.run('8d-dimming', 'dimming', '2026-08-12T23:00:00+00:00', '2026-08-12T23:00:00+00:00')
  // last_lit_at 缺席时按 created_at（COALESCE）
  raw.prepare(
    `INSERT INTO concerns (kind, title, description, weight, origin, status, created_at)
     VALUES ('interest', 'no-lit-9d', '', 0.5, 'grown', 'active', '2026-08-11T00:00:00+00:00')`,
  ).run()
  raw.close()
  const rw = new ReadWriteMemory(path)
  const changes = rw.markDimmingDormant({ now: new Date('2026-08-20T00:00:00Z') })
  const byTitle = new Map(rw.listConcerns().map((c) => [c.title, c.status]))
  assert.equal(byTitle.get('exact-7d'), 'active') //   严格大于：恰 7 天不动
  assert.equal(byTitle.get('8d-active'), 'dimming')
  assert.equal(byTitle.get('22d-active'), 'dormant') // 直落 dormant（不经 dimming）
  assert.equal(byTitle.get('22d-dimming'), 'dormant')
  assert.equal(byTitle.get('8d-dimming'), 'dimming') // dimming 不回退也不重复记
  assert.equal(byTitle.get('no-lit-9d'), 'dimming')
  assert.equal(changes.length, 4)
  assert.ok(changes.every((c) => c.to !== 'released')) // 红线 #3
  rw.close()
})

test('currentCognitiveNarrative：跳过 narrative_only；NULL class 认知可见（SA-41）', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  raw.exec(`
    INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class)
      VALUES ('${T0}', 'v1-legacy', 's', 'integration', NULL);
    INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class)
      VALUES ('${T0}', 'v2-absorb', 's', 'integration', 'absorption');
    INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class)
      VALUES ('${T0}', 'v3-confab', 's', 'integration', 'narrative_only');
  `)
  raw.close()
  const rw = new ReadWriteMemory(path)
  assert.equal(rw.currentCognitiveNarrative()?.content, 'v2-absorb')
  rw.close()
})

test('listThreads/overdueSuspendedThreads：ORDER BY id；30 天严格大于', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  raw.exec(`
    INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
      VALUES ('open_question', 't1', 'open', '${T0}', '2026-08-19T00:00:00+00:00');
    INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
      VALUES ('commitment', 't2-31d', 'suspended', '${T0}', '2026-07-19T23:00:00+00:00');
    INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
      VALUES ('arc', 't3-29d', 'suspended', '${T0}', '2026-07-22T00:00:00+00:00');
    INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
      VALUES ('arc', 't4', 'resolved', '${T0}', '${T0}');
  `)
  raw.close()
  const rw = new ReadWriteMemory(path)
  assert.deepEqual(
    rw.listThreads(['open', 'suspended']).map((t) => t.content), ['t1', 't2-31d', 't3-29d'])
  const overdue = rw.overdueSuspendedThreads({ now: new Date('2026-08-20T00:00:00Z') })
  assert.deepEqual(overdue.map((t) => t.content), ['t2-31d'])
  rw.close()
})

test('countPendingExperiences 排除 environment 与 integrated；recentExperiences id DESC', () => {
  const path = makeWritableFixture()
  const rw = new ReadWriteMemory(path)
  const now = new Date('2026-08-20T01:00:00Z')
  rw.recordExperience('conversation', 'e1', { now })
  rw.recordExperience('environment', 'e2-env', { now })
  const e3 = rw.recordExperience('wake_action', 'e3', { now })
  assert.equal(rw.countPendingExperiences(), 2)
  const raw = rawOpen(path)
  raw.prepare('UPDATE experiences SET integrated = 1, integration_id = 7 WHERE id = ?').run(e3)
  raw.close()
  assert.equal(rw.countPendingExperiences(), 1)
  assert.deepEqual(rw.recentExperiences(2).map((e) => e.content), ['e3', 'e2-env'])
  rw.close()
})

test('getThoughtsForSnapshot：charge DESC, ts ASC, id ASC + LIMIT（SA-38 排序键逐字）', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  const ins = raw.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, charge, status) VALUES (?, ?, 'intent', 'wake', ?, 'open')",
  )
  ins.run('2026-08-20T02:00:00+00:00', 'c', 0.8) // id 1
  ins.run('2026-08-20T01:00:00+00:00', 'a', 0.9) // id 2 最强
  ins.run('2026-08-20T01:00:00+00:00', 'b', 0.8) // id 3 与 id1 同 charge，ts 更早 → 先
  ins.run('2026-08-20T03:00:00+00:00', 'd', 0.7) // id 4
  raw.close()
  const rw = new ReadWriteMemory(path)
  assert.deepEqual(rw.getThoughtsForSnapshot(3).map((t) => t.content), ['a', 'b', 'c'])
  rw.close()
})

test('overdueQuestions：open ∧ question ∧ 超 48h（SA-44）', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  const ins = raw.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, charge, status) VALUES (?, ?, ?, 'wake', 0.5, ?)",
  )
  ins.run('2026-08-17T00:00:00+00:00', 'q-72h', 'question', 'open')
  ins.run('2026-08-19T00:00:00+00:00', 'q-24h', 'question', 'open')
  ins.run('2026-08-17T00:00:00+00:00', 'i-72h', 'intent', 'open')
  ins.run('2026-08-17T00:00:00+00:00', 'q-resolved', 'question', 'resolved')
  raw.close()
  const rw = new ReadWriteMemory(path)
  const rows = rw.overdueQuestions({ now: new Date('2026-08-20T00:00:00Z') })
  assert.deepEqual(rows.map((t) => t.content), ['q-72h'])
  rw.close()
})

test('getRecentHistoryOfType oldest-first；getInsights 按类 ORDER BY id', () => {
  const path = makeWritableFixture()
  const rw = new ReadWriteMemory(path)
  const now = new Date('2026-08-20T01:00:00Z')
  rw.appendHistory('conversation', 'h1', { now })
  rw.appendHistory('health', 'skip', { now })
  rw.appendHistory('conversation', 'h2', { now })
  rw.appendHistory('conversation', 'h3', { now })
  assert.deepEqual(rw.getRecentHistoryOfType('conversation', 2).map((h) => h.content), ['h2', 'h3'])
  const raw = rawOpen(path)
  raw.exec(`
    INSERT INTO insights (created, updated, category, content) VALUES ('${T0}','${T0}','persona','p1');
    INSERT INTO insights (created, updated, category, content) VALUES ('${T0}','${T0}','preference','k1');
    INSERT INTO insights (created, updated, category, content) VALUES ('${T0}','${T0}','persona','p2');
  `)
  raw.close()
  assert.deepEqual(rw.getInsights('persona').map((i) => i.content), ['p1', 'p2'])
  assert.equal(rw.getInsights(null).length, 3)
  rw.close()
})

test('autonomyActionsLastHour：跨 run 求和 + 1h 截断（DB 汇总，重启不清零）', () => {
  const path = makeWritableFixture()
  const rw = new ReadWriteMemory(path)
  const now = new Date('2026-08-20T12:00:00Z')
  rw.startAutonomyRun('r1', { startedAt: new Date('2026-08-20T11:30:00Z') })
  rw.finishAutonomyRun('r1', { status: 'completed', finishedAt: now, actionCount: 2 })
  rw.startAutonomyRun('r2', { startedAt: new Date('2026-08-20T11:45:00Z') })
  rw.finishAutonomyRun('r2', { status: 'completed', finishedAt: now, actionCount: 3 })
  rw.startAutonomyRun('r3-old', { startedAt: new Date('2026-08-20T10:30:00Z') })
  rw.finishAutonomyRun('r3-old', { status: 'completed', finishedAt: now, actionCount: 9 })
  assert.equal(rw.autonomyActionsLastHour({ now }), 5)
  rw.close()
})

test('recentRegulationEvents id DESC + name 过滤；lastCauseEventTs MAX(ts)/空集 null', () => {
  const path = makeWritableFixture()
  const rw = new ReadWriteMemory(path)
  rw.applyRegulationCause('rested', { now: new Date('2026-08-20T01:00:00Z') })
  rw.applyRegulationCause('experience_recorded', { now: new Date('2026-08-20T02:00:00Z') })
  rw.applyRegulationCause('explore_completed', { now: new Date('2026-08-20T03:00:00Z') })
  const loadEvents = rw.recentRegulationEvents('load', 5)
  assert.deepEqual(loadEvents.map((e) => e.cause), ['experience_recorded', 'rested'])
  assert.equal(rw.recentRegulationEvents(null, 10).length, 3)
  assert.equal(rw.lastCauseEventTs(['explore_completed']), '2026-08-20T03:00:00+00:00')
  assert.equal(
    rw.lastCauseEventTs(['rested', 'experience_recorded']), '2026-08-20T02:00:00+00:00')
  assert.equal(rw.lastCauseEventTs([]), null)
  assert.equal(rw.lastCauseEventTs(['no_such_cause']), null)
  rw.close()
})

// ============================== 懒衰减数值序 golden（W1 TODO#10 销账） ==============================

test('golden：regress 衰减→delta 的数值序与 Python 位级一致（coherence +0.15）', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  raw.prepare("UPDATE regulation_field SET value = 0.5, updated_at = ? WHERE name = 'coherence'")
    .run('2026-08-20T00:00:00+00:00')
  raw.close()
  const rw = new ReadWriteMemory(path)
  const out = rw.applyRegulationCause('integration_completed', {
    now: new Date('2026-08-20T10:00:00Z'), // 10h 后
  })
  // Python: decayed = clamp01(0.7 + (0.5-0.7)*exp(-0.01*10)) = 0.5190325163928081
  //         after   = clamp01(decayed + 0.15)                = 0.6690325163928081
  assert.equal(doubleBits(out.valueBefore), '3fe09bea146ef75b')
  assert.equal(doubleBits(out.valueAfter), '3fe568b6e13bc428')
  rw.close()
})

test('golden：regress 衰减→负 delta（load 0.9 · 5.5h · rested -0.10）位级一致', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  raw.prepare("UPDATE regulation_field SET value = 0.9, updated_at = ? WHERE name = 'load'")
    .run('2026-08-20T00:00:00+00:00')
  raw.close()
  const rw = new ReadWriteMemory(path)
  const out = rw.applyRegulationCause('rested', { now: new Date('2026-08-20T05:30:00Z') })
  // Python: decayed = 0.793525592861541; after = 0.693525592861541
  assert.equal(doubleBits(out.valueBefore), '3fe9648fc8bc2378')
  assert.equal(doubleBits(out.valueAfter), '3fe6315c9588f045')
  rw.close()
})

test('golden：accumulate 读侧懒衰减纯读不落账（hunger 0.1 · 30h → 0.34…）', () => {
  const path = makeWritableFixture()
  const raw = rawOpen(path)
  raw.prepare(
    "UPDATE regulation_field SET value = 0.1, updated_at = ? WHERE name = 'exploration_hunger'",
  ).run('2026-08-20T00:00:00+00:00')
  raw.close()
  const rw = new ReadWriteMemory(path)
  const values = rw.getRegulation({ now: new Date('2026-08-21T06:00:00Z') })
  // Python: clamp01(0.1 + 0.008*30) = 0.33999999999999997
  assert.equal(doubleBits(values.exploration_hunger), '3fd5c28f5c28f5c2')
  // 纯读：stored value 未被落账
  const row = rw.regulationField().find((r) => r.name === 'exploration_hunger')!
  assert.equal(row.value, 0.1)
  assert.equal(row.updatedAt, '2026-08-20T00:00:00+00:00')
  rw.close()
})
