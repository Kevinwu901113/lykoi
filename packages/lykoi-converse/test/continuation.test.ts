/**
 * WO-CONTINUATION-01 §4.3：跟进消费者的行为面。
 *
 * 账簿用内存假件（与 rw 层同一 CAS/一次性语义；rw 层本身在
 * lykoi-memory/test/rw-continuations.test.ts 实测），Conversation / telegram /
 * audit 用假件。时钟全部由 T0 派生；审计行逐条断言零正文（D-08）。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import type { Context } from '@deepseek-ai/cordis'
import type { InboundMessage, TelegramAdapterService, TelegramSendOptions } from 'lykoi-adapter-telegram'
import type { PendingContinuationRow } from 'lykoi-memory/rw'
import {
  CONTINUATION_FAILURE_NOTICE, CONTINUATION_PROMPT, CONTINUATION_SCAN_LIMIT, CONTINUATION_TTL_S,
  ContextBudgetError, ContinuationRunner, handleTurn,
  type Conversation, type ContinuationStore, type CycleOutcome,
} from '../src/index.ts'

const T0 = new Date(Date.UTC(2026, 8, 4, 12, 0, 0, 0))
const at = (s: number) => new Date(T0.getTime() + s * 1000)
const GOAL = 'GOAL_BODY_SENTINEL 把那份对比表整理出来'
const REPLY = 'REPLY_BODY_SENTINEL 整理好了'

function pyIso(d: Date): string { return d.toISOString().replace('Z', '+00:00') }

/** 内存账簿：与 rw 层同一语义（CAS 租约、终局一次性、到期序、limit）。 */
class FakeStore implements ContinuationStore {
  rows = new Map<string, PendingContinuationRow>()
  owner: string | null = 'chat-owner'
  registerThrows = false
  registerContinuation(row: { id: string; originTurnId: string; originRunId: string | null; goal: string; dueAt: Date; now: Date }): void {
    if (this.registerThrows) { const e = new Error('SQLITE_BUSY'); e.name = 'SqliteBusy'; throw e }
    if (this.rows.has(row.id)) throw new Error('UNIQUE constraint failed: pending_continuations.id')
    this.rows.set(row.id, {
      id: row.id, origin_turn_id: row.originTurnId, origin_run_id: row.originRunId, goal: row.goal,
      due_at: pyIso(row.dueAt), state: 'pending', terminal_reason: null, run_id: null,
      created_at: pyIso(row.now), updated_at: pyIso(row.now),
    })
  }
  seed(id: string, patch: Partial<PendingContinuationRow>): void {
    this.rows.set(id, {
      id, origin_turn_id: 'tg:9', origin_run_id: 'converse-9-900', goal: GOAL, due_at: pyIso(T0),
      state: 'pending', terminal_reason: null, run_id: null, created_at: pyIso(T0), updated_at: pyIso(T0),
      ...patch,
    })
  }
  dueContinuations(now: Date, limit: number): PendingContinuationRow[] {
    return [...this.rows.values()]
      .filter((r) => r.state === 'pending' && r.due_at <= pyIso(now))
      .sort((a, b) => a.due_at.localeCompare(b.due_at))
      .slice(0, limit)
  }
  runningContinuations(): PendingContinuationRow[] {
    return [...this.rows.values()].filter((r) => r.state === 'running')
  }
  claimContinuation(id: string, runId: string, now: Date): boolean {
    const r = this.rows.get(id)
    if (r === undefined || r.state !== 'pending') return false
    r.state = 'running'; r.run_id = runId; r.updated_at = pyIso(now)
    return true
  }
  finishContinuation(id: string, state: 'completed' | 'failed' | 'expired', reason: string | null, now: Date): boolean {
    const r = this.rows.get(id)
    if (r === undefined || (r.state !== 'pending' && r.state !== 'running')) return false
    r.state = state; r.terminal_reason = reason; r.updated_at = pyIso(now)
    return true
  }
  ownerChannelKey(): string | null { return this.owner }
}

interface ConvOptions {
  reply?: string
  error?: unknown
  cycleKind?: CycleOutcome['kind']
  chained?: boolean
  /** 让 send 悬着，直到调用方放行（互斥测试）。 */
  gate?: { release: () => void; wait: Promise<void> }
}

