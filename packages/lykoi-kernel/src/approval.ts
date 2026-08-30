/**
 * 所有者审批 —— 敏感动作要 Kevin 点头（kernel/approval.py 逐字对拍；
 * SK-15..29）。
 *
 * 规则住在 JSON 文件里（env `LYKOI_APPROVAL_RULES`）：
 *
 *     {"always_allow": [], "always_deny": ["browser.pay"], "ask": []}
 *
 * 一条规则是精确动作类型（"browser.navigate"）或以 "*" 结尾的类别前缀
 * （"browser.*" 命中每个 browser.<...>）。always_deny 先查，具体 deny 压过
 * 类别 allow。`terminal.exec` 刻意**不在**默认 always_allow：无限制 shell
 * 永不自动批准，每条 shell 命令都是一次显式的按动作授权。
 *
 * `check` 对一个动作类型判定 allow / ask / deny；常设 always_allow/always_deny
 * 由编辑规则文件设置（那是 Kevin 的笔，她永无写路径）；一次性 "ask" 经
 * pending 队列由所有者当次消费（enqueuePending / consumePending）。
 *
 * 路径纪律：活体在 import 期读 env 一次；新体惰性每次读（单进程、测试隔离），
 * dev 缺省 var/state/*.json —— 生产 env 钉面（GK-6：统一钉全部治理 state 路径）
 * 归 M3-W4 完整性门。锁纪律见 jsonio.ts 顶注（GK-4：单进程，读-改-写全同步）。
 *
 * SK-13 语义对应：活体 guardian 路径由文件路径推导、不可 env 重定向；新体
 * policy core 是编译期 import（policy-core.ts），物理上无重定向面。"加载失败
 * fail CLOSED" 的分支在 _policyCore 为 null 的路径上保留（hardDecision→'ask'、
 * autonomous 能力面→'deny'），以 _setPolicyCoreForTest(null) 红测。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { covers } from './exemption.ts'
import { writeJsonAtomic } from './jsonio.ts'
import { builtinPolicyCore, type PolicyCoreLike } from './policy-core.ts'
import { scopeKey } from './scope.ts'
import { logEvent } from './telemetry.ts'

export function rulesPath(): string {
  return process.env.LYKOI_APPROVAL_RULES ?? 'var/state/approval_rules.json'
}

const _DEFAULT_RULES = { always_allow: [], always_deny: [], ask: [] } as const
const _KEYS = ['always_allow', 'always_deny', 'ask'] as const

export interface RulesDocument {
  always_allow: string[]
  always_deny: string[]
  ask: string[]
  autonomous?: { always_allow: string[]; always_deny: string[] }
  [key: string]: unknown
}

// --- 不可变核咨询位 -----------------------------------------------------------

let _policyCore: PolicyCoreLike | null = builtinPolicyCore

/** 测试面：null 模拟 core 加载失败（fail CLOSED 红测）；undefined 恢复内建。 */
export function _setPolicyCoreForTest(core: PolicyCoreLike | null | undefined): void {
  _policyCore = core === undefined ? builtinPolicyCore : core
}

/** 咨询不可变核。core 不可用时 fail closed 到 "ask"（永不自动放行任何东西）。 */
function _hardDecision(actionType: string): 'deny' | 'ask' | null {
  if (_policyCore === null) return 'ask' // no governance core -> never auto-allow anything
  return _policyCore.hardDecision(actionType)
}

// scheduler origin 的**全部**可达面。不可变核对非 autonomous origin 无意见
// （policy_core 文档写明），所以这道地板住在 kernel、由治理不变量测试钉死：
// 后台 scheduler 可以通知 Kevin，此外什么都不能做。deny-by-default —— 不在表
// 内的动作对 origin="scheduler" 在咨询 live 规则**之前**就拒绝，被塞进来的
// always_allow 因此放不宽它。
export const SCHEDULER_ALLOWED: ReadonlySet<string> = new Set(['notify.owner'])

// GK-7（治理定案，列 Kevin 追认清单）：delegated origin 的显式能力地板 =
// **空集**。活体对 delegated 无地板（_capability 返回 None，等同 interactive
// 待遇）—— DK-11 立案；新体拍板为比活体**收紧**：M5 执行器官上线前，任何
// origin="delegated" 的派发在第②步就 deny，届时经治理扩表，不靠缺省放行。
export const DELEGATED_ALLOWED: ReadonlySet<string> = new Set([])

// WO-GW-01 ④ (设计 §3.2): 委托网关的**只读**两条 —— 查合同状态、收执行收据。
// 它们没有外部副作用(不启动进程、不出网、不碰 secrets)，照工单分级是免询;
// `delegation.dispatch` **不在这里**，它落到硬门 "ask"，她发起委托必须过审批。
//
// 为什么是代码常量而不是 approval_rules.json 里的两条 always_allow（SK-21）:
// 规则文件是 Kevin 的笔，她的任何路径对它永无写路径 —— 往那里写两条免询，
// 等于让一次代码交付去改所有者的策略文件。写在这里则是一次**可评审的、随
// 代码走的**扩面，且被 check 里的咨询位置钉在"只能收紧"的那一侧。
//
// 咨询位置见 check：与 always_allow 同层，排在不可变硬规则、能力面、live
// always_deny 之后。因此它 (a) 翻不动 always_deny —— Kevin 想关掉这两条免询，
// 往 always_deny 写一行就够；(b) 对 autonomous/scheduler/delegated 完全无效 ——
// 那些 origin 的能力面在更早一步就已返回 deny。
export const DELEGATION_READONLY: ReadonlySet<string> = new Set([
  'delegation.status',
  'delegation.collect',
])

