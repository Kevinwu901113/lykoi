/**
 * lykoi-snapshot 测试夹具。
 *
 * 合成 fixture：DDL/索引/触发器逐字取自 WO-M0-STATE-CONTRACT §1（与
 * lykoi-memory/test/fixture.ts 同源同字；测试树不跨包 import 所以各持一份 ——
 * 改 DDL 必须两处同改）。不含她的任何数据；devstate 相关测试归 lykoi-memory。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import type { RestartEvent, SnapshotDeps } from '../src/index.ts'

export function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'lykoi-snapshot-'))
}

export function makeFixture(): string {
  const path = join(tmp(), 'fixture.db')
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE IF NOT EXISTS mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    INSERT INTO mind_schema VALUES (15, '2026-08-24T00:00:00.000Z');

    CREATE TABLE regulation_field (
      name TEXT PRIMARY KEY CHECK (name IN ('coherence','load','relational_tension','exploration_hunger')),
      value REAL NOT NULL CHECK (value >= 0.0 AND value <= 1.0),
      baseline REAL NOT NULL CHECK (baseline >= 0.0 AND baseline <= 1.0),
      updated_at TEXT NOT NULL
    );
    INSERT INTO regulation_field VALUES
      ('coherence', 0.7, 0.7, '2026-08-20T00:00:00+00:00'),
      ('load', 0.2, 0.2, '2026-08-20T00:00:00+00:00'),
      ('relational_tension', 0.3, 0.3, '2026-08-20T00:00:00+00:00'),
      ('exploration_hunger', 0.0, 0.0, '2026-08-20T00:00:00+00:00');

    CREATE TABLE regulation_events (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
      name TEXT NOT NULL, delta REAL NOT NULL, value_after REAL NOT NULL, cause TEXT NOT NULL
    );
    CREATE INDEX idx_regulation_events_name_ts ON regulation_events(name, ts);
    CREATE TRIGGER IF NOT EXISTS regulation_events_no_update BEFORE UPDATE ON regulation_events
       BEGIN SELECT RAISE(ABORT, 'regulation_events is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS regulation_events_no_delete BEFORE DELETE ON regulation_events
       BEGIN SELECT RAISE(ABORT, 'regulation_events is append-only'); END;

    CREATE TABLE concerns (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('interest','project','question','ritual','relationship_thread')),
      title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      weight REAL NOT NULL CHECK (weight >= 0.0 AND weight <= 1.0),
      origin TEXT NOT NULL CHECK (origin IN ('seed','grown','relationship','floor',
                                             'emergent','owner_directed','derived')),
      parent_id INTEGER REFERENCES concerns(id),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','dimming','dormant','released')),
      created_at TEXT NOT NULL, last_lit_at TEXT, lit_count INTEGER NOT NULL DEFAULT 0,
      released_at TEXT, release_reason TEXT
    );
    CREATE INDEX idx_concerns_status ON concerns(status);

    CREATE TABLE experiences (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('conversation','wake_action','action_result',
              'silence','owner_event','system','thought_lapse','environment')),
      content TEXT NOT NULL,
      salience REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0.0 AND salience <= 1.0),
      related_concern_id INTEGER REFERENCES concerns(id),
      integrated INTEGER NOT NULL DEFAULT 0 CHECK (integrated IN (0,1)),
      integration_id INTEGER
    );
    CREATE INDEX idx_experiences_integrated ON experiences(integrated);
    CREATE TRIGGER IF NOT EXISTS experiences_no_delete BEFORE DELETE ON experiences
       BEGIN SELECT RAISE(ABORT, 'experiences is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS experiences_immutable_columns BEFORE UPDATE ON experiences
       WHEN NEW.id IS NOT OLD.id OR NEW.ts IS NOT OLD.ts OR NEW.source IS NOT OLD.source
            OR NEW.content IS NOT OLD.content OR NEW.salience IS NOT OLD.salience
            OR NEW.related_concern_id IS NOT OLD.related_concern_id
            OR NOT (
                (NEW.integrated IS OLD.integrated AND NEW.integration_id IS OLD.integration_id)
                OR (OLD.integrated = 0 AND NEW.integrated = 1 AND NEW.integration_id IS NOT NULL)
            )
       BEGIN SELECT RAISE(ABORT, 'experiences rows are append-only; integration may only move 0 -> 1 once'); END;

    CREATE TABLE thoughts (
      id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
      content TEXT NOT NULL CHECK (length(content) <= 200),
      kind TEXT NOT NULL CHECK (kind IN ('intent','question','hypothesis','rumination','observation')),
      source TEXT NOT NULL CHECK (source IN ('wake','conversation','integration','contemplate')),
      related_concern_id INTEGER REFERENCES concerns(id), source_ref TEXT,
      charge REAL NOT NULL DEFAULT 0.5 CHECK (charge >= 0.0 AND charge <= 1.0),
      status TEXT NOT NULL DEFAULT 'open'
          CHECK (status IN ('open','resolved','abandoned','absorbed','archived')),
      resolved_by_integration_id INTEGER
    );
    CREATE INDEX idx_thoughts_status ON thoughts(status);
    CREATE TRIGGER IF NOT EXISTS thoughts_no_delete BEFORE DELETE ON thoughts
       BEGIN SELECT RAISE(ABORT, 'thoughts is append-only (never delete)'); END;
    CREATE TRIGGER IF NOT EXISTS thoughts_immutable_columns BEFORE UPDATE ON thoughts
       WHEN NEW.id IS NOT OLD.id OR NEW.ts IS NOT OLD.ts OR NEW.content IS NOT OLD.content
            OR NEW.kind IS NOT OLD.kind OR NEW.source IS NOT OLD.source
            OR NEW.source_ref IS NOT OLD.source_ref
       BEGIN SELECT RAISE(ABORT, 'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)'); END;
    CREATE TRIGGER IF NOT EXISTS thoughts_status_flow BEFORE UPDATE ON thoughts
       WHEN OLD.status IS NOT NEW.status
            AND NOT (
                (OLD.status = 'open'      AND NEW.status IN ('resolved','abandoned')) OR
                (OLD.status = 'resolved'  AND NEW.status IN ('absorbed','archived')) OR
                (OLD.status = 'abandoned' AND NEW.status = 'archived')
            )
       BEGIN SELECT RAISE(ABORT, 'thoughts: forbidden status transition (append-only one-way flow)'); END;
    CREATE TRIGGER IF NOT EXISTS thoughts_related_concern_oneway BEFORE UPDATE ON thoughts
       WHEN OLD.related_concern_id IS NOT NULL AND OLD.related_concern_id IS NOT NEW.related_concern_id
       BEGIN SELECT RAISE(ABORT, 'thoughts: related_concern_id is one-way (NULL->value, append-only)'); END;
    CREATE TRIGGER IF NOT EXISTS thoughts_resolved_by_integration_oneway BEFORE UPDATE ON thoughts
       WHEN OLD.resolved_by_integration_id IS NOT NULL
            AND OLD.resolved_by_integration_id IS NOT NEW.resolved_by_integration_id
       BEGIN SELECT RAISE(ABORT, 'thoughts: resolved_by_integration_id is one-way (NULL->value, append-only)'); END;
    CREATE TRIGGER IF NOT EXISTS thoughts_terminal_integration BEFORE UPDATE ON thoughts
       WHEN (NEW.status = 'absorbed'  AND NEW.resolved_by_integration_id IS NULL)
         OR (NEW.status = 'abandoned' AND NEW.resolved_by_integration_id IS NOT NULL)
       BEGIN SELECT RAISE(ABORT, 'thoughts: absorbed requires resolved_by_integration_id; abandoned must not carry one'); END;

    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
      event_type TEXT NOT NULL, content TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON history
       BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON history
       BEGIN SELECT RAISE(ABORT, 'history is append-only'); END;

    CREATE TABLE narrative_versions (
      id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, content TEXT NOT NULL,
      change_summary TEXT NOT NULL,
      trigger TEXT NOT NULL CHECK (trigger IN ('integration','owner_edit')),
      narrative_class TEXT CHECK (narrative_class IN
          ('absorption','reflection','narrative_only','legacy','owner_edit'))
    );
    CREATE TRIGGER IF NOT EXISTS narrative_versions_no_update BEFORE UPDATE ON narrative_versions
       BEGIN SELECT RAISE(ABORT, 'narrative_versions is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS narrative_versions_no_delete BEFORE DELETE ON narrative_versions
       BEGIN SELECT RAISE(ABORT, 'narrative_versions is append-only'); END;

    CREATE TABLE narrative_threads (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('open_question','commitment','suspended_tension','arc')),
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','resolved','absorbed')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolution TEXT
    );

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, updated TEXT NOT NULL,
      category TEXT NOT NULL, content TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS autonomy_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), next_wake_at TEXT NOT NULL,
      last_wake_at TEXT, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS autonomy_runs (
      id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
      status TEXT NOT NULL,
      decision TEXT,
      next_wake_at TEXT,
      action_count INTEGER DEFAULT 0, external_read_count INTEGER DEFAULT 0,
      notification_count INTEGER DEFAULT 0
    );
  `)
  db.close()
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
