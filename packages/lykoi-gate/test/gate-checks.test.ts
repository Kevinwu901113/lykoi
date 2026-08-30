/**
 * 七检查项逐条：**先全绿，再每项各一条红测**（SK-71；蓝图 W4「每个检查项各有
 * 一条红测」）。
 *
 * 一条测试 = 一个受保护面上的一次真攻击 + 门必须逮住它。绿的那一半在
 * `red-green.test.ts`（篡改一字节 → 红 → 恢复 → 绿）。
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  checkAuditSink, checkEnvPins, checkEventVocabulary, checkGateOwnership, checkManifest,
  checkPathGuard, checkProtectedTree, checkRules, verify,
} from '../src/verify.ts'
import { manifestPath } from '../src/manifest.ts'
import { makeFixture, signManifest } from './fixture.ts'

/** 跑一个检查项，返回问题清单。 */
function run(check: (env: never, problems: string[]) => void, env: unknown): string[] {
  const problems: string[] = []
  ;(check as (e: unknown, p: string[]) => void)(env, problems)
  return problems
}

// ============================== 全绿基线 ==============================

test('七检查项：合成受保护树上 verify() 全绿（红绿双验的"绿"基线）', () => {
  const fx = makeFixture()
  try {
    assert.deepEqual(verify(fx.env), [])
  } finally {
    fx.cleanup()
  }
})

// ============================== ① 受保护源属主与不可组/他人写 ==============================

test('①红：门自己的源文件变成组可写 → 红（门先证明自己没被换掉）', () => {
  const fx = makeFixture()
  try {
    const target = join(fx.repoRoot, 'packages', 'lykoi-gate', 'src', 'verify.ts')
    chmodSync(target, 0o664) // 组可写
    const problems = run(checkGateOwnership, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /writable by group\/other/)
    assert.match(problems[0]!, /lykoi-gate\/src\/verify\.ts$|verify\.ts: writable/)
  } finally {
    fx.cleanup()
  }
})

test('①红：门的源目录整个不在 → 红（不是"没什么可查"，是失败）', () => {
  const fx = makeFixture()
  try {
    rmSync(join(fx.repoRoot, 'packages', 'lykoi-gate', 'src'), { recursive: true, force: true })
    const problems = run(checkGateOwnership, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /gate source dir missing/)
  } finally {
    fx.cleanup()
  }
})

// ============================== ② 受保护树 + 影蔽面 ==============================

test('②红：`packages/` 这一层组可写 → 红（整包替换的那一层，活体 src/lykoi 同位）', () => {
  const fx = makeFixture()
  try {
    chmodSync(join(fx.repoRoot, 'packages'), 0o775)
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /packages: writable by group\/other/)
  } finally {
    fx.cleanup()
  }
})

test('②a红（.pyc 影蔽面的新体对应物）：受保护 src 里出现构建产物 .js → 红', () => {
  const fx = makeFixture()
  try {
    // 与 policy-core.ts 平行的第二真相。源码一个字节没改，manifest 照样全绿 ——
    // 逮住它的只能是影蔽面检查。
    writeFileSync(
      join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'policy-core.js'),
      'module.exports = { HARD_ASK_TYPES: new Set() }\n',
    )
    assert.deepEqual(run(checkManifest, fx.env), [], 'manifest 对 .js 无话可说（正是问题所在）')
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /build artifact shadows protected source/)
    assert.match(problems[0]!, /policy-core\.js$/)
  } finally {
    fx.cleanup()
  }
})

test('②a红：受保护 src 里长出 dist/ 目录 → 红', () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'dist'))
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /build\/resolution artifact inside protected src/)
  } finally {
    fx.cleanup()
  }
})

test('②a红：受保护 src 里塞一条 symlink → 红（不受 manifest 约束的内容通道）', () => {
  const fx = makeFixture()
  try {
    symlinkSync('/etc/hosts', join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'sneaky.ts'))
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /protected src contains a symlink/)
  } finally {
    fx.cleanup()
  }
})

test('②b红（包解析劫持）：node_modules/lykoi-kernel 换成真目录 → 红（不改源、改解析）', () => {
  const fx = makeFixture()
  try {
    const link = join(fx.repoRoot, 'node_modules', 'lykoi-kernel')
    unlinkSync(link)
    mkdirSync(link)
    writeFileSync(join(link, 'package.json'), '{ "name": "lykoi-kernel", "main": "evil.js" }\n')
    // 受保护树里的源文件一个字节都没变：
    assert.deepEqual(run(checkManifest, fx.env), [], 'manifest 全绿（正是问题所在）')
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /workspace link is not a symlink \(resolution hijack\)/)
  } finally {
    fx.cleanup()
  }
})