/**
 * origin 级能力地板："allow"/"deny"/null（SK-16 + GK-7）。
 *
 * autonomous 受不可变核约束；核不可用时 fail CLOSED **到 deny** —— 治理核
 * 缺席必须把自主面缩到零，永不打开。scheduler 受上面的 kernel 级
 * SCHEDULER_ALLOWED 地板约束。delegated 受 GK-7 空集地板约束（新体收紧）。
 * interactive/system 得 null（硬规则与 live 文件决定）。
 */
function _capability(origin: string, actionType: string): 'allow' | 'deny' | null {
  if (origin === 'scheduler') {
    return SCHEDULER_ALLOWED.has(actionType) ? 'allow' : 'deny'
  }
  if (origin === 'delegated') {
    return DELEGATED_ALLOWED.has(actionType) ? 'allow' : 'deny' // GK-7: 空集 → 恒 deny
  }
  if (origin !== 'autonomous') return null
  if (_policyCore === null) return 'deny'
  return _policyCore.capabilityProfile(origin, actionType)
}

/**
 * 按 origin 取 live always_allow/always_deny（SK-17）。
 *
 * interactive/system 用扁平顶层键（不变，startup_verify 的完整性门与既有测试
 * 继续成立）。autonomous 读可选的、加法的 "autonomous" 子块；块缺席 = 无常设
 * 规则。live 规则只能**收紧**策略。
 */
function _originRules(origin: string): { always_allow: string[]; always_deny: string[] } {
  const rules = _load()
  if (origin === 'autonomous') {
    const block = (rules.autonomous ?? {}) as Record<string, unknown>
    return {
      always_allow: [...((block.always_allow as string[] | undefined) ?? [])],
      always_deny: [...((block.always_deny as string[] | undefined) ?? [])],
    }
  }
  return {
    always_allow: [...((rules.always_allow as string[] | undefined) ?? [])],
    always_deny: [...((rules.always_deny as string[] | undefined) ?? [])],
  }
}

/**
 * 审批规则文档的结构 schema 检查（SK-18）。返回问题列表（[] = 合式）。
 * 活体的启动门（guardian startup_verify._rules_schema_problems）跑同一形状
 * 检查 —— 孪生双拷贝是结构要求（SK-72，W4 落对面那份）；这份运行时拷贝让
 * _load 对运行中变坏的文件 fail closed。
 */
export function validateRules(rules: unknown): string[] {
  if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
    return ['rules must be a JSON object']
  }
  const problems: string[] = []
  const doc = rules as Record<string, unknown>

  const checkStrList = (block: Record<string, unknown>, key: string, where: string): void => {
    const value = block[key] ?? []
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      problems.push(`${where}${key} must be a list of strings`)
    }
  }

  for (const key of _KEYS) checkStrList(doc, key, '')
  const extra = Object.keys(doc).filter((k) => !(_KEYS as readonly string[]).includes(k) && k !== 'autonomous')
  if (extra.length > 0) problems.push(`unknown top-level keys: ${JSON.stringify(extra.sort())}`)
  const block = doc.autonomous
  if (block !== undefined && block !== null) {
    if (typeof block !== 'object' || Array.isArray(block)) {
      problems.push('autonomous block must be an object')
    } else {
      const b = block as Record<string, unknown>
      for (const key of ['always_allow', 'always_deny']) checkStrList(b, key, 'autonomous.')
      const blockExtra = Object.keys(b).filter((k) => k !== 'always_allow' && k !== 'always_deny')
      if (blockExtra.length > 0) problems.push(`unknown autonomous keys: ${JSON.stringify(blockExtra.sort())}`)
    }
  }
  return problems
}

function _defaultRules(): RulesDocument {
  return { always_allow: [], always_deny: [], ask: [] }
}

/**
 * 读 live 规则（SK-19）。文件缺失 → 写空默认后返回默认。读失败/畸形/schema
 * 不合 → fail CLOSED 回空默认（不可变地板之外一律 "ask"）+ 事件，**不崩溃**
 * —— 崩掉每一次策略判定比空默认更宽。
 */
function _load(): RulesDocument {
  const path = rulesPath()
  if (!existsSync(path)) {
    _save(_defaultRules())
    return _defaultRules()
  }
  let rules: unknown
  try {
    rules = JSON.parse(readFileSync(path, 'utf8'))
  } catch (exc) {
    logEvent('approval_rules_invalid', { path, error: exc instanceof Error ? exc.message : String(exc) })
    return _defaultRules()
  }
  const problems = validateRules(rules)
  if (problems.length > 0) {
    logEvent('approval_rules_invalid', { path, problems })
    return _defaultRules()
  }
  const doc = rules as RulesDocument
  for (const key of _KEYS) {
    // tolerate a hand-edited file missing a list
    if (!Array.isArray(doc[key])) doc[key] = []
  }
  return doc
}

