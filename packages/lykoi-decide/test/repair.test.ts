/**
 * WO-FIX-TAILBRACE-01 D-1/D-4：repairTrailingClosers —— 只补尾括号、不改合法
 * 输入、永不抛；总补齐上限 REPAIR_CLOSERS_MAX（含补的那个 `"`）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractJson, REPAIR_CLOSERS_MAX, repairTrailingClosers } from '../src/index.ts'

test('缺 `}` → 补一个', () => {
  assert.deepEqual(repairTrailingClosers('{"a":1'), { text: '{"a":1}', added: '}' })
})

test('缺 `}}`（嵌套对象）→ 按栈序补两个', () => {
  assert.deepEqual(
    repairTrailingClosers('{"decision":{"kind":"reply","content":"在的"'),
    { text: '{"decision":{"kind":"reply","content":"在的"}}', added: '}}' },
  )
})

test('缺 `]}` → 数组先闭、对象后闭', () => {
  assert.deepEqual(repairTrailingClosers('{"a":[1,2'), { text: '{"a":[1,2]}', added: ']}' })
})

test('字符串内的 `}` / `]` / `{` / `[` 不算括号', () => {
  const r = repairTrailingClosers('{"a":"x}y]z{w["')
  assert.deepEqual(r, { text: '{"a":"x}y]z{w["}', added: '}' })
  assert.deepEqual(JSON.parse(r!.text), { a: 'x}y]z{w[' })
})

test('转义引号不结束字符串；转义反斜杠不吞后面的引号', () => {
  const r1 = repairTrailingClosers('{"a":"say \\"hi\\""')
  assert.deepEqual(r1, { text: '{"a":"say \\"hi\\""}', added: '}' })
  assert.deepEqual(JSON.parse(r1!.text), { a: 'say "hi"' })
  const r2 = repairTrailingClosers('{"a":"back\\\\"')
  assert.equal(r2!.added, '}')
  assert.deepEqual(JSON.parse(r2!.text), { a: 'back\\' })
})

test('围栏包裹：```json 首行与末尾 ``` 剥掉再修；末尾围栏缺席（截断）也剥', () => {
  assert.deepEqual(repairTrailingClosers('```json\n{"a":1\n```'), { text: '{"a":1}', added: '}' })
  assert.deepEqual(repairTrailingClosers('```\n{"a":[1'), { text: '{"a":[1]}', added: ']}' })
})

test('首字符非 `{` → null（数组 / 前缀散文 / 空串 / 纯空白）', () => {
  assert.equal(repairTrailingClosers('[1,2'), null)
  assert.equal(repairTrailingClosers('好的，这是：{"a":1'), null)
  assert.equal(repairTrailingClosers(''), null)
  assert.equal(repairTrailingClosers('   \n'), null)
})

test('补齐上限：恰 4 个可修，5 个 → null（含补的那个 `"`）', () => {
  assert.equal(REPAIR_CLOSERS_MAX, 4)
  assert.deepEqual(
    repairTrailingClosers('{"a":{"b":{"c":{"d":1'),
    { text: '{"a":{"b":{"c":{"d":1}}}}', added: '}}}}' },
  )
  assert.deepEqual(
    repairTrailingClosers('{"a":[{"b":[1'),
    { text: '{"a":[{"b":[1]}]}', added: ']}]}' },
  )
  assert.equal(repairTrailingClosers('{"a":[[[[1'), null)
  assert.equal(repairTrailingClosers('{"a":{"b":{"c":{"d":"x'), null) // `"` + 4 = 5
})

test('已合法 → null（不改合法输入）', () => {
  assert.equal(repairTrailingClosers('{"a":1}'), null)
  assert.equal(repairTrailingClosers('{"decision":{"kind":"reply","content":"在的"}}'), null)
  assert.equal(repairTrailingClosers('  {"a":[1,2]}  \n'), null)
})

test('末尾在未闭合字符串内 → 先补 `"` 再补括号', () => {
  const r = repairTrailingClosers('{"decision":{"kind":"reply","content":"在的')
  assert.deepEqual(r, { text: '{"decision":{"kind":"reply","content":"在的"}}', added: '"}}' })
  const parsed = JSON.parse(r!.text) as { decision: { content: string } }
  assert.equal(parsed.decision.content, '在的')
})

test('括号错配 / 末尾悬空反斜杠 / 补完仍非法（尾逗号、缺值、裸键）→ null', () => {
  assert.equal(repairTrailingClosers('{"a":[1}'), null)
  assert.equal(repairTrailingClosers('{"a":"x\\'), null)
  assert.equal(repairTrailingClosers('{"a":1,'), null)
  assert.equal(repairTrailingClosers('{"a":'), null)
  assert.equal(repairTrailingClosers('{"trunc'), null) // 补 `"}` 得 {"trunc"} 仍非法
})

test('首尾空白先去掉；修复文本能被 extractJson 原样接住（同一个解析器）', () => {
  const r = repairTrailingClosers('\n  {"a":{"b":[1,2]  \n')
  assert.deepEqual(r, { text: '{"a":{"b":[1,2]}}', added: '}}' })
  assert.deepEqual(extractJson(r!.text), { a: { b: [1, 2] } })
})

test('永不抛：多余的右括号 → null', () => {
  assert.equal(repairTrailingClosers('{"a":1}}'), null)
  assert.equal(repairTrailingClosers('{}}'), null)
})
