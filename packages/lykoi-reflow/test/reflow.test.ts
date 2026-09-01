import test from 'node:test'
import assert from 'node:assert/strict'
import { executeAndReflow, lightGroundedConcerns, actionSummary, recordExperience } from '../src/index.ts'
import {
  T0, causeSequence, eventLog, fakeDispatch, freshCounts, makeDecision, makeStore, seedThread,
} from './fixture.ts'

const RUN = 'run-w3-test'

test('SA-52/65：不可移位三步 + 末尾恒 action_result；两条经验共用 primary（首个点亮的关切）', async () => {
  const { store } = makeStore()
  const c1 = store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: T0 })
  const c2 = store.createConcern('project', '观察日志', { weight: 0.4, origin: 'grown', now: T0 })
  const decision = makeDecision({ kind: 'rest', grounded_concern_ids: [c1, c2, c1] })
  const status = await executeAndReflow(decision, RUN, freshCounts(), {
    store, dispatchFn: fakeDispatch(), now: T0,
  })
  assert.equal(status, 'completed')
  const recent = store.recentExperiences(2)
  assert.equal(recent[0]!.source, 'action_result')
  assert.equal(recent[0]!.content, 'rest:这一拍我休息,load 泄压')
  assert.equal(recent[1]!.source, 'wake_action')
  assert.equal(recent[1]!.content, '[rest]')
  // 去重保序（SA-64）：primary = lit[0] = c1，两条经验同挂。
  assert.equal(recent[0]!.relatedConcernId, c1)
  assert.equal(recent[1]!.relatedConcernId, c1)
  // SA-53 + SA-54 + SA-66：cause 时间线 —— 每条经验必发 experience_recorded；
  // rest → rested；lit 且 rest → concern_lit_unfollowed。
  assert.deepEqual(causeSequence(store), [
    'experience_recorded', 'rested', 'concern_lit_unfollowed', 'experience_recorded',
  ])
})

test('SA-53：recordExperience 是 Phase-2 唯一写入点——每条经验必发 experience_recorded', () => {
  const { store } = makeStore()
  const id = recordExperience(store, 'system', '一条系统经验', { now: T0 })
  assert.ok(id >= 1)
  assert.deepEqual(causeSequence(store), ['experience_recorded'])
})

test('SA-55：_action_summary 模板逐字（降级注记 + url + clip120 + 理由）', () => {
  const longContent = '长'.repeat(130)
  const d = makeDecision({
    kind: 'rest', demoted: true, original_kind: 'queue_notification',
    demote_why: 'reason_not_grounded', url: 'https://example.org/a',
    content: longContent, reason: '  想说话  ',
  })
  assert.equal(
    actionSummary(d),
    `[rest] (由 queue_notification 降级:reason_not_grounded) https://example.org/a ${'长'.repeat(120)}… 理由:想说话`,
  )
})

