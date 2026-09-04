/** 交付③测试：S-01..S-11 语义，全部用内存 fake transport 驱动（零真网）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { AuditEvent, AuditService } from 'lykoi-audit'
import type { BindingResolution, LykoiMemoryService } from 'lykoi-memory'
import type { InboundMessage, TelegramAdapterService } from '../src/index.ts'
import * as adapterPlugin from '../src/index.ts'
import { OutboundOrgan } from '../src/device.ts'
import { ProductionTelegramTransport } from '../src/production.ts'
import * as productionPlugin from '../src/production.ts'
import { MemoryTelegramTransport } from '../src/testing.ts'
import {
  BotApiTransport, setUndeliveredExperienceSink, TelegramPollError,
} from '../src/transport.ts'
import { undelivered } from '../src/outbox.ts'

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-telegram-'))
}

function fakeAudit(): AuditService & { events: AuditEvent[] } {
  const events: AuditEvent[] = []
  return {
    events,
    async record(event) {
      events.push(event)
    },
  }
}

/** 只读 memory 假体：绑定表可编程（真库的骨架表零绑定，测试需要可控数据）。 */
function fakeMemory(bindings: Record<string, BindingResolution>): LykoiMemoryService {
  return {
    regulationField: () => [],
    activeConcerns: () => [],
    openThoughts: () => [],
    recentHistory: () => [],
    recentExperiences: () => [],
    identityBinding: (channel, key) => bindings[`${channel}:${key}`],
    autonomyState: () => undefined,
  }
}

interface Setup {
  ctx: Context
  svc: TelegramAdapterService
  transport: MemoryTelegramTransport
  audit: ReturnType<typeof fakeAudit>
  inbound: InboundMessage[]
  cursorPath: string
  archivePath: string
}

async function setup(options: {
  bindings?: Record<string, BindingResolution>
  cursorPath?: string
  archivePath?: string
  transportOverride?: import('../src/index.ts').TelegramTransport
} = {}): Promise<Setup> {
  const dir = tmp()
  const cursorPath = options.cursorPath ?? join(dir, 'cursor.json')
  const archivePath = options.archivePath ?? join(dir, 'inbound.json')
  const ctx = new Context()
  const audit = fakeAudit()
  const transport = new MemoryTelegramTransport()
  const bindings = options.bindings ?? {
    'telegram:1001': { userId: 'user_001', role: 'owner_primary', userStatus: 'active' },
    'telegram:2002': { userId: 'user_002', role: 'group_member', userStatus: 'active' },
  }
  ctx.provide('audit', audit)
  ctx.provide('lykoiMemory', fakeMemory(bindings))
  ctx.provide('telegramTransport', options.transportOverride ?? transport)
  const inbound: InboundMessage[] = []
  ctx.on('lykoi/telegram/inbound', (message) => {
    inbound.push(message)
  })
  await ctx.plugin(adapterPlugin, { cursorPath, archivePath, autoStart: false, pollTimeoutS: 25 })
  const svc = ctx.get('telegram') as TelegramAdapterService
  return { ctx, svc, transport, audit, inbound, cursorPath, archivePath }
}

function ownerUpdate(updateId: number, text: string, messageId = updateId * 100): {
  updateId: number
  message: { messageId: number; chatId: string; senderId: string; text: string }
} {
  return {
    updateId,
    message: { messageId, chatId: 'chat-1', senderId: '1001', text },
  }
}

test('S-01/S-02/S-03：offset=cursor+1、双重去重、游标逐条推进并落盘', async () => {
  const { svc, transport, inbound, cursorPath } = await setup()
  transport.queueUpdate(ownerUpdate(7, '第一句'))
  transport.queueUpdate(ownerUpdate(8, '第二句'))

  assert.equal(await svc.pollOnce(), 2)
  // S-01：首轮 offset = 0+1
  assert.deepEqual(transport.pollOffsets, [1])
  assert.equal(svc.cursor(), 8)
  // S-03：游标落盘，键名保真 last_update_id
  assert.deepEqual(JSON.parse(readFileSync(cursorPath, 'utf8')), { last_update_id: 8 })

  // 第二轮：S-01 平台侧 ack（offset=9 → 平台不重发 <9 的 update）——双重去重第一道。
  transport.queueUpdate(ownerUpdate(8, '第二句(重发)'))
  assert.equal(await svc.pollOnce(), 0)
  assert.deepEqual(transport.pollOffsets, [1, 9])
  assert.equal(inbound.length, 2)
})

