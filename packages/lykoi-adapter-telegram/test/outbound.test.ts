/**
 * 出站器官（SK-77..82 + D-07 本体）。
 *
 * 覆盖面：出站游标机（坏游标方向刻意相反 / 结局落定后推进 / 可投递 kind /
 * approval_request 显式跳过留痕 / 无 owner 绑定不推进 / BATCH_LIMIT）、
 * messenger 资源契约（reply_to is None 才过原子 check-and-reserve / CAP=1 /
 * COOLDOWN=6h / 账本环 50 / 损坏当空 / 节流返回结局不抛 / 默认 Null transport）、
 * transport 纪律（重试序列只给 sendMessage / 429 单独路 / record_undelivered 9
 * 字段 / 正文只在文件事件只留字数 / 经验回灌单写者入口失败吞但落 telemetry /
 * "一条出站消息只有两种结局"）、E3 投递线拉回 dispatch。
 *
 * 全程 fake：HTTP 那一跳是注入 seam，本文件里一条可达真网的路径都没有。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  BotApiTransport, DEFINITE_FAILURE_ERRORS, MAX_RATE_LIMIT_RETRIES, NullTransport,
  OUTBOX_BATCH_LIMIT, OUTBOX_DELIVERABLE_KINDS, OutboundOrgan, PROACTIVE_COOLDOWN_H,
  PROACTIVE_DAILY_CAP, SEND_RETRY_BACKOFF_S, TEXT_SUMMARY_CHARS,
  UNDELIVERED_EXPERIENCE_SOURCE, UNDELIVERED_SALIENCE, appendOutbox, currentTransport,
  loadOutboxCursor, initOutboxCursor, messengerLedgerPath, messengerProactiveRemainingToday,
  outboxCursorPath, outboxDeliverableKinds, outboxNewestId, readOutboxAfter,
  initiateChat, notifyOwner, NOTIFY_ALLOWED_ORIGINS, outboundOrganResources,
  queueNotification, recordUndelivered, saveOutboxCursor, send as messengerSend,
  setTransport as setMessengerTransport,
  setTransportLogEvent, setUndeliveredExperienceSink, undelivered, undeliveredPath,
  _reserveProactiveSlot,
} from '../src/index.ts'
import {
  NOTIFICATION_OUTBOX_KIND, setNotificationOutboxDelivery, upstreamBudgetedDelivery,
  type Observation,
} from 'lykoi-kernel'
import { isolateOutboundState } from '../src/testing.ts'
import { writeJsonAtomicSync } from '../src/jsonio.ts'

const T0 = new Date('2026-08-25T10:00:00Z')

function isolate(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-outbound-'))
  isolateOutboundState(dir)
  setMessengerTransport(null) // 回到缺省 NullTransport
  setTransportLogEvent(null)
  setUndeliveredExperienceSink(null)
  setNotificationOutboxDelivery(false)
  return dir
}

function telemetry(): { name: string; fields: Record<string, unknown> }[] {
  const events: { name: string; fields: Record<string, unknown> }[] = []
  setTransportLogEvent((name, fields) => events.push({ name, fields }))
  return events
}

test('包内 JSON 原子写入：成功落盘，rename 失败清掉临时文件', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-jsonio-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const target = join(dir, 'state.json')
  writeJsonAtomicSync(target, { ok: true })
  assert.equal(readFileSync(target, 'utf8'), JSON.stringify({ ok: true }, null, 2))
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith('.tmp-')), [])

  const blocked = join(dir, 'blocked')
  mkdirSync(blocked)
  assert.throws(() => writeJsonAtomicSync(blocked, { should: 'fail' }))
  assert.deepEqual(readdirSync(dir).filter((name) => name.startsWith('.tmp-')), [])
})

// ============================== SK-80 messenger 资源契约 ==============================

test('SK-80 缺省 transport 是 Null（零网络 I/O）；单写者 = 设备层才换它', () => {
  isolate()
  assert.ok(currentTransport() instanceof NullTransport)
})

test('SK-80 **只有 reply_to is None 才过原子 check-and-reserve**：应答不花预算', async () => {
  isolate()
  assert.equal(PROACTIVE_DAILY_CAP, 1)
  assert.equal(PROACTIVE_COOLDOWN_H, 6.0)
  // 应答路径：连发 5 条，账本一格都不动
  for (let i = 0; i < 5; i += 1) {
    const result = await messengerSend({ text: 'hi', context_id: '1001', reply_to: '500' })
    assert.equal(result.sent, true)
  }
  // 无参查询（真钟）：本测经 messengerSend 走生产路径，账本写的是真钟时间戳 ——
  // 拿 T0 查会数不到今天的账（夹具日 ≠ 运行日，早绿晚红）。写读同钟。
  assert.equal(messengerProactiveRemainingToday(), 1, '回答 Kevin 不是打扰他')
  // 主动路径：第一条通过，第二条被 daily_cap 挡
  const first = await messengerSend({ text: '我想说件事', context_id: '1001', reply_to: null })
  assert.equal(first.sent, true)
  assert.equal(messengerProactiveRemainingToday(), 0)
  const blocked = await messengerSend({ text: '再说一件', context_id: '1001' })
  assert.deepEqual(blocked, { sent: false, throttled: true, reason: 'daily_cap' })
})

test('SK-80 节流返回**结局不抛**（认知体验成结果，不是崩溃）；参数校验才抛', async () => {
  isolate()
  await messengerSend({ text: 'a', context_id: '1001' })
  const blocked = await messengerSend({ text: 'b', context_id: '1001' })
  assert.equal(blocked.throttled, true) // 不抛
  await assert.rejects(() => messengerSend({ context_id: '1001' }), /requires 'text'/)
  await assert.rejects(() => messengerSend({ text: 'a' }), /requires 'context_id'/)
})

test('SK-80 账本**环 50** + 坏账本当空（最坏是多开一次口，仍受日上限约束）', () => {
  isolate()
  const many = Array.from({ length: 80 }, (_, i) => `2026-08-0${(i % 9) + 1}T00:00:00.000Z`)
  writeFileSync(messengerLedgerPath(), JSON.stringify(many))
  assert.equal(_reserveProactiveSlot(new Date('2026-08-25T10:00:00Z')), null)
  const ledger = JSON.parse(readFileSync(messengerLedgerPath(), 'utf8'))
  assert.equal(ledger.length, 50, '账本环 50')
  // 坏账本
  writeFileSync(messengerLedgerPath(), 'not json at all')
  assert.equal(messengerProactiveRemainingToday(T0), 1)
  assert.equal(_reserveProactiveSlot(T0), null)
})

test('SK-80 冷却 6h：同日额度用完后跨日仍受冷却约束', () => {
  isolate()
  assert.equal(_reserveProactiveSlot(new Date('2026-08-25T23:00:00Z')), null)
  assert.equal(_reserveProactiveSlot(new Date('2026-08-25T23:30:00Z')), 'daily_cap')
  assert.equal(_reserveProactiveSlot(new Date('2026-08-26T02:00:00Z')), 'cooldown')
  assert.equal(_reserveProactiveSlot(new Date('2026-08-26T06:00:00Z')), null)
})

// ============================== SK-81 transport 纪律 ==============================

test('SK-81 常量：重试序列 (2,5,15,30)s、429 至多 3 次、摘要 200 字、经验档次', () => {
  assert.deepEqual([...SEND_RETRY_BACKOFF_S], [2.0, 5.0, 15.0, 30.0])
  assert.equal(MAX_RATE_LIMIT_RETRIES, 3)
  assert.equal(TEXT_SUMMARY_CHARS, 200)
  assert.equal(UNDELIVERED_EXPERIENCE_SOURCE, 'conversation')
  assert.equal(UNDELIVERED_SALIENCE, 0.6)
  assert.deepEqual([...DEFINITE_FAILURE_ERRORS], ['ConnectError', 'ConnectTimeout', 'ProxyError'])
})

/** fake HTTP seam：按脚本给出结果（抛 = 网络故障；对象 = 一次响应）。 */
function fakeHttp(script: (Error | { status: number; body: unknown })[]) {
  const calls: { url: string; payload: Record<string, unknown> }[] = []
  let i = 0
  const post = async (url: string, payload: Record<string, unknown>) => {
    calls.push({ url, payload })
    const step = script[Math.min(i, script.length - 1)]!
    i += 1
    if (step instanceof Error) throw step
    return { status: step.status, json: () => step.body }
  }
  return { post, calls }
}

