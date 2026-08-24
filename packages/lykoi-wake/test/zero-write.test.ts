/**
 * G-9（DA-10 定案）：并行推演不入 M2，但「推演零写入」断言 M2 起就立——
 * 学活体 tests/test_cb_deliberation_zero_write（§3.6）：
 * - 播种含一条 open 念头（charge 0.9）——"决定性的一条"：若推演内混进维护写，
 *   assemble 会给它再衰减一拍（UPDATE thoughts SET charge=…），正是断言要抓的写。
 * - 推演 = read → buildCandidates → buildMessages → evaluateMessage，全库逻辑
 *   摘要前后逐字节不变（SA-47）。
 * - 对照组（SA-48）：同一状态上再跑一次 maintain，摘要**必须**变——没有它，
 *   上面那条可能因播种不到位而假性通过。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCandidates, buildMessages, evaluateMessage, type SnapshotLike } from 'lykoi-decide'
import { assemble, maintain, read } from 'lykoi-snapshot'
import {
  T0, contemplateReply, logicalDigest, makeStore, stubMessageDeps, stubSnapshotDeps,
} from './fixture.ts'

test('推演零写入（SA-47）+ 对照组（SA-48）：read→candidates→messages→evaluate 全程零写', () => {
  const { store, path } = makeStore()
  const deps = stubSnapshotDeps()
  // 播种（spec §3.6 seeded_db 同构）：active 关切 + open 线 + 一条经验 + open 念头(0.9)。
  const cid = store.createConcern('interest', '词源学', {
    weight: 0.5, origin: 'seed', now: new Date(T0.getTime() - 3_600_000),
  })
  store.createConcern('project', '观察日志', {
    weight: 0.4, origin: 'grown', now: new Date(T0.getTime() - 3_600_000),
  }) // 第二条：地板 FLOOR_N=2 就位，maintain 不再造关切（隔离衰减这一条写）
  store.recordExperience('system', '播种经验', { now: new Date(T0.getTime() - 1_800_000) })
  store.createThought('还没想完的一条', 'intent', 'wake', {
    chargeHint: 0.9, now: new Date(T0.getTime() - 1_800_000),
  })
  // 步 0 对应：维护期先走一遍（之后的推演必须纯读）。
  assemble(store, deps, T0)

  const before = logicalDigest(path)
  const later = new Date(T0.getTime() + 60_000)
  const snap = read(store, deps, later)
  const snapLike = snap as unknown as SnapshotLike
  const candidates = buildCandidates(snapLike)
  const messages = buildMessages(snapLike, candidates, stubMessageDeps())
  const decision = evaluateMessage({ content: contemplateReply(cid, '词源学') }, candidates, {
    injectedThoughtIds: new Set(snap.念头.map((t) => t.id)),
    injectedConcernIds: new Set(snap.关切.map((c) => c.id)),
    injectedThreadIds: new Set(snap.叙事.线.map((t) => t.id)),
  })
  // "推演的输入必须非空,否则这条断言测的是空气"（活体断言原语义）。
  assert.ok(messages.length > 0 && candidates.length > 0)
  assert.equal(decision.kind, 'contemplate')
  assert.equal(decision.demoted, false)

  assert.equal(logicalDigest(path), before, 'SA-47：推演对状态层零写入')

  // SA-48 对照组：一次真实维护写后摘要必须变（念头衰减至少动 charge）。
  maintain(store, deps, new Date(T0.getTime() + 120_000))
  assert.notEqual(logicalDigest(path), before, 'SA-48：对照组——维护写必须可见')
})

test('同一时刻两次 read 逐字段相同 + 均零写（分发给 N 个分支的前提，DA-10 唯一前提）', () => {
  const { store, path } = makeStore()
  const deps = stubSnapshotDeps()
  store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: T0 })
  assemble(store, deps, T0)
  const before = logicalDigest(path)
  const at = new Date(T0.getTime() + 30_000)
  const a = read(store, deps, at)
  const b = read(store, deps, at)
  assert.deepEqual(a, b)
  assert.equal(logicalDigest(path), before)
})