function fakeConversation(o: ConvOptions) {
  const sends: { text: string; opts: Record<string, unknown> }[] = []
  let followup: string | null = null
  let taken = 0
  const conversation = {
    async send(text: string, opts: Record<string, unknown>) {
      sends.push({ text, opts })
      if (o.gate) await o.gate.wait
      if (o.error !== undefined) throw o.error
      followup = o.chained ? 'CHAINED_GOAL_SENTINEL' : null
      return o.reply ?? ''
    },
    lastCycleOutcome: () => (o.cycleKind === undefined ? null : { kind: o.cycleKind, step: 0 }),
    hasFollowupRequest: () => followup !== null,
    takeFollowupRequest: () => { const t = followup; followup = null; taken += 1; return t },
  }
  return { conversation, sends, taken: () => taken }
}

function fakeTelegram(opts: { throws?: boolean } = {}) {
  const sends: { contextId: string; text: string; replyTo: string | null; options: TelegramSendOptions | undefined }[] = []
  const telegram = {
    async transportSend(contextId: string, text: string, replyTo: string | null, options?: TelegramSendOptions) {
      if (opts.throws) { const e = new Error('VENDOR_RAW_SENTINEL'); e.name = 'TransportExploded'; throw e }
      sends.push({ contextId, text, replyTo, options })
      return { sent: true, messageId: 'n-1' }
    },
  } as unknown as Pick<TelegramAdapterService, 'transportSend'>
  return { telegram, sends }
}

function harness(conv: ConvOptions, opts: { telegram?: 'ok' | 'throws' | 'absent'; clock?: () => Date } = {}) {
  const store = new FakeStore()
  const events: ({ type: string } & Record<string, unknown>)[] = []
  const progress: string[] = []
  const tg = fakeTelegram({ throws: opts.telegram === 'throws' })
  const c = fakeConversation(conv)
  const errors: string[] = []
  const runner = new ContinuationRunner({
    store,
    conversation: c.conversation as never,
    audit: { async record(e) { events.push(e) } },
    telegram: () => (opts.telegram === 'absent' ? undefined : tg.telegram),
    postProgress: (content) => { progress.push(content) },
    now: opts.clock ?? (() => T0),
    onError: (where) => { errors.push(where) },
  })
  return { store, events, progress, tg, conv: c, runner, errors }
}

type Recorded = { type: string } & Record<string, unknown>
function terminals(events: Recorded[]): Recorded[] {
  return events.filter((e) => e.type === 'continuation/terminal')
}

function assertNoBody(events: unknown[]): void {
  const flat = JSON.stringify(events)
  for (const s of ['GOAL_BODY_SENTINEL', 'REPLY_BODY_SENTINEL', 'CHAINED_GOAL_SENTINEL', 'VENDOR_RAW_SENTINEL']) {
    assert.equal(flat.includes(s), false, `审计行泄漏正文：${s}`)
  }
}

test('(a) 登记 → 扫描认领 → 后台回合（background/runId/turnId）→ 产出走 postProgress → completed', async () => {
  const h = harness({ reply: REPLY, cycleKind: 'reply' })
  const id = h.runner.register({ originTurnId: 'tg:1', originRunId: 'converse-1-100', goal: GOAL })
  assert.equal(id, `cont-tg:1-${T0.getTime()}`)
  assert.equal(h.store.rows.get(id!)!.state, 'pending')
  assert.equal(h.store.rows.get(id!)!.due_at, pyIso(T0))

  const summary = await h.runner.scan(T0)
  assert.deepEqual(summary, { skipped: false, claimed: 1, expired: 0 })
  assert.deepEqual(h.conv.sends, [{
    text: CONTINUATION_PROMPT(GOAL),
    opts: { background: true, runId: `continuation-${id}`, turnId: id },
  }])
  assert.deepEqual(h.progress, [REPLY])
  const row = h.store.rows.get(id!)!
  assert.equal(row.state, 'completed')
  assert.equal(row.terminal_reason, null)
  assert.equal(row.run_id, `continuation-${id}`)
  const [t] = terminals(h.events)
  assert.deepEqual({ ...t, elapsed_ms: 0 }, {
    type: 'continuation/terminal', continuation_id: id, origin_turn_id: 'tg:1', origin_run_id: 'converse-1-100',
    run_id: `continuation-${id}`, state: 'completed', reason: null, goal_chars: [...GOAL].length,
    elapsed_ms: 0, reply_chars: REPLY.length, chained_request: false,
  })
  assert.equal(h.tg.sends.length, 0, '完成不回执')
  assertNoBody(h.events)
})