const NO_SLEEP = async () => {}
function err(name: string): Error {
  const e = new Error('network')
  e.name = name
  return e
}

test('SK-81 重试**只给 sendMessage**：网络故障退避 4 次后落未送达账本（两种结局）', async () => {
  isolate()
  const events = telemetry()
  const http = fakeHttp([err('ConnectError')])
  const transport = new BotApiTransport({
    token: 'fake-token-not-real', post: http.post, sleep: NO_SLEEP, apiBase: 'https://example.invalid',
  })
  const result = await transport.sendMessage({ contextId: '1001', text: '她想说的话' })
  assert.equal(result.message_id, null)
  assert.equal(result.sent, false)
  assert.equal(result.undelivered_recorded, true)
  assert.equal(result.ambiguous, false, 'ConnectError = 确定未发出')
  // 首次 + 4 次重试 = 5 次 POST
  assert.equal(http.calls.length, 5)
  const retries = events.filter((e) => e.name === 'telegram_send_retry')
  assert.deepEqual(retries.map((e) => e.fields.backoff_s), [2.0, 5.0, 15.0, 30.0])
  // 账本落定
  const rows = undelivered()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.attempts, 5)
  assert.equal(rows[0]!.source, 'telegram_transport.send_message')
})

test('SK-81 歧义类**也重试**，只是标 ambiguous=true（丢话之害 > 偶发重复之害）', async () => {
  isolate()
  const http = fakeHttp([err('ReadTimeout')])
  const transport = new BotApiTransport({
    token: 't', post: http.post, sleep: NO_SLEEP, apiBase: 'https://example.invalid',
  })
  const result = await transport.sendMessage({ contextId: '1001', text: 'x' })
  assert.equal(result.ambiguous, true)
  assert.equal(http.calls.length, 5)
  assert.equal(undelivered()[0]!.ambiguous, true)
})

