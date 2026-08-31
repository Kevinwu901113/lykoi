/**
 * 启动完整性门 —— 八检查项（SK-70..76 等价重建；CF-B1 形态）。
 *
 * 正本：治理仓库 wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/startup_verify.py
 * （425 行，manifest 113 行）。SK-70：任一问题 exit 1；`--write-manifest` 是
 * root 重签入口；stdlib-only。
 *
 * **形态差（CF-B1，逐条在检查项注释里说明）**：活体是 systemd `ExecStartPre` 的
 * 独立 Python 进程，护的是 `guardian/*.py` + `src/lykoi/{kernel,core}` + `.pyc`
 * 影蔽面；新体是同进程 TS 非插件模块，护的是 `packages/lykoi-gate` +
 * `packages/lykoi-kernel` + 装配面 + **TS 世界的影蔽面**（构建产物 / 包解析
 * 劫持，见检查项②）。
 *
 * **可测性的唯一让步**：活体把 root 写死成 uid 0（`st.st_uid != 0`），新体把它
 * 做成 `GateEnv.rootUid` 入参（缺省 0）。红绿双验因此可以在 tmpdir 的合成树上
 * 跑真检查 —— 「谁算 root」是活体也写死了的那一个参数，其余逻辑一行不差。
 *
 * import 纪律：`node:*` + 本包三个 root 属主域模块 + `lykoi-kernel` 的治理核
 * （活体 startup_verify import 兄弟 policy_core 的同一拓扑）。**零业务包 import。**
 */
import { execFileSync } from 'node:child_process'
import { accessSync, constants, existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, type Dirent } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { HARD_ASK_TYPES, HARD_DENY_TYPES, isProtectedPath } from 'lykoi-kernel/policy-core'
import {
  manifestPath, parseManifest, protectedEntries, resolveManifestName, sha256File,
  type ProtectedEntry,
} from './manifest.ts'
import { rulesSchemaProblems } from './rules-schema.ts'
import {
  AUDIT_CANONICAL, ENV_PINS, PERSONA_TOML_CANONICAL, PROD_REPO_ROOT, ROOT_OWNED_PACKAGES,
  RULES_CANONICAL, STATE_CANONICAL, STATE_LINK_REL, collectTs, hashPinnedPackages, isRealDir,
  scanEnvReads,
} from './surface.ts'
import {
  CHANNEL_FIELD, CHANNEL_TELEMETRY, DUAL_NAMES, IMMUTABLE_EMITTER_REL, IMMUTABLE_TYPES,
  TELEMETRY_ADAPTER_REL, scanTelemetryNames,
} from './vocabulary.ts'

/** 门跑一次所需的全部外部事实（注入 = 可测；缺省 = 生产）。 */
export interface GateEnv {
  /** 仓库根（活体的 REPO_ROOT）。 */
  repoRoot: string
  /** 「谁算 root」。活体写死 0。 */
  rootUid: number
  /** 进程环境（检查项③读它）。 */
  environ: Record<string, string | undefined>
  /** 人格 TOML 规范路径。 */
  personaToml: string
  /**
   * 活规则的**读取**路径（检查项⑥读它）。活体 `RULES_PATH = env or canonical`
   * —— kernel 自己就从 env 读规则，所以门也按同一条路径去核那份**实际生效**的
   * 文件。
   */
  rulesPath: string
  /** 审计 sink 路径（检查项⑦读它）。 */
  auditPath: string
  /**
   * 规范 state 目录 —— 检查项⑧ 里 `<repoRoot>/var/state` 这条链接**该指向的
   * 地方**。缺省 = `STATE_CANONICAL`。
   *
   * 做成入参与 `personaToml` / `auditPath` / `rootUid` 是同一条可测性让步：红绿
   * 双验要在 tmpdir 的合成树上跑真逻辑（真 lstat、真 realpath），而 `/home/lykoi`
   * 在开发机上不存在。**链接自身的落址不在让步之列** —— 它由 `repoRoot` +
   * `STATE_LINK_REL` 推出来，因为那正是运行期真的会被写到的那一个位置。
   */
  stateCanonical: string
  /** append-only 属性探针：true/false/**null = 读不出来**（活体 None 同义，fail closed）。 */
  appendOnlyProbe: (path: string) => boolean | null
  /**
   * 治理核的第三旋钮（检查项④的被检对象）。缺省 = `lykoi-kernel/policy-core`
   * 的真身，与活体 `_check_guard` 直接调 `policy_core.is_protected_path` 同拓扑。
   * 做成入参是为了红测能塞一个**坏掉的守卫**进来 —— 这个检查项存在的全部理由
   * 就是逮住一个 PROTECTED_PATHS 被清空/被写宽的治理核，红测不塞坏的就测不着它。
   */
  isProtectedPath: (path: string) => boolean
}

