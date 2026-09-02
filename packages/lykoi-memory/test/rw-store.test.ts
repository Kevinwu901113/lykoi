/**
 * 写层 API 测试（M2-W1 交付①）：C-01/C-02 连接与事务纪律、record_experience、
 * apply_regulation_cause（SA-74/75 + 懒衰减读改写）、thoughts 全套
 * （SA-175/176/177）、history append、autonomy_state/runs。全部跑在合成 fixture 上
 * （DDL 逐字 = STATE-CONTRACT §1，零真实数据）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  applyDeltaValue,
  decayCharge,
  decayValue,
  THOUGHT_LAPSE_SALIENCE,
  THOUGHT_OPEN_CAP,
} from 'lykoi-regulation'
import { parseStateTimestamp } from '../src/index.ts'
import { formatPyIso, ReadWriteMemory } from '../src/rw.ts'
import { makeWritableFixture, PY_ISO_RE, rawOpen, tmp } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 7, 20, 0, 0, 0, 0)) // == fixture regulation_field.updated_at

function openRw(): { rw: ReadWriteMemory; raw: DatabaseSync } {
  const path = makeWritableFixture()
  return { rw: new ReadWriteMemory(path), raw: rawOpen(path) }
}

// ============================== 连接门与纪律 ==============================

// WO-MEM-DECAY-01：期望版本 16 → 17（017 迁移登记的新版本号）；判定逻辑未动。
// 用 16 造反例正好钉住"未施加 017 的旧库拒开"这条部署纪律。
test('rw 入口同样有 schema 门：mind_schema != 17 / 非 state 库拒开', () => {
  const bad = join(tmp(), 'v16.db')
  const db = new DatabaseSync(bad)
  db.exec("CREATE TABLE mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO mind_schema VALUES (16, 'x')")
  db.close()
  assert.throws(() => new ReadWriteMemory(bad), /mind_schema version 16 != expected 17/)
  const notState = join(tmp(), 'not-state.db')
  const db2 = new DatabaseSync(notState)
  db2.exec('CREATE TABLE t (a)')
  db2.close()
  assert.throws(() => new ReadWriteMemory(notState), /cannot read mind_schema/)
})

test('C-01：rw 连接 busy_timeout=10000 生效', () => {
  const { rw } = openRw()
  assert.equal(rw.busyTimeoutMs, 10000)
  rw.close()
})

test('C-02：写失败即 ROLLBACK，连接不滞留在事务里（后续写照常）', () => {
  const { rw, raw } = openRw()
  const id = rw.createThought('还开着的念头', 'intent', 'wake', { now: T0 })
  assert.ok(id !== null)
  // settle 一条 open 念头违反 SA-176 → 抛错；事务必须已回滚
  assert.throws(() => rw.settleThought(id!, 42), /SA-176/)
  // 连接可继续写 == 无悬挂事务
  const id2 = rw.createThought('第二条', 'question', 'wake', { now: T0 })
  assert.ok(id2 !== null)
  assert.equal(
    (raw.prepare("SELECT COUNT(*) AS n FROM thoughts WHERE status = 'open'").get() as { n: number }).n,
    2,
  )
  rw.close(); raw.close()
})

// ============================== experiences ==============================

test('recordExperience：落行 + C-22 时间戳 + salience 缺省 0.5 + FK 生效', () => {
  const { rw, raw } = openRw()
  const id = rw.recordExperience('system', 'synthetic-exp', { now: T0 })
  const row = raw.prepare(
    'SELECT ts, source, content, salience, related_concern_id, integrated, integration_id FROM experiences WHERE id = ?',
  ).get(id) as Record<string, unknown>
  assert.equal(row.source, 'system')
  assert.equal(row.salience, 0.5)
  assert.equal(row.integrated, 0)
  assert.equal(row.integration_id, null)
  assert.match(row.ts as string, PY_ISO_RE)
  assert.equal(row.ts, formatPyIso(T0))
  // 显式 salience 与合法关切外键
  const id2 = rw.recordExperience('silence', 'synthetic-silence', { salience: 0.6, relatedConcernId: 1, now: T0 })
  const row2 = raw.prepare('SELECT salience, related_concern_id FROM experiences WHERE id = ?').get(id2) as Record<string, unknown>
  assert.deepEqual([row2.salience, row2.related_concern_id], [0.6, 1])
  // C-01 foreign_keys=ON：悬空关切引用被拒
  assert.throws(
    () => rw.recordExperience('system', 'dangling', { relatedConcernId: 999, now: T0 }),
    /FOREIGN KEY constraint failed/,
  )
  rw.close(); raw.close()
})

// ============================== 调节场写 ==============================

test('SA-75：未知 cause 拒调（接口上不存在 delta 参数，幅度只来自 CAUSES）', () => {
  const { rw } = openRw()
  assert.throws(() => rw.applyRegulationCause('invented_cause', { now: T0 }), /unknown regulation cause/)
  rw.close()
})

test('applyRegulationCause：elapsed=0 时 delta 精确入账，events+field 同笔', () => {
  const { rw, raw } = openRw()
  const res = rw.applyRegulationCause('experience_recorded', { now: T0 })
  assert.equal(res.name, 'load')
  assert.equal(res.delta, 0.04)
  assert.equal(res.valueBefore, 0.2)
  assert.equal(res.valueAfter, 0.2 + 0.04)
  const field = raw.prepare("SELECT value, updated_at FROM regulation_field WHERE name = 'load'").get() as
    { value: number; updated_at: string }
  assert.equal(field.value, res.valueAfter)
  assert.equal(field.updated_at, formatPyIso(T0))
  const event = { ...raw.prepare('SELECT ts, name, delta, value_after, cause FROM regulation_events ORDER BY id DESC LIMIT 1').get() } as Record<string, unknown>
  assert.deepEqual(event, {
    ts: formatPyIso(T0), name: 'load', delta: 0.04, value_after: res.valueAfter, cause: 'experience_recorded',
  })
  rw.close(); raw.close()
})

test('applyRegulationCause：懒衰减从 updated_at 起算，衰减后再加 delta（§4.3 读改写）', () => {
  const { rw, raw } = openRw()
  rw.applyRegulationCause('action_taken', { now: T0 }) // load: 0.2 → 0.26
  const t1 = new Date(T0.getTime() + 10 * 3_600_000) // +10h
  const res = rw.applyRegulationCause('rested', { now: t1 })
  const expectedDecayed = decayValue('load', 0.2 + 0.06, 10)
  assert.equal(res.valueBefore, expectedDecayed)
  assert.equal(res.valueAfter, applyDeltaValue(expectedDecayed, -0.10))
  const field = raw.prepare("SELECT value, updated_at FROM regulation_field WHERE name = 'load'").get() as
    { value: number; updated_at: string }
  assert.equal(field.value, res.valueAfter)
  assert.equal(field.updated_at, formatPyIso(t1))
  rw.close(); raw.close()
})

test('getRegulation：懒衰减纯读，不落账（updated_at 不动）', () => {
  const { rw, raw } = openRw()
  const t1 = new Date(T0.getTime() + 100 * 3_600_000)
  const values = rw.getRegulation({ now: t1 })
  // fixture 四值全在 baseline 上：regress 变量衰减后仍 == baseline；accumulate 从 0 爬升
  assert.equal(values.coherence, 0.7)
  assert.equal(values.load, 0.2)
  assert.equal(values.relational_tension, 0.3)
  assert.equal(values.exploration_hunger, decayValue('exploration_hunger', 0.0, 100))
  const rows = raw.prepare('SELECT updated_at FROM regulation_field').all() as { updated_at: string }[]
  for (const r of rows) assert.equal(r.updated_at, '2026-08-20T00:00:00+00:00') // 纯读证明
  rw.close(); raw.close()
})

// ============================== thoughts（SA-175/176/177） ==============================

test('createThought：校验面（空/超 200 字/非法 kind/source）', () => {
  const { rw } = openRw()
  assert.throws(() => rw.createThought('', 'intent', 'wake', { now: T0 }), /non-empty/)
  assert.throws(() => rw.createThought('  ', 'intent', 'wake', { now: T0 }), /non-empty/)
  assert.throws(() => rw.createThought('长'.repeat(201), 'intent', 'wake', { now: T0 }), /200/)
  assert.ok(rw.createThought('长'.repeat(200), 'intent', 'wake', { now: T0 }) !== null) // 恰 200 合法
  assert.throws(
    () => rw.createThought('x', 'daydream' as never, 'wake', { now: T0 }),
    /invalid thought kind/,
  )
  assert.throws(
    () => rw.createThought('x', 'intent', 'dream' as never, { now: T0 }),
    /invalid thought source/,
  )
  rw.close()
})

test('SA-175：容量 7 软拒 —— charge 不严格大于最低者即拒（返回 null，不抛）', () => {
  const { rw, raw } = openRw()
  const charges = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]
  for (const c of charges) {
    assert.ok(rw.createThought(`t-${c}`, 'observation', 'wake', { chargeHint: c, now: T0 }) !== null)
  }
  assert.equal(rw.openThoughts().length, THOUGHT_OPEN_CAP)
  // 等于最低者 → 拒；低于最低者 → 拒
  assert.equal(rw.createThought('cap-equal', 'observation', 'wake', { chargeHint: 0.3, now: T0 }), null)
  assert.equal(rw.createThought('cap-below', 'observation', 'wake', { chargeHint: 0.1, now: T0 }), null)
  assert.equal(rw.openThoughts().length, THOUGHT_OPEN_CAP)
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM experiences').get() as { n: number }).n, 0)
  rw.close(); raw.close()
})

test('SA-175：严格大于最低者 → 同事务挤掉最低者（abandoned + thought_lapse 0.2）', () => {
  const { rw, raw } = openRw()
  const ids: number[] = []
  for (const c of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
    ids.push(rw.createThought(`t-${c}`, 'observation', 'wake', { chargeHint: c, now: T0 })!)
  }
  const newId = rw.createThought('挤进来的', 'observation', 'wake', { chargeHint: 0.31, now: T0 })
  assert.ok(newId !== null)
  // 仍是 7 条 open；最低者（0.3）被挤成 abandoned
  assert.equal(rw.openThoughts().length, THOUGHT_OPEN_CAP)
  const evicted = raw.prepare('SELECT status, charge FROM thoughts WHERE id = ?').get(ids[0]) as
    { status: string; charge: number }
  assert.equal(evicted.status, 'abandoned')
  // 同事务的 thought_lapse 经验：source/salience/content 模板逐字
  // （W1 TODO#1 销账：thoughts.py:43-62 `放掉了一个没想完的念头:{clip(summary,100)} ({reason})`）
  const lapse = raw.prepare(
    "SELECT content, related_concern_id FROM experiences WHERE source = 'thought_lapse' AND salience = ?",
  ).all(THOUGHT_LAPSE_SALIENCE) as { content: string; related_concern_id: number | null }[]
  assert.equal(lapse.length, 1)
  assert.equal(lapse[0]!.content, '放掉了一个没想完的念头:t-0.3 (capacity_displacement)')
  assert.equal(lapse[0]!.related_concern_id, null) // Python insert_experience_in_tx 不带关切 id
  // 被挤者只改 status，charge 原样（thoughts.py _abandon_in_tx 不写 charge）
  assert.equal(evicted.charge, 0.3)
  rw.close(); raw.close()
})

test('resolveThought：注入集第二道闸 —— 集外拒、非 open 拒、集内 open→resolved', () => {
  const { rw, raw } = openRw()
  const id = rw.createThought('待了结', 'question', 'wake', { now: T0 })!
  assert.equal(rw.resolveThought(id, []), false) //          集外 → 拒
  assert.equal(rw.resolveThought(id, [id + 1]), false) //    集里没有它 → 拒
  assert.equal(
    (raw.prepare('SELECT status FROM thoughts WHERE id = ?').get(id) as { status: string }).status,
    'open', // 拒绝时状态不动
  )
  assert.equal(rw.resolveThought(id, [id]), true) //         集内 + open → resolved
  assert.equal(
    (raw.prepare('SELECT status FROM thoughts WHERE id = ?').get(id) as { status: string }).status,
    'resolved',
  )
  assert.equal(rw.resolveThought(id, [id]), false) //        已 resolved → 拒（幂等无副作用）
  rw.close(); raw.close()
})

test('SA-177：decayAllOpenThoughts 一拍 0.04；跌破 0.15 → abandoned + thought_lapse 原子', () => {
  const { rw, raw } = openRw()
  const keep = rw.createThought('还有电', 'observation', 'wake', { chargeHint: 0.5, now: T0 })!
  const lapse = rw.createThought('快没电', 'observation', 'wake', { chargeHint: 0.18, now: T0 })!
  const result = rw.decayAllOpenThoughts({ now: T0 })
  // thoughts.py 计数口径：decayed 只数存续的（lapse 的不计）
  assert.deepEqual(result, { decayed: 1, lapsed: [lapse] })
  const keepRow = raw.prepare('SELECT status, charge FROM thoughts WHERE id = ?').get(keep) as
    { status: string; charge: number }
  assert.equal(keepRow.status, 'open')
  assert.equal(keepRow.charge, decayCharge(0.5, 1))
  const lapseRow = raw.prepare('SELECT status, charge FROM thoughts WHERE id = ?').get(lapse) as
    { status: string; charge: number }
  assert.equal(lapseRow.status, 'abandoned')
  assert.equal(lapseRow.charge, 0.18) // _abandon_in_tx 只改 status，charge 原样
  const exp = raw.prepare(
    "SELECT content FROM experiences WHERE source = 'thought_lapse' AND salience = ?",
  ).all(THOUGHT_LAPSE_SALIENCE) as { content: string }[]
  assert.equal(exp.length, 1)
  assert.equal(exp[0]!.content, '放掉了一个没想完的念头:快没电 (decay)')
  // 边界：恰 0.15 不 lapse（严格 <）
  const border = rw.createThought('边界', 'observation', 'wake', { chargeHint: 0.19, now: T0 })!
  rw.decayAllOpenThoughts({ now: T0 }) // 0.19 → 0.15（浮点上 0.15000000000000002 > 0.15，不 lapse）
  assert.equal(
    (raw.prepare('SELECT status FROM thoughts WHERE id = ?').get(border) as { status: string }).status,
    'open',
  )
  rw.close(); raw.close()
})

test('SA-176：settleThought 仅 resolved→absorbed 且必携 integration_id', () => {
  const { rw, raw } = openRw()
  const id = rw.createThought('要被吸收', 'hypothesis', 'wake', { now: T0 })!
  assert.throws(() => rw.settleThought(id, 4242), /SA-176/) // open → 拒
  assert.throws(() => rw.settleThought(id, 1.5 as never), /integer integration_id/)
  rw.resolveThought(id, [id])
  rw.settleThought(id, 4242)
  const row = { ...raw.prepare('SELECT status, resolved_by_integration_id FROM thoughts WHERE id = ?').get(id) } as
    { status: string; resolved_by_integration_id: number }
  assert.deepEqual(row, { status: 'absorbed', resolved_by_integration_id: 4242 })
  rw.close(); raw.close()
})

test('archiveThought：resolved/abandoned→archived；open 拒', () => {
  const { rw, raw } = openRw()
  const a = rw.createThought('a', 'intent', 'wake', { now: T0 })!
  const b = rw.createThought('b', 'intent', 'wake', { chargeHint: 0.16, now: T0 })!
  const c = rw.createThought('c', 'intent', 'wake', { now: T0 })!
  assert.throws(() => rw.archiveThought(c), /resolved\/abandoned/) // open → 拒
  rw.resolveThought(a, [a])
  rw.archiveThought(a) // resolved→archived
  rw.decayAllOpenThoughts({ now: T0 }) // b: 0.16→0.12 lapse 成 abandoned
  rw.archiveThought(b) // abandoned→archived
  const statuses = raw.prepare('SELECT id, status FROM thoughts ORDER BY id').all() as { id: number; status: string }[]
  assert.deepEqual(statuses.map((r) => r.status), ['archived', 'archived', 'open'])
  rw.close(); raw.close()
})

// ============================== history / autonomy ==============================

test('appendHistory：AUTOINCREMENT 单调 id + C-22 时间戳（append-only 由库层触发器守）', () => {
  const { rw, raw } = openRw()
  const id1 = rw.appendHistory('conversation', 'synthetic-1', { now: T0 })
  const id2 = rw.appendHistory('system', 'synthetic-2', { now: T0 })
  assert.ok(id2 > id1)
  const row = { ...raw.prepare('SELECT ts, event_type, content FROM history WHERE id = ?').get(id1) } as Record<string, unknown>
  assert.deepEqual(row, { ts: formatPyIso(T0), event_type: 'conversation', content: 'synthetic-1' })
  assert.throws(() => rw.appendHistory('', 'x', { now: T0 }), /non-empty/)
  rw.close(); raw.close()
})

test('autonomy_state：setAutonomyNextWake upsert 两分支 + setAutonomyLastWake 需已有行', () => {
  const { rw } = openRw()
  const wake1 = new Date(T0.getTime() + 3_600_000)
  assert.equal(rw.autonomyState(), undefined)
  assert.throws(() => rw.setAutonomyLastWake(T0, { now: T0 }), /row missing/)
  rw.setAutonomyNextWake(wake1, { now: T0 }) // INSERT 分支
  assert.deepEqual(rw.autonomyState(), {
    nextWakeAt: formatPyIso(wake1), lastWakeAt: null, updatedAt: formatPyIso(T0),
  })
  const wake2 = new Date(T0.getTime() + 7_200_000)
  rw.setAutonomyNextWake(wake2, { now: wake1 }) // UPDATE 分支
  rw.setAutonomyLastWake(wake1, { now: wake1 })
  assert.deepEqual(rw.autonomyState(), {
    nextWakeAt: formatPyIso(wake2), lastWakeAt: formatPyIso(wake1), updatedAt: formatPyIso(wake1),
  })
  rw.close()
})

test('autonomy_runs：start/finish/getAutonomyRuns（计数走 DDL 缺省 0；未知行/非法状态拒）', () => {
  const { rw, raw } = openRw()
  rw.startAutonomyRun('run_a', { startedAt: T0 })
  const started = { ...raw.prepare('SELECT status, action_count, external_read_count, notification_count, finished_at FROM autonomy_runs WHERE id = ?').get('run_a') } as Record<string, unknown>
  assert.deepEqual(started, {
    status: 'running', action_count: 0, external_read_count: 0, notification_count: 0, finished_at: null,
  })
  const t1 = new Date(T0.getTime() + 60_000)
  rw.finishAutonomyRun('run_a', {
    status: 'completed', finishedAt: t1, decision: '{"kind":"rest"}',
    nextWakeAt: new Date(T0.getTime() + 3_600_000), actionCount: 1,
  })
  const done = { ...raw.prepare('SELECT status, finished_at, decision, action_count, notification_count FROM autonomy_runs WHERE id = ?').get('run_a') } as Record<string, unknown>
  assert.deepEqual(done, {
    status: 'completed', finished_at: formatPyIso(t1), decision: '{"kind":"rest"}',
    action_count: 1, notification_count: 0,
  })
  assert.throws(() => rw.finishAutonomyRun('no_such', { status: 'failed', finishedAt: t1 }), /no such run/)
  assert.throws(
    () => rw.finishAutonomyRun('run_a', { status: 'running' as never, finishedAt: t1 }),
    /invalid autonomy run status/,
  )
  rw.startAutonomyRun('run_b', { startedAt: t1 })
  const runs = rw.getAutonomyRuns(5)
  assert.deepEqual(runs.map((r) => r.id), ['run_b', 'run_a']) // 最近在前
  assert.equal(rw.getAutonomyRuns(1).length, 1)
  rw.close(); raw.close()
})
