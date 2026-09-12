# WO-PERSONA-02 验收记录

实现 Persona v2，旧 Persona TOML 兼容。新增逻辑集中于已有 `lykoi-decide` 人格边界；没有新依赖、插件服务、数据库或 Runtime/Gate 改动。Converse、Wake、Task 继续共用加载及渲染函数。

验证：全量 `npm test` 1261 项，1250 通过、0 失败、11 项已有外部 devstate 跳过。收尾将解析函数归回同一模块并严格拒绝可选字段显式 null 后，相关 Decide/Instance 测试 101/101 通过；`npm run typecheck` 与 `git diff --check` 通过。

新增用例验证最小定义不编造性格/关系/兴趣、多行内容和示例保留、未知字段/版本拒绝，以及真实 Instance 创建与恢复、冻结定义不随源文件变动、兴趣仅初始化一次、情境不进入记忆。现有 Cordis 装配测试包含在全量验证内；未声称真实模型对新人格的行为验收。

本批完成原生 schema 泛化。第三方 JSON/PNG 导入、世界书/宏适配、后天人格回路和生产切换尚未完成，不将它们计入本批。此分支叠在 Panel 提交上；Panel 尚未合并，生产未修改。
