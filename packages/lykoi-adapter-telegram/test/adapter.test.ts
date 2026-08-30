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
import { ProductionTelegramTransport } from '../src/production.ts'
import * as productionPlugin from '../src/production.ts'
import { MemoryTelegramTransport } from '../src/testing.ts'

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
