import test from 'node:test'
import assert from 'node:assert/strict'
import { BotApiTransport } from 'lykoi-adapter-telegram/transport'
import type { Context } from '@deepseek-ai/cordis'
import type { UserTurn } from 'lykoi-ingress'
import { parseEnvelope, handleTurn, ContinuationRunner } from '../src/index.ts'
import { sequenceUtterances } from '../src/sequencer.ts'
import { envelope, makeConversation, T0 } from './fixture.ts'

const parts = [' 第一条\r\n', '第二条🙂  ', '更正：第三条']
const reply = (utterances: unknown, kind = 'reply') => envelope({ decision: {
  kind, utterances, content: kind === 'promise_followup' ? 'TASK_GOAL' : '不可发送的旧content', reason: '他问我在不在',
} })

test('分段正本逐字、content只是无新增字符的投影；坏条目整体拒绝；silence/demote不漏话', () => {
  const d = parseEnvelope({ content: reply(parts) })
  assert.deepEqual(d.envelope.utterances, parts)
  assert.equal(d.content, parts.join(''))
  assert.deepEqual(parseEnvelope({ content: envelope() }).envelope.utterances, ['在的，怎么了？'])
  for (const bad of [[], ['ok', ''], ['ok', ' \r\n'], ['ok', 1], null, 'text']) {
    assert.throws(() => parseEnvelope({ content: reply(bad) }), /invalid utterances/)
  }
  assert.equal(parseEnvelope({ content: reply(parts, 'silence') }).envelope.utterances, undefined)
  const demoted = parseEnvelope({ content: envelope({ decision: { kind: 'reply', utterances: parts, reason: '未引用' } }) })
  assert.equal(demoted.kind, 'silence')
  assert.equal(demoted.envelope.utterances, undefined)
})

test('真实Conversation记录边界，锁内交出各run分段，followup任务与话语分别保留', async () => {
  const h = makeConversation()
  try {
    h.llm.push({ content: reply(parts) })
    h.llm.push({ content: reply(['我稍后补充。'], 'promise_followup') })
    const received: string[][] = []
    const a = h.conversation.send('一', { onUtterances: p => received.push([...p]) })
    const b = h.conversation.send('二', { onUtterances: p => received.push([...p]) })
    assert.deepEqual(await Promise.all([a, b]), [parts.join(''), '我稍后补充。'])
    assert.deepEqual(received, [parts, ['我稍后补充。']])
    assert.equal(h.conversation.takeFollowupRequest(), 'TASK_GOAL')
    const history = h.store.getRecentHistoryOfType('conversation', 10).map(row => JSON.parse(row.content))
    assert.deepEqual(history.find(row => row.user === '一').utterances, parts)
  } finally { h.store.close() }
})

test('sequencer等待前条完成；失败后未发送尾部；异常也归未送达', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const seen: string[] = []
  const running = sequenceUtterances(parts, async (text, index) => {
    seen.push(text)
    if (index === 0) { await gate; return 'delivered' }
    return 'undelivered'
  })
  assert.deepEqual(seen, [parts[0]])
  release()
  assert.deepEqual(await running, { outcome: 'undelivered', delivered: 1, total: 3 })
  assert.deepEqual(seen, parts.slice(0, 2))
  assert.deepEqual(await sequenceUtterances(parts, async () => { throw new Error('private vendor detail') }),
    { outcome: 'undelivered', delivered: 0, total: 3 })
})

const turn: UserTurn = {
  turnId: 'turn:test:1', channel: 'test', contextId: 'peer', userId: 'owner', isOwner: true,
  commitReason: 'idle_timeout', firstReceivedAt: T0.toISOString(), lastReceivedAt: T0.toISOString(), committedAt: T0.toISOString(),
  parts: [{ inboundId: 'in:test:1', channel: 'test', contextId: 'peer', userId: 'owner', isOwner: true,
    platformMessageId: 'msg-1', platformUpdateId: '1', receivedAt: T0.toISOString(), text: '在吗' }],
}

test('handleTurn的部分交付不是replied，每条沿用原turn/run/anchor且审计零正文', async () => {
  const h = makeConversation()
  const sends: { text: string; context: unknown; anchor: string }[] = []
  const events: Record<string, unknown>[] = []
  const messenger = {
    routeOwnerMessage: async () => null, outboundWired: () => true,
    sendReply: async (_peer: string, text: string, anchor: string, context: unknown) => {
      sends.push({ text, context, anchor })
      return { outcome: sends.length === 2 ? 'undelivered' : 'delivered' }
    },
  }
  const ctx = { get: () => messenger, audit: { record: async (e: Record<string, unknown>) => { events.push(e) } } } as unknown as Context
  try {
    h.llm.push({ content: reply(parts) })
    const result = await handleTurn(ctx, h.conversation, turn, 'run:test:1')
    assert.equal(result.terminal.status, 'failed')
    assert.equal(result.terminal.reason, 'delivery_failed')
    assert.deepEqual(sends.map(s => s.text), parts.slice(0, 2))
    assert.ok(sends.every(s => s.anchor === 'msg-1' && JSON.stringify(s.context) === JSON.stringify({run_id: 'run:test:1', turn_id: turn.turnId})))
    const event = events.find(e => e.type === 'converse/utterances_delivery')!
    assert.equal(event.delivered, 1)
    assert.equal(event.total, 3)
    assert.equal(JSON.stringify(events).includes('第二条'), false)
  } finally { h.store.close() }
})