test('(b) 沉默回合 → completed、零产出、不回执', async () => {
  const h = harness({ reply: '', cycleKind: 'silence' })
  const id = h.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })!
  await h.runner.scan(T0)
  assert.equal(h.store.rows.get(id)!.state, 'completed')
  assert.deepEqual(h.progress, [])
  assert.equal(terminals(h.events)[0]!.reply_chars, 0)
  assert.equal(h.tg.sends.length, 0)
})

test('(c) send 抛错 → failed + failureReason 代号 + owner 回执（不回灌经历）', async () => {
  const h = harness({ error: new ContextBudgetError('CTX_SENTINEL') })
  const id = h.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })!
  await h.runner.scan(T0)
  const row = h.store.rows.get(id)!
  assert.equal(row.state, 'failed')
  assert.equal(row.terminal_reason, 'context_budget')
  assert.equal(terminals(h.events)[0]!.reason, 'context_budget')
  assert.deepEqual(h.tg.sends, [{
    contextId: 'chat-owner', text: CONTINUATION_FAILURE_NOTICE('context_budget'), replyTo: null,
    options: { recordUndeliveredExperience: false },
  }])
  assertNoBody(h.events)
})

test('(d) 周期结局映射：envelope_failed / missing_tool / tool_budget → failed；ask_pending → completed(approval_pending)', async () => {
  const cases: [CycleOutcome['kind'], string, string | null, number][] = [
    ['envelope_failed', 'failed', 'envelope_failed', 1],
    ['missing_tool', 'failed', 'missing_tool', 1],
    ['tool_budget', 'failed', 'tool_budget_exhausted', 1],
    ['ask_pending', 'completed', 'approval_pending', 0],
    ['followup', 'completed', null, 0],
  ]
  for (const [kind, state, reason, notices] of cases) {
    const h = harness({ reply: '', cycleKind: kind })
    const id = h.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })!
    await h.runner.scan(T0)
    assert.equal(h.store.rows.get(id)!.state, state, kind)
    assert.equal(h.store.rows.get(id)!.terminal_reason, reason, kind)
    assert.equal(terminals(h.events)[0]!.reason, reason, kind)
    assert.equal(h.tg.sends.length, notices, kind)
  }
})

test('(e) 续跑里再答应"稍后做" → chained_request=true，取走丢弃，不登记新行', async () => {
  const h = harness({ reply: REPLY, cycleKind: 'followup', chained: true })
  const id = h.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })!
  await h.runner.scan(T0)
  assert.equal(h.store.rows.size, 1)
  assert.equal(h.store.rows.get(id)!.state, 'completed')
  assert.equal(terminals(h.events)[0]!.chained_request, true)
  assert.equal(h.conv.taken(), 1)
  assertNoBody(h.events)
})

test('(f) 过期：pending 超过 TTL → expired 终局 + 回执，不起回合', async () => {
  const h = harness({ reply: REPLY, cycleKind: 'reply' })
  h.store.seed('c-old', { due_at: pyIso(at(-CONTINUATION_TTL_S - 1)) })
  h.store.seed('c-fresh', { due_at: pyIso(at(-CONTINUATION_TTL_S + 60)) })
  const summary = await h.runner.scan(T0)
  assert.deepEqual(summary, { skipped: false, claimed: 1, expired: 1 })
  assert.equal(h.store.rows.get('c-old')!.state, 'expired')
  assert.equal(h.store.rows.get('c-fresh')!.state, 'completed')
  assert.equal(h.conv.sends.length, 1)
  const expired = terminals(h.events).find((t) => t.continuation_id === 'c-old')!
  assert.equal(expired.state, 'expired')
  assert.equal(expired.reason, null)
  assert.equal(expired.run_id, null)
  assert.deepEqual(h.tg.sends.map((s) => s.text), [CONTINUATION_FAILURE_NOTICE('expired')])
})