/** 生产缺省：env 可覆盖的三条按活体口径解析（检查项③保证它们没被重定向）。 */
export function productionEnv(repoRoot: string): GateEnv {
  const environ = process.env
  return {
    repoRoot,
    rootUid: 0,
    environ,
    personaToml: PERSONA_TOML_CANONICAL, // 刻意用规范路径而非 env 解析（活体注释逐字理由）
    rulesPath: environ.LYKOI_APPROVAL_RULES ?? RULES_CANONICAL,
    auditPath: environ.LYKOI_AUDIT_PATH ?? AUDIT_CANONICAL,
    // 刻意**不**读 env：调和的规范目标是定案常量，不是可覆盖项（D-SC-1 明写
    // 「不加 unit env」；能被 env 换掉的 canonical 等于没有 canonical）。
    stateCanonical: STATE_CANONICAL,
    appendOnlyProbe: defaultAppendOnlyProbe,
    isProtectedPath,
  }
}

/**
 * append-only 属性探针。活体走 `fcntl.ioctl(FS_IOC_GETFLAGS)` 读 `FS_APPEND_FL`；
 * Node 没有 ioctl 面，改用同一事实的另一读法：Linux `lsattr -d`、macOS 的
 * `uappnd/sappnd` 标志。读不出来 → **null**，检查项⑦按活体把 None 也算失败
 * （fail closed：「读不出来」不等于「有」）。
 */
export function defaultAppendOnlyProbe(path: string): boolean | null {
  try {
    if (process.platform === 'linux') {
      const out = execFileSync('lsattr', ['-d', path], { encoding: 'utf8', timeout: 5000 })
      return (out.split(/\s+/)[0] ?? '').includes('a')
    }
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/bin/stat', ['-f', '%Sf', path], { encoding: 'utf8', timeout: 5000 })
      return /uappnd|sappnd/.test(out)
    }
    return null
  } catch {
    return null
  }
}

// ============================== 共用小件 ==============================

/** 活体 `_check_owned_and_unwritable` 逐字：非 root 属主 / 组他人可写 → 问题。 */
function checkOwnedAndUnwritable(env: GateEnv, path: string, problems: string[]): void {
  let st: ReturnType<typeof statSync>
  try {
    st = statSync(path)
  } catch (exc) {
    problems.push(`${path}: unstatable (${exc instanceof Error ? exc.message : String(exc)})`)
    return
  }
  if (st.uid !== env.rootUid) {
    problems.push(`${path}: not root-owned (uid ${st.uid})`)
  }
  if (st.mode & 0o022) {
    problems.push(`${path}: writable by group/other (mode ${(st.mode & 0o777).toString(8)})`)
  }
}

// ============================== ① 受保护源属主与不可组/他人写 ==============================

/**
 * 检查项① —— 活体 `_check_perms`：`guardian/` 目录本身 + 其下 `*.py` 全部
 * root 属主且组他人不可写。
 *
 * 新体对应物：完整性门自己的包目录 `packages/lykoi-gate` + `src/` + 其下全部
 * `.ts` + `package.json`。**门必须先证明自己没被换掉**，才有资格去证明别人。
 */
