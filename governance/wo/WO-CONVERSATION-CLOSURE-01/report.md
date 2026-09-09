# WO-CONVERSATION-CLOSURE-01 修复与复核报告

基线：main ca84f18（运行时代码同部署 2e152f2）。分支：wo/conversation-closure-01。授权：Kevin 2026-09-09 按诊断报告做结构修复。

## 原因与改动

### 1. 服务生命周期没有成为接线的正本

原实现只在 converse.apply 同步查询一次 messenger；晚注册时永久漏接，而普通回复又能走裸 send，掩盖了器官未接线。

改为 ctx.inject(['messenger']) 的 scoped effect：依赖出现时接线，消失时清除原适配器引用并等待旧 outbox 消费结束，再允许生命周期重建。器官关闭后不再接受新消费。真实插件装配测试覆盖 converse 先启动、Telegram 晚到、设备重启、旧引用解除和新引用接线。

handleTurn 在审批路由前检查出站就绪，未接线统一报 outbound_unavailable；不把审批应答误送进认知。普通模型回复不再 fallback 到裸 send，继续经 OutboundOrgan → kernel.dispatch。系统失败回执沿既有确定性回执通道。未接线的 outbox 消费不再静默返回，而是留下 consume_error。

### 2. CycleOutcome 投影丢失了失败来源

新增受类型约束的 suppressed 周期出口，携带 originalKind 与 reason；主动 silence 不变。cycleFailure 是 turn 与 continuation 共用的认知失败投影。框架降级变成 failed/decision_suppressed 及系统回执，不再误记 intentional_silence。

grounding 判定代码不变。只修正信封提示词中“tool_call 受引用门降级”的陈旧描述，明确现行 tool_call 豁免及 reply/promise 的抑制后果。未通过放宽引用门来提高表面回复率。

### 3. continuation 将入队当作完成

保留既有持久 chat_outbox 和游标，不增加 Task Runtime、数据库迁移或第二张副作用表。OutboundOrgan 增加串行消费入口，轮询与 deliverFollowup 共用同一把锁。先初始化历史游标、再持久入队、再消费至该条并返回实际投递结果，避免首启将新消息当历史跳过或两个消费者重复发送。

continuation 就绪前不认领 pending；设备接线后 kick 与原 cheapTick 均可继续扫描。认知仍用同一 Conversation 锁。投递等待期间保持 running；逐条发送，失败即停。全部投递成功才 completed；silence/null → failed/no_result，再次承诺 → failed/chained_request，审批未决 → failed/approval_pending。失败与过期有系统回执；回执返回 sent=false 也会记录 notice_failed。CAS 未成功不重复写终局。

无 owner 绑定时不先入队，避免“已宣布失败的消息”在稍后意外送出。

completed 的边界是：续跑返回正常 reply 且输出交付成功。框架不据此声称任意自然语言目标已被独立验证。需要审批的操作仍留在原审批体系；本单不创造审批后任务恢复引擎。

## 验证

- 真实 Cordis + converse + Telegram 插件装配：迟到与重建依赖。
- 真实 runCycle：grounding 降级保留来源；正常 silence 仍合法。
- handleTurn：抑制终局及系统回执、未接线不启动认知也不裸发模型回复。
- outbox：持久化先于发送、轮询与跟进竞争只发一次、等待实际回执、无绑定不入队、关闭后拒绝消费。
- continuation：等待投递时无 terminal；投递失败为 failed；第二条失败不发第三条；未就绪保持 pending；旧有审批、修订、顺序分段测试回归。
- 精确测试结果在下方验证记录中补充。

沙箱中的全量运行曾因本机端口 listen EPERM 失败；获准在沙箱外执行同一套本地测试。未以禁用测试或改生产环境消除失败。

## 提示词变更记录

仅修改 grounding 说明段。raw：1788字符/dee3cff2… → 1806字符/3ef1e8f789b5588ab583591bbcc356bae892f9f95a4b58b2f39286f9f772e18b。
默认渲染：3056字符/487ea1c77c2713ffddf55ed8d56cc566a008f7281875866103f1063f647316a2。
保留反向还原历史 raw 的测试，证明其余契约段不变。部署后稳定前缀缓存会自然失效一次。

## 交付与边界

未修改 kernel/gate、profile、人格、生产状态、游标或 schema；未合并、部署或向 Telegram 追加测试消息。需要后续授权合并与部署后，真实验收降级回执、续跑送达和审批入口。旧生产 outbox53 没有在本单手动补发或推进游标。

outbox 原有“发送后、游标落盘前崩溃可能重复”的语义保留；running 在重启时按 interrupted 失败收账，不重跑认知。E3 仍经过原审批/预算策略，限额拒绝会如实导致投递失败，本单不放宽政策。

## 最终验证记录（2026-09-09）

- `npm test`：退出0；1226 tests，1215 pass，0 fail，11 skipped，0 cancelled。包含本地真实 HTTP/SSE 与 Chrome smoke，零生产调用。
- `npm run typecheck`：退出0。
- `git diff --check`：退出0。
- 最终日志：本机 `/tmp/closure-final-suite.log`；未将临时完整测试日志或任何生产材料入库。
- 本次为主治理 Agent 自执行并复核；没有宣称其他 Agent 做过独立审查。
