/**
 * **孪生对面**（SK-72：rules schema 孪生双拷贝是结构要求）。
 *
 * 这一份测试就是「两份必须同义」这条约束本身：同一批输入，同时喂给
 *  - 业务侧 `lykoi-kernel` 的 `validateRules`，
 *  - 门这一侧 `lykoi-gate` 的 `rulesSchemaProblems`，
 * 两边的**判定结论**（合格 / 不合格，以及不合格的条数）必须一致。任一份漂了，
 * 这条测试就红 —— 孪生不是靠人记得同步，是靠这条测试。
 *
 * 外加一条结构断言：门这一份**不许 import 任何业务包**。判官与被判者分离是
 * 双拷贝存在的全部理由；如果门靠 import 被判者的函数来判案，篡改被判者的人
 * 同时也换掉了判官。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { validateRules } from 'lykoi-kernel'
import { rulesSchemaProblems } from '../src/rules-schema.ts'

/** 覆盖 schema 的每一条分支：顶层三键 / 未知顶层键 / autonomous 子块 / 非对象。 */
const CASES: { label: string; input: unknown; ok: boolean }[] = [
  { label: '空三键（kernel 铺的默认）', input: { always_allow: [], always_deny: [], ask: [] }, ok: true },
  { label: '三键都缺（全部默认成空表）', input: {}, ok: true },
  { label: '正常规则', input: { always_allow: ['browser.navigate'], always_deny: ['browser.pay'], ask: [] }, ok: true },
  { label: '带 autonomous 子块', input: { always_allow: [], always_deny: [], ask: [], autonomous: { always_allow: ['messenger.send'], always_deny: [] } }, ok: true },
  { label: 'autonomous 子块只给一半', input: { always_allow: [], autonomous: { always_allow: [] } }, ok: true },

  { label: '文档不是对象（数组）', input: [], ok: false },
  { label: '文档不是对象（null）', input: null, ok: false },
  { label: '文档不是对象（字符串）', input: 'always_allow', ok: false },
  { label: 'always_allow 不是表', input: { always_allow: 'browser.*' }, ok: false },
  { label: 'always_allow 表里有非字符串', input: { always_allow: ['a', 7] }, ok: false },
  { label: 'always_deny 表里有对象', input: { always_deny: [{}] }, ok: false },
  { label: 'ask 是数字', input: { ask: 3 }, ok: false },
  { label: '未知顶层键', input: { always_allow: [], surprise: [] }, ok: false },
  { label: 'autonomous 不是对象', input: { autonomous: [] }, ok: false },
  { label: 'autonomous.always_allow 不是表', input: { autonomous: { always_allow: 'x' } }, ok: false },
  { label: 'autonomous 里有未知键', input: { autonomous: { always_allow: [], ask: [] } }, ok: false },
  { label: '两处同时坏（条数也要一致）', input: { always_allow: 1, autonomous: { always_deny: 2 } }, ok: false },
]

test('孪生对面：kernel validateRules 与 gate rulesSchemaProblems 逐例同判', () => {
  for (const { label, input, ok } of CASES) {
    const kernel = validateRules(input)
    const gate = rulesSchemaProblems(input)
    assert.equal(kernel.length === 0, ok, `kernel 侧判错了：${label}`)
    assert.equal(gate.length === 0, ok, `gate 侧判错了：${label}`)
    assert.equal(
      kernel.length, gate.length,
      `两份不同义（问题条数不等）：${label}\n  kernel=${JSON.stringify(kernel)}\n  gate=${JSON.stringify(gate)}`,
    )
  }
})

test('孪生对面：`autonomous: null` 两份都当"没这个块"（不是坏块）', () => {
  const input = { always_allow: [], always_deny: [], ask: [], autonomous: null }
  assert.deepEqual(validateRules(input), [])
  assert.deepEqual(rulesSchemaProblems(input), [])
})

test('判官与被判者分离：门这一份 import 的东西是**空的**（零业务包）', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'rules-schema.ts'), 'utf8')
  const imports = [...source.matchAll(/^\s*import\s.*?from\s*'([^']+)'/gm)].map((m) => m[1]!)
  assert.deepEqual(imports, [], `门的 schema 孪生不许 import 任何东西，实际：${JSON.stringify(imports)}`)
})

test('门的其余源文件只 import `node:*`、本包、以及 root 属主域的治理核', () => {
  const srcDir = join(import.meta.dirname, '..', 'src')
  const allowed = (spec: string): boolean =>
    spec.startsWith('node:')
    || spec.startsWith('./')
    || spec === 'lykoi-kernel/policy-core'
    || spec === 'lykoi-kernel/path-guard'
  for (const file of ['surface.ts', 'manifest.ts', 'vocabulary.ts', 'verify.ts', 'cli.ts', 'index.ts']) {
    const source = readFileSync(join(srcDir, file), 'utf8')
    for (const match of source.matchAll(/^\s*(?:import|export)\s.*?from\s*'([^']+)'/gm)) {
      assert.equal(allowed(match[1]!), true, `${file} import 了业务包：${match[1]}`)
    }
  }
})
