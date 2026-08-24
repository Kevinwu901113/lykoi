/**
 * lykoi-memory/testing — 测试专用的合成 state 夹具（W2 新增 TODO#5 落地，W3 收口）。
 *
 * 此前 lykoi-memory 与 lykoi-snapshot 各持一份逐字相同的 DDL 夹具，靠注释约定
 * "改 DDL 必须两处同改"。W3 把 DDL 收敛到本文件单一来源：各包测试树 import
 * 'lykoi-memory/testing' 取同一份 schema，包内夹具只负责各自的数据播种。
 *
 * DDL/索引/触发器逐字取自 WO-M0-STATE-CONTRACT §1（触发器消息是契约的一部分，
 * 不得改字 —— R-06）。**只含 schema 与中性基线行**（mind_schema=15、
 * regulation_field 四行 baseline、integration_state 单行、learning_layer_state
 * 两键），不含她的任何数据。
 *
 * W3 增量（reflow/wake 写面需要）：autonomy_notes（memory/store.py:97-115，
 * append-only 双触发器逐字）、integration_state（migrations.py:99-103）、
 * learning_layer_state（migrations.py:647-651；两键按 C-15 INSERT OR IGNORE
 * 硬幂等语义播种：水位线重放不得抬高）。
 *
 * 生产纪律不变：本文件只被测试树 import；golden devstate 永远只读，写测试先
 * copy 进 os.tmpdir（各包夹具自持这半段）。
 */
import { DatabaseSync } from 'node:sqlite'

/** C-22 业务行格式（isoformat：+00:00 偏移、微秒零省略、非零六位）。 */
export const PY_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{6})?\+00:00$/

/**
 * 合成 fixture 的完整 schema + 中性基线行。
 * 表序沿 WO-M0-STATE-CONTRACT §1.2 的移植面（M2 写层触及的表全集）。
 */
export const STATE_FIXTURE_DDL = `
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

    CREATE TABLE IF NOT EXISTS autonomy_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
      autonomy_run_id TEXT NOT NULL, kind TEXT NOT NULL,
      content TEXT NOT NULL, confidence REAL,
      source_type TEXT,
      source_urls_json TEXT
    );
    CREATE TRIGGER IF NOT EXISTS autonomy_notes_no_update BEFORE UPDATE ON autonomy_notes
       BEGIN SELECT RAISE(ABORT, 'autonomy_notes is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS autonomy_notes_no_delete BEFORE DELETE ON autonomy_notes
       BEGIN SELECT RAISE(ABORT, 'autonomy_notes is append-only'); END;

    CREATE TABLE IF NOT EXISTS integration_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_integration_at TEXT, wakes_since INTEGER NOT NULL DEFAULT 0,
      experiences_pending INTEGER NOT NULL DEFAULT 0
    );
    INSERT OR IGNORE INTO integration_state (id) VALUES (1);

    CREATE TABLE IF NOT EXISTS learning_layer_state (
      key TEXT PRIMARY KEY, value INTEGER NOT NULL, set_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO learning_layer_state (key, value, set_at)
      VALUES ('l2_intake_watermark_id', 0, '2026-08-24T00:00:00+00:00');
    INSERT OR IGNORE INTO learning_layer_state (key, value, set_at)
      VALUES ('l4_focus_wakes_since', 0, '2026-08-24T00:00:00+00:00');
`

/** 在 path 建一个空白合成 fixture（schema + 中性基线行，零她的数据）。 */
export function createStateFixture(path: string): void {
  const db = new DatabaseSync(path)
  try {
    db.exec(STATE_FIXTURE_DDL)
  } finally {
    db.close()
  }
}
