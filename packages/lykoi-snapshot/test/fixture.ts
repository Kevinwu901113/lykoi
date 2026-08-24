/**
 * lykoi-snapshot 测试夹具。
 *
 * 合成 fixture：DDL/索引/触发器单一来源在 `lykoi-memory/testing`（W2 TODO#5
 * 收口：此前与 lykoi-memory/test/fixture.ts 各持一份逐字 DDL，"两处同改"约定
 * 升级为单一出处）。不含她的任何数据；devstate 相关测试归 lykoi-memory。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { createStateFixture } from 'lykoi-memory/testing'
import type { RestartEvent, SnapshotDeps } from '../src/index.ts'

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-snapshot-'))
}

export function makeFixture(): string {
  const path = join(tmp(), 'fixture.db')
  createStateFixture(path)
  return path
}

/** 裸连接（种数据/断言用）。 */
export function rawOpen(path: string): DatabaseSync {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA busy_timeout = 10000')
  return db
}

/**
 * 全库逻辑摘要（学 test_cb_deliberation_zero_write 的手法，SA-47/48）：
 * 逐表 SELECT * ORDER BY rowid 后哈希。read() 前后必须相等（零写），
 * 且必须配对照组（一次真实写后必须变 —— 否则断言可能假性通过）。
 */
export function dbDigest(path: string): string {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const hash = createHash('sha256')
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all() as { name: string }[]
    for (const { name } of tables) {
      hash.update(`== ${name} ==`)
      const rows = db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()
      hash.update(JSON.stringify(rows))
    }
    return hash.digest('hex')
  } finally {
    db.close()
  }
}

/** 缺省 deps：外部读数取安静值；restart 恒 null（W2 接口位契约）。 */
export function stubDeps(overrides: Partial<SnapshotDeps> = {}): SnapshotDeps & {
  events: [string, Record<string, unknown>][]
} {
  const events: [string, Record<string, unknown>][] = []
  return {
    approvalPendingCount: () => 0,
    notificationsRemainingToday: () => 2,
    proactiveRemainingToday: () => 1,
    unprocessedRestartEvent: (): RestartEvent | null => null,
    logEvent: (name: string, fields: Record<string, unknown>) => {
      events.push([name, fields])
    },
    ...overrides,
    events,
  }
}