/** 只写扁平三键（铺空默认用）。 */
function _save(rules: RulesDocument): void {
  const flat: Record<string, unknown> = {}
  for (const key of _KEYS) flat[key] = rules[key] ?? []
  writeJsonAtomic(rulesPath(), flat)
}

/**
 * 整文档写回，**保留**可选 autonomous 子块（SK-19 _persist）。_save 刻意只写
 * 扁平键（它存在是为铺空默认）；对活文件的读-改-写不许静默丢 autonomous 块，
 * scoped-grant 的写全走这里。
 */
function _persist(rules: RulesDocument): void {
  const document: Record<string, unknown> = {}
  for (const key of _KEYS) document[key] = [...(rules[key] ?? [])]
  const block = rules.autonomous
  if (typeof block === 'object' && block !== null && !Array.isArray(block)) {
    document.autonomous = {
      always_allow: [...(block.always_allow ?? [])],
      always_deny: [...(block.always_deny ?? [])],
    }
  }
  writeJsonAtomic(rulesPath(), document)
}

function _matches(actionType: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === actionType) return true
    // 类别规则："browser.*"（或 "browser*"）命中整个前缀
    if (pattern.endsWith('*') && actionType.startsWith(pattern.slice(0, -1))) return true
  }
  return false
}

// --- scoped standing authorizations (WO-P2-S2, approval_model_v1 §2/§4) ------
// "批准一次，到底记住了什么？"常设授权存在**同一个** live 规则文件里（设计 §4:
// 不新建存储），形态是 always_allow 里的一条字符串：
//
//     "<action_type>@<scope_key>"        e.g. "messenger.send@user:kevin"
//
// 为什么是这种编码而不是新顶层键：规则文档的 schema 钉在**两处** ——
// 这里的 validateRules 与 root-owned 的 startup_verify._rules_schema_problems
// —— 两处都拒绝未知顶层键。scoped 条目是普通字符串，文档保持 schema 合法，
// 且对遗留 _matches 路径**惰性**：它不等于任何裸动作类型，grantStanding 又
// 拒写含 "*" 的键，所以它也永远变不成类别通配（SK-22）。
export const SCOPE_SEPARATOR = '@'

// 授权的出处/条件住在规则文件**旁边**，不在里面（规则 schema 只收字符串且被
// root 校验）。sidecar 是元数据，永远不是权威：这里有条目而规则无行 = 什么都
// 不授权；规则有行而 sidecar 无条目 = 仍是有效授权，只是没记条件。失败方向
// 永远朝更少的触达。
export function standingPath(): string {
  return process.env.LYKOI_STANDING_GRANTS ?? 'var/state/standing_grants.json'
}

/**
 * SK-20：不可变核强制这个动作每次都过所有者（或干脆拒绝）—— 即它**永不可**
 * 携带常设授权。治理核缺席 fail closed 到 "ask"，所以那时一切动作都算硬门。
 */
export function isHardGated(actionType: string): boolean {
  const hard = _hardDecision(actionType)
  return hard === 'ask' || hard === 'deny'
}

/** 编码一条单 scope 常设授权的 always_allow 字符串。 */
export function scopedEntry(actionType: string, key: string): string {
  return `${actionType}${SCOPE_SEPARATOR}${key}`
}

/** "messenger.send@user:kevin" → ["messenger.send", "user:kevin"]；平条目 → null。 */
export function splitScopedEntry(entry: string): [string, string] | null {
  const idx = entry.indexOf(SCOPE_SEPARATOR)
  if (idx <= 0) return null
  const actionType = entry.slice(0, idx)
  const key = entry.slice(idx + 1)
  if (!actionType || !key) return null
  return [actionType, key]
}

/**
 * 这个动作最窄的键，或 null（无键 → 无常设授权）。刻意 PUBLIC（WO-S3 目标4）：
 * kernel.approval 之外每个模块取 scope key 的唯一入口。scope.scopeKey 的
 * fail-soft 薄包装：算不出来的键就是没有键（null），不是策略判定中途的异常。
 */
export function resolveScopeKey(actionType: string, params: Record<string, unknown> | null): string | null {
  if (params === null || params === undefined) return null
  try {
    return scopeKey(actionType, params)
  } catch (exc) {
    // a key we cannot compute is simply no key
    logEvent('scope_key_failed', { action_type: actionType, error: exc instanceof Error ? exc.message : String(exc) })
    return null
  }
}

function _scopedAllowed(actionType: string, params: Record<string, unknown> | null, allow: readonly string[]): boolean {
  const key = resolveScopeKey(actionType, params)
  if (!key) return false
  return allow.includes(scopedEntry(actionType, key)) // exact match only, never wildcard
}