export function checkGateOwnership(env: GateEnv, problems: string[]): void {
  const dir = join(env.repoRoot, 'packages', 'lykoi-gate')
  const srcDir = join(dir, 'src')
  if (!isRealDir(dir) || !isRealDir(srcDir)) {
    problems.push(`gate source dir missing: ${srcDir}`)
    return
  }
  for (const path of [dir, srcDir, join(dir, 'package.json'), ...collectTs(srcDir)]) {
    checkOwnedAndUnwritable(env, path, problems)
  }
}

// ============================== ② 受保护树 + 影蔽面 ==============================

/**
 * 检查项② —— 活体 `_check_protected_tree` + `_check_protected_pycache`。
 *
 * 活体护三样：①仓库内的直接源/包边界（`src`、`src/lykoi`、`__init__.py`）——
 * 「只护 `core/` 或 `kernel/` 是不够的，`src/lykoi` 能把任一子目录整个换掉」；
 * ②`kernel`/`core` 目录 + `*.py`；③人格 TOML（文件 + 父目录）。外加
 * `__pycache__` 影蔽面：受保护源目录下一个服务账户可写的字节码缓存 = 代码注入
 * 通道（一个塞进去的 `.pyc` 影蔽掉 `.py`）。
 *
 * **新体的影蔽面（TS 世界，如实分析）**：Node 24 原生 type stripping 直接跑
 * `.ts`，没有 `.pyc` 这种「自动生成、优先加载」的产物，所以逐字搬 `__pycache__`
 * 是搬了个空。真正等价的三条影蔽通道是：
 *
 *  a. **构建产物影蔽**：受保护 `src/` 里出现任何非 `.ts` 的常规文件（`.js`
 *     / `.d.ts` / `dist/`），就是一份和源码平行、可能被优先加载的第二真相。
 *     本仓 `noEmit`（tsconfig）下它们**一个都不该存在** —— 出现即红。
 *  b. **包解析劫持**：`node_modules/<pkg>` 本该是 workspace 指回
 *     `packages/<pkg>` 的 symlink；把它换成一个**真目录**，import 就整个改道，
 *     而受保护树里的源文件一个字节都没变（manifest 全绿）。这是 `.pyc` 影蔽的
 *     精确对应物：**不改源、改解析**。
 *  c. **导出面改写**：`package.json` 的 `exports` 决定 `lykoi-kernel` 这个名字
 *     解析到哪个文件。它已在检查项①/⑤的受保护面里（root 属主 + 哈希），此处
 *     不重复核。
 */
export function checkProtectedTree(env: GateEnv, problems: string[]): void {
  // 直接边界：packages/ 本身（能整包替换的那一层，= 活体的 src/lykoi）。
  const packagesDir = join(env.repoRoot, 'packages')
  if (!isRealDir(packagesDir)) {
    problems.push(`packages dir missing: ${packagesDir}`)
    return
  }
  checkOwnedAndUnwritable(env, packagesDir, problems)

  for (const pkg of ROOT_OWNED_PACKAGES) {
    const dir = join(packagesDir, pkg)
    const srcDir = join(dir, 'src')
    if (!isRealDir(dir) || !isRealDir(srcDir)) {
      problems.push(`root-domain package missing: ${dir}`)
      continue
    }
    for (const path of [dir, srcDir, join(dir, 'package.json'), ...collectTs(srcDir)]) {
      checkOwnedAndUnwritable(env, path, problems)
    }
    checkShadowSurface(env, srcDir, problems)
    checkResolutionLink(env, pkg, problems)
  }

  // 人格 TOML：文件 + 父目录（活体逐字）。
  if (!existsSync(env.personaToml)) {
    problems.push(`persona TOML missing: ${env.personaToml}`)
  } else {
    checkOwnedAndUnwritable(env, env.personaToml, problems)
    checkOwnedAndUnwritable(env, dirname(env.personaToml), problems)
  }
}

