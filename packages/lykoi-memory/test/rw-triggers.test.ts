/**
 * 触发器契约红测（M2-W1 交付①）。
 *
 * 对 append-only 面直发 UPDATE/DELETE，断言被**库层** RAISE 拒绝，且错误消息
 * ===（全等）STATE-CONTRACT §1.2 的触发器原文 —— R-06：触发器消息是契约的一部分，
 * 错误处理按消息字符串分支，不得改字。
 *
 * 双数据源：合成 fixture（DDL 逐字，必跑）+ golden devstate 的 tmp 副本
 * （真触发器实物，skip-if-absent；副本上断言零内容输出）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  copyDevstate,
  devstateSkip,
  makeWritableFixture,
  rawOpen,
} from './fixture.ts'

/** SQLITE_CONSTRAINT_TRIGGER = 1811；message 即 RAISE(ABORT, …) 原文。 */
function assertTriggerAbort(fn: () => unknown, message: string): void {
  assert.throws(fn, (err: Error) => {
    assert.equal(err.message, message)
    assert.equal((err as unknown as { errcode: number }).errcode, 1811)
    return true
  })
}

const TS = '2026-08-24T01:00:00+00:00'

// ============================== fixture：append-only 四面 ==============================

test('红测(fixture)：regulation_events 试 UPDATE/DELETE 必被库层拒绝', () => {
  const db = rawOpen(makeWritableFixture())
  db.prepare('INSERT INTO regulation_events (ts, name, delta, value_after, cause) VALUES (?, ?, ?, ?, ?)')
    .run(TS, 'load', 0.04, 0.24, 'experience_recorded')
  assertTriggerAbort(
    () => db.exec("UPDATE regulation_events SET cause = 'tampered'"),
    'regulation_events is append-only',
  )
  assertTriggerAbort(
    () => db.exec('DELETE FROM regulation_events'),
    'regulation_events is append-only',
  )
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM regulation_events').get() as { n: number }).n, 1)
  db.close()
})

test('红测(fixture)：history 试 UPDATE/DELETE 必被库层拒绝', () => {
  const db = rawOpen(makeWritableFixture())
  db.prepare('INSERT INTO history (ts, event_type, content) VALUES (?, ?, ?)')
    .run(TS, 'conversation', 'fixture-row')
  assertTriggerAbort(() => db.exec("UPDATE history SET content = 'tampered'"), 'history is append-only')
  assertTriggerAbort(() => db.exec('DELETE FROM history'), 'history is append-only')
  db.close()
})

