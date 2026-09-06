-- WO-TURN-01 · mind_schema 18 → 19：durable inbound + UserTurn
--
-- 目标库：/home/lykoi/state/memory.db。只允许在停机、备份之后由治理侧施加；
-- 执行侧与测试只对临时库运行本文件。
--
-- 幂等纪律：版本行是第一条写。重跑撞 mind_schema 主键，-bail 令整段事务回滚。
-- 回滚见 019_durable_ingress.down.sql；逆迁移只撤版本行，保留已可靠接收的消息。

BEGIN IMMEDIATE;

INSERT INTO mind_schema (version, applied_at)
VALUES (19, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE user_turns (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  user_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  is_owner INTEGER NOT NULL CHECK (is_owner IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'collecting'
    CHECK (state IN ('collecting','queued','running','terminal')),
  first_received_at TEXT NOT NULL,
  last_received_at TEXT NOT NULL,
  committed_at TEXT,
  commit_reason TEXT CHECK (commit_reason IS NULL OR commit_reason IN ('idle_timeout','hard_timeout')),
  queue_seq INTEGER UNIQUE,
  run_id TEXT,
  terminal_status TEXT,
  terminal_reason TEXT,
  terminal_at TEXT,
  terminal_payload_json TEXT CHECK (terminal_payload_json IS NULL OR json_valid(terminal_payload_json)),
  terminal_audited INTEGER NOT NULL DEFAULT 0 CHECK (terminal_audited IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_user_turns_collecting_scope
  ON user_turns(channel, context_id, user_id) WHERE state = 'collecting';
CREATE INDEX idx_user_turns_queue
  ON user_turns(state, queue_seq);

CREATE TABLE inbound_parts (
  inbound_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  platform_message_id TEXT NOT NULL,
  platform_update_id TEXT,
  user_id TEXT NOT NULL,
  context_id TEXT NOT NULL,
  is_owner INTEGER NOT NULL CHECK (is_owner IN (0, 1)),
  text TEXT NOT NULL,
  received_at TEXT NOT NULL,
  source_timestamp TEXT,
  reply_to_platform_message_id TEXT,
  turn_id TEXT NOT NULL REFERENCES user_turns(id),
  part_order INTEGER NOT NULL CHECK (part_order >= 0),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_inbound_parts_platform_message
  ON inbound_parts(channel, context_id, platform_message_id);
CREATE UNIQUE INDEX idx_inbound_parts_platform_update
  ON inbound_parts(channel, platform_update_id) WHERE platform_update_id IS NOT NULL;
CREATE UNIQUE INDEX idx_inbound_parts_turn
  ON inbound_parts(turn_id, part_order);

COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'inbound_parts_rows' AS check_name, COUNT(*) AS value FROM inbound_parts;
SELECT 'user_turns_rows' AS check_name, COUNT(*) AS value FROM user_turns;