/**
 * 三层门（SK-15：check 判定全序 **10 步逐字**）。对 origin 的 actionType 判
 * allow/ask/deny；origin 缺省 "interactive"（单参调用方 = pre-P2 行为不变）：
 *
 *   ① 不可变硬 DENY → deny（永不可跑压过一切）
 *   ② 能力面 DENY（origin 级、不可变；**先于**硬 "ask"）→ deny —— autonomous
 *      请求硬门动作（terminal.exec）是拒绝，不是排队给不存在的审批人（GT-4）
 *   ③ live always_deny（specific/category）→ deny（live 只能收紧）
 *   ④ 能力面 ALLOW → allow（autonomous 白名单内、未被收紧）
 *   ⑤ 不可变硬 ASK → ask（interactive 硬地板；always_allow 抬不掉它）
 *   ⑥ live always_allow → allow
 *   ⑦ DELEGATION_READONLY → allow（代码常量非规则行；与⑥同层同纪律 SK-21）
 *   ⑧ scoped grant **精确串相等** → allow（SK-22 永不通配）
 *   ⑨ policy_exemption.covers → allow（E1/E2/E3 消费位 —— 最末位，SK-47/48：
 *      E 章救不了硬门动作、翻不动 always_deny、放不宽能力地板 —— 三者都已先
 *      返回；它能做的全部是把默认 "ask" 的纯文本出站变成 "allow"）
 *   ⑩ 默认 → ask
 *
 * params 是 RAW（未遮蔽）参数，只用于⑧⑨（scope key 由收件人/URL 算出，遮蔽
 * 会毁掉键赖以成立的那个标识），从不在这里落日志 —— 审计行带的是遮蔽副本。
 * live 文件只能收紧 —— 它永远松不动不可变核。
 */
export function check(
  actionType: string,
  origin: string = 'interactive',
  params: Record<string, unknown> | null = null,
  exemption: unknown = null,
): 'allow' | 'ask' | 'deny' {
  const hard = _hardDecision(actionType) // ①
  if (hard === 'deny') return 'deny'
  const cap = _capability(origin, actionType) // ②
  if (cap === 'deny') return 'deny' // capability deny beats a hard "ask"
  const rules = _originRules(origin)
  if (_matches(actionType, rules.always_deny)) return 'deny' // ③ specific or category deny wins
  if (cap === 'allow') return 'allow' // ④ autonomous, allow-listed, not tightened
  if (hard === 'ask') return 'ask' // ⑤ interactive hard floor (e.g. terminal.exec) preserved
  if (_matches(actionType, rules.always_allow)) return 'allow' // ⑥
  // ⑦ WO-GW-01 ④: 委托网关的只读两条。位置就在 always_allow 之后 —— 同一层、
  // 同一条"只能收紧"的纪律。放在这里而不是更早，是为了让上面每道门都先说过话。
  if (DELEGATION_READONLY.has(actionType)) return 'allow'
  if (_scopedAllowed(actionType, params, rules.always_allow)) return 'allow' // ⑧
  // ⑨ WO-U3 ② / P1 附文：白名单豁免，DEAD LAST 咨询 —— 排在每一层不可变与
  // live 文件之后，与 scoped grant 同位同理（只能收紧不能放宽）。
  if (covers(actionType, params ?? {}, exemption)) return 'allow'
  return 'ask' // ⑩
}

// --- standing-grant lifecycle ------------------------------------------------

interface StandingDocument {
  grants: Record<string, unknown>[]
  denials: Record<string, unknown>[]
}

