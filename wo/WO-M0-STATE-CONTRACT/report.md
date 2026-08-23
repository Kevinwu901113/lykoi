I have what I need. Report follows.

---

# WO-M0-STATE-CONTRACT — state/DB 契约文档

**基线**：`~/lykoi-work-m0/` = 活体 HEAD `4463ae8` 只读副本。全部断言由本单 grep/read 实测，路径相对 `src/lykoi/` 除非另注。
**副本缺失实测**：按 `guardian/manifest.sha256`(113 条)逐条核对，**仅 1 个 .py 路径在副本中不存在**：`src/lykoi/cognition/permission_evidence_shadow.py`。工单预告的"5 个 0600 不可读 .py"在本副本中未复现为不可读文件——`guardian/` 下 5 个 `-r--r--r--` 文件(`audit_sink.py` / `path_guard.py` / `policy_core.py` / `startup_verify.py` / `watchdog.py`)可读且已读入本报告。[事实]

---

## §1 memory.db 全表 schema

### 1.0 版本号与迁移机

**`mind_schema` 当前版本 = 15**。`SCHEMA_VERSION = MIGRATIONS[-1][0]`,`MIGRATIONS` 逐字为 `(1,_V1)…(15,_V15)` — `mind/migrations.py:1085-1091`。[事实]

版本台账表本身:
```sql
CREATE TABLE IF NOT EXISTS mind_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
```
`mind/migrations.py:1107`。`applied_at` 由 `strftime('%Y-%m-%dT%H:%M:%fZ','now')` 写入(`:1148`)——**毫秒精度 + Z 后缀**,与业务行的 `isoformat()`(`+00:00` 偏移)**不同口径**,见 C-12。

`applied_version()` = `SELECT MAX(version) FROM mind_schema`,表不存在返回 0 — `:1094-1101`。

### 1.1 完整表清单(实测,15 版累计)

memory.db 共 **37 张表**:31 张归 `mind/migrations.py`,6 张归 `memory/store.py` 的 `_init()`。

| # | 表 | 建于 | DDL file:line |
|---|---|---|---|
| 1 | `mind_schema` | 迁移机 | `migrations.py:1107` |
| 2 | `regulation_field` | _V1 | `migrations.py:24` |
| 3 | `regulation_events` | _V1 | `migrations.py:31` |
| 4 | `concerns` | _V1→_V6→_V12 重建 | `migrations.py:42` / `:273` / `:670` |
| 5 | `narrative_versions` | _V1(+_V5 加列) | `migrations.py:58` / `:242` |
| 6 | `narrative_threads` | _V1 | `migrations.py:68` |
| 7 | `experiences` | _V1→_V3→_V7 重建 | `migrations.py:77` / `:134` / `:305` |
| 8 | `integration_state` | _V1 | `migrations.py:99` |
| 9 | `owner_edits` | _V1 | `migrations.py:105` |
| 10 | `thoughts` | _V4 | `migrations.py:173` |
| 11 | `environment_ingest_receipts` | _V8 | `migrations.py:338` |
| 12 | `environment_ingest_state` | _V8 | `migrations.py:359` |
| 13 | `environment_core_event_outbox` | _V9 | `migrations.py:382` |
| 14 | `environment_core_event_deliveries` | _V9 | `migrations.py:406` |
| 15 | `users` | _V10 | `migrations.py:471` |
| 16 | `identity_bindings` | _V10 | `migrations.py:481` |
| 17 | `contexts` | _V10 | `migrations.py:490` |
| 18 | `context_members` | _V10 | `migrations.py:496` |
| 19 | `memory_scopes` | _V10 | `migrations.py:502` |
| 20 | `procedures` | _V10 | `migrations.py:513` |
| 21 | `note_insight_links` | _V10 | `migrations.py:525` |
| 22 | `experience_class` | _V11 | `migrations.py:589` |
| 23 | `learning_layer_state` | _V12 | `migrations.py:647` |
| 24 | `focus_cycles` | _V13 | `migrations.py:755` |
| 25 | `product_lineage` | _V13 | `migrations.py:779` |
| 26 | `focus_insight_state` | _V13 | `migrations.py:803` |
| 27 | `focus_insight_history` | _V13 | `migrations.py:818` |
| 28 | `concern_focus_state` | _V13 | `migrations.py:836` |
| 29 | `rule_suggestions` | _V14 | `migrations.py:922` |
| 30 | `delegation_contracts` | _V15 | `migrations.py:1029` |
| 31 | `execution_receipts` | _V15 | `migrations.py:1042` |
| 32 | `history` | memory.store `_init` | `memory/store.py:46` |
| 33 | `insights` | memory.store `_init` | `memory/store.py:54` |
| 34 | `autonomy_state` | memory.store `_init` | `memory/store.py:73` |
| 35 | `autonomy_runs` | memory.store `_init` | `memory/store.py:81` |
| 36 | `autonomy_notes` | memory.store `_init` | `memory/store.py:97` |
| 37 | `health_metrics` | memory.store `_init` | `memory/store.py:121` |

**跨模块建表的时序风险** [事实]:`insights`/`autonomy_notes`/`history` 由 `memory/store.py` 的模块级 `_init()`(`memory/store.py:130`,import 副作用)建,而 `_V10` 的 `_backfill_memory_scopes` 要读它们。该函数因此先查 `sqlite_master` 跳过不存在的表 — `migrations.py:446-454`。`_V13` 的 `focus_insight_state` 同理**刻意不加** `REFERENCES insights(id)` — `migrations.py:796-798`。

### 1.2 当前有效 CREATE 语句要点(逐表)

**注意**:`concerns` 与 `experiences` 经过表交换重建,`sqlite_master` 里的现行文本是**最后一次重建**的文本。

#### `regulation_field` — `migrations.py:24-30`
```sql
name TEXT PRIMARY KEY CHECK (name IN ('coherence','load','relational_tension','exploration_hunger')),
value REAL NOT NULL CHECK (value >= 0.0 AND value <= 1.0),
baseline REAL NOT NULL CHECK (baseline >= 0.0 AND baseline <= 1.0),
updated_at TEXT NOT NULL
```
无索引、无触发器。四行定长表,`_init_rows` 用 `INSERT OR IGNORE` 补齐 — `mind/store.py:181-186`。

#### `regulation_events` — `migrations.py:31-40`
```sql
id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
name TEXT NOT NULL, delta REAL NOT NULL, value_after REAL NOT NULL, cause TEXT NOT NULL
```
索引:`idx_regulation_events_name_ts ON regulation_events(name, ts)` — `:40`
**append-only 触发器(逐字)** — `:36-39`:
```sql
CREATE TRIGGER IF NOT EXISTS regulation_events_no_update BEFORE UPDATE ON regulation_events
   BEGIN SELECT RAISE(ABORT, 'regulation_events is append-only'); END
CREATE TRIGGER IF NOT EXISTS regulation_events_no_delete BEFORE DELETE ON regulation_events
   BEGIN SELECT RAISE(ABORT, 'regulation_events is append-only'); END
```

#### `concerns` — 现行 DDL 为 `_V12` 文本,`migrations.py:670-684`
```sql
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
```
索引:`idx_concerns_status ON concerns(status)` — `:691`。**无触发器**(`:272` 明注)。origin 枚举是**七值并集**:四个历史值(v1 三个 + v6 的 `floor`)+ 三个 v12 设计值;历史行**不重贴标签** — `:664-668`。

#### `narrative_versions` — `migrations.py:58-63` + `_V5` 加列 `:242`
```sql
id INTEGER PRIMARY KEY, created_at TEXT NOT NULL, content TEXT NOT NULL,
change_summary TEXT NOT NULL,
trigger TEXT NOT NULL CHECK (trigger IN ('integration','owner_edit')),
narrative_class TEXT CHECK (narrative_class IN
    ('absorption','reflection','narrative_only','legacy','owner_edit'))   -- ALTER, _V5
```
**append-only 触发器(逐字)** — `:64-67`(no_update 于 `_V5` 被 DROP 后**原样重挂**,`:250`/`:255-256`):
```sql
CREATE TRIGGER IF NOT EXISTS narrative_versions_no_update BEFORE UPDATE ON narrative_versions
   BEGIN SELECT RAISE(ABORT, 'narrative_versions is append-only'); END
CREATE TRIGGER IF NOT EXISTS narrative_versions_no_delete BEFORE DELETE ON narrative_versions
   BEGIN SELECT RAISE(ABORT, 'narrative_versions is append-only'); END
```
**`narrative_class` 语义红线** [事实]:历史整合行(含 46 条 strict-empty confabulation)回填为 `'legacy'`,**永不洗白成 `'absorption'`** — `:244-249`,`:253-254`。

#### `narrative_threads` — `migrations.py:68-75`
```sql
id INTEGER PRIMARY KEY,
kind TEXT NOT NULL CHECK (kind IN ('open_question','commitment','suspended_tension','arc')),
content TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','suspended','resolved','absorbed')),
created_at TEXT NOT NULL, updated_at TEXT NOT NULL, resolution TEXT
```
无索引、无触发器。**可变表**。

#### `experiences` — 现行 DDL 为 `_V7` 文本,`migrations.py:305-314`
```sql
id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
source TEXT NOT NULL CHECK (source IN ('conversation','wake_action','action_result',
        'silence','owner_event','system','thought_lapse','environment')),
content TEXT NOT NULL,
salience REAL NOT NULL DEFAULT 0.5 CHECK (salience >= 0.0 AND salience <= 1.0),
related_concern_id INTEGER REFERENCES concerns(id),
integrated INTEGER NOT NULL DEFAULT 0 CHECK (integrated IN (0,1)),
integration_id INTEGER
```
索引:`idx_experiences_integrated ON experiences(integrated)` — `:319`
**触发器(逐字,`_V7` 现行文本)** — `:320-330`:
```sql
CREATE TRIGGER IF NOT EXISTS experiences_no_delete BEFORE DELETE ON experiences
   BEGIN SELECT RAISE(ABORT, 'experiences is append-only'); END

CREATE TRIGGER IF NOT EXISTS experiences_immutable_columns BEFORE UPDATE ON experiences
   WHEN NEW.id IS NOT OLD.id OR NEW.ts IS NOT OLD.ts OR NEW.source IS NOT OLD.source
        OR NEW.content IS NOT OLD.content OR NEW.salience IS NOT OLD.salience
        OR NEW.related_concern_id IS NOT OLD.related_concern_id
        OR NOT (
            (NEW.integrated IS OLD.integrated AND NEW.integration_id IS OLD.integration_id)
            OR (OLD.integrated = 0 AND NEW.integrated = 1 AND NEW.integration_id IS NOT NULL)
        )
   BEGIN SELECT RAISE(ABORT, 'experiences rows are append-only; integration may only move 0 -> 1 once'); END
```
即:**唯一合法的 UPDATE 是 `integrated` 0→1 且同时写入非 NULL 的 `integration_id`**,其余全列冻结。`IS NOT` 是 null-safe 比较。

