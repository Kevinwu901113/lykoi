/**
 * buildCandidates golden：三分支互斥（SA-06..08）、棘轮三条件（SA-09/10）、
 * 预算裁剪（SA-11/12）、权重与 cost/note 文案逐字含 CAUSES 插值（SA-05/13/14）、
 * KINDS 渲染序（SA-01）、G-6 不再另乘。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildCandidates } from '../src/index.ts'

interface SnapOpts {
  coherence?: number
  load?: number
  tension?: number
  hunger?: number
  hourly?: number
  notifs?: number
  proactive?: number | 'missing'
  explore?: { 断粮小时: number | null } | 'missing'
}

function snap(o: SnapOpts = {}): Record<string, unknown> {
  const budget: Record<string, number> = {
    本小时剩余行动数: o.hourly ?? 5,
    今日剩余通知数: o.notifs ?? 2,
  }
  if (o.proactive !== 'missing') budget['今日剩余主动开口数'] = o.proactive ?? 1
  const env: Record<string, unknown> = { 预算: budget }
  if (o.explore !== 'missing') env['探索'] = o.explore ?? { 断粮小时: 1.0 }
  return {
    调节场: {
      coherence: { value: o.coherence ?? 0.7 },
      load: { value: o.load ?? 0.2 },
      relational_tension: { value: o.tension ?? 0.3 },
      exploration_hunger: { value: o.hunger ?? 0.0 },
    },
    环境: env,
  }
}

test('正常分支满预算：7 候选按 KINDS 序；权重逐字（SA-01/05）', () => {
  const cands = buildCandidates(snap())
  assert.deepEqual(cands.map((c) => c.kind), [
    'explore', 'record_note', 'queue_notification', 'initiate_chat',
    'tend_inner', 'rest', 'contemplate',
  ])
  assert.deepEqual(cands.map((c) => c.weight), [0.5, 0.4, 0.3, 0.3, 0.4, 0.5, 0.4])
})

test('cost/note 文案逐字；explore/rest note 从 CAUSES 插值（SA-13/14）', () => {
  const byKind = new Map(buildCandidates(snap()).map((c) => [c.kind, c]))
  const explore = byKind.get('explore')!
  assert.equal(explore.cost, '消耗 1 行动预算;读 1 个公开网页(只读,与 Kevin 的浏览器隔离)')
  assert.equal(explore.note, '完成后 exploration_hunger -0.40;没有 url 的探索会扑空(记 failed)')
  assert.equal(byKind.get('record_note')!.cost, '内部动作,不消耗行动预算')
  assert.equal(byKind.get('record_note')!.note, '写入我的自主笔记(append-only)')
  assert.equal(byKind.get('queue_notification')!.cost, '消耗 1 行动预算 + 今日通知配额(剩 2)')
  assert.equal(byKind.get('queue_notification')!.note, 'Kevin 稍后会看到;受脑干上限约束(每日 ≤2)')
  assert.equal(
    byKind.get('initiate_chat')!.cost,
    '消耗 1 行动预算 + 今日主动开口份额(剩 1;日 1 条、冷却 6 小时,比通知更紧)',
  )
  assert.equal(
    byKind.get('initiate_chat')!.note,
    '在对话框里主动开口(kind=proactive):消息出现在与 Kevin 的对话里,不是手机通知;他打开对话就会看到',
  )
  assert.equal(byKind.get('tend_inner')!.cost, '内部动作,无外部副作用,不经 kernel')
  assert.equal(
    byKind.get('tend_inner')!.note,
    '三种形式:给一条线写进展(thread_id)/调整一条关切描述(concern_id)/给自己留 note(都不带)',
  )
  assert.equal(byKind.get('rest')!.cost, '0')
  // G-11（W3 落地）：旧文案 `load -0.10;按 next_wake_after_minutes 再醒(5-360 分钟)`
  // 含 G-2 死引用 + MIN/MAX_REST_MIN 手写副本；新文案从 CAUSES 表插值，节律归心脏。
  assert.equal(byKind.get('rest')!.note, 'load -0.10;下一拍由心脏节律决定')
  assert.equal(byKind.get('contemplate')!.cost, '内部动作,花一拍,无外部副作用')
  assert.equal(
    byKind.get('contemplate')!.note,
    '围绕快照中 Top 念头/关切的推进(新念头、resolve 既有念头、对一条 question 写部分回答)',
  )
})

test('force_inner_tending（coherence<0.4）：三内向候选、不看预算、tend +0.3（SA-07）', () => {
  const cands = buildCandidates(snap({ coherence: 0.3, hourly: 0, notifs: 0, proactive: 0 }))
  assert.deepEqual(cands.map((c) => c.kind), ['tend_inner', 'rest', 'contemplate'])
  assert.deepEqual(cands.map((c) => c.weight), [0.7, 0.5, 0.4])
})

test('force_inner 优先于 prefer_rest（SA-06 互斥）：双高时走 force 分支', () => {
  const cands = buildCandidates(snap({ coherence: 0.3, load: 0.8 }))
  assert.deepEqual(cands.map((c) => [c.kind, c.weight]), [
    ['tend_inner', 0.7], ['rest', 0.5], ['contemplate', 0.4], // rest 未 +0.2
  ])
})

test('prefer_rest（load>0.7）：三内向候选、rest +0.2、initiate 从不候选（SA-08）', () => {
  const cands = buildCandidates(snap({ load: 0.8, tension: 0.9 })) // tension 高也进不来
  assert.deepEqual(cands.map((c) => [c.kind, c.weight]), [
    ['tend_inner', 0.4], ['rest', 0.7], ['contemplate', 0.4],
  ])
})

test('探索饥饿棘轮：三条件全立才回菜单（SA-09），KINDS 序在前', () => {
  const base = { load: 0.8, hunger: 0.7, hourly: 2 }
  // 全立：断粮 30h
  assert.deepEqual(
    buildCandidates(snap({ ...base, explore: { 断粮小时: 30 } })).map((c) => c.kind),
    ['explore', 'tend_inner', 'rest', 'contemplate'],
  )
  // 从未完成过（null）也算断粮
  assert.deepEqual(
    buildCandidates(snap({ ...base, explore: { 断粮小时: null } })).map((c) => c.kind),
    ['explore', 'tend_inner', 'rest', 'contemplate'],
  )
  // 恰在阈值 24.0：>= 成立
  assert.ok(buildCandidates(snap({ ...base, explore: { 断粮小时: 24.0 } }))
    .some((c) => c.kind === 'explore'))
  // hunger 恰 0.6：严格大于不成立
  assert.ok(!buildCandidates(snap({ ...base, hunger: 0.6, explore: { 断粮小时: 30 } }))
    .some((c) => c.kind === 'explore'))
  // 断粮不足
  assert.ok(!buildCandidates(snap({ ...base, explore: { 断粮小时: 5 } }))
    .some((c) => c.kind === 'explore'))
  // 小时预算耗尽
  assert.ok(!buildCandidates(snap({ ...base, hourly: 0, explore: { 断粮小时: 30 } }))
    .some((c) => c.kind === 'explore'))
  // SA-10 fail-closed：探索块缺席 → 不凭缺失数据扩菜单
  assert.ok(!buildCandidates(snap({ ...base, explore: 'missing' }))
    .some((c) => c.kind === 'explore'))
  // 棘轮权重仍吃 hunger 加成
  const explore = buildCandidates(snap({ ...base, explore: { 断粮小时: 30 } }))
    .find((c) => c.kind === 'explore')!
  assert.equal(explore.weight, 0.7)
})

test('正常分支预算裁剪三条；安静四件套任何预算下不裁（SA-11/12）', () => {
  // hourly 0 → 去 explore/queue/initiate
  assert.deepEqual(
    buildCandidates(snap({ hourly: 0 })).map((c) => c.kind),
    ['record_note', 'tend_inner', 'rest', 'contemplate'],
  )
  // notifs 0 → 去 queue
  assert.deepEqual(
    buildCandidates(snap({ notifs: 0 })).map((c) => c.kind),
    ['explore', 'record_note', 'initiate_chat', 'tend_inner', 'rest', 'contemplate'],
  )
  // proactive 0 → 去 initiate
  assert.deepEqual(
    buildCandidates(snap({ proactive: 0 })).map((c) => c.kind),
    ['explore', 'record_note', 'queue_notification', 'tend_inner', 'rest', 'contemplate'],
  )
  // SA-12：旧快照缺"今日剩余主动开口数"键 → 0 → 不候选（fail-closed）
  assert.ok(!buildCandidates(snap({ proactive: 'missing' }))
    .some((c) => c.kind === 'initiate_chat'))
})

test('tension>0.6：queue/initiate 平权 +0.2；contact_note 与 initiate note 条件后缀（SA-14）', () => {
  const byKind = new Map(buildCandidates(snap({ tension: 0.7 })).map((c) => [c.kind, c]))
  assert.equal(byKind.get('queue_notification')!.weight, 0.5)
  assert.equal(byKind.get('initiate_chat')!.weight, 0.5)
  assert.equal(
    byKind.get('queue_notification')!.note,
    'Kevin 稍后会看到;受脑干上限约束(每日 ≤2);关系张力高,主动联系已解锁加成',
  )
  assert.ok(byKind.get('initiate_chat')!.note.endsWith(';关系张力高,主动联系已解锁加成'))
})

test('hunger>0.6：explore +0.2（正常分支）', () => {
  const explore = buildCandidates(snap({ hunger: 0.7 })).find((c) => c.kind === 'explore')!
  assert.equal(explore.weight, 0.7)
})

test('G-6：预算读数直读不再另乘（快照侧已折算）——同读数不同 load 下裁剪判定一致', () => {
  // hourly=1 时即便 load 正常，explore 仍在场；本层唯一消费点是 <=0 / >0 判定，
  // 折算责任在 lykoi-snapshot（G-6 落地点），此处只证明"不再另乘"：
  // 若本层再乘 0.5，floor(1*0.5)=0 会把 explore 裁掉。
  assert.ok(buildCandidates(snap({ hourly: 1 })).some((c) => c.kind === 'explore'))
})

test('契约破坏读点：缺预算键/缺调节场变量直接抛（SA-12 直取不 fail-closed）', () => {
  const s = snap()
  delete ((s.环境 as Record<string, unknown>).预算 as Record<string, unknown>)['本小时剩余行动数']
  assert.throws(() => buildCandidates(s), /missing '本小时剩余行动数'/)
  const s2 = snap()
  delete (s2.调节场 as Record<string, unknown>).exploration_hunger
  assert.throws(() => buildCandidates(s2), /missing 'exploration_hunger'/)
})
