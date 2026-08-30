/**
 * 完整性门的红绿双验夹具：在 tmpdir 里立一棵**合成受保护树**，让七检查项跑真
 * 逻辑。
 *
 * 数据纪律：全程 tmpdir 副本，一个字节都不碰真 state（golden devstate 永远只读；
 * 她的行内容零输出 —— 这棵合成树里没有任何一行是她写的）。
 *
 * 「谁算 root」用 `rootUid = process.getuid()`：活体把 0 写死在
 * `st.st_uid != 0` 里，新体把同一个参数做成入参。除此之外检查项跑的是同一段
 * 逻辑 —— 属主比对、mode & 0o022、realpath、sha256、三向核对全是真的。
 *
 * 时钟纪律（W3 复核教训）：本夹具**零时间语义** —— 没有一条断言依赖「还活着 /
 * 没过期」，所以既不播种钟也不读钟。
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { PROTECTED_PATHS } from 'lykoi-kernel/policy-core'
import { computeManifest, manifestPath, protectedEntries, renderManifest, sha256File } from '../src/manifest.ts'
import type { GateEnv } from '../src/verify.ts'

/** 合成树里的 hash-pin 域业务包（补集定义，所以随便叫什么都该被自动收进去）。 */
export const FIXTURE_HASH_PINNED = ['lykoi-wake', 'lykoi-someorgan'] as const

export interface Fixture {
  repoRoot: string
  env: GateEnv
  personaToml: string
  rulesPath: string
  auditPath: string
  cleanup(): void
}

function write(path: string, content: string, mode = 0o644): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content, 'utf8')
  chmodSync(path, mode)
}

/** 目录一律 0755：组/他人不可写（检查项①②的 `mode & 0o022` 面）。 */
function dir(path: string): string {
  mkdirSync(path, { recursive: true })
  chmodSync(path, 0o755)
  return path
}

/**
 * 立一棵合成树并**签一次 manifest**，返回一个此刻应当全绿的 GateEnv。
 */
