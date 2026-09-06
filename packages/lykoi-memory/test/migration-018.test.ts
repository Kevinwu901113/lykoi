/**
 * WO-CONTINUATION-01：迁移件 018 的实录（up → down → 前滚），跑在临时库上。
 *
 * 前置库 = schema 17 的合成 fixture：拿 STATE_SCHEMA_DDL 剔除 018 那一段（表 +
 * 索引）+ 台账到 17。up 之后：版本 18、表与索引存在、rw 入口开得了门、表 DDL
 * 列定义与 schema.ts 逐字一致；down 之后：版本 17、表仍在、其余逐表摘要不变。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { STATE_SCHEMA_DDL, logicalDigest, stateBaselineDdl } from '../src/testing.ts'
import { ReadWriteMemory } from '../src/rw.ts'
import { ReadOnlyMemory } from '../src/index.ts'
import { tmp, rawOpen } from './fixture.ts'

const MIGRATIONS = new URL(
  '../../../governance/wo/WO-CONTINUATION-01/migrations/', import.meta.url,
).pathname
const UP_SQL = readFileSync(join(MIGRATIONS, '018_pending_continuations.up.sql'), 'utf8')
const DOWN_SQL = readFileSync(join(MIGRATIONS, '018_pending_continuations.down.sql'), 'utf8')

/** 只取 schema.ts 里 018 那一段：从表注释起到索引句止。 */
const BLOCK_RE = /    -- WO-CONTINUATION-01（mind_schema 18[\s\S]*?idx_pending_continuations_due ON pending_continuations\(state, due_at\);\n\n/
assert.match(STATE_SCHEMA_DDL, BLOCK_RE, 'schema.ts 里找得到 018 段')

function makePre018Db(): string {
  const path = join(tmp(), 'pre018.db')
  const db = new DatabaseSync(path)
  db.exec(STATE_SCHEMA_DDL.replace(BLOCK_RE, '') + stateBaselineDdl({
    schemaLedger: [
      { version: 16, appliedAt: '2026-09-01T00:00:00.000Z' },
      { version: 17, appliedAt: '2026-09-02T00:00:00.000Z' },
    ],
    regulationUpdatedAt: '2026-08-20T00:00:00+00:00',
    learningSetAt: '2026-08-24T00:00:00+00:00',
  }))
  db.close()
  return path
}

function applyScript(path: string, sql: string): string | null {
  const db = new DatabaseSync(path)
  try {
    db.exec(sql)
    return null
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    return err instanceof Error ? err.message : String(err)
  } finally {
    db.close()
  }
}

function columnBody(sql: string): string {
  return sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')')).replace(/\s+/g, ' ').trim()
}

test('迁移件 018 up：17 → 18，表与索引落地，DDL 与 schema.ts 逐字一致，rw/ro 入口开门', () => {
  const path = makePre018Db()
  assert.throws(() => new ReadWriteMemory(path), /mind_schema version 17 != expected 18/)
  assert.equal(applyScript(path, UP_SQL), null)

  const db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 18)
  const table = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'pending_continuations'",
  ).get() as { sql: string }
  const expected = /CREATE TABLE IF NOT EXISTS pending_continuations \(([\s\S]*?)\);/.exec(STATE_SCHEMA_DDL)![0]
  assert.equal(columnBody(table.sql), columnBody(expected))
  const idx = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'pending_continuations' AND name NOT LIKE 'sqlite_%'",
  ).all() as { name: string }[]
  assert.deepEqual(idx.map((r) => r.name), ['idx_pending_continuations_due'])
  db.close()

  const rw = new ReadWriteMemory(path)
  rw.registerContinuation({
    id: 'c1', originTurnId: 't', originRunId: null, goal: 'g',
    dueAt: new Date('2026-09-04T00:00:00Z'), now: new Date('2026-09-04T00:00:00Z'),
  })
  assert.equal(rw.getContinuation('c1')!.state, 'pending')
  rw.close()
  new ReadOnlyMemory(path).close()

  // 幂等：重跑撞版本行主键，事务未提交，库逐字节不变。
  const before = logicalDigest(path)
  assert.match(applyScript(path, UP_SQL) ?? '', /UNIQUE constraint failed: mind_schema.version/)
  assert.equal(logicalDigest(path), before)
})

test('迁移件 018 down：只撤版本行；表与行留着；前滚只重放版本行', () => {
  const path = makePre018Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const rw = new ReadWriteMemory(path)
  rw.registerContinuation({
    id: 'c1', originTurnId: 't', originRunId: null, goal: 'g',
    dueAt: new Date('2026-09-04T00:00:00Z'), now: new Date('2026-09-04T00:00:00Z'),
  })
  rw.close()

  assert.equal(applyScript(path, DOWN_SQL), null)
  let db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 17)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM pending_continuations').get() as { n: number }).n, 1)
  db.close()
  assert.throws(() => new ReadWriteMemory(path), /mind_schema version 17 != expected 18/)
  // down 幂等。
  const afterDown = logicalDigest(path)
  assert.equal(applyScript(path, DOWN_SQL), null)
  assert.equal(logicalDigest(path), afterDown)

  // 前滚姿势：只重放 ①。
  assert.equal(applyScript(path,
    "INSERT INTO mind_schema (version, applied_at)"
    + " VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));"), null)
  db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 18)
  db.close()
  new ReadWriteMemory(path).close()
})
