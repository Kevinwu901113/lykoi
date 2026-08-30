/**
 * GK-9 部署期入口（`src/bootstrap-preauth.ts`）：S1B 解锁的验收断言、逐字节
 * 幂等、活体规则文件「原样搬」的格式兼容判定、坏文件零写入。
 *
 * 时钟纪律：本文件没有任何跨时刻的时间断言 —— 幂等判据是**文件字节**
 * （sha256 / readFileSync 对拍），不是 granted_at 的取值。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import {
  main, OWNER_PRIMARY_SQL, ownerPrimaryUserId, preflightRules, runOwnerPreauth,
} from '../src/bootstrap-preauth.ts'
import { check, rulesPath, setIdentityBindingLookup, standingPath } from '../src/index.ts'
import { isolateKernelState } from './fixture.ts'

const OWNER_ENTRY = 'messenger.send@user:user_001'

/** 一个带 owner_primary 行的真 state 库（DDL 单一出处 = lykoi-memory/testing）。 */
function stateDbWithOwner(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lykoi-preauth-db-'))
  const path = join(dir, 'memory.db')
  createStateFixture(path)
  return path
}

/** 捕获 CLI 两路输出。 */
function captureCli(): { log: (l: string) => void; err: (l: string) => void; out: string[]; errs: string[] } {
  const out: string[] = []
  const errs: string[] = []
  return { out, errs, log: (l) => out.push(l), err: (l) => errs.push(l) }
}

// ============================== owner 行读点 ==============================

test('owner_primary 读点：真库命中 + SQL 与 lykoi-memory rw 层逐字同义', () => {
  isolateKernelState()
  assert.equal(ownerPrimaryUserId(stateDbWithOwner()), 'user_001')
  // 孪生：kernel 不许 import 业务包，所以这条 SQL 是抄的 —— 抄漂了这里就红。
  const rw = readFileSync(new URL('../../lykoi-memory/src/rw.ts', import.meta.url), 'utf8')
  assert.ok(rw.includes(OWNER_PRIMARY_SQL), 'rw.ts 的 ownerPrimaryUserId 查询已漂移')
})

test('owner_primary 读点：所有者行被 archived → null（不代以任何默认用户）', () => {
  isolateKernelState()
  const path = stateDbWithOwner()
  const db = new DatabaseSync(path)
  try {
    db.prepare("UPDATE users SET status = 'archived' WHERE role = 'owner_primary'").run()
  } finally {
    db.close()
  }
  assert.equal(ownerPrimaryUserId(path), null)
})

// ============================== 规则文件体检 ==============================

test('preflight：活体形态的规则文件（类别前缀 + scoped 行 + autonomous 块）判为兼容', () => {
  isolateKernelState()
  // 「活体那份原样搬过来」的形态：精确类型、`*` 类别前缀、scoped 串、autonomous 子块。
  writeFileSync(rulesPath(), JSON.stringify({
    always_allow: ['messenger.send@user:user_001', 'research_browser.open'],
    always_deny: ['browser.pay', 'browser.*'],
    ask: [],
    autonomous: { always_allow: ['notify.owner'], always_deny: ['terminal.exec'] },
  }, null, 2))
  const pre = preflightRules()
  assert.deepEqual(pre.problems, [], '新体读者应当原样收下活体格式')
  assert.equal(pre.exists, true)
  assert.ok(pre.alwaysAllow.includes(OWNER_ENTRY))
  assert.equal(pre.sha256!.length, 64)
})

test('preflight：未知顶层键 / 坏 JSON / 文件不存在 三档', () => {
  isolateKernelState()
  assert.deepEqual(preflightRules(), {
    path: rulesPath(), exists: false, problems: [], alwaysAllow: [], sha256: null,
  })
  writeFileSync(rulesPath(), '{ not json')
  assert.match(preflightRules().problems[0]!, /not valid JSON/)
  writeFileSync(rulesPath(), JSON.stringify({ always_allow: [], always_deny: [], ask: [], legacy: [] }))
  assert.match(preflightRules().problems[0]!, /unknown top-level keys/)
})

// ============================== 安装 + 验收断言 ==============================

