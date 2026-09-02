/**
 * lykoi-memory/init-state — state 库的生产创建入口（`docs/deploy.md` §13 缺口 1/2/3）。
 *
 * 在此之前 schema 的唯一一份 DDL 住在测试夹具里，全新部署没有造库的办法：
 * 参考部署的 `memory.db` 是从上一具躯体（Python 活体）原样接管的。本入口把
 * `lykoi-memory/schema` 的同一份 DDL 用在生产上，一次建到 mind_schema 16，
 * 并可选地登记所有者行与一条 Telegram 身份绑定。
 *
 * 边界：
 * - **只造新库，绝不改既有库**。目标路径已存在即拒绝退出（不覆盖、不迁移）。
 *   把 15 库升到 16 是另一件事，走
 *   `governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql`。
 * - **零 env 读取**（GK-6：部署事实住在 `profile/`，不新增环境变量旋钮）。
 * - 依赖面只有 Node 24 内建 `node:sqlite` / `node:fs` 与本包自身。
 * - 输出只有摘要：路径、schema 版本、落了哪些行的 id。不回显 channel_key 之类
 *   的寻址标识，也不读任何既有行的内容。
 * - 时间戳经 `--now` 注入；缺省才读墙钟（realtime-allow：这是部署期的一次性
 *   人工动作，不是被测路径）。
 */
import { existsSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { STATE_SCHEMA_DDL, stateBaselineDdl } from './schema.ts'
import { EXPECTED_MIND_SCHEMA_VERSION, ReadOnlyMemory } from './index.ts'
import { formatPyIso } from './rw.ts'

/**
 * 契约种子的固定 id。所有者行的 id 与直连上下文的 id 是**成对**的
 * （`ctx_direct_<user_id>`），沿用移植面里那一对，不做可配置项 —— 库里的
 * "the owner" 是一行，不是一个可以起名字的对象。
 */
export const OWNER_USER_ID = 'user_001'
export const OWNER_CONTEXT_ID = 'ctx_direct_user_001'
/** 首次绑定是所有者在控制台上的一次显式登记（与既有绑定行同口径）。 */
export const BINDING_VERIFIED_BY = 'owner_console'

export interface InitStateOptions {
  /** 目标库路径。已存在即拒绝。 */
  db: string
  /** 落一行 users(role=owner_primary, status=active) 的显示名；缺省即不落身份行。 */
  ownerName?: string | undefined
  /** 为该所有者登记一条 identity_bindings(channel='telegram')；需要 ownerName。 */
  telegramSenderId?: string | undefined
  /** 全部时间戳的注入位。 */
  now: Date
  /** 只打印将做的事，一个字节都不写。 */
  dryRun?: boolean | undefined
}

export interface InitStateReport {
  db: string
  dryRun: boolean
  mindSchemaVersion: number
  /** 迁移台账口径（毫秒 + Z，migrations.py:1148）。 */
  ledgerTs: string
  /** 业务行口径（isoformat，C-22）。 */
  rowTs: string
  /** 落下的 users 行 id；没落就是 null。 */
  ownerUserId: string | null
  /** 落下的 contexts 行 id；没落就是 null。 */
  ownerContextId: string | null
  /** 落下的 identity_bindings 行 id（自增主键）；没落就是 null。 */
  bindingId: number | null
  /** 绑定的通道名；channel_key 刻意不进报告。 */
  bindingChannel: string | null
}

/**
 * 建库。调用方保证 `opts.db` 不存在（`main` 先检查；库函数再检查一次）。
 *
 * 全部写在一个事务里：中途炸就整段回滚，再把半成品文件删掉 —— 不留一个
 * "建了一半"的 memory.db 让下一步的完整性门去猜。
 */
export function initState(opts: InitStateOptions): InitStateReport {
  const dryRun = opts.dryRun === true
  if (!(opts.now instanceof Date) || Number.isNaN(opts.now.getTime())) {
    throw new TypeError('lykoi-memory/init-state: now 必须是有效 Date')
  }
  if (opts.telegramSenderId !== undefined && opts.ownerName === undefined) {
    throw new TypeError(
      'lykoi-memory/init-state: --telegram-sender-id 需要 --owner-name'
      + '（绑定挂在所有者行上，没有所有者就没有可绑的对象）',
    )
  }
  if (existsSync(opts.db)) {
    throw new Error(`lykoi-memory/init-state: 目标已存在，拒绝覆盖：${opts.db}`)
  }

  const ledgerTs = opts.now.toISOString()
  const rowTs = formatPyIso(opts.now)
  const report: InitStateReport = {
    db: opts.db,
    dryRun,
    mindSchemaVersion: EXPECTED_MIND_SCHEMA_VERSION,
    ledgerTs,
    rowTs,
    ownerUserId: opts.ownerName === undefined ? null : OWNER_USER_ID,
    ownerContextId: opts.ownerName === undefined ? null : OWNER_CONTEXT_ID,
    bindingId: null,
    bindingChannel: opts.telegramSenderId === undefined ? null : 'telegram',
  }
  if (dryRun) return report

  const db = new DatabaseSync(opts.db)
  try {
    db.exec('PRAGMA busy_timeout = 10000')
    db.exec('BEGIN IMMEDIATE')
    db.exec(STATE_SCHEMA_DDL)
    db.exec(stateBaselineDdl({
      // 全新库一次成型：台账只记它实际所在的那一级。开库门读的是
      // MAX(version)（STATE-CONTRACT §1.0），1..15 那些迁移本库从未施加过，
      // 不给它们编造施加时刻。
      schemaLedger: [{ version: EXPECTED_MIND_SCHEMA_VERSION, appliedAt: ledgerTs }],
      regulationUpdatedAt: rowTs,
      learningSetAt: rowTs,
    }))
    if (opts.ownerName !== undefined) {
      db.prepare(
        'INSERT INTO users (id, display_name, role, created_at, status) '
        + "VALUES (?, ?, 'owner_primary', ?, 'active')",
      ).run(OWNER_USER_ID, opts.ownerName, rowTs)
      db.prepare(
        "INSERT INTO contexts (id, kind, title, created_at) VALUES (?, 'direct', NULL, ?)",
      ).run(OWNER_CONTEXT_ID, rowTs)
    }
    if (opts.telegramSenderId !== undefined) {
      db.prepare(
        'INSERT INTO identity_bindings (user_id, channel, channel_key, verified_by, created_at) '
        + "VALUES (?, 'telegram', ?, ?, ?)",
      ).run(OWNER_USER_ID, opts.telegramSenderId, BINDING_VERIFIED_BY, rowTs)
      const row = db.prepare(
        "SELECT id FROM identity_bindings WHERE channel = 'telegram' AND channel_key = ?",
      ).get(opts.telegramSenderId) as { id: number }
      report.bindingId = Number(row.id)
    }
    db.exec('COMMIT')
  } catch (err) {
    try { db.exec('ROLLBACK') } catch { /* 事务已不在，无事可回 */ }
    db.close()
    // 半成品不留在磁盘上：下一步是完整性门与开库，一个建了一半的 memory.db
    // 比没有库坏得多。
    rmSync(opts.db, { force: true })
    rmSync(`${opts.db}-journal`, { force: true })
    throw err
  }
  db.close()
  return report
}

// --- CLI ---------------------------------------------------------------------

export const USAGE = `用法：
  node packages/lykoi-memory/src/init-state.ts --db <memory.db> \\
       [--owner-name <显示名>] [--telegram-sender-id <id>] \\
       [--now <ISO8601>] [--dry-run]

全新部署的 state 库创建入口：按 lykoi-memory/schema 的 DDL 一次建到
mind_schema ${EXPECTED_MIND_SCHEMA_VERSION}（表 / 索引 / append-only 触发器全落），
再按需登记所有者行与一条 Telegram 身份绑定。

--owner-name          落一行 users(id=${OWNER_USER_ID}, role=owner_primary,
                      status=active) 与配对的 contexts(${OWNER_CONTEXT_ID})。
                      bootstrap-preauth 读的就是这一行。
--telegram-sender-id  为该所有者登记 identity_bindings(channel='telegram')。
                      需要 --owner-name。入站消息靠它反查用户，查不到就丢。
--now                 全部时间戳的注入位；缺省读墙钟。
--dry-run             只打印将做的事，一个字节都不写。

不覆盖既有库：目标路径已存在即退出 2。把接管来的 15 库升到 16 是另一件事，
走 governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql。

退出码：0 建成（或 --dry-run 体检过） / 1 用法错 / 2 目标已存在
        3 建库过程失败（已回滚，磁盘上不留半成品） / 4 建成后自检不过（不该发生）`

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
  const db = optionValue(argv, '--db')
  if (db === undefined || db === null) {
    out.err('init-state: --db <path> 是必需的')
    out.err(USAGE)
    return 1
  }
  const ownerName = optionValue(argv, '--owner-name')
  if (ownerName === null) {
    out.err('init-state: --owner-name 需要一个显示名')
    return 1
  }
  const telegramSenderId = optionValue(argv, '--telegram-sender-id')
  if (telegramSenderId === null) {
    out.err('init-state: --telegram-sender-id 需要一个值')
    return 1
  }
  if (telegramSenderId !== undefined && ownerName === undefined) {
    out.err('init-state: --telegram-sender-id 需要 --owner-name —— 绑定挂在所有者行上。')
    return 1
  }
  const nowText = optionValue(argv, '--now')
  if (nowText === null) {
    out.err('init-state: --now 需要一个 ISO8601 时刻')
    return 1
  }
  // realtime-allow：部署期的一次性人工动作，没给 --now 就读墙钟。
  const now = nowText === undefined ? new Date() : new Date(nowText)
  if (Number.isNaN(now.getTime())) {
    out.err(`init-state: --now 不是有效时刻：${nowText}`)
    return 1
  }
  const dryRun = argv.includes('--dry-run')

  if (existsSync(db)) {
    out.err(`init-state: FAIL: 目标已存在，拒绝覆盖：${db}`)
    out.err('init-state: 本入口只造新库。既有库的版本升级走 016 迁移件。')
    return 2
  }

  let report: InitStateReport
  try {
    report = initState({ db, ownerName, telegramSenderId, now, dryRun })
  } catch (err) {
    out.err(`init-state: FAIL: ${(err as Error).message}`)
    return 3
  }

  out.log(`init-state: db           = ${report.db}${report.dryRun ? '  (--dry-run：不写)' : ''}`)
  out.log(`init-state: mind_schema  = ${report.mindSchemaVersion}`)
  out.log(`init-state: 台账时刻     = ${report.ledgerTs}`)
  out.log(`init-state: 业务行时刻   = ${report.rowTs}`)
  out.log(`init-state: owner        = ${report.ownerUserId ?? '（未登记：没给 --owner-name）'}`)
  out.log(`init-state: context      = ${report.ownerContextId ?? '（未登记）'}`)
  out.log(`init-state: binding      = ${
    report.bindingChannel === null
      ? '（未登记：没给 --telegram-sender-id）'
      : `${report.bindingChannel} #${String(report.bindingId ?? '待写')}`}`)
  if (report.dryRun) {
    out.log('init-state: OK —— 以上是真跑会做的事；去掉 --dry-run 即建库。')
    return 0
  }

  // 自检：用只读入口把新库开一次 —— 开库门（MAX(version) 必须恰等于期望值）
  // 过不了的库不算建成。
  try {
    const memory = new ReadOnlyMemory(report.db)
    memory.close()
  } catch (err) {
    out.err(`init-state: FAIL: 新库过不了只读入口的开库门：${(err as Error).message}`)
    return 4
  }
  out.log('init-state: OK —— 新库已建成，只读入口开库门通过。')
  if (report.ownerUserId === null) {
    out.log('init-state: 提醒：没有 owner_primary 行，bootstrap-preauth 会 exit 3。')
  }
  return 0
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main(process.argv.slice(2)))
}
