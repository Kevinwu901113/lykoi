/**
 * path-guard（SK-74；guardian/path_guard.py 逐字迁）+ policy core 第三旋钮
 * （SK-73 `isProtectedPath`）。
 *
 * 这一份钉的是**真 realpath 语义**：等于自身 / 在其下 / 在外 / symlink 逃不出去 /
 * 解析失败 fail closed。完整性门检查项④在开发机上跑的是生产语义替身（那四条
 * 断言的路径在开发机不存在），所以真语义必须在这里、在真实存在的 tmpdir 路径上
 * 单独钉一遍 —— 两处合起来才等于生产上的那一次判定。
 *
 * 数据纪律：全程 tmpdir，零真 state。时钟纪律：零时间语义。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classify, isWithin } from '../src/path-guard.ts'
import { GATE_SOURCE_CANONICAL, PROTECTED_PATHS, isProtectedPath } from '../src/policy-core.ts'

function fixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-pathguard-'))
  mkdirSync(join(root, 'zone', 'nested'), { recursive: true })
  mkdirSync(join(root, 'outside'), { recursive: true })
  writeFileSync(join(root, 'zone', 'nested', 'secret.env'), 'TOKEN=x\n')
  writeFileSync(join(root, 'outside', 'plain.txt'), 'ok\n')
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('isWithin：等于自身 / 在其下 → true；在外 → false', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    assert.equal(isWithin(zone, zone), true, '等于 base 本身算在内')
    assert.equal(isWithin(join(zone, 'nested', 'secret.env'), zone), true)
    assert.equal(isWithin(join(fx.root, 'outside', 'plain.txt'), zone), false)
  } finally {
    fx.cleanup()
  }
})

test('isWithin：前缀相同但不是子路径 → false（zone-evil 不算 zone 里）', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    mkdirSync(join(fx.root, 'zone-evil'))
    // 纯字符串 startsWith 会在这里判错；分隔符那一下是必须的。
    assert.equal(isWithin(join(fx.root, 'zone-evil'), zone), false)
  } finally {
    fx.cleanup()
  }
})

test('isWithin：symlink 逃不出去 —— 指进禁区的链接判在内，指出去的判在外', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    // 禁区外的一条链接，指向禁区里的文件 → realpath 落回禁区 → 在内。
    const sneakIn = join(fx.root, 'outside', 'link-to-secret')
    symlinkSync(join(zone, 'nested', 'secret.env'), sneakIn)
    assert.equal(isWithin(sneakIn, zone), true, 'realpath 之后落在禁区里')

    // 禁区里的一条链接，指向禁区外 → realpath 落到外面 → 在外。
    const sneakOut = join(zone, 'link-out')
    symlinkSync(join(fx.root, 'outside', 'plain.txt'), sneakOut)
    assert.equal(isWithin(sneakOut, zone), false, '判的是 realpath 的落点，不是链接的住址')
  } finally {
    fx.cleanup()
  }
})

test('isWithin：".." 也逃不出去（realpath 先规整）', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    assert.equal(isWithin(join(zone, 'nested', '..', '..', 'outside'), zone), false)
    assert.equal(isWithin(join(zone, 'nested', '..', 'nested'), zone), true)
  } finally {
    fx.cleanup()
  }
})

test('isWithin：解析不出来 → **true**（fail closed；path_guard.py:19-21 逐字）', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    // 一个根本不存在的路径：realpath 抛 → 当作「在内」。
    assert.equal(isWithin(join(fx.root, 'nope', 'never', 'existed'), zone), true)
    // 这条语义的代价（也是它的正确方向）：完整性门检查项④在开发机上因此
    // 必然把生产禁区外的路径也判成在内 —— 见 lykoi-gate/test/fixture.ts 的说明。
    // 这里拿的就是检查项④换防后的那条探针路径（D-GD-2：canonical state）。
    assert.equal(isWithin('/home/lykoi/state', '/home/lykoi/secrets'), true)
  } finally {
    fx.cleanup()
  }
})

test('classify：落进任一禁区 → "deny"，否则 "allow"', () => {
  const fx = fixture()
  try {
    const zone = join(fx.root, 'zone')
    const other = join(fx.root, 'outside')
    assert.equal(classify(join(zone, 'nested', 'secret.env'), [zone]), 'deny')
    assert.equal(classify(join(other, 'plain.txt'), [zone]), 'allow')
    assert.equal(classify(join(other, 'plain.txt'), [zone, other]), 'deny', '任一命中即 deny')
    assert.equal(classify(join(other, 'plain.txt'), []), 'allow', '空禁区表 → 全放行')
  } finally {
    fx.cleanup()
  }
})

test('SK-73 第三旋钮：PROTECTED_PATHS 退役后两条 —— 活体 secrets 逐字保全 + GK-13 重划的门自身', () => {
  assert.deepEqual([...PROTECTED_PATHS], [
    '/home/lykoi/secrets',   // 活体逐字①
    GATE_SOURCE_CANONICAL,   // GK-13 重划：新体完整性门源目录
  ])
  // 活体逐字②（旧体 guardian `/home/lykoi/projects/lykoi/guardian`）随
  // WO-CORE-RETIRE 封存旧仓到期退役（D-GD-1）；条目为什么必须跟着目录一起走，
  // 见下面那条 D-GD-3 机制钉。
  assert.equal(GATE_SOURCE_CANONICAL, '/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate')
})

test('SK-73：isProtectedPath = PROTECTED_PATHS 上的 any(isWithin)（两条禁区自身必受保护）', () => {
  for (const base of PROTECTED_PATHS) {
    assert.equal(isProtectedPath(base), true, base)
  }
  assert.equal(isProtectedPath('/home/lykoi/secrets/llm.env'), true)
})

test('D-GD-3 机制钉：base 不存在 → 对**任意存在的 path** 判 true（这是设计，不是缺陷）', () => {
  const fx = fixture()
  try {
    // 自造一条**从来没建过**的 base（不依赖本机有没有 /home/lykoi/*），
    // 拿真实存在、且明显不在它下面的路径去问。
    const vanished = join(fx.root, 'vanished-base')
    const alive = join(fx.root, 'outside', 'plain.txt')
    assert.equal(isWithin(alive, vanished), true, 'base 解析不出来 → fail closed 判在内')
    assert.equal(isWithin(join(fx.root, 'zone'), vanished), true, '换个存在的 path 也一样')
    // 毒化沿 classify 传播：任一 base 命中即 deny —— 所以一条失踪的 base
    // 足以让**整张**禁区表对一切路径答 deny。
    assert.equal(classify(alive, [vanished]), 'deny')
    assert.equal(classify(alive, [join(fx.root, 'zone'), vanished]), 'deny')

    // 这是 SK-74 的**设计方向**：读不出治理周界时她什么都够不着，而不是什么都
    // 够得着。代价 2026-09-01 冷启事故已实证：WO-CORE-RETIRE 封存旧仓后，
    // PROTECTED_PATHS 里的旧体 guardian base 从磁盘消失 → isProtectedPath 恒
    // true → 完整性门检查项④两条「不得误封」探针双 FAIL → ExecStartPre 拒启。
    // 修法是退役过期条目（D-GD-1），**不是**松开 fail closed —— 这一行为本身
    // 由本条钉住，谁要改 isWithin 先撞它。
  } finally {
    fx.cleanup()
  }
})

test('SK-73 fail closed 的代价（写明白，不绕过去）：禁区 base 解析不出来时**一切**判受保护', () => {
  const fx = fixture()
  try {
    // 开发机上 `/home/lykoi/*` 两条 base 一条都不存在 → isWithin 的
    // `except OSError: return True` 对每条 base 都成立 → 任何路径都判成在内。
    assert.equal(isProtectedPath(join(fx.root, 'outside', 'plain.txt')), true)

    // 这是**正确的方向**：base 没了 = 治理周界读不出来 = 她什么都够不着，
    // 而不是什么都够得着。代价是这个判定在生产之外没有分辨力，所以：
    //  - 完整性门检查项④在开发机上用生产语义替身跑（lykoi-gate/test/fixture.ts）；
    //  - 真 realpath 语义由本文件上面那几条在**真实存在**的 tmpdir 路径上钉死。
    // 用一张真实存在的禁区表验一次「有分辨力时确实分得开」：
    const zone = join(fx.root, 'zone')
    assert.equal(isWithin(join(zone, 'nested', 'secret.env'), zone), true)
    assert.equal(isWithin(join(fx.root, 'outside', 'plain.txt'), zone), false)
  } finally {
    fx.cleanup()
  }
})
