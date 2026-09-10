# WO-P5-PERSISTENT-MIND 实现与验收报告

基线：main a49e01b。分支：wo/p5-persistent-mind。用户本轮明确授权按附带报告重构、删除不必要代码；未修改 kernel/gate，未操作线上实例。

## 已实现

- MindStore：实例持久工作集、Thought/情境偏好、稳定事件 inbox、版本比较和原子确认。旧 open thoughts 只读迁入一次；正式实例停用旧 inner 写入口。
- Conversation/Wake：读取同一 Mind，JSON 信封直接提交内部进展。Wake 在外部额度为零时仍可纯思考，并可进行最多三个连续片段。
- Task：自主来源 + Thought 关联；按保存来源选择能力并执行；两个任务上下文可并行；Task 结果与 outbox 同事务，接收去重。重要 finding 可回流。结果独立保存，自主任务不会自动变成用户通知；用户承诺保持原交付机制。
- LLM：三个请求槽，后台最多两个，前台保留一个；保留统一调用预算与记账。
- Skill/反馈：近期方法目录渐进读取，情境偏好带 explicit/inferred 来源；下一次对话可读到纠正。未回复事实不再自动增添关系紧张。
- 清理：移除关键词忠实性与四字叙事连续性规则及其模型重试；保留叙事版本和经历出处。
- Surface：Telegram/控制台 `/mind` 直接读取真实状态，沿用 `/task` 的任务与交付视图。

设计、迁移和后续真实验收步骤见 `docs/p5-persistent-mind.md`。

## 验证结果

- 全量 `npm test`：1221 项，1210 通过，0 失败，11 跳过，0 取消。跳过项依赖未注入的 LYKOI_DEVSTATE_DB；没有把跳过记成通过。
- `npm run typecheck`：通过。
- `git diff --check`：通过。
- 评审回归 28 项通过；随后加强插件测试，让真实 Wake→Integration 接线处理旧 Thought 的 settle/archive 输出，补跑插件 3 项通过。全量通过后生产代码未变更。
- 全量日志保留于本次工作环境 `/tmp/p5-review-full.log`。初次沙箱回归因本地服务监听 EPERM 失败，随后在允许本地测试服务的环境执行上述完整回归。

新增验收覆盖：纯思考跨关闭/重开续接并读取相反证据；事件重放、冲突回滚与未见事件确认拒绝；维度独立的偏好修改；旧念头迁移不重置新理解；真实 Conversation 解析与持久提交；真实 Cordis Task + kernel 的自主权限不提升；Task→Mind 接收后崩溃的去重；并行任务取消后的迟到结果；后台占用时前台获得模型请求槽。原有进程、Runner、交付失败重试与实例隔离套件继续通过。

## 实际边界

这是已实现并通过本地机制验收的重构版本，不是 P5 全部产品行为已经验收完成。新增模型测试采用可控响应，证明上下文、状态和执行接线，不证明模型一定会自发形成有价值的思考或可迁移方法。

当前会话未提供 DEEPSEEK_API_KEY，未运行真实模型对照与 Skill 新案例泛化；未核实线上部署、Telegram 故障路径或真实用户收件。报告要求的生产体验验收仍待这些条件。代码只有本轮实现者自检，未声称独立复核 ACCEPT。

Thought 再考虑时间在正常心跳选工作集时处理；没有额外精确唤醒服务。任务与 Skill 的外部执行权限沿用已有规则，新增能力不会自动获权。未合并、未部署；回滚时必须保留新 mind.sqlite，旧代码不会读取其中的新理解。


## 首轮 REQUEST CHANGES 修订

本次以 f7b8741 为修订基线，落实三个 blocker 和 finding 重复事件问题：

- Mind 装配后在维护入口关闭旧 Thought 衰减和快照读取；Integration 关闭旧表读操作，并明确拒绝返回的 settle/archive。未再用清空快照掩盖已经发生的维护写入。
- rest/contemplate 走独立 internal reflow；rest 保留 rested 的真实调节效果，纯思考仍为零外部 action。
- Conversation 最终 system 信封与 Wake 前导 system 由同一 MIND_PROTOCOL 构造，不再展示旧 inner 输出示例。Wake 后续消息保留角色，续接的 assistant 内容不被降成 user。
- findingChanged 与需要通知的状态变化分别判断；不因旧 finding 仍在而为普通调度转换产生新 UUID 事件。

回归覆盖实际数据库 Thought 行不变、无 thought_lapse、rest 降低 load 且无 action_taken、真实插件送到 LLM 服务的 system 协议和 assistant 角色、Wake→Integration 装配后的旧写操作拒绝、finding 去重及终态通知保留。此次测试未调用真实 DeepSeek。

修订完成状态仍为实现者自检通过，等待第二轮独立验收及真实模型的自发思考、重启续接、自主 Task 样本；不标记 P5 CLOSED，不合并或部署。