test('②b红：workspace 链接指到受保护树之外 → 红', () => {
  const fx = makeFixture()
  try {
    const link = join(fx.repoRoot, 'node_modules', 'lykoi-gate')
    const elsewhere = join(fx.repoRoot, 'packages', 'lykoi-wake')
    unlinkSync(link)
    symlinkSync(elsewhere, link)
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /points outside the protected tree/)
  } finally {
    fx.cleanup()
  }
})

test('②红：人格 TOML 的父目录组可写 → 红（换掉整个目录 = 换掉人格）', () => {
  const fx = makeFixture()
  try {
    chmodSync(join(fx.personaToml, '..'), 0o775)
    const problems = run(checkProtectedTree, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /persona[\s\S]*writable by group\/other|writable by group\/other/)
  } finally {
    fx.cleanup()
  }
})

// ============================== ③ GK-6 env 钉面 ==============================

test('③红：治理 state 路径被 env 重定向 → 红（活体原本就钉的三条之一）', () => {
  const fx = makeFixture()
  try {
    const env = { ...fx.env, environ: { LYKOI_APPROVAL_RULES: '/tmp/evil_rules.json' } }
    const problems = run(checkEnvPins, env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /LYKOI_APPROVAL_RULES redirects a governance path/)
  } finally {
    fx.cleanup()
  }
})

test('③红（GK-6 收紧面）：活体**未**钉的 standing_grants 被重定向 → 新体红', () => {
  const fx = makeFixture()
  try {
    const env = { ...fx.env, environ: { LYKOI_STANDING_GRANTS: '/tmp/evil_grants.json' } }
    const problems = run(checkEnvPins, env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /LYKOI_STANDING_GRANTS redirects a governance path/)
  } finally {
    fx.cleanup()
  }
})

test('③红（W3#5 出站六路）：六条出站路径逐条重定向 → 逐条红', () => {
  const fx = makeFixture()
  try {
    const six = [
      'LYKOI_CHAT_OUTBOX', 'LYKOI_TELEGRAM_UNDELIVERED', 'LYKOI_TELEGRAM_OUTBOX_CURSOR',
      'LYKOI_MESSENGER_LEDGER', 'LYKOI_MESSENGER_TRANSPORT_LOG',
    ]
    for (const name of six) {
      const problems = run(checkEnvPins, { ...fx.env, environ: { [name]: '/tmp/elsewhere' } })
      assert.equal(problems.length, 1, `${name} 未被逮住`)
      assert.match(problems[0]!, new RegExp(`^${name} redirects`))
    }
    // 第六条是代理：设了就红（没有 canonical 可言）。
    const proxy = run(checkEnvPins, { ...fx.env, environ: { LYKOI_TELEGRAM_PROXY: 'http://127.0.0.1:8080' } })
    assert.equal(proxy.length, 1)
    assert.match(proxy[0]!, /LYKOI_TELEGRAM_PROXY must be unset in production/)
  } finally {
    fx.cleanup()
  }
})

test('③红（旋钮类）：unit 文件里覆盖 pending TTL → 红（没有签名的治理变更）', () => {
  const fx = makeFixture()
  try {
    const problems = run(checkEnvPins, { ...fx.env, environ: { LYKOI_PENDING_TTL_S: '99999999' } })
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /LYKOI_PENDING_TTL_S overrides a governance knob/)
  } finally {
    fx.cleanup()
  }
})

test('③：密钥类**永不比对值** —— 设成什么都不红，只有空串红', () => {
  const fx = makeFixture()
  try {
    const ok = run(checkEnvPins, { ...fx.env, environ: { LYKOI_TELEGRAM_BOT_TOKEN: '123456:AAHfake' } })
    assert.deepEqual(ok, [], 'token 的值不该被门检查')
    const empty = run(checkEnvPins, { ...fx.env, environ: { LYKOI_TELEGRAM_BOT_TOKEN: '' } })
    assert.equal(empty.length, 1)
    assert.match(empty[0]!, /is set but empty/)
    // 失败信息里一个字节的 token 都不许出现。
    assert.equal(empty[0]!.includes('AAHfake'), false)
  } finally {
    fx.cleanup()
  }
})

// ============================== ④ path guard 自检 ==============================

test('④红：治理核的 PROTECTED_PATHS 被清空（守卫不再护 secrets）→ 红', () => {
  const fx = makeFixture()
  try {
    const problems = run(checkPathGuard, { ...fx.env, isProtectedPath: () => false })
    assert.equal(problems.length, 2)
    assert.match(problems[0]!, /path guard does not protect the secrets dir/)
    assert.match(problems[1]!, /does not protect the integrity gate itself/)
  } finally {
    fx.cleanup()
  }
})