/** ②a 构建产物影蔽：受保护 `src/` 下任何非 `.ts` 常规文件或子目录里的产物皆红。 */
export function checkShadowSurface(env: GateEnv, srcDir: string, problems: string[]): void {
  const walk = (dir: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch (exc) {
      problems.push(`protected src unreadable: ${dir} (${exc instanceof Error ? exc.message : String(exc)})`)
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isSymbolicLink()) {
        // symlink 进受保护源树 = 一条不受 manifest 约束的内容通道。
        problems.push(`protected src contains a symlink: ${full}`)
        continue
      }
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build') {
          problems.push(`build/resolution artifact inside protected src: ${full}`)
          continue
        }
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.ts')) {
        // 与源码平行的第二真相（.js/.d.ts/.map/…）。noEmit 下一个都不该有。
        problems.push(`build artifact shadows protected source: ${full}`)
      }
    }
  }
  walk(srcDir)
}

/** ②b 包解析劫持：`node_modules/<pkg>` 必须是指回本仓 `packages/<pkg>` 的 symlink。 */
export function checkResolutionLink(env: GateEnv, pkg: string, problems: string[]): void {
  const link = join(env.repoRoot, 'node_modules', pkg)
  let info: ReturnType<typeof lstatSync>
  try {
    info = lstatSync(link)
  } catch {
    problems.push(`workspace link missing: ${link} (npm install not run, or resolution hijacked)`)
    return
  }
  if (!info.isSymbolicLink()) {
    // 真目录顶掉 workspace 链接：源码全绿、import 全改道。**不改源、改解析。**
    problems.push(`workspace link is not a symlink (resolution hijack): ${link}`)
    return
  }
  let target: string
  let expected: string
  try {
    target = realpathSync(link)
    expected = realpathSync(join(env.repoRoot, 'packages', pkg))
  } catch (exc) {
    problems.push(`workspace link unresolvable: ${link} (${exc instanceof Error ? exc.message : String(exc)})`)
    return
  }
  if (target !== expected) {
    problems.push(`workspace link points outside the protected tree: ${link} -> ${target}`)
  }
}

// ============================== ③ GK-6 env 钉面 ==============================

/**
 * 检查项③ —— 活体 `_check_env_pins` 只钉三条（RULES/PERSONA/AUDIT）。
 * **GK-6 定案：新体统一钉全部治理 state 路径**（DK-10「env 钉面不对称」的收紧
 * 落法）。全表在 `surface.ts` 的 `ENV_PINS`，四类见那里的注释。
 *
 * 收紧点逐条：W1 三路补钉 standing_grants/pending_actions（活体未钉）、W3 出站
 * 六路全钉、通知/主动开口账本全钉、旋钮一律要求未设、出站代理必须未设、
 * 密钥只看在不在**永不读值**。
 */
export function checkEnvPins(env: GateEnv, problems: string[]): void {
  // ③a 钉面**覆盖全**：源码里真正读到的每一个 LYKOI_* 都必须在表里。
  // 算出来的，不是记得同步的 —— 加了一个治理 env 面却忘了钉，门当场红。
  const pinned = new Set(ENV_PINS.map((p) => p.name))
  for (const name of [...scanEnvReads(env.repoRoot)].sort()) {
    if (!pinned.has(name)) {
      problems.push(`${name} is read by the source tree but absent from the GK-6 env pin table`)
    }
  }

  // ③b 逐条钉
  for (const pin of ENV_PINS) {
    const value = env.environ[pin.name]
    switch (pin.kind) {
      case 'path': {
        if (!value) break // 未设 = 走源码里已签名的缺省，合格
        let same: boolean
        try {
          same = realpathSync(value) === realpathSync(pin.canonical!)
        } catch {
          // 任一头解析不出来 → 退回字面比较（fail closed 方向：不等即红）
          same = resolve(value) === resolve(pin.canonical!)
        }
        if (!same) {
          problems.push(
            `${pin.name} redirects a governance path to ${JSON.stringify(value)} `
            + `(canonical: ${pin.canonical})`,
          )
        }
        break
      }
      case 'knob':
        if (value !== undefined) {
          problems.push(
            `${pin.name} overrides a governance knob from the unit environment `
            + `(value pinned in signed source; re-sign instead) — ${pin.owner}`,
          )
        }
        break
      case 'unset':
        if (value !== undefined) {
          problems.push(`${pin.name} must be unset in production — ${pin.owner}`)
        }
        break
      case 'secret':
        // **永不读值、永不落日志**：只看设了没设、空不空。
        if (value !== undefined && value.length === 0) {
          problems.push(`${pin.name} is set but empty`)
        }
        break
    }
  }
}

