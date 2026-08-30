/**
 * manifest 生成器 —— **纯函数**（GK-13 明写「清单生成器纯函数」）。
 *
 * 正本：startup_verify.py `_protected_files` / `_write_manifest` /
 * `_check_manifest`（三向核对 + 反向核对）。
 *
 * 纯的意思是具体的：`computeManifest` / `renderManifest` / `parseManifest` 三个
 * 函数**不碰文件系统、不读时钟、不读 env** —— 哈希函数是入参。于是：
 *  1. 清单可复算：同一份 entries + 同一个 sha 实现 → 同一串字节；
 *  2. 生成与校验共用同一出处：`protectedEntries()` 一处产出受保护面，
 *     `--write-manifest` 与检查项⑤吃的是同一张表。签的和验的不可能分叉。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  PERSONA_TOML_CANONICAL, PINNED_DOCS, PINNED_ROOT_FILES, PROFILE_ROOT_OWNED_FILES,
  ROOT_OWNED_PACKAGES, collectTs, hashPinnedPackages, manifestKey,
} from './surface.ts'

/** GK-13 两域：`root` = 属主+权限+哈希三重；`hash` = 只核哈希（GOV-01）。 */
export type ProtectedDomain = 'root' | 'hash'

export interface ProtectedEntry {
  /** manifest 里的键（仓库相对路径 or 仓库外绝对路径）。 */
  name: string
  /** 磁盘上的绝对路径。 */
  path: string
  domain: ProtectedDomain
}

export interface ManifestLine {
  name: string
  digest: string
}

// ============================== 纯函数三件 ==============================

/**
 * entries + 哈希实现 → 清单行（按 name 排序）。**纯函数**。
 * 哈希实现是入参，所以这一层可以在零 I/O 的前提下逐条测。
 */
export function computeManifest(
  entries: readonly ProtectedEntry[],
  sha256: (path: string) => string,
): ManifestLine[] {
  return [...entries]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((entry) => ({ name: entry.name, digest: sha256(entry.path) }))
}

/** 清单行 → 文件字节（`<digest>  <name>` 双空格，与活体 sha256sum 格式同形）。 */
export function renderManifest(lines: readonly ManifestLine[]): string {
  return lines.map((l) => `${l.digest}  ${l.name}`).join('\n') + '\n'
}

/** 文件字节 → name→digest（空行跳过；首个空白串分割，name 允许含空格）。 */
export function parseManifest(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.length === 0) continue
    const match = /^(\S+)\s+(.*)$/.exec(line)
    if (!match) continue
    out.set(match[2]!.trim(), match[1]!)
  }
  return out
}

// ============================== 受保护面（生成与校验的唯一出处） ==============================

/** 真哈希实现（`--write-manifest` 与检查项⑤的缺省注入值）。 */
export function sha256File(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * 受保护面全表（`_protected_files` 对应物）。GK-13 终表：
 *
 * | 域 | 成员 |
 * |---|---|
 * | root 属主域 | `packages/lykoi-kernel/**`（含 package.json）、`packages/lykoi-gate/**`、`profile/*`、人格 TOML |
 * | hash-pin 域 | 其余全部 `packages/<pkg>/src/**.ts` + 各包 package.json、仓库根 package.json/tsconfig.json、治理常数文档 |
 *
 * 人格 TOML 用**绝对规范路径**做键（活体同法）：它不在仓库里，且检查项③保证
 * env 改不动它，所以这里核的规范路径与进程真正加载的那一个永远不可能分叉。
 *
 * **GK-15（M4 复核决断，对活体语义的一处显式偏离）：活规则文件不入钉面。**
 * 活体 `_protected_files` 确实钉着 `RULES_CANONICAL`（startup_verify.py:135，
 * 无特判逐字节比哈希）——它没炸过只因规则文件自 2026-08-11 签名后一个字节
 * 没动过（mtime 取证 2026-08-31）。而规则文件是**运行期会被合法改写的**：
 * 所有者答「以后都可以」→ `grantStanding` → `_persist` 改写。钉面 + 合法改写
 * = 每一次所有者授权都是下一次重启的延迟砖机（`Restart=always` 下 = 停摆）。
 * 退钉后的完整性承担者是**检查项⑥**（schema 孪生 + 两处 `always_allow` 均不得
 * 含硬门动作 —— 正是活体 `_check_rules` 的全部语义），加上 kernel 侧三重既有
 * 防线（硬门永不可常设、通配 scope 键拒写、L5 铁律=认知面无写规则路径）。
 * 决策与否决窗口见治理仓 M4 决策档。
 */
export function protectedEntries(
  repoRoot: string,
  /**
   * 仓库外一条（人格 TOML）的落址。缺省 = 活体逐字的生产规范路径。
   *
   * **刻意用规范路径而不是 env 解析值**（活体 startup_verify.py:67-74 的理由
   * 逐字）：检查项③保证 env 改不动它，所以这里核的规范路径与进程真正加载的
   * 那一个永远不可能分叉。做成入参只为了红绿双验能在 tmpdir 的合成树上跑真逻辑。
   */
  outside: { personaToml?: string } = {},
): ProtectedEntry[] {
  const personaToml = outside.personaToml ?? PERSONA_TOML_CANONICAL
  const entries: ProtectedEntry[] = []
  const push = (path: string, domain: ProtectedDomain): void => {
    entries.push({ name: manifestKey(repoRoot, path), path, domain })
  }

  // --- root 属主域：特权层包 + 门自身 ---
  for (const pkg of ROOT_OWNED_PACKAGES) {
    const dir = join(repoRoot, 'packages', pkg)
    push(join(dir, 'package.json'), 'root')
    for (const file of collectTs(join(dir, 'src'))) push(file, 'root')
  }

  // --- root 属主域：装配面（部署事实：sink 路径 / GK-8 开关 / 器官启用） ---
  for (const rel of PROFILE_ROOT_OWNED_FILES) {
    const path = join(repoRoot, rel)
    if (existsSync(path)) push(path, 'root')
  }

  // --- root 属主域：人格 TOML（仓库外绝对规范路径；活规则不入钉面 = GK-15，见顶注） ---
  push(personaToml, 'root')

  // --- hash-pin 域：其余全部 packages 的 src ---
  for (const pkg of hashPinnedPackages(repoRoot)) {
    const dir = join(repoRoot, 'packages', pkg)
    const manifestPath = join(dir, 'package.json')
    if (existsSync(manifestPath)) push(manifestPath, 'hash')
    for (const file of collectTs(join(dir, 'src'))) push(file, 'hash')
  }

  // --- hash-pin 域：工程锚 + 治理常数文档 ---
  for (const rel of [...PINNED_ROOT_FILES, ...PINNED_DOCS]) {
    const path = join(repoRoot, rel)
    if (existsSync(path)) push(path, 'hash')
  }

  return entries
}

/** 仓库内 manifest 的落址（活体 `guardian/manifest.sha256` 对应物）。 */
export function manifestPath(repoRoot: string): string {
  return join(repoRoot, 'packages', 'lykoi-gate', 'manifest.sha256')
}

/**
 * manifest 名 → 磁盘路径（反向核对用；`_resolve_manifest_name` 对应物）。
 * 绝对名原样，相对名接仓库根。
 */
export function resolveManifestName(repoRoot: string, name: string): string {
  return name.startsWith('/') ? name : join(repoRoot, name)
}