test('GK-9 验收：跑完 messenger.send 授权在册，S1B 死锁不成立', () => {
  isolateKernelState()
  setIdentityBindingLookup((c, k) => (c === 'telegram' && k === '1001' ? 'user_001' : null))
  // 起手：她要问 Kevin 一个问题 —— 问句自己撞在门上。这就是 S1B。
  assert.equal(check('messenger.send', 'interactive', { context_id: '1001' }), 'ask')

  const cli = captureCli()
  assert.equal(main(['--state-db', stateDbWithOwner()], cli), 0)

  // 验收①：授权行真的在文件里（不信返回值，重读）。
  assert.ok(preflightRules().alwaysAllow.includes(OWNER_ENTRY))
  // 验收②：门当场放行 —— 问句发得出去。
  assert.equal(check('messenger.send', 'interactive', { context_id: '1001' }), 'allow')
  // 验收③：授权仍是**最窄的一个键** —— 换个没绑定的收件人照样问。
  assert.equal(check('messenger.send', 'interactive', { context_id: '9999' }), 'ask')
  assert.ok(cli.out.some((l) => l.includes('S1B 死锁不成立')), cli.out.join('\n'))
  assert.deepEqual(cli.errs, [])
})

test('GK-9 幂等：授权行已在册 → already 路径，规则与 sidecar **逐字节不变**', () => {
  isolateKernelState()
  const stateDb = stateDbWithOwner()
  const first = runOwnerPreauth({ stateDb })
  assert.deepEqual(first.granted, [OWNER_ENTRY])
  assert.deepEqual(first.already, [])
  assert.equal(first.changed, true)

  const rulesBytes = readFileSync(rulesPath())
  const standingBytes = readFileSync(standingPath())

  const second = runOwnerPreauth({ stateDb })
  assert.deepEqual(second.granted, [], '重放不该再授一次')
  assert.deepEqual(second.already, [OWNER_ENTRY])
  assert.deepEqual(second.missing, [])
  assert.equal(second.changed, false)
  assert.equal(second.sha_before, second.sha_after)
  // 规则文件在哈希钉面上：重放写它 = manifest 失配 = 启动闸红。
  assert.deepEqual(readFileSync(rulesPath()), rulesBytes, '规则文件被重写了')
  // sidecar 同样一个字节都不许动：一次纯确认不该在账面上留下像新授权的记录。
  assert.deepEqual(readFileSync(standingPath()), standingBytes, 'standing sidecar 被刷新了')
})

test('GK-9「原样搬」：既有 always_deny / autonomous / 类别前缀全部原封不动', () => {
  isolateKernelState()
  writeFileSync(rulesPath(), JSON.stringify({
    always_allow: ['research_browser.open'],
    always_deny: ['browser.pay', 'browser.*'],
    ask: [],
    autonomous: { always_allow: ['notify.owner'], always_deny: ['terminal.exec'] },
  }, null, 2))
  const report = runOwnerPreauth({ stateDb: stateDbWithOwner() })
  assert.deepEqual(report.missing, [])
  const doc = JSON.parse(readFileSync(rulesPath(), 'utf8'))
  assert.deepEqual(doc.always_deny, ['browser.pay', 'browser.*'], '收紧面被动过')
  assert.deepEqual(doc.autonomous, { always_allow: ['notify.owner'], always_deny: ['terminal.exec'] })
  assert.deepEqual(doc.always_allow, ['research_browser.open', OWNER_ENTRY], '预授权应当是追加一行')
})

test('坏规则文件：体检不过 → exit 2，一个字节都不写（收紧面绝不被静默清空）', () => {
  isolateKernelState()
  // 畸形文件走 _load 会 fail closed 回空默认，紧接着的 _persist 会把 always_deny
  // 一起抹掉 —— 所以入口必须先体检、后开工。
  const poisoned = '{"always_allow": [], "always_deny": ["browser.pay"], "ask": [], "legacy": 1}'
  writeFileSync(rulesPath(), poisoned)
  const cli = captureCli()
  assert.equal(main(['--state-db', stateDbWithOwner()], cli), 2)
  assert.equal(readFileSync(rulesPath(), 'utf8'), poisoned)
  assert.equal(existsSync(standingPath()), false)
  assert.ok(cli.errs.some((l) => l.includes('unknown top-level keys')), cli.errs.join('\n'))
})

