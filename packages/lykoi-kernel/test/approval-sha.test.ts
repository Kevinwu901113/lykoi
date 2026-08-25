/**
 * SPEC-KERNEL §2 sha256 实测表逐条对拍（M3-W2 出口判据之一）。
 *
 * A 段 = approval_conversation 10 条；B 段 = approval_interpreter 10 条。全部
 * 本机实算，与治理仓库 wo/WO-M3-SPEC-KERNEL/report.md §2 的前缀逐条相等。
 * 一个字改了就红 —— 这张表是"逐字迁移"这四个字的可执行形态。
 *
 * 口径：字数 = Python `len(str)`（码点数）= JS `[...s].length`。
 * clarify 两条骨架在活体是 `clarify_text` 里的 f-string；新体提成具名常量
 * （CLARIFY_HARD_TEMPLATE / CLARIFY_STANDARD_TEMPLATE），值含 `{description}`
 * 占位符 —— 与 §2 表里"骨架"的算法一致，sha 因此逐位相等。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import {
  AUDIT_ANSWER_ROUTED, AUDIT_EXECUTION, AUDIT_QUESTION,
  DENY_CONFIRM, EXEC_FAIL_TEMPLATE, EXEC_OK_NO_OUTPUT, EXEC_OK_TEMPLATE,
  EXEC_SKIPPED_TEMPLATE, EXPIRED_REPLY, QUESTION_TEMPLATE, RESULT_TRUNCATED,
  RETRACT_TEMPLATE,
} from '../src/approval-conversation.ts'
import {
  _AMBIGUOUS_CLARIFY, CLARIFY_HARD_TAIL, CLARIFY_HARD_TEMPLATE,
  CLARIFY_STANDARD_TEMPLATE, FAST_PATH_REASON, INTERPRET_ACTION_TEMPLATE,
  INTERPRET_ANSWER_TEMPLATE, INTERPRET_SYSTEM_PROMPT, LITERAL_DENY, LITERAL_EXECUTE,
} from '../src/approval-interpreter.ts'

function sha(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** [名字, 值, 期望字数, 期望 sha256 前缀 8]（前缀 = §2 表登记形态）。 */
type Row = [string, string, number, string]

const SECTION_A: Row[] = [
  ['QUESTION_TEMPLATE', QUESTION_TEMPLATE, 30, '886f07bf'],
  ['RETRACT_TEMPLATE', RETRACT_TEMPLATE, 51, 'a7019f4a'],
  ['DENY_CONFIRM', DENY_CONFIRM, 8, '0356d3db'],
  ['EXPIRED_REPLY', EXPIRED_REPLY, 16, '77da6f54'],
  ['EXEC_OK_TEMPLATE', EXEC_OK_TEMPLATE, 28, '5598a0de'],
  ['EXEC_OK_NO_OUTPUT', EXEC_OK_NO_OUTPUT, 25, '193cdb34'],
  ['EXEC_FAIL_TEMPLATE', EXEC_FAIL_TEMPLATE, 32, 'ab98ae11'],
  ['EXEC_SKIPPED_TEMPLATE', EXEC_SKIPPED_TEMPLATE, 30, '84cb462f'],
  ['RESULT_TRUNCATED', RESULT_TRUNCATED, 22, '14d81780'],
  // 第 10 条 = 审计事件名三串（§2 A 段末条）。
  ['AUDIT_QUESTION', AUDIT_QUESTION, 17, 'a1dca494'],
  ['AUDIT_ANSWER_ROUTED', AUDIT_ANSWER_ROUTED, 22, '471b23ec'],
  ['AUDIT_EXECUTION', AUDIT_EXECUTION, 18, 'da099786'],
]

const SECTION_B: Row[] = [
  ['INTERPRET_SYSTEM_PROMPT', INTERPRET_SYSTEM_PROMPT, 851, 'ed9c86d1'],
  ['INTERPRET_ACTION_TEMPLATE', INTERPRET_ACTION_TEMPLATE, 119, '5e070e34'],
  ['INTERPRET_ANSWER_TEMPLATE', INTERPRET_ANSWER_TEMPLATE, 81, '49f2d82b'],
  ['_AMBIGUOUS_CLARIFY', _AMBIGUOUS_CLARIFY, 57, 'a3450d3f'],
  ['LITERAL_EXECUTE', LITERAL_EXECUTE, 2, '32c8d373'],
  ['LITERAL_DENY', LITERAL_DENY, 2, '77af2f33'],
  ['FAST_PATH_REASON', FAST_PATH_REASON, 24, 'e0be634c'],
  ['CLARIFY_HARD_TAIL', CLARIFY_HARD_TAIL, 39, '7d9641cf'],
  ['CLARIFY_HARD_TEMPLATE', CLARIFY_HARD_TEMPLATE, 69, '3181b45f'],
  ['CLARIFY_STANDARD_TEMPLATE', CLARIFY_STANDARD_TEMPLATE, 41, '61e4ecb6'],
]

test('§2 A 段：approval_conversation 10 条 sha256 + 字数逐条对拍', () => {
  for (const [name, value, chars, prefix] of SECTION_A) {
    assert.equal([...value].length, chars, `${name} 字数`)
    assert.equal(sha(value).slice(0, 8), prefix, `${name} sha256`)
  }
})

test('§2 B 段：approval_interpreter 10 条 sha256 + 字数逐条对拍', () => {
  for (const [name, value, chars, prefix] of SECTION_B) {
    assert.equal([...value].length, chars, `${name} 字数`)
    assert.equal(sha(value).slice(0, 8), prefix, `${name} sha256`)
  }
})
