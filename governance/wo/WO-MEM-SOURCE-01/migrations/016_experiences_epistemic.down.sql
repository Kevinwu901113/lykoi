-- WO-MEM-SOURCE-01 · 016 的逆迁移梯子（mind_schema 16 → 15）
--
-- 用途：只在需要把躯体回滚到 EXPECTED_MIND_SCHEMA_VERSION=15 的旧体时施加。
-- 施加口令（同样是停机窗内）：
--     sqlite3 -bail /home/lykoi/state/memory.db < 016_experiences_epistemic.down.sql
--
-- **只撤版本行，不删列、不清值**：
--   ① 她的数据不销毁 —— 回填出来的第二轴是账，不是垃圾；
--   ② 旧体（15）的读写 SQL 全部按列名显式取数/写入，表尾多一个它不认识的
--      可空列不影响它工作，所以留着是安全的；
--   ③ 重新前滚时 up 脚本的 ALTER 会撞 duplicate column —— 前滚请只重放 up 的
--      ① ③ 两句（版本行 + 回填），不要重放 ②。
--
-- 幂等：DELETE 无匹配行即 0 行受影响，重跑零副作用。

BEGIN IMMEDIATE;
DELETE FROM mind_schema WHERE version = 16;
COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
