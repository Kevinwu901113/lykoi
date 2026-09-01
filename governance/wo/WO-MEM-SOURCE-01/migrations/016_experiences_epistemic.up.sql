-- WO-MEM-SOURCE-01 · mind_schema 15 → 16：experiences 的认识论第二轴 epistemic
--
-- 正本：governance/docs/persona_layering_design_v1_2026-09-01.md §3.1（D-PERS-1）。
-- 目标库：/home/lykoi/state/memory.db（**只在治理侧人工施加**；本文件入库交付，
-- 工单执行侧从未对任何真实 db 运行过它）。
--
-- 施加口令（-bail 是幂等语义的一部分，见下）：
--     systemctl disable --now lykoi-cordis-watchdog.timer
--     systemctl disable --now lykoi-cordis.service
--     tar -C /home/lykoi -czf backup-$(date +%Y%m%dT%H%M%S).tar.gz state
--     sqlite3 -bail /home/lykoi/state/memory.db < 016_experiences_epistemic.up.sql
--     systemctl enable --now lykoi-cordis.service
--
-- 停机是硬要求：新体（EXPECTED_MIND_SCHEMA_VERSION=16）与旧体（=15）都按
-- `MAX(version) 必须恰等于我认识的那个值`拒开，版本行一落，旧体下次开库即拒。
-- 顺序只能是 停 → 备份 → 迁移 → 起新体。
--
-- 幂等（"重跑零副作用"的落法）：整段在一个事务里，第一句就是版本行的
-- **无 OR IGNORE** INSERT。重跑时它撞 mind_schema 的主键 → 报
-- `UNIQUE constraint failed: mind_schema.version` → -bail 立即中止 → 事务从未
-- COMMIT → 库逐字节不变。SQLite 没有条件 DDL（`ADD COLUMN IF NOT EXISTS` 不
-- 存在），所以幂等取的是这个强形式：**要么整段生效，要么什么都没发生**，绝不
-- 存在加了列没回填、或回填两遍的中间态。
--
-- 回滚：016_experiences_epistemic.down.sql（只撤版本行，不删列、不清值——她的
-- 数据不销毁）。

BEGIN IMMEDIATE;

-- ① 版本行 = 幂等守卫 + 台账。applied_at 用迁移机口径
--    （strftime('%Y-%m-%dT%H:%M:%fZ')：毫秒 + Z 后缀，migrations.py:1148 逐字；
--    与业务行的 isoformat()「+00:00」口径不同，见 C-12，不要混用）。
INSERT INTO mind_schema (version, applied_at)
VALUES (16, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ② 第二轴列。渠道轴 experiences.source 的八值 CHECK 与既有列**一个字都不动**
--    （STATE-CONTRACT §1.2）；本列与它正交。
--    NULL 合法，含义唯一：本次回填之前写下的旧行未回填。ADD COLUMN 只能加在表尾，
--    夹具 STATE_FIXTURE_DDL 的列位与 CHECK 文本与此逐字对齐。
ALTER TABLE experiences ADD COLUMN epistemic TEXT
    CHECK (epistemic IS NULL OR epistemic IN
           ('observed','executed','user_reported','inferred','imagined','simulated'));

-- ③ 存量回填：**渠道级**，逐字按设计稿 §3.1 映射表。
--    不做内容级重分类（内容级 = 变相编造，违设计稿 §2.4）：存量 conversation 行
--    没有留下消息方向，因此一律取该渠道的默认 user_reported —— 与写路径
--    deriveEpistemic('conversation') 缺方向时同一口径，不去猜哪句是她说的。
--    没有任何一行会被回填成 imagined/simulated：虚构地位只能由写入方显式声明。
--    WHERE epistemic IS NULL 让本句对已回填行天然免疫（新体写下的行也不会被改）。
UPDATE experiences
   SET epistemic = CASE source
       WHEN 'wake_action'   THEN 'executed'
       WHEN 'action_result' THEN 'executed'
       WHEN 'owner_event'   THEN 'user_reported'
       WHEN 'silence'       THEN 'observed'
       WHEN 'environment'   THEN 'observed'
       WHEN 'system'        THEN 'observed'
       WHEN 'thought_lapse' THEN 'inferred'
       WHEN 'conversation'  THEN 'user_reported'
   END
 WHERE epistemic IS NULL;

COMMIT;

-- ④ 施加回执（只出计数，不出任何行内容 —— 她的经验不进运维终端）。
SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'experiences_by_epistemic' AS check_name,
       COALESCE(epistemic, '(null)') AS value, COUNT(*) AS rows
  FROM experiences GROUP BY epistemic ORDER BY epistemic;
SELECT 'unbackfilled_rows' AS check_name, COUNT(*) AS value
  FROM experiences WHERE epistemic IS NULL;