#### `integration_state` — `migrations.py:99-103`
```sql
id INTEGER PRIMARY KEY CHECK (id = 1),
last_integration_at TEXT, wakes_since INTEGER NOT NULL DEFAULT 0,
experiences_pending INTEGER NOT NULL DEFAULT 0
```
单行表(CHECK 钉死 id=1)。可变。`_V8` 有一次性修复:`experiences_pending` 重算时**排除 `source='environment'`** — `:370-375`。

#### `owner_edits` — `migrations.py:105-111`
```sql
id INTEGER PRIMARY KEY, ts TEXT NOT NULL, target TEXT NOT NULL,
layer TEXT NOT NULL CHECK (layer IN ('content','disposition','commitment')),
before_snapshot TEXT NOT NULL, after_snapshot TEXT NOT NULL, propagation_note TEXT NOT NULL
```
无触发器。表头注明:**她永远不读;任何注入 prompt 的路径禁止读此表** — `:104`。

#### `thoughts` — `migrations.py:173-185`
```sql
id INTEGER PRIMARY KEY, ts TEXT NOT NULL,
content TEXT NOT NULL CHECK (length(content) <= 200),
kind TEXT NOT NULL CHECK (kind IN ('intent','question','hypothesis','rumination','observation')),
source TEXT NOT NULL CHECK (source IN ('wake','conversation','integration','contemplate')),
related_concern_id INTEGER REFERENCES concerns(id), source_ref TEXT,
charge REAL NOT NULL DEFAULT 0.5 CHECK (charge >= 0.0 AND charge <= 1.0),
status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved','abandoned','absorbed','archived')),
resolved_by_integration_id INTEGER
```
索引:`idx_thoughts_status ON thoughts(status)` — `:186`
**五个触发器(逐字)** — `:188-229`:
```sql
CREATE TRIGGER IF NOT EXISTS thoughts_no_delete BEFORE DELETE ON thoughts
   BEGIN SELECT RAISE(ABORT, 'thoughts is append-only (never delete)'); END

CREATE TRIGGER IF NOT EXISTS thoughts_immutable_columns BEFORE UPDATE ON thoughts
   WHEN NEW.id IS NOT OLD.id OR NEW.ts IS NOT OLD.ts OR NEW.content IS NOT OLD.content
        OR NEW.kind IS NOT OLD.kind OR NEW.source IS NOT OLD.source
        OR NEW.source_ref IS NOT OLD.source_ref
   BEGIN SELECT RAISE(ABORT, 'thoughts: id/ts/content/kind/source/source_ref are immutable (append-only)'); END

CREATE TRIGGER IF NOT EXISTS thoughts_status_flow BEFORE UPDATE ON thoughts
   WHEN OLD.status IS NOT NEW.status
        AND NOT (
            (OLD.status = 'open'      AND NEW.status IN ('resolved','abandoned')) OR
            (OLD.status = 'resolved'  AND NEW.status IN ('absorbed','archived')) OR
            (OLD.status = 'abandoned' AND NEW.status = 'archived')
        )
   BEGIN SELECT RAISE(ABORT, 'thoughts: forbidden status transition (append-only one-way flow)'); END

CREATE TRIGGER IF NOT EXISTS thoughts_related_concern_oneway BEFORE UPDATE ON thoughts
   WHEN OLD.related_concern_id IS NOT NULL AND OLD.related_concern_id IS NOT NEW.related_concern_id
   BEGIN SELECT RAISE(ABORT, 'thoughts: related_concern_id is one-way (NULL->value, append-only)'); END

CREATE TRIGGER IF NOT EXISTS thoughts_resolved_by_integration_oneway BEFORE UPDATE ON thoughts
   WHEN OLD.resolved_by_integration_id IS NOT NULL
        AND OLD.resolved_by_integration_id IS NOT NEW.resolved_by_integration_id
   BEGIN SELECT RAISE(ABORT, 'thoughts: resolved_by_integration_id is one-way (NULL->value, append-only)'); END

CREATE TRIGGER IF NOT EXISTS thoughts_terminal_integration BEFORE UPDATE ON thoughts
   WHEN (NEW.status = 'absorbed'  AND NEW.resolved_by_integration_id IS NULL)
     OR (NEW.status = 'abandoned' AND NEW.resolved_by_integration_id IS NOT NULL)
   BEGIN SELECT RAISE(ABORT, 'thoughts: absorbed requires resolved_by_integration_id; abandoned must not carry one'); END
```
(共 6 个触发器,上面列全。)状态机 5×5 矩阵中**仅 5 条边合法**,其余 15 条 raise — `:201-203`。

#### `environment_ingest_receipts` — `migrations.py:338-347`
```sql
event_id TEXT PRIMARY KEY, terminal_id TEXT NOT NULL, batch_ts TEXT NOT NULL,
payload_sha256 TEXT NOT NULL, received_at TEXT NOT NULL, received_day TEXT NOT NULL,
disposition TEXT NOT NULL CHECK (disposition IN ('accepted','dropped_limit','dropped_rate')),
experience_id INTEGER UNIQUE REFERENCES experiences(id)
```
索引:`idx_environment_ingest_receipts_day ON environment_ingest_receipts(received_day)` — `:349`
**append-only 触发器(逐字)** — `:351-356`:
```sql
CREATE TRIGGER IF NOT EXISTS environment_ingest_receipts_no_update
   BEFORE UPDATE ON environment_ingest_receipts
   BEGIN SELECT RAISE(ABORT, 'environment ingest receipts are append-only'); END
CREATE TRIGGER IF NOT EXISTS environment_ingest_receipts_no_delete
   BEFORE DELETE ON environment_ingest_receipts
   BEGIN SELECT RAISE(ABORT, 'environment ingest receipts are append-only'); END
```

#### `environment_ingest_state` — `migrations.py:359-366`
```sql
day TEXT PRIMARY KEY,
accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted >= 0),
deduped INTEGER NOT NULL DEFAULT 0 CHECK (deduped >= 0),
dropped_limit INTEGER NOT NULL DEFAULT 0 CHECK (dropped_limit >= 0),
dropped_rate INTEGER NOT NULL DEFAULT 0 CHECK (dropped_rate >= 0),
updated_at TEXT NOT NULL
```
**刻意可变** — `:357-358`("Daily counters are operational state, not lived experience")。

#### `environment_core_event_outbox` — `migrations.py:382-386`
```sql
event_id TEXT PRIMARY KEY REFERENCES environment_ingest_receipts(event_id),
experience_id INTEGER NOT NULL UNIQUE REFERENCES experiences(id),
enqueued_at TEXT NOT NULL
```
**三个触发器,含一个 provenance 校验(逐字)** — `:388-403`:
```sql
CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_validate
   BEFORE INSERT ON environment_core_event_outbox
   BEGIN
     SELECT CASE WHEN NOT EXISTS(
       SELECT 1 FROM environment_ingest_receipts r
       WHERE r.event_id=NEW.event_id
         AND r.disposition='accepted'
         AND r.experience_id=NEW.experience_id
     ) THEN RAISE(ABORT, 'environment Core outbox provenance mismatch') END;
   END
CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_no_update ... 'environment Core outbox is append-only'
CREATE TRIGGER IF NOT EXISTS environment_core_event_outbox_no_delete ... 'environment Core outbox is append-only'
```

#### `environment_core_event_deliveries` — `migrations.py:406-410`
```sql
event_id TEXT PRIMARY KEY REFERENCES environment_core_event_outbox(event_id),
delivered_at TEXT NOT NULL
```
append-only 双触发器 — `:411-416`,消息 `'environment Core delivery is append-only'`。

#### `users` — `migrations.py:471-477`
```sql
id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
role TEXT NOT NULL CHECK(role IN ('owner_primary','group_member','agent')),
created_at TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'))
```
**部分唯一索引**(owner 唯一性的物理保证) — `:479-480`:
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_owner_primary_unique ON users(role) WHERE role = 'owner_primary'
```
种子行(**固定历史常量,不读实时钟**) — `:534-535`:
`INSERT OR IGNORE INTO users VALUES ('user_001','Kevin','owner_primary','2026-08-09T00:00:00+00:00','active')`

#### `identity_bindings` — `migrations.py:481-489`
```sql
id INTEGER PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
channel TEXT NOT NULL, channel_key TEXT NOT NULL,
verified_by TEXT NOT NULL, created_at TEXT NOT NULL,
UNIQUE(channel, channel_key)
```

#### `contexts` — `migrations.py:490-495`
```sql
id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','group','system')),
title TEXT, created_at TEXT NOT NULL
```
种子行 — `:536-537`:`('ctx_direct_user_001','direct',NULL,'2026-08-09T00:00:00+00:00')`

#### `context_members` — `migrations.py:496-501`
```sql
context_id TEXT NOT NULL REFERENCES contexts(id), user_id TEXT NOT NULL REFERENCES users(id),
joined_at TEXT NOT NULL, PRIMARY KEY(context_id, user_id)
```

#### `memory_scopes` — `migrations.py:502-512`
```sql
table_name TEXT NOT NULL, row_id INTEGER NOT NULL,
subject_user_id TEXT REFERENCES users(id), origin_context TEXT REFERENCES contexts(id),
visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public','context')),
sensitivity TEXT NOT NULL DEFAULT 'content' CHECK(sensitivity IN ('content','state','existence')),
PRIMARY KEY(table_name, row_id)
```
`_backfill_memory_scopes` 覆盖七张源表:`experiences, thoughts, insights, concerns, narrative_threads, autonomy_notes, history` — `migrations.py:419-422`。回填默认值一律保守:`user_001` / `ctx_direct_user_001` / `private` / `content` — `:458`。`WHERE NOT EXISTS` 保证重放安全 — `:460-463`。

#### `procedures` — `migrations.py:513-524`
```sql
id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, domain TEXT NOT NULL,
reliability REAL NOT NULL DEFAULT 0.0,
runs_total INTEGER NOT NULL DEFAULT 0, runs_ok INTEGER NOT NULL DEFAULT 0,
created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
superseded_by TEXT REFERENCES procedures(id)
```

#### `note_insight_links` — `migrations.py:525-530`
```sql
note_id INTEGER NOT NULL REFERENCES autonomy_notes(id),
insight_id INTEGER NOT NULL REFERENCES insights(id),
linked_at TEXT NOT NULL, PRIMARY KEY(note_id, insight_id)
```

#### `experience_class` — `migrations.py:589-594`
```sql
experience_id INTEGER PRIMARY KEY REFERENCES experiences(id),
class TEXT NOT NULL CHECK(class IN ('working','archive')),
classified_at TEXT NOT NULL, rule_version INTEGER NOT NULL
```
索引:`idx_experience_class_class ON experience_class(class)` — `:597`;`idx_experience_class_rule_version ON experience_class(rule_version)` — `:600`。
分类规则**不在 SQL 里重述**,唯一实现是 `mind/experience_class.classify(source, content)` 纯函数 — `:570-572`。

#### `learning_layer_state` — `migrations.py:647-651`
```sql
key TEXT PRIMARY KEY, value INTEGER NOT NULL, set_at TEXT NOT NULL
```
两个已知键:
- `l2_intake_watermark_id` = 迁移落地当刻 `COALESCE(MAX(experiences.id),0)` — `:652-655`。**`INSERT OR IGNORE` 是硬幂等要求**:重放不得抬高水位线,否则上线后的真原料被一次性划进"历史积压"永不消化 — `:638-642`。
- `l4_focus_wakes_since` = 0 — `:850-852`

#### `focus_cycles` — `migrations.py:755-767`
```sql
id INTEGER PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
concern_id INTEGER REFERENCES concerns(id),
selection_reason TEXT NOT NULL DEFAULT '',
outcome TEXT NOT NULL DEFAULT 'idle'
        CHECK (outcome IN ('idle','advanced','revised','no_progress','failed')),
