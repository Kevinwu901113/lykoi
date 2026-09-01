/**
 * WO-MEM-SOURCE-01：记忆来源的认识论第二轴 `experiences.epistemic`。
 *
 * 正本：governance/docs/persona_layering_design_v1_2026-09-01.md §3.1（D-PERS-1）。
 * 覆盖面：六值写读回 / 逐渠道默认推导 / 显式覆盖 / NULL 旧行兼容 /
 * **晋升铁律**（imagined|simulated 不得进任何事实性供给）+ 对照组 /
 * 迁移件 016 的施加与重放。
 *
 * 全部跑在合成 fixture 与测试自造的临时库上；迁移脚本只在临时库上验证，
 * 真实 memory.db 永不被本测试触及（R-01）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import {
  EPISTEMIC_STANCES,
  EXPECTED_MIND_SCHEMA_VERSION,
  factualEpistemicClause,
  NON_FACTUAL_EPISTEMIC,
  type EpistemicStance,
} from '../src/index.ts'
import { deriveEpistemic, ReadWriteMemory, type ExperienceSource } from '../src/rw.ts'
import { logicalDigest } from '../src/testing.ts'
import { makeWritableFixture, rawOpen, tmp } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 8, 1, 0, 0, 0, 0))

function openRw(): { rw: ReadWriteMemory; raw: DatabaseSync } {
  const path = makeWritableFixture()
  return { rw: new ReadWriteMemory(path), raw: rawOpen(path) }
}

function epistemicOf(raw: DatabaseSync, id: number): unknown {
  return (raw.prepare('SELECT epistemic FROM experiences WHERE id = ?').get(id) as
    { epistemic: unknown }).epistemic
}

// ============================== 映射表（纯函数） ==============================

test('§3.1 映射表逐渠道各一：deriveEpistemic 八渠道 + conversation 按方向劈', () => {
  assert.equal(deriveEpistemic('wake_action'), 'executed')
  assert.equal(deriveEpistemic('action_result'), 'executed')
  assert.equal(deriveEpistemic('owner_event'), 'user_reported')
  assert.equal(deriveEpistemic('silence'), 'observed')
  assert.equal(deriveEpistemic('environment'), 'observed')
  assert.equal(deriveEpistemic('system'), 'observed')
  assert.equal(deriveEpistemic('thought_lapse'), 'inferred')
  // conversation：对方产出 → user_reported；她自己产出 → executed；缺方向取保守侧。
  assert.equal(deriveEpistemic('conversation', 'inbound'), 'user_reported')
  assert.equal(deriveEpistemic('conversation', 'outbound'), 'executed')
  assert.equal(deriveEpistemic('conversation'), 'user_reported')
  // 方向对非 conversation 渠道无效（渠道自己就定死了地位）。
  assert.equal(deriveEpistemic('system', 'outbound'), 'observed')
  // 推导永不产出虚构地位 —— imagined/simulated 只能显式声明。
  const derived = ([
    'conversation', 'wake_action', 'action_result', 'silence',
    'owner_event', 'system', 'thought_lapse', 'environment',
  ] as ExperienceSource[]).map((s) => deriveEpistemic(s))
  for (const stance of derived) assert.ok(!NON_FACTUAL_EPISTEMIC.includes(stance))
  // 绕过类型面的未知渠道：拒绝，不猜。
  assert.throws(
    () => deriveEpistemic('telepathy' as ExperienceSource),
    /unknown experience source: 'telepathy'/,
  )
})

// ============================== 写路径 ==============================

test('默认推导落库：八渠道各写一条，epistemic 逐条精确匹配映射表', () => {
  const { rw, raw } = openRw()
  const expected: [ExperienceSource, EpistemicStance][] = [
    ['conversation', 'user_reported'],
    ['wake_action', 'executed'],
    ['action_result', 'executed'],
    ['silence', 'observed'],
    ['owner_event', 'user_reported'],
    ['system', 'observed'],
    ['thought_lapse', 'inferred'],
    ['environment', 'observed'],
  ]
  for (const [source, stance] of expected) {
    const id = rw.recordExperience(source, `e-${source}`, { now: T0 })
    assert.equal(epistemicOf(raw, id), stance, source)
  }
  // conversation 的方向轴走同一个写入点。
  const outbound = rw.recordExperience('conversation', '我说的', {
    conversationDirection: 'outbound', now: T0,
  })
  assert.equal(epistemicOf(raw, outbound), 'executed')
  // 新行永不落 NULL（NULL 的含义被 016 钉死为"旧行未回填"）。
  const nulls = (raw.prepare(
    'SELECT COUNT(*) AS n FROM experiences WHERE epistemic IS NULL',
  ).get() as { n: number }).n
  assert.equal(nulls, 0)
  rw.close(); raw.close()
})

test('六值写读回：显式覆盖逐值落库；库层 CHECK 拒非法值', () => {
  const { rw, raw } = openRw()
  for (const stance of EPISTEMIC_STANCES) {
    const id = rw.recordExperience('system', `e-${stance}`, { epistemic: stance, now: T0 })
    assert.equal(epistemicOf(raw, id), stance)
  }
  assert.deepEqual(
    (raw.prepare(
      'SELECT epistemic FROM experiences ORDER BY id',
    ).all() as { epistemic: string }[]).map((r) => r.epistemic),
    ['observed', 'executed', 'user_reported', 'inferred', 'imagined', 'simulated'],
  )
  // 第二轴是 CHECK 枚举，不是自由文本。
  assert.throws(
    () => raw.prepare(
      "INSERT INTO experiences (ts, source, content, epistemic) VALUES (?, 'system', 'x', 'hearsay')",
    ).run('2026-09-01T00:00:00+00:00'),
    /CHECK constraint failed/,
  )
  // 渠道轴八值一个没动（本单 forbidden 第一条）。
  assert.throws(
    () => raw.prepare(
      "INSERT INTO experiences (ts, source, content) VALUES (?, 'daydream', 'x')",
    ).run('2026-09-01T00:00:00+00:00'),
    /CHECK constraint failed/,
  )
  rw.close(); raw.close()
})

test('显式覆盖：contemplate 类产物可标 imagined，渠道轴照旧是 wake_action', () => {
  const { rw, raw } = openRw()
  const id = rw.recordExperience('wake_action', 'contemplate:如果那天我先开口', {
    epistemic: 'imagined', now: T0,
  })
  const row = raw.prepare('SELECT source, epistemic FROM experiences WHERE id = ?').get(id) as
    { source: string; epistemic: string }
  assert.deepEqual([row.source, row.epistemic], ['wake_action', 'imagined'])
  rw.close(); raw.close()
})

test('thought_lapse 内部写入点（_abandon_in_tx）也带轴：inferred', () => {
  const { rw, raw } = openRw()
  const id = rw.createThought('会被弃置的念头', 'intent', 'wake', { chargeHint: 0.05, now: T0 })
  assert.ok(id !== null)
  // charge 0.05 已在 ABANDON_THRESHOLD 之下：下一拍衰减即 lapse。
  rw.decayAllOpenThoughts({ now: new Date(T0.getTime() + 3_600_000) })
  const row = raw.prepare(
    "SELECT source, epistemic FROM experiences WHERE source = 'thought_lapse'",
  ).get() as { source: string; epistemic: string } | undefined
  assert.deepEqual(
    [row?.source, row?.epistemic],
    ['thought_lapse', 'inferred'],
  )
  rw.close(); raw.close()
})

// ============================== 晋升铁律 + 对照组 ==============================

/**
 * 三条事实性供给通道 = 本单"排除"的落点：
 *   ① recentExperiences —— 快照装配的最近经验块；
 *   ② intakePending / countIntakePending —— 整合（经验→叙事/自传）的晋升通道；
 *   ③ relevanceCandidateRows —— L3 检索（她"记得的事"进对话）。
 * 播种：全部走 conversation 渠道（experience_class 判定 working，必进取料域），
 * 只有第二轴不同 —— 于是通不通过只取决于 epistemic。
 */