test('SA-54：contemplate/record_note/tend_inner 也计 action_taken（向内也花一拍）', async () => {
  const { store } = makeStore()
  const status = await executeAndReflow(
    makeDecision({ kind: 'contemplate' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(causeSequence(store), [
    'experience_recorded', 'action_taken', 'experience_recorded',
  ])
})

test('SA-60：contemplate 执行体为空——零 dispatch、零 counts、result 逐字', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch()
  const counts = freshCounts()
  await executeAndReflow(makeDecision({ kind: 'contemplate' }), RUN, counts, {
    store, dispatchFn: dispatch, now: T0,
  })
  assert.equal(dispatch.calls.length, 0)
  assert.deepEqual(counts, { action: 0, external_read: 0, notification: 0 })
  assert.equal(store.recentExperiences(1)[0]!.content, 'contemplate 完成:向内的一拍,没有对外发声')
})

test('record_note：写入自主笔记 + result 带 note id；无 try/except（异常冒泡=契约破坏）', async () => {
  const { store, path } = makeStore()
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'record_note', content: '  今天想到的一件事  ' }), RUN, counts,
    { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(counts, { action: 0, external_read: 0, notification: 0 })
  const { rawOpen } = await import('./fixture.ts')
  const db = rawOpen(path)
  try {
    const row = { ...db.prepare('SELECT autonomy_run_id, kind, content, source_type FROM autonomy_notes').get() as
      Record<string, unknown> }
    assert.deepEqual(row, {
      autonomy_run_id: RUN, kind: 'reflection', content: '今天想到的一件事', source_type: 'internal',
    })
    assert.equal(store.recentExperiences(1)[0]!.content, `record_note 完成:写下了笔记 #${1}`)
  } finally {
    db.close()
  }
})

test('SA-63：tend_inner 三形式按 thread_id → concern_id → note 优先级；恒发 mind_tend_inner 带 form', async () => {
  const { store, path } = makeStore()
  const tid = seedThread(path, '一条开放线')
  const cid = store.createConcern('question', '为什么是这样', { weight: 0.5, origin: 'grown', now: T0 })

  // 形式①：thread_id 优先（即使 concern_id 同在）。
  let log = eventLog()
  await executeAndReflow(
    makeDecision({ kind: 'tend_inner', thread_id: tid, concern_id: cid, content: '有一点进展' }),
    RUN, freshCounts(), { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
  )
  assert.equal(store.recentExperiences(1)[0]!.content, `tend_inner 完成:给叙事线 #${tid} 写了一句进展`)
  assert.deepEqual(log.events, [['mind_tend_inner', { run_id: RUN, form: 'thread_progress' }]])
  assert.match(store.listThreads()[0]!.content, /\n\[2026-08-24\] 有一点进展$/)

  // 形式②：仅 concern_id。
  log = eventLog()
  await executeAndReflow(
    makeDecision({ kind: 'tend_inner', concern_id: cid, content: '新的描述' }),
    RUN, freshCounts(), { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
  )
  assert.equal(store.recentExperiences(1)[0]!.content, `tend_inner 完成:调整了关切 #${cid} 的描述`)
  assert.deepEqual(log.events, [['mind_tend_inner', { run_id: RUN, form: 'concern_description' }]])

  // 形式③：都不带 → note to self。
  log = eventLog()
  await executeAndReflow(
    makeDecision({ kind: 'tend_inner', content: '给自己的一句话' }),
    RUN, freshCounts(), { store, dispatchFn: fakeDispatch(), now: T0, logEvent: log.logEvent },
  )
  assert.match(store.recentExperiences(1)[0]!.content, /^tend_inner 完成:给自己留了一条 note\(#\d+\)$/)
  assert.deepEqual(log.events, [['mind_tend_inner', { run_id: RUN, form: 'note_to_self' }]])
})

test('tend_inner：语义拒绝（ValueError）→ 本拍 failed + result 带原因；action_result 仍写', async () => {
  const { store, path } = makeStore()
  const tid = seedThread(path, '已了结的线', 'resolved')
  const status = await executeAndReflow(
    makeDecision({ kind: 'tend_inner', thread_id: tid, content: '想追加' }),
    RUN, freshCounts(), { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.equal(status, 'failed')
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    `tend_inner 失败:thread ${tid} is resolved; only open/suspended can be tended`,
  )
})

test('SA-58：无 url 的 explore = failed + 扑空经验；零 counts、零 dispatch', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch()
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'explore' }), RUN, counts,
    { store, dispatchFn: dispatch, now: T0 },
  )
  assert.equal(status, 'failed')
  assert.equal(dispatch.calls.length, 0)
  assert.deepEqual(counts, { action: 0, external_read: 0, notification: 0 })
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'explore 扑空:想去看看,但没有起点 url,什么都没读到',
  )
})

test('SA-56/57/59：explore 成功——counts 双 +1、hunger 泄压、result 文案（字数按码点）', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch({ success: true, data: { text: '网页正文一共十个字。' } })
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'explore', url: 'https://example.org/x' }), RUN, counts,
    { store, dispatchFn: dispatch, now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(dispatch.calls, [{
    actionType: 'research_browser.read_text', params: { url: 'https://example.org/x' }, runId: RUN,
  }])
  assert.deepEqual(counts, { action: 1, external_read: 1, notification: 0 })
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'explore 完成:读了 https://example.org/x(约 10 字),探索饥饿泄压',
  )
  assert.ok(causeSequence(store).includes('explore_completed'))
})