retrieved_count INTEGER NOT NULL DEFAULT 0,
match_reasons TEXT NOT NULL DEFAULT '[]',
llm_calls INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT ''
```
索引:`idx_focus_cycles_concern ON focus_cycles(concern_id)` — `:768`。
`id` **同时就是周期序号**:单调递增、每周期恰一行,冷却与防自恋硬规则用它做确定性算术 — `:746-749`。

#### `product_lineage` — `migrations.py:779-788`
```sql
id INTEGER PRIMARY KEY, product_kind TEXT NOT NULL, product_id TEXT NOT NULL,
source_kind TEXT NOT NULL, source_id TEXT NOT NULL,
cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id), created_at TEXT NOT NULL,
UNIQUE (product_kind, product_id, source_kind, source_id, cycle_id)
```
索引:`idx_product_lineage_product(product_kind,product_id)` — `:789`;`idx_product_lineage_source(source_kind,source_id)` — `:791`。
**刻意多态、刻意不加外键**;id 一律 TEXT,因为 `procedures.id` 是 TEXT 而 `insights.id` 是 INTEGER — `:772-777`。

#### `focus_insight_state` — `migrations.py:803-812`
```sql
insight_id INTEGER PRIMARY KEY,
status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn')),
created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
```
索引:`idx_focus_insight_state_status` — `:813`。**无回到 `shadow` 的边,无 DELETE** — `:802`。

#### `focus_insight_history` — `migrations.py:818-827`
```sql
id INTEGER PRIMARY KEY, insight_id INTEGER NOT NULL,
cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
from_status TEXT, to_status TEXT NOT NULL,
content_snapshot TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', at TEXT NOT NULL
```
索引:`idx_focus_insight_history_insight` — `:828`。**追加式,永不更新**(约定级,无触发器) — `:817`。

#### `concern_focus_state` — `migrations.py:836-844`
```sql
concern_id INTEGER PRIMARY KEY REFERENCES concerns(id),
no_progress_streak INTEGER NOT NULL DEFAULT 0,
cooldown_until_cycle INTEGER, cooldown_count INTEGER NOT NULL DEFAULT 0,
last_cycle_id INTEGER, release_suggested_at_cycle INTEGER, updated_at TEXT NOT NULL
```
`release_suggested_at_cycle` **只建议不执行** — `:833-835`。

#### `rule_suggestions` — `migrations.py:922-945`
```sql
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
```
索引:`idx_rule_suggestions_status` — `:946`;`idx_rule_suggestions_question ON rule_suggestions(question_message_id)` — `:950`。
**铁律** — `:894-897`:此表存的是"她想建议的事"与"他怎么答的",**不是任何生效中的规则**;`approval_rules.json` 在本单任何代码路径上**都没有写入口**。`dedup_key` 的 UNIQUE 是物理去重保证,键**由代码派生**(`suggestions.dedup_key`)不由 LLM 给 — `:908-911`。

#### `delegation_contracts` — `migrations.py:1029-1038`
```sql
id TEXT PRIMARY KEY, requester TEXT NOT NULL, contract_yaml TEXT NOT NULL,
state TEXT NOT NULL CHECK(state IN
    ('draft','dispatched','running','collected','verified','rejected','expired')),
agent_user_id TEXT NOT NULL REFERENCES users(id),
created_at TEXT NOT NULL, updated_at TEXT NOT NULL
```
索引:`idx_delegation_contracts_state` — `:1040`。**无触发器**(可变台账;不可篡改记录落在 guardian audit sink 的 `delegation_*` 事件里) — `:1026-1028`。状态机双层:CHECK 挡非法**取值**,`mind.delegation.TRANSITIONS` 挡非法**迁移** — `:996-999`。

#### `execution_receipts` — `migrations.py:1042-1049`
```sql
id TEXT PRIMARY KEY, contract_id TEXT NOT NULL REFERENCES delegation_contracts(id),
evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
verdict TEXT CHECK(verdict IS NULL OR verdict IN ('accepted','rejected')),
verified_at TEXT, created_at TEXT NOT NULL
```
索引:`idx_execution_receipts_contract` — `:1051`。
⚠ **本仓唯一一处偏离冻结稿的 DDL** — `:1001-1024`:冻结稿写的是 `CHECK(verdict IN ('accepted','rejected',NULL))`,该 CHECK **一个值都拦不住**(SQL 三值逻辑:IN 列表含 NULL 且左值不匹配任何非 NULL 项时求值为 NULL 而非 FALSE,CHECK 只在 FALSE 时失败)。实测 sqlite 3.45 下 `INSERT ... VALUES ('maybe')` 成功。落地形式改为 `verdict IS NULL OR verdict IN (...)` — **收紧**,取值集合与冻结稿字面意图逐字相同。

#### `history` — `memory/store.py:46-51`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
event_type TEXT NOT NULL, content TEXT NOT NULL
```
**append-only 触发器(逐字)** — `:63-70`:
```sql
CREATE TRIGGER IF NOT EXISTS history_no_update BEFORE UPDATE ON history
   BEGIN SELECT RAISE(ABORT, 'history is append-only'); END
CREATE TRIGGER IF NOT EXISTS history_no_delete BEFORE DELETE ON history
   BEGIN SELECT RAISE(ABORT, 'history is append-only'); END
```
**注意 `AUTOINCREMENT`**:与 mind 表的裸 `INTEGER PRIMARY KEY` 不同,这会建 `sqlite_sequence` 并保证 id 永不复用。

#### `insights` — `memory/store.py:54-60`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, created TEXT NOT NULL, updated TEXT NOT NULL,
category TEXT NOT NULL, content TEXT NOT NULL
```
无索引、**无触发器**、可变(`:6-8` 明注)。

#### `autonomy_state` — `memory/store.py:73-78`
```sql
id INTEGER PRIMARY KEY CHECK (id = 1), next_wake_at TEXT NOT NULL,
last_wake_at TEXT, updated_at TEXT NOT NULL
```
单行表。

#### `autonomy_runs` — `memory/store.py:81-91`
```sql
id TEXT PRIMARY KEY, started_at TEXT NOT NULL, finished_at TEXT,
status TEXT NOT NULL,            -- running | completed | failed | stale
decision TEXT,                   -- JSON
next_wake_at TEXT,
action_count INTEGER DEFAULT 0, external_read_count INTEGER DEFAULT 0,
notification_count INTEGER DEFAULT 0
```
⚠ `status`/`decision` 的枚举**只是注释,没有 CHECK**;三个计数列 `DEFAULT 0` 但**无 NOT NULL** — 与 mind 表的枚举纪律不同。[事实]

#### `autonomy_notes` — `memory/store.py:97-107`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL,
autonomy_run_id TEXT NOT NULL, kind TEXT NOT NULL,   -- observation|reflection|question
content TEXT NOT NULL, confidence REAL,
source_type TEXT,                                    -- web_page|internal|null
source_urls_json TEXT
```
**append-only 触发器(逐字)** — `:108-115`:
```sql
CREATE TRIGGER IF NOT EXISTS autonomy_notes_no_update BEFORE UPDATE ON autonomy_notes
   BEGIN SELECT RAISE(ABORT, 'autonomy_notes is append-only'); END
CREATE TRIGGER IF NOT EXISTS autonomy_notes_no_delete BEFORE DELETE ON autonomy_notes
   BEGIN SELECT RAISE(ABORT, 'autonomy_notes is append-only'); END
```
`autonomy_run_id` **无 FK** 指向 `autonomy_runs(id)`(约定级关联)。