test('continuation真实runCycle的多条产出按边界进入原outbox回调', async () => {
  const h = makeConversation()
  const progress: string[] = []
  const runner = new ContinuationRunner({ store: h.store, conversation: h.conversation,
    audit: { record: async () => {} }, messenger: () => undefined,
    postProgress: text => { progress.push(text) }, now: () => T0,
  })
  try {
    h.llm.push({ content: reply(parts) })
    const id = runner.register({ originTurnId: 'origin', originRunId: 'r0', goal: '继续整理' })!
    await runner.scan(T0)
    assert.deepEqual(progress, parts)
    assert.equal(h.store.getContinuation(id)!.state, 'completed')
  } finally { h.store.close() }
})


test('模型分段再经真实BotApiTransport拆4096包，HTTP载荷拼回完全等于模型原文', async () => {
  const input = ['甲'.repeat(4095) + '🙂尾\r\n', '  第二条独立消息  ']
  const calls: Record<string, unknown>[] = []
  const transport = new BotApiTransport({ token: 'synthetic-token', apiBase: 'https://example.invalid', sleep: async () => {},
    post: async (_url, payload) => {
      calls.push(payload)
      return { status: 200, json: () => ({ ok: true, result: { message_id: calls.length, date: 1 } }) }
    },
  })
  const result = await sequenceUtterances(input, async text => {
    const sent = await transport.sendMessage({ contextId: 'synthetic-peer', text, replyTo: '1' })
    return sent.sent !== false && sent.message_id !== null ? 'delivered' : 'undelivered'
  })
  assert.equal(result.delivered, 2)
  assert.equal(calls.length, 3)
  assert.equal(calls.map(call => call.text).join(''), input.join(''))
  assert.ok(calls.every(call => String(call.text).length <= 4096))
  assert.equal(calls[2]!.text, input[1])
})

test('锁外摘要等待期间下一轮完成，不覆盖前轮承诺与终局快照', async () => {
  const h = makeConversation()
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(r => { release = r })
  const waiting = new Promise<void>(r => { entered = r })
  let calls = 0
  h.conversation.governContext = async () => { if (++calls === 1) { entered(); await blocked } }
  const registered: string[] = []
  const messenger = {
    routeOwnerMessage: async () => null, outboundWired: () => true,
    sendReply: async () => ({ outcome: 'delivered' }),
  }
  const ctx = { get: () => messenger, audit: { record: async () => {} } } as unknown as Context
  try {
    h.llm.push({ content: reply(['稍后给你。'], 'promise_followup') })
    const first = handleTurn(ctx, h.conversation, turn, 'first-run', {
      register: input => { registered.push(input.goal); return 'first-cont' },
      kick: () => {}, scan: async () => ({ skipped: false, claimed: 0, expired: 0 }),
    })
    await waiting
    h.llm.push({ content: reply(['后轮已完成。']) })
    await h.conversation.send('第二轮', { runId: 'second-run', turnId: 'second-turn' })
    assert.equal(h.conversation.hasFollowupRequest(), false)
    release()
    const result = await first
    assert.equal(result.terminal.status, 'completed')
    assert.equal(result.terminal.followup_registered, true)
    assert.equal(result.terminal.continuation_id, 'first-cont')
    assert.deepEqual(registered, ['TASK_GOAL'])
  } finally { release(); h.store.close() }
})

test('continuation收账不取走锁外等待期间新用户轮的followup', async () => {
  const h = makeConversation()
  let release!: () => void
  let entered!: () => void
  const blocked = new Promise<void>(r => { release = r })
  const waiting = new Promise<void>(r => { entered = r })
  let calls = 0
  h.conversation.governContext = async () => { if (++calls === 1) { entered(); await blocked } }
  const events: Record<string, unknown>[] = []
  const runner = new ContinuationRunner({ store: h.store, conversation: h.conversation,
    audit: { record: async event => { events.push(event) } }, messenger: () => undefined,
    postProgress: () => {}, now: () => T0,
  })
  try {
    h.llm.push({ content: reply(['旧任务完成。']) })
    const id = runner.register({ originTurnId: 'old', originRunId: 'old-run', goal: '旧任务' })!
    const scanning = runner.scan(T0)
    await waiting
    h.llm.push({ content: reply(['新任务稍后处理。'], 'promise_followup') })
    await h.conversation.send('新任务', { runId: 'new-run', turnId: 'new-turn' })
    release()
    await scanning
    assert.equal(h.store.getContinuation(id)!.state, 'completed')
    assert.equal(events.find(event => event.type === 'continuation/terminal')!.chained_request, false)
    assert.equal(h.conversation.takeFollowupRequest(), 'TASK_GOAL')
  } finally { release(); h.store.close() }
})
