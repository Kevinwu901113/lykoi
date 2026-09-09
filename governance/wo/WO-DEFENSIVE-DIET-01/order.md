# WO-DEFENSIVE-DIET-01 — P0-D

状态：主体评审通过，修订审批双层 retry 与残留语义；用户授权验证后合并。基线 main@8b81c80；用户授权先合并 Runtime 批次，再做防御减法，不扩 Runtime 功能。

范围：退休 Concern Floor；移除 Regulation 对候选的行为裁剪与附加预算折扣；将无效决策与主动 rest/silence 分开；JSON 修复/重试由 LLM 服务承担；清理相关迁移注释、等价性与旧行为约束。权限/实际预算、引用 ID、数据连续性与外部副作用边界保留。现存关切不删除，不修改 kernel/gate，不部署。

验证：零关切可整合经历并维持叙事；低 coherence/高 load 仍能选择有能力且有预算的动作；无效选择失败而非合成安静动作；provider 恢复有界、逐次记账、取消后不重试、认知/工具副作用不重放；全量测试、typecheck。机器产物留临时目录，本单只维护短文档。