#### `health_metrics` — `memory/store.py:121-126`
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, content TEXT NOT NULL
```
无触发器。存在理由:遥测曾刷爆 `history` 淹没她的"最近世界" — `:116-119`。

---

## §2 逐表语义与写者

**进程台账**(`*.service` 的 `ExecStart`,`lykoi-work-m0/` 根):
| unit | 入口 | file |
|---|---|---|
| lykoi-server | `uvicorn lykoi.surface.app:app` | `lykoi-server.service` |
| lykoi-autonomy | `-m lykoi.cognition.autonomous` | `lykoi-autonomy.service` |
| lykoi-telegram | `-m lykoi.resources.telegram_device` | `lykoi-telegram.service` |
| lykoi-core | `-m lykoi.core.runtime` | `lykoi-core.service` |
| lykoi-broker | `-m lykoi.broker` | `lykoi-broker.service` |
| lykoi-runner | `-m lykoi.runner` | `lykoi-runner.service` |

**单写者档位定义**:
- **严格单写者** = 只有一个模块有 INSERT/UPDATE 语句,且只有一个进程会执行它。
- **DB 层串行多写者** = 多个进程可能执行该写入,靠 `BEGIN IMMEDIATE` + `busy_timeout` 在 DB 层串行。

memory.db 的现实档位:**几乎全部是"DB 层串行多写者"**。理由 [事实]:`mind/store.py:1-8` 顶注明写 "the surface and the autonomy supervisor are separate processes; read-modify-write must serialize at the DB, not in-process";`mind/store.py` 的每个函数都是 `_connect()` → `_tx()`,而 surface / autonomy / telegram 三个进程都 import 它。**代码层单写者(单模块)≠ 进程层单写者**。

| 表 | 存什么 | 写者(模块:行) | 读者 | 档位 |
|---|---|---|---|---|
| `regulation_field` | 四个调节变量的当前值+基线 | `mind/store.py:183`(`_init_rows` 补默认)、`:267`(apply cause) | `mind/store.py`, `mind/console.py` | DB 层串行多写者 |
| `regulation_events` | 每次调节变动的追加事实 | `mind/store.py:271` | `mind/store.py`, `mind/console.py`, `core/baseline.py` | DB 层串行多写者(append-only) |
| `concerns` | 后天关切(兴趣/项目/问题/仪式/关系线) | `mind/store.py:352,385,416,459,483` | `mind/store.py`, `mind/console.py`, `core/baseline.py` | DB 层串行多写者 |
| `narrative_versions` | 自我叙事的每一版 | `mind/store.py:563`;回填 `migrations.py:251,253` | 同上 | DB 层串行多写者(append-only) |
| `narrative_threads` | 开放问题/承诺/悬置张力/弧线 | `mind/store.py:625,666,692` | 同上 | DB 层串行多写者 |
| `experiences` | 经验缓冲(所有 source 的事实沉积) | `mind/store.py:759,908,1254,1308` | `mind/store.py`, `relevance.py`, `experience_class.py`, `salience_shadow.py`(**只读 URI**), `console.py`, `baseline.py` | DB 层串行多写者(append-only + 整合位单向) |
| `integration_state` | 单行整合节律(id=1) | `mind/store.py:186,734,1532,1550`;`migrations.py:370` | `mind/store.py`, `console.py` | DB 层串行多写者 |
| `owner_edits` | owner 后门台账 | `mind/store.py:1584` | **仅** `mind/store.py` | 严格单写者(仅 owner console 路径)[推断] |
| `thoughts` | ≤200 字的内向笔记 | `mind/thoughts.py:55,126,167,196,238,319`;`mind/store.py:1295` | `thoughts.py`, `store.py`, `integrator.py`, `baseline.py` | DB 层串行多写者 |
| `environment_ingest_receipts` | 感知 ingest 的幂等/溯源收据 | `mind/store.py:873,895,921` | `mind/store.py` | 严格单写者:仅 surface 进程的 ingest 端点 [推断,依据 `surface/perception.py` 是唯一 HTTP 入口] |
| `environment_ingest_state` | 每日 200 配额计数 | `mind/store.py:831,855,880,902,931` | `mind/store.py` | 同上 |
| `environment_core_event_outbox` | Core 投递义务队列 | `mind/store.py:943` | `mind/store.py` | 同上(append-only) |
| `environment_core_event_deliveries` | Core 投递 ACK | `mind/store.py:1117` | `mind/store.py` | 严格单写者(Core 投递侧)(append-only) |
| `users` | 身份行(owner/群成员/agent) | `kernel/delegation.py:220`(`ensure_agent_user`);`migrations.py:534`(种子) | `delegation.py`, `mind/store.py` | DB 层串行多写者 |
| `identity_bindings` | 渠道 ↔ user 绑定 | **无写者** | `mind/store.py` | 骨架表,活体零写入 [事实] |
| `contexts` | 语境(直连/群/系统) | **仅** `migrations.py:536`(种子) | 无 | 骨架表,仅种子行 [事实] |
| `context_members` | 语境成员 | **无写者** | 无 | 骨架表,完全未接线 [事实] |
| `memory_scopes` | 七表逐行的可见性/敏感度 | **仅** `migrations.py:456`(回填) | `relevance.py`, `mind/store.py`, `migrations.py` | 只回填,无运行时写者 [事实] |
| `procedures` | 程序性经验 | **无写者** | 无 | 骨架表,活体零读写 [事实] |
| `note_insight_links` | autonomy_note ↔ insight 血缘 | **无写者** | `core/baseline.py` | 骨架表,只被基线快照读 [事实] |
| `experience_class` | working/archive 分流影子表 | `mind/experience_class.py:93,144` | `experience_class.py`, `relevance.py`, `mind/store.py` | DB 层串行多写者 |
| `learning_layer_state` | 学习层标量键值 | `mind/store.py:1535,1736`;`migrations.py:652,850` | `mind/store.py`, `migrations.py` | DB 层串行多写者 |
| `focus_cycles` | 层 2 周期台账(id=周期序号) | `mind/store.py:1758,1791` | `mind/store.py` | 严格单写者:仅 autonomy 进程的 focus 循环 [推断,依据 `mind/focus.py` 是唯一调用方] |
| `product_lineage` | 多态血缘五元组 | `mind/store.py:1972` | `mind/store.py` | 同上 |
| `focus_insight_state` | insight 影子期/contested 状态机 | `mind/store.py:2106,2169` | `mind/store.py` | 同上 |
| `focus_insight_history` | 状态迁移历史+内容快照 | `mind/store.py:2113,2176` | `mind/store.py` | 同上 |
| `concern_focus_state` | 关切反刍计数/冷却 | `mind/store.py:1904` | `mind/store.py` | 同上 |
| `rule_suggestions` | 规则建议队列(她问 / Kevin 答) | `mind/store.py:2304,2319,2453,2493` | `mind/store.py` | DB 层串行多写者(autonomy 入队 + telegram 归属答复) |
| `delegation_contracts` | 委托合同台账 | `kernel/delegation.py:273,344` | `delegation.py`, `broker/contracts.py` | DB 层串行多写者 |
| `execution_receipts` | 执行收据 + verdict | `kernel/delegation.py:386,444` | `delegation.py` | 同上 |
| `mind_schema` | 迁移版本台账 | `migrations.py:1148` | `migrations.py`, `core/baseline.py` | DB 层串行多写者(`BEGIN IMMEDIATE` 内 re-check 保证并发迁移的输者是 no-op — `:1132-1137`) |
| `history` | 原始事件流(append-only) | `memory/store.py:138` | `memory/store.py`, `cognition/conversation.py` | DB 层串行多写者 |
| `insights` | 可变的结论/判断 | `memory/store.py:223`(UPDATE)、`:227`(INSERT) | `memory/store.py`, `mind/store.py`, `cognition/scheduler.py`, `core/baseline.py` | DB 层串行多写者 |
| `autonomy_state` | 单行唤醒时钟 | `memory/store.py:328,333,338` | `memory/store.py` | 严格单写者(autonomy 进程)[推断] |
| `autonomy_runs` | 每次唤醒一行 | `memory/store.py:254,274,296` | `memory/store.py`, `core/baseline.py` | 严格单写者(autonomy 进程)[推断] |
| `autonomy_notes` | 自主输出(append-only) | `memory/store.py:370` | `memory/store.py`, `core/baseline.py` | 严格单写者(autonomy 进程)[推断] |
| `health_metrics` | 健康遥测(离开 history) | `memory/store.py:200` | `memory/store.py` | DB 层串行多写者 |

**关键权限语义** [事实]:
- `autonomy_notes` → `insights` **没有直接通路**。自主环只写 notes,晋升由 `mind/integrator.py` 的整合期做,是"governed, periodic, fidelity-checked" — `memory/store.py:365-367`。
- `owner_edits` 是唯一**不发 events.jsonl** 的 mind 写入 — `mind/store.py:10-14`:"The ledger row itself is Kevin's audit... keeping owner edits out of it keeps red line #4 safe by construction, not by hoping nobody ever wires that feed."
- `salience_shadow` 对 memory.db 的唯一通路是 `file:...?mode=ro` URI,**写入在连接层物理不可能** — `mind/salience_shadow.py:209-212`。

---

## §3 sidecar 数据库

### 3.1 `salience_shadow.db` — **WAL**

- 路径:`LYKOI_SALIENCE_DB` → `/home/lykoi/state/salience_shadow.db` — `mind/salience_shadow.py:190-191`(另有常量 `cognition/heartbeat.py:67`)
- 连接:`timeout=10.0`、`isolation_level=None`、`busy_timeout=10000`、**`journal_mode=WAL`**、每次连接 `executescript(_SCHEMA)` — `:194-206`
- schema(`_SCHEMA`,`:141-187`):

`posterior`:
```sql
key TEXT PRIMARY KEY, alpha REAL NOT NULL, beta REAL NOT NULL, last_update_ts TEXT NOT NULL
```
`shadow_log`:
```sql
id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, experience_id INTEGER NOT NULL,
source TEXT NOT NULL, key TEXT NOT NULL, score REAL NOT NULL, boost REAL NOT NULL,
explore_flag INTEGER NOT NULL DEFAULT 0, selected INTEGER NOT NULL, skip_reason TEXT,
load_value REAL NOT NULL, load_tier INTEGER NOT NULL,
presented_today INTEGER NOT NULL, presented_hour INTEGER NOT NULL,
outcome TEXT, outcome_ts TEXT, outcome_integration_id INTEGER
```
索引:`idx_shadow_experience` **UNIQUE** on `(experience_id)` — `:167`;`idx_shadow_pending ON shadow_log(outcome) WHERE outcome IS NULL`(**部分索引**) — `:168`。

**三个触发器(逐字)** — `:169-186`:
```sql
CREATE TRIGGER IF NOT EXISTS shadow_log_no_delete
BEFORE DELETE ON shadow_log
BEGIN SELECT RAISE(ABORT, 'shadow_log is append-only'); END;

CREATE TRIGGER IF NOT EXISTS shadow_log_decision_immutable
BEFORE UPDATE ON shadow_log
WHEN NEW.ts IS NOT OLD.ts OR NEW.experience_id IS NOT OLD.experience_id
  OR NEW.source IS NOT OLD.source OR NEW.key IS NOT OLD.key
  OR NEW.score IS NOT OLD.score OR NEW.boost IS NOT OLD.boost
  OR NEW.explore_flag IS NOT OLD.explore_flag OR NEW.selected IS NOT OLD.selected
  OR NEW.skip_reason IS NOT OLD.skip_reason OR NEW.load_value IS NOT OLD.load_value
  OR NEW.load_tier IS NOT OLD.load_tier
  OR NEW.presented_today IS NOT OLD.presented_today
  OR NEW.presented_hour IS NOT OLD.presented_hour
BEGIN SELECT RAISE(ABORT, 'shadow_log decision columns are immutable'); END;