test('SK-81 getUpdates **不吃重试序列**（重连节奏归设备的长轮询循环）+ 错误降噪', async () => {
  isolate()
  const events = telemetry()
  const http = fakeHttp([err('RemoteProtocolError')])
  const transport = new BotApiTransport({
    token: 't', post: http.post, sleep: NO_SLEEP, apiBase: 'https://example.invalid',
  })
  await transport.pollUpdates({ offset: 1 })
  assert.equal(http.calls.length, 1, 'getUpdates 一次就返回，不重试')
  assert.equal(events.filter((e) => e.name === 'telegram_send_retry').length, 0)
  // 连击降噪：首条记，第 2..9 条不记，第 10 条记
  for (let i = 0; i < 9; i += 1) await transport.pollUpdates({ offset: 1 })
  const noise = events.filter((e) => e.name === 'telegram_transport_network_error')
  assert.deepEqual(noise.map((e) => e.fields.streak), [1, 10])
})

test('SK-81 429 走**单独一路**：honour retry_after，至多 3 次后放弃（不落重试序列）', async () => {
  isolate()
  const events = telemetry()
  const slept: number[] = []
  const http = fakeHttp([{ status: 429, body: { parameters: { retry_after: 7 } } }])
  const transport = new BotApiTransport({
    token: 't', post: http.post, apiBase: 'https://example.invalid',
    sleep: async (s) => { slept.push(s) },
  })
  const result = await transport.sendMessage({ contextId: '1001', text: 'x' })
  assert.equal(result.error, 'rate_limited')
  assert.deepEqual(slept, [7, 7, 7], 'honour retry_after，恰 MAX_RATE_LIMIT_RETRIES 次')
  assert.equal(http.calls.length, MAX_RATE_LIMIT_RETRIES + 1)
  assert.equal(events.filter((e) => e.name === 'telegram_send_retry').length, 0)
})

test('SK-81 token 纪律：URL 带 token，但**事件/返回值一个字节都不带**', async () => {
  isolate()
  const events = telemetry()
  const SECRET = 'SUPER-SECRET-BOT-TOKEN'
  const http = fakeHttp([err('ProxyError')])
  const transport = new BotApiTransport({
    token: SECRET, post: http.post, sleep: NO_SLEEP, apiBase: 'https://example.invalid',
  })
  const result = await transport.sendMessage({ contextId: '1001', text: 'x' })
  assert.ok(http.calls[0]!.url.includes(SECRET), 'token 只用于拼 URL')
  assert.ok(!JSON.stringify(result).includes(SECRET))
  assert.ok(!JSON.stringify(events).includes(SECRET))
  assert.ok(!readFileSync(undeliveredPath(), 'utf8').includes(SECRET))
})

test('SK-81 record_undelivered 9 字段；**正文只在文件留前 200 字，事件只留字数**', () => {
  isolate()
  const events = telemetry()
  const long = '喵'.repeat(500)
  const record = recordUndelivered({
    contextId: '1001', text: long, error: 'ConnectError', ambiguous: true, attempts: 5,
    source: 'chat_reply', now: T0,
  })
  assert.deepEqual(Object.keys(record).sort(), [
    'ambiguous', 'attempts', 'chars', 'context_id', 'error', 'id', 'source',
    'text_summary', 'ts',
  ])
  assert.equal([...record.text_summary].length, 200)
  assert.equal(record.chars, 500)
  const event = events.find((e) => e.name === 'telegram_send_undelivered')!
  assert.equal(event.fields.chars, 500)
  assert.ok(!JSON.stringify(event).includes('喵'), '事件流是给运维看的，正文属于对话')
})