test('(g) 启动扫描：上个进程留下的 running 行 → failed(interrupted) + 回执，不重跑', async () => {
  const h = harness({ reply: REPLY, cycleKind: 'reply' })
  h.store.seed('c-run', { state: 'running', run_id: 'continuation-c-run' })
  h.store.seed('c-wait', { due_at: pyIso(at(60)) })
  assert.equal(await h.runner.recoverOnStartup(T0), 1)
  assert.equal(h.store.rows.get('c-run')!.state, 'failed')
  assert.equal(h.store.rows.get('c-run')!.terminal_reason, 'interrupted')
  assert.equal(h.store.rows.get('c-wait')!.state, 'pending')
  assert.equal(h.conv.sends.length, 0)
  const [t] = terminals(h.events)
  assert.equal(t!.reason, 'interrupted')
  assert.equal(t!.run_id, 'continuation-c-run')
  assert.deepEqual(h.tg.sends.map((s) => s.text), [CONTINUATION_FAILURE_NOTICE('interrupted')])
})

test('(h) 互斥与上限：扫描进行中再扫 → skipped 并在收尾补扫；一次最多 SCAN_LIMIT 条', async () => {
  let release!: () => void
  const wait = new Promise<void>((r) => { release = r })
  const h = harness({ reply: '', cycleKind: 'silence', gate: { release, wait } })
  // 四条都已到期（c-0 最早），第一圈只认领三条。
  for (let i = 0; i < CONTINUATION_SCAN_LIMIT + 1; i++) {
    h.store.seed(`c-${i}`, { due_at: pyIso(at(i - CONTINUATION_SCAN_LIMIT - 1)) })
  }
  const first = h.runner.scan(T0)
  await new Promise((r) => setImmediate(r))
  assert.equal(h.conv.sends.length, 1, '第一条已进入回合并悬着')
  assert.deepEqual(await h.runner.scan(T0), { skipped: true, claimed: 0, expired: 0 })
  // 悬着期间新登记一行：补扫要把它捡起来。
  h.runner.register({ originTurnId: 'tg:late', originRunId: null, goal: GOAL })
  release()
  const summary = await first
  assert.equal(summary.skipped, false)
  // 4 条种子 + 1 条新登记 = 5，全部由第一次扫描（含补扫）认领完。
  assert.equal(summary.claimed, CONTINUATION_SCAN_LIMIT + 2)
  assert.equal([...h.store.rows.values()].every((r) => r.state === 'completed'), true)
  // 认领序 = due_at 升序。
  assert.deepEqual(h.conv.sends.slice(0, 3).map((s) => s.opts.turnId), ['c-0', 'c-1', 'c-2'])
})

test('(i) 登记失败 → continuation/register_failed，返回 null；kick 的拒绝走 onError', async () => {
  const h = harness({ reply: '' })
  h.store.registerThrows = true
  assert.equal(h.runner.register({ originTurnId: 'tg:1', originRunId: 'r', goal: GOAL }), null)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(h.events, [{
    type: 'continuation/register_failed', continuation_id: `cont-tg:1-${T0.getTime()}`,
    origin_turn_id: 'tg:1', origin_run_id: 'r', goal_chars: [...GOAL].length, error_name: 'SqliteBusy',
  }])
  assertNoBody(h.events)
})

test('(j) 回执出口：无传输 / 无 owner 绑定 / 发送抛错 → continuation/notice_failed，不抛', async () => {
  const absent = harness({ error: new Error('x') }, { telegram: 'absent' })
  absent.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })
  await absent.runner.scan(T0)
  assert.deepEqual(absent.events.filter((e) => e.type === 'continuation/notice_failed'),
    [{ type: 'continuation/notice_failed', reason: 'unknown', error_name: 'no_transport' }])

  const unbound = harness({ error: new Error('x') })
  unbound.store.owner = null
  unbound.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })
  await unbound.runner.scan(T0)
  assert.deepEqual(unbound.events.filter((e) => e.type === 'continuation/notice_failed'),
    [{ type: 'continuation/notice_failed', reason: 'unknown', error_name: 'no_owner_binding' }])

  const exploding = harness({ error: new Error('x') }, { telegram: 'throws' })
  exploding.runner.register({ originTurnId: 'tg:1', originRunId: null, goal: GOAL })
  await exploding.runner.scan(T0)
  assert.deepEqual(exploding.events.filter((e) => e.type === 'continuation/notice_failed'),
    [{ type: 'continuation/notice_failed', reason: 'unknown', error_name: 'TransportExploded' }])
  assertNoBody(exploding.events)
})

