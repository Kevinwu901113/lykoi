# WO-P5-PERSISTENT-MIND

授权：本次用户明确要求按 research.md 动手，允许删除、重构，由执行者把控；轻框架、解耦、无语义防御。此指令取代历史路线排序。

基线：GitHub main a49e01b，隔离副本 wo/p5-persistent-mind。生产未核实，不修改线上状态。kernel/gate 保留。

范围：A 可恢复 Thought、持久 inbox、共享认知状态与独立计算机会；B 来源明确的 Task、事务 outbox、并行任务和前台资源；C 带来源的情境偏好、近期 Skill 方法与反馈。Surface 复用聊天和可查询实际状态。

并发重评：采纳本次报告“计算并行、关键提交有序”。每个 Thought 以自身 revision 比较后在同步 SQLite 事务内提交；每个 Task 的要求 revision 与执行上下文独立；网络调用不持有状态锁。P1 单实例进程所有权不变。此记录是 9.4/37.5 的本次设计重评，非部署批准。

保留：实例身份与历史记忆、Cordis、Task/Operation/Runner、文件 Skill、审批/预算/发送回执。新增仅 Mind 工作状态与事件；不构造新 Intent/Agent/DAG 系统。

验收：重启后续接并修正 Thought；冲突不静默覆盖；任务回流丢线恢复且去重；自主来源不提升权限；多任务可并行且取消归属正确；交付重试不执行工作；偏好保留情境和明确/推断区别；全量测试和类型检查。模型行为与真实 Telegram 送达需额外真实证据，不以模拟通过冒充。
