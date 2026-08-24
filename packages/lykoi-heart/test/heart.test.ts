import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import {
  BASELINE_ENV, DEFAULT_BASELINE_MIN, FileHeartState, HeartCore, MAX_REST_MIN, MIN_REST_MIN,
  REASON_BASELINE, REASON_FLOOR, REASON_SALIENCE, REASON_WAITING, SALIENCE_TIMEOUT_S,
  SALIENCE_TRIGGER_N, SalienceReadSide, baselineMinutes,
  type HeartAlarm, type HeartBeatPayload, type HeartService,
} from '../src/index.ts'
import * as heart from '../src/index.ts'
import { T0, insertShadowRows, makeSalienceDb, minutesAfter, tmp } from './fixture.ts'

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

function alarmLog(): { alarm: HeartAlarm; events: [string, Record<string, unknown>][] } {
  const events: [string, Record<string, unknown>][] = []
  return {
    events,
    alarm: (name, fields) => {
      events.push([name, fields])
    },
  }
}

function makeCore(opts: { saliencePath?: string | null; alarm?: HeartAlarm } = {}): {
  core: HeartCore
  stateFile: string
} {
  const stateFile = join(tmp(), 'heart-state.json')
  const core = new HeartCore({
    state: new FileHeartState(stateFile),
    salience: opts.saliencePath ? new SalienceReadSide(opts.saliencePath) : null,
    ...(opts.alarm === undefined ? {} : { alarm: opts.alarm }),
  })
  return { core, stateFile }
}

test('常量与活体同源钉死：MIN 5 / MAX 360 / 基线默认 30 / 触发 N=3 / 只读等待 2s', () => {
  assert.equal(MIN_REST_MIN, 5)
  assert.equal(MAX_REST_MIN, 360)
  assert.equal(DEFAULT_BASELINE_MIN, 30)
  assert.equal(SALIENCE_TRIGGER_N, 3)
  assert.equal(SALIENCE_TIMEOUT_S, 2.0)
})

test('baselineMinutes：env 可配 clamp(5,360)，非法/缺失回落默认 30（heartbeat.py:99-112）', () => {
  assert.equal(baselineMinutes({}), 30)
  assert.equal(baselineMinutes({ [BASELINE_ENV]: '10' }), 10)
  assert.equal(baselineMinutes({ [BASELINE_ENV]: '900' }), 360)
  assert.equal(baselineMinutes({ [BASELINE_ENV]: '1' }), 5)
  assert.equal(baselineMinutes({ [BASELINE_ENV]: 'abc' }), 30)
  assert.equal(baselineMinutes({ [BASELINE_ENV]: '   ' }), 30)
})

test('开机首拍 wake soon：地板一过（MIN_REST_MIN 后）即第一拍（autonomous.py:301-302 对应）', () => {
  const { core } = makeCore()
  const v0 = core.evaluate(T0)
  assert.equal(v0.wouldWake, false)
  assert.equal(v0.reason, REASON_WAITING) // 地板已开（回拨 25min），基线未到
  const v1 = core.evaluate(minutesAfter(T0, MIN_REST_MIN))
  assert.equal(v1.wouldWake, true)
  assert.equal(v1.reason, REASON_BASELINE)
})

test('基线节律：一拍之后 30 分钟再拍；nextAt 可观测', () => {
  const { core } = makeCore()
  core.evaluate(T0) //                 播种（开机态）
  core.evaluate(minutesAfter(T0, 5)) // 首拍
  const waiting = core.evaluate(minutesAfter(T0, 5 + 29))
  assert.equal(waiting.wouldWake, false)
  assert.equal(waiting.reason, REASON_WAITING)
  assert.equal(waiting.nextAt, minutesAfter(T0, 5 + 30).toISOString())
  const due = core.evaluate(minutesAfter(T0, 5 + 30))
  assert.equal(due.wouldWake, true)
  assert.equal(due.reason, REASON_BASELINE)
  assert.equal(due.nextAt, minutesAfter(T0, 5 + 60).toISOString())
  assert.equal(core.nextAt, due.nextAt)
})

test('G-3 显著性：新增 selected=1 行数 >= 3 提前拍；游标推进后不重复触发', () => {
  const db = makeSalienceDb()
  const { core } = makeCore({ saliencePath: db })
  core.evaluate(T0) // 播种（开机态）
  const t1 = minutesAfter(T0, 5)
  assert.equal(core.evaluate(t1).wouldWake, true) // 首拍（顺带消费播种游标）
  insertShadowRows(db, 3, 1)
  const v = core.evaluate(minutesAfter(t1, 6))
  assert.equal(v.wouldWake, true)
  assert.equal(v.reason, REASON_SALIENCE)
  assert.equal(v.salientNew, 3)
  assert.equal(v.salienceOk, true)
  // 这一拍消费了游标：没有新行就回到 waiting，不吃老本。
  const after = core.evaluate(minutesAfter(t1, 12))
  assert.equal(after.wouldWake, false)
  assert.equal(after.reason, REASON_WAITING)
  assert.equal(after.salientNew, 0)
})

