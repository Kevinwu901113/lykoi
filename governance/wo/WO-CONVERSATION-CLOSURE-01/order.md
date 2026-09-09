# WO-CONVERSATION-CLOSURE-01

授权：Kevin 2026-09-09 按诊断报告修复，要求从代码结构解决。基线 main ca84f18；分支 wo/conversation-closure-01。

目标：闭合认知结果、出站服务生命周期及 continuation 投递结果三条边界。

1. 出站接线使用 Cordis scoped dependency lifecycle；设备晚注册/替换/卸载均不遗留假接线。普通回复不得在未接线时绕过 OutboundOrgan/dispatch。
2. CycleOutcome 保留框架抑制原因；共享失败投影供 turn 与 continuation 使用。主动 silence 仍合法；grounding 规则不放宽。
3. continuation 保留现有持久 outbox，由唯一串行消费者返回投递结果；收到结果前不 completed。silence、再次跟进、审批未决都不代表本次承诺完成，终止为 failed 并确定性回执，不创建 Task Runtime/自动重跑。
4. 验证迟到服务、卸载与重接、入队与消费竞争、失败不继续后续 utterances、抑制回执、续跑未决与投递失败。typecheck 与全量测试通过。

边界：不改 kernel/gate、认知单写者、生产代码/状态/游标，不合并或部署。工单授权覆盖上述对旧 continuation 完成口径的修正。结果只表示续跑成功返回且所需输出已交付，不用框架推断任意目标是否语义完成。
