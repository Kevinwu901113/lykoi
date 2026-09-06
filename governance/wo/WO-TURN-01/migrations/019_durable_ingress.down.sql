-- WO-TURN-01 · 019 的逆迁移梯子（mind_schema 19 → 18）
--
-- 只撤版本行，不删除 inbound_parts / user_turns，也不删除其中消息：旧体不读这
-- 两张表；保留它们才能确保回滚身体不等于丢弃已经接收的外界输入。
-- 重新前滚时沿用既有迁移纪律：只补 up 文件中的版本 INSERT；物理表与索引留存。

BEGIN IMMEDIATE;
DELETE FROM mind_schema WHERE version = 19;
COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'inbound_parts_rows' AS check_name, COUNT(*) AS value FROM inbound_parts;
SELECT 'user_turns_rows' AS check_name, COUNT(*) AS value FROM user_turns;