export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'lykoi-gate-'))
  const repoRoot = dir(join(root, 'repo'))

  // --- 工程锚 ---
  write(join(repoRoot, 'package.json'), JSON.stringify({ name: 'fixture', workspaces: ['packages/*'] }, null, 2) + '\n')
  write(join(repoRoot, 'tsconfig.json'), '{ "compilerOptions": { "noEmit": true } }\n')

  // --- 治理常数文档（PINNED_DOCS 全五条） ---
  for (const name of ['m1_blueprint', 'm2_blueprint', 'm3_blueprint', 'm3_schema_registry', 'm4_handoff']) {
    write(join(repoRoot, 'docs', `${name}.md`), `# ${name}\n`)
  }

  // --- root 属主域：kernel ---
  dir(join(repoRoot, 'packages'))
  dir(join(repoRoot, 'packages', 'lykoi-kernel'))
  dir(join(repoRoot, 'packages', 'lykoi-kernel', 'src'))
  write(join(repoRoot, 'packages', 'lykoi-kernel', 'package.json'), '{ "name": "lykoi-kernel" }\n')
  write(join(repoRoot, 'packages', 'lykoi-kernel', 'src', 'policy-core.ts'), 'export const HARD_ASK_TYPES = new Set()\n')
  // 事件词汇检查项（V1）的被检对象：immutable 三名必须真的发在这里。
  write(
    join(repoRoot, 'packages', 'lykoi-kernel', 'src', 'dispatch.ts'),
    [
      "const intent = { type: 'action_dispatch' }",
      "const result = { type: 'action_result' }",
      "const refusal = { type: 'delegation_context_invalid' }",
      "logEvent('delegation_context_invalid', {})",
      'export { intent, result, refusal }',
    ].join('\n') + '\n',
  )

  // --- root 属主域：门自身 ---
  dir(join(repoRoot, 'packages', 'lykoi-gate'))
  dir(join(repoRoot, 'packages', 'lykoi-gate', 'src'))
  write(join(repoRoot, 'packages', 'lykoi-gate', 'package.json'), '{ "name": "lykoi-gate" }\n')
  write(join(repoRoot, 'packages', 'lykoi-gate', 'src', 'verify.ts'), '// synthetic gate source\n')

  // --- hash-pin 域：其余包（补集定义应自动收进） ---
  for (const pkg of FIXTURE_HASH_PINNED) {
    dir(join(repoRoot, 'packages', pkg))
    dir(join(repoRoot, 'packages', pkg, 'src'))
    write(join(repoRoot, 'packages', pkg, 'package.json'), `{ "name": "${pkg}" }\n`)
  }
  // 事件词汇检查项（V3）的被检对象：遥测适配器的分流盖章。
  write(
    join(repoRoot, 'packages', 'lykoi-wake', 'src', 'index.ts'),
    "export const adapter = (name, fields) => audit.record({ type: name, channel: 'telemetry', ...fields })\n",
  )
  write(join(repoRoot, 'packages', 'lykoi-someorgan', 'src', 'organ.ts'), "logEvent('organ_did_a_thing', {})\n")

  // --- root 属主域：装配面 ---
  dir(join(repoRoot, 'profile'))
  write(join(repoRoot, 'profile', 'package.json'), '{ "name": "profile" }\n')
  write(join(repoRoot, 'profile', 'index.ts'), '// synthetic entrypoint\n')
  write(join(repoRoot, 'profile', 'cordis.yml'), '- id: audit\n')
  write(join(repoRoot, 'profile', 'cordis.prod.yml'), '- id: audit\n')

  // --- workspace 解析链接（检查项②b 的被检对象） ---
  dir(join(repoRoot, 'node_modules'))
  for (const pkg of ['lykoi-kernel', 'lykoi-gate']) {
    symlinkSync(join('..', 'packages', pkg), join(repoRoot, 'node_modules', pkg))
  }

  // --- 仓库外：人格 TOML / 活规则 / 审计 sink ---
  const personaToml = join(root, 'persona', 'lykoi_base.toml')
  write(personaToml, 'name = "lykoi"\n')
  chmodSync(dirname(personaToml), 0o755)
  const rulesPath = join(root, 'state', 'approval_rules.json')
  write(rulesPath, JSON.stringify({ always_allow: [], always_deny: [], ask: [] }) + '\n')
  const auditPath = join(root, 'log', 'audit.jsonl')
  write(auditPath, '')
  chmodSync(dirname(auditPath), 0o755)

  const env: GateEnv = {
    repoRoot,
    rootUid: process.getuid!(),
    environ: {}, // 生产钉面：路径未设 = 走已签名的缺省；旋钮未设 = 合格
    personaToml,
    rulesPath,
    rulesFile: rulesPath, // 合成树里读面与规范面同址（生产两者刻意可分，见 GateEnv 注释）
    auditPath,
    appendOnlyProbe: () => true, // 合成 sink 没有真的 chattr +a；探针替身答"有"
    isProtectedPath: productionSemanticsGuard,
  }

  signManifest(env)
  return { repoRoot, env, personaToml, rulesPath, auditPath, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

/**
 * 检查项④在**开发机上跑不了真守卫** —— 这不是缺陷，是活体同款语义的直接后果，
 * 所以在这里写明白而不是绕过去：
 *
 * 真 `isProtectedPath` 走 `path-guard.isWithin`，后者在 `realpath` 抛错时
 * **返回 true（fail closed）**（path_guard.py:19-21 逐字）。检查项④的四条断言
 * 用的全是生产规范路径（`/home/lykoi/...`），开发机上这些路径根本不存在 →
 * realpath 抛 → 一律判成「在内」→ 两条「不得过度封锁」的断言必红。
 *
 * 也就是说：**检查项④只有在那些路径真实存在的机器（= 生产）上才有意义**，
 * 活体也是如此（它只在服务器上作为 ExecStartPre 跑）。
 *
 * 于是绿基线用一个**生产语义替身**：同一张 `PROTECTED_PATHS` 表 + 纯前缀判定
 * （跳过 realpath），等价于「那些路径都存在且不是 symlink」时真守卫的答案。
 * 真守卫的 realpath 语义另有 `lykoi-kernel/test/path-guard.test.ts` 在真实存在
 * 的 tmpdir 路径上逐条钉（含 symlink 逃逸与 fail closed）；两处合起来才等于
 * 生产上的那一次判定。
 */
export function productionSemanticsGuard(path: string): boolean {
  return PROTECTED_PATHS.some((base) => path === base || path.startsWith(base + '/'))
}

/** 用当前树内容重签 manifest（`--write-manifest` 的等价调用）。 */
export function signManifest(env: GateEnv): void {
  const entries = protectedEntries(env.repoRoot, {
    personaToml: env.personaToml, rulesFile: env.rulesFile,
  })
  writeFileSync(manifestPath(env.repoRoot), renderManifest(computeManifest(entries, sha256File)), 'utf8')
}

/** 篡改一个文件**一个字节**（红绿双验的"红"那一半）。 */
export function tamperOneByte(path: string): string {
  const before = readFileSync(path, 'utf8')
  writeFileSync(path, before + 'x', 'utf8')
  return before
}

/** 恢复原状（红绿双验的"复绿"那一半）。 */
export function restore(path: string, content: string): void {
  writeFileSync(path, content, 'utf8')
}
