# 合并包 6 · 2026-08-12 · U0 传输层加固【草稿·待全量终审后定稿】

> 状态:草稿。全量串行 pytest 在跑;绿了我定稿并打 bundle。

修复:①sendMessage 网络故障重试(退避 2/5/15/30s,至多 4 次;确定失败/歧义
分类只用于记录,取舍=丢话之害>偶发重复之害);②未送达账本
(`~/state/telegram_undelivered.json`,有界 200 条)——出站消息结局二选一:
有 message_id 或在账本里,无第三种;③chat_reply 送达回执
(`chat_reply_delivered`)/未送达补记;④getUpdates 错误连击聚档+恢复事件
(只动日志不动节奏)。全部收口在传输层,S3/L5/自主发言同惠。

无迁移。合并 → 属主(resources 归 lykoi)→ 重签(107 不变,两条哈希)→
GATE_OK → 测试(telegram/messenger 三件套 + p0)→ 重启五服务。

实弹验收:合并后正常聊几句即可;之后任何一次网络抖动,事件流里应见
`telegram_send_retry`(而不是静默丢件),连续抖动的 getUpdates 噪声降为
首条+每十条+恢复一条。

(命令区待终审后填,结构同包 5。)
