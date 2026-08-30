/**
 * manifest 生成器的**纯函数性**与「签的=验的」（GK-13：清单生成器纯函数）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  computeManifest, manifestPath, parseManifest, protectedEntries, renderManifest, sha256File,
  type ProtectedEntry,
} from '../src/manifest.ts'
import { verify } from '../src/verify.ts'
import { makeFixture, signManifest } from './fixture.ts'

const ENTRIES: ProtectedEntry[] = [
  { name: 'b.ts', path: '/fake/b.ts', domain: 'root' },
  { name: 'a.ts', path: '/fake/a.ts', domain: 'hash' },
  { name: '/abs/persona.toml', path: '/abs/persona.toml', domain: 'root' },
]
/** 零 I/O 的哈希替身：纯函数层根本不该碰磁盘。 */
const fakeSha = (path: string): string => `sha(${path})`

test('computeManifest 是纯函数：零 I/O、按 name 排序、同输入同输出', () => {
  const once = computeManifest(ENTRIES, fakeSha)
  const twice = computeManifest(ENTRIES, fakeSha)
  assert.deepEqual(once, twice)
  assert.deepEqual(once.map((l) => l.name), ['/abs/persona.toml', 'a.ts', 'b.ts'])
  assert.deepEqual(once.map((l) => l.digest), [
    'sha(/abs/persona.toml)', 'sha(/fake/a.ts)', 'sha(/fake/b.ts)',
  ])
  // 入参顺序变了，产物不变（排序在函数里，不靠调用方）。
  assert.deepEqual(computeManifest([...ENTRIES].reverse(), fakeSha), once)
})

test('render/parse 往返：`<digest>  <name>` 双空格；空行跳过；绝对名原样', () => {
  const lines = computeManifest(ENTRIES, fakeSha)
  const text = renderManifest(lines)
  assert.equal(text.endsWith('\n'), true)
  assert.equal(text.split('\n')[0], 'sha(/abs/persona.toml)  /abs/persona.toml')
  const parsed = parseManifest(text)
  assert.equal(parsed.size, 3)
  assert.equal(parsed.get('a.ts'), 'sha(/fake/a.ts)')
  assert.equal(parsed.get('/abs/persona.toml'), 'sha(/abs/persona.toml)')
  // 空行与前后空白不该产出条目。
  assert.equal(parseManifest('\n\n  \n' + text).size, 3)
})

test('清单可复算：同一棵树连签两次，字节完全相同', () => {
  const fx = makeFixture()
  try {
    const path = manifestPath(fx.repoRoot)
    const first = readFileSync(path, 'utf8')
    signManifest(fx.env)
    assert.equal(readFileSync(path, 'utf8'), first)
  } finally {
    fx.cleanup()
  }
})

test('签的=验的：protectedEntries 是唯一出处 —— 签完立刻验必绿', () => {
  const fx = makeFixture()
  try {
    const entries = protectedEntries(fx.repoRoot, {
      personaToml: fx.env.personaToml, rulesFile: fx.env.rulesFile,
    })
    const signed = parseManifest(readFileSync(manifestPath(fx.repoRoot), 'utf8'))
    // manifest 的键集 = 受保护面的键集，一条不多一条不少。
    assert.deepEqual([...signed.keys()].sort(), entries.map((e) => e.name).sort())
    for (const entry of entries) {
      assert.equal(signed.get(entry.name), sha256File(entry.path), entry.name)
    }
    assert.deepEqual(verify(fx.env), [])
  } finally {
    fx.cleanup()
  }
})