// ============================== ④ path guard 自检 ==============================

/**
 * 检查项④ —— 活体 `_check_guard` 两条断言：护住 secrets 目录、**不过度封锁
 * 工作区**。新体四条：前两条逐字保全（同一台机器上的同一批路径），后两条是
 * GK-13 重划出来的新体一半（门自己的源目录必须不可达；新体工作区必须不被误封）。
 */
export function checkPathGuard(env: GateEnv, problems: string[]): void {
  const guard = env.isProtectedPath
  if (!guard('/home/lykoi/secrets/llm.env')) {
    problems.push('path guard does not protect the secrets dir')
  }
  if (guard('/home/lykoi/projects/lykoi/src/lykoi')) {
    problems.push('path guard over-blocks the workspace')
  }
  if (!guard(`${PROD_REPO_ROOT}/packages/lykoi-gate/src/verify.ts`)) {
    problems.push('path guard does not protect the integrity gate itself')
  }
  if (guard(`${PROD_REPO_ROOT}/packages/lykoi-kernel/src`)) {
    problems.push('path guard over-blocks the new-body workspace')
  }
}

// ============================== ⑤ manifest 三向核对 + 反向核对 ==============================

/**
 * 检查项⑤ —— 活体 `_check_manifest`。三向 = 受保护面 × manifest × 文件系统：
 *
 *  - 正向：受保护面每一条必须**在 manifest 里**（不在 → 「protected but not in
 *    manifest (re-sign required)」）、**文件在**、**哈希相等**；
 *  - **反向**：manifest 里每一条不在受保护面里的，文件必须还在、哈希必须还对
 *    （「in manifest but file is gone」/「hash mismatch」）—— 这一半防的是
 *    「把一个文件从受保护面里挪出去，就能随便改它」；
 *  - manifest 缺失 = **FAILURE**（no silent bootstrap，活体逐字）。
 *
 * GK-13 两域在这里合流：`root` 域的条目额外走属主检查（检查项①②已覆盖），
 * `hash` 域只核哈希 —— GOV-01 逐字「不加 root 属主要求：服务账户仍可在工作树
 * 开发，但任何触及这些文件的部署必须 root 重签 manifest 才能过启动闸」。
 */
