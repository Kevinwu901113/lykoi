/**
 * read() 纯读装配：九项键序（SA-37）、注意力预算与裁剪（SA-38/39）、
 * 叙事线升序（SA-40）、认知叙事跳 narrative_only（SA-41）、G-6 预算折算、
 * 上一拍跳 running（SA-43）、零写断言+对照组（SA-47/48，G-9 立 M2）、
 * `刚刚醒来` 条件键（SA-165 接口位）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReadWriteMemory } from 'lykoi-memory/rw'
import { read, renderRestartNotice, type SnapshotStore } from '../src/index.ts'
import { dbDigest, makeFixture, rawOpen, stubDeps } from './fixture.ts'

const NOW = new Date('2026-08-20T12:00:00Z')
const T = (s: string) => `${s}+00:00`

/** 造一个内容充实的库：每块都有料，且都有需要裁剪/排序/跳过的边角。 */
function seed(path: string): void {
  const db = rawOpen(path)
  // 调节场事件：load 4 条（只应看到最新 3 条、新的在前）
  const ev = db.prepare(
    'INSERT INTO regulation_events (ts, name, delta, value_after, cause) VALUES (?, ?, ?, ?, ?)',
  )
  ev.run(T('2026-08-20T01:00:00'), 'load', 0.04, 0.24, 'e1-oldest')
  ev.run(T('2026-08-20T02:00:00'), 'load', 0.04, 0.28, 'e2')
  ev.run(T('2026-08-20T03:00:00'), 'load', 0.06, 0.34, 'e3')
  ev.run(T('2026-08-20T04:00:00'), 'load', -0.1, 0.24, 'e4-newest')
  ev.run(T('2026-08-19T00:00:00'), 'exploration_hunger', -0.4, 0.0, 'explore_completed')
  // 关切：7 条 active（Top-6 预算）；描述超 100 码点；一条无 last_lit_at
  const c = db.prepare(
    `INSERT INTO concerns (kind, title, description, weight, origin, status, created_at, last_lit_at)
     VALUES ('interest', ?, ?, ?, 'grown', 'active', ?, ?)`,
  )
  c.run('c-top', 'd'.repeat(105), 0.9, T('2026-08-01T12:00:00'), T('2026-08-19T12:00:00'))
  for (let i = 0; i < 5; i++) {
    c.run(`c-mid-${i}`, 'desc', 0.8 - i * 0.1, T('2026-08-10T12:00:00'), T('2026-08-19T12:00:00'))
  }
  // 无 last_lit_at → 按 created_at 算 days_since_lit；权重最低 → 应被 Top-6 裁掉
  c.run('c-overflow', 'desc', 0.1, T('2026-08-18T12:00:00'), null)
  // 叙事：absorption 是认知当前；更新的 narrative_only 必须被跳过（SA-41）
  const nv = db.prepare(
    `INSERT INTO narrative_versions (created_at, content, change_summary, trigger, narrative_class)
     VALUES (?, ?, 's', 'integration', ?)`,
  )
  nv.run(T('2026-08-19T00:00:00'), 'N'.repeat(405), 'absorption')
  nv.run(T('2026-08-20T00:00:00'), 'confab-should-not-surface', 'narrative_only')
  // 线：6 条 open/suspended（cap 5、按 updated_at 升序 = 最久没动的先看见）+ 1 条 resolved
  const th = db.prepare(
    `INSERT INTO narrative_threads (kind, content, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  th.run('open_question', 't-3d', 'open', T('2026-08-01T12:00:00'), T('2026-08-17T12:00:00'))
  th.run('commitment', 't-1d', 'open', T('2026-08-01T12:00:00'), T('2026-08-19T12:00:00'))
  th.run('arc', 't-5d', 'suspended', T('2026-08-01T12:00:00'), T('2026-08-15T12:00:00'))
  th.run('arc', 't-2d', 'open', T('2026-08-01T12:00:00'), T('2026-08-18T12:00:00'))
  th.run('open_question', 't-4d', 'open', T('2026-08-01T12:00:00'), T('2026-08-16T12:00:00'))
  th.run('arc', 't-6d-capped', 'open', T('2026-08-01T12:00:00'), T('2026-08-14T12:00:00'))
  th.run('arc', 't-resolved', 'resolved', T('2026-08-01T12:00:00'), T('2026-08-20T00:00:00'))
  // 经验：3 条待整合 + 1 条 environment（不计入未整合数）
  const ex = db.prepare(
    'INSERT INTO experiences (ts, source, content, salience) VALUES (?, ?, ?, 0.5)',
  )
  ex.run(T('2026-08-20T08:00:00'), 'conversation', 'exp-1')
  ex.run(T('2026-08-20T09:00:00'), 'environment', 'exp-env')
  ex.run(T('2026-08-20T10:00:00'), 'wake_action', 'exp-2')
  ex.run(T('2026-08-20T11:00:00'), 'action_result', 'x'.repeat(205))
  // 念头：4 条 open（Top-3 预算；charge DESC）
  const tho = db.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, related_concern_id, charge, status) VALUES (?, ?, ?, 'wake', ?, ?, 'open')",
  )
  tho.run(T('2026-08-20T09:00:00'), 'th-strong', 'question', 1, 0.9)
  tho.run(T('2026-08-20T10:00:00'), 'th-mid', 'intent', null, 0.7)
  tho.run(T('2026-08-20T11:00:00'), 'th-weak', 'observation', null, 0.5)
  tho.run(T('2026-08-20T11:30:00'), 'th-cut', 'rumination', null, 0.3)
  // history：最近一次对话 2h 前
  const h = db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)")
  h.run(T('2026-08-19T10:00:00'), 'hi-1')
  h.run(T('2026-08-20T10:00:00'), 'hi-2')
  // 上一拍：running（本拍自己，跳过）+ completed（应看到）
  const run = db.prepare(
    'INSERT INTO autonomy_runs (id, started_at, finished_at, status, decision, next_wake_at, action_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
  run.run('r-prev', T('2026-08-20T11:00:00'), T('2026-08-20T11:01:00'), 'completed',
    '{"kind": "rest", "demoted": false}', T('2026-08-20T11:31:00'), 0)
  run.run('r-now', T('2026-08-20T11:59:00'), null, 'running', null, null, 0)
  db.prepare(
    'INSERT INTO autonomy_state (id, next_wake_at, last_wake_at, updated_at) VALUES (1, ?, ?, ?)',
  ).run(T('2026-08-20T12:00:00'), T('2026-08-20T11:00:00'), T('2026-08-20T11:00:00'))
  db.close()
}

test('九项键序逐字（SA-37）；`刚刚醒来` 缺省不存在', () => {
  const path = makeFixture()
  seed(path)
  const store: SnapshotStore = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.deepEqual(Object.keys(snap), [
    'now', '调节场', 'coherence_low', '关切', '叙事', '经验', '念头', '环境', '上一拍',
  ])
  assert.equal(snap.now, '2026-08-20T12:00:00+00:00')
  ;(store as ReadWriteMemory).close()
})

test('调节场块：VARIABLES 序、value round 3、每变量最近 3 因新的在前', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.deepEqual(Object.keys(snap.调节场), [
    'coherence', 'load', 'relational_tension', 'exploration_hunger',
  ])
  assert.deepEqual(
    snap.调节场.load!.recent_causes.map((e) => e.cause),
    ['e4-newest', 'e3', 'e2'],
  )
  assert.equal(snap.coherence_low, false)
  // 衰减后 round 3：load 0.2（基线值，8/20 00:00 起算 12h 仍回归在基线上）
  assert.equal(snap.调节场.load!.value, 0.2)
  store.close()
})

test('关切块：Top-6 预算、weight DESC、description 裁 100（省略号在外）、lit 回退 created_at', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.equal(snap.关切.length, 6)
  assert.equal(snap.关切[0]!.title, 'c-top')
  assert.ok(!snap.关切.some((c) => c.title === 'c-overflow')) // 权重最低被预算裁掉
  assert.equal([...snap.关切[0]!.description].length, 101) // 100 + '…'
  assert.ok(snap.关切[0]!.description.endsWith('…'))
  assert.equal(snap.关切[0]!.days_since_lit, 1.0) // 2026-08-19T12:00 → 1 天
  store.close()
})

test('叙事块：跳过 narrative_only（SA-41）、当前裁 400、线升序 + cap 5（SA-40）', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.ok(snap.叙事.当前!.startsWith('NNN'))
  assert.equal([...snap.叙事.当前!].length, 401) // 400 + '…'
  // 最久没动的先看见；第 6 条（t-1d，最新动过）被 cap 裁掉；resolved 不入列
  assert.deepEqual(
    snap.叙事.线.map((t) => t.content),
    ['t-6d-capped', 't-5d', 't-4d', 't-3d', 't-2d'],
  )
  assert.equal(snap.叙事.线[1]!.days_stale, 5.0)
  store.close()
})

test('经验块：未整合数排除 environment；最近 3 条 id DESC；content 裁 200', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.equal(snap.经验.未整合数, 3)
  assert.deepEqual(
    snap.经验.最近.map((e) => e.source),
    ['action_result', 'wake_action', 'environment'],
  )
  assert.equal([...snap.经验.最近[0]!.content].length, 201) // 200 + '…'
  store.close()
})

test('念头块：Top-3 by charge、charge round 3、age_hours round 2', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.deepEqual(snap.念头.map((t) => t.content), ['th-strong', 'th-mid', 'th-weak'])
  assert.equal(snap.念头[0]!.charge, 0.9)
  assert.equal(snap.念头[0]!.age_hours, 3.0)
  assert.equal(snap.念头[0]!.related_concern_id, 1)
  store.close()
})

test('环境块：读数、探索断粮、节律、预算（G-6 系数 1.0 直通）', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const deps = stubDeps()
  const snap = read(store, deps, NOW)
  assert.equal(snap.环境.距上次和Kevin互动小时, 2.0)
  assert.equal(snap.环境.同时段历史.观察天数, 14)
  assert.equal(snap.环境.同时段历史.典型互动间隔小时, 24.0) // 样本不足 → 缺省
  assert.equal(snap.环境.同时段历史.近14天此时段有互动的天数, 1) // 仅 8/19 落在昨日锚点 ±2h
  assert.equal(snap.环境.等待批准的动作数, 0)
  assert.equal(snap.环境.探索.上次完成explore, '2026-08-19T00:00:00+00:00')
  assert.equal(snap.环境.探索.断粮小时, 36.0)
  // G-6：multiplier 1.0 → floor(20*1.0) - 0 = 20
  assert.equal(snap.环境.预算.本小时剩余行动数, 20)
  assert.equal(snap.环境.预算.今日剩余通知数, 2)
  assert.equal(snap.环境.预算.今日剩余主动开口数, 1)
  assert.equal(snap.环境.预算.预算系数, 1.0)
  store.close()
})

test('G-6 落地：load>0.7 → floor(20×0.5) − 已花 = 剩余（快照侧折算一次）', () => {
  const path = makeFixture()
  const db = rawOpen(path)
  db.prepare("UPDATE regulation_field SET value = 0.8, updated_at = ? WHERE name = 'load'")
    .run(T('2026-08-20T12:00:00'))
  db.prepare(
    "INSERT INTO autonomy_runs (id, started_at, finished_at, status, action_count) VALUES ('r1', ?, ?, 'completed', 3)",
  ).run(T('2026-08-20T11:30:00'), T('2026-08-20T11:31:00'))
  db.close()
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.equal(snap.环境.预算.预算系数, 0.5)
  assert.equal(snap.环境.预算.本小时剩余行动数, 7) // floor(10) - 3
  store.close()
})

test('上一拍：跳过 running；decision JSON 解析；不可解析原样展示（SA-43）', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const snap = read(store, stubDeps(), NOW)
  assert.deepEqual(snap.上一拍, {
    decision: { kind: 'rest', demoted: false },
    status: 'completed',
    started_at: '2026-08-20T11:00:00+00:00',
    next_wake_at: '2026-08-20T11:31:00+00:00',
  })
  store.close()
  // 不可解析的旧行：decision 保持原字符串，绝不编造
  const path2 = makeFixture()
  const db = rawOpen(path2)
  db.prepare(
    "INSERT INTO autonomy_runs (id, started_at, finished_at, status, decision) VALUES ('r', ?, ?, 'failed', '{broken')",
  ).run(T('2026-08-20T11:00:00'), T('2026-08-20T11:01:00'))
  db.close()
  const store2 = new ReadWriteMemory(path2)
  const snap2 = read(store2, stubDeps(), NOW)
  assert.equal(snap2.上一拍!.decision, '{broken')
  store2.close()
  // 空库 → null
  const path3 = makeFixture()
  const store3 = new ReadWriteMemory(path3)
  assert.equal(read(store3, stubDeps(), NOW).上一拍, null)
  store3.close()
})

test('coherence_low：coherence < 0.4 时标红', () => {
  const path = makeFixture()
  const db = rawOpen(path)
  db.prepare("UPDATE regulation_field SET value = 0.3, updated_at = ? WHERE name = 'coherence'")
    .run(T('2026-08-20T12:00:00'))
  db.close()
  const store = new ReadWriteMemory(path)
  assert.equal(read(store, stubDeps(), NOW).coherence_low, true)
  store.close()
})

test('read 零写（SA-47）+ 对照组（SA-48：一次真实写后摘要必须变）', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const before = dbDigest(path)
  read(store, stubDeps(), NOW)
  read(store, stubDeps(), NOW) // 同一时刻两次 read 也零写
  assert.equal(dbDigest(path), before)
  // 对照组：摘要函数必须对真实写敏感，否则零写断言可能假性通过
  store.recordExperience('system', 'control-group-write', { now: NOW })
  assert.notEqual(dbDigest(path), before)
  store.close()
})

test('同一时刻两次 read 逐字段相同（分发给 N 个分支的前提）', () => {
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const a = read(store, stubDeps(), NOW)
  const b = read(store, stubDeps(), NOW)
  assert.deepEqual(a, b)
  assert.equal(JSON.stringify(a), JSON.stringify(b))
  store.close()
})

test('刚刚醒来：条件键（SA-165 接口位）+ renderRestartNotice 逐字（SA-162）', () => {
  // 渲染函数本体
  assert.equal(renderRestartNotice(null), '')
  assert.equal(renderRestartNotice({}), '') // Python 空 dict 为假
  assert.equal(renderRestartNotice({ notes: [] }), '[你刚从一次重启中醒来。]')
  assert.equal(
    renderRestartNotice({ notes: ['你重启了一次——之前是睡着的，现在醒了。', '大约停了 3 小时 5 分钟。'] }),
    '[你重启了一次——之前是睡着的，现在醒了。大约停了 3 小时 5 分钟。]', // 无分隔符 join
  )
  // 接口位：deps 返回事件时键存在且排在最后；恒 null 时键不存在（缺省已在键序测试断言）
  const path = makeFixture()
  seed(path)
  const store = new ReadWriteMemory(path)
  const sinceSeen: (string | null)[] = []
  const deps = stubDeps({
    unprocessedRestartEvent: (since) => {
      sinceSeen.push(since)
      return { notes: ['你重启了一次——之前是睡着的，现在醒了。'] }
    },
  })
  const snap = read(store, deps, NOW)
  assert.equal(snap.刚刚醒来, '[你重启了一次——之前是睡着的，现在醒了。]')
  assert.equal(Object.keys(snap).at(-1), '刚刚醒来')
  // since = 她上次醒来（autonomy_state.last_wake_at），SA-165 的比较基准
  assert.deepEqual(sinceSeen, ['2026-08-20T11:00:00+00:00'])
  store.close()
})