/** sidecar 元数据文档（SK-25 附）：坏文件 → 归零 + 事件（授权权威在规则行）。 */
function _loadStanding(): StandingDocument {
  const path = standingPath()
  if (!existsSync(path)) return { grants: [], denials: [] }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (exc) {
    logEvent('standing_grants_unreadable', { path, error: exc instanceof Error ? exc.message : String(exc) })
    return { grants: [], denials: [] }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { grants: [], denials: [] }
  const doc = raw as Record<string, unknown>
  return {
    grants: Array.isArray(doc.grants) ? (doc.grants as Record<string, unknown>[]) : [],
    denials: Array.isArray(doc.denials) ? (doc.denials as Record<string, unknown>[]) : [],
  }
}

function _nowIsoOf(now?: Date): string {
  return (now ?? new Date()).toISOString() // realtime-allow: governance stamp（Python clock.now() 对应）
}

/**
 * 为一个 scope key 记一条常设授权（SK-23）。返回授权记录，或 null = 不可授：
 *
 * * 动作是硬门（terminal.exec）—— 硬门永不产生常设授权；
 * * 定不出 scope key（**永不**代之以更粗的键）；
 * * 键含 "*"（会被读成类别通配）。
 *
 * 幂等：同 (type, key) 授两次留一条规则行、刷新 sidecar 记录，不叠副本。
 */
export function grantStanding(
  actionType: string,
  params: Record<string, unknown> | null = null,
  opts: {
    scopeKey?: string | null
    question?: string
    answer?: string
    conditions?: readonly string[] | null
    grantedBy?: string
    now?: Date
  } = {},
): Record<string, unknown> | null {
  if (isHardGated(actionType)) {
    logEvent('standing_grant_refused', { action_type: actionType, reason: 'hard_gated' })
    return null
  }
  const key = opts.scopeKey || resolveScopeKey(actionType, params)
  if (!key) {
    logEvent('standing_grant_refused', { action_type: actionType, reason: 'no_scope_key' })
    return null
  }
  if (key.includes('*')) {
    logEvent('standing_grant_refused', { action_type: actionType, reason: 'wildcard_key' })
    return null
  }
  const entry = scopedEntry(actionType, key)
  {
    const rules = _load()
    const allow = [...(rules.always_allow ?? [])]
    if (!allow.includes(entry)) {
      allow.push(entry)
      rules.always_allow = allow
      _persist(rules)
    }
  }
  const record: Record<string, unknown> = {
    entry,
    action_type: actionType,
    scope_key: key,
    granted_at: _nowIsoOf(opts.now),
    granted_by: opts.grantedBy ?? 'owner',
    question: opts.question ?? '',
    answer: opts.answer ?? '',
    // 首版限制（approval_model_v1 §5.2）：conditions 存 Kevin 的**原话**，同
    // scope 动作前注入她的上下文。**不做机器判定** —— 没有代码检查后来的发送
    // 是否真守了「别提我家地址」。
    conditions: [...(opts.conditions ?? [])],
    revoked_at: null,
  }
  {
    const document = _loadStanding()
    document.grants = [...document.grants.filter((item) => item.entry !== entry), record]
    writeJsonAtomic(standingPath(), document)
  }
  logEvent('standing_grant_written', { action_type: actionType, scope_key: key })
  return record
}

/**
 * 撤销恰好一条常设授权（纪律 3；SK-24）。立即生效：下一次 check 找不到那行。
 * 返回是否真的删掉了规则行。
 */
export function revokeStanding(actionType: string, scope: string, opts: { now?: Date } = {}): boolean {
  const entry = scopedEntry(actionType, scope)
  let removed = false
  {
    const rules = _load()
    const allow = [...(rules.always_allow ?? [])]
    removed = allow.includes(entry)
    if (removed) {
      rules.always_allow = allow.filter((item) => item !== entry)
      _persist(rules)
    }
  }
  {
    const document = _loadStanding()
    for (const item of document.grants) {
      if (item.entry === entry && !item.revoked_at) item.revoked_at = _nowIsoOf(opts.now)
    }
    writeJsonAtomic(standingPath(), document)
  }
  logEvent('standing_grant_revoked', { action_type: actionType, scope_key: scope, removed })
  return removed
}

/**
 * 每条活着的常设授权 —— "定期回顾清单"（approval_model_v1 §5.1；SK-24）：我到底
 * 授权了什么、多宽？权威是规则文件：条目在此出现 iff 规则行存在；sidecar 元
 * 数据（有则）并入 why/when/条件。
 */
export function standingGrants(): Record<string, unknown>[] {
  const allow = [...(_load().always_allow ?? [])]
  const meta = new Map<unknown, Record<string, unknown>>()
  for (const item of _loadStanding().grants) meta.set(item.entry, item)
  const live: Record<string, unknown>[] = []
  for (const entry of allow) {
    const split = splitScopedEntry(entry)
    if (split === null) continue
    const [actionType, key] = split
    const record: Record<string, unknown> = { ...(meta.get(entry) ?? {}) }
    record.entry = entry
    record.action_type = actionType
    record.scope_key = key
    if (!('conditions' in record)) record.conditions = []
    live.push(record)
  }
  return live
}

/**
 * 覆盖这个动作的常设授权上挂着的 Kevin 条件原文（她行动前注入上下文）。无条件
 * 或未授权 = 空。永远不是机器强制的约束 —— 见 grantStanding。
 */
export function conditionsFor(actionType: string, params: Record<string, unknown> | null = null): string[] {
  const key = resolveScopeKey(actionType, params)
  if (!key) return []
  const entry = scopedEntry(actionType, key)
  for (const record of standingGrants()) {
    if (record.entry === entry) return [...((record.conditions as string[] | null) ?? [])]
  }
  return []
}

/**
 * 记一次拒绝（SK-25），让问询路径能守住「同范围短期内不再问」（approval_model_v1
 * §3）。**advisory only**：刻意不接进 check —— 一次拒绝不许静默变异成常设
 * deny 规则，它只抑制再问。读用 recentDenial。
 */
export function recordDenial(
  actionType: string,
  scope: string,
  opts: { answer?: string; now?: Date } = {},
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    entry: scopedEntry(actionType, scope),
    action_type: actionType,
    scope_key: scope,
    denied_at: _nowIsoOf(opts.now),
    answer: opts.answer ?? '',
  }
  {
    const document = _loadStanding()
    document.denials = [...document.denials, record].slice(-100)
    writeJsonAtomic(standingPath(), document)
  }
  logEvent('standing_denial_recorded', { action_type: actionType, scope_key: scope })
  return record
}

/** 「短期」= 一天：长到不烦人，短到不是一句永久的"不"。 */
export const DENIAL_QUIET_H = 24.0

