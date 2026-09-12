# WO-PANEL-01 · 实现与验证

基线：main `9bb57eb`。分支：`wo/panel-01`。2026-09-12。

已实现可运行的 `lykoi-panel` Cordis 插件：概览、对话、任务、Mind、方法库和动态能力/器官。HTTP 随插件挂载/卸载，静态前端无构建依赖。没有第二套状态库、业务调度器或任意工具调用入口。Skill 仅补原 Store 的 list/read 只读服务，Converse 补持久历史及所有者回合入口。Task 写操作复用带审计的 command。

`npm run panel` 使用独立合成实例，经现有 Instance supervisor 和锁启动；默认固定测试模型，不触及生产状态、凭据或模型。正式实例通过配置加载同一插件，不复制运行时。生产 profile 未开启 Panel。CURRENT_VERSION 仅修正已核实的 PR #10 合并事实，未推定生产升级。

## 验证结果

- 最终全量 `npm test`：1,257 项，1,246 通过、0 失败、11 跳过。跳过是原有需要外部 devstate 的测试。`npm run typecheck` 和 `git diff --check` 通过。
- 新 HTTP/Cordis 集成测试使用真实 Loader、Instance、Converse、Mind、Task、Skill、Heart 和持久文件：消息原文/历史/Mind 同源；任务创建、暂停、多行要求更新、取消；Skill 正文等于其原文件；能力动态注册/退役；Skill 卸载显示缺席；Panel 卸载释放端口，同端口重载保留状态。
- HTTP 边界覆盖跨站 Origin/Fetch Metadata、非法 Host、错误 JSON、错误内容类型、空输入、超大正文、未知写操作和分页边界。没有使用这些验证替代模型验收。
- 审批反例：模型提出需要审批的 terminal.exec，真实 Kernel 阻止执行；无绑定审批通道时 `approvalStatus=unavailable`，不冒称问句已发出；测试 handler 未执行。
- 原生浏览器实际发送多行消息，包含 HTML 标签的正文保持纯文本；界面创建 Task、暂停、修改多行要求；停止并重启独立 worker 后历史与暂停/修改状态保留。最终版本再次发送回合成功。390px 窄屏实际 clientWidth/scrollWidth 均为 390，浏览器错误日志为空。

初次 HTTP 测试被沙箱 `listen EPERM` 阻止，获得本机监听权限后通过。编写审批反例时原地修改 Loader 配置没有触发模型重载；改为不可变更新后反例通过。两者不算最终通过样本。

## 代码复核

本次由实现者逐项复核，未冒称独立 Agent 评审。修正了三个实际问题：轮询重复重建列表导致焦点丢失；模态框内操作错误应在框内可见；Converse 的 ask_pending 只表示需要审批，必须经已有 ApprovalConversation 的实际返回才能显示“审批已建立”。整个所有者回合含审批接线纳入现有 Runtime 排空范围。

Panel 的信任边界是本机所有者控制台，固定监听 127.0.0.1。它不是公网、多用户或完整新 IM 通道；没有登录系统，不应暴露到公网。Task 成果在界面可读不改变 delivery 状态；异步推送和交互式审批答复仍走既有通道。此批机制验证使用固定模型，不代表生产部署或真实模型效果验收。

详细配置与接口见 [docs/panel.md](../../../docs/panel.md)。后续按既定顺序推进 Character Package/Persona、人格接线、生产执行能力、多模态与多实例，本单不将这些标记完成。
