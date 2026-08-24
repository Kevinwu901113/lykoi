/**
 * 写层 W3 补齐面测试：lightConcern / tendConcernDescription / appendThreadProgress /
 * appendAutonomyNote / latestExperienceTs / bumpWakesSince（reflow/wake 的写依赖）。
 * 语义正本：mind/store.py（light_concern:363-392 / tend:467-486 / thread:672-697 /
 * latest:1213-1223 / bump:1517-1541）+ memory/store.py append_autonomy_note:356-384。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import type { DatabaseSync } from 'node:sqlite'
import { CONCERN_LIT_WEIGHT_DELTA, ReadWriteMemory, ValueError } from '../src/rw.ts'
import { makeWritableFixture, rawOpen } from './fixture.ts'

const T0 = new Date(Date.UTC(2026, 7, 20, 0, 0, 0, 0))
const T1 = new Date(Date.UTC(2026, 7, 20, 12, 30, 0, 0))

function openRw(): { rw: ReadWriteMemory; raw: DatabaseSync } {
  const path = makeWritableFixture()
  return { rw: new ReadWriteMemory(path), raw: rawOpen(path) }
}

// ============================== lightConcern ==============================

test('lightConcern：weight +0.05、last_lit_at 刷新、lit_count+1；返回 {id,weight,status}', () => {
  const { rw, raw } = openRw()
  const out = rw.lightConcern(1, { now: T1 })
  assert.deepEqual(out, { id: 1, weight: 0.5 + CONCERN_LIT_WEIGHT_DELTA, status: 'active' })
  const row = raw.prepare(
    'SELECT weight, last_lit_at, lit_count FROM concerns WHERE id = 1',
  ).get() as { weight: number; last_lit_at: string; lit_count: number }
  assert.equal(row.weight, 0.55)
  assert.equal(row.last_lit_at, '2026-08-20T12:30:00+00:00')
  assert.equal(row.lit_count, 1)
  rw.close(); raw.close()
})

test('lightConcern：dimming 被点亮回 active（仅 active 未满时）；released/不存在 → ValueError', () => {
  const { rw, raw } = openRw()
  raw.prepare(
    `INSERT INTO concerns (id, kind, title, weight, origin, status, created_at)
     VALUES (2, 'interest', 'dim', 0.3, 'grown', 'dimming', '2026-08-01T00:00:00+00:00'),
            (3, 'interest', 'gone', 0.3, 'grown', 'released', '2026-08-01T00:00:00+00:00')`,
  ).run()
  assert.equal(rw.lightConcern(2, { now: T1 }).status, 'active')
  assert.throws(() => rw.lightConcern(3, { now: T1 }), (err: unknown) => {
    assert.ok(err instanceof ValueError)
    assert.match((err as Error).message, /concern 3 is released; code must not relight it/)
    return true
  })
  assert.throws(() => rw.lightConcern(99, { now: T1 }), /no concern 99/)
  rw.close(); raw.close()
})

test('lightConcern：active 已满 12 时 dormant 点亮不回 active（上限不因发光突破），weight/lit_count 仍动', () => {
  const { rw, raw } = openRw()
  for (let i = 2; i <= 12; i++) {
    raw.prepare(
      `INSERT INTO concerns (id, kind, title, weight, origin, status, created_at)
       VALUES (?, 'interest', ?, 0.3, 'grown', 'active', '2026-08-01T00:00:00+00:00')`,
    ).run(i, `c-${i}`)
  }
  raw.prepare(
    `INSERT INTO concerns (id, kind, title, weight, origin, status, created_at)
     VALUES (13, 'interest', 'sleeper', 0.3, 'grown', 'dormant', '2026-08-01T00:00:00+00:00')`,
  ).run()
  const out = rw.lightConcern(13, { now: T1 })
  assert.equal(out.status, 'dormant') // active==12（满）→ 不回 active
  const row = raw.prepare('SELECT lit_count, weight FROM concerns WHERE id = 13').get() as
    { lit_count: number; weight: number }
  assert.equal(row.lit_count, 1)
  assert.equal(row.weight, 0.35)
  rw.close(); raw.close()
})

// ============================== tend / thread progress ==============================

test('tendConcernDescription：只改 description；空描述/released/不存在 → ValueError', () => {
  const { rw, raw } = openRw()
  rw.tendConcernDescription(1, '新的描述', { now: T1 })
  const row = raw.prepare(
    'SELECT description, weight, last_lit_at FROM concerns WHERE id = 1',
  ).get() as { description: string; weight: number; last_lit_at: string | null }
  assert.equal(row.description, '新的描述')
  assert.equal(row.weight, 0.5) //          weight 不动
  assert.equal(row.last_lit_at, null) //    照料不是点亮
  assert.throws(() => rw.tendConcernDescription(1, '   ', { now: T1 }), ValueError)
  assert.throws(() => rw.tendConcernDescription(99, 'x', { now: T1 }), /no concern 99/)
  rw.close(); raw.close()
})

test('appendThreadProgress：拼接形态逐字 + 刷新 updated_at；closed 线拒绝（ValueError）', () => {
  const { rw, raw } = openRw()
  raw.prepare(
    `INSERT INTO narrative_threads (id, kind, content, status, created_at, updated_at)
     VALUES (1, 'open_question', '起点', 'suspended', '2026-07-01T00:00:00+00:00', '2026-07-01T00:00:00+00:00'),
            (2, 'commitment', '完了的', 'resolved', '2026-07-01T00:00:00+00:00', '2026-07-01T00:00:00+00:00')`,
  ).run()
  rw.appendThreadProgress(1, '  今天想通了一半  ', { now: T1 })
  const row = raw.prepare('SELECT content, updated_at, status FROM narrative_threads WHERE id = 1')
    .get() as { content: string; updated_at: string; status: string }
  assert.equal(row.content, '起点\n[2026-08-20] 今天想通了一半') // strip + 带日期前缀
  assert.equal(row.updated_at, '2026-08-20T12:30:00+00:00') //     30 天超龄时钟被重置
  assert.equal(row.status, 'suspended') //                          照料不改状态
  assert.throws(() => rw.appendThreadProgress(2, '不行', { now: T1 }),
    /thread 2 is resolved; only open\/suspended can be tended/)
  assert.throws(() => rw.appendThreadProgress(1, '', { now: T1 }), ValueError)
  assert.throws(() => rw.appendThreadProgress(9, 'x', { now: T1 }), /no thread 9/)
  rw.close(); raw.close()
})

// ============================== notes / latest ts / bump ==============================

test('appendAutonomyNote：append-only 行 + 触发器拒改；source_urls 缺省 NULL', () => {
  const { rw, raw } = openRw()
  const id = rw.appendAutonomyNote('run-1', 'reflection', '一条 note', { sourceType: 'internal', now: T1 })
  const row = raw.prepare('SELECT * FROM autonomy_notes WHERE id = ?').get(id) as Record<string, unknown>
  assert.equal(row.autonomy_run_id, 'run-1')
  assert.equal(row.kind, 'reflection')
  assert.equal(row.content, '一条 note')
  assert.equal(row.source_type, 'internal')
  assert.equal(row.source_urls_json, null)
  assert.equal(row.created_at, '2026-08-20T12:30:00+00:00')
  assert.throws(
    () => raw.prepare('UPDATE autonomy_notes SET content = ? WHERE id = ?').run('改', id),
    /autonomy_notes is append-only/,
  )
  rw.close(); raw.close()
})

test('latestExperienceTs：MAX(ts) 按 source；无行 → null；未知 source → ValueError', () => {
  const { rw } = openRw()
  assert.equal(rw.latestExperienceTs('silence'), null)
  rw.recordExperience('silence', 's1', { now: T0 })
  rw.recordExperience('silence', 's2', { now: T1 })
  rw.recordExperience('conversation', 'c1', { now: T1 })
  assert.equal(rw.latestExperienceTs('silence'), '2026-08-20T12:30:00+00:00')
  assert.throws(
    () => rw.latestExperienceTs('nope' as never),
    /unknown experience source: 'nope'/,
  )
  rw.close()
})

test('bumpWakesSince：层1 层2 双计数器同源 +1（清零点不同归 W4）；返回层 1 计数', () => {
  const { rw, raw } = openRw()
  assert.equal(rw.bumpWakesSince({ now: T0 }), 1)
  assert.equal(rw.bumpWakesSince({ now: T1 }), 2)
  const l1 = raw.prepare('SELECT wakes_since AS n FROM integration_state WHERE id = 1').get() as { n: number }
  assert.equal(l1.n, 2)
  const l2 = raw.prepare(
    "SELECT value, set_at FROM learning_layer_state WHERE key = 'l4_focus_wakes_since'",
  ).get() as { value: number; set_at: string }
  // fixture 播种 0 行存在 → upsert 走 UPDATE 路：0+1+1 = 2
  assert.equal(l2.value, 2)
  assert.equal(l2.set_at, '2026-08-20T12:30:00+00:00')
  // 水位线键不被触碰（C-15：重放不得抬高）
  const wm = raw.prepare(
    "SELECT value FROM learning_layer_state WHERE key = 'l2_intake_watermark_id'",
  ).get() as { value: number }
  assert.equal(wm.value, 0)
  rw.close(); raw.close()
})