CREATE TRIGGER IF NOT EXISTS shadow_log_outcome_write_once
BEFORE UPDATE ON shadow_log
WHEN OLD.outcome IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'shadow_log outcome is write-once'); END;
```
即:决策列全冻结,`outcome`/`outcome_ts`/`outcome_integration_id` **写一次**。

- 写者:`mind/salience_shadow.py` 单模块。**fail-closed 到进程重启**:常数从 `docs/phase5_prereg_v1.md` 解析,sha256 不符或解析失败 → `_constants_cache = None`,整个 shadow 停摆,只 log 一次 `salience_shadow_disabled` — `:113-131`。
- **移植态判定** [推断]:预注册影子评估器,**不随 core 退役**。它的依赖是 memory.db 的 `experiences`(只读)与 prereg 文档,与 `core/` 无关。M1 需保真:WAL 模式、UNIQUE(experience_id) 幂等、outcome 写一次。

### 3.2 `core_facts.db` — **随 core 退役冻结**

- 路径:`LYKOI_CORE_FACTS_DB` → `/home/lykoi/state/core_facts.db` — `core/shadow.py:690`
- `APPLICATION_ID = 0x4C594B31`("LYK1") — `core/shadow.py:62`;`CORE_SCHEMA_VERSION = 1`,`CORE_ACTIVE_SCHEMA_VERSION = 1`,`CORE_SUPPORTED_SCHEMA_VERSION = 2` — `:59-61`
- 表(10 张 + `core_schema`):`core_events`(`:148`)、`episodes`(`:166`)、`artifacts`(`:179`)、`commands`(`:192`)、`observations`(`:225`)、`outcomes`(`:259`)、`command_transitions`(`:284`)、`audit_events`(`:305`);v2 追加 `attention_candidates`(`:548`)、`attention_decisions`(`:561`);版本表 `core_schema`(`:765`)。
- 索引 12 个 — `:332-343`。**触发器 18 个**:每张表一对 `_no_update`/`_no_delete`(`:344-379`,全部 append-only),外加 5 个 BEFORE INSERT 校验器:`command_artifact_validate`(`:380`)、`observation_validate`(`:391`)、`outcome_validate`(`:405`)、`command_transition_validate`(`:453`)、`episode_transition_validate`(`:504`);v2 再加 `attention_candidate_validate`(`:607`)、`attention_decision_validate`(`:614`)。
- 连接纪律:`journal_mode=WAL`、`synchronous` 可配 NORMAL/FULL(bridge 写者 NORMAL,Core 启动路径 FULL) — `:1187-1198`,`:1222`,`:1243`。迁移后强制 `foreign_key_check` + `quick_check` — `:806-809`。migration sha256 逐版校验,不符即 `ShadowConflict` — `:713-721`。附带 artifact 目录 `LYKOI_CORE_ARTIFACT_DIR` → `/home/lykoi/state/core_artifacts` — `:695`。
- 唯一写者:`core/shadow.py`(`PRODUCER_BOOT_ID = uuid.uuid4().hex`,`:64`)。开关 `LYKOI_CORE_SHADOW_ENABLED` 必须恰为 `"1"`,否则 `ShadowConflict` — `:681-686`。
- **移植态判定** [事实+推断]:写侧随 core 退役**冻结**。但 **读侧活得更久**:`cognition/self_state_sources.py:23` 独立解析同一个 env 常量,以只读方式取 Mac 事件做能力状态(TTL 600s,`:25`;事件类型白名单 `:30-36`)。
  → **冻结语义**:M1 起 `core_facts.db` 变为**只读历史文件**。新体不得写入,但必须保留文件与 `self_state_sources` 的读路径,直到该能力状态源被替换。[建议] 在 M1 明确标记该文件为 read-only,并给 `self_state_sources` 一个"文件不存在 = 无观测"而非报错的降级路径(现行代码是否已有此降级,本单未核实)。

### 3.3 `percept_buffer.db`

- 路径:`LYKOI_PERCEPT_BUFFER_DB` → `/home/lykoi/state/percept_buffer.db` — `mind/percept_buffer.py:20`
- `SCHEMA_VERSION = 1` — `:44`;版本表 `percept_schema (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)` — `:64`
- 唯一业务表 — `:23-30`:
```sql
CREATE TABLE IF NOT EXISTS percept_events (
    id INTEGER PRIMARY KEY, ts TEXT NOT NULL, device TEXT NOT NULL,
    kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at TEXT NOT NULL)
```
索引:`idx_percept_events_expires_at ON percept_events(expires_at)` — `:31`。**无触发器**。
- 连接:`timeout=10.0`、`isolation_level=None`、`busy_timeout=10000`、**无 WAL、无 foreign_keys** — `:95-99`
- **写者:无**。模块顶注明写"Server-side ingest/retention jobs are later steps (阶段2 步骤5, out of this module's scope); this WO only lands the table" — `:10-11`。本单 grep 确认 `percept_events` 全仓无 INSERT。[事实]
- **移植态判定** [事实]:**空骨架**,与 core 无关。M1 照搬 schema 即可,零数据风险。保留理由是 §2.3 的"整档轮转"治理生命周期与长期记忆完全不同 — `:4-6`。

### 3.4 `permission_evidence_shadow.db` — **WAL + 0600**

- 路径:`permission_evidence.SHADOW_DB_ENV` / `DEFAULT_SHADOW_DB` = `/home/lykoi/state/permission_evidence_shadow.db` — `core/permission_evidence.py:25`,取用于 `core/permission_evidence_shadow.py:93-99`
- `APPLICATION_ID = 0x4C504531`("LPE1")、`SCHEMA_VERSION = 1`、`BUSY_TIMEOUT_MS = 2000` — `:25-27`
- schema — `:29-71`:
```sql
CREATE TABLE permission_evidence_schema (
    version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL,
    migration_sha256 TEXT NOT NULL CHECK(length(migration_sha256)=64))

CREATE TABLE permission_decision_facts (
    fact_id TEXT PRIMARY KEY,
    contract TEXT NOT NULL CHECK(contract='lykoi.permission-decision-fact.v1'),
    approval_id TEXT NOT NULL, correlation_id TEXT NOT NULL, action_type TEXT NOT NULL,
    origin TEXT NOT NULL CHECK(origin IN ('interactive','autonomous','scheduler','system')),
    owner_decision TEXT NOT NULL CHECK(owner_decision IN ('approved','denied')),
    authority TEXT NOT NULL CHECK(authority='episodic'),
    actor TEXT NOT NULL CHECK(actor='owner'),
    source TEXT NOT NULL CHECK(source='surface.approvals.v1'),
    decided_at TEXT NOT NULL,
    fact_sha256 TEXT NOT NULL CHECK(length(fact_sha256)=64),
    recorded_at TEXT NOT NULL,
    producer_instance TEXT NOT NULL CHECK(producer_instance='lykoi-server'),
    producer_boot_id TEXT NOT NULL, runtime_boot_id TEXT NOT NULL,
    UNIQUE(approval_id, owner_decision))
