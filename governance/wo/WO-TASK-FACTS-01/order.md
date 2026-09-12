# WO-TASK-FACTS-01

所有者 2026-09-12 授权：修复 Task 最新事实进入认知的结构问题；完成后直接合并，提供部署通知；部署后再做 Telegram 复测。

基线 origin/main e466554（已含 PR13）；只读生产 HEAD 9bb57eb、active/running、NRestarts=0。生产部署由所有者执行。

范围：统一 Task 认知投影，区分原始目标、最新要求、待发正文、执行结果及实际投递；覆盖 Conversation、Wake、后台 Task、查询工具和 Mind 事件。保留原始请求和旧任务时间来源；后台原始请求正文不作为新指令。保持执行、取消、审批、状态存储与定时原文语义。

不改 Kernel/Gate/生产 profile，不新增数据库、队列、语义决策框架。不复活历史测试任务。验收包括真实 Conversation 输入、真实 Cordis 后台输入及定时 Runtime 的送达/失败/未知状态。
