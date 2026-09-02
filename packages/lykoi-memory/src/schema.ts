/**
 * lykoi-memory/schema — state 库 schema 的单一出处（DDL + 中性基线行生成器）。
 *
 * 此前这份 DDL 只住在 `testing.ts` 里，文件头写明「只被测试树 import」，
 * 于是全新部署没有造库入口（`docs/deploy.md` §13 缺口 1）。本模块把 DDL 从
 * 测试夹具里提出来，测试树与生产创建入口（`init-state.ts`）共用同一份。
 *
 * 保真度来源：DDL 逐字取自 WO-M0-STATE-CONTRACT §1（触发器消息是契约的一部分，
 * 不得改字 —— R-06）。末尾「生产 schema 补齐面」一节是 AUDIT-FIX-2026-09-02
 * 的对拍结果：拿 schema 15 的真实 state 副本施加
 * `governance/wo/WO-MEM-SOURCE-01/migrations/016_experiences_epistemic.up.sql`
 * 之后逐对象比对，夹具缺的 9 张表 / 1 个索引 / 7 个触发器从生产库 `sqlite_master`
 * 原样取回。比对结论：其余对象的表名、列（列序/类型/NOT NULL/DEFAULT/PK）、
 * 索引、触发器与生产库全同，`PRAGMA user_version` 两侧同为 0（版本记法只在
 * `mind_schema` 表里，不在 pragma 上）。
 *
 * 本模块**不含任何她的数据**：只有 DDL 与中性基线行（regulation_field 四行
 * baseline、integration_state 单行、learning_layer_state 两键、mind_schema 台账）。
 * 身份行（users / contexts / identity_bindings）不在这里播种 —— 那是部署期的
 * 显式登记动作，见 `init-state.ts`。
 */

/**
 * 表 / 索引 / 触发器的完整生产 schema，零行。
 * 表序沿 WO-M0-STATE-CONTRACT §1.2 的移植面，其后接补齐面。
 */
