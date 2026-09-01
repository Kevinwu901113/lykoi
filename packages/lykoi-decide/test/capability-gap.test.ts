/**
 * `capability_gap` 一等事件（WO-U2-SENSE-01）——本包这一半：
 * 标签闸 / fail-safe / 位点①（kind 词表）/ 位点②（候选表）/ 两组对照。
 *
 * 断言口径：事件名一律**精确相等**（`e[0] === 'capability_gap'`），不做子串
 * 匹配 —— 2026-09-01 的教训：子串 grep 会把 `capability_gap_something` 之类的
 * 名字算进来，也会被一条恰好含这几个字的正文骗过去。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  CAPABILITY_GAP_EVENT,
  GAP_REASONS,
  WANTED_TOKEN_MAX,
  capabilityToken,
  emitCapabilityGap,
  evaluateMessage,
  type Candidate,
  type LogEvent,
} from '../src/index.ts'

const CANDS: Candidate[] = [
  { kind: 'explore', weight: 0.5, cost: 'c', note: 'n' },
  { kind: 'record_note', weight: 0.4, cost: 'c', note: 'n' },
  { kind: 'rest', weight: 0.5, cost: '0', note: 'n' },
]

function msg(payload: unknown): { content: string } {
  return { content: JSON.stringify(payload) }
}

function recorder(): { logEvent: LogEvent; events: [string, Record<string, unknown>][] } {
  const events: [string, Record<string, unknown>][] = []
  return { logEvent: (name, fields) => void events.push([name, fields]), events }
}

/** **精确匹配**（全等，非子串）：这是本单的取证口径。 */
function gaps(
  events: readonly [string, Record<string, unknown>][],
): Record<string, unknown>[] {
  return events.filter(([n]) => n === 'capability_gap').map(([, f]) => f)
}

const GROUNDED_ASSESSMENT = [
  { item: '未整合数 3', meaning: '积压的经验值得看一眼', concern_id: 7, pull: 0.6 },
]

test('名字不分叉：导出的常量 === 发射点里的字面量（门的遥测扫描只认字面量）', () => {
  assert.equal(CAPABILITY_GAP_EVENT, 'capability_gap')
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'capability-gap.ts'), 'utf8')
  assert.equal(
    src.includes("logEvent?.('capability_gap', {"), true,
    '发射点必须是字面量 —— 换成常量，这个名字在完整性门的词汇扫描里会隐形',
  )
  // reason 值域是一张表，不是散字符串。
  assert.deepEqual([...GAP_REASONS], [
    'unknown_action', 'unknown_kind', 'kind_not_in_candidates',
    'no_execution_branch', 'not_registered',
  ])
})

test('标签闸（隐私）：≤20 字原样、超过只记长度**不截断**、非串/空/缺席各有档', () => {
  assert.equal(WANTED_TOKEN_MAX, 20)
  assert.equal(capabilityToken('send_email'), 'send_email')
  assert.equal(capabilityToken('  browser_navigat  '), 'browser_navigat', 'strip 后比长度')
  assert.equal(capabilityToken('x'.repeat(20)), 'x'.repeat(20), '边界：恰 20 原样')
  const long = '帮我把这段话发到群里然后再顺手订一张明天的机票谢谢'
  assert.equal(capabilityToken(long), `unrecognized:len${[...long].length}`)
  assert.equal(capabilityToken(long).includes('帮我'), false, '超长值一个字都不许漏出来')
  assert.equal(capabilityToken(''), 'blank')
  assert.equal(capabilityToken('   '), 'blank')
  assert.equal(capabilityToken(null), 'missing')
  assert.equal(capabilityToken(undefined), 'missing')
  assert.equal(capabilityToken({ kind: 'x' }), 'nonstring')
  assert.equal(capabilityToken(7), 'nonstring')
})

test('fail-safe：事件写失败不毁一轮（logEvent 抛 → emit 不抛；对齐 bindings_failed 先例）', () => {
  assert.doesNotThrow(() => emitCapabilityGap(
    () => { throw new Error('audit sink 挂了') },
    { wanted: 'terminal_exec', reason: 'unknown_action', source: 'converse', runId: 'r1' },
  ))
  // sink 缺席同样不抛（logEvent 是可选注入位）。
  assert.doesNotThrow(() => emitCapabilityGap(
    undefined, { wanted: 'x', reason: 'unknown_kind' },
  ))
})

