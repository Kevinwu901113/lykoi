/**
 * **红绿双验**（蓝图 W4 期末验收项：篡改受保护文件一字节必红、恢复即绿）。
 *
 * 一条测试跑一整圈：绿 → 改一个字节 → 红 → 把那个字节改回去 → 绿。
 * 两个域各跑一圈（root 属主域 / hash-pin 域），外加仓库外的两条（人格 TOML /
 * 活规则）与装配面（cordis.yml）。
 */
import assert from 'node:assert/strict'
import { join } from 'node:path'
import test from 'node:test'
import { verify } from '../src/verify.ts'
import { makeFixture, restore, tamperOneByte } from './fixture.ts'

/** 绿 → 篡改一字节 → 红（且红在预期的那一条上）→ 恢复 → 绿。 */
function roundTrip(t: { diagnostic(msg: string): void }, relOrAbs: string, absolute = false): void {
  const fx = makeFixture()
  try {
    const target = absolute ? relOrAbs : join(fx.repoRoot, relOrAbs)

    // ── 绿
    assert.deepEqual(verify(fx.env), [], '起手必须全绿')
    t.diagnostic(`GREEN  ${relOrAbs} -> 0 problems`)

    // ── 红（一个字节）
    const before = tamperOneByte(target)
    const red = verify(fx.env)
    assert.ok(red.length > 0, '篡改之后必须红')
    assert.ok(
      red.some((p) => /hash mismatch \(tampered\?\)/.test(p)),
      `红了但不是哈希不符：${red.join(' | ')}`,
    )
    t.diagnostic(`RED    ${relOrAbs} -> ${red.filter((p) => /hash mismatch/.test(p)).join(' ; ')}`)

    // ── 复绿
    restore(target, before)
    assert.deepEqual(verify(fx.env), [], '恢复之后必须复绿')
    t.diagnostic(`GREEN  ${relOrAbs} -> 0 problems (restored)`)
  } finally {
    fx.cleanup()
  }
}

test('红绿双验 · root 属主域：治理核 policy-core.ts 改一字节', (t) => {
  roundTrip(t, 'packages/lykoi-kernel/src/policy-core.ts')
})

test('红绿双验 · root 属主域：门自己的 verify.ts 改一字节', (t) => {
  roundTrip(t, 'packages/lykoi-gate/src/verify.ts')
})

test('红绿双验 · root 属主域（装配面 GK-13 重划）：profile/cordis.yml 改一字节', (t) => {
  roundTrip(t, 'profile/cordis.yml')
})

test('红绿双验 · hash-pin 域（GOV-01）：业务包源码改一字节', (t) => {
  roundTrip(t, 'packages/lykoi-someorgan/src/organ.ts')
})

test('红绿双验 · hash-pin 域：包的 package.json 改一字节（exports 面）', (t) => {
  roundTrip(t, 'packages/lykoi-wake/package.json')
})

test('红绿双验 · hash-pin 域：治理常数文档改一字节（活体 prereg 锚的对应物）', (t) => {
  roundTrip(t, 'docs/m3_blueprint.md')
})

test('红绿双验 · 仓库外：人格 TOML 改一字节（DA-11 那份文件）', (t) => {
  const fx = makeFixture()
  try {
    assert.deepEqual(verify(fx.env), [])
    const before = tamperOneByte(fx.personaToml)
    const red = verify(fx.env)
    assert.ok(red.some((p) => /hash mismatch/.test(p)), red.join(' | '))
    t.diagnostic(`RED    persona TOML -> ${red.filter((p) => /hash mismatch/.test(p)).join(' ; ')}`)
    restore(fx.personaToml, before)
    assert.deepEqual(verify(fx.env), [])
  } finally {
    fx.cleanup()
  }
})

test('红绿双验 · 仓库外：活规则文件 —— GK-15 后哈希面退役，检查项⑥仍红', (t) => {
  const fx = makeFixture()
  try {
    assert.deepEqual(verify(fx.env), [])
    const before = tamperOneByte(fx.rulesPath)
    const red = verify(fx.env)
    // GK-15（见 manifest.ts 顶注）：规则文件不再在钉面上，所以**不许**红在
    // hash mismatch 上 —— 红必须来自检查项⑥（这里 tamper 把 JSON 弄坏了 →
    // unreadable/schema 路）。合法改写（schema 仍合）不红的那一半在
    // manifest.test.ts 的 GK-15 回归测试里。
    assert.ok(!red.some((p) => /hash mismatch/.test(p)), red.join(' | '))
    assert.ok(red.some((p) => p.includes(fx.rulesPath)), red.join(' | '))
    t.diagnostic(`RED    approval_rules -> ${red.join(' ; ')}`)
    restore(fx.rulesPath, before)
    assert.deepEqual(verify(fx.env), [])
  } finally {
    fx.cleanup()
  }
})

test('红绿双验 · 删一个受保护文件也必红（不只是改）', async () => {
  const fx = makeFixture()
  try {
    assert.deepEqual(verify(fx.env), [])
    const target = join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'policy-core.ts')
    const before = tamperOneByte(target)
    restore(target, before) // 先证明这条路能复绿
    assert.deepEqual(verify(fx.env), [])

    const { rmSync } = await import('node:fs')
    rmSync(target)
    const red = verify(fx.env)
    assert.ok(
      red.some((p) => /policy-core\.ts: in manifest but file is gone|protected file missing/.test(p)),
      red.join(' | '),
    )
  } finally {
    fx.cleanup()
  }
})