function seedStances(rw: ReadWriteMemory): Map<EpistemicStance, number> {
  const ids = new Map<EpistemicStance, number>()
  for (const stance of EPISTEMIC_STANCES) {
    ids.set(stance, rw.recordExperience('conversation', `记号 ${stance}`, {
      epistemic: stance, now: T0,
    }))
  }
  return ids
}

test('晋升铁律：imagined|simulated 不进快照/整合/检索三条事实性供给（对照组四值全进）', () => {
  const { rw, raw } = openRw()
  const ids = seedStances(rw)
  const factual: EpistemicStance[] = ['observed', 'executed', 'user_reported', 'inferred']
  const fictional: EpistemicStance[] = ['imagined', 'simulated']
  assert.deepEqual(NON_FACTUAL_EPISTEMIC, fictional) // 排除集本身逐字对拍

  // ① 快照装配面
  const recent = rw.recentExperiences(50)
  assert.deepEqual(
    recent.map((e) => e.epistemic).sort(),
    [...factual].sort(),
  )
  assert.deepEqual(
    recent.map((e) => e.id).sort((a, b) => a - b),
    factual.map((s) => ids.get(s)!).sort((a, b) => a - b),
  )

  // ② 晋升通道（整合取料 + 触发闸计数同口径）
  assert.deepEqual(
    rw.intakePending(null, false).map((r) => Number(r.id)).sort((a, b) => a - b),
    factual.map((s) => ids.get(s)!).sort((a, b) => a - b),
  )
  assert.equal(rw.countIntakePending(), factual.length)

  // ③ 检索面：命中词在六条里都有，只有事实性的四条回得来
  const hits = rw.relevanceCandidateRows({
    terms: ['记号'], subjectUserId: null, since: null, until: null,
  })
  assert.deepEqual(
    hits.map((r) => r.epistemic).sort(),
    [...factual].sort(),
  )
  // 词项为空（无关键词预筛）时铁律同样生效 —— 排除不依赖其它过滤路径
  const all = rw.relevanceCandidateRows({
    terms: [], subjectUserId: null, since: null, until: null,
  })
  assert.equal(all.length, factual.length)

  // 反向对拍：被排除的两条确实还在库里（排除 ≠ 删除，她的历史不销毁）
  for (const stance of fictional) {
    const row = raw.prepare('SELECT epistemic FROM experiences WHERE id = ?')
      .get(ids.get(stance)!) as { epistemic: string }
    assert.equal(row.epistemic, stance)
  }
  rw.close(); raw.close()
})