test('SK-81/U1 经验回灌走**单写者入口**；失败被吞但不静默（落 telemetry）', () => {
  isolate()
  const events = telemetry()
  const written: [string, string, number][] = []
  setUndeliveredExperienceSink((source, content, opts) => {
    written.push([source, content, opts.salience])
    return 77
  })
  recordUndelivered({ contextId: '1001', text: '掉了的那句', error: 'ReadTimeout', now: T0 })
  assert.equal(written.length, 1)
  assert.equal(written[0]![0], 'conversation')
  assert.equal(written[0]![2], 0.6)
  assert.ok(written[0]![1].startsWith('我想对 Kevin 说的话没能送出去(ReadTimeout'))
  assert.equal(events.find((e) => e.name === 'telegram_undelivered_experience')!.fields.experience_id, 77)

  // 写不进去：账已经记上了，投递失败不因此升级成异常
  setUndeliveredExperienceSink(() => { throw new Error('db locked') })
  const record = recordUndelivered({ contextId: '1001', text: 'b', error: 'x', now: T0 })
  assert.equal(record.id, 2, '账本记录照样落定')
  assert.ok(events.some((e) => e.name === 'telegram_undelivered_experience_failed'))

  // 完全没接线：一样是"吞但落 telemetry"
  setUndeliveredExperienceSink(null)
  recordUndelivered({ contextId: '1001', text: 'c', error: 'x', now: T0 })
  assert.equal(events.filter((e) => e.name === 'telegram_undelivered_experience_failed').length, 2)
})

test('SK-81 送达路：拿到 message_id 就不进账本（"没有第三种结局"）', async () => {
  isolate()
  const http = fakeHttp([{ status: 200, body: { ok: true, result: { message_id: 4242, date: 1 } } }])
  const transport = new BotApiTransport({
    token: 't', post: http.post, sleep: NO_SLEEP, apiBase: 'https://example.invalid',
  })
  const result = await transport.sendMessage({ contextId: '1001', text: 'x', replyTo: '500' })
  assert.equal(result.message_id, '4242')
  assert.equal(http.calls[0]!.payload.reply_to_message_id, 500, 'reply_to 转成 int 进 wire')
  assert.deepEqual(undelivered(), [])
  // 非 Telegram message id（本地 ref）→ 略去这一位，照样发
  const http2 = fakeHttp([{ status: 200, body: { ok: true, result: { message_id: 1 } } }])
  const t2 = new BotApiTransport({ token: 't', post: http2.post, apiBase: 'https://example.invalid' })
  await t2.sendMessage({ contextId: '1001', text: 'x', replyTo: 'q-1' })
  assert.equal('reply_to_message_id' in http2.calls[0]!.payload, false)
})

// ============================== SK-79 出站游标机 ==============================

test('SK-79 **坏游标方向与入站刻意相反**：出站坏/首启 = 当前 max id（宁跳过不灌陈货）', () => {
  isolate()
  // 账本里躺着 3 条"陈货"（历史广播日志，不是待发队列）
  appendOutbox('陈货 1', 'proactive')
  appendOutbox('陈货 2', 'followup')
  appendOutbox('陈货 3', 'proactive')
  assert.equal(outboxNewestId(), 3)
  // 首启：游标 = 3（从现在起）
  assert.equal(loadOutboxCursor(), null)
  assert.equal(initOutboxCursor(), 3)
  assert.equal(loadOutboxCursor(), 3)
  // 损坏：与首启同归一个返回值 —— 仍然是"从现在起"，不是从 0 重放
  writeFileSync(outboxCursorPath(), '{ 坏掉了')
  assert.equal(loadOutboxCursor(), null)
  appendOutbox('新的', 'proactive')
  assert.equal(initOutboxCursor(), 4)
  // 重启走**已持久化**那一支
  saveOutboxCursor(2)
  assert.equal(initOutboxCursor(), 2)
})

