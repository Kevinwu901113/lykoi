/**
 * 关切地板（SA-173/174）：FLOOR_N/出生权重、候选优先序、按 ENGAGED floor title
 * 去重、dormant 残骸可重派生、cap 防御位、titleFrom 确定性。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import {
  FALLBACK_TEMPLATES,
  FLOOR_BIRTH_WEIGHT,
  FLOOR_N,
  floorMaintain,
  THREAD_KIND_MAP,
  titleFrom,
  type SnapshotStore,
} from '../src/index.ts'
import { makeFixture, rawOpen } from './fixture.ts'

const NOW = new Date('2026-08-20T12:00:00Z')
const T = (s: string) => `${s}+00:00`

test('常量与映射逐字（SA-173/174）', () => {
  assert.equal(FLOOR_N, 2)
  assert.equal(FLOOR_BIRTH_WEIGHT, 0.25)
  assert.deepEqual(THREAD_KIND_MAP, {
    open_question: 'question',
    commitment: 'project',
    suspended_tension: 'question',
    arc: 'interest',
  })
  assert.deepEqual(FALLBACK_TEMPLATES, [
    ['question', '我现在最在意的是什么'],
    ['interest', '我最近在留意的事情'],
    ['ritual', '回到我搁置的关切'],
  ])
})

test('titleFrom：首个非空行 strip 后按码点截 80；全空回退整体 strip', () => {
  assert.equal(titleFrom('\n  \n  第一行有货  \n第二行'), '第一行有货')
  assert.equal(titleFrom('   只有空白包着   '), '只有空白包着')
  assert.equal([...titleFrom('长'.repeat(100))].length, 80)
})

test('空库：活关切只查一次，线+叙事都缺则模板补满 N', (t) => {
  const path = makeFixture()
  const rw = new ReadWriteMemory(path)
  const query = t.mock.method(rw, 'listConcerns')
  const created = floorMaintain(rw as SnapshotStore, NOW)
  assert.equal(query.mock.calls.length, 1)
  assert.deepEqual(query.mock.calls[0]!.arguments, [['active', 'dimming']])
  assert.equal(created.length, 2)
  const floors = rw.listConcerns('active')
  assert.deepEqual(floors.map((c) => [c.kind, c.title]), [
    ['question', '我现在最在意的是什么'],
    ['interest', '我最近在留意的事情'],
  ])
  assert.ok(floors.every((c) => c.origin === 'floor' && c.weight === FLOOR_BIRTH_WEIGHT))
  rw.close()
})

test('候选优先序：线在前，叙事其次，模板兜底（SA-174）', () => {
  const path = makeFixture()
  const db = rawOpen(path)
  db.prepare(
    `INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
     VALUES ('suspended_tension', '悬着的张力', 'suspended', ?, ?)`,
  ).run(T('2026-08-01T12:00:00'), T('2026-08-19T12:00:00'))
  db.prepare(
    `INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class)
     VALUES (?, '当前叙事一句话', 's', 'integration', 'absorption')`,
  ).run(T('2026-08-19T00:00:00'))
  db.close()
  const rw = new ReadWriteMemory(path)
  floorMaintain(rw as SnapshotStore, NOW)
  const floors = rw.listConcerns('active')
  // 1 条线（suspended_tension→question）+ 1 条显著叙事（interest），模板没轮到
  assert.deepEqual(floors.map((c) => [c.kind, c.title]), [
    ['question', '悬着的张力'],
    ['interest', '当前叙事一句话'],
  ])
  rw.close()
})

test('按 ENGAGED floor title 去重：绝不铸重复的活地板目标', () => {
  const path = makeFixture()
  const rw = new ReadWriteMemory(path)
  rw.createConcern('question', '我现在最在意的是什么', {
    weight: FLOOR_BIRTH_WEIGHT, origin: 'floor', now: NOW,
  })
  const created = floorMaintain(rw as SnapshotStore, NOW) // live=1, need=1
  assert.equal(created.length, 1)
  assert.equal(
    rw.listConcerns('active').filter((c) => c.title === '我现在最在意的是什么').length, 1)
  assert.ok(rw.listConcerns('active').some((c) => c.title === '我最近在留意的事情'))
  rw.close()
})

test('dormant 残骸可重派生：重铸恢复活性，残骸自己老化掉（代价不对称）', () => {
  const path = makeFixture()
  const db = rawOpen(path)
  db.prepare(
    `INSERT INTO concerns (kind, title, description, weight, origin, status, created_at)
     VALUES ('question', '我现在最在意的是什么', '', 0.25, 'floor', 'dormant', ?)`,
  ).run(T('2026-07-01T12:00:00'))
  db.close()
  const rw = new ReadWriteMemory(path)
  const created = floorMaintain(rw as SnapshotStore, NOW) // live=0（dormant 不计）
  assert.equal(created.length, 2)
  // 同名 title 以 dormant 残骸 + 新活行并存
  const same = rw.listConcerns().filter((c) => c.title === '我现在最在意的是什么')
  assert.deepEqual(same.map((c) => c.status).sort(), ['active', 'dormant'])
  rw.close()
})

test('live >= N 幂等 no-op；地板 create-only（无任何 released 写出）', () => {
  const path = makeFixture()
  const rw = new ReadWriteMemory(path)
  rw.createConcern('interest', 'a', { weight: 0.5, origin: 'grown', now: NOW })
  rw.createConcern('interest', 'b', { weight: 0.5, origin: 'grown', now: NOW })
  assert.deepEqual(floorMaintain(rw as SnapshotStore, NOW), [])
  assert.ok(rw.listConcerns().every((c) => c.status !== 'released'))
  rw.close()
})
