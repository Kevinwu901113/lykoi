/**
 * L1 · 分流判据（SA-83..88）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import {
  ACTION_RESULT_MIN_LENGTH, ARCHIVE, CLASSES, LENGTH_GATED_SOURCES, RULE_VERSION,
  WORKING, WORKING_SOURCES, classifyExperience,
} from '../src/l1.ts'
import { T0, changedTables, makeStore, minutesAfter, rawOpen, tableDigests } from './fixture.ts'

test('SA-83：三行纯函数逐字——WORKING_SOURCES={conversation, environment}，逐 source 分流表', () => {
  assert.deepEqual([...WORKING_SOURCES].sort(), ['conversation', 'environment'])
  assert.deepEqual([...LENGTH_GATED_SOURCES], ['action_result'])
  assert.deepEqual(CLASSES, ['working', 'archive'])

  // 分流表逐行（experience_class.py:5-13）。
  assert.equal(classifyExperience('conversation', 'hi'), WORKING)
  assert.equal(classifyExperience('environment', '短'), WORKING)
  assert.equal(classifyExperience('thought_lapse', '放掉了一个念头'), ARCHIVE)
  assert.equal(classifyExperience('silence', '…'), ARCHIVE)
  assert.equal(classifyExperience('system', 'x'), ARCHIVE)
  assert.equal(classifyExperience('owner_event', 'x'), ARCHIVE)
  // 兜底：判据只承认列出的原料来源——未知 source 也归档案，不默默进原料池。
  assert.equal(classifyExperience('made_up_source', 'x'.repeat(999)), ARCHIVE)
})

test('SA-84：action_result 长度闸严格大于 80，按字符（码点）不按字节', () => {
  assert.equal(ACTION_RESULT_MIN_LENGTH, 80)
  // 80 个汉字 = 240 字节 —— 若按字节判会错进原料池；按码点判恰好不超。
  assert.equal(classifyExperience('action_result', '汉'.repeat(80)), ARCHIVE)
  assert.equal(classifyExperience('action_result', '汉'.repeat(81)), WORKING)
  assert.equal(classifyExperience('action_result', 'a'.repeat(80)), ARCHIVE)
  assert.equal(classifyExperience('action_result', 'a'.repeat(81)), WORKING)
  // content=None 防御性按空串（空壳 action_result 本来就是档案）。
  assert.equal(classifyExperience('action_result', null), ARCHIVE)
  assert.equal(classifyExperience('action_result', undefined), ARCHIVE)
})

test('SA-85：wake_action 归档案——她的决策理由 = 思考轨迹，非外部输入（定案 2）', () => {
  assert.equal(classifyExperience('wake_action', '决定 contemplate:' + '长理由'.repeat(200)), ARCHIVE)
})

test('SA-87：RULE_VERSION=1；SA-86/88：分类落影子表、与经验写入同事务、experiences 不动', () => {
  assert.equal(RULE_VERSION, 1)
  const { store, path } = makeStore()
  try {
    const before = tableDigests(path)
    const idW = store.recordExperience('conversation', '和 Kevin 聊了睡眠', { now: T0 })
    const idA = store.recordExperience('action_result', 'ok', { now: minutesAfter(T0, 1) })
    const after = tableDigests(path)
    // 写集恰好三张表：experiences + experience_class + integration_state(pending 同步)。
    assert.deepEqual(changedTables(before, after),
      ['experience_class', 'experiences', 'integration_state'])

    const db = rawOpen(path)
    try {
      const rows = db.prepare(
        'SELECT experience_id, class, classified_at, rule_version FROM experience_class ORDER BY experience_id',
      ).all() as { experience_id: number; class: string; classified_at: string; rule_version: number }[]
      assert.deepEqual(rows.map((r) => [r.experience_id, r.class, r.rule_version]),
        [[idW, 'working', 1], [idA, 'archive', 1]])
      // classified_at = 经验 ts（同事务、同一时刻——经验与分类同生共死）。
      const ts = db.prepare('SELECT id, ts FROM experiences ORDER BY id').all() as { id: number; ts: string }[]
      assert.equal(rows[0]!.classified_at, ts[0]!.ts)

      // SA-88 INSERT OR IGNORE：先到者胜——回填路径伪造一次相遇，行不被改写。
      db.prepare(
        "INSERT OR IGNORE INTO experience_class (experience_id, class, classified_at, rule_version) "
        + "VALUES (?, 'archive', 'later', 99)",
      ).run(idW)
      const kept = db.prepare(
        'SELECT class, rule_version FROM experience_class WHERE experience_id = ?',
      ).get(idW) as { class: string; rule_version: number }
      assert.deepEqual([kept.class, kept.rule_version], ['working', 1])
    } finally {
      db.close()
    }
  } finally {
    store.close()
  }
})

test('纯函数性质：回填结果 == 重新分类结果（golden devstate 全量分类回放，readOnly 零输出）', (t) => {
  const golden = process.env.LYKOI_DEVSTATE_DB
  if (!golden) {
    t.skip('LYKOI_DEVSTATE_DB not set')
    return
  }
  const db = new DatabaseSync(golden, { readOnly: true })
  try {
    const rows = db.prepare(
      `SELECT e.id AS id, e.source AS source, e.content AS content, ec.class AS klass
         FROM experiences AS e JOIN experience_class AS ec ON ec.experience_id = e.id
        WHERE ec.rule_version = 1`,
    ).all() as { id: number; source: string; content: string; klass: string }[]
    assert.ok(rows.length > 0, 'golden devstate has classified experiences')
    for (const row of rows) {
      // 断言消息只带 id，不带 content（她的行内容零输出）。
      assert.equal(classifyExperience(row.source, row.content), row.klass,
        `experience #${row.id}: replayed class diverges from stored class`)
    }
  } finally {
    db.close()
  }
})
