# WO-FOLLOWUP-DELIVERY-01 — 后台跟进送达修复

基线 origin/main d98d426；隔离分支 wo/followup-delivery-01。Kevin 授权结构诊断与修复。本次未合并、未写生产状态、未重启服务、未向真实 Telegram 发送新消息。

## 根因与修复

生产只读记录确认：任务已经登记并在到期后运行，随后调用 messenger.read 进入审批。审批通知在 kernel 获得 E1 许可，但 messenger 资源把没有 reply_to 的消息再次判为主动消息，命中 daily_cap；Task 留在 waiting/approval，未送达。不是调度器未启动。

1. **裁定没有穿过资源边界。** ResourceHandler 增加独立的可信 admission 参数，kernel 在已有拒绝/审批判定之后，以既有 E1/E2/E3 covers 结果携带消息预算豁免，经 Runtime 传给 messenger。传输 reply_to 不再覆盖已通过的预算裁定。模型 JSON 不能构造该参数；原有 deny、E2 对端约束和普通主动额度保留。没有新增权限或豁免种类。
2. **前台与后台交接缺少执行上下文。** Conversation 自动保存原始请求及宿主接收时间，关联既有 originTurnId，随 Task 重启保留。Task 认知只接收受托目标、最新要求和精确接收时间；完整原始来话留作追溯，避免把前台“先确认”再次当成后台待办。每次认知提供当前 now，明确 completed.content 由宿主通过所有者通道另行投递。保留既有 due 调度和交付记录，没有专用提醒路由或硬编码 60 秒。
3. **审批通知失败没有进入任务状态。** 失败现在持久保存在 Task.failure 并沿用状态事件回流；既有显式 resume 可重试通知，仍需真实批准才能执行原操作。没有新增自动重试循环。

前台 promise_followup 描述同步真实机制，移除仍把它描述为“不是自动续跑”的过时说明。旧任务缺少 request 时可使用 createdAt 作为较晚的保守时间下限；更新既有任务保留最初请求来源，以最新 requirements 执行。

## 验证

- 全量 npm test：1230 项，1219 通过、0 失败、11 跳过。沙箱初跑因本地 HTTP/SSE listen EPERM 失败；允许本地测试监听后完整回归通过。
- npm run typecheck、git diff --check：通过。
- 新增真实 HTTP 资源边界测试：主动额度耗尽后 E1/E2/E3 仍送达；伪造对象、模型参数、错误 E2 对端均不绕过额度；显式 deny 优先。
- Task 时钟/重启测试：59999 ms 不执行、60000 ms 续跑、收到回执后不重复发送；审批通知失败留痕，恢复只重试通知。
- Conversation 交接测试：原文、毫秒级接收时间、turn 标识逐轮隔离，不被模型改写的 goal 覆盖；TaskStore 关闭/重开保留来源。

真实模型使用 deepseek-flash、全新合成 Instance、原始验收请求；Conversation → Task → kernel → Runtime → messenger → BotApiTransport → 本地 HTTP 接收端。先耗尽主动消息额度，使用真实 Converse 交互绑定，不替换成控制台交付。

最终样本在收到请求后 **64756 ms** 收到一条精确成功句；Task delivery=sent，工具操作 0 次，额外扫描未重复发送，主动额度账本字节不变。实际模型选择 waiting/due 后 completed，不运行命令或写成果文件。Task 自身的内部持久化沿用已有机制。

此前六次定位样本未通过：首轮拒绝登记，其后读聊天审批。补时钟和仅增加协议文字仍不够；实际 HTTP 正文证明协议未丢，最终收敛的是交接范围与原始来话证据的分离。失败样本保留在本地，没有从验收记录抹掉。

本地证据索引：/Users/wukevin/lykoi/followup-delivery-acceptance/PROGRESS.md。生产私有记录、凭据、模型诊断原文不入 Git。可复跑入口 profile/test/followup-delivery-live.ts；需显式 LYKOI_FOLLOWUP_LIVE=1 和测试用 DEEPSEEK_API_KEY，使用真实模型额度及本地监听。

## 待落地与生产验收

本报告证明代码机制与一个真实模型端到端样本，尚不代表真实 Telegram 已重新通过。合并复核须包含 kernel admission 范围；生产部署沿用已有签名/启动门流程，由有权限的一方执行。

部署后检查旧任务的 waiting/approval 状态，勿直接批准无必要的读聊天操作、勿重跑旧任务冒充新验收。旧任务如何取消或恢复需明确处置；再发一条新的单次测试请求，核对新 task、due run、delivery 回执与 Telegram 实际收到的独立消息，要求至少 60 秒且仅一次。生产状态及旧任务本次均未修改。
