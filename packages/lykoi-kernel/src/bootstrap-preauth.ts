#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  bootstrapOwnerPreauthorization, isHardGated, OWNER_PREAUTHORIZED_ACTIONS,
  rulesPath, scopedEntry, standingPath, validateRules,
} from './approval.ts'
import { logEvent, setKernelLogEvent } from './telemetry.ts'

export const OWNER_PRIMARY_SQL
  = "SELECT id FROM users WHERE role = 'owner_primary' AND status = 'active' LIMIT 1"

/** 只读打开 state 库取 owner id；没有那一行 → null（没有可信任的所有者）。 */
export function ownerPrimaryUserId(stateDb: string): string | null {
  const db = new DatabaseSync(stateDb, { readOnly: true })
  try {
    const row = db.prepare(OWNER_PRIMARY_SQL).get() as { id?: unknown } | undefined
    const id = row?.id
    return typeof id === 'string' && id !== '' ? id : null
  } finally {
    db.close()
  }
}

// --- 规则文件体检（「确认」路径的可执行形态）----------------------------------

export interface RulesPreflight {
  path: string
  exists: boolean

  problems: string[]
  alwaysAllow: string[]
  /** 文件字节的 sha256（不存在 → null）。幂等由它逐字节判。 */
  sha256: string | null
}

export function preflightRules(path: string = rulesPath()): RulesPreflight {
  if (!existsSync(path)) {
    return { path, exists: false, problems: [], alwaysAllow: [], sha256: null }
  }
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (exc) {
    const reason = exc instanceof Error ? exc.message : String(exc)
    return { path, exists: true, problems: [`unreadable: ${reason}`], alwaysAllow: [], sha256: null }
  }
  const sha256 = createHash('sha256').update(raw, 'utf8').digest('hex')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (exc) {
    const reason = exc instanceof Error ? exc.message : String(exc)
    return { path, exists: true, problems: [`not valid JSON: ${reason}`], alwaysAllow: [], sha256 }
  }
  const problems = validateRules(parsed)
  const allow = (parsed as { always_allow?: unknown }).always_allow
  const alwaysAllow = Array.isArray(allow) ? allow.filter((x): x is string => typeof x === 'string') : []
  return { path, exists: true, problems, alwaysAllow, sha256 }
}

// --- 一次性安装 ---------------------------------------------------------------

export interface PreauthReport {
  rules_path: string
  standing_path: string
  state_db: string
  dry_run: boolean
  owner_user_id: string | null
  /** 跑完应当在册的授权行（硬门动作不在其中 —— 它们永不可携带常设授权）。 */
  expected: string[]
  granted: string[]
  already: string[]
  /** 跑完仍不在册的 —— 验收断言：**必须为空**。 */
  missing: string[]
  sha_before: string | null
  sha_after: string | null
  /** 规则文件字节是否变了。重放（确认）时必须 false。 */
  changed: boolean
  problems: string[]
}

/**
 * 体检 → 取 owner → 装预授权 → 复查在册。全程只碰 `rulesPath()` /
 * `standingPath()` 当前解析到的那两个文件（CLI 已经把 `--rules/--standing`
 * 放进对应 env）。
 */
export function runOwnerPreauth(opts: { stateDb: string; dryRun?: boolean; now?: Date }): PreauthReport {
  const dryRun = opts.dryRun === true
  const before = preflightRules()
  const report: PreauthReport = {
    rules_path: before.path,
    standing_path: standingPath(),
    state_db: opts.stateDb,
    dry_run: dryRun,
    owner_user_id: null,
    expected: [],
    granted: [],
    already: [],
    missing: [],
    sha_before: before.sha256,
    sha_after: before.sha256,
    changed: false,
    problems: [...before.problems],
  }
  if (!existsSync(opts.stateDb)) {
    report.problems.push(`state db not found: ${opts.stateDb}`)
  }
  // 体检不过 = 一个字节都不写（见顶注「失败方向」）。
  if (report.problems.length > 0) return report

  const owner = ownerPrimaryUserId(opts.stateDb)
  report.owner_user_id = owner
  if (owner === null) return report // 没有所有者就没有可授的对象；调用方按 exit 3 处理

  report.expected = OWNER_PREAUTHORIZED_ACTIONS
    .filter((actionType) => !isHardGated(actionType))
    .map((actionType) => scopedEntry(actionType, `user:${owner}`))

  if (dryRun) {
    report.already = report.expected.filter((entry) => before.alwaysAllow.includes(entry))
    report.granted = [] // dry-run 从不授权
    report.missing = report.expected.filter((entry) => !before.alwaysAllow.includes(entry))
    return report
  }

  const outcome = bootstrapOwnerPreauthorization(null, {
    ownerLookup: () => owner,
    ...(opts.now === undefined ? {} : { now: opts.now }),
  })
  report.granted = outcome.granted
  report.already = outcome.already

  const after = preflightRules()
  report.sha_after = after.sha256
  report.changed = before.sha256 !== after.sha256
  report.problems.push(...after.problems.map((p) => `post-write: ${p}`))
  report.missing = report.expected.filter((entry) => !after.alwaysAllow.includes(entry))
  logEvent('owner_preauth_entry_finished', {
    owner,
    granted: report.granted.length,
    already: report.already.length,
    missing: report.missing.length,
    changed: report.changed,
  })
  return report
}

