/**
 * 不可变治理核 TS 对应物（guardian/policy_core.py 逐字迁；正本 = 治理仓库
 * wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/policy_core.py，sha256 前缀
 * 144b9bfb 与服务器逐位对账；core-v1-repo 镜像作废）。
 *
 * 活体形态：root-owned、运行时只读、stdlib-only、不 import lykoi 包 —— live
 * kernel 咨询它但削不动它。新体形态（SK-13 语义对应）：core 是**编译期 import**
 * 的本模块，物理上没有 env 重定向面；"加载失败 fail CLOSED"的分支保留在
 * approval 侧（_policyCore 为 null 时 hard_decision → 'ask'、autonomous 能力面
 * → 'deny'），以 `_setPolicyCoreForTest(null)` 红测。root 属主 + manifest 三向
 * 核对的物理不可变性归 M3-W4 完整性门（SK-70..76 / GK-13）。
 *
 * 三旋钮（SK-73）：
 * - hardDecision(actionType)："ask" 强制走所有者（降级任何 live "allow"）、
 *   "deny" 永不可跑、null 交给 live 规则。live 规则只能收紧。
 * - capabilityProfile(origin, actionType)：origin 级可达地板。只约束
 *   autonomous：恰好 AUTONOMOUS_ALLOWED 内可达，其余一律 "deny"；其它 origin
 *   返回 null（无意见）。kernel 在 hard "ask" **之前**评估能力 "deny"，所以
 *   autonomous 请求硬门动作（terminal.exec）是拒绝，不是排队给一个不存在的
 *   审批人（GT-4）。
 * - isProtectedPath：文件系统禁区判定 —— 依赖 path-guard（realpath fail
 *   closed）。W1 只钉 PROTECTED_PATHS 常量，W4 补齐判定函数本体 + GK-13 重划的
 *   那条禁区（新体完整性门源目录；2026-09-01 旧体 guardian 条目退役后它是第二条，
 *   见 PROTECTED_PATHS 上方的退役记录）。
 *
 * import 纪律（活体「imports nothing from the lykoi package」的对应物）：本模块
 * 只 import 同属 root 属主域的 `./path-guard.ts`，**再无别的**。完整性门直接
 * import 本模块（活体 startup_verify import 兄弟 policy_core 的同一拓扑），所以
 * 这条纪律断了，门就得把治理核抄一份 —— 那才是真的分叉。
 */
import { isWithin } from './path-guard.ts'

// 必须永远走所有者审批的动作类型，无论 live approval_rules.json 怎么写。
// 无限制 shell 是典型；delegation.dispatch 随 WO-GW-01 加入（owner-adopted
// executor recommendation, 2026-08-21）：生出子代理必须面对所有者。
export const HARD_ASK_TYPES: ReadonlySet<string> = new Set([
  'terminal.exec',
  'delegation.dispatch',
])

// 即使所有者批准也永不可跑的动作类型。当前为空 —— 保留位；按动作的拒绝在
// live 规则里，按路径的在 PROTECTED_PATHS。
export const HARD_DENY_TYPES: ReadonlySet<string> = new Set([])

// autonomous 运行时可达动作的**全集**（allow-list 不是 deny-list：不在此表 =
// 对 origin="autonomous" 拒绝）。活体放在 root-owned + manifest-hashed 的
// guardian 里，所以她改 live 规则也扩不了自己的自主面。
// **8 项逐字**（guardian-live-20260825 取证实录；SPEC-CONV"9 项"系计数误差，
// DK-02 已闭合）。GK-12：建议问答机对 `messenger.send ∈ AUTONOMOUS_ALLOWED`
// 的依赖由显式结构测试钉死（test/policy-core.test.ts）。
export const AUTONOMOUS_ALLOWED: ReadonlySet<string> = new Set([
  'research_browser.open',
  'research_browser.read_text',
  'research_browser.extract_links',
  'research_browser.screenshot',
  'autonomy.queue_notification',
  'autonomy.initiate_chat', // WO-NIGHT-01/B3: 主动开口(对话消息; 日1条/冷却6h 在资源层强制)
  // WO-P2-S1A/S1B: 她自己的社交器官。send 的日1条/冷却6h 同样在资源层强制;
  // read 无副作用。绑定校验在设备层(只接受 identity_bindings 内的发送者)。
  'messenger.send',
  'messenger.read',
])

