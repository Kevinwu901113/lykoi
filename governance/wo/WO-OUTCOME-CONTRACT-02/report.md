# A1 正本事件与派生修订

基线821d692，分支wo/outcome-contract-02。按Kevin最新重申，旧工单不是偏离原要求的理由。

已完成：DurableIngress成为converse/turn_terminal唯一写点，event_id保持turn-terminal:<turnId>，各入站消费路径仍汇入同一持久终局。移除handleTurn里的提前converse/silence；只有intentional_silence终局成功投影后派生旧事件，带derived=true和terminal_event_id。派生失败时由未完成投影重试，recordOnce维持各自幂等。技术失败、待审批不会冒充主动沉默。

历史append-only审计不重写；旧turn/terminal仍是旧版本历史，统计跨版本时需兼容读取。旧event_id已经落账的终局重试不会为了改名再写第二条正本。新版本新增终局使用新名称。

验证：完整npm test退出0，1216 tests /1205 pass /0 fail /11 skipped；typecheck与diff check通过。ingress专项17/17，新增正本先落、派生链接、技术失败与deferred不派生的断言；原消费/恢复/去重与审批路径回归通过。日志outcome-contract-full.log、outcome-contract-typecheck.log。

未完成：status四值尚缺具体定义。现代码仍为replied/intentional_silence/deferred/consumed/failed五态，已向Kevin明确询问四值枚举与审批/建议消费的归属。不自行把已消费应答解释成认知主动沉默、等待审批或已发送回复。该单保持partial，整批PR仍为draft。

触及manifest域：ingress/index.ts和converse/index.ts；无schema/prompt变更，未合并主线、未部署。
