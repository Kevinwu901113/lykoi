-- WO-MEM-DECAY-01 · mind_schema 16 → 17：focus_insight_state 六态（新增 dormant）
--
-- 正本：governance/wo/WO-MEM-DECAY-01/order.md §2（D-1..D-8）；上位设计稿
-- governance/docs/persona_layering_design_v1_2026-09-01.md §3.3（D-PERS-3）。
-- 目标库：/home/lykoi/state/memory.db（**只在治理侧人工施加**；工单执行侧从未对
-- 任何真实 db 运行过它 —— 执行侧的两次施加实录跑在临时库上，见 report.md）。
--
-- 施加口令（-bail 是幂等语义的一部分，见下）：
--     systemctl disable --now lykoi-cordis-watchdog.timer
--     systemctl disable --now lykoi-cordis.service
--     tar -C /home/lykoi -czf backup-$(date +%Y%m%dT%H%M%S).tar.gz state
--     sqlite3 -bail /home/lykoi/state/memory.db < 017_focus_insight_dormant.up.sql
--     systemctl enable --now lykoi-cordis.service
--
-- 停机是硬要求：新体（EXPECTED_MIND_SCHEMA_VERSION=17）与旧体（=16）都按
-- `MAX(version) 必须恰等于我认识的那个值`拒开，版本行一落，旧体下次开库即拒。
-- 顺序只能是 停 → 备份 → 迁移 → 起新体。
--
-- **不得在施加会话里打开 PRAGMA foreign_keys**（sqlite3 CLI 默认 OFF，就让它
-- OFF）：本脚本要 DROP 掉一张被 focus_cycles 反向引用不到、但自己 REFERENCES
-- focus_cycles(id) 的表并改名回来，外键开着只会把一次纯粹的表重建变成一次需要
-- 逐行校验的操作，没有收益。
--
-- 为什么是重建而不是 ALTER：SQLite 没有修改 CHECK 约束的语法（既没有
-- `ALTER TABLE ... ALTER CONSTRAINT`，也没有 `DROP CONSTRAINT`）。改 CHECK 的
-- 唯一合法路径就是 建新表 → 搬行 → 删旧表 → 改名 → 重建索引。
--
-- 施加前先确认这张表上没有触发器/视图依赖（夹具与 STATE-CONTRACT 均无；若产线库
-- 上查出来有，**停下来报治理侧**，不要硬跑）：
--     SELECT type, name FROM sqlite_master
--      WHERE type IN ('trigger','view') AND sql LIKE '%focus_insight_state%';
--
-- 幂等（"重跑零副作用"的落法）：整段在一个事务里，第一句就是版本行的
-- **无 OR IGNORE** INSERT。重跑时它撞 mind_schema 的主键 → 报
-- `UNIQUE constraint failed: mind_schema.version` → -bail 立即中止 → 事务从未
-- COMMIT → 库逐字节不变。取的是这个强形式：**要么整段生效，要么什么都没发生**，
-- 绝不存在建了新表没搬行、或搬了两遍的中间态。
--
-- 回滚：017_focus_insight_dormant.down.sql（只撤版本行，不回退 CHECK、不删
-- dormant 行 —— 她的数据不销毁）。

BEGIN IMMEDIATE;

-- ① 版本行 = 幂等守卫 + 台账。applied_at 用迁移机口径
--    （strftime('%Y-%m-%dT%H:%M:%fZ')：毫秒 + Z 后缀；与业务行的 isoformat()
--    「+00:00」口径不同，见 C-12，不要混用）。
INSERT INTO mind_schema (version, applied_at)
VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ② 新表：status 的 CHECK 由五态扩到**六态**，加 'dormant'。其余列 / 约束 /
--    REFERENCES 与 STATE-CONTRACT §1（focus_insight_state，migrations.py:803-812）
--    以及 packages/lykoi-memory/src/schema.ts 的 STATE_SCHEMA_DDL **逐字一致**
--    （schema.ts 那份带 `IF NOT EXISTS`，是建库入口的幂等修饰，不属列定义）。
--    D-1：dormant 入枚举而非旁列 dormant_since —— 同一事实两处真值是给后人埋坑；
--    也不借 withdrawn —— 那是被证据推翻，dormant 只是久未重申。
CREATE TABLE focus_insight_state__017 (
  insight_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn','dormant')),
  created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
);

-- ③ 搬行：**显式列名，禁 SELECT ***（列序漂移时 SELECT * 会静默错位）。
--    一行不增一行不减，一个值不改 —— 本迁移只放宽 CHECK，不动任何既有状态。
INSERT INTO focus_insight_state__017
       (insight_id, status, created_cycle_id, updated_cycle_id,
        contested_since_cycle, superseded_by, updated_at)
SELECT insight_id, status, created_cycle_id, updated_cycle_id,
       contested_since_cycle, superseded_by, updated_at
  FROM focus_insight_state;

-- ④ 换名。DROP 会连带删掉旧表的索引 idx_focus_insight_state_status，⑤ 重建它。
DROP TABLE focus_insight_state;
ALTER TABLE focus_insight_state__017 RENAME TO focus_insight_state;

-- ⑤ 索引复位（名字与定义同 STATE-CONTRACT :813 / schema.ts）。
--    注：ALTER ... RENAME 之后 sqlite_master.sql 里的表名会被 SQLite 重写成带
--    双引号的 "focus_insight_state"，列定义部分逐字不变。校验请对列定义与 CHECK
--    文本，不要对整句字符串做等值比较。
CREATE INDEX idx_focus_insight_state_status ON focus_insight_state(status);

COMMIT;

-- ⑥ 施加回执（**只出计数与 DDL，不出任何 insight 内容** —— 她的结论不进运维终端）。
SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'focus_insight_state_rows' AS check_name, COUNT(*) AS value FROM focus_insight_state;
SELECT 'focus_insight_state_by_status' AS check_name, status AS value, COUNT(*) AS rows
  FROM focus_insight_state GROUP BY status ORDER BY status;
SELECT 'check_has_dormant' AS check_name,
       CASE WHEN sql LIKE '%''dormant''%' THEN 'yes' ELSE 'NO — MIGRATION DID NOT TAKE' END AS value
  FROM sqlite_master WHERE type = 'table' AND name = 'focus_insight_state';
SELECT 'index_present' AS check_name, COUNT(*) AS value
  FROM sqlite_master WHERE type = 'index' AND name = 'idx_focus_insight_state_status';
SELECT 'leftover_temp_table' AS check_name, COUNT(*) AS value
  FROM sqlite_master WHERE name = 'focus_insight_state__017';
