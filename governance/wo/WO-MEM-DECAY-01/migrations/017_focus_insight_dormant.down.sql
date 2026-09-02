-- WO-MEM-DECAY-01 · 017 的逆迁移梯子（mind_schema 17 → 16）
--
-- 用途：只在需要把躯体回滚到 EXPECTED_MIND_SCHEMA_VERSION=16 的旧体时施加。
-- 施加口令（同样是停机窗内）：
--     sqlite3 -bail /home/lykoi/state/memory.db < 017_focus_insight_dormant.down.sql
--
-- **只撤版本行，不回退 CHECK、不删 dormant 行**：
--   ① 她的数据不销毁 —— 一条 dormant 结论是"她想过、久未再想"的账，不是垃圾；
--   ② 旧体（16）的读侧全部**按状态名取数**（promotedFocusInsights = active，
--      existingConclusions 列举状态名），六态表里的 dormant 行对它天然不可见，
--      既不会漏进装配也不会让它报错，所以留着是安全的；
--   ③ 反向重建表（六态 → 五态）会在存在 dormant 行时撞 CHECK 而失败，而"为了
--      降版本把她的行改成别的状态"是伪造 —— 这条路不走。
--
-- 重新前滚：表已经是六态了，重放 up 的 ② 会撞 `table focus_insight_state__017
-- already exists`（若上次残留）或建出一张与现表同构的多余表。**前滚请只重放 up 的
-- ① 那一句**（版本行），不要重放 ②③④⑤：
--     INSERT INTO mind_schema (version, applied_at)
--     VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--
-- 幂等：DELETE 无匹配行即 0 行受影响，重跑零副作用。

BEGIN IMMEDIATE;
DELETE FROM mind_schema WHERE version = 17;
COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'focus_insight_state_rows' AS check_name, COUNT(*) AS value FROM focus_insight_state;