test('--dry-run：只体检不写；already/待授予 分开报', () => {
  isolateKernelState()
  const stateDb = stateDbWithOwner()
  const cli = captureCli()
  assert.equal(main(['--state-db', stateDb, '--dry-run'], cli), 0)
  assert.equal(existsSync(rulesPath()), false, 'dry-run 连空规则文件都不该铺出来')
  assert.ok(cli.out.some((l) => l.includes(`待授予  = ["${OWNER_ENTRY}"]`)), cli.out.join('\n'))

  runOwnerPreauth({ stateDb })
  const again = captureCli()
  assert.equal(main(['--state-db', stateDb, '--dry-run'], again), 0)
  assert.ok(again.out.some((l) => l.includes('真跑将是纯确认')), again.out.join('\n'))
})

// ============================== 前置条件缺失 ==============================

test('无 owner_primary 行 → exit 3，明说 S1B 仍然成立，且什么都没授', () => {
  isolateKernelState()
  const path = stateDbWithOwner()
  const db = new DatabaseSync(path)
  try {
    db.prepare("UPDATE users SET status = 'archived' WHERE role = 'owner_primary'").run()
  } finally {
    db.close()
  }
  const cli = captureCli()
  assert.equal(main(['--state-db', path], cli), 3)
  assert.ok(cli.errs.some((l) => l.includes('S1B')), cli.errs.join('\n'))
  assert.equal(existsSync(standingPath()), false)
})

test('state 库不存在 → exit 2（体检项，不是"没有所有者"）', () => {
  isolateKernelState()
  const cli = captureCli()
  assert.equal(main(['--state-db', join(mkdtempSync(join(tmpdir(), 'lykoi-preauth-')), 'nope.db')], cli), 2)
  assert.ok(cli.errs.some((l) => l.includes('state db not found')), cli.errs.join('\n'))
})

test('CLI 用法：--help=0；缺 --state-db=1；旗标缺值=1；--rules/--standing 改写目标文件', () => {
  const dir = isolateKernelState()
  const help = captureCli()
  assert.equal(main(['--help'], help), 0)
  assert.ok(help.out[0]!.includes('--state-db'))
  assert.equal(main([], captureCli()), 1)
  assert.equal(main(['--state-db'], captureCli()), 1)
  assert.equal(main(['--state-db', 'x.db', '--rules'], captureCli()), 1)

  // 两个旗标都落在 GK-6 已钉的 env 名上；改写后授权写去别处。
  const other = mkdtempSync(join(tmpdir(), 'lykoi-preauth-alt-'))
  const altRules = join(other, 'approval_rules.json')
  const altStanding = join(other, 'standing_grants.json')
  const cli = captureCli()
  assert.equal(main([
    '--state-db', stateDbWithOwner(), '--rules', altRules, '--standing', altStanding,
  ], cli), 0)
  assert.ok(JSON.parse(readFileSync(altRules, 'utf8')).always_allow.includes(OWNER_ENTRY))
  assert.equal(existsSync(altStanding), true)
  assert.equal(existsSync(join(dir, 'approval_rules.json')), false, '缺省路径不该被碰')
})

// ============================== 结构 ==============================

test('结构：入口不从 index 导出（运行时 import 不到）+ 零业务包 import', () => {
  const src = readFileSync(new URL('../src/bootstrap-preauth.ts', import.meta.url), 'utf8')
  const index = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  assert.ok(!index.includes('bootstrap-preauth'), '部署期入口不挂启动：不许从 index 导出')
  const specs = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]!)
  const bad = specs.filter((s) => !s.startsWith('node:') && !s.startsWith('./'))
  assert.deepEqual(bad, [], 'kernel 反向 import 业务包一次都不许（CF-B1）')
  // 只碰已钉的两个 env 名（GK-6 检查项③方向：扫到的 ⊆ 钉住的）。
  const envs = new Set([...src.matchAll(/LYKOI_[A-Z0-9_]+/g)].map((m) => m[0]))
  assert.deepEqual([...envs].sort(), ['LYKOI_APPROVAL_RULES', 'LYKOI_STANDING_GRANTS'])
})
