/** 入站基础设施库；不属于主体 memory.db，不推进 mind_schema。 */
export const INGRESS_SCHEMA_VERSION = 2
export const INGRESS_SCHEMA_DDL = `
    CREATE TABLE IF NOT EXISTS user_turns (
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
      commit_reason TEXT CHECK (commit_reason IS NULL OR commit_reason IN ('idle_timeout','hard_timeout','restart_replay')),
      replay INTEGER NOT NULL DEFAULT 0 CHECK (replay IN (0, 1)),
      queue_seq INTEGER UNIQUE,
      run_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision BETWEEN 0 AND 2),
      revision_pending INTEGER NOT NULL DEFAULT 0 CHECK (revision_pending IN (0, 1)),
      aborted_runs_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(aborted_runs_json)),
      run_aborts_audited INTEGER NOT NULL DEFAULT 0,
      terminal_status TEXT,
      terminal_reason TEXT,
      terminal_at TEXT,
      terminal_payload_json TEXT CHECK (terminal_payload_json IS NULL OR json_valid(terminal_payload_json)),
      terminal_audited INTEGER NOT NULL DEFAULT 0 CHECK (terminal_audited IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_turns_collecting_scope
      ON user_turns(channel, context_id, user_id) WHERE state = 'collecting';
    CREATE INDEX IF NOT EXISTS idx_user_turns_queue
      ON user_turns(state, queue_seq);

    CREATE TABLE IF NOT EXISTS inbound_parts (
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
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_parts_platform_message
      ON inbound_parts(channel, context_id, platform_message_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_parts_platform_update
      ON inbound_parts(channel, platform_update_id) WHERE platform_update_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbound_parts_turn
      ON inbound_parts(turn_id, part_order);

`
