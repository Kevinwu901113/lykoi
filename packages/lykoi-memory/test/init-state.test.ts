/**
 * 生产创建入口的契约测试（AUDIT-FIX-2026-09-02；docs/deploy.md §13 缺口 1/2/3）。
 *
 * 断言面：
 * 1. 新库过得了只读入口的开库门，且 mind_schema 恰是 EXPECTED_MIND_SCHEMA_VERSION；
 * 2. 四张 append-only 面的触发器真在新库上（消息逐字，R-06）；
 * 3. 播种的所有者行与 telegram 绑定能被生产读点命中
 *    （`ReadOnlyMemory.identityBinding` / `bootstrap-preauth` 的 owner 查询原句）；
 * 4. 目标已存在即拒绝，一个字节不动；
 * 5. `--dry-run` 零写入。
 *
 * 时钟纪律：时间全经 `--now` 注入，被测路径不读墙钟。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { EXPECTED_MIND_SCHEMA_VERSION, ReadOnlyMemory } from '../src/index.ts'
import { OWNER_CONTEXT_ID, OWNER_USER_ID, initState, main } from '../src/init-state.ts'
import { PY_ISO_RE, tmp } from './fixture.ts'

const NOW = new Date('2026-09-02T03:04:05.000Z')
/** bootstrap-preauth.ts 的 owner 查询原句（列名与取值以它为准）。 */
const OWNER_QUERY = "SELECT id FROM users WHERE role = 'owner_primary' AND status = 'active' LIMIT 1"

function target(): string {
  return join(tmp(), 'memory.db')
}

/** CLI 输出收集器（摘要断言用；不回显任何行内容）。 */
function capture(): { log: string[], err: string[], sink: Parameters<typeof main>[1] } {
  const log: string[] = []
  const err: string[] = []
  return { log, err, sink: { log: (l) => log.push(l), err: (l) => err.push(l) } }
}

/** SQLITE_CONSTRAINT_TRIGGER = 1811；message 即 RAISE(ABORT, …) 原文。 */
function assertTriggerAbort(fn: () => unknown, message: string): void {
  assert.throws(fn, (err: Error) => {
    assert.equal(err.message, message)
    assert.equal((err as unknown as { errcode: number }).errcode, 1811)
    return true
  })
}

test('新库：只读入口开得了，mind_schema 恰是期望版本', () => {
  const path = target()
  const report = initState({ db: path, now: NOW })
  assert.equal(report.mindSchemaVersion, EXPECTED_MIND_SCHEMA_VERSION)
  assert.equal(report.ownerUserId, null)
  assert.equal(report.bindingId, null)

  // 开库门自己会在版本不对时抛（index.ts 的 assertSchemaVersion）。
  const memory = new ReadOnlyMemory(path)
  memory.close()

  const db = new DatabaseSync(path, { readOnly: true })
  const max = db.prepare('SELECT MAX(version) AS v FROM mind_schema').get() as { v: number }
  assert.equal(max.v, EXPECTED_MIND_SCHEMA_VERSION)
  // 台账只记它实际所在的那一级 —— 未施加过的迁移不编造施加时刻。
  const rows = db.prepare('SELECT version, applied_at FROM mind_schema').all() as
    { version: number, applied_at: string }[]
  assert.deepEqual(rows.map((r) => r.version), [EXPECTED_MIND_SCHEMA_VERSION])
  assert.equal(rows[0]!.applied_at, '2026-09-02T03:04:05.000Z')
  db.close()
})

test('新库：中性基线行落齐，时间戳全走 --now（业务行是 C-22 isoformat）', () => {
  const path = target()
  initState({ db: path, now: NOW })
  const db = new DatabaseSync(path, { readOnly: true })
  const field = db.prepare('SELECT name, value, baseline, updated_at FROM regulation_field ORDER BY name')
    .all() as { name: string, value: number, baseline: number, updated_at: string }[]
  assert.deepEqual(field.map((r) => r.name),
    ['coherence', 'exploration_hunger', 'load', 'relational_tension'])
  for (const row of field) {
    assert.match(row.updated_at, PY_ISO_RE)
    assert.equal(row.updated_at, '2026-09-02T03:04:05+00:00')
  }
  const integration = db.prepare('SELECT COUNT(*) AS n FROM integration_state').get() as { n: number }
  assert.equal(integration.n, 1)
  const keys = db.prepare('SELECT key FROM learning_layer_state ORDER BY key').all() as { key: string }[]
  assert.deepEqual(keys.map((k) => k.key), ['l2_intake_watermark_id', 'l4_focus_wakes_since'])
  // 身份行不属中性基线：没给 --owner-name 就一行都没有。
  const users = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }
  assert.equal(users.n, 0)
  const bindings = db.prepare('SELECT COUNT(*) AS n FROM identity_bindings').get() as { n: number }
  assert.equal(bindings.n, 0)
  db.close()
})