// ---- handleTurn 侧的登记（D-2） ----

const MESSAGE: InboundMessage = {
  userId: 'user_001', contextId: 'chat-1', isOwner: true, text: 'USER_BODY_SENTINEL',
  messageId: '100', updateId: 1,
}

function turnHarness(conv: { reply: string; error?: unknown; followup: string | null }) {
  const events: ({ type: string } & Record<string, unknown>)[] = []
  let followup = conv.followup
  const conversation = {
    async send() { if (conv.error !== undefined) throw conv.error; return conv.reply },
    hasFollowupRequest: () => followup !== null,
    takeFollowupRequest: () => { const t = followup; followup = null; return t },
    lastCycleOutcome: () => ({ kind: conv.reply ? 'reply' : 'silence', step: 0 }),
    takeDelegatedAsk: () => null,
    peekDelegatedAsk: () => null,
  } as unknown as Conversation
  const telegram = {
    async send() { return { sent: true, messageId: 'm' } },
    async sendReply() { return { outcome: 'delivered' } },
    async askAbout() { return { asked: false, status: 'none' } },
    outboundWired: () => true,
  }
  const ctx = {
    audit: { async record(e: { type: string }) { events.push(e as never) } },
    get: (name: string) => (name === 'telegram' ? telegram : undefined),
  } as unknown as Context
  const registered: { originTurnId: string; originRunId: string | null; goal: string }[] = []
  let kicks = 0
  const continuations = {
    register(input: { originTurnId: string; originRunId: string | null; goal: string }) {
      registered.push(input); return 'cont-x'
    },
    async scan() { return { skipped: false, claimed: 0, expired: 0 } },
    kick() { kicks += 1 },
  }
  return { ctx, conversation, continuations, registered, events, kicks: () => kicks }
}

test('handleTurn：replied + followup → 登记（turn/run id 原样）+ 终局带 continuation_id + kick', async () => {
  const h = turnHarness({ reply: 'ok', followup: GOAL })
  await handleTurn(h.ctx, h.conversation, MESSAGE, h.continuations)
  assert.deepEqual(h.registered, [{ originTurnId: 'tg:1', originRunId: 'converse-1-100', goal: GOAL }])
  const t = h.events.find((e) => e.type === 'turn/terminal')!
  assert.equal(t.status, 'replied')
  assert.equal(t.followup_registered, true)
  assert.equal(t.continuation_id, 'cont-x')
  assert.equal(h.kicks(), 1)
  assertNoBody(h.events)
})

test('handleTurn：failed 回合的 followup 不登记；无 followup 不登记；未接 runner 时零调用', async () => {
  const failed = turnHarness({ reply: '', error: new Error('boom'), followup: GOAL })
  await handleTurn(failed.ctx, failed.conversation, MESSAGE, failed.continuations)
  assert.deepEqual(failed.registered, [])
  assert.equal(failed.events.find((e) => e.type === 'turn/terminal')!.continuation_id, null)
  assert.equal(failed.kicks(), 0)

  const none = turnHarness({ reply: 'ok', followup: null })
  await handleTurn(none.ctx, none.conversation, MESSAGE, none.continuations)
  assert.deepEqual(none.registered, [])
  assert.equal(none.kicks(), 0)

  const unwired = turnHarness({ reply: 'ok', followup: GOAL })
  await handleTurn(unwired.ctx, unwired.conversation, MESSAGE)
  assert.equal(unwired.events.find((e) => e.type === 'turn/terminal')!.followup_registered, true)
  assert.equal(unwired.events.find((e) => e.type === 'turn/terminal')!.continuation_id, null)
})
