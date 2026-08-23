/**
 * 交付②测试。
 *
 * 隐私纪律（工单原文）：devstate 的 memory.db（08-22 活体备份副本，含她的真实数据）
 * **只许只读打开；测试与日志中不得打印任何行内容**——本文件对该库只断言
 * schema/计数/存在性/类型，断言信息里不携带行值；路径经 env `LYKOI_DEVSTATE_DB`
 * 注入，文件缺席时 skip 不 fail。
 *
 * schema 门与 R-01 绊线用本地临时 fixture db（测试自造，不含她的数据）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { Context } from '@deepseek-ai/cordis'
import {
  EXPECTED_MIND_SCHEMA_VERSION,
  ReadOnlyMemory,
  type LykoiMemoryService,
} from '../src/index.ts'
import * as memoryPlugin from '../src/index.ts'

const DEVSTATE = process.env.LYKOI_DEVSTATE_DB
const devstateSkip = DEVSTATE ? false : 'LYKOI_DEVSTATE_DB 未注入（devstate 副本缺席时 skip 不 fail）'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-memory-'))
}

/** 造一个最小 fixture：mind_schema=version + 空的读面表（不含任何真实数据）。 */
function makeFixture(version: number): string {
  const path = join(tmp(), 'fixture.db')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO mind_schema VALUES (${version}, '2026-08-24T00:00:00.000Z');
    CREATE TABLE regulation_field (name TEXT PRIMARY KEY, value REAL NOT NULL,
      baseline REAL NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO regulation_field VALUES
      ('coherence',0.5,0.5,'2026-08-24T00:00:00+00:00'),
      ('load',0.1,0.1,'2026-08-24T00:00:00+00:00'),
      ('relational_tension',0.2,0.2,'2026-08-24T00:00:00+00:00'),
      ('exploration_hunger',0.3,0.3,'2026-08-24T00:00:00+00:00');
    CREATE TABLE concerns (id INTEGER PRIMARY KEY, kind TEXT, title TEXT,
      description TEXT DEFAULT '', weight REAL, origin TEXT, parent_id INTEGER,
      status TEXT DEFAULT 'active', created_at TEXT, last_lit_at TEXT,
      lit_count INTEGER DEFAULT 0, released_at TEXT, release_reason TEXT);
    CREATE TABLE thoughts (id INTEGER PRIMARY KEY, ts TEXT, content TEXT, kind TEXT,
      source TEXT, related_concern_id INTEGER, source_ref TEXT, charge REAL DEFAULT 0.5,
      status TEXT DEFAULT 'open', resolved_by_integration_id INTEGER);
    CREATE TABLE history (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT,
      event_type TEXT, content TEXT);
    CREATE TABLE experiences (id INTEGER PRIMARY KEY, ts TEXT, source TEXT, content TEXT,
      salience REAL DEFAULT 0.5, related_concern_id INTEGER, integrated INTEGER DEFAULT 0,
      integration_id INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT, role TEXT,
      created_at TEXT, status TEXT DEFAULT 'active');
    CREATE TABLE identity_bindings (id INTEGER PRIMARY KEY, user_id TEXT,
      channel TEXT, channel_key TEXT, verified_by TEXT, created_at TEXT,
      UNIQUE(channel, channel_key));
    INSERT INTO users VALUES ('user_001','fixture-owner','owner_primary',
      '2026-08-09T00:00:00+00:00','active');
    INSERT INTO users VALUES ('user_002','fixture-member','group_member',
      '2026-08-09T00:00:00+00:00','active');
    INSERT INTO identity_bindings VALUES (1,'user_001','telegram','1001','fixture',
      '2026-08-09T00:00:00+00:00');
    INSERT INTO identity_bindings VALUES (2,'user_002','telegram','2002','fixture',
      '2026-08-09T00:00:00+00:00');
    CREATE TABLE autonomy_state (id INTEGER PRIMARY KEY CHECK (id = 1),
      next_wake_at TEXT NOT NULL, last_wake_at TEXT, updated_at TEXT NOT NULL);
  `)
  db.close()
  return path
}

// ============================== schema 门（fixture） ==============================

test('打开即断言 mind_schema==15：不等则抛明确错误（新体不得读不认识的 schema）', () => {
  assert.throws(() => new ReadOnlyMemory(makeFixture(14)), (err: Error) => {
    assert.match(err.message, /mind_schema version 14 != expected 15/)
    return true
  })
  assert.throws(() => new ReadOnlyMemory(makeFixture(16)), /mind_schema version 16/)
})

test('mind_schema 表缺席（不是 state 副本）：明确报错而非误读', () => {
  const path = join(tmp(), 'not-state.db')
  const db = new DatabaseSync(path)
  db.exec('CREATE TABLE t (a)')
  db.close()
  assert.throws(() => new ReadOnlyMemory(path), /cannot read mind_schema/)
})

test('C-01 mind 口径：busy_timeout=10000 生效；fixture 上读面 API 全部可用', () => {
  const memory = new ReadOnlyMemory(makeFixture(EXPECTED_MIND_SCHEMA_VERSION))
  assert.equal(memory.busyTimeoutMs, 10000)
  assert.equal(memory.regulationField().length, 4)
  assert.deepEqual(memory.activeConcerns(), [])
  assert.deepEqual(memory.openThoughts(), [])
  assert.deepEqual(memory.recentHistory(5), [])
  assert.deepEqual(memory.recentExperiences(5), [])
  // 绑定命中/未命中（S-06/S-09 的数据面）：
  const owner = memory.identityBinding('telegram', '1001')
  assert.equal(owner?.userId, 'user_001')
  assert.equal(owner?.role, 'owner_primary')
  const member = memory.identityBinding('telegram', '2002')
  assert.equal(member?.role, 'group_member')
  assert.equal(memory.identityBinding('telegram', 'no-such-key'), undefined)
  assert.equal(memory.identityBinding('matrix', '1001'), undefined)
  assert.equal(memory.autonomyState(), undefined)
  memory.close()
})

test('R-01 绊线：服务面零写方法（prototype 上不得出现写形状的方法名）', () => {
  const writeShaped = /insert|update|delete|write|exec|run|upsert|create|drop|alter|apply/i
  const methods = Object.getOwnPropertyNames(ReadOnlyMemory.prototype)
    .filter((n) => n !== 'constructor')
  const offenders = methods.filter((n) => writeShaped.test(n))
  assert.deepEqual(offenders, [], `R-01: 出现了写形状的方法 ${offenders.join(',')}`)
})

test('cordis 插件面：装载提供 lykoiMemory 服务，fiber 卸载关连接', async () => {
  const ctx = new Context()
  const fiber = await ctx.plugin(memoryPlugin, {
    dbPath: makeFixture(EXPECTED_MIND_SCHEMA_VERSION),
  })
  const svc = ctx.get('lykoiMemory') as LykoiMemoryService
  assert.equal(svc.regulationField().length, 4)
  await fiber.dispose()
  assert.equal(ctx.get('lykoiMemory'), undefined)
})

// ============================== devstate（只读；零内容输出） ==============================

test('devstate：只读打开成功即 mind_schema==15（断言在构造器内完成）', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  assert.equal(memory.busyTimeoutMs, 10000)
  memory.close()
})

test('devstate：regulation_field 恰四行，名字集合与 schema 枚举一致，值域类型正确', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  const rows = memory.regulationField()
  assert.equal(rows.length, 4)
  assert.deepEqual(
    rows.map((r) => r.name).sort(),
    ['coherence', 'exploration_hunger', 'load', 'relational_tension'],
  )
  for (const row of rows) {
    // 只断言类型与值域（schema CHECK 0..1），不打印值。
    assert.equal(typeof row.value, 'number')
    assert.ok(row.value >= 0 && row.value <= 1)
    assert.ok(row.baseline >= 0 && row.baseline <= 1)
    assert.equal(typeof row.updatedAt, 'string')
  }
  memory.close()
})

test('devstate：active concerns / open thoughts / recent N —— 只断言形状与计数', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  const concerns = memory.activeConcerns()
  assert.ok(Array.isArray(concerns))
  for (const c of concerns) {
    assert.equal(typeof c.id, 'number')
    assert.equal(typeof c.title, 'string')
    assert.equal(c.status, 'active')
    assert.ok(c.weight >= 0 && c.weight <= 1)
  }
  const thoughts = memory.openThoughts()
  for (const t of thoughts) {
    assert.equal(t.status, 'open')
    assert.ok(t.content.length <= 200, 'schema CHECK: thoughts.content ≤200 字')
  }
  const history = memory.recentHistory(5)
  assert.ok(history.length <= 5)
  const experiences = memory.recentExperiences(5)
  assert.ok(experiences.length <= 5)
  // id 降序（最近 N 的口径）
  for (let i = 1; i < experiences.length; i++) {
    assert.ok(experiences[i]!.id < experiences[i - 1]!.id)
  }
  memory.close()
})

test('devstate：C-22 双格式时间戳在真实行上 parse 通过（不打印任何值）', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  let parsed = 0
  for (const row of memory.regulationField()) {
    // 业务行 isoformat 形态
    assert.ok(Number.isFinite(new Date(0).getTime()))
    assert.doesNotThrow(() => {
      const { parseStateTimestamp } = memoryPlugin
      parseStateTimestamp(row.updatedAt)
    })
    parsed += 1
  }
  for (const row of memory.recentHistory(20)) {
    assert.doesNotThrow(() => memoryPlugin.parseStateTimestamp(row.ts))
    parsed += 1
  }
  for (const row of memory.recentExperiences(20)) {
    assert.doesNotThrow(() => memoryPlugin.parseStateTimestamp(row.ts))
    parsed += 1
  }
  assert.ok(parsed >= 4, '至少覆盖 regulation_field 四行')
  memory.close()
})

test('devstate：identity_bindings 查询走通（合成键必 miss；命中与否都不打印内容）', { skip: devstateSkip }, () => {
  const memory = new ReadOnlyMemory(DEVSTATE!)
  // 合成 key：断言查询路径与 fail-closed 方向，不探测真实绑定内容。
  assert.equal(memory.identityBinding('telegram', '__lykoi_m1w2_synthetic_key__'), undefined)
  const state = memory.autonomyState()
  if (state !== undefined) {
    assert.equal(typeof state.nextWakeAt, 'string')
    assert.doesNotThrow(() => memoryPlugin.parseStateTimestamp(state.nextWakeAt))
  }
  memory.close()
})