test('SK-79 可投递 kind = (proactive, followup)；GK-8 开启才加 notification', () => {
  isolate()
  assert.deepEqual([...OUTBOX_DELIVERABLE_KINDS], ['proactive', 'followup'])
  assert.deepEqual([...outboxDeliverableKinds()], ['proactive', 'followup'])
  setNotificationOutboxDelivery(true)
  assert.deepEqual([...outboxDeliverableKinds()], ['proactive', 'followup', NOTIFICATION_OUTBOX_KIND])
  setNotificationOutboxDelivery(false)
  assert.equal(OUTBOX_BATCH_LIMIT, 20)
})

/** fake dispatch：记下每次派发；可注入失败。 */
function organDispatch(mode: 'ok' | 'fail' = 'ok') {
  const calls: {
    type: string
    params: Record<string, unknown>
    origin?: string
    exemption?: unknown
    run_id?: string | null
    turn_id?: string | null
  }[] = []
  let n = 0
  const dispatch = (async (action: { type: string; params: Record<string, unknown> }, opts?: {
    context?: {
      origin?: string
      exemption?: unknown
      run_id?: string | null
      turn_id?: string | null
    }
  }): Promise<Observation> => {
    calls.push({
      type: action.type, params: action.params,
      ...(opts?.context === undefined ? {} : {
        origin: opts.context.origin,
        exemption: opts.context.exemption,
        run_id: opts.context.run_id,
        turn_id: opts.context.turn_id,
      }),
    })
    if (mode === 'fail') return { success: false, data: {}, error: 'boom' }
    n += 1
    return { success: true, data: { sent: true, message_id: `m-${n}` }, error: null }
  }) as never
  return { dispatch, calls }
}

