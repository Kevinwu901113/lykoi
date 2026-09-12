# WO-DEFERRED-COMPLETION

2026-09-12 所有者明确授权自行设计、实现并连续推完旧 defer，要求简洁、复用、轻框架及 Cordis 插件式装配。基线 `9939f03`，承接 Panel 和 Persona v2，分支 `wo/deferred-completion`。

范围：第三方 JSON/PNG 角色卡转换；基于现有 Mind 的 Learned Self 与有截止时间的 Relationship Moment；真实图片输入及既有视觉模型接线修正；不同 Instance 的进程并行和同实例写入锁；生产 Panel、Workspace、Pi、附件存储的装配和升级材料。继续保持 Runtime/器官/模型的职责边界。

不为清账新增 Resolver、Forge、DAG、自动 Skill 晋升或角色间调度器。这些不是完成本批用户路径的必要依赖。生产动作受实际 SSH/root 权限约束，源码/装配完成不能记作部署完成。

验证：角色卡原文与源文件保留、真实实例冻结恢复；Mind 的持久化/过期/共享认知；真实 HTTP 图片输入到 typed image 与附件存储；并行真实进程记忆和审计隔离、重复启动拒绝；全量测试、类型检查、浏览器检查及远程 CI。不得以合成模型结果声称生产人格或真实视觉模型已验收。
