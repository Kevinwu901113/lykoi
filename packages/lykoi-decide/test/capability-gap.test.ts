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
  GAP_NOT_WIRED,
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
  // WO-FIX-LOOP-01 D-1e：追加 not_wired（末位，不改前 5 项顺序/字面值）。
  assert.deepEqual([...GAP_REASONS], [
    'unknown_action', 'unknown_kind', 'kind_not_in_candidates',
    'no_execution_branch', 'not_registered', 'not_wired',
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

test('位点①（kind 词表判定）：未知 kind 明确抛错并记录 capability_gap', () => {
  const { logEvent, events } = recorder()
  assert.throws(
    () => evaluateMessage(
      msg({ decision: { kind: 'send_email', content: 'x' } }), CANDS,
      { logEvent, gap: { source: 'wake', runId: 'run-1' } },
    ),
    /unknown decision kind:.*send_email/,
    '记录能力缺口不能代替拒绝未知动作',
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

for (const gap of [{ source: 'wake' as const, runId: 'run-2' }, undefined]) {
  test(`unavailable selection fails and reports capability gap (${gap?.source ?? 'unknown source'})`, () => {
    const { logEvent, events } = recorder()
    assert.throws(() => evaluateMessage(msg({ decision: { kind: 'queue_notification', content: 'hi' } }),
      CANDS, { logEvent, gap }), /decision is not available/)
    assert.deepEqual(gaps(events), [{ wanted: 'queue_notification', source: gap?.source ?? null,
      run_id: gap?.runId ?? null, reason: 'kind_not_in_candidates' }])
    assert.deepEqual(events.map(([name]) => name), ['capability_gap'])
  })
}

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
  assert.deepEqual(gaps(events), [], '能力在位就不许报缺口')
})

test('有能力的动作不因理由未逐字引用而被替换', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({
      meaning_assessment: [{ item: '未整合数 3', meaning: '积压的经验值得看一眼', pull: 0.5 }],
      decision: { kind: 'explore', url: 'https://x.example', reason: '我就是想出去逛逛' },
    }),
    CANDS, { logEvent, gap: { source: 'wake', runId: 'run-4' } },
  )
  assert.deepEqual(events, [])
  assert.equal(d.kind, 'explore')
  assert.deepEqual(gaps(events), [], '没接地 ≠ 没有这个能力 —— 两件事不许混成一条账')
})

test('D-1e：GAP_NOT_WIRED 字面值 = not_wired，且能作为 emitCapabilityGap 的 reason 落盘', () => {
  assert.equal(GAP_NOT_WIRED, 'not_wired')
  const { logEvent, events } = recorder()
  emitCapabilityGap(logEvent, {
    wanted: 'research_open', reason: GAP_NOT_WIRED, source: 'converse', runId: 'run-9',
  })
  assert.deepEqual(gaps(events), [{
    wanted: 'research_open', source: 'converse', run_id: 'run-9', reason: 'not_wired',
  }])
})

test('选择 rest 不产生能力缺口', () => {
  const { logEvent, events } = recorder()
  const d = evaluateMessage(
    msg({ decision: { kind: 'rest', reason: '' } }), CANDS,
    { logEvent, gap: { source: 'wake', runId: 'run-5' } },
  )
  assert.equal(d.kind, 'rest')
  assert.deepEqual(events, [])
  assert.deepEqual(gaps(events), [])
})