test('GK-13 两域：root 属主域与 hash-pin 域的成员划分（合成树上的终表形状）', () => {
  const fx = makeFixture()
  try {
    const entries = protectedEntries(fx.repoRoot, {
      personaToml: fx.env.personaToml, rulesFile: fx.env.rulesFile,
    })
    const rootNames = entries.filter((e) => e.domain === 'root').map((e) => e.name).sort()
    const hashNames = entries.filter((e) => e.domain === 'hash').map((e) => e.name).sort()

    // root 属主域：kernel 包 + gate 包 + 装配面 + 仓库外两条。
    assert.deepEqual(rootNames, [
      fx.env.personaToml,
      fx.env.rulesFile,
      'packages/lykoi-gate/package.json',
      'packages/lykoi-gate/src/verify.ts',
      'packages/lykoi-kernel/package.json',
      'packages/lykoi-kernel/src/dispatch.ts',
      'packages/lykoi-kernel/src/policy-core.ts',
      'profile/cordis.prod.yml',
      'profile/cordis.yml',
      'profile/index.ts',
      'profile/package.json',
    ].sort())

    // hash-pin 域：其余全部包 + 工程锚 + 治理常数文档。
    assert.deepEqual(hashNames, [
      'docs/m1_blueprint.md', 'docs/m2_blueprint.md', 'docs/m3_blueprint.md',
      'docs/m3_schema_registry.md', 'docs/m4_handoff.md',
      'package.json',
      'packages/lykoi-someorgan/package.json', 'packages/lykoi-someorgan/src/organ.ts',
      'packages/lykoi-wake/package.json', 'packages/lykoi-wake/src/index.ts',
      'tsconfig.json',
    ].sort())

    // 两域不相交、并集 = 全表。
    assert.equal(new Set([...rootNames, ...hashNames]).size, entries.length)
  } finally {
    fx.cleanup()
  }
})

test('真仓库：protectedEntries 覆盖 packages 下每一个 src 的 .ts（一个不漏）', () => {
  // 跑在真仓库上（只读）：受保护面必须把每一个源文件都圈进去。
  const repoRoot = join(import.meta.dirname, '..', '..', '..')
  const entries = protectedEntries(repoRoot)
  const names = new Set(entries.map((e) => e.name))
  for (const anchor of [
    'packages/lykoi-kernel/src/policy-core.ts',
    'packages/lykoi-kernel/src/path-guard.ts',
    'packages/lykoi-kernel/src/schema-registry.ts',
    'packages/lykoi-gate/src/verify.ts',
    'packages/lykoi-converse/src/conversation.ts',
    'packages/lykoi-adapter-telegram/src/outbox.ts',
    'profile/cordis.yml',
    'docs/m3_blueprint.md',
  ]) {
    assert.equal(names.has(anchor), true, `受保护面漏了 ${anchor}`)
  }
  // 域划分在真仓库上也对：kernel/gate/profile 是 root，其余是 hash。
  const domainOf = (n: string): string => entries.find((e) => e.name === n)!.domain
  assert.equal(domainOf('packages/lykoi-kernel/src/policy-core.ts'), 'root')
  assert.equal(domainOf('packages/lykoi-gate/src/verify.ts'), 'root')
  assert.equal(domainOf('profile/cordis.yml'), 'root')
  assert.equal(domainOf('packages/lykoi-converse/src/conversation.ts'), 'hash')
  assert.equal(domainOf('packages/lykoi-adapter-telegram/src/outbox.ts'), 'hash')
})

test('W3 TODO#4：proactive-chat.ts 与 interactive-lock.ts 归 root 属主域', () => {
  const repoRoot = join(import.meta.dirname, '..', '..', '..')
  const entries = protectedEntries(repoRoot)
  const domainOf = (n: string): string | undefined => entries.find((e) => e.name === n)?.domain

  // proactive-chat：**上限即策略**。DAILY_LIMIT 从 1 改成 100 就是一次没经审批的
  // 权限扩张，且审计里看不出异常（每条都合法过了 dispatch）→ 必须与 policy core 同域。
  assert.equal(domainOf('packages/lykoi-kernel/src/proactive-chat.ts'), 'root')

  // interactive-lock：它自己够不上（不判 allow/ask/deny，改坏它只影响让位礼让），
  // 是**包的域包住了它** —— GK-13 按包划域，不按文件挑，因为按文件挑会长出一张
  // 会过期的人工名单。理由逐条写在该文件顶注。
  assert.equal(domainOf('packages/lykoi-kernel/src/interactive-lock.ts'), 'root')

  // 同一条补集纪律的另一头：出站器官的账本住业务包，落 hash-pin 域。
  assert.equal(domainOf('packages/lykoi-adapter-telegram/src/messenger.ts'), 'hash')
})