test('红测(fixture)：experiences 试 DELETE / 冻结列 UPDATE 必被库层拒绝', () => {
  const db = rawOpen(makeWritableFixture())
  db.prepare('INSERT INTO experiences (ts, source, content) VALUES (?, ?, ?)')
    .run(TS, 'system', 'fixture-exp')
  assertTriggerAbort(() => db.exec('DELETE FROM experiences'), 'experiences is append-only')
  assertTriggerAbort(
    () => db.exec("UPDATE experiences SET content = 'tampered' WHERE id = 1"),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  assertTriggerAbort(
    () => db.exec('UPDATE experiences SET salience = 0.9 WHERE id = 1'),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  db.close()
})

test('红绿双测(fixture)：experiences integrated 单向位 —— 仅 0→1 携 integration_id 一次', () => {
  const db = rawOpen(makeWritableFixture())
  db.prepare('INSERT INTO experiences (ts, source, content) VALUES (?, ?, ?)')
    .run(TS, 'system', 'exp-a')
  db.prepare('INSERT INTO experiences (ts, source, content) VALUES (?, ?, ?)')
    .run(TS, 'system', 'exp-b')
  // 绿：0→1 且同时写入非 NULL integration_id
  const green = db.prepare(
    'UPDATE experiences SET integrated = 1, integration_id = 1234567 WHERE id = 1',
  ).run()
  assert.equal(Number(green.changes), 1)
  const row = { ...db.prepare('SELECT integrated, integration_id FROM experiences WHERE id = 1').get() } as
    { integrated: number; integration_id: number }
  assert.deepEqual(row, { integrated: 1, integration_id: 1234567 })
  // 红：1→0 回摆
  assertTriggerAbort(
    () => db.exec('UPDATE experiences SET integrated = 0, integration_id = NULL WHERE id = 1'),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  // 红：已整合后改 integration_id
  assertTriggerAbort(
    () => db.exec('UPDATE experiences SET integration_id = 7654321 WHERE id = 1'),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  // 红：0→1 但不携 integration_id
  assertTriggerAbort(
    () => db.exec('UPDATE experiences SET integrated = 1 WHERE id = 2'),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  db.close()
})

test('红测(fixture)：thoughts 试 DELETE / 冻结列 UPDATE 必被库层拒绝', () => {
  const db = rawOpen(makeWritableFixture())
  db.prepare('INSERT INTO thoughts (ts, content, kind, source) VALUES (?, ?, ?, ?)')
    .run(TS, 'fixture-thought', 'observation', 'wake')
  assertTriggerAbort(() => db.exec('DELETE FROM thoughts'), 'thoughts is append-only (never delete)')
  assertTriggerAbort(
    () => db.exec("UPDATE thoughts SET content = 'tampered' WHERE id = 1"),
    'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)',
  )
  assertTriggerAbort(
    () => db.exec("UPDATE thoughts SET source_ref = 'x' WHERE id = 1"),
    'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)',
  )
  db.close()
})

// ============================== fixture：thoughts 状态机 ==============================

test('绿测(fixture)：thoughts 状态机 5 条合法边全部走通', () => {
  const db = rawOpen(makeWritableFixture())
  const insert = db.prepare('INSERT INTO thoughts (ts, content, kind, source) VALUES (?, ?, ?, ?)')
  for (const name of ['t1', 't2', 't3']) insert.run(TS, name, 'intent', 'wake')
  const move = (id: number, status: string, rid?: number) => Number(
    rid === undefined
      ? db.prepare('UPDATE thoughts SET status = ? WHERE id = ?').run(status, id).changes
      : db.prepare('UPDATE thoughts SET status = ?, resolved_by_integration_id = ? WHERE id = ?')
        .run(status, rid, id).changes,
  )
  assert.equal(move(1, 'resolved'), 1) //       ① open→resolved
  assert.equal(move(1, 'absorbed', 4242), 1) // ② resolved→absorbed（携 integration_id）
  assert.equal(move(2, 'resolved'), 1)
  assert.equal(move(2, 'archived'), 1) //       ③ resolved→archived
  assert.equal(move(3, 'abandoned'), 1) //      ④ open→abandoned
  assert.equal(move(3, 'archived'), 1) //       ⑤ abandoned→archived
  assert.deepEqual(
    db.prepare('SELECT status FROM thoughts ORDER BY id').all().map((r) => (r as { status: string }).status),
    ['absorbed', 'archived', 'archived'],
  )
  db.close()
})

test('红测(fixture)：thoughts 状态机非法边（≥3 条）+ 终态整合闸 + 单向列', () => {
  const db = rawOpen(makeWritableFixture())
  const insert = db.prepare(
    'INSERT INTO thoughts (ts, content, kind, source, related_concern_id) VALUES (?, ?, ?, ?, ?)',
  )
  insert.run(TS, 't4', 'intent', 'wake', null) //  id 1
  insert.run(TS, 't5', 'intent', 'wake', 1) //     id 2（挂 fixture concern）
  const FLOW = 'thoughts: forbidden status transition (append-only one-way flow)'
  // 非法边 1：open→archived
  assertTriggerAbort(() => db.exec("UPDATE thoughts SET status = 'archived' WHERE id = 1"), FLOW)
  // 终态整合闸：resolved→absorbed 不携 integration_id
  db.exec("UPDATE thoughts SET status = 'resolved' WHERE id = 1")
  assertTriggerAbort(
    () => db.exec("UPDATE thoughts SET status = 'absorbed' WHERE id = 1"),
    'thoughts: absorbed requires resolved_by_integration_id; abandoned must not carry one',
  )
  // 非法边 2：resolved→abandoned
  assertTriggerAbort(() => db.exec("UPDATE thoughts SET status = 'abandoned' WHERE id = 1"), FLOW)
  // 非法边 3：abandoned→resolved
  db.exec("UPDATE thoughts SET status = 'abandoned' WHERE id = 2")
  assertTriggerAbort(() => db.exec("UPDATE thoughts SET status = 'resolved' WHERE id = 2"), FLOW)
  // 非法边 4：archived→open（终态不可逆）
  db.exec("UPDATE thoughts SET status = 'archived' WHERE id = 2")
  assertTriggerAbort(() => db.exec("UPDATE thoughts SET status = 'open' WHERE id = 2"), FLOW)
  // 单向列：related_concern_id 已置值后不可改（含改回 NULL）
  assertTriggerAbort(
    () => db.exec('UPDATE thoughts SET related_concern_id = NULL WHERE id = 2'),
    'thoughts: related_concern_id is one-way (NULL->value, append-only)',
  )
  // 单向列：resolved_by_integration_id 已置值后不可改
  db.exec("UPDATE thoughts SET status = 'absorbed', resolved_by_integration_id = 99 WHERE id = 1")
  assertTriggerAbort(
    () => db.exec('UPDATE thoughts SET resolved_by_integration_id = 100 WHERE id = 1'),
    'thoughts: resolved_by_integration_id is one-way (NULL->value, append-only)',
  )
  db.close()
})

// ============================== devstate 副本：真触发器实物 ==============================

test('红测(devstate 副本)：四张 append-only 面 UPDATE/DELETE 全被真库拒绝', { skip: devstateSkip }, () => {
  const db = rawOpen(copyDevstate())
  // 断言只用触发器消息与计数，不携带任何行值。
  assertTriggerAbort(
    () => db.exec("UPDATE regulation_events SET cause = 'tampered' WHERE id = (SELECT MIN(id) FROM regulation_events)"),
    'regulation_events is append-only',
  )
  assertTriggerAbort(
    () => db.exec('DELETE FROM regulation_events WHERE id = (SELECT MIN(id) FROM regulation_events)'),
    'regulation_events is append-only',
  )
  assertTriggerAbort(
    () => db.exec("UPDATE history SET content = 'tampered' WHERE id = (SELECT MIN(id) FROM history)"),
    'history is append-only',
  )
  assertTriggerAbort(
    () => db.exec('DELETE FROM history WHERE id = (SELECT MIN(id) FROM history)'),
    'history is append-only',
  )
  assertTriggerAbort(
    () => db.exec("UPDATE experiences SET content = 'tampered' WHERE id = (SELECT MIN(id) FROM experiences)"),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  assertTriggerAbort(
    () => db.exec('DELETE FROM experiences WHERE id = (SELECT MIN(id) FROM experiences)'),
    'experiences is append-only',
  )
  assertTriggerAbort(
    () => db.exec("UPDATE thoughts SET content = 'tampered' WHERE id = (SELECT MIN(id) FROM thoughts)"),
    'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)',
  )
  assertTriggerAbort(
    () => db.exec('DELETE FROM thoughts WHERE id = (SELECT MIN(id) FROM thoughts)'),
    'thoughts is append-only (never delete)',
  )
  db.close()
})

test('红绿双测(devstate 副本)：integrated 单向位在真库上同样成立', { skip: devstateSkip }, () => {
  const db = rawOpen(copyDevstate())
  const pending = db.prepare(
    'SELECT MIN(id) AS id FROM experiences WHERE integrated = 0',
  ).get() as { id: number | null }
  if (pending.id === null) {
    // 副本里没有未整合行（极端情形）：单向位红面仍必测。
    assertTriggerAbort(
      () => db.exec('UPDATE experiences SET integrated = 0, integration_id = NULL WHERE id = (SELECT MIN(id) FROM experiences WHERE integrated = 1)'),
      'experiences rows are append-only; integration may only move 0 -> 1 once',
    )
  } else {
    const green = db.prepare(
      'UPDATE experiences SET integrated = 1, integration_id = 2013001001 WHERE id = ?',
    ).run(pending.id)
    assert.equal(Number(green.changes), 1)
    assertTriggerAbort(
      () => db.prepare('UPDATE experiences SET integration_id = 2013001002 WHERE id = ?').run(pending.id),
      'experiences rows are append-only; integration may only move 0 -> 1 once',
    )
    assertTriggerAbort(
      () => db.prepare('UPDATE experiences SET integrated = 0, integration_id = NULL WHERE id = ?').run(pending.id),
      'experiences rows are append-only; integration may only move 0 -> 1 once',
    )
  }
  db.close()
})
