/** WO-TURN-01：019 up/down 在临时库上的实录与 DDL 对拍。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EXPECTED_MIND_SCHEMA_VERSION, ReadOnlyMemory } from '../src/index.ts'
import { ReadWriteMemory } from '../src/rw.ts'
import { STATE_SCHEMA_DDL, logicalDigest, stateBaselineDdl } from '../src/testing.ts'
import { rawOpen, tmp } from './fixture.ts'

const MIGRATIONS = new URL(
  '../../../governance/wo/WO-TURN-01/migrations/', import.meta.url,
).pathname
const UP_SQL = readFileSync(join(MIGRATIONS, '019_durable_ingress.up.sql'), 'utf8')
const DOWN_SQL = readFileSync(join(MIGRATIONS, '019_durable_ingress.down.sql'), 'utf8')
const BLOCK_RE = /    -- WO-TURN-01（mind_schema 19）[\s\S]*?idx_inbound_parts_turn\n      ON inbound_parts\(turn_id, part_order\);\n\n/

assert.equal(EXPECTED_MIND_SCHEMA_VERSION, 19)
assert.match(STATE_SCHEMA_DDL, BLOCK_RE)

function makePre019Db(): string {
  const path = join(tmp(), 'pre019.db')
  const db = new DatabaseSync(path)
  db.exec(STATE_SCHEMA_DDL.replace(BLOCK_RE, '') + stateBaselineDdl({
    schemaLedger: [
      { version: 16, appliedAt: '2026-09-01T00:00:00.000Z' },
      { version: 17, appliedAt: '2026-09-02T00:00:00.000Z' },
      { version: 18, appliedAt: '2026-09-04T00:00:00.000Z' },
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

function body(sql: string): string {
  return sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')')).replace(/\s+/g, ' ').trim()
}

test('019 up：18 → 19，表/索引与 schema 正本对齐，ro/rw 入口开门', () => {
  const path = makePre019Db()
  assert.throws(() => new ReadOnlyMemory(path), /version 18 != expected 19/)
  assert.equal(applyScript(path, UP_SQL), null)
  const db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 19)
  for (const tableName of ['user_turns', 'inbound_parts']) {
    const actual = db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
    ).get(tableName) as { sql: string }
    const expected = new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName} \\(([\\s\\S]*?)\\);`)
      .exec(STATE_SCHEMA_DDL)![0]
    assert.equal(body(actual.sql), body(expected))
  }
  const indexes = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name IN ('user_turns','inbound_parts') AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all() as { name: string }[]
  assert.deepEqual(indexes.map((row) => row.name), [
    'idx_inbound_parts_platform_message', 'idx_inbound_parts_platform_update',
    'idx_inbound_parts_turn', 'idx_user_turns_collecting_scope', 'idx_user_turns_queue',
  ])
  db.close()
  new ReadOnlyMemory(path).close()
  new ReadWriteMemory(path).close()

  const before = logicalDigest(path)
  assert.match(applyScript(path, UP_SQL) ?? '', /UNIQUE constraint failed: mind_schema.version/)
  assert.equal(logicalDigest(path), before)
})

test('019 down：只撤版本行，durable 消息与 turn 留存；重新前滚只补版本行', () => {
  const path = makePre019Db()
  assert.equal(applyScript(path, UP_SQL), null)
  let db = rawOpen(path)
  db.exec(`
    INSERT INTO user_turns
      (id, channel, user_id, context_id, is_owner, state, first_received_at,
       last_received_at, created_at, updated_at)
    VALUES ('turn:1', 'telegram', 'u1', 'c1', 1, 'collecting', '2026-09-05T00:00:00+00:00',
            '2026-09-05T00:00:00+00:00', '2026-09-05T00:00:00+00:00', '2026-09-05T00:00:00+00:00');
    INSERT INTO inbound_parts
      (inbound_id, channel, platform_message_id, platform_update_id, user_id, context_id,
       is_owner, text, received_at, turn_id, part_order, created_at)
    VALUES ('in:1', 'telegram', '101', '1', 'u1', 'c1', 1, '原文',
            '2026-09-05T00:00:00+00:00', 'turn:1', 0, '2026-09-05T00:00:00+00:00');
  `)
  db.close()

  assert.equal(applyScript(path, DOWN_SQL), null)
  db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 18)
  assert.equal((db.prepare('SELECT text FROM inbound_parts').get() as { text: string }).text, '原文')
  db.close()
  assert.equal(applyScript(path, DOWN_SQL), null, 'down 重跑幂等')

  assert.equal(applyScript(path,
    "INSERT INTO mind_schema (version, applied_at) VALUES (19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));"), null)
  new ReadOnlyMemory(path).close()
})