// --- CLI ---------------------------------------------------------------------

export const USAGE = `用法：
  node packages/lykoi-kernel/src/bootstrap-preauth.ts --state-db <memory.db> \\
       [--rules <approval_rules.json>] [--standing <standing_grants.json>] [--dry-run]

GK-9 部署期一次性入口：给 owner_primary 装上 §2b 初始预授权（解 S1B 死锁）。
幂等 —— 授权行已在册时走 already 路径，规则文件一个字节都不重写。

退出码：0 在册（本次授予或早已在册） / 1 用法错 / 2 规则文件或 state 库体检不过
        3 无 owner_primary 行（什么都没授，S1B 仍在） / 4 跑完仍不在册（不该发生）`

function optionValue(argv: readonly string[], name: string): string | null | undefined {
  const idx = argv.indexOf(name)
  if (idx === -1) return undefined
  const value = argv[idx + 1]
  if (value === undefined || value.startsWith('--')) return null // 给了旗标没给值
  return value
}

export function main(argv: readonly string[], out: {
  log: (line: string) => void
  err: (line: string) => void
} = { log: (l) => console.log(l), err: (l) => console.error(l) }): number {
  if (argv.includes('--help') || argv.includes('-h')) {
    out.log(USAGE)
    return 0
  }
  const stateDb = optionValue(argv, '--state-db')
  if (stateDb === undefined || stateDb === null) {
    out.err('preauth: --state-db <path> 是必需的（owner_primary 行从这里读）')
    out.err(USAGE)
    return 1
  }
  for (const [flag, envName] of [
    ['--rules', 'LYKOI_APPROVAL_RULES'],
    ['--standing', 'LYKOI_STANDING_GRANTS'],
  ] as const) {
    const value = optionValue(argv, flag)
    if (value === null) {
      out.err(`preauth: ${flag} 需要一个路径`)
      return 1
    }
    if (value !== undefined) process.env[envName] = value
  }
  const dryRun = argv.includes('--dry-run')

  // 部署期的这一跑没有 audit 插件在场（服务还没起）。把 kernel 遥测接到 stdout
  // ——`owner_preauth_installed` 那条落进 journald，切换窗的取证有据可查。
  setKernelLogEvent((name, fields) => out.log(`preauth: event ${name} ${JSON.stringify(fields)}`))
  let report: PreauthReport
  try {
    report = runOwnerPreauth({ stateDb, dryRun })
  } finally {
    setKernelLogEvent(null)
  }

  out.log(`preauth: rules    = ${report.rules_path}`)
  out.log(`preauth: standing = ${report.standing_path}`)
  out.log(`preauth: state db = ${report.state_db}${report.dry_run ? '  (--dry-run：不写)' : ''}`)
  if (report.problems.length > 0) {
    for (const problem of report.problems) out.err(`preauth: FAIL: ${problem}`)
    out.err('preauth: 规则文件体检不过 —— 一个字节都没写。')
    return 2
  }
  if (report.owner_user_id === null) {
    out.err('preauth: FAIL: state 库里没有 active 的 owner_primary 行 —— 什么都没授权。')
    out.err('preauth: S1B 死锁仍然成立：先把所有者身份行装好，再跑本入口。')
    return 3
  }
  out.log(`preauth: owner    = ${report.owner_user_id}`)
  if (report.dry_run) {
    // 体检模式：报现状，不判分。missing 在这里读作「真跑会授予的行」。
    out.log(`preauth: already  = ${JSON.stringify(report.already)}`)
    out.log(`preauth: 待授予  = ${JSON.stringify(report.missing)}`)
    out.log(`preauth: OK —— 规则文件与新体读者格式兼容；${
      report.missing.length === 0 ? '授权已在册，真跑将是纯确认。' : '去掉 --dry-run 即可安装。'}`)
    return 0
  }
  out.log(`preauth: granted  = ${JSON.stringify(report.granted)}`)
  out.log(`preauth: already  = ${JSON.stringify(report.already)}`)
  if (report.missing.length > 0) {
    for (const entry of report.missing) out.err(`preauth: FAIL: 授权行不在册: ${entry}`)
    return 4
  }
  out.log(`preauth: 规则文件字节${report.changed ? '已变更（本次授予）' : '未变更（幂等重放/确认）'}`)
  out.log('preauth: OK —— messenger.send 对所有者的授权在册，S1B 死锁不成立。')
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