test('SA-57/59：explore 失败——counts 仍无条件 +1（她试了一次），hunger 不泄压', async () => {
  const { store } = makeStore()
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'explore', url: 'https://example.org/x' }), RUN, counts,
    { store, dispatchFn: fakeDispatch({ success: false, error: '超时' }), now: T0 },
  )
  assert.equal(status, 'failed')
  assert.deepEqual(counts, { action: 1, external_read: 1, notification: 0 })
  assert.equal(store.recentExperiences(1)[0]!.content, 'explore 失败:超时')
  assert.ok(!causeSequence(store).includes('explore_completed'))
})

test('explore 失败无 error 字段 → 回退文案「没有读到内容」', async () => {
  const { store } = makeStore()
  await executeAndReflow(
    makeDecision({ kind: 'explore', url: 'https://example.org/x' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch({ success: false }), now: T0 },
  )
  assert.equal(store.recentExperiences(1)[0]!.content, 'explore 失败:没有读到内容')
})

test('SA-61/57：initiate_chat 入队——result 只报"已交给投递"（不许诺送达）；action +1、notification 不动', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch({ success: true, data: { queued: true } })
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'initiate_chat', content: ' 在吗 ' }), RUN, counts,
    { store, dispatchFn: dispatch, now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(dispatch.calls, [{
    actionType: 'autonomy.initiate_chat', params: { content: '在吗', run_id: RUN }, runId: RUN,
  }])
  assert.deepEqual(counts, { action: 1, external_read: 0, notification: 0 })
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'initiate_chat 完成:主动开了口,已交给投递;送达与否之后会回到你的经验里',
  )
})

test('SA-62：initiate_chat 被脑干拦下 = 结果非异常（status 仍 completed）；失败才 failed', async () => {
  const { store } = makeStore()
  const counts = freshCounts()
  let status = await executeAndReflow(
    makeDecision({ kind: 'initiate_chat', content: '在吗' }), RUN, counts,
    { store, dispatchFn: fakeDispatch({ success: true, data: { queued: false, reason: 'daily_cap' } }), now: T0 },
  )
  assert.equal(status, 'completed')
  assert.equal(counts.action, 1)
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'initiate_chat 被脑干拦下(daily_cap):主动开口的份额还没回来',
  )
  status = await executeAndReflow(
    makeDecision({ kind: 'initiate_chat', content: '在吗' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch({ success: false, error: '投递失败' }), now: T0 },
  )
  assert.equal(status, 'failed')
  assert.equal(store.recentExperiences(1)[0]!.content, 'initiate_chat 失败:投递失败')
})

test('SA-57/62：queue_notification 显式分支——入队 notification +1；拦下文案逐字；失败 failed', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch({ success: true, data: { queued: true } })
  const counts = freshCounts()
  let status = await executeAndReflow(
    makeDecision({ kind: 'queue_notification', content: '留个话' }), RUN, counts,
    { store, dispatchFn: dispatch, now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(dispatch.calls, [{
    actionType: 'autonomy.queue_notification', params: { summary: '留个话', run_id: RUN }, runId: RUN,
  }])
  assert.deepEqual(counts, { action: 1, external_read: 0, notification: 1 })
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'queue_notification 完成:留了话给 Kevin,等他回应',
  )

  const counts2 = freshCounts()
  status = await executeAndReflow(
    makeDecision({ kind: 'queue_notification', content: '再留一个' }), RUN, counts2,
    { store, dispatchFn: fakeDispatch({ success: true, data: { queued: false, reason: 'daily_cap' } }), now: T0 },
  )
  assert.equal(status, 'completed')
  assert.deepEqual(counts2, { action: 1, external_read: 0, notification: 0 })
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    'queue_notification 被脑干拦下(daily_cap):今天对他说得够多了',
  )

  status = await executeAndReflow(
    makeDecision({ kind: 'queue_notification', content: '又一个' }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch({ success: false, error: '队列写失败' }), now: T0 },
  )
  assert.equal(status, 'failed')
  assert.equal(store.recentExperiences(1)[0]!.content, 'queue_notification 失败:队列写失败')
})

