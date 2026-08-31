/**
 * 受保护面与钉面的**唯一声明处**（GK-13 重划 + GK-6 env 钉面）。
 *
 * 正本：治理仓库 wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/startup_verify.py
 * （检查项①②③⑤的面）+ docs/m3_blueprint.md GK-6/GK-13 + DK-05/DK-10。
 *
 * 形态差（CF-B1，报告留痕）：活体是 `guardian/*.py` 五个 root:root 444 文件 +
 * `src/lykoi/{kernel,core}` 的 root 属主源目录；新体是**同进程 TS 非插件模块**
 * ——「guardian 目录」的对应物是 `packages/lykoi-gate`，「kernel 包」的对应物是
 * `packages/lykoi-kernel`，「GOV-01 认知/状态层 hash-only 域」的对应物是其余
 * 全部 `packages/<pkg>/src`。
 *
 * 本模块只 import `node:*`。**不 import 任何业务包** —— 完整性门这一份必须能在
 * 业务代码整棵树被换掉的前提下照样成立（SK-72 孪生纪律的同一条理由）。
 * 唯一例外与活体同拓扑：`verify.ts` import 治理核 `lykoi-kernel/policy-core`
 * （活体 startup_verify import 兄弟 policy_core），那是 root 属主域内部的引用。
 */
import { readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'

// ============================== 生产规范路径 ==============================

/**
 * 生产仓库根（M4 供给项 #7）。活体是 `/home/lykoi/projects/lykoi`；新体装在
 * 同机的另一棵树（R-01：切换窗新旧体绝不同时写 state，所以两棵树必须分开）。
 */
export const PROD_REPO_ROOT = '/home/lykoi/projects/lykoi-cordis'

/** 活体逐字三条（startup_verify.py:75-77）—— 同一台机器上的同一批文件。 */
export const RULES_CANONICAL = '/home/lykoi/state/approval_rules.json'
export const PERSONA_TOML_CANONICAL = '/home/lykoi/runtime/persona/lykoi_base.toml'
export const AUDIT_CANONICAL = '/var/log/lykoi-audit/audit.jsonl'

/**
 * 新体治理 state 目录（W1 三路 + W3 出站六路 + 通知 + 显著性影子库都落这里）。
 *
 * **D-SC-1（WO-STATE-CANON）**：源码缺省全部是**仓库相对**的 `var/state/…`
 * （`lykoi-kernel/src/approval.ts:36` 等十余处），与这里的绝对规范值靠**一条
 * 符号链接**调和（`<repo>/var/state` → 本目录）。定案刻意不改源码相对缺省、
 * 不加 unit env —— 于是「两个落点会不会分叉」全落在那一条链接上，由检查项⑧
 * `checkStateCanon` 守。本常量是它的 canonical 缺省。
 */
export const STATE_CANONICAL = '/home/lykoi/state'

/**
 * 调和链接的**仓库相对**落址 —— 源码缺省 `var/state/…` 的那半边。
 *
 * 刻意**不**做成入参（与 canonical 目标不同）：检查项⑧ 要测的就是生产上真正会
 * 被写到的那一个落址，把它参数化等于测了个别的地方。
 */
export const STATE_LINK_REL = 'var/state'

const at = (name: string): string => `${STATE_CANONICAL}/${name}`

// ============================== GK-6 env 钉面 ==============================

/**
 * 钉面的四个类别。
 *
 * - `path`  ：未设，或 realpath 等于 canonical。**重定向治理 state = 启动中止**。
 * - `knob`  ：必须未设。每个旋钮在源码里都有一个**已入 manifest 的**缺省值；
 *             unit 文件里的一次覆盖就是一次没有签名的治理变更。要改就改源码
 *             再 root 重签（与 manifest 同一条部署纪律）。
 * - `unset` ：必须未设，且没有 canonical 可言（出站代理这种「设了就是一条外泄
 *             通道」的变量）。
 * - `secret`：**永不比对值、永不落日志**。门只看「设了没有 / 空不空」。
 */
export type EnvPinKind = 'path' | 'knob' | 'unset' | 'secret'

export interface EnvPin {
  name: string
  kind: EnvPinKind
  /** `path` 类的规范值；其余类别为 null。 */
  canonical: string | null
  /** 这条钉的是谁的什么（报告与失败信息用）。 */
  owner: string
}

/**
 * **GK-6 全表**：新体统一钉全部治理 state 路径（DK-10「env 钉面不对称」的收紧
 * 落法 —— 活体只钉了 3 条，新体钉全部）。
 *
 * 顺序 = W1 治理三路 → 审计 sink → 人格 → 通知/主动开口 → W3 出站六路 →
 * 感知输入 → 旋钮 → 出站代理 → 密钥。
 */
export const ENV_PINS: readonly EnvPin[] = Object.freeze([
  // --- W1 治理三路（approval.ts） ---
  { name: 'LYKOI_APPROVAL_RULES', kind: 'path', canonical: RULES_CANONICAL, owner: 'kernel/approval 活规则（活体逐字钉，DK-10 原三条之一）' },
  { name: 'LYKOI_STANDING_GRANTS', kind: 'path', canonical: at('standing_grants.json'), owner: 'kernel/approval 常设授权（活体**未**钉，GK-6 补钉）' },
  { name: 'LYKOI_PENDING_ACTIONS', kind: 'path', canonical: at('pending_actions.json'), owner: 'kernel/approval 悬置队列（活体**未**钉，GK-6 补钉）' },
  // --- 审计 sink ---
  { name: 'LYKOI_AUDIT_PATH', kind: 'path', canonical: AUDIT_CANONICAL, owner: 'immutable 审计 sink（活体逐字钉，DK-10 原三条之一）' },
  // --- 人格 ---
  { name: 'LYKOI_PERSONA_TOML', kind: 'path', canonical: PERSONA_TOML_CANONICAL, owner: '先天人格 TOML（活体逐字钉，DK-10 原三条之一；DA-11 sha 取证对象）' },
  // --- 通知 / 主动开口（W3 kernel 侧） ---
  { name: 'LYKOI_NOTIFICATIONS', kind: 'path', canonical: at('notifications.json'), owner: 'kernel/notifications 通知账本（GK-1 持久 next_id 住这里）' },
  { name: 'LYKOI_PROACTIVE_CHAT_LEDGER', kind: 'path', canonical: at('proactive_chat.json'), owner: 'kernel/proactive-chat 主动开口预算账本（脑干层事实，红线 #5）' },
  // --- W3 出站六路（W3 TODO#5：并入统一钉面） ---
  { name: 'LYKOI_CHAT_OUTBOX', kind: 'path', canonical: at('chat_outbox.json'), owner: '出站器官 chat_outbox（W3#5 六条之一）' },
  { name: 'LYKOI_TELEGRAM_UNDELIVERED', kind: 'path', canonical: at('telegram_undelivered.json'), owner: '出站器官 未送达账本（W3#5 六条之二）' },
  { name: 'LYKOI_TELEGRAM_OUTBOX_CURSOR', kind: 'path', canonical: at('telegram_outbox.cursor'), owner: '出站器官 游标（SK-79 坏游标方向刻意相反；W3#5 六条之三）' },
  { name: 'LYKOI_MESSENGER_LEDGER', kind: 'path', canonical: at('messenger_outbound.json'), owner: '出站器官 messenger 打扰预算账本（W3#5 六条之四）' },
  { name: 'LYKOI_MESSENGER_TRANSPORT_LOG', kind: 'path', canonical: at('messenger_transport.jsonl'), owner: '出站器官 transport 日志（W3#5 六条之五）' },
  { name: 'LYKOI_TELEGRAM_PROXY', kind: 'unset', canonical: null, owner: '出站器官 代理（W3#5 六条之六）—— **设了就是一条外泄通道**，生产必须未设' },
  // --- 感知输入 ---
  { name: 'LYKOI_SALIENCE_DB', kind: 'path', canonical: at('salience_shadow.db'), owner: 'lykoi-heart 显著性影子库读侧（G-3）' },
  // --- 旋钮（必须未设：缺省值在已签名的源码里） ---
  { name: 'LYKOI_PENDING_TTL_S', kind: 'knob', canonical: null, owner: 'kernel/approval 悬置 TTL —— 设大 = 永不过期，设 0 = 全过期，两头都是治理变更' },
  { name: 'LYKOI_INTERACTIVE_WINDOW_S', kind: 'knob', canonical: null, owner: 'kernel/interactive-lock 让位窗口（S-17）' },
  { name: 'LYKOI_HEARTBEAT_BASELINE_MIN', kind: 'knob', canonical: null, owner: 'lykoi-heart 基线节律' },
  { name: 'LYKOI_CONTEXT_WINDOW_TURNS', kind: 'knob', canonical: null, owner: 'lykoi-converse 上下文窗口轮数' },
  { name: 'LYKOI_CONTEXT_BACKFILL_ROWS', kind: 'knob', canonical: null, owner: 'lykoi-converse 回填行数' },
  { name: 'LYKOI_CONTEXT_MAX_INPUT_TOKENS', kind: 'knob', canonical: null, owner: 'lykoi-converse 输入上限' },
  { name: 'LYKOI_U3_ENVELOPE_JSON_MODE', kind: 'knob', canonical: null, owner: 'lykoi-converse 信封 json 强制（S-52 缺省开）' },
  // --- 密钥（值永不比对、永不落日志） ---
  { name: 'LYKOI_TELEGRAM_BOT_TOKEN', kind: 'secret', canonical: null, owner: '出站器官 bot token —— 门只看设没设/空不空，**永不读值**' },
])

// ============================== GK-13 受保护面 ==============================

/**
 * root 属主域的包（属主 + 权限 + 哈希三重）。
 *
 * - `lykoi-kernel`：特权层本体 —— dispatch 主链、三层门、policy core、
 *   path guard、委托台账、通知原语、图式注册表。**她咨询它但削不动它。**
 * - `lykoi-gate`  ：完整性门自身（活体 `guardian/` 的对应物）。
 */
export const ROOT_OWNED_PACKAGES: readonly string[] = Object.freeze([
  'lykoi-kernel',
  'lykoi-gate',
])

/**
 * hash-pin 域的包（只核哈希，不要求 root 属主 —— GOV-01 逐字：服务账户仍可在
 * 工作树开发，但任何触及这些文件的部署必须 root 重签 manifest 才过得了启动闸）。
 *
 * 定义是**补集**而不是白名单：`packages/*` 里凡不在 root 属主域的，一律 hash-pin。
 * 于是「新加一个包忘了登记」在这里物理上不可能发生 —— 它自动落进 hash-pin 域，
 * 未签名即红。
 */
export function hashPinnedPackages(repoRoot: string): string[] {
  const all = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
  return all.filter((name) => !ROOT_OWNED_PACKAGES.includes(name))
}

/**
 * 装配面（profile/）：cordis.yml 是插件树的**部署事实**——它说 audit sink 落在
 * 哪、GK-8 开关开没开、哪些器官启用。活体的对应物是 systemd unit 的
 * `Environment=` 行与 `ExecStart`，那些天然在 root 域。新体把它们收进一个仓库内
 * 的 YAML，所以这个文件必须跟着进 root 属主域 —— 否则 env 钉面钉住了变量，
 * 配置文件却还能把 audit 路径改到别处，钉面等于白钉。
 *
 * 这是 GK-13「W4 细化」授权范围内的一次显式重划，报告 §受保护面终表列明。
 */
export const PROFILE_ROOT_OWNED_FILES: readonly string[] = Object.freeze([
  'profile/package.json',
  'profile/index.ts',
  // 生产专用入口（M4-W2）：它决定生产箱装载哪一份装配，与装配面本身同级。
  'profile/index.prod.ts',
  'profile/cordis.yml',
  'profile/cordis.prod.yml',
])

/**
 * hash-pin 的治理常数文档（活体 `docs/phase5_prereg_v1.md` 锚的对应物 ——
 * WO-P5-PREREG-01 那条纪律：常数改动必须出新版本文件 + root 重签）。
 * 新体的「治理常数」= 蓝图里的定案表（GK-1..14、SA/SK 口径、M4 前置清单）。
 */
export const PINNED_DOCS: readonly string[] = Object.freeze([
  'docs/m1_blueprint.md',
  'docs/m2_blueprint.md',
  'docs/m3_blueprint.md',
  'docs/m3_schema_registry.md',
  'docs/m4_handoff.md',
])

/** 仓库根的工程锚（workspaces 决定模块解析，tsconfig 决定可剥离性）。 */
export const PINNED_ROOT_FILES: readonly string[] = Object.freeze([
  'package.json',
  'tsconfig.json',
])

/**
 * 扫全树，收集**源码里真正读到的** `LYKOI_*` 环境变量名。
 *
 * 检查项③拿它与 `ENV_PINS` 求差：只要有人加了一个治理 env 面却忘了钉，门当场
 * 红。这条刻意做成「算出来的」而不是「记得同步一张表」—— 与事件词汇 V2 同一条
 * 理由：表会过期，扫描不会。
 *
 * 认两种写法：属性读法（process.env 点上变量名）与字符串字面量读法（常量名 /
 * Schema 默认值那一类间接读法）。**本注释刻意不写出任何形如变量名的样例** ——
 * 扫描器会把注释里的样例也扫进来，那就成了一个不存在的幽灵条目。
 */
const ENV_READ_RE = /(?:process\.env\.(LYKOI_[A-Z0-9_]+))|(?:'(LYKOI_[A-Z0-9_]+)')/g

export function scanEnvReads(repoRoot: string): Set<string> {
  const names = new Set<string>()
  let packages: string[]
  try {
    packages = readdirSync(join(repoRoot, 'packages'), { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return names
  }
  for (const pkg of packages) {
    for (const file of collectTs(join(repoRoot, 'packages', pkg, 'src'))) {
      let text: string
      try {
        text = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const match of text.matchAll(ENV_READ_RE)) names.add(match[1] ?? match[2]!)
    }
  }
  return names
}

// ============================== 目录遍历（共用出处） ==============================

/** 递归收集一棵目录下的 `.ts`（排序；不跟 symlink 进目录）。 */
export function collectTs(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue // symlink 不跟进：影蔽面由检查项②单管
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full)
    }
  }
  walk(dir)
  return out.sort()
}

/** 目录存在且是真目录（不是 symlink、不是文件）。 */
export function isRealDir(path: string): boolean {
  try {
    return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
  } catch {
    return false
  }
}

/** manifest 里的 key：仓库内文件用仓库相对路径（POSIX 分隔符），仓库外用绝对路径。 */
export function manifestKey(repoRoot: string, path: string): string {
  const rel = relative(repoRoot, path)
  if (rel.startsWith('..') || rel.length === 0) return path
  return sep === '/' ? rel : rel.split(sep).join('/')
}
