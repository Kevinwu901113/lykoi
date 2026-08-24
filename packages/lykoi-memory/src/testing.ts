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
 * 生产纪律不变：本文件只被测试树 import；golden devstate 永远只读，写测试先
 * copy 进 os.tmpdir（各包夹具自持这半段）。
 */
import { createHash } from 'node:crypto'
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

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner_primary','group_member','agent')),
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner_primary_unique ON users(role) WHERE role = 'owner_primary';
    INSERT OR IGNORE INTO users (id, display_name, role, created_at, status)
      VALUES ('user_001', 'owner', 'owner_primary', '2026-08-09T00:00:00+00:00', 'active');

    CREATE TABLE IF NOT EXISTS contexts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','group','system')),
      title TEXT, created_at TEXT NOT NULL
    );
    INSERT OR IGNORE INTO contexts (id, kind, title, created_at)
      VALUES ('ctx_direct_user_001', 'direct', NULL, '2026-08-09T00:00:00+00:00');

    CREATE TABLE IF NOT EXISTS identity_bindings (
        id          INTEGER PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id),
        channel     TEXT NOT NULL,
        channel_key TEXT NOT NULL,
        verified_by TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        UNIQUE(channel, channel_key)
    );

    CREATE TABLE IF NOT EXISTS memory_scopes (
      table_name TEXT NOT NULL, row_id INTEGER NOT NULL,
      subject_user_id TEXT REFERENCES users(id), origin_context TEXT REFERENCES contexts(id),
      visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public','context')),
      sensitivity TEXT NOT NULL DEFAULT 'content' CHECK(sensitivity IN ('content','state','existence')),
      PRIMARY KEY(table_name, row_id)
    );

    CREATE TABLE IF NOT EXISTS experience_class (
      experience_id INTEGER PRIMARY KEY REFERENCES experiences(id),
      class TEXT NOT NULL CHECK(class IN ('working','archive')),
      classified_at TEXT NOT NULL, rule_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_experience_class_class ON experience_class(class);
    CREATE INDEX IF NOT EXISTS idx_experience_class_rule_version ON experience_class(rule_version);

    CREATE TABLE IF NOT EXISTS focus_cycles (
      id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
      concern_id INTEGER REFERENCES concerns(id),
      selection_reason TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'idle'
              CHECK (outcome IN ('idle','advanced','revised','no_progress','failed')),
      retrieved_count INTEGER NOT NULL DEFAULT 0,
      match_reasons TEXT NOT NULL DEFAULT '[]',
      llm_calls INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_focus_cycles_concern ON focus_cycles(concern_id);

    CREATE TABLE IF NOT EXISTS product_lineage (
      id INTEGER PRIMARY KEY, product_kind TEXT NOT NULL, product_id TEXT NOT NULL,
      source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
      cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id), created_at TEXT NOT NULL,
      UNIQUE (product_kind, product_id, source_kind, source_id, cycle_id)
    );
    CREATE INDEX IF NOT EXISTS idx_product_lineage_product ON product_lineage(product_kind, product_id);
    CREATE INDEX IF NOT EXISTS idx_product_lineage_source ON product_lineage(source_kind, source_id);

    CREATE TABLE IF NOT EXISTS focus_insight_state (
      insight_id INTEGER PRIMARY KEY,
      status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn')),
      created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
      updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
      contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_focus_insight_state_status ON focus_insight_state(status);

    CREATE TABLE IF NOT EXISTS focus_insight_history (
      id INTEGER PRIMARY KEY, insight_id INTEGER NOT NULL,
      cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
      from_status TEXT, to_status TEXT NOT NULL,
      content_snapshot TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_focus_insight_history_insight ON focus_insight_history(insight_id);

    CREATE TABLE IF NOT EXISTS concern_focus_state (
      concern_id INTEGER PRIMARY KEY REFERENCES concerns(id),
      no_progress_streak INTEGER NOT NULL DEFAULT 0,
      cooldown_until_cycle INTEGER, cooldown_count INTEGER NOT NULL DEFAULT 0,
      last_cycle_id INTEGER, release_suggested_at_cycle INTEGER, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rule_suggestions (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('concern_release','permission_rule','standing_grant')),
      dedup_key TEXT NOT NULL UNIQUE,
      suggestion_text TEXT NOT NULL, rationale TEXT NOT NULL DEFAULT '',
      source_kind TEXT NOT NULL DEFAULT '', source_id TEXT NOT NULL DEFAULT '',
      created_cycle_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending'
           CHECK (status IN ('pending','asked','accepted','declined','expired','applied_by_owner')),
      question_message_id TEXT, question_text TEXT NOT NULL DEFAULT '',
      asked_at_cycle INTEGER, ask_count INTEGER NOT NULL DEFAULT 0,
      answer_text TEXT NOT NULL DEFAULT '', cooldown_until_cycle INTEGER,
      staged_instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, decided_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_rule_suggestions_status ON rule_suggestions(status);
    CREATE INDEX IF NOT EXISTS idx_rule_suggestions_question ON rule_suggestions(question_message_id);

    CREATE TABLE IF NOT EXISTS delegation_contracts (
      id TEXT PRIMARY KEY, requester TEXT NOT NULL, contract_yaml TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN
          ('draft','dispatched','running','collected','verified','rejected','expired')),
      agent_user_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_delegation_contracts_state ON delegation_contracts(state);

    -- R-18（STATE-CONTRACT）：verdict 的 CHECK 以 migrations.py:1046 现行 DDL 为准
    -- （IS NULL OR IN(...)），不得从冻结稿重新生成 —— 冻结稿的 IN ('accepted',
    -- 'rejected', NULL) 在 SQL 三值逻辑下一个值都拦不住（IN 列表含 NULL 且左值
    -- 不匹配任何非 NULL 项时求值为 NULL 而非 FALSE，CHECK 只在 FALSE 时失败）。
    CREATE TABLE IF NOT EXISTS execution_receipts (
      id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES delegation_contracts(id),
      evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
      verdict TEXT CHECK(verdict IS NULL OR verdict IN ('accepted','rejected')),
      verified_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_execution_receipts_contract ON execution_receipts(contract_id);
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
