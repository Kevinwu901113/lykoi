-- WO-CONTINUATION-01 · 018 的逆迁移梯子（mind_schema 18 → 17）
--
-- 用途：只在需要把躯体回滚到 EXPECTED_MIND_SCHEMA_VERSION=17 的旧体时施加。
-- 施加口令（同样是停机窗内）：
--     sqlite3 -bail /home/lykoi/state/memory.db < 018_pending_continuations.down.sql
--
-- **只撤版本行，不删表、不删行**：
--   ① 她答应过的事是她的账，不销毁；
--   ② 旧体（17）不读这张表，留着对它不可见、无害；
--   ③ 重新前滚时表已存在，重放 up 的 ② 会撞 `table pending_continuations already
--      exists`。**前滚请只重放 up 的 ① 那一句**（版本行）：
--     INSERT INTO mind_schema (version, applied_at)
--     VALUES (18, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--
-- 幂等：DELETE 无匹配行即 0 行受影响，重跑零副作用。

BEGIN IMMEDIATE;
DELETE FROM mind_schema WHERE version = 18;
COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'pending_continuations_rows' AS check_name, COUNT(*) AS value FROM pending_continuations;