/** DENIAL_QUIET_H 内这个 scope 最近一次拒绝，或 null。 */
export function recentDenial(
  actionType: string,
  scope: string,
  opts: { now?: Date } = {},
): Record<string, unknown> | null {
  const entry = scopedEntry(actionType, scope)
  const moment = opts.now ?? new Date()
  let latest: Record<string, unknown> | null = null
  for (const record of _loadStanding().denials) {
    if (record.entry !== entry) continue
    const when = Date.parse(String(record.denied_at ?? ''))
    if (Number.isNaN(when)) continue
    if ((moment.getTime() - when) / 1000 <= DENIAL_QUIET_H * 3600) {
      if (latest === null || when > Date.parse(String(latest.denied_at))) latest = record
    }
  }
  return latest
}

// --- initial pre-authorization (approval_model_v1 §2b；SK-26) -----------------
// S1B 撞过的死锁：messenger.send 默认 "ask"，她没有审批就不能回 Kevin，而不回
// Kevin 又请求不了审批。§2b 用部署期声明所有者 scope key 预授权解开：回复已
// 绑定所有者、主动联系已绑定所有者是免询 —— 打扰纪律（日上限/6h 冷却，资源层）
// 才是主动消息的边界，不是按条审批。其他每个收件人仍走 ask-once。
//
// 注意它**没有**放宽什么：授权是一个 scope key（user:<owner>），写法与任何对话
// 授权一致、同样可撤销。所有者若经未绑定到其 user 行的 channel 键被触达，
// scope key 落到更窄的 channel:... 键，她照样问 —— 最窄默认在这里也成立。
//
// **不挂启动**（GK-9 / SK-26）：这是部署期一次性的 owner 侧动作，重放/确认
// 已列入 M4 切换清单预置条目 —— M3 不执行、不接线。
export const OWNER_PREAUTHORIZED_ACTIONS: readonly string[] = ['messenger.send']

/**
 * 幂等安装 §2b 初始预授权。部署期调用一次。userId 缺省经注入的 ownerLookup
 * 取 owner_primary 行；没有这样的行就什么都不授（还没有可信任的所有者），并
 * 告知调用方。
 */
export function bootstrapOwnerPreauthorization(
  userId: string | null = null,
  opts: { ownerLookup?: () => string | null; now?: Date } = {},
): { owner_user_id: string | null; granted: string[]; already: string[] } {
  if (userId === null && opts.ownerLookup) {
    try {
      userId = opts.ownerLookup()
    } catch (exc) {
      // no store means no owner means no grant
      logEvent('owner_preauth_lookup_failed', { error: exc instanceof Error ? exc.message : String(exc) })
      userId = null
    }
  }
  if (!userId) {
    logEvent('owner_preauth_skipped', { reason: 'no_owner_primary' })
    return { owner_user_id: null, granted: [], already: [] }
  }
  const granted: string[] = []
  const already: string[] = []
  for (const actionType of OWNER_PREAUTHORIZED_ACTIONS) {
    const key = `user:${userId}`
    const entry = scopedEntry(actionType, key)
    const present = (_load().always_allow ?? []).includes(entry)
    if (present) {
      // M4-W1 / GK-9 幂等：**授权行已在册 = 一个字节都不写**。
      //
      // 从前这里照样走一遍 grantStanding：规则文件因为去重不会变，但 sidecar
      // （standing_grants.json）会被刷成一个新的 granted_at。部署期这个入口可能
      // 被跑第二次（切换窗的「确认」那一步就是），届时一次纯确认不该在账面上
      // 留下一条像是新授权的记录 —— 也不该动任何一个受哈希钉的文件。
      //
      // 丢掉的只有 sidecar 那条元数据的刷新，而 sidecar 本来就**不是权威**
      // （见本文件 §scoped standing authorizations 的注释：规则有行而 sidecar
      // 无条目 = 仍是有效授权，只是没记条件）。授权本身分毫未动。
      if (!isHardGated(actionType)) already.push(entry)
      continue
    }
    const record = grantStanding(actionType, null, {
      scopeKey: key,
      question: '(初始预授权 approval_model_v1 §2b)',
      answer: '(出厂预授权: 回复/主动联系已绑定所有者免询)',
      grantedBy: 'bootstrap',
      ...(opts.now === undefined ? {} : { now: opts.now }),
    })
    if (record === null) continue
    granted.push(entry)
  }
  logEvent('owner_preauth_installed', { owner: userId, granted: granted.length, already: already.length })
  return { owner_user_id: userId, granted, already }
}

// --- Pending-approval queue (owner absence, #24；SK-27..29) -------------------
// 等 Kevin 点头的动作持久在这里：耐重启，且 Kevin 看得到有几件在等。每条记录
// 是绑定精确 (action_type, params) 的一次性授权：带 action_id（== 其 id）、
// params_hash、expires_at、correlation_id（串起 dispatch → approval →
// execution → audit 链）、以及恰好置一次的 consumed_at（授权不可重放）。
//
// 坏文件姿态（GK-2 治理定案）：**照抄活体 —— 无保护**。_loadPending 直接
// JSON.parse，坏文件抛异常 = 审批面可见地崩，而不是静默丢一整队待批动作。
// R-14 纪律：不许顺手 try/catch；要改语义单独提单。
export function pendingPath(): string {
  return process.env.LYKOI_PENDING_ACTIONS ?? 'var/state/pending_actions.json'
}

