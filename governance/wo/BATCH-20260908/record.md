# BATCH-20260908 · 落地记录

状态：生产部署与启动验收完成，真实交互及实验验收仍待样本。

## 所有者 root 回执

- 目标 HEAD：2e152f2650d17ca34b74efbed4c0e10ccce6be7a；旧 HEAD：257a72ec1f0e09e69fd28f6234ca9266996757e5。
- 部署包、部署/回滚稿与校验表均通过 SHA256 检查。
- 一致备份：`/root/landing-batch-20260908-20260908T123006/backup.tar.gz`。
- 备份 SHA256：`c7b5269498e808ee836b0f1b77dd02e64e6775606c37e224b2465ca9bc71f224`（所有者回执，本地账户不能读取 root 备份）。
- npm ci 44 packages；代理就地提取与实例解析通过；没有创建记忆种子。
- manifest 129，gate OK；browser health OK；schema18，spool2。
- 两服务 active/running、NRestarts0；脚本部署窗口28秒（包含停写、备份、安装和验证，不当作精确用户感知停机时间）。
- 日志：`/root/landing-batch-20260908-20260908T123006/deploy.log`。

## 本轮独立只读复核

经已有 SSH 通道检查：生产 HEAD 与上述目标完全相同，工作树净；brain/browser均active/running、NRestarts0；watchdog/backup timers均active；manifest实际129行，服务账户运行gate得到OK。

认知库mind_schema18、journal_mode=delete；continuations仍为completed2。新spool user_version2、integrity_check=ok；user_turns分组查询无行，尚无新真实入站样本。

## 未完成项

真实入站合并、审批消费、revision/排队、utterances逐字实收、continuation终局与outbox送达仍需新样本；旧completed2不算新版本验收。C1末项两条、C2委托对照/tax、Recall实验保持pending。E2/37.5不解锁。
