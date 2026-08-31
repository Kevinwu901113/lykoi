/**
 * 检查项⑧ · state 落点调和三态（WO-STATE-CANON 判据①；定案 D-SC-1）。
 *
 * 被检事实只有一条：仓库相对 `var/state` 必须是**符号链接**，且 realpath 等于
 * 规范 state 目录。它是「源码缺省全是相对路径 `var/state/…`」与「钉面 canonical
 * 全是 `/home/lykoi/state/…`」之间**唯一**的调和物 —— 定案刻意不改源码相对缺省、
 * 不加 unit env，所以落点会不会分叉，全落在这一条链接上。
 *
 * 三态逐条（缺失那一态是本单的实勘现场：2026-09-01 01:18 的止损重启让服务进程
 * 自己在仓库内 mkdir 了一个真实 `var/state/` 并写进去一个游标）：
 *
 *  - 是 symlink 且 realpath = canonical → 全绿
 *  - **真实目录 → FAIL**（分叉已经发生）
 *  - **不存在 → 同样 FAIL**（运行期 writeJsonAtomic 会 mkdir，缺失 = 未来分叉）
 *
 * 断言走 `verify()` 而不是只走单检查项：`cli.ts`（ExecStartPre）调的就是它，
 * 「新检查项真的挂进了生产那一次调用」这件事必须是被测出来的，不是看着像的。
 *
 * 时钟纪律：本文件**零时间语义**（不播种钟、不读钟）。
 */
import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import test from 'node:test'
import { CHECKS, checkStateCanon, productionEnv, verify } from '../src/verify.ts'
import { STATE_CANONICAL, STATE_LINK_REL } from '../src/surface.ts'
import { makeFixture } from './fixture.ts'

// ============================== 态一：正确 symlink → OK ==============================

test('⑧态一（正确）：var/state 是指向 canonical state 目录的符号链接 → verify() 全绿', () => {
  const fx = makeFixture()
  try {
    assert.equal(lstatSync(fx.stateLink).isSymbolicLink(), true, '夹具立的必须真是一条符号链接')
    assert.deepEqual(verify(fx.env), [])
  } finally {
    fx.cleanup()
  }
})

// ============================== 态二：真实目录 → FAIL ==============================

test('⑧态二（真实目录）：var/state 是真实目录 → FAIL（分叉已经发生）', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.stateLink)
    mkdirSync(fx.stateLink) // 01:18 那次止损重启在生产机上留下的正是这个形态
    const red = verify(fx.env)
    assert.equal(red.length, 1, red.join(' | '))
    assert.match(red[0]!, /state landing is not a symlink \(forked state\)/)
    assert.match(red[0]!, /real directory/)
    // 讯息必须说清「该指向哪里」，否则值班的人只知道红了不知道怎么修。
    assert.ok(red[0]!.includes(fx.stateCanonical), red[0]!)
  } finally {
    fx.cleanup()
  }
})

test('⑧态二变体：var/state 是个普通文件 → 同样 FAIL', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.stateLink)
    writeFileSync(fx.stateLink, 'not a directory\n')
    const red = verify(fx.env)
    assert.equal(red.length, 1, red.join(' | '))
    assert.match(red[0]!, /state landing is not a symlink/)
    assert.match(red[0]!, /regular file/)
  } finally {
    fx.cleanup()
  }
})

// ============================== 态三：缺失 → 同样 FAIL ==============================

test('⑧态三（缺失）：var/state 不存在 → 同样 FAIL（缺失 = 未来分叉，不是"没什么可查"）', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.stateLink)
    const red = verify(fx.env)
    assert.equal(red.length, 1, red.join(' | '))
    assert.match(red[0]!, /state landing missing/)
    // 为什么缺失也算失败：运行期 writeJsonAtomic 会自己 mkdir 出真实目录。
    assert.match(red[0]!, /mkdir/)
  } finally {
    fx.cleanup()
  }
})

test('⑧态三变体：连 var/ 父目录都不在 → 同样 FAIL（全新树落地后的形态）', () => {
  const fx = makeFixture()
  try {
    rmSync(dirname(fx.stateLink), { recursive: true, force: true })
    const red = verify(fx.env)
    assert.equal(red.length, 1, red.join(' | '))
    assert.match(red[0]!, /state landing missing/)
  } finally {
    fx.cleanup()
  }
})

// ============================== 第四态：链接指到别处 ==============================

test('⑧：symlink 指到 canonical 之外 → FAIL（"是条链接"不等于"调和对了"）', () => {
  const fx = makeFixture()
  try {
    const elsewhere = mkdtempSync(fx.stateCanonical + '-elsewhere-')
    unlinkSync(fx.stateLink)
    symlinkSync(elsewhere, fx.stateLink)
    const red = verify(fx.env)
    assert.equal(red.length, 1, red.join(' | '))
    assert.match(red[0]!, /state landing points outside the canonical state dir/)
  } finally {
    fx.cleanup()
  }
})

// ============================== 接入面 ==============================

test('⑧：检查项挂在 CHECKS 里（= ExecStartPre 那一次 verify() 真的会跑到它）', () => {
  const names = CHECKS.map(([name]) => name)
  assert.equal(names.includes('state_canon'), true, names.join(', '))
  // 单检查项直调与走 verify() 必须给同一个答案（没有第二条被绕开的路径）。
  const fx = makeFixture()
  try {
    unlinkSync(fx.stateLink)
    const problems: string[] = []
    checkStateCanon(fx.env, problems)
    assert.deepEqual(problems, verify(fx.env))
  } finally {
    fx.cleanup()
  }
})

test('⑧：生产缺省 —— canonical = /home/lykoi/state，落址 = var/state，且 env 改不动它', () => {
  assert.equal(STATE_CANONICAL, '/home/lykoi/state')
  assert.equal(STATE_LINK_REL, 'var/state')
  // 定案 D-SC-1「不加 unit env」：生产缺省直接取常量，**不经 env 解析**（对比
  // 同一个函数里的 rulesPath / auditPath 两条是 `environ.X ?? canonical`）——
  // 能被 env 换掉的 canonical 等于没有 canonical。
  assert.equal(productionEnv('/nonexistent-repo-root').stateCanonical, STATE_CANONICAL)
})
