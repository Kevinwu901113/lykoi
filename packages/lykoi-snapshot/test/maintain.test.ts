/**
 * maintain() 感知期维护：四写顺序逐字（SA-34）、衰减在读前（SA-35）、
 * 返回 moment 两半共用（SA-36）、超龄悬置总压力钳 + 24h 闸（SA-44）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { maintain, read, type SnapshotStore } from '../src/index.ts'
import { makeFixture, rawOpen, stubDeps } from './fixture.ts'

const NOW = new Date('2026-08-20T12:00:00Z')
const T = (s: string) => `${s}+00:00`

/** 方法调用序 spy：录下方法名，转发到真 store（this 绑回 target，私有字段安全）。 */
function spyStore(store: ReadWriteMemory): { store: SnapshotStore; calls: string[] } {
  const calls: string[] = []
  const proxy = new Proxy(store, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver)
      if (typeof v === 'function') {
        return (...args: unknown[]) => {
          calls.push(String(prop))
          return (v as (...a: unknown[]) => unknown).apply(target, args)
        }
      }
      return v
    },
  })
  return { store: proxy as unknown as SnapshotStore, calls }
}

/**
 * 场景：一条 active 关切 25 天没点亮（→ 步 1 落 dormant）；两条线（open +
 * 悬置 31 天 → 步 3 点火）；一条 charge 0.16 的 open 念头（→ 步 4 lapse）。
 */
function seed(path: string): void {
  const db = rawOpen(path)
  db.prepare(
    `INSERT INTO concerns (kind, title, description, weight, origin, status, created_at, last_lit_at)
     VALUES ('interest', 'stale-25d', '', 0.5, 'grown', 'active', ?, ?)`,
  ).run(T('2026-07-01T12:00:00'), T('2026-07-26T12:00:00'))
  const th = db.prepare(
    `INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  th.run('open_question', '第一条线\n第二行', 'open', T('2026-08-01T12:00:00'), T('2026-08-19T12:00:00'))
  th.run('commitment', '悬了一个月的承诺', 'suspended', T('2026-07-01T12:00:00'), T('2026-07-19T12:00:00'))
  db.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, charge, status) VALUES (?, '快散的念头', 'intent', 'wake', 0.16, 'open')",
  ).run(T('2026-08-20T09:00:00'))
  db.close()
}

test('四写顺序逐字（SA-34）：dim/dormant → floor → overdue penalty → 念头衰减', () => {
  const path = makeFixture()
  seed(path)
  const rw = new ReadWriteMemory(path)
  const { store, calls } = spyStore(rw)
  const returned = maintain(store, stubDeps(), NOW)
  assert.equal(returned, NOW) // SA-36：返回它实际用的 moment
  const writes = calls.filter((c) =>
    ['markDimmingDormant', 'createConcern', 'applyRegulationCause', 'decayAllOpenThoughts'].includes(c))
  // 老化把唯一 live 关切放干 → 地板补 2（线派生），随后总压力钳点火一次，最后衰减
  assert.deepEqual(writes, [
    'markDimmingDormant', 'createConcern', 'createConcern',
    'applyRegulationCause', 'decayAllOpenThoughts',
  ])
  rw.close()
})

test('老化流失被地板覆盖：dormant 后 live=0 → 从线派生补到 FLOOR_N=2（SA-173/174）', () => {
  const path = makeFixture()
  seed(path)
  const rw = new ReadWriteMemory(path)
  maintain(rw as SnapshotStore, stubDeps(), NOW)
  const all = rw.listConcerns()
  assert.equal(all.find((c) => c.title === 'stale-25d')!.status, 'dormant') // 绝不 released
  const floors = rw.listConcerns(['active', 'dimming']).filter((c) => c.origin === 'floor')
  // 候选优先序：open/suspended 线在前（标题 = 首个非空行）
  assert.deepEqual(floors.map((c) => c.title).sort(), ['悬了一个月的承诺', '第一条线'])
  assert.ok(floors.every((c) => c.weight === 0.25))
  // 线 kind 映射：open_question→question / commitment→project
  assert.equal(all.find((c) => c.title === '第一条线')!.kind, 'question')
  assert.equal(all.find((c) => c.title === '悬了一个月的承诺')!.kind, 'project')
  rw.close()
})

test('超龄悬置：线+question 念头共用一条因 + 24h 闸（SA-44 总压力钳）', () => {
  const path = makeFixture()
  seed(path)
  // 额外加一条超时 question 念头：两个来源同时点亮也只扣一次
  const db = rawOpen(path)
  db.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, charge, status) VALUES (?, '悬了三天的问题', 'question', 'wake', 0.8, 'open')",
  ).run(T('2026-08-17T00:00:00'))
  db.close()
  const rw = new ReadWriteMemory(path)
  const deps = stubDeps()
  maintain(rw as SnapshotStore, deps, NOW)
  const events = rw.recentRegulationEvents(null, 50).filter((e) => e.cause === 'suspension_overdue')
  assert.equal(events.length, 1) // 两个来源，一条因
  // 拆分只上日志（regulation_events 行保持简单）
  const breakdown = deps.events.filter(([n]) => n === 'suspension_overdue_breakdown')
  assert.deepEqual(breakdown, [['suspension_overdue_breakdown', { threads: 1, thoughts: 1 }]])
  // 24h 闸：1 小时后再 maintain 不重复点火
  maintain(rw as SnapshotStore, deps, new Date('2026-08-20T13:00:00Z'))
  assert.equal(
    rw.recentRegulationEvents(null, 50).filter((e) => e.cause === 'suspension_overdue').length, 1)
  rw.close()
})

test('念头衰减在读之前（SA-35）：lapse 出的 thought_lapse 经验被经验块看见', () => {
  const path = makeFixture()
  seed(path)
  const rw = new ReadWriteMemory(path)
  const deps = stubDeps()
  const moment = maintain(rw as SnapshotStore, deps, NOW)
  const snap = read(rw as SnapshotStore, deps, moment)
  // charge 0.16 - 0.04 = 0.12 < 0.15 → abandoned + thought_lapse 经验，本拍就看得见
  assert.equal(snap.经验.最近[0]!.source, 'thought_lapse')
  assert.ok(!snap.念头.some((t) => t.content === '快散的念头'))
  const lapsed = rw.recentExperiences(5).find((e) => e.source === 'thought_lapse')
  assert.ok(lapsed)
  rw.close()
})

test('地板处幂等：live >= FLOOR_N 时 maintain 不再造关切', () => {
  const path = makeFixture()
  seed(path)
  const rw = new ReadWriteMemory(path)
  maintain(rw as SnapshotStore, stubDeps(), NOW)
  const countAfterFirst = rw.listConcerns().length
  maintain(rw as SnapshotStore, stubDeps(), new Date('2026-08-20T13:00:00Z'))
  assert.equal(rw.listConcerns().length, countAfterFirst)
  rw.close()
})