test('S-02 第二道：平台无视 offset 重发 <= cursor 的 update 时，进程侧去重挡下', async () => {
  // misbehaving transport：永远重发同一批（模拟平台侧 ack 失效）。
  const batch = [ownerUpdate(1, '同一条'), ownerUpdate(2, '另一条')]
  const misbehaving = {
    async poll() {
      return batch
    },
    async send(): Promise<never> {
      throw new Error('unused')
    },
  }
  const { svc, inbound } = await setup({ transportOverride: misbehaving })
  assert.equal(await svc.pollOnce(), 2)
  assert.equal(await svc.pollOnce(), 0, '重发批全部被进程侧去重')
  assert.equal(svc.counters().duplicates, 2)
  assert.equal(inbound.length, 2, '每条恰好一个回合，不重复')
  assert.equal(svc.cursor(), 2)
})

test('S-03 时序：消费者处理中抛错 → 该条不推进游标（重放方向），前一条已推进', async () => {
  const { ctx, svc, transport, cursorPath } = await setup()
  ctx.on('lykoi/telegram/inbound', (message) => {
    if (message.text === '会失败') throw new Error('consumer boom')
  })
  transport.queueUpdate(ownerUpdate(1, '正常'))
  transport.queueUpdate(ownerUpdate(2, '会失败'))
  // cordis parallel 把 listener 错误聚合为 AggregateError 上抛
  await assert.rejects(() => svc.pollOnce(), (err: AggregateError) => {
    assert.ok(err.errors.some((e) => /consumer boom/.test(String(e))))
    return true
  })
  // 第 1 条处理完已推进；第 2 条失败未推进 → 下轮重放（丢话之害 > 偶发重复之害）。
  assert.equal(svc.cursor(), 1)
  assert.deepEqual(JSON.parse(readFileSync(cursorPath, 'utf8')), { last_update_id: 1 })
})

test('S-04：游标文件损坏/缺失 → 当 0（重放），不崩溃', async () => {
  const dir = tmp()
  const cursorPath = join(dir, 'cursor.json')
  writeFileSync(cursorPath, '{not json!!', 'utf8')
  const { svc, transport } = await setup({ cursorPath, archivePath: join(dir, 'a.json') })
  assert.equal(svc.cursor(), 0)
  await svc.pollOnce()
  assert.deepEqual(transport.pollOffsets, [1])

  // 形状不对（非 int）同样当 0
  const dir2 = tmp()
  writeFileSync(join(dir2, 'c2.json'), JSON.stringify({ last_update_id: 'x' }), 'utf8')
  const second = await setup({ cursorPath: join(dir2, 'c2.json'), archivePath: join(dir2, 'a2.json') })
  assert.equal(second.svc.cursor(), 0)
})

test('S-05：sender/chat 任一缺失 → 静默丢（无 audit 事件、无存档、无 inbound），游标照推', async () => {
  const { svc, transport, audit, inbound } = await setup()
  transport.queueUpdate({ updateId: 1, message: { messageId: 10, chatId: 'chat-1', text: '无 sender' } })
  transport.queueUpdate({ updateId: 2, message: { messageId: 11, senderId: '1001', text: '无 chat' } })
  await svc.pollOnce()
  assert.equal(svc.counters().droppedMalformed, 2)
  assert.equal(inbound.length, 0)
  assert.deepEqual(audit.events, [], 'S-05 是静默丢：无事件')
  assert.equal(svc.cursor(), 2, '静默丢不挡游标')
})

