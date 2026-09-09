# WO-RUNTIME-SERVICES-01 — P0-B/C 首个结构批次

P0-A 已按用户授权合并并推送 main@5464f5d。本批基于该提交，分支 `wo/runtime-services-01`；未合并、未部署，不代表 P0 全部结束。

## 实现

- 新增 `lykoi-contracts` 与 `lykoi-runtime`。Runtime 按 Cordis scope 持有能力 handler、BodySchema 和只读实时目录；注册/卸载统一返回一个 disposer，旧 handler 引用在卸载后拒绝执行。
- 删除 Telegram 的 module-global capability registry；Telegram 与 Browser 各自注册自身动作并随 fiber 退出注销。Browser 不再 import Telegram，不再代建 BodySchema。
- Converse/Wake 使用实时资源和能力集合；已有对话与缓存随 revision/注册变化刷新。Wake 的外部候选只来自当前注册动作，内部认知不受器官装卸影响。
- Runtime 通过 Cordis service injection 装配；删除 YAML 中“Browser 必须先加载”的规则及对应旧测试。消费者先加载、服务后提供、器官重载、isolate 同名注册均有执行测试。
- kernel 仅提取共享类型、增加 BodySchema 实例遥测参数；审批、策略、dispatch 审计门与 path guard 语义未改。生产 BodySchema 遥测由所属 Runtime 的 Cordis logger 记录，避免依赖 kernel 的全局遥测 sink。
- P0-A 四份机器输出/一次性脚本退出 Git（原提交 `57ada64` 仍可追溯）；433 行原文移至 archive。路线标为可调整的规划。

## 验证

Node v26.4.0，`npm test`：1,235 tests，1,224 pass，0 fail，11 skip，0 cancelled；退出 0。`npm run typecheck` 与 `git diff --check` 通过。新增 Runtime 8 项、已有 Conversation 能力刷新 1 项、实际 Browser 插件生命周期 1 项；替换/删除过时装配约束。

Browser 验证通过真实本地 Unix socket 宿主、受控 browser driver 和 kernel dispatch，覆盖注册、调用、卸载、失效、重载及审计；不等同真实 Chrome/生产 Telegram 验收。11 个 skip 是既有私有 devstate 夹具缺席。机器日志留在本地临时目录，不进入 Git。复核为源码 diff 与行为测试，未使用独立 Reviewer Agent。

## 剩余边界

这是 P0-B/C 的首批结构收益。Telegram transport、persona、kernel 其他单例及 Converse/Wake 的其他跨插件实现依赖仍在；未证明整应用多实例安全。BodySchema 验证类仍在 kernel；动作词汇仍受 `KNOWN_ACTION_LIST` 约束，任意新动作/Forge 留待能力系统阶段。卸载撤销后续调用，不取消已经执行中的外部副作用。Concern Floor、failure→silence、Regulation hard-prune、provider workaround 与迁移不变量退休留待 P0-D/E；源码其余历史注释仍需继续清理。