test('NULL 旧行兼容：016 之前的行读回 null，且三条供给通道照常供给', () => {
  const { rw, raw } = openRw()
  // 016 之前写下的行 = 未回填：直发 SQL 造（写路径已不产 NULL）。
  raw.prepare(
    'INSERT INTO experiences (ts, source, content, salience) VALUES (?, ?, ?, ?)',
  ).run('2026-06-01T00:00:00+00:00', 'conversation', '旧行 记号', 0.5)
  const legacyId = Number((raw.prepare('SELECT MAX(id) AS id FROM experiences')
    .get() as { id: number }).id)
  raw.prepare(
    'INSERT INTO experience_class (experience_id, class, classified_at, rule_version) VALUES (?,?,?,?)',
  ).run(legacyId, 'working', '2026-06-01T00:00:00+00:00', 1)

  const recent = rw.recentExperiences(50)
  assert.deepEqual(recent.map((e) => [e.id, e.epistemic]), [[legacyId, null]])
  assert.deepEqual(rw.intakePending(null, false).map((r) => r.id), [legacyId])
  assert.equal(rw.countIntakePending(), 1)
  assert.deepEqual(
    rw.relevanceCandidateRows({ terms: ['记号'], subjectUserId: null, since: null, until: null })
      .map((r) => r.id),
    [legacyId],
  )
  // 过滤片段的两段式（IS NULL OR NOT IN）就是为这一行存在：只留后半段时
  // NULL NOT IN (...) 求值为 NULL，她 016 之前的全部经历会凭空消失。
  const halfClause = (raw.prepare(
    "SELECT COUNT(*) AS n FROM experiences WHERE epistemic NOT IN ('imagined','simulated')",
  ).get() as { n: number }).n
  assert.equal(halfClause, 0)
  const fullClause = (raw.prepare(
    `SELECT COUNT(*) AS n FROM experiences WHERE ${factualEpistemicClause('experiences')}`,
  ).get() as { n: number }).n
  assert.equal(fullClause, 1)
  rw.close(); raw.close()
})

// ============================== 迁移件 016 ==============================

const MIGRATION_DIR = fileURLToPath(
  new URL('../../../governance/wo/WO-MEM-SOURCE-01/migrations/', import.meta.url),
)
const UP_SQL = readFileSync(join(MIGRATION_DIR, '016_experiences_epistemic.up.sql'), 'utf8')
const DOWN_SQL = readFileSync(join(MIGRATION_DIR, '016_experiences_epistemic.down.sql'), 'utf8')