test('D-07 本体：投递线**经 dispatch 盖 E3 章**（不再直调 transport）——账照记', async () => {
  isolate()
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const d = organDispatch()
  const organ = new OutboundOrgan({
    dispatch: d.dispatch, ownerChannelKey: () => '1001',
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  saveOutboxCursor(0)
  const item = appendOutbox('我今天想到一件事', 'proactive')
  assert.equal(await organ.consumeOutboxOnce(), item.id)
  assert.equal(d.calls.length, 1)
  assert.equal(d.calls[0]!.type, 'messenger.send')
  assert.equal(d.calls[0]!.origin, 'autonomous')
  assert.equal((d.calls[0]!.exemption as { category: string }).category, 'E3')
  assert.equal(d.calls[0]!.params.reply_to, null, '主动发言不拿 reply_to 撒谎换额度')
  // E3 与"预算已在上游收过"是同一个对象类型 —— 伪造不出来
  assert.equal((d.calls[0]!.exemption as object).constructor,
    upstreamBudgetedDelivery().constructor)
  assert.ok(events.some((e) => e.name === 'chat_outbox_delivered_telegram'))
  assert.equal(loadOutboxCursor(), item.id, '结局落定之后才推进游标')
})

test('SK-79 approval_request **显式跳过并留痕**（同一个问题问两次的病灶），游标照推', async () => {
  isolate()
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const d = organDispatch()
  const organ = new OutboundOrgan({
    dispatch: d.dispatch, ownerChannelKey: () => '1001',
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  saveOutboxCursor(0)
  const skipped = appendOutbox('旧 surface 的审批请求', 'approval_request')
  const kept = appendOutbox('她自己要说的话', 'followup')
  await organ.consumeOutboxOnce()
  assert.equal(d.calls.length, 1, '只投递"她自己要说的话"')
  const skip = events.find((e) => e.name === 'chat_outbox_skipped')!
  assert.equal(skip.fields.id, skipped.id)
  assert.equal(skip.fields.reason, 'kind_not_deliverable')
  assert.equal(loadOutboxCursor(), kept.id)
})

test('SK-79 无 owner 绑定 → **游标不推进**（绑定补上之后这些话仍该被说出去）', async () => {
  isolate()
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const d = organDispatch()
  const organ = new OutboundOrgan({
    dispatch: d.dispatch, ownerChannelKey: () => null,
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  saveOutboxCursor(0)
  appendOutbox('攒下的话', 'proactive')
  assert.equal(await organ.consumeOutboxOnce(), 0)
  assert.deepEqual(d.calls, [])
  assert.equal(loadOutboxCursor(), 0)
  assert.ok(events.some((e) => e.name === 'chat_outbox_no_owner_binding'))
})

test('SK-79 投递失败 → 补记未送达账本（游标仍推进：结局已落定，只是落在另一边）', async () => {
  isolate()
  const d = organDispatch('fail')
  const organ = new OutboundOrgan({ dispatch: d.dispatch, ownerChannelKey: () => '1001' })
  saveOutboxCursor(0)
  const item = appendOutbox('没送出去的话', 'proactive')
  await organ.consumeOutboxOnce()
  const rows = undelivered()
  assert.equal(rows.length, 1)
  assert.equal(rows[0]!.source, 'chat_outbox')
  assert.equal(rows[0]!.error, 'boom')
  assert.equal(loadOutboxCursor(), item.id)
})

test('SK-79 BATCH_LIMIT=20：一轮至多投这么多，剩下的下一轮（不把长轮询晾太久）', async () => {
  isolate()
  const d = organDispatch()
  const organ = new OutboundOrgan({ dispatch: d.dispatch, ownerChannelKey: () => '1001' })
  saveOutboxCursor(0)
  for (let i = 0; i < 25; i += 1) appendOutbox(`第 ${i} 条`, 'followup')
  await organ.consumeOutboxOnce()
  assert.equal(d.calls.length, OUTBOX_BATCH_LIMIT)
  assert.equal(loadOutboxCursor(), 20)
  await organ.consumeOutboxOnce()
  assert.equal(d.calls.length, 25)
  assert.equal(loadOutboxCursor(), 25)
  // 非破坏性广播日志：读一遍不吃掉任何一条
  assert.equal(readOutboxAfter(0, 100).count, 25)
})

// ============================== SK-77/78 设备侧 ==============================

test('SK-77 形状校验：action_type 非空 str + params 是 dict，**不对宁可不问**', async () => {
  isolate()
  const events: { name: string; fields: Record<string, unknown> }[] = []
  const asked: unknown[] = []
  const organ = new OutboundOrgan({
    dispatch: organDispatch().dispatch,
    ownerChannelKey: () => '1001',
    approval: {
      requestApproval: async (t, p, o) => {
        asked.push([t, p, o])
        return { status: 'asked', pending_id: 'p-1' }
      },
      handleOwnerAnswer: async () => ({ outcome: 'ignored', executed: false }),
    },
    logEvent: (name, fields) => events.push({ name, fields }),
  })
  const bad = [
    { action_type: '', params: {} },
    { action_type: 'terminal.exec' }, // params 缺席
    { action_type: 'terminal.exec', params: 'ls' }, // params 不是 dict
    { action_type: 'terminal.exec', params: ['ls'] }, // 数组也不是 dict
    { action_type: 42, params: {} },
  ]
  for (const payload of bad) {
    const result = await organ.askAbout(payload as never, { contextId: '1001', replyTo: '500' })
    assert.equal(result.asked, false)
  }
  assert.deepEqual(asked, [], '一个残缺动作都不许去排队')
  assert.equal(events.filter((e) => e.name === 'telegram_approval_ask_malformed').length, 5)
  // 形状对的照问，且 reply_to = 当轮入站 id
  const ok = await organ.askAbout(
    { action_type: 'terminal.exec', params: { command: 'ls' }, action_id: 'a1', correlation_id: 'c1' },
    { contextId: '1001', replyTo: '500', run_id: 'converse-7-70', turn_id: 'tg:7' },
  )
  assert.equal(ok.asked, true)
  assert.deepEqual(asked, [[
    'terminal.exec',
    { command: 'ls' },
    {
      contextId: '1001', replyTo: '500', origin: 'interactive',
      run_id: 'converse-7-70', turn_id: 'tg:7', actionId: 'a1', correlationId: 'c1',
    },
  ]])
})

test('SK-77 设备层**不自己写队列、不重试**（排队只在 requestApproval 里发生）', async () => {
  isolate()
  let calls = 0
  const organ = new OutboundOrgan({
    dispatch: organDispatch().dispatch,
    ownerChannelKey: () => '1001',
    approval: {
      requestApproval: async () => {
        calls += 1
        return { status: 'send_failed', pending_id: null } // 问不出去
      },
      handleOwnerAnswer: async () => ({ outcome: 'ignored', executed: false }),
    },
  })
  const result = await organ.askAbout(
    { action_type: 'terminal.exec', params: { command: 'ls' } },
    { contextId: '1001', replyTo: '500' },
  )
  assert.equal(result.status, 'send_failed')
  assert.equal(calls, 1, '问不出去 = 那件事不做（deny-by-default），不重试')
})

test('SK-78 E2 盖章唯一点：送达 / 未送达补记 / needs_approval（排队等批 ≠ 未送达）/ dispatch 失败', async () => {
  isolate()
  // ① 送达
  const ok = organDispatch()
  let organ = new OutboundOrgan({ dispatch: ok.dispatch, ownerChannelKey: () => '1001' })
  assert.deepEqual(await organ.sendReply({ contextId: '1001', text: '在的', replyTo: '500' }),
    { outcome: 'delivered' })
  assert.equal((ok.calls[0]!.exemption as { category: string }).category, 'E2')
  assert.equal((ok.calls[0]!.exemption as { peerContextId: string }).peerContextId, '1001')
  assert.equal(ok.calls[0]!.origin, 'interactive')
  assert.deepEqual(undelivered(), [])

  // ② 成功但没 message_id（被打扰频控挡下等）→ 补记未送达
  const throttled = {
    dispatch: (async () => ({ success: true, data: { sent: false, reason: 'daily_cap' }, error: null })) as never,
  }
  organ = new OutboundOrgan({ dispatch: throttled.dispatch, ownerChannelKey: () => '1001' })
  assert.deepEqual(await organ.sendReply({ contextId: '1001', text: 'x', replyTo: null }),
    { outcome: 'undelivered' })
  assert.equal(undelivered().at(-1)!.error, 'daily_cap')
  assert.equal(undelivered().at(-1)!.source, 'chat_reply')

  // ③ needs_approval → 问出去；**不落未送达账本**（它还有下文）
  const before = undelivered().length
  const needs = {
    dispatch: (async () => ({
      success: false, data: { needs_approval: true, action_id: 'a1', correlation_id: 'c1' },
      error: 'needs_approval',
    })) as never,
  }
  const asked: unknown[] = []
  organ = new OutboundOrgan({
    dispatch: needs.dispatch,
    ownerChannelKey: () => '1001',
    approval: {
      requestApproval: async (t, p, o) => {
        asked.push([t, o.replyTo, o.actionId, o.run_id, o.turn_id])
        return { status: 'asked', pending_id: 'a1' }
      },
      handleOwnerAnswer: async () => ({ outcome: 'ignored', executed: false }),
    },
  })
  assert.deepEqual(await organ.sendReply({
    contextId: '1001', text: 'x', replyTo: '500',
    run_id: 'converse-8-80', turn_id: 'tg:8',
  }),
    { outcome: 'needs_approval' })
  assert.deepEqual(asked, [['messenger.send', '500', 'a1', 'converse-8-80', 'tg:8']])
  assert.equal(undelivered().length, before, '排队等批 ≠ 未送达')

  // ④ dispatch 本身失败（transport 从未被调用）→ 同样不许静默
  const failed = organDispatch('fail')
  organ = new OutboundOrgan({ dispatch: failed.dispatch, ownerChannelKey: () => '1001' })
  assert.deepEqual(await organ.sendReply({ contextId: '1001', text: 'x', replyTo: '500' }),
    { outcome: 'dispatch_failed' })
  assert.equal(undelivered().at(-1)!.error, 'boom')
})

test('WO-OUTCOME-01 D-2：sendReply 可带回合 ID，且只进入 kernel context', async () => {
  isolate()
  const d = organDispatch()
  const organ = new OutboundOrgan({ dispatch: d.dispatch, ownerChannelKey: () => '1001' })
  assert.deepEqual(await organ.sendReply({
    contextId: '1001', text: 'x', replyTo: '500', run_id: 'converse-7-70', turn_id: 'tg:7',
  }), { outcome: 'delivered' })
  assert.equal(d.calls[0]!.run_id, 'converse-7-70')
  assert.equal(d.calls[0]!.turn_id, 'tg:7')
  assert.deepEqual(d.calls[0]!.params, { text: 'x', context_id: '1001', reply_to: '500' })
})

// ============================== SK-82 S-08 三级路由 ==============================

test('SK-82 三级路由：审批答复 → 建议答复 → 普通对话；**前两级 outcome!==ignored 即消费**', async () => {
  isolate()
  const seq: string[] = []
  function organWith(approvalOutcome: string, suggestionOutcome: string) {
    return new OutboundOrgan({
      dispatch: organDispatch().dispatch,
      ownerChannelKey: () => '1001',
      approval: {
        requestApproval: async () => ({ status: 'asked', pending_id: null }),
        handleOwnerAnswer: async () => {
          seq.push('approval')
          return { outcome: approvalOutcome, executed: false }
        },
      },
      suggestion: {
        handleOwnerAnswer: async () => {
          seq.push('suggestion')
          return { outcome: suggestionOutcome, suggestion_id: null }
        },
      },
    })
  }
  const args = { text: '可以', contextId: '1001', replyTo: 'q-1', messageId: '501' }

  // ①第一级消费 → 第二级根本不跑
  seq.length = 0
  assert.equal(await organWith('granted', 'accepted').routeOwnerMessage(args), 'approval_answer')
  assert.deepEqual(seq, ['approval'])

  // ②第一级 ignored → 落到第二级；第二级消费
  seq.length = 0
  assert.equal(await organWith('ignored', 'accepted').routeOwnerMessage(args), 'suggestion_answer')
  assert.deepEqual(seq, ['approval', 'suggestion'])

  // ③两级都 ignored → 不消费，落普通对话
  seq.length = 0
  assert.equal(await organWith('ignored', 'ignored').routeOwnerMessage(args), null)
  assert.deepEqual(seq, ['approval', 'suggestion'])
})

// ============================== NullTransport ==============================

test('NullTransport：零网络 I/O，send 记进 JSONL，read 重放同一个文件', async () => {
  const dir = isolate()
  const transport = new NullTransport(join(dir, 'log.jsonl'))
  await transport.sendMessage({ contextId: '1001', text: 'a', replyTo: null })
  await transport.sendMessage({ contextId: '2002', text: 'b', replyTo: '5' })
  const all = await transport.fetchUpdates({})
  assert.equal(all.count, 2)
  const filtered = await transport.fetchUpdates({ contextId: '2002' })
  assert.equal(filtered.count, 1)
  // 半截行跳过，永不致命
  writeFileSync(join(dir, 'log.jsonl'), '{"id":1}\n这不是 JSON\n{"id":2}\n')
  assert.equal((await transport.fetchUpdates({})).count, 2)
})

// ============================== 器官注册表换装（W1 TODO① 的 W3 那一批） ==========

test('W3 换装：messenger 2 + notify.owner + autonomy 2 是真身，其余 13 个仍是替身', async () => {
  isolate()
  const registry = outboundOrganResources() as unknown as Record<string, Record<string, (p: Record<string, unknown>) => Promise<unknown>>>
  // 真身：调得动
  assert.equal(typeof registry.messenger!.send, 'function')
  assert.equal(typeof registry.messenger!.read, 'function')
  assert.equal(typeof registry.notify!.owner, 'function')
  assert.equal(typeof registry.autonomy!.queue_notification, 'function')
  assert.equal(typeof registry.autonomy!.initiate_chat, 'function')
  // 替身：一调就大声抛（三道门不因换装移动一行）
  for (const [prefix, method] of [
    ['browser', 'navigate'], ['terminal', 'exec'], ['research_browser', 'open'],
    ['delegation', 'dispatch'],
  ]) {
    await assert.rejects(() => registry[prefix!]![method!]!({}), /器官未接线/)
  }
})

test('SK-60 notify.owner **显式排除 autonomous origin**（自主环有它自己的 allow-list 动作）', async () => {
  isolate()
  assert.deepEqual([...NOTIFY_ALLOWED_ORIGINS].sort(), ['interactive', 'scheduler', 'system'])
  await assert.rejects(
    () => notifyOwner({ content: 'x', origin: 'autonomous' }),
    /does not accept origin 'autonomous'/,
  )
  await assert.rejects(() => notifyOwner({ origin: 'system' }), /requires 'content'/)
  const queued = await notifyOwner({ content: '回执', origin: 'interactive' })
  assert.deepEqual(queued, { queued: true, notified: true, id: 1 })
})

test('SK-56 唯一合法调用方 = 两个 handler：autonomy.queue_notification 走节流、被挡返回结局', async () => {
  isolate()
  const first = await queueNotification({ summary: '她想到的一件事', run_id: 'r1' })
  assert.deepEqual(first, { queued: true, id: 1 })
  // 冷却 2h 内的第二条被挡 —— 返回结局而不是到达 Kevin
  const blocked = await queueNotification({ summary: '另一件事' })
  assert.deepEqual(blocked, { queued: false, reason: 'cooldown' })
  await assert.rejects(() => queueNotification({}), /requires 'summary'/)
})

test('autonomy.initiate_chat：proactive_chat 账本**原子强制**（日 1 条），被拦下是结果不是异常', async () => {
  isolate()
  const first = await initiateChat({ content: '  我想说件事  ' })
  assert.deepEqual(first, { queued: true, id: 1 })
  assert.equal(readOutboxAfter(0, 10).messages[0]!.kind, 'proactive')
  assert.equal(readOutboxAfter(0, 10).messages[0]!.content, '我想说件事', '两端空白裁掉')
  const blocked = await initiateChat({ content: '再说一件' })
  assert.deepEqual(blocked, { queued: false, reason: 'daily_cap' })
  await assert.rejects(() => initiateChat({ content: '   ' }), /requires 'content'/)
})