export function pendingTtlS(): number {
  const raw = process.env.LYKOI_PENDING_TTL_S
  const parsed = raw === undefined ? NaN : Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : 900 // 15 min
}

function _loadPending(): Record<string, unknown>[] {
  if (!existsSync(pendingPath())) return []
  return JSON.parse(readFileSync(pendingPath(), 'utf8')) as Record<string, unknown>[] // 无保护（GK-2）
}

function _savePending(items: Record<string, unknown>[]): void {
  writeJsonAtomic(pendingPath(), items)
}

/** Python json.dumps(sort_keys=True, default=str) 的等价确定性键（进程内一致）。 */
export function paramsKey(params: unknown): string {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical)
    if (typeof value === 'object' && value !== null) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        out[key] = canonical((value as Record<string, unknown>)[key])
      }
      return out
    }
    if (value === undefined || typeof value === 'function' || typeof value === 'bigint') {
      return String(value) // default=str 同向：不可序列化的落成字符串
    }
    return value
  }
  return JSON.stringify(canonical(params))
}

export function paramsHash(params: unknown): string {
  return createHash('sha256').update(paramsKey(params), 'utf8').digest('hex')
}

function _expired(item: Record<string, unknown>, now: Date): boolean {
  const expiresAt = item.expires_at
  if (!expiresAt) return false
  const t = Date.parse(String(expiresAt))
  if (Number.isNaN(t)) return false
  return now.getTime() > t
}

function _randomHex32(): string {
  return randomUUID().replaceAll('-', '') // uuid4().hex 同形态
}

/**
 * 入队一个待批动作；按 (type, params) 去重（SK-27：同 grant 同 id）。返回 id。
 *
 * id 就是 action_id（不透明 hex），审批端点 URL 用它 —— 所有者批的正是他看到
 * 的那个动作。actionId/correlationId 来自暂停的那次 dispatch，最终执行与本次
 * 请求共享一条 correlation 链。origin/runId 记录暂停动作来自的运行时边界，
 * 批准后的重派在**同一** origin 下重新评估策略。questionMessageId/questionText
 * （WO-S3）记录她实际发给 Kevin 的问句 —— 对话答复因此可归属：引用那条消息 id
 * 的回复精确解析到本记录，不靠猜。
 */
export function enqueuePending(
  actionType: string,
  params: Record<string, unknown>,
  opts: {
    actionId?: string | null
    correlationId?: string | null
    origin?: string
    runId?: string | null
    questionMessageId?: string | number | null
    questionText?: string | null
    now?: Date
  } = {},
): string {
  const items = _loadPending()
  const key = paramsKey(params)
  for (const item of items) {
    if (item.action_type === actionType && paramsKey(item.params) === key) {
      return String(item.id) // already queued (same action+params) -> same grant
    }
  }
  const pendingId = opts.actionId ?? _randomHex32()
  const now = opts.now ?? new Date()
  items.push({
    id: pendingId,
    ts: now.toISOString(),
    action_type: actionType,
    params,
    params_hash: paramsHash(params),
    correlation_id: opts.correlationId ?? _randomHex32(),
    origin: opts.origin ?? 'interactive',
    run_id: opts.runId ?? null,
    expires_at: new Date(now.getTime() + pendingTtlS() * 1000).toISOString(),
    consumed_at: null,
    question_message_id: opts.questionMessageId === null || opts.questionMessageId === undefined
      ? null
      : String(opts.questionMessageId),
    question_text: opts.questionText ?? null,
  })
  _savePending(items)
  return pendingId
}

/** 这个 id 的 pending 记录，或 null。 */
export function findPending(pendingId: string | null): Record<string, unknown> | null {
  if (!pendingId) return null
  for (const item of _loadPending()) {
    if (item.id === pendingId) return item
  }
  return null
}

/**
 * 原子认领一条授权供执行（SK-28）。返回 [status, record]：
 *
 * * ["ok", record] —— 有效、未消费、未过期、params 匹配；记录已盖
 *   consumed_at+actor（第二次调用返回 "consumed"）。
 * * ["missing", null] / ["consumed", null] / ["expired", null] / ["mismatch", null]。
 *
 * 整个 check-and-stamp 同步执行（单进程串行），同一授权的两次并发批准不可能
 * 都执行。
 */
export function consumePending(
  pendingId: string,
  params: Record<string, unknown>,
  opts: { actor?: string; now?: Date } = {},
): ['ok' | 'missing' | 'consumed' | 'expired' | 'mismatch', Record<string, unknown> | null] {
  const now = opts.now ?? new Date()
  const items = _loadPending()
  for (const item of items) {
    if (item.id !== pendingId) continue
    if (item.consumed_at) return ['consumed', null]
    if (_expired(item, now)) return ['expired', null]
    if (item.params_hash && item.params_hash !== paramsHash(params)) return ['mismatch', null]
    item.consumed_at = now.toISOString()
    item.actor = opts.actor ?? 'owner'
    _savePending(items)
    return ['ok', item]
  }
  return ['missing', null]
}