test('④红：守卫写太宽（把工作区也封了）→ 红（过度封锁同样是失败）', () => {
  const fx = makeFixture()
  try {
    const problems = run(checkPathGuard, { ...fx.env, isProtectedPath: () => true })
    assert.equal(problems.length, 2)
    assert.match(problems[0]!, /over-blocks the workspace/)
    assert.match(problems[1]!, /over-blocks the new-body workspace/)
  } finally {
    fx.cleanup()
  }
})

// ============================== ⑤ manifest 三向核对 + 反向核对 ==============================

test('⑤红：manifest 不存在 = FAILURE（no silent bootstrap，活体逐字）', () => {
  const fx = makeFixture()
  try {
    unlinkSync(manifestPath(fx.repoRoot))
    const problems = run(checkManifest, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /manifest missing.*--write-manifest/)
  } finally {
    fx.cleanup()
  }
})

test('⑤红（正向）：受保护面新增一个文件却没重签 → "protected but not in manifest"', () => {
  const fx = makeFixture()
  try {
    writeFileSync(join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'backdoor.ts'), 'export const x = 1\n')
    const problems = run(checkManifest, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /backdoor\.ts: protected but not in manifest \(re-sign required\)/)
  } finally {
    fx.cleanup()
  }
})

test('⑤红（反向核对）：把文件挪出受保护面就想随便改它 → 反向核对逮住', () => {
  const fx = makeFixture()
  try {
    // 「挪出受保护面」= 改名成一个 protectedEntries() 不再产出的 key（.ts → .txt），
    // manifest 里那一行于是变成"不在受保护面里"的条目 —— 走反向核对那一半。
    const from = join(fx.repoRoot, 'packages', 'lykoi-someorgan', 'src', 'organ.ts')
    const to = join(fx.repoRoot, 'packages', 'lykoi-someorgan', 'src', 'organ.txt')
    renameSync(from, to)
    const gone = run(checkManifest, fx.env)
    assert.ok(gone.some((p) => /organ\.ts: in manifest but file is gone/.test(p)), gone.join(' | '))

    // 更狠的一手：改回来但改内容 —— 正向哈希不符。
    renameSync(to, from)
    writeFileSync(from, "logEvent('organ_did_a_thing', {})\n// evil\n")
    const tampered = run(checkManifest, fx.env)
    assert.equal(tampered.length, 1)
    assert.match(tampered[0]!, /organ\.ts: hash mismatch \(tampered\?\)/)
  } finally {
    fx.cleanup()
  }
})

test('⑤：hash-pin 域是**补集**——新加一个包不登记也自动被收进受保护面', () => {
  const fx = makeFixture()
  try {
    mkdirSync(join(fx.repoRoot, 'packages', 'lykoi-brandnew', 'src'), { recursive: true })
    writeFileSync(join(fx.repoRoot, 'packages', 'lykoi-brandnew', 'src', 'a.ts'), 'export const a = 1\n')
    const problems = run(checkManifest, fx.env)
    assert.ok(
      problems.some((p) => /lykoi-brandnew\/src\/a\.ts: protected but not in manifest/.test(p)),
      problems.join(' | '),
    )
    // 重签之后绿：这就是 GOV-01 那条部署纪律（改了就 root 重签）。
    signManifest(fx.env)
    assert.deepEqual(run(checkManifest, fx.env), [])
  } finally {
    fx.cleanup()
  }
})

// ============================== ⑥ rules 硬门核对 ==============================

test('⑥红：顶层 always_allow 塞进硬门动作 → 红（terminal.exec 永不自动批准）', () => {
  const fx = makeFixture()
  try {
    writeFileSync(fx.rulesPath, JSON.stringify({
      always_allow: ['terminal.exec'], always_deny: [], ask: [],
    }) + '\n')
    const problems = run(checkRules, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /auto-allows hard-gated "terminal\.exec"/)
  } finally {
    fx.cleanup()
  }
})

test('⑥红（第二处 always_allow）：autonomous 子块塞硬门动作 → 同样红（defense in depth）', () => {
  const fx = makeFixture()
  try {
    writeFileSync(fx.rulesPath, JSON.stringify({
      always_allow: [], always_deny: [], ask: [],
      autonomous: { always_allow: ['delegation.dispatch'], always_deny: [] },
    }) + '\n')
    const problems = run(checkRules, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /autonomous\.always_allow auto-allows hard-gated "delegation\.dispatch"/)
  } finally {
    fx.cleanup()
  }
})

test('⑥红：schema 不合（always_allow 不是字符串表）→ 红', () => {
  const fx = makeFixture()
  try {
    writeFileSync(fx.rulesPath, JSON.stringify({ always_allow: [1, 2], always_deny: [], ask: [] }) + '\n')
    const problems = run(checkRules, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /always_allow must be a list of strings/)
  } finally {
    fx.cleanup()
  }
})