export const STATE_SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

    CREATE TABLE regulation_field (
      name TEXT PRIMARY KEY CHECK (name IN ('coherence','load','relational_tension','exploration_hunger')),
      value REAL NOT NULL CHECK (value >= 0.0 AND value <= 1.0),
      baseline REAL NOT NULL CHECK (baseline >= 0.0 AND baseline <= 1.0),
      updated_at TEXT NOT NULL
    );

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
      integration_id INTEGER,
      -- WO-MEM-SOURCE-01（mind_schema 16）：认识论第二轴。列位在**末尾**且 CHECK
      -- 逐字与迁移件 016 的 ALTER TABLE ADD COLUMN 一致 —— ADD COLUMN 只能加在
      -- 表尾，夹具与迁移后的生产表因此列序同形。NULL 合法且含义唯一：016 之前
      -- 写下的旧行未回填（写路径不再产 NULL）。
      epistemic TEXT CHECK (epistemic IS NULL OR epistemic IN
              ('observed','executed','user_reported','inferred','imagined','simulated'))
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

    CREATE TABLE IF NOT EXISTS learning_layer_state (
      key TEXT PRIMARY KEY, value INTEGER NOT NULL, set_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner_primary','group_member','agent')),
      created_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner_primary_unique ON users(role) WHERE role = 'owner_primary';

    CREATE TABLE IF NOT EXISTS contexts (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','group','system')),
      title TEXT, created_at TEXT NOT NULL
    );

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

    -- ====================== 生产 schema 补齐面（AUDIT-FIX-2026-09-02） ======================
    -- 以下对象在 M2 写层的移植面之外，因此此前不在夹具里；DDL 从 schema 16 的生产库
    -- sqlite_master 原样取回（列序、CHECK、触发器消息逐字）。造库入口必须落全，
    -- 否则新库与接管来的库不同形。

    CREATE TABLE IF NOT EXISTS context_members (
        context_id TEXT NOT NULL REFERENCES contexts(id),
        user_id    TEXT NOT NULL REFERENCES users(id),
        joined_at  TEXT NOT NULL,
        PRIMARY KEY(context_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS procedures (
        id            TEXT PRIMARY KEY,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL,
        domain        TEXT NOT NULL,
        reliability   REAL NOT NULL DEFAULT 0.0,
        runs_total    INTEGER NOT NULL DEFAULT 0,
        runs_ok       INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        superseded_by TEXT REFERENCES procedures(id)
    );

    CREATE TABLE IF NOT EXISTS owner_edits (
        id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
        target TEXT NOT NULL,
        layer  TEXT NOT NULL CHECK (layer IN ('content','disposition','commitment')),
        before_snapshot TEXT NOT NULL, after_snapshot TEXT NOT NULL,
        propagation_note TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_metrics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                content TEXT NOT NULL
            );

    CREATE TABLE IF NOT EXISTS note_insight_links (
        note_id    INTEGER NOT NULL REFERENCES autonomy_notes(id),
        insight_id INTEGER NOT NULL REFERENCES insights(id),
        linked_at  TEXT NOT NULL,
        PRIMARY KEY(note_id, insight_id)
    );

    CREATE TABLE IF NOT EXISTS environment_ingest_receipts (
        event_id TEXT PRIMARY KEY,
        terminal_id TEXT NOT NULL,
        batch_ts TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        received_at TEXT NOT NULL,
        received_day TEXT NOT NULL,
        disposition TEXT NOT NULL
                    CHECK (disposition IN ('accepted','dropped_limit','dropped_rate')),
        experience_id INTEGER UNIQUE REFERENCES experiences(id)
    );
    CREATE INDEX IF NOT EXISTS idx_environment_ingest_receipts_day
       ON environment_ingest_receipts(received_day);
    CREATE TRIGGER IF NOT EXISTS environment_ingest_receipts_no_update
       BEFORE UPDATE ON environment_ingest_receipts
       BEGIN SELECT RAISE(ABORT, 'environment ingest receipts are append-only'); END;
    CREATE TRIGGER IF NOT EXISTS environment_ingest_receipts_no_delete
       BEFORE DELETE ON environment_ingest_receipts
       BEGIN SELECT RAISE(ABORT, 'environment ingest receipts are append-only'); END;

    CREATE TABLE IF NOT EXISTS environment_ingest_state (
        day TEXT PRIMARY KEY,
        accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
        deduped INTEGER NOT NULL DEFAULT 0 CHECK (deduped >= 0),
        dropped_limit INTEGER NOT NULL DEFAULT 0 CHECK (dropped_limit >= 0),
        dropped_rate INTEGER NOT NULL DEFAULT 0 CHECK (dropped_rate >= 0),
        updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS environment_core_event_outbox (
        event_id TEXT PRIMARY KEY
                 REFERENCES environment_ingest_receipts(event_id),
        experience_id INTEGER NOT NULL UNIQUE REFERENCES experiences(id),
        enqueued_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_validate
       BEFORE INSERT ON environment_core_event_outbox
       BEGIN
         SELECT CASE WHEN NOT EXISTS(
           SELECT 1 FROM environment_ingest_receipts r
           WHERE r.event_id=NEW.event_id
             AND r.disposition='accepted'
             AND r.experience_id=NEW.experience_id
         ) THEN RAISE(ABORT, 'environment Core outbox provenance mismatch') END;
       END;
    CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_no_update
       BEFORE UPDATE ON environment_core_event_outbox
       BEGIN SELECT RAISE(ABORT, 'environment Core outbox is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_no_delete
       BEFORE DELETE ON environment_core_event_outbox
       BEGIN SELECT RAISE(ABORT, 'environment Core outbox is append-only'); END;

    CREATE TABLE IF NOT EXISTS environment_core_event_deliveries (
        event_id TEXT PRIMARY KEY
                 REFERENCES environment_core_event_outbox(event_id),
        delivered_at TEXT NOT NULL
    );
    CREATE TRIGGER IF NOT EXISTS environment_core_event_deliveries_no_update
       BEFORE UPDATE ON environment_core_event_deliveries
       BEGIN SELECT RAISE(ABORT, 'environment Core delivery is append-only'); END;
    CREATE TRIGGER IF NOT EXISTS environment_core_event_deliveries_no_delete
       BEFORE DELETE ON environment_core_event_deliveries
       BEGIN SELECT RAISE(ABORT, 'environment Core delivery is append-only'); END;
`

/** mind_schema 台账的一行：版本号 + 施加时刻（迁移机口径，见下）。 */
export interface MindSchemaLedgerRow {
  version: number
  /** migrations.py:1148 口径：`strftime('%Y-%m-%dT%H:%M:%fZ')` = 毫秒 + Z 后缀。 */
  appliedAt: string
}

/** 中性基线行的时间戳注入面（C-12：台账口径与业务行口径不同，不得混用）。 */
export interface StateBaselineSpec {
  /** mind_schema 台账；`MAX(version)` 即开库门读的那个数。 */
  schemaLedger: readonly MindSchemaLedgerRow[]
  /** regulation_field 四行 baseline 的 updated_at（业务行 isoformat：`+00:00`）。 */
  regulationUpdatedAt: string
  /** learning_layer_state 两键的 set_at（业务行 isoformat：`+00:00`）。 */
  learningSetAt: string
}

/**
 * 中性基线行的 DDL 片段：mind_schema 台账、regulation_field 四行 baseline、
 * integration_state 单行、learning_layer_state 两键。
 *
 * 只有中性行 —— 身份行（users / contexts / identity_bindings）不在此列。
 * 两个 learning_layer_state 键按 C-15 硬幂等语义播种（`INSERT OR IGNORE`：
 * 水位线重放不得抬高）。
 *
 * 时间戳一律由调用方注入（测试时钟纪律）：测试夹具传固定日期，生产创建入口传
 * `--now`。字符串直接拼进 SQL，因此只接受本模块自己的时间戳形状 —— 见下方校验。
 */
export function stateBaselineDdl(spec: StateBaselineSpec): string {
  for (const row of spec.schemaLedger) {
    if (!Number.isInteger(row.version) || row.version < 0) {
      throw new TypeError('lykoi-memory/schema: mind_schema version 必须是非负整数')
    }
    assertTimestampLiteral(row.appliedAt)
  }
  assertTimestampLiteral(spec.regulationUpdatedAt)
  assertTimestampLiteral(spec.learningSetAt)
  const ledger = spec.schemaLedger
    .map((r) => `    INSERT INTO mind_schema VALUES (${r.version}, '${r.appliedAt}');`)
    .join('\n')
  return `
${ledger}

    INSERT INTO regulation_field VALUES
      ('coherence', 0.7, 0.7, '${spec.regulationUpdatedAt}'),
      ('load', 0.2, 0.2, '${spec.regulationUpdatedAt}'),
      ('relational_tension', 0.3, 0.3, '${spec.regulationUpdatedAt}'),
      ('exploration_hunger', 0.0, 0.0, '${spec.regulationUpdatedAt}');

    INSERT OR IGNORE INTO integration_state (id) VALUES (1);

    INSERT OR IGNORE INTO learning_layer_state (key, value, set_at)
      VALUES ('l2_intake_watermark_id', 0, '${spec.learningSetAt}');
    INSERT OR IGNORE INTO learning_layer_state (key, value, set_at)
      VALUES ('l4_focus_wakes_since', 0, '${spec.learningSetAt}');
`
}

/**
 * 拼进 SQL 字面量之前的形状闸：只放行本项目的两种时间戳记法
 * （业务行 isoformat `+00:00` / 台账 `…Z`）。引号、分号一概进不来。
 */
function assertTimestampLiteral(value: string): void {
  const ok = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3}|\.\d{6})?(Z|\+00:00)$/.test(value)
  if (!ok) {
    throw new TypeError(
      `lykoi-memory/schema: 时间戳形状不认识（要 isoformat +00:00 或台账 …Z）：${value}`,
    )
  }
}