test('新库：四张 append-only 面 UPDATE/DELETE 全被库层拒绝（触发器消息逐字）', () => {
  const path = target()
  initState({ db: path, now: NOW })
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  const TS = '2026-09-02T03:04:05+00:00'

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

  db.prepare('INSERT INTO history (ts, event_type, content) VALUES (?, ?, ?)')
    .run(TS, 'conversation', 'row')
  assertTriggerAbort(() => db.exec("UPDATE history SET content = 'tampered'"), 'history is append-only')
  assertTriggerAbort(() => db.exec('DELETE FROM history'), 'history is append-only')

  db.prepare('INSERT INTO experiences (ts, source, content) VALUES (?, ?, ?)')
    .run(TS, 'system', 'row')
  assertTriggerAbort(
    () => db.exec("UPDATE experiences SET content = 'tampered'"),
    'experiences rows are append-only; integration may only move 0 -> 1 once',
  )
  assertTriggerAbort(() => db.exec('DELETE FROM experiences'), 'experiences is append-only')

  db.prepare('INSERT INTO thoughts (ts, content, kind, source) VALUES (?, ?, ?, ?)')
    .run(TS, 'row', 'observation', 'wake')
  assertTriggerAbort(
    () => db.exec("UPDATE thoughts SET content = 'tampered'"),
    'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)',
  )
  assertTriggerAbort(() => db.exec('DELETE FROM thoughts'), 'thoughts is append-only (never delete)')
  db.close()
})

test('播种：owner 行被 bootstrap-preauth 的原句命中；binding 被只读入口反查命中', () => {
  const path = target()
  const report = initState({
    db: path,
    ownerName: 'Kevin',
    telegramSenderId: '424242',
    now: NOW,
  })
  assert.equal(report.ownerUserId, OWNER_USER_ID)
  assert.equal(report.ownerContextId, OWNER_CONTEXT_ID)
  assert.equal(report.bindingChannel, 'telegram')
  assert.equal(typeof report.bindingId, 'number')

  const db = new DatabaseSync(path, { readOnly: true })
  const owner = db.prepare(OWNER_QUERY).get() as { id: string } | undefined
  assert.equal(owner?.id, OWNER_USER_ID)
  const ctx = db.prepare('SELECT kind FROM contexts WHERE id = ?').get(OWNER_CONTEXT_ID) as
    { kind: string } | undefined
  assert.equal(ctx?.kind, 'direct')
  db.close()

  // telegram 适配器的入站反查（index.ts:342 的 identityBinding('telegram', senderId)）。
  const memory = new ReadOnlyMemory(path)
  const binding = memory.identityBinding('telegram', '424242')
  assert.equal(binding?.userId, OWNER_USER_ID)
  // S-09：owner 判定严格窄于绑定 —— 必须是 owner_primary 的 telegram 绑定。
  assert.equal(binding?.role, 'owner_primary')
  assert.equal(binding?.userStatus, 'active')
  // 未登记的发送者仍然 miss（fail-closed 前提没被造库入口破坏）。
  assert.equal(memory.identityBinding('telegram', '999'), undefined)
  memory.close()
})

test('播种：--telegram-sender-id 没有 --owner-name 就拒绝（绑定挂在所有者行上）', () => {
  const path = target()
  assert.throws(
    () => initState({ db: path, telegramSenderId: '424242', now: NOW }),
    /--telegram-sender-id 需要 --owner-name/,
  )
  assert.equal(existsSync(path), false)
})

test('拒绝覆盖：目标已存在时一个字节都不动，CLI 退出 2', () => {
  const path = target()
  writeFileSync(path, 'not-a-database')
  const before = readFileSync(path)
  assert.throws(() => initState({ db: path, now: NOW }), /目标已存在，拒绝覆盖/)
  const cli = capture()
  assert.equal(main(['--db', path, '--now', NOW.toISOString()], cli.sink), 2)
  assert.ok(cli.err.some((l) => l.includes('目标已存在')))
  assert.deepEqual(readFileSync(path), before)
})

test('--dry-run：零写入，摘要照出', () => {
  const path = target()
  const cli = capture()
  const code = main(
    ['--db', path, '--owner-name', 'Kevin', '--telegram-sender-id', '424242',
      '--now', NOW.toISOString(), '--dry-run'],
    cli.sink,
  )
  assert.equal(code, 0)
  assert.equal(existsSync(path), false)
  assert.equal(existsSync(`${path}-journal`), false)
  assert.ok(cli.log.some((l) => l.includes('--dry-run：不写')))
  assert.ok(cli.log.some((l) => l.includes(`mind_schema  = ${EXPECTED_MIND_SCHEMA_VERSION}`)))
  // 摘要不回显 channel_key（寻址标识不进运维终端）。
  assert.ok(!cli.log.join('\n').includes('424242'))
})

test('CLI 真跑：建库 + 自检通过，退出 0；--db 缺席退出 1', () => {
  const path = target()
  const cli = capture()
  const code = main(
    ['--db', path, '--owner-name', 'Kevin', '--now', NOW.toISOString()],
    cli.sink,
  )
  assert.equal(code, 0, cli.err.join('\n'))
  assert.ok(existsSync(path))
  assert.ok(cli.log.some((l) => l.includes('只读入口开库门通过')))

  const missing = capture()
  assert.equal(main([], missing.sink), 1)
  assert.ok(missing.err.some((l) => l.includes('--db')))
})

test('CLI：--now 不是有效时刻即用法错（时钟只从参数进）', () => {
  const cli = capture()
  assert.equal(main(['--db', target(), '--now', 'yesterday'], cli.sink), 1)
  assert.ok(cli.err.some((l) => l.includes('不是有效时刻')))
})