/** 016 施加**之前**的形态：mind_schema=15 + experiences（无 epistemic 列，§1.2 逐字）。 */
function makePre016Db(): string {
  const path = join(tmp(), 'pre016.db')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO mind_schema VALUES (15, '2026-08-24T00:00:00.000Z');
    CREATE TABLE experiences (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('conversation','wake_action','action_result',
              'silence','owner_event','system','thought_lapse','environment')),
      content TEXT NOT NULL,
      salience REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0.0 AND salience <= 1.0),
      related_concern_id INTEGER,
      integrated INTEGER NOT NULL DEFAULT 0 CHECK (integrated IN (0,1)),
      integration_id INTEGER
    );
  `)
  const insert = db.prepare('INSERT INTO experiences (ts, source, content) VALUES (?, ?, ?)')
  for (const source of [
    'conversation', 'wake_action', 'action_result', 'silence',
    'owner_event', 'system', 'thought_lapse', 'environment',
  ]) {
    insert.run('2026-06-01T00:00:00+00:00', source, `存量 ${source}`)
  }
  db.close()
  return path
}

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

test('迁移件 016 up：加列 + 渠道级回填 + 登记版本 16（不做内容级重分类）', () => {
  const path = makePre016Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const db = rawOpen(path)

  assert.equal(
    (db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v,
    EXPECTED_MIND_SCHEMA_VERSION,
  )
  // 回填逐渠道精确匹配设计稿 §3.1 —— 与写路径 deriveEpistemic 同一张表。
  const rows = db.prepare('SELECT source, epistemic FROM experiences ORDER BY id')
    .all() as { source: string; epistemic: string }[]
  assert.deepEqual(rows.map((r) => [r.source, r.epistemic]), [
    ['conversation', 'user_reported'],
    ['wake_action', 'executed'],
    ['action_result', 'executed'],
    ['silence', 'observed'],
    ['owner_event', 'user_reported'],
    ['system', 'observed'],
    ['thought_lapse', 'inferred'],
    ['environment', 'observed'],
  ])
  for (const row of rows) {
    assert.equal(deriveEpistemic(row.source as ExperienceSource), row.epistemic, row.source)
  }
  // 回填不产虚构地位（内容级重分类 = 变相编造，设计稿 §2.4）。
  assert.equal(
    (db.prepare(
      "SELECT COUNT(*) AS n FROM experiences WHERE epistemic IN ('imagined','simulated')",
    ).get() as { n: number }).n,
    0,
  )
  // 未回填行清零 + CHECK 随 ALTER 生效。
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM experiences WHERE epistemic IS NULL')
      .get() as { n: number }).n,
    0,
  )
  assert.throws(
    () => db.prepare(
      "INSERT INTO experiences (ts, source, content, epistemic) VALUES (?, 'system', 'x', 'hearsay')",
    ).run('2026-09-01T00:00:00+00:00'),
    /CHECK constraint failed/,
  )
  // 列位在表尾 —— 与夹具 STATE_FIXTURE_DDL 同形（ADD COLUMN 只能加表尾）。
  const cols = (db.prepare('PRAGMA table_info("experiences")').all() as { name: string }[])
    .map((c) => c.name)
  assert.deepEqual(cols, [
    'id', 'ts', 'source', 'content', 'salience', 'related_concern_id',
    'integrated', 'integration_id', 'epistemic',
  ])
  db.close()
})

test('迁移件 016 up 重跑：零副作用（版本行撞主键即中止，库逐字节不变）', () => {
  const path = makePre016Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const before = logicalDigest(path)
  const err = applyScript(path, UP_SQL)
  assert.ok(err !== null, '重跑必须被版本行守卫挡住')
  assert.match(err!.message, /UNIQUE constraint failed: mind_schema\.version/)
  assert.equal(logicalDigest(path), before)
  // 第三次同样（守卫不是一次性的）。
  assert.ok(applyScript(path, UP_SQL) !== null)
  assert.equal(logicalDigest(path), before)
})

test('迁移件 016 up 回填句自身幂等：不动已有值（含新体写下的 imagined 行）', () => {
  const path = makePre016Db()
  assert.equal(applyScript(path, UP_SQL), null)
  const db = new DatabaseSync(path)
  db.prepare(
    "INSERT INTO experiences (ts, source, content, epistemic) VALUES (?, 'wake_action', 'x', 'imagined')",
  ).run('2026-09-01T00:00:00+00:00')
  db.close()
  const before = logicalDigest(path)
  // 只重放回填句（逆迁移文件写明的前滚姿势）。
  const backfill = UP_SQL.slice(UP_SQL.indexOf('UPDATE experiences'), UP_SQL.indexOf('COMMIT;'))
  assert.equal(applyScript(path, backfill), null)
  assert.equal(logicalDigest(path), before)
})

test('迁移件 016 down：只撤版本行，列与值不动；重跑零副作用', () => {
  const path = makePre016Db()
  assert.equal(applyScript(path, UP_SQL), null)
  assert.equal(applyScript(path, DOWN_SQL), null)
  const db = rawOpen(path)
  assert.equal((db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }).v, 15)
  // 列还在、回填值还在（她的数据不销毁）。
  assert.equal(
    (db.prepare("SELECT COUNT(*) AS n FROM experiences WHERE epistemic = 'observed'")
      .get() as { n: number }).n,
    3,
  )
  db.close()
  const after = logicalDigest(path)
  assert.equal(applyScript(path, DOWN_SQL), null)
  assert.equal(logicalDigest(path), after)
})