```
索引:`idx_permission_facts_action_origin(action_type,origin,decided_at)` — `:55`;`idx_permission_facts_correlation(correlation_id,decided_at)` — `:57`。
**四个触发器**(两表各一对 append-only) — `:59-70`,消息 `'permission_evidence_schema is append-only'` / `'permission_decision_facts is append-only'`。
- 连接:`foreign_keys=ON`、`busy_timeout=2000`;**建库时** `journal_mode=WAL` + `synchronous=FULL` — `:132-139`。只读连接额外 `query_only=ON` — `:172`。
- 文件纪律 [事实]:`_ensure_private_regular_file` 用 `O_CREAT|O_EXCL|O_RDWR|O_NOFOLLOW` 建、`0o600`,并在每次连接前 `chmod 0o600`;非 regular file 直接报错 — `:102-122`。完整性检查:`application_id`(`:202`)、`foreign_keys==1`(`:218`)、`quick_check=='ok'`(`:222`)。
- 写者:`core/permission_evidence_shadow.py`,`producer_instance` CHECK 钉死 `'lykoi-server'` → **严格单写者:surface 进程**。[事实]
- 读侧 [事实]:模块顶注 — "It has no fact-reading API: the only public read surface is content-free integrity/count diagnostics" — `:1-6`。
- **移植态判定** [推断]:与 `core_facts.db` **刻意分离**(`:3`)。它记的是 owner 审批事实,不是 Core 运行时事实,**不随 core 退役**。M1 必须保真:0600 + O_NOFOLLOW 建档、`UNIQUE(approval_id, owner_decision)` 幂等、`fact_sha256` 冲突检测(`PermissionEvidenceConflict`,`:78-79`)。

---

## §4 JSON/JSONL state 文件全集

**锁与原子写两个原语**:
- `write_json_atomic(path, obj)` — 同目录 mkstemp → `json.dump(ensure_ascii=False, indent=2)` → `flush` → `fsync` → `os.replace`(POSIX 原子);异常路径 unlink 临时文件 — `shared/jsonio.py:17-31`
- `file_lock(path)` — 对 **`<path>.lock` sidecar** 取 `flock(LOCK_EX)` 阻塞式;锁目录 `mode=0o700`,锁文件 `0o600`;`close(fd)` 即释放 — `shared/filelock.py:30-44`。**锁的是 sidecar 不是数据文件**,所以 `os.replace` 换 inode 不会让锁失效 — `:11-13`;flock 是 per-open-file-description,同进程两次 acquire 也互斥 — `:14-17`;持有者崩溃内核自动释放 — `:19-20`。

| 文件 | 路径常量 / env | 形状 | 写者 | 锁纪律 | 环形上限 | 损坏语义 |
|---|---|---|---|---|---|---|
| `approval_rules.json` | `LYKOI_APPROVAL_RULES` — `kernel/approval.py:40` | `{"always_allow":[str],"always_deny":[str],"ask":[str], "autonomous"?:{"always_allow":[str],"always_deny":[str]}}` | `_save`(`:191`)、`_persist`(`:198`);**她无写路径**,落笔是 Kevin 的 root 会话 | `file_lock(RULES_PATH)` + atomic(scoped grant 写:`:456`,`:468`) | 无 | **fail CLOSED**:文件缺失 → 写空默认后返回默认(`:169-171`);读失败/schema 不合 → 返回空默认 + `log_event("approval_rules_invalid")`,**不崩溃** — `:175-186` |
| `standing_grants.json` | `LYKOI_STANDING_GRANTS` — `:254` | `{"grants":[{entry,action_type,scope_key,granted_at,granted_by,question,answer,conditions:[str],revoked_at}], "denials":[...]}` — `:433-446` | `kernel/approval.py:449`(grant)、`:525`(deny 记录) | `file_lock(STANDING_PATH)` + atomic — `:447-451` | 无(按 entry 去重覆写) | 坏文件 → `{"grants":[],"denials":[]}` + `log_event("standing_grants_unreadable")` — `:377-381`;非 dict/非 list 亦归零 — `:382-389` |
| `pending_actions.json` | `LYKOI_PENDING_ACTIONS` — `:613` | `[{id,ts,action_type,params,params_hash,correlation_id,origin,run_id,expires_at,consumed_at,question_message_id?,question_text?}]` — `:688-701` | `kernel/approval.py`(enqueue/consume/sweep) | `file_lock(PENDING_PATH)` + atomic — `:681`,`:634` | 无(靠 `PENDING_TTL_S`=900s 清扫) | **无保护**:`_load_pending` 直接 `json.load`,坏文件抛异常 — `:626-631` [事实,风险项] |
| `notifications.json` | `LYKOI_NOTIFICATIONS` — `kernel/notifications.py:27` | `[{id:int,ts,content,read:bool,origin,autonomy_run_id?,kind?,reply_history_id?,replied_ts?}]` — `:110-121` | `kernel/notifications.py`;调用方**只能是 dispatch 注册的 handler**(`notify.owner` / `autonomy.queue_notification`) — `:4-8` | `file_lock` + atomic — `:104`,`:130`,`:145`,`:159` | `_MAX_KEEP = 500`,超出丢最旧 — `:28`,`:123-124` | **无保护**:`_load` 直接 `json.load` — `:78-82` [事实,风险项] |
| `chat_outbox.json` | `LYKOI_CHAT_OUTBOX` — `shared/chat_outbox.py:26` | v2:`{"version":2,"next_id":int,"items":[{id,ts,kind,content}]}`;**兼容 v1 裸 list**(读时就地迁移,不落盘) — `:33-52` | `shared/chat_outbox.py:append` | `file_lock(OUTBOX_PATH)` + atomic — `:60`,`:73` | `_MAX_KEEP = 200` — `:27`,`:70-71` | **抛 `ValueError("invalid chat outbox state")`** — `:47-48` [事实,风险项] |
| `telegram_undelivered.json` | `LYKOI_TELEGRAM_UNDELIVERED` — `:137-139` | `{"next_id":int,"items":[{...,id,surfaced?,surfaced_at?}]}` — `:145-158` | **单写者:`resources/telegram_transport.record_undelivered`**;本模块只提供原语,自己绝不造记录 — `:132-134` | `file_lock(UNDELIVERED_PATH)` + atomic — `:166`,`:180`,`:196` | `_UNDELIVERED_MAX_KEEP = 200` — `:140`,`:173-174` | **当空**(`{"next_id":1,"items":[]}`) — `:149-155`;`unsurfaced_undelivered` 是**纯读、不建文件** — `:183-186` |
| `proactive_chat.json` | `LYKOI_PROACTIVE_CHAT_LEDGER` — `shared/proactive_chat.py:19` | **裸 list of ISO 时间戳字符串** | `try_send`(`:65`) | `file_lock(LEDGER_PATH)` + atomic — `:60`,`:69` | `_MAX_KEEP = 50` — `:22`,`:69` | **当空**;注释:"最坏情况是多开一次口(仍受日 1 条上限), 不值得为此拒启" — `:31-35`;非 list 亦归空 — `:36` |
| `messenger_inbound.json` | `LYKOI_MESSENGER_INBOUND` — `resources/messenger.py:226` | `{"next_id":int,"items":[{kind:"messenger_inbound",ts,context_id,sender_id,text,reply_to,source_ref_id,id}]}` — `:258-266` | `messenger.ingest_inbound` | `file_lock(INBOUND_PATH)` + atomic — `:267`,`:274` | `_INBOUND_MAX_KEEP = 200` — `:227`,`:272-273` | **当空** — `:234-240` |
| `messenger_outbound.json` | `LYKOI_MESSENGER_LEDGER` — `:131` | **裸 list of ISO 时间戳** | `_reserve_proactive_slot`(`:178`) | `file_lock(LEDGER_PATH)` + atomic — `:172`,`:179` | `_LEDGER_MAX_KEEP = 50` — `:129` | **当空**;同 proactive_chat 的理由 — `:139-143` |
| `messenger_transport.jsonl` | `LYKOI_MESSENGER_TRANSPORT_LOG` — `:71-73` | JSONL | transport 侧 | 追加,**无锁** [推断] | 无 | n/a |
| `telegram_cursor.json` | `LYKOI_TELEGRAM_CURSOR` — `resources/telegram_device.py:58` | `{"last_update_id": int}` — `:113` | `_save_cursor` | `file_lock(CURSOR_PATH)` + atomic — `:112-113` | 无(单键) | **当 0**:"a corrupt cursor is treated as 'start from zero' — worst case is a few replays, never a crash" — `:100`;非 dict / 非 int 亦 0 — `:101-105` |
| `telegram_outbox.cursor` | `LYKOI_TELEGRAM_OUTBOX_CURSOR` — `:70-72` | JSON dict(内含已消费 chat_outbox id) | telegram 进程 | file_lock + atomic [推断,与入站游标同一套纪律 `:118`] | 无 | **当首启**(返回 `None` → 从当前 max id 起)。**与入站游标刻意相反**:入站重放至多多回一次话;出站从 0 重放会把 42 条陈货(含过期死链)一次性灌给 Kevin — `:121-127` |
| `interactive_activity.json` | `LYKOI_INTERACTIVE_LOCK` — `shared/interactive_lock.py:26` | `{"active_until":iso,"updated_at":iso}` — `:35` | `mark_active`(surface 进程) | **仅 atomic,无 file_lock** — `:35` [事实] | 无 | **当 inactive**:缺失/损坏/缺键一律 `False` — `:41-49` |
| `clock.json` | `LYKOI_CLOCK_PATH` / `DEFAULT_CLOCK_PATH` — `shared/clock.py:36`,`:104` | `{"virtual_now":iso,"regime":str,"params_hash":sha256}` — `:205-211` | **严格单写者:autonomy supervisor**,且**仅 stepped 模式**(`_require_stepped`,`:123-128`);rate 模式进程对时钟只读 — `:19-20` | **仅 atomic,无 file_lock** — `:204` [事实] | 无 | `_current_virtual_now_or_none` 坏文件返回 `None`(`:193-199`);`_read_virtual_now` 在 `None` 时**抛 RuntimeError**(`:185-189`)——stepped 模式下坏时钟是硬失败,不降级 |
| `continuations.json` | `LYKOI_CONTINUATIONS` — `shared/continuations.py:24` | **裸 list** of `{id:uuid4hex,ts,task,progress,round,expires_at,status,approved_at?,resolved_at?}` — `:51-59` | `shared/continuations.py`(suspend/handoff/claim/close/resolve/sweep) | `file_lock(CONTINUATIONS_PATH)` + atomic — 每个函数 `:65`,`:79`,`:96`,`:114`,`:127`,`:143`,`:154`,`:167` | 无(靠 `LYKOI_CONTINUATION_TTL_S`=24h 扫成 expired) | **无保护**:`_load` 直接 `json.load` — `:29-33` [事实,风险项] |
| `events.jsonl` | `LYKOI_EVENTS_PATH` — `shared/log.py:21` | 每行 `{"ts":iso,"event":str,**redacted_fields}` — `:26-30` | 全仓 `log_event`(**多进程并发追加**) | **无锁**,`open(...,"a")` 单次 write — `:32-33` | 无 | n/a(追加流) |
| `audit.jsonl` | `LYKOI_AUDIT_PATH` — **`/var/log/lykoi-audit/audit.jsonl`,不在 `state/` 下** — `guardian/audit_sink.py:14` | 每行一个 JSON record | `guardian/audit_sink.audit` | **无锁**,append 模式 — `:19-20` | 无 | n/a |

**其余 state 路径(非 JSON 契约,列出以求全)** [事实]:
`autonomy.lock`(`cognition/autonomous.py:393`,flock 单例)、`restart_marker.json`(`cognition/restart.py:34`)、`screenshots/`(`resources/browser.py:55`)、`research_screenshots/`(`resources/research_browser.py:71`)、`core_artifacts/`(`core/shadow.py:695`)。

**audit.jsonl 权限模型** [事实] — `guardian/audit_sink.py:1-6`:
> "Writes one JSON line per record, opening the log in append mode only — it never truncates or rewrites. The file is meant to be made append-only at the OS level (root-owned + `chattr +a`, an owner step), so even a compromised agent that can append cannot rewrite or delete history. **Imports nothing from lykoi.**"

`guardian/` 目录本身的定位 — `kernel/approval.py:44-52`:root-owned、**不在 PYTHONPATH**、位置由本文件路径推导且**刻意不可 env 覆盖**("an attacker who can set env vars cannot redirect the core to a weakened copy");`startup_verify`(ExecStartPre)拒绝在该目录非 root-owned/非只读时启动;core 加载失败则**fail CLOSED**,一切动作退回 "ask"(`:63-67`)。

**events.jsonl vs audit.jsonl 的定级** [事实] — `kernel/dispatch.py:42-44`:
> "The dedicated guardian sink is the ONLY immutable audit; events.jsonl is telemetry and may never stand in for it."
前置审计是**门**(fail closed):sink 不可用期间,**不再有任何有副作用的动作运行**,直到一次写入成功 — `:44-47`,`:52-55`。

---

## §5 不变量清单(新体必须保真)

### 事务纪律

**C-01 [事实]** `memory.db` 的 mind 侧连接必须:`isolation_level = None`(autocommit,事务全显式)、`row_factory = sqlite3.Row`、`PRAGMA foreign_keys = ON`、`PRAGMA busy_timeout = 10000`、`connect(timeout=10.0)` — `mind/store.py:168-172`。
**C-02 [事实]** 所有 mind 写入走 `_tx()`:`BEGIN IMMEDIATE` → yield → `COMMIT`,`BaseException` 上 `ROLLBACK` 后 re-raise — `mind/store.py:189-197`。**是 IMMEDIATE 不是 DEFERRED**:读-改-写必须在 DB 层串行 — `:4-6`。
**C-03 [事实,差异警告]** `memory/store.py` 的连接**纪律不同**:`SQLITE_BUSY_TIMEOUT_MS = 30_000`(mind 是 10000)、`connect(timeout=30.0)`、`busy_timeout=30000`、**不设 `isolation_level`**(默认隐式 DEFERRED 事务)、**不设 `foreign_keys=ON`** — `memory/store.py:21`,`:28-40`。写法是 `with _connect() as conn: ... conn.commit()`。
  → **同一个文件、两套事务纪律与两个 busy_timeout**。新体接管时这是必须显式决策的分歧点,不能默认统一。
**C-04 [事实]** 迁移期 FK 强制**关闭**,`finally` 恢复;仅在 `applied and fk_was_on` 时跑全库 `PRAGMA foreign_key_check`,有违规则 `raise RuntimeError` 中止启动 — `migrations.py:1120-1122`,`:1156-1174`。理由:表重建(`_V3`/`_V6`/`_V7`/`_V12`)DROP 被别人 FK 指向的表;`PRAGMA foreign_keys` 在事务内是 no-op,`defer_foreign_keys` 无法让 DROP 的隐式 DELETE 违规计数器穿过 COMMIT — `:1109-1119`。
**C-05 [事实]** 每个迁移版本一个独立事务,且在 `BEGIN IMMEDIATE` **之内**重查版本号,使并发迁移的输者成为 no-op 而非 IntegrityError — `migrations.py:1130-1137`。
**C-06 [事实]** 两处**必须 `synchronous=FULL` 且验证生效**的写入,失败即 `RuntimeError`:环境收据+Core 义务同提交(`mind/store.py:825-827`)、Core 投递 ACK(`:1111-1113`)。其余路径**刻意保持旧的耐久策略不变**(byte-for-byte) — `:822-824`。

### append-only 面

**C-07 [事实]** memory.db 上有 DELETE 触发器保护的表(6):`regulation_events`、`narrative_versions`、`experiences`、`thoughts`、`environment_ingest_receipts`、`environment_core_event_outbox`、`environment_core_event_deliveries`、`history`、`autonomy_notes`。(实为 9;逐条 DDL 见 §1.2。)
**C-08 [事实]** UPDATE 面分三档:①**全禁**(`regulation_events`/`narrative_versions`/两个 environment core 表/`environment_ingest_receipts`/`history`/`autonomy_notes`);②**列冻结 + 单向位**(`experiences`:仅 `integrated` 0→1 且同时写 `integration_id`);③**列冻结 + 状态机 + 单向列**(`thoughts`:6 个触发器)。
**C-09 [事实]** 红线 #7:**遗忘永远是标记,不是 DELETE** — `migrations.py:11`。
**C-10 [事实]** 表重建(`DROP TABLE` + `RENAME`)是**允许的例外**:SQLite 随表 DROP 其触发器,且不逐行触发 DELETE trigger — "this isn't 删除历史行, it's swapping the table out underneath them" — `migrations.py:146-149`。触发器在重建后**逐字重挂**。

### 单写者面

**C-11 [事实]** 硬单写者只有三处:
- `clock.json` — 仅 autonomy supervisor,且仅 stepped 模式(`shared/clock.py:19-20`,`:123-128`)
- `telegram_undelivered.json` 的**记录产生** — 仅 `telegram_transport.record_undelivered`(`shared/chat_outbox.py:132-134`)
- `permission_decision_facts` — CHECK 钉死 `producer_instance='lykoi-server'`(`core/permission_evidence_shadow.py:50`)

其余全部是"DB 层/文件锁层串行多写者",详见 §2 表。

### 幂等面

**C-12 [事实]** `upsert_insight` 的去重键是 **`(category, content)` 完整字符串精确相等**;命中则只刷 `updated`,不改 `created` — `memory/store.py:218-223`。**无索引支撑该查询**(全表扫)。
**C-13 [事实]** `environment_ingest_receipts.event_id` 是 PK;`payload_sha256` 的计算**刻意排除 `batch_ts`**(它描述一次投递尝试,不描述事件),否则 Mac 超时重试会与已接受事件冲突 — `mind/store.py:91-119`。另有 legacy 收据兼容路径 `_matches_legacy_environment_receipt` — `:122-145`。
**C-14 [事实]** `rule_suggestions.dedup_key` UNIQUE = 物理去重;键**由代码派生,不由 LLM 给** — `migrations.py:908-911`。
**C-15 [事实]** `learning_layer_state` 两个键用 `INSERT OR IGNORE`;水位线 `l2_intake_watermark_id` **重放不得抬高** — `migrations.py:638-642`。
**C-16 [事实]** `_backfill_memory_scopes` / `_backfill_experience_class` 均 re-run-safe(`WHERE NOT EXISTS` / `OR IGNORE`) — `migrations.py:441-444`,`:574-577`。
**C-17 [事实]** `product_lineage` 的五元组 UNIQUE 使"同周期同原料重复入账"物理不可能,"血缘的条数因此是可信的计数,不是估计" — `migrations.py:778`。
**C-18 [事实]** `salience_shadow.shadow_log` 的 `UNIQUE(experience_id)` + outcome 写一次触发器。
**C-19 [事实]** `mark_undelivered_surfaced` 已标记的记录不改 `surfaced_at`,重复调用幂等 — `shared/chat_outbox.py:207-209`。
**C-20 [事实]** `notifications.mark_replied` 首写获胜,重复回复 no-op,已滚出有界队列的 id 静默 no-op — `kernel/notifications.py:151-153`。
**C-21 [事实]** `continuations.claim` 是**文件锁下的单赢家原子认领**:检查与盖章整体在锁内 — `shared/continuations.py:96-118`。`handoff` 刻意把 resolve+suspend 合成**一次写**,避免崩在中间导致任务凭空消失 — `:75-79`。

### 时间戳格式

**C-22 [事实,重要]** memory.db 内**并存两种 ISO 格式**:
- 业务行:`clock.now().isoformat()` — tz-aware UTC,**`+00:00` 偏移**,微秒精度且**尾随零被省略**(Python `isoformat()` 行为:微秒为 0 时不输出小数部分) — `mind/store.py:152-153`、`memory/store.py:24-25`
- 迁移台账:`strftime('%Y-%m-%dT%H:%M:%fZ','now')` — **`Z` 后缀,固定毫秒三位** — `migrations.py:1148`、`:580`、`:655`、`:852`;`percept_buffer.py:79`;`core/shadow.py:795`
  → 新体做 ISO 比较/排序时必须能同时正确处理这两种;**字符串排序在两种格式混排时不可靠**。[建议] M1 在读侧统一 parse,写侧沿用各自旧格式以保历史行可比。
**C-23 [事实]** `clock.now()` 是全仓**唯一**允许读真实墙钟的路径(`shared/clock.py:107-110` 是那一次真实读)。三种 regime:PRODUCTION(直通)、COMPRESSED_LIVE(本地算 `epoch + (real-anchor)*speed`)、COMPRESSED_DETERMINISTIC(读 `clock.json`) — `:5-14`,`:113-124`。豁免该禁令的代码点用 `# realtime-allow:` 注释显式标注(本单实测出现于 `migrations.py:580,655,852,1148`、`percept_buffer.py:79`、`shared/log.py:27`、`kernel/dispatch.py:37`、`core/permission_evidence_shadow.py:88`、`core/shadow.py:795`)。
**C-24 [事实]** `_hours_since` 对无 tzinfo 的历史时间戳**默认按 UTC 处理** — `mind/store.py:156-160`。历史行里存在 naive 时间戳。[推断]
**C-25 [事实]** `_V10` 的种子行用**固定历史常量** `'2026-08-09T00:00:00+00:00'`,刻意不读实时钟 — `migrations.py:531-533`。