test('⑥：规则文件不存在 → 不红（kernel 会铺空默认，没有什么可放宽的）', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.rulesPath)
    assert.deepEqual(run(checkRules, fx.env), [])
  } finally {
    fx.cleanup()
  }
})

// ============================== ⑥b 事件词汇分流 ==============================

test('⑥b红（V1）：immutable 事件被改名 → 红', () => {
  const fx = makeFixture()
  try {
    const dispatch = join(fx.repoRoot, 'packages', 'lykoi-kernel', 'src', 'dispatch.ts')
    writeFileSync(dispatch, "const intent = { type: 'action_emitted' }\nexport { intent }\n")
    const problems = run(checkEventVocabulary, fx.env)
    assert.ok(problems.some((p) => /immutable type action_dispatch no longer emitted/.test(p)), problems.join(' | '))
  } finally {
    fx.cleanup()
  }
})

test('⑥b红（V2 碰撞自动发现）：新出现一个同名双发 → 红（交集算出来的，不是抄的）', () => {
  const fx = makeFixture()
  try {
    writeFileSync(
      join(fx.repoRoot, 'packages', 'lykoi-someorgan', 'src', 'organ.ts'),
      "logEvent('action_result', { note: 'telemetry twin nobody declared' })\n",
    )
    const problems = run(checkEventVocabulary, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /dual-channel names drifted/)
    assert.match(problems[0]!, /action_result/)
  } finally {
    fx.cleanup()
  }
})

test('⑥b红（V3 盖章在位）：遥测适配器不再盖 channel 章 → 红', () => {
  const fx = makeFixture()
  try {
    writeFileSync(
      join(fx.repoRoot, 'packages', 'lykoi-wake', 'src', 'index.ts'),
      'export const adapter = (name, fields) => audit.record({ type: name, ...fields })\n',
    )
    const problems = run(checkEventVocabulary, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /no longer stamps channel:'telemetry'/)
    assert.match(problems[0]!, /indistinguishable in audit\.jsonl/)
  } finally {
    fx.cleanup()
  }
})

// ============================== ⑦ audit sink 供给六断言 ==============================

test('⑦红①：sink 是符号链 → 红，且**立刻返回**（别的都不用看了）', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.auditPath)
    symlinkSync('/tmp/elsewhere.jsonl', fx.auditPath)
    const problems = run(checkAuditSink, fx.env)
    assert.deepEqual(problems, [`audit sink ${fx.auditPath} is a symlink`])
  } finally {
    fx.cleanup()
  }
})

test('⑦红②：sink 不存在 → 红', () => {
  const fx = makeFixture()
  try {
    unlinkSync(fx.auditPath)
    const problems = run(checkAuditSink, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /audit sink missing/)
  } finally {
    fx.cleanup()
  }
})

test('⑦红③：sink 非 root 属主 → 红', () => {
  const fx = makeFixture()
  try {
    const problems = run(checkAuditSink, { ...fx.env, rootUid: fx.env.rootUid + 1 })
    assert.ok(problems.some((p) => /not root-owned/.test(p)), problems.join(' | '))
  } finally {
    fx.cleanup()
  }
})

test('⑦红④：服务用户不能 append（sink 只读）→ 红', () => {
  const fx = makeFixture()
  try {
    chmodSync(fx.auditPath, 0o444)
    const problems = run(checkAuditSink, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /not appendable by the service user/)
  } finally {
    fx.cleanup()
  }
})

test('⑦红⑤：append-only 属性没有 → 红；**探针读不出来（null）也红**（fail closed）', () => {
  const fx = makeFixture()
  try {
    const off = run(checkAuditSink, { ...fx.env, appendOnlyProbe: () => false })
    assert.equal(off.length, 1)
    assert.match(off[0]!, /missing append-only attribute/)

    const unknown = run(checkAuditSink, { ...fx.env, appendOnlyProbe: () => null })
    assert.equal(unknown.length, 1, '「读不出来」≠「有」')
    assert.match(unknown[0]!, /missing append-only attribute/)
  } finally {
    fx.cleanup()
  }
})

test('⑦红⑥：sink 的父目录组可写 → 红（能换掉目录就能换掉账本）', () => {
  const fx = makeFixture()
  try {
    chmodSync(join(fx.auditPath, '..'), 0o775)
    const problems = run(checkAuditSink, fx.env)
    assert.equal(problems.length, 1)
    assert.match(problems[0]!, /audit sink directory .* writable by group\/other/)
  } finally {
    fx.cleanup()
  }
})
