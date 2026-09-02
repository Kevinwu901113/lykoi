/**
 * lykoi-memory/testing — 测试专用的合成 state 夹具（W2 新增 TODO#5 落地，W3 收口）。
 *
 * 此前 lykoi-memory 与 lykoi-snapshot 各持一份逐字相同的 DDL 夹具，靠注释约定
 * "改 DDL 必须两处同改"。W3 把 DDL 收敛到单一来源：各包测试树 import
 * 'lykoi-memory/testing' 取同一份 schema，包内夹具只负责各自的数据播种。
 *
 * AUDIT-FIX-2026-09-02：DDL 与中性基线行的正本移到 `lykoi-memory/schema`
 * （src/schema.ts），本文件只保留夹具专属的部分 —— 固定日期的基线时间戳与
 * 两行身份契约种子，外加逻辑摘要工具。生产创建入口 `init-state.ts` 与本文件
 * 共用 `schema.ts` 那一份 DDL。
 *
 * DDL/索引/触发器逐字取自 WO-M0-STATE-CONTRACT §1（触发器消息是契约的一部分，
 * 不得改字 —— R-06）。**只含 schema 与中性基线行**（mind_schema=17、
 * regulation_field 四行 baseline、integration_state 单行、learning_layer_state
 * 两键），不含她的任何数据。
 *
 * W3 增量（reflow/wake 写面需要）：autonomy_notes（memory/store.py:97-115，
 * append-only 双触发器逐字）、integration_state（migrations.py:99-103）、
 * learning_layer_state（migrations.py:647-651；两键按 C-15 INSERT OR IGNORE
 * 硬幂等语义播种：水位线重放不得抬高）。
 *
 * W4 增量（学习环 L1..L5 写面需要，DDL 逐字取自 STATE-CONTRACT §1）：
 * users/contexts（migrations.py:471-495，memory_scopes 的 FK 目标；users 带
 * owner_primary 部分唯一索引；两行契约种子 = 回填保守默认 user_001 与
 * ctx_direct_user_001，属中性基线不属她的数据）、memory_scopes（:502-512）、
 * experience_class（:589-594 + 双索引）、focus_cycles（:755-767 + 索引）、
 * product_lineage（:779-788 五元组 UNIQUE=C-17）、focus_insight_state（:803-812）、
 * focus_insight_history（:818-827）、concern_focus_state（:836-844）、
 * rule_suggestions（:922-945 + dedup_key UNIQUE=C-14 + 双索引）。
 *
 * W5 增量（身份与对话收口需要，DDL 逐字取自 migrations.py:481-489）：
 * identity_bindings（UNIQUE(channel, channel_key)；users 的 FK 引用方 ——
 * WO-P2-S1B 把首次绑定定义成一次刻意的人工登记动作，这张表就是"她长着哪些
 * 通道"的事实源）。不播种任何绑定行：绑定属她的数据，不属中性基线。
 *
 * WO-MEM-SOURCE-01 增量（mind_schema 15 → 16）：experiences 末列 `epistemic`
 * （认识论第二轴，设计稿 §3.1）+ mind_schema 台账多一行 16。夹具描的是**迁移后**
 * 的物理 schema；对应迁移件在
 * `governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql`。
 *
 * WO-MEM-DECAY-01 增量（mind_schema 16 → 17）：focus_insight_state.status 的
 * CHECK 扩到六态（加 `dormant`，设计稿 §3.3 / D-1）+ mind_schema 台账多一行 17。
 * DDL 改点在 `schema.ts` 那一处，夹具随之；对应迁移件在
 * `governance/wo/WO-MEM-DECAY-01/migrations/017_focus_insight_dormant.up.sql`。
 *
 * 生产纪律不变：本文件只被测试树 import；golden devstate 永远只读，写测试先
 * copy 进 os.tmpdir（各包夹具自持这半段）。
 */
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { STATE_SCHEMA_DDL, stateBaselineDdl } from './schema.ts'

export { STATE_SCHEMA_DDL, stateBaselineDdl }

/** C-22 业务行格式（isoformat：+00:00 偏移、微秒零省略、非零六位）。 */
export const PY_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{6})?\+00:00$/

/**
 * 夹具的两行身份契约种子（回填保守默认 user_001 与 ctx_direct_user_001）。
 * 属中性基线不属她的数据。生产创建入口**不**播种它们：那里的所有者行是
 * `--owner-name` 的一次显式登记。
 */
const FIXTURE_IDENTITY_SEED_DDL = `
    INSERT OR IGNORE INTO users (id, display_name, role, created_at, status)
      VALUES ('user_001', 'owner', 'owner_primary', '2026-08-09T00:00:00+00:00', 'active');

    INSERT OR IGNORE INTO contexts (id, kind, title, created_at)
      VALUES ('ctx_direct_user_001', 'direct', NULL, '2026-08-09T00:00:00+00:00');
`

/**
 * 合成 fixture 的完整 schema + 中性基线行。
 * schema 取自 `lykoi-memory/schema`（表序沿 WO-M0-STATE-CONTRACT §1.2 的移植面，
 * 其后接生产 schema 补齐面）；基线行的时间戳是夹具固定日期，不读墙钟。
 */
export const STATE_FIXTURE_DDL = STATE_SCHEMA_DDL + stateBaselineDdl({
  schemaLedger: [
    { version: 15, appliedAt: '2026-08-24T00:00:00.000Z' },
    { version: 16, appliedAt: '2026-09-01T00:00:00.000Z' },
    { version: 17, appliedAt: '2026-09-02T00:00:00.000Z' },
  ],
  regulationUpdatedAt: '2026-08-20T00:00:00+00:00',
  learningSetAt: '2026-08-24T00:00:00+00:00',
}) + FIXTURE_IDENTITY_SEED_DDL

/** 在 path 建一个空白合成 fixture（schema + 中性基线行，零她的数据）。 */
export function createStateFixture(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(STATE_FIXTURE_DDL)
  } finally {
    db.close()
  }
}

/**
 * 逐表逻辑摘要（W4 提炼共享；原样取自 lykoi-wake/test/fixture.ts 的 logicalDigest
 * 手法 = 活体 tests/test_cb_deliberation_zero_write._logical_digest §3.6）：
 * 每表一条 sha256（表名+列名入摘要；行按全列排序）。写集对拍用它断言
 * "恰好这些表变了，其余逐字节未动"；刻意用逻辑摘要而非文件字节——SQLite 的
 * 页布局/journal 会无谓地抖。
 */
export function tableDigests(path: string): Record<string, string> {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const out: Record<string, string> = {}
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as { name: string }[]
    for (const { name } of tables) {
      const hash = createHash('sha256')
      const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[])
        .map((c) => c.name)
      hash.update(`table:${name}(${cols.join(',')})\n`)
      const order = cols.map((c) => `"${c}"`).join(', ')
      const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY ${order}`).all()
      hash.update(JSON.stringify(rows))
      hash.update('\n')
      out[name] = hash.digest('hex')
    }
    return out
  } finally {
    db.close()
  }
}

/** 全库逻辑摘要 = 逐表摘要的定序拼接（与 wake 夹具的 logicalDigest 同语义）。 */
export function logicalDigest(path: string): string {
  const digests = tableDigests(path)
  const hash = createHash('sha256')
  for (const name of Object.keys(digests).sort()) {
    hash.update(`${name}=${digests[name]}\n`)
  }
  return hash.digest('hex')
}

/** 两份摘要的差集：值不同（或仅一侧存在）的表名，排序返回。写集对拍的断言面。 */
export function changedTables(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...names].filter((n) => before[n] !== after[n]).sort()
}
