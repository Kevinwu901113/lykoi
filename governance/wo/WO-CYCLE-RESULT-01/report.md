# WO-CYCLE-RESULT-01 · 回合结果归属修复

状态：实现与本地验证完成，基线8f3ec5a，分支wo/cycle-result-01；未合并、未部署。

send锁内完成认知后还在锁外await governContext，期间下一轮可以重置共享字段。原handleTurn与ContinuationRunner等send返回后读取lastCycleOutcome/followup/delegatedAsk，会错取另一轮的结果。A4锁内只交utterances没有覆盖这三个字段。

新增onCycleResult，在认知锁内复制outcome、followup、delegatedAsk与utterances。两条生产调用路径使用该快照，审批及followup消费也在锁内完成；后续投递/登记不再取走新轮字段。保留send字符串返回、onUtterances与旧getter；对旧接口测试替身有兼容读取，真实Conversation恒走锁内快照。不改schema、prompt或调度锁，不造Task Runtime。

验证：完整npm test退出0，**1215 tests / 1204 pass / 0 fail / 11 skipped**；typecheck与diff check通过。日志cycle-result-full.log、cycle-result-typecheck.log。新增两条确定性交错：阻塞前轮锁外governContext、让后轮完成，再放行前轮；验证前轮登记原承诺，continuation收账不取走新用户轮承诺。既有审批链验证消费后载荷为空，续跑终局/TTL/启动恢复/分段交付测试仍通过。

触及manifest域：converse的conversation.ts、index.ts、continuation.ts三个源文件；需整批重签。没有新的迁移或生产动作。真实owner收到续跑结果仍须部署后的outbox/设备实收证据，不能用completed替代delivered。