### id 生成

**C-26 [事实]** 三种并存:
- **裸 `INTEGER PRIMARY KEY`**(= rowid 别名,id 可复用):全部 mind 表
- **`INTEGER PRIMARY KEY AUTOINCREMENT`**(建 `sqlite_sequence`,id 永不复用):`history`、`insights`、`autonomy_notes`、`health_metrics`、`salience_shadow.shadow_log`
- **TEXT id**:`users.id`、`contexts.id`、`procedures.id`、`autonomy_runs.id`、`delegation_contracts.id`(`dc_{uuid4().hex}` — `kernel/delegation.py:140`)、`execution_receipts.id`(`rc_{uuid4().hex}` — `:373`)、`environment_ingest_receipts.event_id`、`permission_decision_facts.fact_id`
**C-27 [事实,注意]** **`integration_id` 不是自增也不是 uuid hex**:`int(uuid.uuid4().int % (2**31))` — `mind/integrator.py:553`。它是一个**随机 31 位整数**,不指向任何表的主键,`experiences.integration_id` / `thoughts.resolved_by_integration_id` 上**无 FK**。新体必须复刻同一取模宽度,否则跨体产生的 id 会溢出旧读侧的假设。
**C-28 [事实]** JSON 层的 id:`pending_actions` / `continuations` 用 `uuid4().hex`(`kernel/approval.py:687`,`shared/continuations.py:54`);`notifications` / `chat_outbox` / `messenger_inbound` / `telegram_undelivered` 用**文件内自增整数**(`max(existing)+1` 或持久 `next_id`)。后者在有界裁剪后仍单调:`chat_outbox` / `undelivered` / `inbound` 持久化 `next_id` 并取 `max(next_id, max_item_id+1, 1)`(`shared/chat_outbox.py:50-53`,`:159-160`;`resources/messenger.py:241-242`);但 **`notifications` 只用 `max(items)+1`**(`kernel/notifications.py:111`)——队列裁到 500 上限后若 items 变空,id 会**从 1 重来**。[事实,风险项]

### journal 模式现状与切 WAL 评估

**C-29 [事实]** **`memory.db` 全仓无任何 `journal_mode` 设置** → 运行在 SQLite 默认的 **rollback journal(DELETE 模式)**。实测:全仓 `journal_mode` 只出现在 `mind/salience_shadow.py:204`(WAL)、`core/permission_evidence_shadow.py:137`(WAL)、`core/shadow.py:1187-1193`(WAL)。`percept_buffer.db` 同样**无 WAL**。
**C-30 [事实]** `synchronous` 在 memory.db 上仅在两处环境事实路径临时提到 FULL(C-06),其余用默认。

**切 WAL 的影响面评估** [推断]:

*受益面*
1. **读写不再互斥**。当前 rollback 模式下,一个 `BEGIN IMMEDIATE` 写事务会阻塞所有读者。memory.db 上同时有 surface(每次对话)、autonomy(每次唤醒)、telegram(长轮询间隙)三个进程在读写,WAL 能消掉读者等待写者的那一半。
2. **`salience_shadow` 的只读 URI 连接**(`mode=ro`,`mind/salience_shadow.py:212`)在 WAL 下不再被 mind 的写事务卡住。
3. **`core/baseline.py` 的全库快照读**跨十余张表,在 rollback 模式下是最容易撞 `SQLITE_BUSY` 的读者;WAL 下它取一致快照而不阻塞写者。

*受影响面(需逐条验证)*
1. **`journal_mode=WAL` 是持久属性,写在数据库文件头**。一旦切换,**所有**连接该文件的进程都受影响,包括旧体。这与 M4 切换窗的硬规则直接相关(见 C-33)。
2. **多出 `-wal` / `-shm` 两个文件**。`/home/lykoi/state/` 的备份、权限、以及任何按单文件复制 memory.db 的运维脚本都要改。`core/shadow.py:1403` 有一处 `Path(scratch)/"core_facts.db"` 的快照逻辑,同类模式若存在于 memory.db 的运维侧需一并核对。
3. **WAL 不支持网络文件系统**。若 `/home/lykoi/state/` 曾经或将来位于 NFS 上,WAL 会失败。本单未核实该挂载点。
4. **写者仍然互斥**。WAL 只解决读-写并发,不解决写-写。C-02 的 `BEGIN IMMEDIATE` 串行纪律**一条都不能省**。
5. **checkpoint 行为**。默认 auto-checkpoint 在 WAL 达 1000 页时由**下一个写者**执行,该写者会看到一次延迟尖峰。memory.db 的写者包含 surface 的对话路径(用户可感知延迟)。
6. **`busy_timeout` 语义变化**。WAL 下 `SQLITE_BUSY` 的触发条件不同(主要来自 checkpoint 与写者互斥),现有 10000ms/30000ms 两个值(C-03)是在 rollback 模式下调出来的,切换后需重新验证。

