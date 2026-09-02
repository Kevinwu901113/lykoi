/**
 * WO-MEM-DECAY-01：慢变层衰减的数据面（`focus_insight_state` 第六态 `dormant`）。
 *
 * 正本：governance/wo/WO-MEM-DECAY-01/order.md §2（D-1..D-8）；上位设计稿
 * governance/docs/persona_layering_design_v1_2026-09-01.md §3.3（D-PERS-3）。
 * 覆盖面：六态 CHECK 与枚举 / dormant 不进装配口 / 重申点亮（relit）/
 * contested_since 规则 / 到 shadow 的现行为 / 迁移件 017 的两次施加与 down。
 *
 * 全部跑在合成 fixture 与测试自造的临时库上；迁移脚本只在临时库上验证，
 * 真实 memory.db 永不被本测试触及（R-01）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { FOCUS_INSIGHT_STATUS_ENUM, ReadWriteMemory } from '../src/rw.ts'
import { logicalDigest, STATE_SCHEMA_DDL } from '../src/testing.ts'
import { makeWritableFixture, rawOpen, tmp } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 8, 2, 0, 0, 0, 0))

interface Recorded { name: string; fields: Record<string, unknown> }

/** 打开写层 + 收事件槽（store 层遥测注入，W3 TODO#1 的接法）。 */
function openRw(): { rw: ReadWriteMemory; raw: DatabaseSync; events: Recorded[] } {
  const path = makeWritableFixture()
  const events: Recorded[] = []
  const rw = new ReadWriteMemory(path, {
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  // 两个周期行（状态行的 FK 目标；PRAGMA foreign_keys=ON）。
  rw.openFocusCycle({ now: T0 })
  rw.openFocusCycle({ now: T0 })
  return { rw, raw: rawOpen(path), events }
}

/**
 * ⑨ 事件计数：**精确匹配**类型与字段，不做子串 grep。审计落盘形态是一行 JSON
 * （lykoi-audit 的 `{type, ...fields}`），这里按同一形态序列化再解析回来数，钉的就是
 * `"type":"focus_insight_status"` 且 `"to":"<状态>"` 这条口径。
 */
function countStatusEvents(events: readonly Recorded[], to: string): number {
  return events
    .map((e) => JSON.parse(JSON.stringify({ type: e.name, ...e.fields })) as
      Record<string, unknown>)
    .filter((rec) => rec.type === 'focus_insight_status' && rec.to === to)
    .length
}

/** 铺一条 active 结论（cycle 1 建、cycle 2 转正）。 */
function seedActive(rw: ReadWriteMemory, content: string): number {
  const iid = rw.upsertInsight('focus', content, { now: T0 })
  rw.recordFocusInsight(iid, { cycleId: 1, now: T0 })
  rw.setFocusInsightStatus(iid, 'active', { cycleId: 2, reason: 'promote', now: T0 })
  return iid
}

// ============================== D-1 · 六态 ==============================

test('D-1 六态：枚举与 CHECK 同源，dormant 可写、枚举外的值两侧都拒', () => {
  const { rw, raw } = openRw()
  assert.deepEqual([...FOCUS_INSIGHT_STATUS_ENUM],
    ['shadow', 'active', 'contested', 'revised', 'withdrawn', 'dormant'])

  const iid = seedActive(rw, '一条结论')
  assert.equal(rw.setFocusInsightStatus(iid, 'dormant', {
    cycleId: 2, reason: 'stale: last touched cycle 1, now cycle 2 (>= 30)', now: T0,
  }), true)
  assert.equal(rw.getFocusInsightState(iid)!.status, 'dormant')

  // 代码侧的门（枚举外即抛，一个字都到不了库）。
  assert.throws(() => rw.setFocusInsightStatus(iid, 'dimming', { cycleId: 2, now: T0 }),
    /unknown focus insight status: 'dimming'/)
  assert.throws(() => rw.recordFocusInsight(iid, { cycleId: 2, status: 'dimming', now: T0 }),
    /unknown focus insight status: 'dimming'/)
  assert.throws(() => rw.listFocusInsights('dimming'),
    /unknown focus insight status: 'dimming'/)
  // 库侧的门（CHECK 本身）。
  assert.throws(() => raw.prepare(
    'UPDATE focus_insight_state SET status = ? WHERE insight_id = ?').run('dimming', iid),
  /CHECK constraint failed/)

  rw.close(); raw.close()
})

test('D-8：dormant 不进 promotedFocusInsights（装配口语义 = active，一个字没改）', () => {
  const { rw, raw } = openRw()
  const active = seedActive(rw, '现行结论')
  const sleeping = seedActive(rw, '休眠结论')
  rw.setFocusInsightStatus(sleeping, 'dormant', { cycleId: 2, reason: 'stale', now: T0 })

  assert.deepEqual(rw.promotedFocusInsights().map((r) => r.insight_id), [active])
  assert.deepEqual(rw.listFocusInsights('dormant').map((r) => r.insight_id), [sleeping])
  // 行还在、内容一个字不动（不销毁，只退出装配）。
  assert.equal(rw.listFocusInsights(null).length, 2)
  assert.equal(rw.getInsights('focus').find((r) => r.id === sleeping)!.content, '休眠结论')
  rw.close(); raw.close()
})

// ============================== D-5 · 点亮 ==============================

test('D-5 点亮：重申 dormant → active，history 一行 reason relit + 事件 from/to', () => {
  const { rw, raw, events } = openRw()
  const iid = seedActive(rw, '会被想起来的结论')
  rw.setFocusInsightStatus(iid, 'dormant', { cycleId: 2, reason: 'stale', now: T0 })
  const beforeUpdatedAt = rw.getFocusInsightState(iid)!.updated_at
  const later = new Date(T0.getTime() + 3_600_000)

  // 重申 = 同一句结论再次落 recordFocusInsight（upsertInsight 逐字相同 → 同一 id）。
  const again = rw.upsertInsight('focus', '会被想起来的结论', { now: later })
  assert.equal(again, iid)
  const isNew = rw.recordFocusInsight(iid, {
    cycleId: 2, reason: 'cycle 2 / concern 1', now: later,
  })
  // 点亮不是新结论：返回值仍是 false，调用方照旧把这一轮记成"无新结论"。
  assert.equal(isNew, false)

  const state = rw.getFocusInsightState(iid)!
  assert.equal(state.status, 'active')
  assert.equal(state.updated_cycle_id, 2)
  assert.notEqual(state.updated_at, beforeUpdatedAt) // 刷新了
  assert.equal(state.contested_since_cycle, null) //    与 active 分支同规则：清空
  assert.deepEqual(rw.promotedFocusInsights().map((r) => r.insight_id), [iid])

  // history 一行，reason 逐字 relit（不被调用方传进来的 reason 顶掉）。
  const last = rw.focusInsightHistory(iid).at(-1)!
  assert.deepEqual([last.from_status, last.to_status, last.reason, last.cycle_id],
    ['dormant', 'active', 'relit', 2])

  // 事件：走既有的 focus_insight_status 通道，不另造事件类。
  assert.equal(countStatusEvents(events, 'active'), 2) // 转正一次 + 点亮一次
  const relit = events.filter((e) => e.name === 'focus_insight_status'
    && e.fields.from === 'dormant').map((e) => e.fields)
  assert.equal(relit.length, 1)
  assert.deepEqual(
    [relit[0]!.insight_id, relit[0]!.from, relit[0]!.to, relit[0]!.cycle_id, relit[0]!.reason],
    [iid, 'dormant', 'active', 2, 'relit'])
  rw.close(); raw.close()
})

test('D-5 不误伤：shadow / active / contested 的重申行为逐字未变（影子期不重新计时）', () => {
  const { rw, raw, events } = openRw()
  const shadow = rw.upsertInsight('focus', '影子结论', { now: T0 })
  rw.recordFocusInsight(shadow, { cycleId: 1, now: T0 })
  const before = rw.getFocusInsightState(shadow)!

  const later = new Date(T0.getTime() + 3_600_000)
  assert.equal(rw.recordFocusInsight(shadow, { cycleId: 2, now: later }), false)
  const after = rw.getFocusInsightState(shadow)!
  // 状态行原样不动：created/updated 周期号与 updated_at 一个字节都没变。
  assert.deepEqual(
    [after.status, after.created_cycle_id, after.updated_cycle_id, after.updated_at],
    [before.status, before.created_cycle_id, before.updated_cycle_id, before.updated_at])
  const last = rw.focusInsightHistory(shadow).at(-1)!
  assert.deepEqual([last.from_status, last.to_status, last.reason],
    ['shadow', 'shadow', 'reaffirmed'])

  // active 的重申同样只留痕（点亮分支只认 dormant）。
  const active = seedActive(rw, '现行结论')
  const activeBefore = rw.getFocusInsightState(active)!
  assert.equal(rw.recordFocusInsight(active, { cycleId: 2, now: later }), false)
  assert.deepEqual(rw.getFocusInsightState(active)!.updated_at, activeBefore.updated_at)
  assert.equal(rw.focusInsightHistory(active).at(-1)!.reason, 'reaffirmed')

  // 只有一条 shadow→active 事件（转正那次），重申没有多发。
  assert.equal(countStatusEvents(events, 'active'), 1)
  rw.close(); raw.close()
})

test('D-5 contested_since：迁到 dormant 保留（同 revised/withdrawn），点亮时清空', () => {
  const { rw, raw } = openRw()
  const iid = seedActive(rw, '起过争的结论')
  rw.setFocusInsightStatus(iid, 'contested', { cycleId: 2, reason: 'conflict', now: T0 })
  assert.equal(rw.getFocusInsightState(iid)!.contested_since_cycle, 2)
  // contested 之后的了结路径不变；这里造一条"起过争、又回 active、再休眠"的行。
  rw.setFocusInsightStatus(iid, 'active', { cycleId: 2, reason: 'settled', now: T0 })
  assert.equal(rw.getFocusInsightState(iid)!.contested_since_cycle, null)
  rw.setFocusInsightStatus(iid, 'contested', { cycleId: 2, reason: 'again', now: T0 })
  rw.setFocusInsightStatus(iid, 'dormant', { cycleId: 2, reason: 'stale', now: T0 })
  // 迁到 dormant：起争周期号是账，留着。
  assert.equal(rw.getFocusInsightState(iid)!.contested_since_cycle, 2)
  // 点亮：清空（与 active 分支同规则）。
  rw.recordFocusInsight(iid, { cycleId: 2, now: T0 })
  assert.deepEqual(
    [rw.getFocusInsightState(iid)!.status, rw.getFocusInsightState(iid)!.contested_since_cycle],
    ['active', null])
  rw.close(); raw.close()
})

test('无 dormant→shadow：产品路径一条也没有；直发 setFocusInsightStatus 的现行为原样记录', () => {
  const { rw, raw } = openRw()
  const iid = seedActive(rw, '一条结论')
  rw.setFocusInsightStatus(iid, 'dormant', { cycleId: 2, reason: 'stale', now: T0 })

  // 现行为（本单不新增禁边逻辑，如实钉住）：状态机没有边表，这一层只校验枚举，
  // 所以直发到 shadow 仍然会写进去。"无回到 shadow 的边"是**产品路径**的事实
  // ——L4 里唯一写 shadow 的是 recordFocusInsight 的新建分支，而它遇到已有状态行
  // 时根本不改状态（dormant 走点亮分支去 active），没有任何调用点会打出这一步。
  assert.equal(rw.setFocusInsightStatus(iid, 'shadow', {
    cycleId: 2, reason: '直发（测试用，非产品路径）', now: T0,
  }), true)
  assert.equal(rw.getFocusInsightState(iid)!.status, 'shadow')
  // 重申一条 shadow 行不会把它送回 dormant/active：点亮分支只认 dormant。
  assert.equal(rw.recordFocusInsight(iid, { cycleId: 2, now: T0 }), false)
  assert.equal(rw.getFocusInsightState(iid)!.status, 'shadow')
  rw.close(); raw.close()
})

// ============================== 迁移件 017 ==============================

const MIGRATION_DIR = fileURLToPath(
  new URL('../../../governance/wo/WO-MEM-DECAY-01/migrations/', import.meta.url),
)
const UP_SQL = readFileSync(join(MIGRATION_DIR, '017_focus_insight_dormant.up.sql'), 'utf8')
const DOWN_SQL = readFileSync(join(MIGRATION_DIR, '017_focus_insight_dormant.down.sql'), 'utf8')

/** sqlite3 -bail 语义的等价档：首句报错即中止，未 COMMIT 的事务随连接关闭回滚。 */
function applyScript(path: string, sql: string): Error | null {
  const db = new DatabaseSync(path)
  try {
    db.exec(sql)
    return null
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK')
    return err as Error
  } finally {
    db.close()
  }
}

function fileSha(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** 017 施加**之前**的形态：mind_schema=16 + 五态 focus_insight_state（契约 :397-401）。 */
function makePre017Db(): string {
  const path = join(tmp(), 'pre017.db')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO mind_schema VALUES (15, '2026-08-24T00:00:00.000Z'),
                                   (16, '2026-09-01T00:00:00.000Z');
    CREATE TABLE focus_cycles (
      id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
      concern_id INTEGER,
      selection_reason TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'idle'
              CHECK (outcome IN ('idle','advanced','revised','no_progress','failed')),
      retrieved_count INTEGER NOT NULL DEFAULT 0,
      match_reasons TEXT NOT NULL DEFAULT '[]',
      llm_calls INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE focus_insight_state (
      insight_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn')),
      created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
      updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
      contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
    );
    CREATE INDEX idx_focus_insight_state_status ON focus_insight_state(status);
    INSERT INTO focus_cycles (id, started_at) VALUES
      (1, '2026-08-01T00:00:00+00:00'), (2, '2026-08-02T00:00:00+00:00');
  `)
  const insert = db.prepare(
    `INSERT INTO focus_insight_state
       (insight_id, status, created_cycle_id, updated_cycle_id,
        contested_since_cycle, superseded_by, updated_at)
     VALUES (?,?,?,?,?,?,?)`)
  const states = ['shadow', 'active', 'contested', 'revised', 'withdrawn']
  states.forEach((status, idx) => {
    insert.run(idx + 1, status, 1, 2, status === 'contested' ? 2 : null, null,
      '2026-08-02T00:00:00+00:00')
  })
  db.close()
  return path
}

/** 一张表的列定义段（去掉 CREATE TABLE 名字那一截与首尾括号，塌掉空白）。 */
function columnBody(sql: string): string {
  return sql.slice(sql.indexOf('(') + 1, sql.lastIndexOf(')')).replace(/\s+/g, ' ').trim()
}

test('迁移件 017 up：五态 → 六态、行数不变、索引复位、无残留临时表', () => {
  const path = makePre017Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const db = rawOpen(path)

  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 17)
  // 行数与逐状态计数一行不增一行不减（本迁移只放宽 CHECK，不动任何既有状态）。
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM focus_insight_state')
    .get() as { n: number }).n, 5)
  assert.deepEqual(
    (db.prepare('SELECT status, COUNT(*) AS n FROM focus_insight_state GROUP BY status ORDER BY status')
      .all() as { status: string; n: number }[]).map((r) => [r.status, r.n]),
    [['active', 1], ['contested', 1], ['revised', 1], ['shadow', 1], ['withdrawn', 1]])
  // contested_since_cycle 等非主键列原样搬过来了（显式列名，不是 SELECT *）。
  assert.equal((db.prepare(
    "SELECT contested_since_cycle AS c FROM focus_insight_state WHERE status = 'contested'")
    .get() as { c: number }).c, 2)

  // 重建后的列定义与 schema.ts 的 STATE_SCHEMA_DDL **逐字一致**（表名那一截由
  // ALTER ... RENAME 重写成带引号的形态，故只对列定义段）。
  const live = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='focus_insight_state'")
    .get() as { sql: string }).sql
  const canon = STATE_SCHEMA_DDL.slice(
    STATE_SCHEMA_DDL.indexOf('CREATE TABLE IF NOT EXISTS focus_insight_state'))
  assert.equal(columnBody(live), columnBody(canon.slice(0, canon.indexOf(';') + 1)))
  assert.ok(live.includes("'dormant'"))

  // 索引复位（DROP TABLE 会连带删掉它），临时表名不留痕。
  assert.deepEqual(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='focus_insight_state'")
      .all() as { name: string }[]).map((r) => r.name),
    ['idx_focus_insight_state_status'])
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'focus_insight_state__017'")
    .get() as { n: number }).n, 0)
  // 这张表上没有触发器/视图依赖（迁移件头注要求施加前查的那一条）。
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('trigger','view') AND sql LIKE '%focus_insight_state%'")
    .get() as { n: number }).n, 0)

  // 六态生效：dormant 可写，枚举外仍拒。
  db.prepare(
    `INSERT INTO focus_insight_state
       (insight_id, status, created_cycle_id, updated_cycle_id, updated_at)
     VALUES (6, 'dormant', 1, 2, '2026-09-02T00:00:00+00:00')`).run()
  assert.throws(() => db.prepare(
    `INSERT INTO focus_insight_state
       (insight_id, status, created_cycle_id, updated_cycle_id, updated_at)
     VALUES (7, 'dimming', 1, 2, '2026-09-02T00:00:00+00:00')`).run(),
  /CHECK constraint failed/)
  db.close()
})

test('迁移件 017 up 重跑：零副作用（版本行撞主键即中止，库逐字节不变）', () => {
  const path = makePre017Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const beforeDigest = logicalDigest(path)
  const beforeSha = fileSha(path)

  const err = applyScript(path, UP_SQL)
  assert.ok(err !== null, '重跑必须被版本行守卫挡住')
  assert.match(err!.message, /UNIQUE constraint failed: mind_schema\.version/)
  assert.equal(logicalDigest(path), beforeDigest)
  assert.equal(fileSha(path), beforeSha) // 逐字节不变
  // 第三次同样（守卫不是一次性的）；也没有留下半成品的 __017 表。
  assert.ok(applyScript(path, UP_SQL) !== null)
  assert.equal(fileSha(path), beforeSha)
  const db = rawOpen(path)
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'focus_insight_state__017'")
    .get() as { n: number }).n, 0)
  db.close()
})

test('迁移件 017 down：只撤版本行，六态 CHECK 与 dormant 行都留着；重跑零副作用', () => {
  const path = makePre017Db()
  assert.equal(applyScript(path, UP_SQL), null)
  // 先落一行 dormant，证明 down 不销毁她的数据。
  assert.equal(applyScript(path,
    `INSERT INTO focus_insight_state
       (insight_id, status, created_cycle_id, updated_cycle_id, updated_at)
     VALUES (6, 'dormant', 1, 2, '2026-09-02T00:00:00+00:00');`), null)

  assert.equal(applyScript(path, DOWN_SQL), null)
  const db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 16)
  assert.deepEqual(
    (db.prepare('SELECT version FROM mind_schema ORDER BY version').all() as { version: number }[])
      .map((r) => r.version), [15, 16])
  const live = (db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='focus_insight_state'")
    .get() as { sql: string }).sql
  assert.ok(live.includes("'dormant'"), 'down 不回退 CHECK')
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM focus_insight_state WHERE status = 'dormant'")
    .get() as { n: number }).n, 1)
  db.close()

  const after = logicalDigest(path)
  assert.equal(applyScript(path, DOWN_SQL), null)
  assert.equal(logicalDigest(path), after)
})

test('迁移件 017 前滚姿势：down 之后只重放版本行那一句即回到 17', () => {
  const path = makePre017Db()
  assert.equal(applyScript(path, UP_SQL), null)
  assert.equal(applyScript(path, DOWN_SQL), null)
  // 头注写明的前滚姿势（只重放 ①，不重放表重建段）。
  assert.equal(applyScript(path,
    "INSERT INTO mind_schema (version, applied_at)"
    + " VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));"), null)
  const db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 17)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM focus_insight_state')
    .get() as { n: number }).n, 5)
  db.close()
})

test('迁移件 017 回执不泄内容：脚本里没有任何一句会 SELECT 出 insight 文本', () => {
  // 回执段只出计数与 DDL 断言。`insights` 这张表（结论正文的所在）在整份脚本里
  // 一次都没被提及。
  assert.ok(!/\binsights\b/.test(UP_SQL), 'up 不该碰 insights 表')
  assert.ok(!/\binsights\b/.test(DOWN_SQL), 'down 不该碰 insights 表')
  // 也没有 DELETE / UPDATE 行内容的句子（up 只 INSERT/SELECT/DDL；down 只撤版本行）。
  assert.equal(UP_SQL.match(/^\s*(UPDATE|DELETE)\b/gmi), null)
  assert.deepEqual((DOWN_SQL.match(/^\s*(UPDATE|DELETE)\b/gmi) ?? []).map((s) => s.trim()),
    ['DELETE'])
})