// 任何资源都永不可达的文件系统禁区（realpath 经 path_guard 应用，symlink/".."
// 逃不出前缀）。
//
// **条目寿命纪律（D-GD-3，2026-09-01 事故换来的）**：这张表里的每一条都必须是
// 机器上**长存**的路径。path-guard 的 `isWithin` 是 SK-74 fail closed —— base
// 或 path 任一 realpath 解析失败一律判「在内」—— 所以一条 base 从磁盘上消失，
// 不是这一条失效，而是**任何路径**对它都在内：整张护栏全封锁，
// `isProtectedPath` 恒 true，gate 检查项④的两条「不得误封」探针双 FAIL，
// ExecStartPre 拦启动。**条目消失 = 护栏全封锁 = 检查项④拦启动**；要加条目或
// 要挪走一条已存在的目录，先读这一段。
//
// 第一条 = 活体取证值**逐字保全**，一个字节都没动：`/home/lykoi/secrets` 是
// 同一台机器上的同一个密钥目录。
//
// **退役记录（D-GD-1，WO-GUARD-RETIRE，2026-09-01）**：原第二条
// `/home/lykoi/projects/lykoi/guardian`（活体取证逐字②，**旧体**的 guardian）
// 已删。它的原注释亲口写了寿命条款 —— 「M4 切换窗里新旧体同机共存（R-01：绝不
// 同时写 state），旧体的 guardian 在那段时间必须照旧不可达，所以这条不但不删，
// 还必须留到旧体退役之后（CORE-RETIRE 正本）」。WO-CORE-RETIRE 于 2026-09-01
// 封存旧仓 `/home/lykoi/projects/lykoi`，该条款到期，条目随之退役：删的是**过期
// 条目**，不是那段历史（保史即此段）。旧体现址是归档区
// `/home/lykoi/archive/old-body-20260901`（root:root 700），物理不可达，
// 无需护栏条目接替。退役的代价在链条另一头已实证：条目留着而目录没了，正是上面
// 那条寿命纪律说的全封锁事故。
//
// 第二条 = GK-13 受保护面重划（DK-05；蓝图明写「W4 细化」）的新体一半：CF-B2
// 退役后「guardian 自身」这个禁区在新体的住址是完整性门的源目录。值是**生产
// 规范路径**（不是运行期推导）—— 与第一条同形态，物理上没有 env/cwd
// 重定向面。生产仓库根路径是 M4 供给项（docs/m4_handoff.md 前置 #7）：若治理侧
// 最终把新体装在别的路径上，这一行随之重签 manifest，属于部署期一次性动作。
export const GATE_SOURCE_CANONICAL = '/home/lykoi/projects/lykoi-cordis/packages/lykoi-gate'

export const PROTECTED_PATHS: readonly string[] = [
  '/home/lykoi/secrets',
  GATE_SOURCE_CANONICAL,
]

/**
 * 第三旋钮（SK-73）：`path` 落进任一禁区 → true。realpath 经 path-guard 应用，
 * 解析失败当「在内」（fail closed，SK-74）。
 *
 * 活体 `is_protected_path` 逐字：`any(path_guard.is_within(path, base) for base
 * in PROTECTED_PATHS)`。
 */
export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATHS.some((base) => isWithin(path, base))
}

export type HardDecision = 'deny' | 'ask' | null
export type CapabilityDecision = 'allow' | 'deny' | null

/** "deny" / "ask" / null（交给 live 规则）。 */
export function hardDecision(actionType: string): HardDecision {
  if (HARD_DENY_TYPES.has(actionType)) return 'deny'
  if (HARD_ASK_TYPES.has(actionType)) return 'ask'
  return null
}

/**
 * origin 级可达地板："allow" / "deny" / null。只约束 autonomous —— allow-list
 * 内 "allow"，其余 "deny"；其它 origin 一律 null（无意见）。
 */
export function capabilityProfile(origin: string, actionType: string): CapabilityDecision {
  if (origin !== 'autonomous') return null
  return AUTONOMOUS_ALLOWED.has(actionType) ? 'allow' : 'deny'
}

/** approval 侧咨询的 core 形状（null = 加载失败 → fail CLOSED）。 */
export interface PolicyCoreLike {
  hardDecision(actionType: string): HardDecision
  capabilityProfile(origin: string, actionType: string): CapabilityDecision
}

/** 内建 core 的句柄形态（approval 缺省咨询它）。 */
export const builtinPolicyCore: PolicyCoreLike = { hardDecision, capabilityProfile }