[建议] **切 WAL 应作为 M1 的独立决策项,不与接管同批做**。接管期先原样保持 rollback 模式,把"新体行为 == 旧体行为"这条基线钉住;WAL 作为 M1 之后的性能优化单独提,单独跑并发验证。

---

## §6 接管风险表(Node / better-sqlite3)

| # | 风险点 | 现状(Python) | Node/better-sqlite3 差异 | 处置 |
|---|---|---|---|---|
| R-01 | **M4 切换窗并发写** | 三到六个 Python 进程共写 memory.db,靠 `BEGIN IMMEDIATE` 串行 | 新旧体的事务纪律不同源,无法互相保证 | **硬规则:M4 切换窗内新旧体绝不同时写 `/home/lykoi/state/` 的任何 SQLite 文件。** 切换是"全停旧体 → 验证 → 起新体",不是灰度并跑。若必须并跑,只允许新体**只读**(`mode=ro` URI)。[建议] |
| R-02 | 同步 API vs Python 的阻塞调用 | Python `sqlite3` 亦是同步阻塞;并发靠多进程 | better-sqlite3 **同步**,在 Node 单事件循环里会**阻塞整个进程** | mind 的写事务多为短事务(C-02),风险可控;但 `core/baseline.py` 式的全库快照读、`_backfill_*` 式的批量操作会卡住事件循环。[建议] 长操作放 worker thread,或分批 yield |
| R-03 | **`busy_timeout` 语义** | Python 双轨:`connect(timeout=)` **和** `PRAGMA busy_timeout` 都设(mind 10s/10000ms,memory 30s/30000ms) | better-sqlite3 用 `options.timeout`(默认 5000ms)映射到 busy handler;**无第二条轨道** | 必须显式设成 **mind 路径 10000、memory 路径 30000**,不能取统一值——C-03 的分歧是现存事实,统一即行为变更 |
| R-04 | **类型亲和 TEXT/INTEGER/NULL** | Python `sqlite3` 把 `bool` 存成 INTEGER 0/1;`None`→NULL;`float`→REAL | better-sqlite3 **拒绝 `undefined`**(抛错),`null`→NULL;**不接受 JS `boolean`**(需显式 `? 1 : 0`);整数超 `Number.MAX_SAFE_INTEGER` 需 BigInt 模式 | 逐点核对:`experiences.integrated`、`thoughts` 各 CHECK 位、`notifications.read`(JSON 侧是真 bool)。`integration_id` 是 31 位(C-27),安全整数范围内,不需 BigInt |
| R-05 | `INTEGER PRIMARY KEY` vs `AUTOINCREMENT` 混用 | 两种并存(C-26) | `lastInsertRowid` 在 better-sqlite3 返回 number 或 BigInt(取决于配置) | 统一取 number;`history`/`insights`/`autonomy_notes` 的 `sqlite_sequence` 必须随文件保留,不得重建表 |
| R-06 | **触发器语义** | 25+ 个 `RAISE(ABORT, ...)` 触发器 | ABORT 在 better-sqlite3 抛 `SqliteError`,`code = 'SQLITE_CONSTRAINT_TRIGGER'`,`message` 即触发器里的字符串 | 新体的错误处理必须按**消息字符串**分支(现有 Python 侧同样如此)。触发器消息是**契约的一部分**,不得改字 |
| R-07 | **迁移期 FK 关闭** | `PRAGMA foreign_keys=OFF` 在事务**外**执行,`finally` 恢复(C-04) | better-sqlite3 默认 `foreign_keys` **ON**;`pragma()` 在事务内是 no-op,与 Python 同 | 必须复刻"事务外关 / finally 开 / 迁移后 `foreign_key_check`"三段式。新体若跳过 `foreign_key_check`,一次坏迁移会静默留下悬空引用 |
| R-08 | **`isolation_level` 语义无对应物** | mind 用 `None`(autocommit,事务全显式);memory 用默认(隐式 DEFERRED) | better-sqlite3 **总是 autocommit**,事务必须显式 `db.prepare('BEGIN IMMEDIATE')` 或 `db.transaction()` | mind 路径直接对应。**memory 路径需要主动决策**:`memory/store.py` 现在是隐式 DEFERRED + `conn.commit()`,新体若改成 IMMEDIATE 是**行为收紧**(更安全但可能引入新的 BUSY);若保持无显式事务则每条语句自成事务(**语义变更**,`set_autonomy_next_wake` 的 select-then-insert/update 会失去原子性 — `memory/store.py:325-341`) |
| R-09 | **连接生命周期** | `memory/store.py` 用 `with _connect() as conn:` — sqlite3 的 CM **只 commit,不 close**;每次调用新建连接 | better-sqlite3 连接是长生命周期对象,惯例是单例 | 现状每次调用建连接是**已存在的 fd 压力**;新体改单例是改善,但要确认无跨调用状态依赖 |
| R-10 | **`mind/store._connect()` 每次都跑迁移** | 每个连接调 `apply_migrations` + `_init_rows`(`mind/store.py:173-174`) | 若新体用单例连接,迁移只跑一次 | 语义等价(迁移幂等),但 `_init_rows` 的 `INSERT OR IGNORE` 也只跑一次——需确认无路径依赖"每次连接都补默认行" |
| R-11 | **JSON 文件锁 `flock`** | `fcntl.flock` on sidecar,per-open-file-description(`shared/filelock.py`) | Node 无内建 flock;需 `fs-ext`/`proper-lockfile` 等原生模块 | **锁的是 `<path>.lock` sidecar 而非数据文件**这一点必须保真(C:`filelock.py:11-13`)。用 lockfile 库的默认行为(锁数据文件本身)会**破坏 `os.replace` 的原子换 inode** |
| R-12 | **原子写** | mkstemp 同目录 + fsync + `os.replace`(`shared/jsonio.py`) | Node `fs.renameSync` 在同一文件系统内亦原子;但**必须 `fsync` 临时文件后再 rename**,且 `writeFileSync` 默认不 fsync | 逐条复刻:mkstemp 前缀 `.tmp-` / 后缀 `.json`、`ensure_ascii=False`、`indent=2`。**JSON 输出格式是磁盘上的既有事实**,若新体输出紧凑 JSON,旧体/人工检查会看到全文件 diff |
| R-13 | **`ensure_ascii=False` + `indent=2`** | 所有 `write_json_atomic` 输出 | `JSON.stringify(obj, null, 2)` 输出等价(JS 默认不转义非 ASCII) | 对齐即可;注意 Python `indent=2` 在**空 list/dict** 上输出 `[]`/`{}`,与 JS 一致 |
| R-14 | **坏文件语义四档** | 当空 / 当 0 / 当首启 / 抛异常,**逐文件不同**(§4 表) | 无自动对应 | 必须逐文件复刻。特别是三处**刻意相反**的取舍:入站游标当 0 vs 出站游标当首启(`telegram_device.py:121-127`);以及四个**当前无保护**的文件(`pending_actions` / `notifications` / `chat_outbox` / `continuations`)——[建议] 新体不要"顺手加个 try/catch",那会把一个可见的崩溃变成静默的数据丢失;若要改,单独提单并明确新语义 |
| R-15 | **`guardian/` 的 fail-closed 加载** | `sys.path.insert` + `import policy_core`;失败则一切退回 "ask"(`kernel/approval.py:53-67`) | Node 需等价的"加载失败 = 全部 ask"路径 | 这是权限模型的地基。新体的 `require`/`import` 失败**必须** fail closed,不得 fail open |
| R-16 | **`audit.jsonl` 的 append-only** | O_APPEND 单次 write;文件由 root + `chattr +a` 保护 | Node `fs.appendFileSync` 语义等价 | 保真:**单次 write 一整行**(不分片),否则多进程并发追加会交错 |
| R-17 | `salience_shadow` 的 prereg 文档哈希门 | sha256 不符即整个 shadow 停摆(`mind/salience_shadow.py:118-131`) | 无差异,但需复刻**只 log 一次**的进程级缓存语义 | 保真 |
| R-18 | `execution_receipts.verdict` 的 CHECK 修正 | 现行 DDL 已是 `verdict IS NULL OR verdict IN (...)`(`migrations.py:1046`) | 无 | 新体若从冻结稿重新生成 DDL,会**退回那条什么都拦不住的 CHECK**。必须以 `migrations.py:1046` 为准,并保留 `:1001-1024` 的理由说明 |
| R-19 | **WAL 文件属主** | `salience_shadow.db` / `permission_evidence_shadow.db` / `core_facts.db` 已在 WAL | `-wal`/`-shm` 由创建进程建,权限继承 umask | `permission_evidence_shadow.db` 强制 0600(`core/permission_evidence_shadow.py:122`),但**其 `-wal`/`-shm` 不在该 chmod 覆盖内** [事实,现存问题] — 新体接管时应一并收紧 |
| R-20 | `core_facts.db` 的冻结 | 写侧随 core 退役,读侧 `self_state_sources` 活得更久(§3.2) | — | M1 明确标记只读;`self_state_sources` 的读路径必须保留 |

---

### 备注:本报告的证据边界

- 全部 schema/触发器/常量为**副本源码逐行实测**,未连接任何活体数据库,未读 `/home/lykoi/`,未读 state/secrets,未跑 pytest。
- 表清单以 `mind/migrations.py` 的 `MIGRATIONS` 元组 + `memory/store.py::_init()` 实测为准,非凭记忆。
- **行数统计类断言**(如"4868 条历史经验"、"1180 条未消化")仅出现在源码注释中,本单**未独立验证**,故未纳入契约条款。
- §2 中标 [推断] 的"严格单写者"档位,依据是"该模块只被某一个进程的入口链 import";未做完整调用图证明。M1 落地前建议对 `owner_edits` / `focus_*` / `autonomy_*` 三组做一次调用图确认。
- `messenger_transport.jsonl`、`telegram_outbox.cursor` 的锁纪律为 [推断](依据模块内同类文件的一致纪律与注释 `telegram_device.py:118`),未逐行读到其写入实现。
