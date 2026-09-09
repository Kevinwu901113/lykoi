# WO-DEFENSIVE-DIET-01

Runtime 批次已按用户授权合并并推送 `main@8b81c80`。本批位于 `wo/defensive-diet-01`，未合并、未部署；没有扩充 Runtime 功能。

删除 Concern Floor、Regulation 候选硬裁剪与半额预算、rest/silence 降级及其元数据；预算耗尽改记 `budget_exhausted`。模型可自由表达理由，不因未逐字复制评估文本被改写选择；引用 ID 域仍验证。不可用动作保留 capability_gap 并结束为 failed，显式 rest/silence 仍是合法选择。

Converse/Wake 不再自己修 JSON、追加 nudge 或重试。统一由 LLM 服务处理请求了 JSON 的调用：最多三次，每次单独过门记账；恢复只限语法和 EMPTY_RESPONSE，不重复业务操作。删掉对话层旧环境开关与重试事件常量。真实 provider HTTP/wire 适配仍复用现有 vendor；本单没有修改供应商实现。

验证（Node v26.4.0）：全量 `npm test` 1,202 tests：1,191 pass / 0 fail / 11 skip / 0 cancelled；typecheck 与 diff whitespace 检查通过。最后预算结果命名调整后追加 Wake 全包 34/34 通过。11 个 skip 仍为私有 devstate 夹具缺席。

关键验收：零关切可消化经历、创建叙事线并更新叙事而不造关切；高 load/低 coherence 保留可用动作且真实预算仍裁剪；无效选择记 failed 而非 rest；provider 预算拒绝/取消/不可恢复错误停止重试；真实 Conversation 经 LLM 服务恢复工具之后的坏 JSON，派发恰一次，临时 nudge 不进入下一回合；投递系统失败回执和显式 silence 分账。原有权限门、状态与外发测试继续通过。

旧 Floor 与迁移/旧防御行为测试退休或改写，repair 测试移至 LLM 包，新增 provider、取消/记账、Conversation 不重放、零关切整合等测试；测试净少 33 项，不靠修改旧 SHA 继续锁定历史实现。保留原文的依据是 Git 基线，不复制一批治理材料。临时机器日志不入 Git。

复核为当前源码 diff 与行为/集成测试，未使用独立 Reviewer Agent。尚未进行真实模型、生产 Telegram 或活数据验收；剩余全局解耦、全仓防御逐项审查与 P0-E 不在本批完成声明中。详见短清单 inventory.md。