test('S-06：未绑定发送者 → 丢弃 + 进程级累计计数 + 落审计行；不产出 inbound', async () => {
  const { svc, transport, audit, inbound } = await setup()
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 10, chatId: 'chat-9', senderId: '9999', text: '陌生人' },
  })
  transport.queueUpdate({
    updateId: 2,
    message: { messageId: 11, chatId: 'chat-9', senderId: '9999', text: '还是陌生人' },
  })
  await svc.pollOnce()
  assert.equal(svc.counters().droppedUnbound, 2)
  assert.equal(inbound.length, 0)
  const dropped = audit.events.filter((e) => e.type === 'telegram/inbound_dropped_unbound')
  assert.equal(dropped.length, 2)
  assert.equal(dropped[1]!.droppedTotal, 2, '进程级累计计数')
})

test('S-07：入站存档在绑定检查之后、路由之前；无去重；环形 200；畸形降级空字段', async () => {
  const { svc, transport, archivePath } = await setup()
  // 未绑定的不入档
  transport.queueUpdate({
    updateId: 1,
    message: { messageId: 1, chatId: 'c', senderId: 'unbound', text: 'x' },
  })
  // 畸形（text 缺失）降级空字段入档
  transport.queueUpdate({ updateId: 2, message: { messageId: 2, chatId: 'chat-1', senderId: '1001' } })
  await svc.pollOnce()
  let archive = JSON.parse(readFileSync(archivePath, 'utf8')) as {
    next_id: number
    items: { text: string; sender_id: string; id: number; kind: string }[]
  }
  assert.equal(archive.items.length, 1, '未绑定的不入档（S-07 在 _is_bound 之后）')
  assert.equal(archive.items[0]!.text, '', '畸形输入降级为空字段而非抛出')
  assert.equal(archive.items[0]!.kind, 'messenger_inbound')

  // 环形 200 + 同文重复不去重
  for (let i = 3; i <= 210; i++) {
    transport.queueUpdate(ownerUpdate(i, '同一句话'))
  }
  await svc.pollOnce()
  archive = JSON.parse(readFileSync(archivePath, 'utf8')) as typeof archive
  assert.equal(archive.items.length, 200, '环形保留 200')
  // next_id 持久单调（C-28）：1 + 208 条 = 下一个 id 是 210
  assert.equal(archive.next_id, 210)
  assert.equal(archive.items[archive.items.length - 1]!.id, 209)
})

test('S-09：owner 判定严格窄于绑定；盖章消息带 user_id/context_id 出适配器', async () => {
  const { svc, transport, inbound } = await setup()
  transport.queueUpdate(ownerUpdate(1, '我是 Kevin'))
  transport.queueUpdate({
    updateId: 2,
    message: { messageId: 20, chatId: 'chat-2', senderId: '2002', text: '我是群成员' },
  })
  await svc.pollOnce()
  assert.equal(inbound.length, 2)
  const [owner, member] = inbound
  // 来源盖章（工单③）：user_id / context_id 必带
  assert.equal(owner!.userId, 'user_001')
  assert.equal(owner!.contextId, 'chat-1')
  assert.equal(owner!.isOwner, true)
  assert.equal(owner!.messageId, '100')
  // S-09：绑定了但不是 owner_primary → false（永不默认 yes）
  assert.equal(member!.userId, 'user_002')
  assert.equal(member!.isOwner, false)
})

test('S-11/D-06（修正版）：edited_message 忽略 + 落审计行，不是新回合；游标照推', async () => {
  const { svc, transport, audit, inbound } = await setup()
  transport.queueUpdate({
    updateId: 5,
    editedMessage: { messageId: 50, chatId: 'chat-1', senderId: '1001', text: '编辑过的旧话' },
  })
  await svc.pollOnce()
  assert.equal(inbound.length, 0, 'D-06：不是她又收到一句新话')
  assert.equal(svc.counters().editedIgnored, 1)
  assert.equal(audit.events.filter((e) => e.type === 'telegram/edited_message_ignored').length, 1)
  assert.equal(svc.cursor(), 5)
})