/**
 * 问句 message id 指到的 pending 记录 —— **含死记录**（consumed / expired /
 * resolved；SK-29）。这正是要点（WO-S3 §2）：Kevin 回二十分钟前的问句时活队列
 * 已不含它，只看 pendingActions 的路径会把他的回答当闲聊静默丢掉 —— 让他以为
 * 自己答过了。这个查找让调用方能说"那条已经过期了"。
 */
export function findPendingByQuestion(questionMessageId: string | number | null): Record<string, unknown> | null {
  if (questionMessageId === null || questionMessageId === undefined) return null
  const target = String(questionMessageId)
  for (const item of _loadPending()) {
    if (String(item.question_message_id) === target) return item
  }
  return null
}

/**
 * 一条记录的状态：live | consumed | resolved | expired（SK-29 判序）。顺序有
 * 意义：已消费（执行过）且其后过了 TTL 的记录仍是 "consumed" —— 它经历了什么
 * 才是有趣的事实，时间继续走不是。
 */
export function pendingState(item: Record<string, unknown>, opts: { now?: Date } = {}): string {
  if (item.consumed_at) return 'consumed'
  if (item.resolved) return 'resolved'
  if (_expired(item, opts.now ?? new Date())) return 'expired'
  return 'live'
}

/**
 * 把 pending 记录改指到**最新**问它的那条消息（SK-29 问句单链）。追问是一条新
 * 消息，Kevin 会回那一条。没有这步，reply-to 指到无主消息、答复落回猜测路径。
 * 一条 pending 恒持一个问句 id —— 最近那个 —— 链保持单条，永不分叉。
 */
export function setQuestionMessageId(pendingId: string, questionMessageId: string | number | null): boolean {
  const items = _loadPending()
  for (const item of items) {
    if (item.id !== pendingId) continue
    item.question_message_id = questionMessageId === null || questionMessageId === undefined
      ? null
      : String(questionMessageId)
    _savePending(items)
    return true
  }
  return false
}

/**
 * 不执行地终局关闭一条 pending（一次拒绝；SK-29）。mark-only，刻意不是
 * dropPending：拒绝正是台账该留的事实，留行才让第二句「不用了」被认出是在答
 * 一件已了结的事而不是闲聊。pendingActions 过滤 resolved 行，关了的记录永远
 * 答不成执行。
 */
export function resolvePending(pendingId: string, resolution: string, opts: { actor?: string; now?: Date } = {}): boolean {
  const items = _loadPending()
  for (const item of items) {
    if (item.id !== pendingId) continue
    if (item.consumed_at || item.resolved) return false
    item.resolved = resolution
    item.resolved_at = (opts.now ?? new Date()).toISOString()
    item.actor = opts.actor ?? 'owner'
    _savePending(items)
    return true
  }
  return false
}

/**
 * 已在等这个精确 (type, params) 的活记录，或 null。问询路径发问**之前**查它：
 * 对同一动作重发问句会给 Kevin 摆两条消息，而 enqueuePending 的去重会把第二条
 * 问句指给**第一条**记录的 id —— 回新消息就解析不到任何东西。
 */
export function findLivePending(actionType: string, params: Record<string, unknown>, opts: { now?: Date } = {}): Record<string, unknown> | null {
  const key = paramsKey(params)
  for (const item of pendingActions(opts)) {
    if (item.action_type === actionType && paramsKey(item.params) === key) return item
  }
  return null
}

export function dropPending(pendingId: string | null): void {
  if (pendingId === null || pendingId === undefined) return
  _savePending(_loadPending().filter((item) => item.id !== pendingId))
}

/**
 * 只列活的（可批的）授权：未消费、未 resolved **且**未过期。过期授权是死路 ——
 * consumePending 会拒 —— 列出/计数它只会给所有者看一个批不动的审批。死记录留
 * 在文件里做审计线索，只是不再被呈现为 pending。
 */
export function pendingActions(opts: { now?: Date } = {}): Record<string, unknown>[] {
  const now = opts.now ?? new Date()
  return _loadPending().filter(
    (item) => !item.consumed_at && !item.resolved && !_expired(item, now),
  )
}

export function pendingCount(opts: { now?: Date } = {}): number {
  return pendingActions(opts).length
}

/**
 * 启动卫生（SK-29）：把过期未消费的授权盖成终局 resolved（resolved="expired"
 * + resolved_at），盘上台账说清它们的下场。mark-only —— 永不删除记录，审计
 * 线索完整。pendingActions 已把它们滤掉；这是记账，跨重启幂等。
 */
export function sweepExpired(opts: { now?: Date } = {}): number {
  const now = opts.now ?? new Date()
  const items = _loadPending()
  let swept = 0
  for (const item of items) {
    if (item.consumed_at || item.resolved) continue
    if (_expired(item, now)) {
      item.resolved = 'expired'
      item.resolved_at = now.toISOString()
      swept += 1
    }
  }
  if (swept) _savePending(items)
  if (swept) logEvent('pending_expired_swept', { count: swept })
  return swept
}