test('G-3：selected=0 的行不计；不足 N=3 不触发', () => {
  const db = makeSalienceDb()
  const { core } = makeCore({ saliencePath: db })
  core.evaluate(T0) // 播种（开机态）
  const t1 = minutesAfter(T0, 5)
  core.evaluate(t1) // 首拍
  insertShadowRows(db, 5, 0)
  insertShadowRows(db, 2, 1)
  const v = core.evaluate(minutesAfter(t1, 6))
  assert.equal(v.wouldWake, false)
  assert.equal(v.salientNew, 2) // SUM(selected)：0 行不计
})

test('G-8(b) 地板串联：显著性堆满也过不了关着的地板（两拍间隔 >= 5 分钟）', () => {
  const db = makeSalienceDb()
  const { core } = makeCore({ saliencePath: db })
  core.evaluate(T0) // 播种（开机态）
  const t1 = minutesAfter(T0, 5)
  core.evaluate(t1) // 首拍
  insertShadowRows(db, 4, 1)
  const v = core.evaluate(minutesAfter(t1, 4))
  assert.equal(v.wouldWake, false)
  assert.equal(v.reason, REASON_FLOOR)
  // 地板一开就放行。
  assert.equal(core.evaluate(minutesAfter(t1, 5)).reason, REASON_SALIENCE)
})

test('sidecar 缺席 fail-quiet：salienceOk=false、纯基线照常；健康只在翻转时报警一次', () => {
  const missing = join(tmp(), 'no-such.db')
  const log = alarmLog()
  const { core } = makeCore({ saliencePath: missing, alarm: log.alarm })
  core.evaluate(T0) // 播种；首次探测失败 = 一次翻转报警
  const v = core.evaluate(minutesAfter(T0, 5))
  assert.equal(v.wouldWake, true) // 基线不受影响
  assert.equal(v.salienceOk, false)
  core.evaluate(minutesAfter(T0, 6))
  core.evaluate(minutesAfter(T0, 7))
  assert.deepEqual(log.events, [['salience', { available: false }]]) // 翻转才落，不按 tick 刷屏
})

test('G-8(a)：state 文件损坏 → fail-closed 到默认拍 + 自愈 + 幂等报警', () => {
  const log = alarmLog()
  const { core, stateFile } = makeCore({ alarm: log.alarm })
  writeFileSync(stateFile, 'not json{{')
  const v = core.evaluate(T0)
  assert.equal(v.wouldWake, false, '不凭脏值起拍（fail-closed）')
  assert.equal(v.reason, REASON_FLOOR)
  assert.deepEqual(log.events, [['state_unparseable', {
    value: 'not json{{', healed_to: T0.toISOString(),
  }]])
  // 自愈：文件已重写为可解析值 → 新的进程（新 core）不再报警，默认基线拍照走。
  const log2 = alarmLog()
  const core2 = new HeartCore({ state: new FileHeartState(stateFile), alarm: log2.alarm })
  const healed = core2.evaluate(minutesAfter(T0, DEFAULT_BASELINE_MIN))
  assert.equal(healed.wouldWake, true)
  assert.equal(healed.reason, REASON_BASELINE)
  assert.deepEqual(log2.events, [], '自愈后的报警不重复（幂等）')
})

test('重启安全：影子钟+游标持久化 dev 路径；未来脏钟按「现在」处理（自愈同向）', () => {
  const db = makeSalienceDb()
  const { core, stateFile } = makeCore({ saliencePath: db })
  core.evaluate(T0) // 播种（开机态；游标此时对齐库尾）
  insertShadowRows(db, 3, 1)
  const t1 = minutesAfter(T0, 5)
  assert.equal(core.evaluate(t1).wouldWake, true) // 首拍消费游标
  const persisted = JSON.parse(readFileSync(stateFile, 'utf8')) as Record<string, unknown>
  assert.equal(persisted.last_beat_at, t1.toISOString())
  assert.equal(typeof persisted.cursor, 'number') // 游标随拍持久化
  // 重启（新 core 同一 state 文件）：老 selected 行不算新增，节律从上一拍续算。
  const core2 = new HeartCore({
    state: new FileHeartState(stateFile),
    salience: new SalienceReadSide(db),
  })
  const v = core2.evaluate(minutesAfter(t1, 6))
  assert.equal(v.wouldWake, false)
  assert.equal(v.salientNew, 0)
  // 未来时刻的 last_beat_at：按「现在」处理，不被坏时间戳冻死。
  writeFileSync(stateFile, JSON.stringify({
    last_beat_at: minutesAfter(T0, 9999).toISOString(), cursor: null,
  }))
  const core3 = new HeartCore({ state: new FileHeartState(stateFile) })
  const frozen = core3.evaluate(T0)
  assert.equal(frozen.wouldWake, false)
  assert.equal(frozen.reason, REASON_FLOOR) // 影子钟=现在 → 地板重新起算
  assert.equal(core3.evaluate(minutesAfter(T0, DEFAULT_BASELINE_MIN)).wouldWake, true)
})