test('WO-OUTCOME-01 D-5：消费 owner 应答落一条 consumed terminal，不触发认知 inbound', async () => {
  const { svc, transport, audit, inbound } = await setup()
  svc.wireOutbound(new OutboundOrgan({
    dispatch: (async () => ({ success: true, data: {}, error: null })) as never,
    ownerChannelKey: () => 'chat-1',
    approval: {
      requestApproval: async () => ({ status: 'asked', pending_id: null }),
      handleOwnerAnswer: async () => ({ outcome: 'granted', executed: true }),
    },
    suggestion: {
      handleOwnerAnswer: async () => ({ outcome: 'ignored', suggestion_id: null }),
    },
  }))
  transport.queueUpdate(ownerUpdate(12, '批准'))

  await svc.pollOnce()

  assert.deepEqual(inbound, [])
  const terminal = audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(terminal.length, 1)
  assert.deepEqual(terminal[0], {
    type: 'turn/terminal',
    turn_id: 'tg:12',
    inbound_id: 'tg:12',
    run_id: null,
    update_id: 12,
    message_id: '1200',
    context_id: 'chat-1',
    user_id: 'user_001',
    is_owner: true,
    status: 'consumed',
    reason: 'approval_answer',
    followup_registered: false,
    ask_sent: false,
    notice_sent: false,
    reply_chars: 0,
    elapsed_ms: terminal[0]!.elapsed_ms,
  })
  assert.equal(typeof terminal[0]!.elapsed_ms, 'number')
  assert.equal('text' in terminal[0]!, false)
})

test('WO-OUTCOME-01 D-1：owner 消费路由抛错仍落唯一 failed terminal 并推进游标', async () => {
  const { svc, transport, audit, inbound } = await setup()
  svc.wireOutbound(new OutboundOrgan({
    dispatch: (async () => ({ success: true, data: {}, error: null })) as never,
    ownerChannelKey: () => 'chat-1',
    approval: {
      requestApproval: async () => ({ status: 'asked', pending_id: null }),
      handleOwnerAnswer: async () => {
        const error = new Error('VENDOR_BODY https://private.example/route')
        error.name = 'ApprovalRouteExploded'
        throw error
      },
    },
  }))
  transport.queueUpdate(ownerUpdate(13, '批准'))

  assert.equal(await svc.pollOnce(), 1)
  assert.equal(svc.cursor(), 13)
  assert.deepEqual(inbound, [])
  const terminals = audit.events.filter((event) => event.type === 'turn/terminal')
  assert.equal(terminals.length, 1)
  assert.equal(terminals[0]!.status, 'failed')
  assert.equal(terminals[0]!.reason, 'unknown')
  assert.equal(terminals[0]!.turn_id, 'tg:13')
  assert.equal(terminals[0]!.run_id, null)
  const routeFailed = audit.events.filter((event) => event.type === 'turn/route_failed')
  assert.equal(routeFailed.length, 1)
  assert.equal(routeFailed[0]!.error_name, 'ApprovalRouteExploded')
  const serialized = JSON.stringify(audit.events)
  assert.equal(serialized.includes('VENDOR_BODY'), false)
  assert.equal(serialized.includes('https://private.example'), false)
})

test('出站（SPEC §7.1）：reply_to 必带；成功/失败都落审计（正文不入审计，只有字数）', async () => {
  const { svc, transport, audit } = await setup()
  await assert.rejects(() => svc.send('chat-1', '没有锚', ''), TypeError)
  await assert.rejects(() => svc.send('chat-1', '', '100'), TypeError)
  await assert.rejects(() => svc.send('', '话', '100'), TypeError)

  const ok = await svc.send('chat-1', '回你', '100')
  assert.equal(ok.sent, true)
  assert.deepEqual(transport.sends, [{ chatId: 'chat-1', text: '回你', replyTo: '100' }])
  const sentEvent = audit.events.find((e) => e.type === 'telegram/sent')!
  assert.equal(sentEvent.chars, 2)
  assert.equal('text' in sentEvent, false, '审计行不带正文')

  transport.failNextSendWith = 'api_error'
  const failed = await svc.send('chat-1', '这句发不出去', '101')
  assert.equal(failed.sent, false)
  assert.equal(svc.counters().sendFailed, 1)
  assert.equal(audit.events.filter((e) => e.type === 'telegram/send_failed').length, 1)
})

