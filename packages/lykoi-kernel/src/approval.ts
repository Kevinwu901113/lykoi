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

export const DELEGATED_ALLOWED: ReadonlySet<string> = new Set([])

export const DELEGATION_READONLY: ReadonlySet<string> = new Set([
  'delegation.status',
  'delegation.collect',
])

function _capability(origin: string, actionType: string): 'allow' | 'deny' | null {
  if (origin === 'scheduler') {
    return SCHEDULER_ALLOWED.has(actionType) ? 'allow' : 'deny'
  }
  if (origin === 'delegated') {
    return DELEGATED_ALLOWED.has(actionType) ? 'allow' : 'deny'
  }
  if (origin !== 'autonomous') return null
  if (_policyCore === null) return 'deny'
  return _policyCore.capabilityProfile(origin, actionType)
}

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

export const SCOPE_SEPARATOR = '@'

// 授权的出处/条件住在规则文件**旁边**，不在里面（规则 schema 只收字符串且被
// root 校验）。sidecar 是元数据，永远不是权威：这里有条目而规则无行 = 什么都
// 不授权；规则有行而 sidecar 无条目 = 仍是有效授权，只是没记条件。失败方向
// 永远朝更少的触达。
export function standingPath(): string {
  return process.env.LYKOI_STANDING_GRANTS ?? 'var/state/standing_grants.json'
}

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
  if (origin === 'autonomous') {
    return cap === 'allow' || _matches(actionType, rules.always_allow) || _scopedAllowed(actionType, params, rules.always_allow) ? 'allow' : 'deny'
  }
  if (cap === 'allow') return 'allow' // ④ autonomous, allow-listed, not tightened
  if (hard === 'ask') return 'ask' // ⑤ interactive hard floor (e.g. terminal.exec) preserved
  if (_matches(actionType, rules.always_allow)) return 'allow'

  // An interactive stop reduces existing work. Resume still requires ordinary authorization.
  if (origin === 'interactive' && actionType === 'task.control' && (params?.command === 'pause' || params?.command === 'cancel')) return 'allow'
  if (DELEGATION_READONLY.has(actionType)) return 'allow'
  if (_scopedAllowed(actionType, params, rules.always_allow)) return 'allow'

  if (covers(actionType, params ?? {}, exemption)) return 'allow'
  return 'ask' // ⑩
}

// --- standing-grant lifecycle ------------------------------------------------

interface StandingDocument {
  grants: Record<string, unknown>[]
  denials: Record<string, unknown>[]
}

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
  return (now ?? new Date()).toISOString()
}

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
  return JSON.parse(readFileSync(pendingPath(), 'utf8')) as Record<string, unknown>[]
}

function _savePending(items: Record<string, unknown>[]): void {
  writeJsonAtomic(pendingPath(), items)
}

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
  const key = paramsKey(params), now = opts.now ?? new Date()
  for (const item of items) {
    if (!item.consumed_at && !item.resolved && !_expired(item, now) && item.action_type === actionType && paramsKey(item.params) === key) {
      return String(item.id) // already queued (same action+params) -> same grant
    }
  }
  const pendingId = opts.actionId ?? _randomHex32()
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

export function findPendingByQuestion(questionMessageId: string | number | null): Record<string, unknown> | null {
  if (questionMessageId === null || questionMessageId === undefined) return null
  const target = String(questionMessageId)
  for (const item of _loadPending()) {
    if (String(item.question_message_id) === target) return item
  }
  return null
}

export function pendingState(item: Record<string, unknown>, opts: { now?: Date } = {}): string {
  if (item.consumed_at) return 'consumed'
  if (item.resolved) return 'resolved'
  if (_expired(item, opts.now ?? new Date())) return 'expired'
  return 'live'
}

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