export function checkManifest(env: GateEnv, problems: string[]): void {
  const path = manifestPath(env.repoRoot)
  if (!existsSync(path)) {
    problems.push(`manifest missing: ${path} (run --write-manifest as root)`)
    return
  }
  let expected: Map<string, string>
  try {
    expected = parseManifest(readFileSync(path, 'utf8'))
  } catch (exc) {
    problems.push(`manifest unreadable: ${path} (${exc instanceof Error ? exc.message : String(exc)})`)
    return
  }

  const protectedList: ProtectedEntry[] = protectedEntries(env.repoRoot, {
    personaToml: env.personaToml,
  })
  const protectedByName = new Map(protectedList.map((e) => [e.name, e]))

  // 正向
  for (const entry of protectedList) {
    const digest = expected.get(entry.name)
    if (digest === undefined) {
      problems.push(`${entry.name}: protected but not in manifest (re-sign required)`)
    } else if (!existsSync(entry.path)) {
      problems.push(`${entry.name}: protected file missing`)
    } else if (sha256File(entry.path) !== digest) {
      problems.push(`${entry.name}: hash mismatch (tampered?)`)
    }
  }
  // 反向
  for (const [name, digest] of expected) {
    if (protectedByName.has(name)) continue
    const resolved = resolveManifestName(env.repoRoot, name)
    if (!existsSync(resolved)) {
      problems.push(`${name}: in manifest but file is gone`)
    } else if (sha256File(resolved) !== digest) {
      problems.push(`${name}: hash mismatch (tampered?)`)
    }
  }

  // 域完整性：hash-pin 域是补集定义，这里复核一次「新包没漏签」。
  for (const pkg of hashPinnedPackages(env.repoRoot)) {
    for (const file of collectTs(join(env.repoRoot, 'packages', pkg, 'src'))) {
      const entry = protectedList.find((e) => e.path === file)
      if (!entry) problems.push(`${file}: inside packages/*/src but outside the protected surface`)
    }
  }
}

// ============================== ⑥ rules 硬门核对（+ 事件词汇分流） ==============================

/**
 * 检查项⑥ —— 活体 `_check_rules`：结构 schema（孪生这一份，见
 * `rules-schema.ts` 顶注）+ **两处 `always_allow` 均不得含 HARD_ASK ∪ HARD_DENY
 * 成员**（顶层一处、`autonomous` 子块一处；活体注释逐字：运行期 kernel 会靠
 * 能力地板拒掉，但启动闸也必须逮住 —— defense in depth, symmetric with above）。
 *
 * 规则文件不存在 → 直接返回（kernel 会铺一份空默认；没有什么可放宽的）。
 */
export function checkRules(env: GateEnv, problems: string[]): void {
  if (!existsSync(env.rulesPath)) return
  let rules: unknown
  try {
    rules = JSON.parse(readFileSync(env.rulesPath, 'utf8'))
  } catch (exc) {
    problems.push(`${env.rulesPath}: unreadable (${exc instanceof Error ? exc.message : String(exc)})`)
    return
  }
  problems.push(...rulesSchemaProblems(rules))
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) return

  const doc = rules as Record<string, unknown>
  const hard = new Set([...HARD_ASK_TYPES, ...HARD_DENY_TYPES])
  const topLevel = Array.isArray(doc.always_allow) ? doc.always_allow : []
  for (const entry of topLevel) {
    if (typeof entry === 'string' && hard.has(entry)) {
      problems.push(`approval_rules.json auto-allows hard-gated ${JSON.stringify(entry)}`)
    }
  }
  const autonomous = doc.autonomous
  if (typeof autonomous === 'object' && autonomous !== null && !Array.isArray(autonomous)) {
    const block = (autonomous as Record<string, unknown>).always_allow
    for (const entry of Array.isArray(block) ? block : []) {
      if (typeof entry === 'string' && hard.has(entry)) {
        problems.push(
          `approval_rules.json autonomous.always_allow auto-allows hard-gated ${JSON.stringify(entry)}`,
        )
      }
    }
  }
}

/**
 * 检查项⑥b —— 事件词汇分流（W2 TODO#6 定案；理由见 `vocabulary.ts` 顶注）。
 * V1 声明一致 / V2 碰撞自动发现 / V3 盖章在位。
 */
