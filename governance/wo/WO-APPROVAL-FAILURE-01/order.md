# WO-APPROVAL-FAILURE-01

2026-09-12 所有者明确授权修复自然批准失效；本单涉及 Kernel 审批核心，须独立治理复核。
基线 d573956。两次生产 LlmJsonError 被映射 unclear，第二次触发标准动作澄清上限 deny，关闭请求并记录拒绝。实际没有成功的用户拒绝判读。

范围：区分技术 unavailable 与语义 unclear/approve/deny；故障不执行、不授权、不计澄清轮次、不记拒绝，保留原 pending 并如实回执。补 workspace.write 操作摘要；审批独立使用 off reasoning，保持400输出上限与既有有界JSON恢复；增加不含正文的JSON失败诊断。

不新增自动授权、重放、周期重试、绕过审批或变更生产状态。不把改参批准重新设计纳入本单。真实用户已拒绝/过期的旧请求不恢复。部署和新Telegram验收分别记录。