test('G-1：未知 kind → 落审计 unknown_decision_kind + failed，零 dispatch——永不默默变成通知', async () => {
  const { store } = makeStore()
  const dispatch = fakeDispatch()
  const log = eventLog()
  const counts = freshCounts()
  const status = await executeAndReflow(
    makeDecision({ kind: 'daydream', content: '一个未来才有的 kind' }), RUN, counts,
    { store, dispatchFn: dispatch, now: T0, logEvent: log.logEvent },
  )
  assert.equal(status, 'failed')
  assert.equal(dispatch.calls.length, 0, '未知 kind 不许流向任何 kernel 通道')
  assert.deepEqual(counts, { action: 0, external_read: 0, notification: 0 })
  // WO-U2-SENSE-01：原账在前（逐字节不变），capability_gap 旁路补一笔。
  assert.deepEqual(log.events, [
    ['unknown_decision_kind', { run_id: RUN, kind: 'daydream' }],
    ['capability_gap', {
      wanted: 'daydream', source: 'wake', run_id: RUN, reason: 'no_execution_branch',
    }],
  ])
  assert.equal(
    store.recentExperiences(1)[0]!.content,
    '未知 kind(daydream):reflow 没有它的执行分支,这一拍记 failed',
  )
})

test('SA-64：LIVE active 二次闸——dimming 不点亮（落 grounding_concern_out_of_snapshot）；ValueError 只 log 不杀拍', async () => {
  const { store, path } = makeStore()
  const active = store.createConcern('interest', '活着的', { weight: 0.5, origin: 'seed', now: T0 })
  const dimming = store.createConcern('interest', '变暗的', { weight: 0.5, origin: 'seed', now: T0 })
  const db = (await import('./fixture.ts')).rawOpen(path)
  try {
    db.prepare("UPDATE concerns SET status = 'dimming' WHERE id = ?").run(dimming)
  } finally {
    db.close()
  }
  // 闸后再抛 ValueError 的路径：用代理 store 让 lightConcern 对 active id 拒绝一次。
  const log = eventLog()
  const proxied = new Proxy(store, {
    get(target, prop, receiver) {
      if (prop === 'lightConcern') {
        return () => {
          const err = new Error(`no concern ${active}`)
          err.name = 'ValueError'
          throw err
        }
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  })
  const lit = lightGroundedConcerns(
    makeDecision({ grounded_concern_ids: [dimming, active] }),
    { store: proxied, now: T0, logEvent: log.logEvent },
  )
  assert.deepEqual(lit, [])
  assert.deepEqual(log.events, [
    ['grounding_concern_out_of_snapshot', { concern_id: dimming, where: 'reflow' }],
    ['mind_light_skipped', { concern_id: active, error: `no concern ${active}` }],
  ])
})

test('SA-64：发光的实际效果（weight +0.05 / lit_count+1 / last_lit_at）', () => {
  const { store } = makeStore()
  const id = store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: T0 })
  const lit = lightGroundedConcerns(makeDecision({ grounded_concern_ids: [id] }), { store, now: T0 })
  assert.deepEqual(lit, [id])
  const row = store.listConcerns('active').find((c) => c.id === id)!
  assert.equal(row.weight, 0.5 + 0.05) // IEEE 原样（Python store 同样不 round）
  assert.equal(row.litCount, 1)
  assert.ok(row.lastLitAt)
})

test('SA-66/G-5：lit + contemplate/tend_inner **不**记 concern_lit_unfollowed（维持现状，治理定案）', async () => {
  const { store } = makeStore()
  const id = store.createConcern('interest', '词源学', { weight: 0.5, origin: 'seed', now: T0 })
  await executeAndReflow(
    makeDecision({ kind: 'contemplate', grounded_concern_ids: [id] }), RUN, freshCounts(),
    { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.ok(!causeSequence(store).includes('concern_lit_unfollowed'))
  // record_note 则记（lit 且 kind ∈ {rest, record_note}）。
  await executeAndReflow(
    makeDecision({ kind: 'record_note', content: '记一笔', grounded_concern_ids: [id] }),
    RUN, freshCounts(), { store, dispatchFn: fakeDispatch(), now: T0 },
  )
  assert.ok(causeSequence(store).includes('concern_lit_unfollowed'))
})
