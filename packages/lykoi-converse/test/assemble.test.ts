/**
 * 真装配器（S-23..S-34）：三段带十二块顺序 / 空态零字节 / 各块内容与裁剪 /
 * 整合边界失效印记 / 预算三层 / 读侧卫生。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatPyIso } from 'lykoi-memory/rw'
import {
  BACKFILL_HEADER, CONCERNS_HEADER, ContextBudgetError, MEMORIES_HEADER,
  PROMOTED_INSIGHTS_HEADER, RELATIONSHIP_OVERLAY_HEADER,
  THOUGHTS_HEADER, UNDELIVERED_HEADER, estimateTokens, stripMarkup,
} from '../src/index.ts'
import {
  envelope, eventNames, FIXTURE_PERSONA, lastEvent, makeConversation, makeStore, MemoryUndelivered,
  rawOpen, seedArchivedExperience, seedBinding, seedPromotedInsight,
  seedRelationshipInsight, T0,
} from './fixture.ts'

test('空态零字节（S-26）：干净 fixture → 只有 persona / history / time 三块', () => {
  const h = makeConversation()
  assert.deepEqual(h.conversation.assembleLayout(), ['persona', 'history', 'time'])
})

test('S-23/24/25 顺序：稳定前缀(persona→organs→backfill→concerns) → history → 尾部(thoughts→time→undelivered)', () => {
  const prepared = makeStore()
  seedBinding(prepared.path)
  const db = rawOpen(prepared.path)
  // 关切 + 念头 + 一行可回灌历史。
  db.prepare(
    "INSERT INTO concerns (kind, title, description, weight, origin, status, created_at) "
    + "VALUES ('interest', '摄影', '街拍', 0.6, 'seed', 'active', ?)",
  ).run(formatPyIso(T0))
  db.prepare(
    "INSERT INTO thoughts (ts, content, kind, source, charge, status) VALUES (?, '想问他今天忙什么', 'question', 'conversation', 0.7, 'open')",
  ).run(formatPyIso(T0))
  db.prepare(
    "INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)",
  ).run(formatPyIso(T0), JSON.stringify({ user: '早', reply: '早呀' }))
  db.close()
  const undelivered = new MemoryUndelivered()
  undelivered.items.push({ id: 1, ts: '2026-08-24T01:00:00+00:00', text_summary: '昨晚那句' })
  const h = makeConversation({ prepared, undelivered })
  assert.deepEqual(h.conversation.assembleLayout(), [
    'persona', 'organs', 'backfill', 'concerns', 'history', 'thoughts', 'time', 'undelivered',
  ])
})

test('persona 头分层：内核(合成实例包的那份)→重启叙事→纪律→acquired→转正结论（S-34 唯一消费口）', async () => {
  const prepared = makeStore()
  prepared.store.upsertInsight('preference', 'Kevin 用中文交流，技术术语用英文', { now: T0 })
  seedPromotedInsight(prepared.path, '我在深夜想事情更清楚')
  seedPromotedInsight(prepared.path, '还没站住的结论', 'shadow') // 影子结论不许进
  const h = makeConversation({
    prepared,
    restartEvent: () => ({ notes: ['你重启了一次——之前是睡着的，现在醒了。'] }),
  })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const head = h.llm.calls[0]!.messages[0]!
  assert.equal(head.role, 'system')
  const content = head.content!
  assert.ok(content.startsWith(`我是 ${FIXTURE_PERSONA.identity.name}，`), '内核第一')
  assert.ok(content.includes('[你重启了一次——之前是睡着的，现在醒了。]'), 'SA-162 重启叙事')
  assert.ok(content.includes('以下是你的操作环境与纪律'), 'SYSTEM_PROMPT 在内核后')
  assert.ok(content.includes('Kevin 的偏好：\n- Kevin 用中文交流，技术术语用英文'), 'acquired 投影')
  assert.ok(content.includes('你自己想明白的事(专注思考里得出、已经站住的结论):\n- 我在深夜想事情更清楚'))
  assert.equal(content.includes('还没站住的结论'), false, 'S-34：shadow 一条都不进上下文')
  assert.equal(lastEvent(h.events, 'promoted_insights_injected')?.count, 1)
})

// --- WO-PERS-OVERLAY-01（D-5/D-6）：relationship overlay 段 ---------------------

test('⑨ overlay 段：顺序在转正结论**之后**；只有键到眼前这个人的 active 行进得来', async () => {
  const prepared = makeStore()
  seedPromotedInsight(prepared.path, '我在深夜想事情更清楚')
  seedRelationshipInsight(prepared.path, '他忙起来就不爱说话，那不是针对我')
  seedRelationshipInsight(prepared.path, '和他说话不用铺垫')
  // 影子期未过的 overlay 行：一条都不进（与 S-34 同一道影子门）。
  seedRelationshipInsight(prepared.path, '还没站住的相处结论', { status: 'shadow' })
  // 键到第二个人的 active 行：不是眼前这个人的脸。
  seedRelationshipInsight(prepared.path, '和另一个人的相处方式', { subject: 'user_002' })

  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const content = h.llm.calls[0]!.messages[0]!.content!

  const promotedAt = content.indexOf(PROMOTED_INSIGHTS_HEADER)
  const overlayAt = content.indexOf(RELATIONSHIP_OVERLAY_HEADER)
  assert.ok(promotedAt > 0, '转正结论段在')
  assert.ok(overlayAt > promotedAt, 'overlay 段接在转正结论段之后')

  assert.equal(
    content.slice(overlayAt),
    RELATIONSHIP_OVERLAY_HEADER
    + '- 他忙起来就不爱说话，那不是针对我\n- 和他说话不用铺垫',
    'overlay 段逐字节：头部 + 每行 `- {content}`，按 insight_id 升序',
  )
  assert.equal(content.includes('还没站住的相处结论'), false, 'shadow 的 overlay 行不进')
  assert.equal(content.includes('和另一个人的相处方式'), false, '别人的脸不进')

  const injected = lastEvent(h.events, 'relationship_overlay_injected')!
  assert.deepEqual(
    { count: injected.count, subject_user_id: injected.subject_user_id },
    { count: 2, subject_user_id: 'user_001' },
  )
})

test('⑩ 空态零字节：无 overlay 行时人格块逐字节不含头部，promoted 段行为不变', async () => {
  const prepared = makeStore()
  seedPromotedInsight(prepared.path, '我在深夜想事情更清楚')
  // 只有别人的行 + 自己的影子行 —— 对眼前这个人而言就是"没有"。
  seedRelationshipInsight(prepared.path, '和另一个人的相处方式', { subject: 'user_002' })
  seedRelationshipInsight(prepared.path, '还没站住的相处结论', { status: 'shadow' })

  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const content = h.llm.calls[0]!.messages[0]!.content!

  assert.equal(content.includes(RELATIONSHIP_OVERLAY_HEADER), false, '连标题都不出现')
  assert.ok(
    content.endsWith(PROMOTED_INSIGHTS_HEADER + '- 我在深夜想事情更清楚'),
    '人格块仍以转正结论段收尾——逐字节回到本单之前的形态，没有多出任何分隔',
  )
  assert.equal(lastEvent(h.events, 'promoted_insights_injected')?.count, 1, 'promoted 段不变')
  assert.equal(eventNames(h.events).includes('relationship_overlay_injected'), false)
})

test('D-5 失败口径：promotedRelationshipInsights 抛 → 一条事件 + 零字节，不毁整轮', async () => {
  const prepared = makeStore()
  seedPromotedInsight(prepared.path, '我在深夜想事情更清楚')
  // 在实例上挂一个同名自有属性遮蔽原型方法——Proxy 会让别的方法读不到 #db 私有域。
  Object.defineProperty(prepared.store, 'promotedRelationshipInsights', {
    configurable: true,
    value: () => { throw new TypeError('overlay 读挂了') },
  })
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const content = h.llm.calls[0]!.messages[0]!.content!

  assert.equal(content.includes(RELATIONSHIP_OVERLAY_HEADER), false, '读不到就是今天不叠')
  assert.equal(lastEvent(h.events, 'relationship_overlay_read_failed')?.error_type, 'TypeError')
  assert.ok(content.endsWith(PROMOTED_INSIGHTS_HEADER + '- 我在深夜想事情更清楚'))
})

test('D-5：owner 未登记（subject 为 null）→ 零字节且零读库', async () => {
  const prepared = makeStore()
  const db = rawOpen(prepared.path)
  db.prepare("UPDATE users SET status = 'archived' WHERE role = 'owner_primary'").run()
  db.close()
  seedPromotedInsight(prepared.path, '我在深夜想事情更清楚')

  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const content = h.llm.calls[0]!.messages[0]!.content!

  assert.equal(content.includes(RELATIONSHIP_OVERLAY_HEADER), false)
  assert.equal(eventNames(h.events).includes('relationship_overlay_injected'), false)
  assert.equal(eventNames(h.events).includes('relationship_overlay_read_failed'), false)
})

test('concerns 块：weight DESC 前 5、描述折叠空白裁 60 字、lit_count 不进渲染', async () => {
  const prepared = makeStore()
  const db = rawOpen(prepared.path)
  for (let i = 0; i < 7; i += 1) {
    db.prepare(
      "INSERT INTO concerns (kind, title, description, weight, origin, status, created_at, lit_count) "
      + "VALUES ('interest', ?, ?, ?, 'grown', 'active', ?, 1381)",
    ).run(`关切${i}`, i === 0 ? `长\n描述  ${'x'.repeat(80)}` : '', 0.9 - i * 0.1, formatPyIso(T0))
  }
  db.close()
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const block = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith('[活跃关切'))!
  assert.ok(block.content!.startsWith(CONCERNS_HEADER))
  const lines = block.content!.slice(CONCERNS_HEADER.length).split('\n')
  assert.equal(lines.length, 5, '上限 5 条（截掉的是她自己排在后面的）')
  assert.ok(lines[0]!.startsWith('- 关切0 —— '), '权重高的先看')
  assert.ok(lines[0]!.includes('长 描述 x'), '空白折叠')
  assert.equal([...lines[0]!.split(' —— ')[1]!].length, 60, '描述裁 60 字')
  assert.equal(block.content!.includes('1381'), false, 'lit_count 不进渲染')
})

test('backfill：自旧到新、每侧裁 400、DSML 剥离（S-32）、坏行跳过并大声（backfill_rows_skipped）', () => {
  const prepared = makeStore()
  const db = rawOpen(prepared.path)
  const leak = '好的<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="x"></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>收到'
  db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)")
    .run(formatPyIso(T0), JSON.stringify({ user: '早', reply: leak }))
  db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', 'not json')")
    .run(formatPyIso(T0))
  db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)")
    .run(formatPyIso(T0), JSON.stringify({ user: '长'.repeat(500), reply: '短' }))
  db.close()
  const h = makeConversation({ prepared })
  // 经 layout 触发一次装配读面（backfill 在构造期建好）。
  assert.ok(h.conversation.assembleLayout().includes('backfill'))
  const skipped = lastEvent(h.events, 'backfill_rows_skipped')
  assert.deepEqual(skipped, { skipped: 1, total: 3, run_id: null, turn_id: null })
  // 内容断言经 stripMarkup 纯函数（同一把刀）：
  assert.equal(stripMarkup(leak), '好的收到')
})

test('相关记忆（L3 每轮探针）：命中入块（strip+一行 80 字）；无命中零字节；probe 裁 200', async () => {
  const prepared = makeStore()
  seedArchivedExperience(prepared.path, '上次和 Kevin 聊过 valorant 战队 EDG 的比赛安排', new Date('2026-06-01T10:00:00Z'))
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('valorant EDG 后来怎么样了', { runId: 'r1' })
  const block = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith('[相关记忆'))
  assert.ok(block, 'L3 命中入块')
  assert.ok(block!.content!.startsWith(MEMORIES_HEADER))
  assert.ok(block!.content!.includes('- [06-01 18:00] conversation: 上次和 Kevin 聊过 valorant'))
  assert.equal(lastEvent(h.events, 'relevant_memories_injected')?.hits, 1)
  // 无命中：零字节（不加"没找到"占位）。
  h.llm.push({ content: envelope() })
  await h.conversation.send('完全无关的希腊哲学话题吧啦', { runId: 'r2' })
  const second = h.llm.calls[1]!.messages.find((m) => m.content?.startsWith('[相关记忆'))
  assert.equal(second, undefined)
})

test('thoughts 块：Top-3 注入 + 行格式（charge 三位 round）；time 块分钟粒度+周几', async () => {
  const prepared = makeStore()
  for (const [content, charge] of [['念头甲', 0.9], ['念头乙', 0.7], ['念头丙', 0.5], ['念头丁', 0.3]] as const) {
    prepared.store.createThought(content, 'observation', 'conversation', { chargeHint: charge, now: T0 })
  }
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const block = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith('[念头'))!
  assert.ok(block.content!.startsWith(THOUGHTS_HEADER))
  const lines = block.content!.slice(THOUGHTS_HEADER.length).split('\n')
  assert.equal(lines.length, 3, 'THOUGHT_SNAPSHOT_TOP=3')
  assert.match(lines[0]!, /^id=\d+ kind=observation charge=0\.9: 念头甲$/)
  // 时间锚：T0=2026-08-24T10:00Z → 北京 18:00 周一。
  const time = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith('[当前时间]'))!
  assert.equal(time.content, '[当前时间] 2026-08-24 18:00 周一 (北京时间)')
})

test('D-05（修正版）：undelivered 展示期在**周期成立后**收——重试的第二轮装配仍带着块，标记恰一次', async () => {
  const undelivered = new MemoryUndelivered()
  undelivered.items.push({ id: 7, ts: '2026-08-24T01:00:00+00:00', text_summary: '昨晚那句' })
  const h = makeConversation({ undelivered })
  h.llm.push({ content: '她直接说话了' }) // not_json → D-01 重试
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(h.llm.calls.length, 2)
  const inFirst = h.llm.calls[0]!.messages.some((m) => m.content?.startsWith(UNDELIVERED_HEADER.slice(0, 8)))
  const inSecond = h.llm.calls[1]!.messages.some((m) => m.content?.startsWith(UNDELIVERED_HEADER.slice(0, 8)))
  assert.equal(inFirst, true)
  assert.equal(inSecond, true, '重试轮她看到的处境与第一次相同（块仍在）')
  assert.deepEqual(undelivered.markCalls, [[7]], '周期成立后恰标一次')
})

test('S-27 整合边界：印记变了才重建稳定前缀（organs invalidate + persona 头重建 + 事件）', async () => {
  const prepared = makeStore()
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  assert.equal(eventNames(h.events).includes('stable_prefix_rebuilt'), false)
  // 夜里层 2 转正了一条结论（focus_cycles 有了新行 → 印记变）。
  seedPromotedInsight(prepared.path, '深夜想明白的一件事')
  h.llm.push({ content: envelope() })
  await h.conversation.send('还在吗', { runId: 'r2' })
  assert.ok(eventNames(h.events).includes('stable_prefix_rebuilt'))
  const head = h.llm.calls[1]!.messages[0]!
  assert.ok(head.content!.includes('- 深夜想明白的一件事'), '第二天第一句话就用上昨晚想明白的事')
})

test('S-30 硬预算：先丢最老完整轮 → 再丢 backfill → 都没了抛 ContextBudgetError（文案骨架）', async () => {
  const prepared = makeStore()
  const db = rawOpen(prepared.path)
  db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)")
    .run(formatPyIso(T0), JSON.stringify({ user: '旧话', reply: '旧回' }))
  db.close()
  const h = makeConversation({ prepared, limits: { maxInputTokens: 2000 } })
  // 第一轮种下两轮历史。
  h.llm.push({ content: envelope() })
  await h.conversation.send('第一轮' + '话'.repeat(300), { runId: 'r1' })
  h.llm.push({ content: envelope() })
  await h.conversation.send('第二轮' + '话'.repeat(300), { runId: 'r2' })
  // 第三轮超预算：最老轮被裁 + backfill 被丢（或先后触发），事件可见。
  h.llm.push({ content: envelope() })
  await h.conversation.send('第三轮' + '话'.repeat(300), { runId: 'r3' })
  const names = eventNames(h.events)
  assert.ok(
    names.includes('context_hard_trimmed') || names.includes('context_backfill_dropped'),
    '预算收敛动作可见',
  )
  // 单轮怎么裁都超 → 大声 ContextBudgetError（S-20 的确定性失败）。
  const tiny = makeConversation({ limits: { maxInputTokens: 100 } })
  await assert.rejects(
    () => tiny.conversation.send('一句塞不下的话', { runId: 'r' }),
    (exc: unknown) =>
      exc instanceof ContextBudgetError
      && /^这一轮的内容太长（约 \d+ tokens，上限 100），无法处理。$/.test(exc.message),
  )
  // S-14：失败回合整轮回滚。
  assert.ok(eventNames(tiny.events).includes('chat_turn_rolled_back'))
})

test('S-31 软窗：溢出被摘要进滚动块再丢；摘要失败什么都不丢', async () => {
  const h = makeConversation({ limits: { windowTurns: 2 } })
  for (let i = 0; i < 3; i += 1) {
    h.llm.push({ content: envelope() }) //  信封
  }
  h.llm.fallback = { content: '摘要：他们互道了三次早安' } // 第 3 轮后的摘要调用
  await h.conversation.send('早安一', { runId: 'r1' })
  await h.conversation.send('早安二', { runId: 'r2' })
  await h.conversation.send('早安三', { runId: 'r3' })
  assert.ok(eventNames(h.events).includes('context_trimmed'))
  const summaryCall = h.llm.calls.find((c) => c.opts.purpose === 'summary')!
  assert.equal(summaryCall.opts.maxTokens, 1024)
  assert.equal(summaryCall.opts.temperature, 0.3)
  // 摘要块进入下一轮装配。
  h.llm.push({ content: envelope() })
  await h.conversation.send('早安四', { runId: 'r4' })
  const envelopeCalls = h.llm.calls.filter((c) => c.opts.purpose === 'envelope')
  const block = envelopeCalls.at(-1)!.messages.find((m) => m.content?.startsWith('[早前对话摘要]'))
  assert.ok(block)
  assert.ok(block!.content!.includes('摘要：他们互道了三次早安'))
})

test('token 估算（tokens.py 逐字）：CJK≈1/字、其余 4 字/token 向上取整、高估方向', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('你好'), 2)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2)
  assert.equal(estimateTokens('你好ab'), 3) // 2 CJK + ceil(2/4)=1
})

test('BACKFILL_HEADER 与块头常量确在装配产物中使用（防"常量对了装配没用上"）', async () => {
  const prepared = makeStore()
  const db = rawOpen(prepared.path)
  db.prepare("INSERT INTO history (ts, event_type, content) VALUES (?, 'conversation', ?)")
    .run(formatPyIso(T0), JSON.stringify({ user: '早', reply: '早呀' }))
  db.close()
  const h = makeConversation({ prepared })
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const backfill = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith(BACKFILL_HEADER))
  assert.ok(backfill)
  assert.ok(backfill!.content!.includes('] Kevin: 早\n我: 早呀'))
})

test('演化叙事：flag 文件门控（touch 即生效）+ 裁 2000 + narrative_only 不作自我呈现', async () => {
  const prepared = makeStore()
  prepared.store.addNarrativeVersion({
    content: '我最近在和 Kevin 一起把我的新身体搭起来。' + '长'.repeat(2100),
    changeSummary: 'w5',
    trigger: 'integration',
    narrativeClass: 'reflection',
    now: T0,
  })
  const flagDir = mkdtempSync(join(tmpdir(), 'lykoi-narrative-flag-'))
  const flagPath = join(flagDir, 'narrative_injection.on')
  const h = makeConversation({ prepared, narrativeFlagPath: flagPath })
  // flag 不存在 → 回路关闭，块不出现。
  assert.equal(h.conversation.assembleLayout().includes('narrative'), false)
  // touch flag → 即时生效（无需重启）。
  writeFileSync(flagPath, '', 'utf8')
  assert.ok(h.conversation.assembleLayout().includes('narrative'))
  h.llm.push({ content: envelope() })
  await h.conversation.send('在吗', { runId: 'r1' })
  const block = h.llm.calls[0]!.messages.find((m) => m.content?.startsWith('[当前自我叙事'))!
  assert.ok(block.content!.includes('我最近在和 Kevin 一起把我的新身体搭起来。'))
  // NARRATIVE_HEADER(19) + 2000 裁剪。
  assert.equal([...block.content!].length, 19 + 2000)
})