test('位点①（kind 词表判定）：未知 kind → capability_gap；**抛错语义逐字节不变**', () => {
  const { logEvent, events } = recorder()
  assert.throws(
    () => evaluateMessage(
      msg({ decision: { kind: 'send_email', content: 'x' } }), CANDS,
      { logEvent, gap: { source: 'wake', runId: 'run-1' } },
    ),
    /unknown decision kind: 'send_email'/,
    '原拒绝（抛错 + 消息逐字）不许被留痕改写',
  )
  assert.deepEqual(gaps(events), [{
    wanted: 'send_email', source: 'wake', run_id: 'run-1', reason: 'unknown_kind',
  }])
})

test('位点①：kind 非字符串同样留痕（wanted 落 nonstring，原始值不进事件）', () => {
  const { logEvent, events } = recorder()
  assert.throws(() => evaluateMessage(
    msg({ decision: { kind: { name: '秘密工具' }, content: 'x' } }), CANDS,
    { logEvent, gap: { source: 'converse', runId: null } },
  ))
  assert.deepEqual(gaps(events), [{
    wanted: 'nonstring', source: 'converse', run_id: null, reason: 'unknown_kind',
  }])
  assert.equal(JSON.stringify(events).includes('秘密工具'), false)
})

test('位点②（候选过滤）：kind 不在本拍候选表 → 降级照旧 + capability_gap 补一笔', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: GROUNDED_ASSESSMENT,
      decision: { kind: 'queue_notification', content: 'hi', reason: '积压的经验值得看一眼' },
    }),
    CANDS, // 表里没有 queue_notification
    { injectedConcernIds: [7], logEvent, gap: { source: 'wake', runId: 'run-2' } },
  )
  // 原拒绝语义逐字节不变。
  assert.equal(d.kind, 'rest')
  assert.equal(d.demoted, true)
  assert.equal(d.demote_why, 'kind_not_in_candidates')
  assert.equal(d.original_kind, 'queue_notification')
  assert.deepEqual(d.grounded_concern_ids, [])
  // 顺序：护栏账在前，旁路留痕在后。
  assert.deepEqual(events.map(([n]) => n), ['decision_ungrounded', 'capability_gap'])
  assert.deepEqual(gaps(events), [{
    wanted: 'queue_notification', source: 'wake', run_id: 'run-2',
    reason: 'kind_not_in_candidates',
  }])
})

test('gap 情境栏缺席：事件照发，source/run_id 记 null（不编造来源）', () => {
  const { logEvent, events } = recorder()
  evaluateMessage(
    msg({
      meaning_assessment: GROUNDED_ASSESSMENT,
      decision: { kind: 'queue_notification', content: 'hi', reason: '积压的经验值得看一眼' },
    }),
    CANDS, { injectedConcernIds: [7], logEvent },
  )
  assert.deepEqual(gaps(events), [{
    wanted: 'queue_notification', source: null, run_id: null,
    reason: 'kind_not_in_candidates',
  }])
})

test('对照组 A：合法且在候选表的 kind → **零** capability_gap', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: GROUNDED_ASSESSMENT,
      decision: { kind: 'explore', url: 'https://example.org', reason: '积压的经验值得看一眼' },
    }),
    CANDS, { injectedConcernIds: [7], logEvent, gap: { source: 'wake', runId: 'run-3' } },
  )
  assert.equal(d.kind, 'explore')
  assert.equal(d.demoted, false)
  assert.deepEqual(gaps(events), [], '能力在位就不许报缺口')
})

test('对照组 B：reason 未接地的降级 → decision_ungrounded 有，capability_gap **零**', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: [{ item: '未整合数 3', meaning: '积压的经验值得看一眼', pull: 0.5 }],
      decision: { kind: 'explore', url: 'https://x.example', reason: '我就是想出去逛逛' },
    }),
    CANDS, { logEvent, gap: { source: 'wake', runId: 'run-4' } },
  )
  assert.equal(d.demote_why, 'reason_not_grounded')
  assert.equal(events.map(([n]) => n).includes('decision_ungrounded'), true)
  assert.deepEqual(gaps(events), [], '没接地 ≠ 没有这个能力 —— 两件事不许混成一条账')
})

test('对照组 C：safe_kind（rest）永不降级 → 零事件、零 gap', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({ decision: { kind: 'rest', reason: '' } }), CANDS,
    { logEvent, gap: { source: 'wake', runId: 'run-5' } },
  )
  assert.equal(d.kind, 'rest')
  assert.deepEqual(events, [])
  assert.deepEqual(gaps(events), [])
})