test('生产传输：无 token 即拒起（凭据走 env 引用，配置里永不落明文）', async () => {
  assert.throws(() => new ProductionTelegramTransport(undefined), /refusing to start without a bot token/)
  assert.throws(() => new ProductionTelegramTransport(''), /refusing to start/)

  // 插件面：env 引用缺席 → 装载失败（无 token 即拒起）
  delete process.env.LYKOI_TEST_TG_TOKEN
  const ctx = new Context()
  await assert.rejects(
    () => Promise.resolve(ctx.plugin(productionPlugin, { tokenEnv: 'LYKOI_TEST_TG_TOKEN', proxy: '' })),
  )
})

// ============================================================================
// WO-FIX-POLLBACKOFF-01 D-5：getUpdates 失败 → 抛 → 设备层循环退避
// ============================================================================

/** 假 token：断言它一个字符都不会出现在错误里（transport 的 token 纪律）。 */
const FAKE_TOKEN = '1234567:AA-THIS-MUST-NEVER-LEAK'

/** 用注入的 `HttpPost` 造一个真 `BotApiTransport`，再桥成生产 transport。 */
function productionWith(post: import('../src/transport.ts').HttpPost): ProductionTelegramTransport {
  const api = new BotApiTransport({ token: FAKE_TOKEN, post })
  return new ProductionTelegramTransport(undefined, { api })
}

test('WO-OUTCOME-01 D-3：系统回执保留未送达账本但关闭经验回灌，普通发送默认不变', async () => {
  const dir = tmp()
  process.env.LYKOI_TELEGRAM_UNDELIVERED = join(dir, 'telegram_undelivered.json')
  const experiences: string[] = []
  setUndeliveredExperienceSink((_source, content) => {
    experiences.push(content)
    return `exp-${experiences.length}`
  })
  try {
    const failedTransport = productionWith(async () => ({ status: 502, json: () => ({}) }))
    const notice = await failedTransport.send(
      'chat-1', '[系统] 这一轮没有得到可靠回复（代号 unknown）。', '100',
      { recordUndeliveredExperience: false },
    )
    assert.equal(notice.sent, false)
    assert.equal(undelivered().length, 1, '系统回执失败仍须落未送达账本')
    assert.equal(experiences.length, 0, '系统回执不得成为她的未送达经验')

    const ordinary = await failedTransport.send('chat-1', '普通角色回复', '101')
    assert.equal(ordinary.sent, false)
    assert.equal(undelivered().length, 2)
    assert.equal(experiences.length, 1, '未传内部标记时维持既有经验回灌')
    assert.ok(experiences[0]!.includes('普通角色回复'))
  } finally {
    setUndeliveredExperienceSink(null)
  }
})

test('D-1 api_error：getUpdates HTTP 快速失败 → poll 抛 TelegramPollError（不再转空批）', async () => {
  // 502（2026-09-04 那次实弹的形状）：HTTP 通了但 ok!==true → api_error。
  const transport = productionWith(async () => ({ status: 502, json: () => ({}) }))
  await assert.rejects(
    () => transport.poll(1, { timeoutS: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof TelegramPollError, 'err instanceof TelegramPollError')
      assert.equal(err.category, 'api_error')
      assert.equal(err.message, 'getUpdates failed: api_error')
      // R-1：状态码透传到设备层 —— 502 与 429 在账面上分得开。
      assert.equal(err.status, 502)
      return true
    },
  )
})

