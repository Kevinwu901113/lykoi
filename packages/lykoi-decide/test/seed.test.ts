/**
 * 种子 —— 出生证语义（SA-166..168；W5）。对真 rw 库跑（createConcern 的 cap 与
 * 触发器都真在场），fixture 干净出生。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStateFixture } from 'lykoi-memory/testing'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import {
  MEMORY_SEEDS, SEED_DESCRIPTION, SEED_INITIAL_WEIGHT, seedConcerns, seedPersona,
} from '../src/index.ts'
import { FIXTURE_PERSONA } from './persona-fixture.ts'

const T0 = new Date('2026-08-24T10:00:00Z')

function mk(): ReadWriteMemory {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-seed-'))
  const path = join(dir, 'fixture.db')
  createStateFixture(path)
  return new ReadWriteMemory(path)
}

test('seedConcerns：四种子按 TOML 序入库（weight 0.5 / origin=seed / 描述逐字）+ mind_seeded 事件；重跑 no-op', () => {
  const store = mk()
  const events: [string, Record<string, unknown>][] = []
  try {
    const ids = seedConcerns(store, FIXTURE_PERSONA, {
      now: T0,
      logEvent: (n, f) => events.push([n, f]),
    })
    assert.equal(ids.length, 4)
    const rows = store.listConcerns('active')
    assert.deepEqual(rows.map((r) => r.title).sort(), ['影视', '摄影', '游戏', '穿搭'])
    for (const row of rows) {
      assert.equal(row.kind, 'interest')
      assert.equal(row.origin, 'seed')
      assert.equal(row.weight, SEED_INITIAL_WEIGHT)
      assert.equal(row.description, SEED_DESCRIPTION) // SA-167 逐字
    }
    assert.deepEqual(events.filter(([n]) => n === 'mind_seeded'), [
      ['mind_seeded', { count: 4, ids }],
    ])
    // 幂等：重跑零新建、零事件。
    events.length = 0
    assert.deepEqual(seedConcerns(store, FIXTURE_PERSONA, {
      now: T0,
      logEvent: (n, f) => events.push([n, f]),
    }), [])
    assert.deepEqual(events.filter(([n]) => n === 'mind_seeded'), [])
  } finally {
    store.close()
  }
})

test('SA-166 幂等强形态：released 的种子**永不重种**——复活是她的判断，不是部署脚本的', () => {
  const store = mk()
  try {
    seedConcerns(store, FIXTURE_PERSONA, { now: T0 })
    // 她在整合期放掉一颗种子（rw 释放路径要求 dormant；owner 后门绕过候选性检查）。
    const released = store.listConcerns('active').find((r) => r.title === '穿搭')!
    store.releaseConcern(released.id, 'no longer relevant', { now: T0, viaOwner: true })
    // 重启播种：released 的 title 仍算"存在过"，不重插。
    assert.deepEqual(seedConcerns(store, FIXTURE_PERSONA, { now: T0 }), [])
    assert.equal(store.listConcerns('active').some((r) => r.title === '穿搭'), false)
  } finally {
    store.close()
  }
})

test('seedPersona：唯一一条 preference（SA-168）；upsert 去重——重跑单行、不扰后天层', () => {
  const store = mk()
  try {
    assert.equal(MEMORY_SEEDS.length, 1)
    assert.equal(seedPersona(store, { now: T0 }), 1)
    assert.equal(seedPersona(store, { now: T0 }), 1) // 幂等：返回种子数，不重插
    const rows = store.getInsights('preference')
    assert.equal(rows.length, 1)
    assert.equal(rows[0]!.content, 'Kevin 用中文交流，技术术语用英文')
    // 身份不再作 insight 播种（SA-168）：persona 类零行。
    assert.deepEqual(store.getInsights('persona'), [])
  } finally {
    store.close()
  }
})
