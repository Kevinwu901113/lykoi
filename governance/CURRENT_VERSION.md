# 当前版本结论 · 2026-09-13

核心工程已落地，真实用户体验仍在收尾。合并、部署和体验验收分别记账；旧报告只代表当时结果。

## 已部署版本

所有者最新部署回执为 `5321b3fb7db1b552071ba27e37d42986a398570a`（PR #17）。Gate 校验通过，实例状态保留，Cordis/Browser active/running、NRestarts=0。连续部署已包含 PR #13 Panel/Workspace/Pi、#14 Task facts、#15 审批技术失败处理、#16 文件发送与 #17 代理 multipart 修复。固定 Pi 0.85.1 已供给；不能再沿用旧账中的“生产没有文件工具/Pi”。这些是部署时证据，不是持续健康承诺。

减负与解耦、Character Instance、共享 Cognition、Task/Pi、Skill 和持续 Mind 的工程报告分别见 [减负](wo/WO-RUNTIME-SLIMDOWN-01/report.md)、[P1](../docs/p1-instance.md)、[P2](../docs/p2-cognition.md)、[P3](../docs/p3-tasks.md)、[P4](wo/WO-P4-SKILL-01/report.md)、[P5](wo/WO-P5-PERSISTENT-MIND/structural-review.md)。工程通过不代表长期使用质量已经证明。

## 本轮真实 Telegram 验收

仅使用新建的合成测试任务；不恢复历史取消任务。聊天、审计及生产状态的具体 ID 和原件留在治理本机，不入 Git。

| 用户路径 | 实际结果 |
| --- | --- |
| 文件生成、批准导出、收到附件、下载 | **通过本样本。** 所有者下载的 Markdown 为 79 字节，内容及 SHA256 与服务器源文件完全一致。原代理 HTTP 400 已由 #17 修复。 |
| 等待提醒时继续聊天 | **通过本样本。** 新提醒登记后同回合正确回答 17+25=42。 |
| 只修改提醒正文 | **通过本样本。** 同一 Task revision 增加，正文更新，dueAt 精确不变。 |
| 暂停提醒 | **通过本样本。** 实际状态 paused。 |
| 恢复提醒 | **失败，修复待部署验收。** 问句只有 task.control 和参数字段名，没有“恢复”；自然批准被判 unclear，提醒未恢复。 |
| 取消提醒 | **通过本样本，但有残留问题。** 原到期时间之后仍 cancelled、delivery=null；旧恢复审批没有同步退休。 |
| 批准同时修改文件内容 | **失败，修复待部署验收。** 旧 gate 将 conditional 当作执行一次，先写入旧内容；后续重写才正确，不能算通过。 |
| 编写并执行程序、Task/Pi 复杂成果 | **阻塞。** 已提出合成数据去重命令，但多条待审批导致自然指向未命中，命令未执行，文件未生成；不算 Task/Pi 验收通过。 |
| 重启连续性 | 多次所有者部署通过实例/Task/Mind/Skill 连续性脚本；仍不等于所有在途作业故障恢复场景均已验证。 |

## 本次候选修复

[WO-CORE-UX-CLOSEOUT-01](wo/WO-CORE-UX-CLOSEOUT-01/order.md) 将带修改条件的答复返回为 revision_requested，退休旧审批、不执行旧参数、不发放授权也不记拒绝；原始修改要求交回现有 Cognition。Task 操作同步使用现有 revision 事务使旧操作失效，保留暂停状态，新操作仍需确认。任务终结时清理它的旧控制审批；文件及任务确认描述改为可理解的动作，减少重复技术回执。

本地 typecheck 通过；全量 1,282 项，1,271 通过、0 失败、11 跳过。独立治理复核及交付记录见本工单报告。候选修复尚需所有者 root 部署和新一轮自然对话验收，不能提前标记线上通过。

## 仍然明确保留的边界

- Panel/多实例已有真实进程与接线测试；尚未完成全部生产界面体验验收。
- 视觉模型供给未确认，生产 vision disabled；Telegram 图片输入、音频/视频、世界书语义未实现。详细状态见 [补齐总账](../docs/deferred-completion.md)。
- 长期人格一致性、Skill 泛化与 Mind 同预算效果需要日常使用证据，不能用短时冒烟测试判定成熟。
- Resolver、Forge、DAG、自动 Skill 晋升和角色间编排仍冻结；本轮不另造执行框架。