test('G-2 结构钉死：心脏对 memory.db 零接触——import 面不含 lykoi-memory', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8',
  )
  const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
  assert.ok(specifiers.length > 0)
  for (const spec of specifiers) {
    assert.ok(!spec.includes('lykoi-memory'), `G-2: 心脏不得 import ${spec}`)
    assert.ok(!spec.includes('lykoi-decide'), 'G-2: 心脏不读决策层任何输入')
  }
})

test('插件面：tick 驱动 + claim 合并 {beats:N} 可观测 + 每拍落 audit 行（M1 语义沿用）', async () => {
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  const beats: HeartBeatPayload[] = []
  ctx.on('heart/beat', (payload) => beats.push(payload))

  const stateFile = join(tmp(), 'heart-state.json')
  // checkIntervalMs 拉大：测试全程不让真时钟定时器插进来，用显式 tick 驱动虚拟节律。
  const fiber = await ctx.plugin(heart, {
    checkIntervalMs: 3_600_000, stateFile, salienceDb: '',
  })
  const svc = ctx.get('heart') as HeartService

  assert.equal(svc.tick(T0).wouldWake, false) // 播种（开机态）
  assert.equal(svc.tick(minutesAfter(T0, 5)).wouldWake, true)
  assert.equal(svc.tick(minutesAfter(T0, 20)).wouldWake, false)
  assert.equal(svc.tick(minutesAfter(T0, 35)).wouldWake, true)
  assert.equal(svc.tick(minutesAfter(T0, 65)).wouldWake, true)

  assert.equal(svc.pending, 3)
  assert.deepEqual(svc.claim(), { beats: 3 }, 'tick 合并：错过 N 拍一次醒')
  assert.deepEqual(svc.claim(), { beats: 0 })

  for (let i = 0; i < 3; i++) {
    assert.equal(beats[i]!.pending, i + 1)
    assert.equal(beats[i]!.source, 'interval')
  }
  assert.equal(svc.nextAt, minutesAfter(T0, 95).toISOString())
  const auditBeats = audit.events.filter((e) => e.type === 'heart/beat')
  assert.equal(auditBeats.length, 3, '每拍恰好一行 audit')
  await fiber.dispose()
})

test('arouse：地板开着立即拍；关着被压下并落 heart/arouse_suppressed（G-8 对任何路径生效）', async () => {
  const ctx = new Context()
  const audit = fakeAudit()
  ctx.provide('audit', audit)
  const beats: HeartBeatPayload[] = []
  ctx.on('heart/beat', (payload) => beats.push(payload))

  const fiber = await ctx.plugin(heart, {
    checkIntervalMs: 3_600_000, stateFile: join(tmp(), 'heart-state.json'), salienceDb: '',
  })
  const svc = ctx.get('heart') as HeartService

  // 开机态：影子钟回拨（基线-地板）→ 地板已开 → arouse 立即拍。
  svc.arouse('salience-test')
  assert.equal(beats.length, 1)
  assert.equal(beats[0]!.source, 'arouse')
  assert.equal(beats[0]!.reason, 'salience-test')
  assert.deepEqual(svc.claim(), { beats: 1 })

  // 刚拍完（影子钟=刚才）→ 地板关着 → 压下，不 emit，落审计。
  svc.arouse('too-soon')
  assert.equal(beats.length, 1)
  assert.equal(svc.pending, 0)
  await new Promise((r) => setImmediate(r)) // 让 audit promise 落定
  const suppressed = audit.events.filter((e) => e.type === 'heart/arouse_suppressed')
  assert.equal(suppressed.length, 1)
  assert.equal(suppressed[0]!.reason, 'too-soon')
  await fiber.dispose()
})

test('fiber 卸载：服务注销、定时器停', async () => {
  const ctx = new Context()
  ctx.provide('audit', fakeAudit())
  const fiber = await ctx.plugin(heart, {
    checkIntervalMs: 3_600_000, stateFile: join(tmp(), 'heart-state.json'), salienceDb: '',
  })
  assert.ok(ctx.get('heart'))
  await fiber.dispose()
  assert.equal(ctx.get('heart'), undefined, '服务应随 fiber 注销')
})
