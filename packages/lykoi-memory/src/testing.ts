import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { STATE_SCHEMA_DDL, stateBaselineDdl } from './schema.ts'

export { STATE_SCHEMA_DDL, stateBaselineDdl }

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

export const STATE_FIXTURE_DDL = STATE_SCHEMA_DDL + stateBaselineDdl({
  schemaLedger: [
    { version: 15, appliedAt: '2026-08-24T00:00:00.000Z' },
    { version: 16, appliedAt: '2026-09-01T00:00:00.000Z' },
    { version: 17, appliedAt: '2026-09-02T00:00:00.000Z' },
    { version: 18, appliedAt: '2026-09-04T00:00:00.000Z' },
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