test('D-1 network_error：连不上 → poll 抛 TelegramPollError(network_error)', async () => {
  const transport = productionWith(async () => {
    // 异常的字符串形态里塞满 URL + token —— 真实 HTTP 客户端就是这么泄的。
    const exc = new Error(`connect ECONNREFUSED https://api.telegram.org/bot${FAKE_TOKEN}/getUpdates`)
    exc.name = 'ConnectError'
    throw exc
  })
  await assert.rejects(
    () => transport.poll(1, { timeoutS: 1 }),
    (err: unknown) => {
      assert.ok(err instanceof TelegramPollError)
      assert.equal(err.category, 'network_error')
      assert.equal(err.message, 'getUpdates failed: network_error')
      // 连不上根本没有 HTTP 状态 —— 这一位就该缺席，不许编一个出来。
      assert.equal(err.status, undefined)
      return true
    },
  )
})

test('D-1 token 纪律：抛出的错误只带类别，不带 URL / token / 原始异常文本', async () => {
  for (const post of [
    (async () => ({ status: 502, json: () => ({}) })) as import('../src/transport.ts').HttpPost,
    (async () => {
      const exc = new Error(`https://api.telegram.org/bot${FAKE_TOKEN}/getUpdates timed out`)
      exc.name = 'ReadTimeout'
      throw exc
    }) as import('../src/transport.ts').HttpPost,
    (async () => ({
      status: 200,
      json: () => { throw new Error(`bad json from https://api.telegram.org/bot${FAKE_TOKEN}/getUpdates`) },
    })) as import('../src/transport.ts').HttpPost,
  ]) {
    const err = await productionWith(post).poll(1, { timeoutS: 1 }).then(
      () => { throw new Error('should have rejected') },
      (e: unknown) => e as TelegramPollError,
    )
    const serialized = `${err.name}: ${err.message} ${String(err)}`
    assert.equal(serialized.includes(FAKE_TOKEN), false, 'token 不许出现在错误里')
    assert.equal(/api\.telegram\.org|https?:\/\//.test(serialized), false, 'URL 不许出现在错误里')
    assert.equal(/ECONNREFUSED|timed out|bad json/.test(serialized), false, '原始异常文本不许出现在错误里')
    assert.match(err.message, /^getUpdates failed: [a-z_]+$/)
  }
})

test('D-1 成功路径形状不变：ok 的 getUpdates 照常归一化成 TelegramUpdate[]', async () => {
  const transport = productionWith(async () => ({
    status: 200,
    json: () => ({
      ok: true,
      result: [{
        update_id: 7,
        message: {
          message_id: 42,
          chat: { id: 'chat-1' },
          from: { id: 1001 },
          text: '你好',
          date: 1700000000,
          reply_to_message: { message_id: 41 },
        },
      }],
    }),
  }))
  const updates = await transport.poll(1, { timeoutS: 1 })
  assert.equal(updates.length, 1)
  assert.equal(updates[0]!.updateId, 7)
  assert.deepEqual(updates[0]!.message, {
    messageId: '42',
    chatId: 'chat-1',
    senderId: '1001',
    text: '你好',
    ts: new Date(1700000000 * 1000).toISOString(),
    replyToMessageId: '41',
  })
})

/**
 * D-4 循环夹具：`pollOnce` 按脚本成功/拒绝；`sleep` 只记录不真等（时钟纪律：
 * 退避序列由注入的 seam 观测，不靠真时间）。到达 `stopAfterSleeps` 次睡眠即
 * abort —— 循环这才停得下来。
 */
function loopFixture(script: ('ok' | 'fail')[], stopAfterSleeps: number) {
  const abort = new AbortController()
  const slept: number[] = []
  const audit = fakeAudit()
  const warns: string[] = []
  let call = 0
  let consumed = 0
  const adapter = {
    async pollOnce(): Promise<number> {
      const step = script[call++] ?? 'ok'
      if (step === 'fail') throw new TelegramPollError('api_error')
      return 0
    },
    async consumeOutboxOnce(): Promise<void> {
      consumed += 1
    },
  }
  const run = () => adapterPlugin.runPollLoop(adapter, {
    signal: abort.signal,
    async sleep(seconds: number) {
      slept.push(seconds)
      if (slept.length >= stopAfterSleeps) abort.abort()
    },
    audit,
    logger: { warn: (format: string, ...param: unknown[]) => { warns.push(`${format}${param.length}`) } },
  })
  return {
    run,
    slept,
    audit,
    warns,
    calls: () => call,
    consumedCount: () => consumed,
  }
}

test('D-4/D-2 退避序列：失败 4 次 → 成功 1 次（复位）→ 再失败 1 次 = [1,2,4,8,1]', async () => {
  const fx = loopFixture(['fail', 'fail', 'fail', 'fail', 'ok', 'fail'], 5)
  await fx.run()
  assert.deepEqual(fx.slept, [1, 2, 4, 8, 1], '成功那一轮把退避复位回 1s')
  assert.equal(fx.consumedCount(), 1, '成功那一轮才消费出站队列（间隙位）')
  assert.equal(fx.warns.length, 5, '每次退避照旧一行 warn')
  const backoffs = fx.audit.events.filter((e) => e.type === 'telegram/poll_backoff')
  assert.equal(backoffs.length, 5, '审计条数 = 退避次数')
  assert.deepEqual(backoffs.map((e) => e.backoff_s), [1, 2, 4, 8, 1], '审计 backoff_s 与睡眠序列一致')
  assert.deepEqual([...new Set(backoffs.map((e) => e.category))], ['api_error'])
})

test('D-4 上限 60：连续失败 8 次 = [1,2,4,8,16,32,60,60]（封顶不再翻倍）', async () => {
  const fx = loopFixture(Array<'fail'>(8).fill('fail'), 8)
  await fx.run()
  assert.deepEqual(fx.slept, [1, 2, 4, 8, 16, 32, 60, 60])
  assert.equal(fx.consumedCount(), 0, '一轮都没成功 → 出站队列一次都没消费')
})

test('D-2 category：非 TelegramPollError（消费者抛的）归 unexpected，审计照落', async () => {
  const abort = new AbortController()
  const audit = fakeAudit()
  let call = 0
  await adapterPlugin.runPollLoop({
    async pollOnce(): Promise<number> {
      call += 1
      throw new AggregateError([new Error('consumer boom')], 'parallel failed')
    },
    async consumeOutboxOnce(): Promise<void> {},
  }, {
    signal: abort.signal,
    async sleep() { abort.abort() },
    audit,
    logger: { warn: () => {} },
  })
  assert.equal(call, 1)
  const event = audit.events.find((e) => e.type === 'telegram/poll_backoff')!
  assert.equal(event.category, 'unexpected')
  assert.equal(event.backoff_s, 1)
  assert.equal('status' in event, false, 'status 没有就不出现在审计行里')
})

test('D-2 审计自成一个 try：record 抛也不改退避节奏', async () => {
  const abort = new AbortController()
  const slept: number[] = []
  await adapterPlugin.runPollLoop({
    async pollOnce(): Promise<number> { throw new TelegramPollError('bad_response') },
    async consumeOutboxOnce(): Promise<void> {},
  }, {
    signal: abort.signal,
    async sleep(seconds: number) {
      slept.push(seconds)
      if (slept.length >= 3) abort.abort()
    },
    audit: { async record() { throw new Error('audit sink down') } },
    logger: { warn: () => {} },
  })
  assert.deepEqual(slept, [1, 2, 4], '审计写不进去，退避照常 1→2→4')
})

test('R-1 审计行带 status：pollOnce 抛 TelegramPollError(api_error, 502) → poll_backoff.status = 502', async () => {
  const abort = new AbortController()
  const audit = fakeAudit()
  await adapterPlugin.runPollLoop({
    async pollOnce(): Promise<number> { throw new TelegramPollError('api_error', 502) },
    async consumeOutboxOnce(): Promise<void> {},
  }, {
    signal: abort.signal,
    async sleep() { abort.abort() },
    audit,
    logger: { warn: () => {} },
  })
  const event = audit.events.find((e) => e.type === 'telegram/poll_backoff')!
  assert.equal(event.category, 'api_error')
  assert.equal(event.status, 502)
  assert.equal(event.backoff_s, 1)
})
