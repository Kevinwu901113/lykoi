-- WO-CONTINUATION-01 · mind_schema 17 → 18：新表 pending_continuations
--
-- 正本：governance/wo/WO-CONTINUATION-01/order.md §2 D-1。
-- 目标库：/home/lykoi/state/memory.db（**只在治理侧人工施加**；执行侧只在临时库
-- 上实录，见 report.md 与 packages/lykoi-memory/test/migration-018.test.ts）。
--
-- 施加口令（-bail 是幂等语义的一部分，见下）：
--     systemctl disable --now lykoi-cordis-watchdog.timer
--     systemctl disable --now lykoi-cordis.service
--     tar -C /home/lykoi -czf backup-$(date +%Y%m%dT%H%M%S).tar.gz state
--     sqlite3 -bail /home/lykoi/state/memory.db < 018_pending_continuations.up.sql
--     systemctl enable --now lykoi-cordis.service
--
-- 停机是硬要求：新体（EXPECTED_MIND_SCHEMA_VERSION=18）与旧体（=17）都按
-- `MAX(version) 必须恰等于我认识的那个值`拒开。顺序只能是 停 → 备份 → 迁移 → 起新体。
--
-- 本迁移只加表加索引，不动任何既有表、行、触发器；无需关心 PRAGMA foreign_keys
--（新表无 REFERENCES）。
--
-- 幂等：整段一个事务，第一句是版本行的**无 OR IGNORE** INSERT。重跑撞
-- mind_schema 主键 → -bail 中止 → 事务未 COMMIT → 库逐字节不变。
-- 表 DDL 与 packages/lykoi-memory/src/schema.ts 的 STATE_SCHEMA_DDL 逐字一致
--（schema.ts 那份带 IF NOT EXISTS，是建库入口的幂等修饰）。
--
-- 回滚：018_pending_continuations.down.sql（只撤版本行，不删表不删行）。

BEGIN IMMEDIATE;

-- ① 版本行 = 幂等守卫 + 台账（迁移机口径：毫秒 + Z 后缀）。
INSERT INTO mind_schema (version, applied_at)
VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ② 新表。
CREATE TABLE pending_continuations (
  id TEXT PRIMARY KEY,
  origin_turn_id TEXT NOT NULL,
  origin_run_id TEXT,
  goal TEXT NOT NULL,
  due_at TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending','running','completed','failed','expired')),
  terminal_reason TEXT,
  run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ③ 索引（扫描面：state + due_at）。
CREATE INDEX idx_pending_continuations_due ON pending_continuations(state, due_at);

COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'pending_continuations_rows' AS check_name, COUNT(*) AS value FROM pending_continuations;