export function checkEventVocabulary(env: GateEnv, problems: string[]): void {
  // V1：immutable 三名必须真的在 dispatch 源码里发着。
  const emitterPath = join(env.repoRoot, IMMUTABLE_EMITTER_REL)
  let emitter: string
  try {
    emitter = readFileSync(emitterPath, 'utf8')
  } catch {
    problems.push(`immutable audit emitter missing: ${emitterPath}`)
    return
  }
  for (const name of IMMUTABLE_TYPES) {
    if (!emitter.includes(`type: '${name}'`)) {
      problems.push(`event vocabulary: immutable type ${name} no longer emitted by ${IMMUTABLE_EMITTER_REL}`)
    }
  }

  // V2：碰撞面必须恰好等于声明的 DUAL_NAMES（算出来的，不是抄的）。
  const allPackages = readdirSync(join(env.repoRoot, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory()).map((d) => d.name)
  const telemetry = scanTelemetryNames(env.repoRoot, allPackages)
  const collisions = IMMUTABLE_TYPES.filter((n) => telemetry.has(n)).sort()
  const declared = [...DUAL_NAMES].sort()
  if (JSON.stringify(collisions) !== JSON.stringify(declared)) {
    problems.push(
      `event vocabulary: dual-channel names drifted — found ${JSON.stringify(collisions)}, `
      + `declared ${JSON.stringify(declared)} (declare the split or remove the collision)`,
    )
  }

  // V3：遥测适配器必须仍在盖章。
  const adapterPath = join(env.repoRoot, TELEMETRY_ADAPTER_REL)
  let adapter: string
  try {
    adapter = readFileSync(adapterPath, 'utf8')
  } catch {
    problems.push(`telemetry adapter missing: ${adapterPath}`)
    return
  }
  if (!adapter.includes(`${CHANNEL_FIELD}: '${CHANNEL_TELEMETRY}'`)) {
    problems.push(
      `event vocabulary: telemetry adapter no longer stamps ${CHANNEL_FIELD}:'${CHANNEL_TELEMETRY}' `
      + `(${TELEMETRY_ADAPTER_REL}) — the two channels become indistinguishable in audit.jsonl`,
    )
  }
}

// ============================== ⑦ audit sink 供给六断言 ==============================

/**
 * 检查项⑦ —— 活体 `_check_audit_sink` + SK-75（kernel 侧 `audit_provision`
 * 运行时孪生六断言，audit_provision.py:33-100）。六条逐条：
 *
 *  1. 不是符号链（symlink → 立刻返回，别的都不用看了）
 *  2. 存在
 *  3. root 属主
 *  4. **服务用户可 append**（`os.access(W_OK)` 对应物）
 *  5. append-only 属性在（探针 null 也算失败 —— 读不出来 ≠ 有）
 *  6. 父目录 root 属主**且**组他人不可写（活体 `_mode_writable_by_group_or_other`
 *     刻意与身份无关：`os.access` 答的是「调用进程」，root 手动跑会把每个目录
 *     都答成可写）
 */
export function checkAuditSink(env: GateEnv, problems: string[]): void {
  const path = env.auditPath
  let info: ReturnType<typeof lstatSync> | null = null
  try {
    info = lstatSync(path)
  } catch {
    info = null
  }
  if (info?.isSymbolicLink()) {
    problems.push(`audit sink ${path} is a symlink`) // ①
    return
  }
  if (info === null) {
    problems.push(`audit sink missing: ${path}`) // ②
    return
  }
  const st = statSync(path)
  if (st.uid !== env.rootUid) {
    problems.push(`audit sink ${path} not root-owned (uid ${st.uid})`) // ③
  }
  try {
    accessSync(path, constants.W_OK) // ④
  } catch {
    problems.push(`audit sink ${path} not appendable by the service user`)
  }
  if (env.appendOnlyProbe(path) !== true) { // ⑤ null/false 一律失败
    problems.push(`audit sink ${path} missing append-only attribute`)
  }
  const parent = dirname(resolve(path))
  let pst: ReturnType<typeof statSync>
  try {
    pst = statSync(parent)
  } catch {
    problems.push(`audit sink directory missing: ${parent}`)
    return
  }
  if (pst.uid !== env.rootUid) {
    problems.push(`audit sink directory ${parent} not root-owned`) // ⑥a
  }
  if (pst.mode & 0o022) {
    problems.push(`audit sink directory ${parent} writable by group/other`) // ⑥b
  }
}

// ============================== ⑧ state 落点调和 ==============================

/**
 * 检查项⑧ —— GK-6 state 落点调和（WO-STATE-CANON 定案 D-SC-1）。**活体无对应
 * 物**：活体的 state 路径在源码里就是绝对的，没有两个落点可分叉；新体的源码
 * 缺省是仓库相对的 `var/state/…`，于是多出了这一条只在部署面存在的调和物。
 *
 * 被检事实一条：`<repoRoot>/var/state` 必须是**符号链接**且 realpath 等于
 * `env.stateCanonical`。三态：
 *
 *  - 是链接且指对 → OK
 *  - **真实目录（或普通文件）→ FAIL**：分叉已经发生。这不是假想 —— 2026-09-01
 *    01:18 的止损重启就让服务进程在仓库内 mkdir 了真实 `var/state/` 并写进去
 *    一个 `telegram_outbox.cursor`；审批面诸文件因懒加载才侥幸没跟着分叉。
 *  - **不存在 → 同样 FAIL**：不是「没什么可查」。运行期 `writeJsonAtomic` 会
 *    自己 `mkdir -p` 出上面那个真实目录，所以缺失 = **未来分叉**，与已分叉同罪。
 *
 * 形态上刻意与检查项②b `checkResolutionLink` 同构（那一条也是「必须是 symlink
 * 且 realpath 等于某处」，也用「不是链接 = 一次改道」这同一套失败语义）：两条守
 * 的是同一类攻/错面 —— **文件内容一个字节没变，落点整个改道**，manifest 全绿。
 */
export function checkStateCanon(env: GateEnv, problems: string[]): void {
  const link = join(env.repoRoot, STATE_LINK_REL)
  let info: ReturnType<typeof lstatSync>
  try {
    info = lstatSync(link)
  } catch {
    problems.push(
      `state landing missing: ${link} (expected a symlink to ${env.stateCanonical}) — `
      + 'runtime writeJsonAtomic would mkdir a real directory here and fork her state',
    )
    return
  }
  if (!info.isSymbolicLink()) {
    problems.push(
      `state landing is not a symlink (forked state): ${link} is a `
      + `${info.isDirectory() ? 'real directory' : 'regular file'}, `
      + `expected a symlink to ${env.stateCanonical}`,
    )
    return
  }
  let target: string
  try {
    target = realpathSync(link)
  } catch (exc) {
    // 悬空链接：写盘会 ENOENT，不是分叉但同样起不来。fail closed。
    problems.push(`state landing unresolvable: ${link} (${exc instanceof Error ? exc.message : String(exc)})`)
    return
  }
  let expected: string
  try {
    expected = realpathSync(env.stateCanonical)
  } catch {
    // canonical 自己解析不出来 → 退回字面比较（与检查项③ path 类同一条退法）。
    expected = resolve(env.stateCanonical)
  }
  if (target !== expected) {
    problems.push(
      `state landing points outside the canonical state dir: ${link} -> ${target} `
      + `(canonical: ${expected})`,
    )
  }
}

// ============================== 汇总 ==============================

/** 检查项的稳定名（报告与红测按名索引）。 */
export const CHECKS = Object.freeze([
  ['gate_ownership', checkGateOwnership],
  ['protected_tree', checkProtectedTree],
  ['env_pins', checkEnvPins],
  ['path_guard', checkPathGuard],
  ['manifest', checkManifest],
  ['rules', checkRules],
  ['event_vocabulary', checkEventVocabulary],
  ['audit_sink', checkAuditSink],
  ['state_canon', checkStateCanon],
] as const satisfies readonly (readonly [string, (env: GateEnv, problems: string[]) => void])[])

/** 跑全部检查，返回问题清单（空 = 全绿）。活体 `verify()` 对应物。 */
export function verify(env: GateEnv): string[] {
  const problems: string[] = []
  for (const [, check] of CHECKS) check(env, problems)
  return problems
}
