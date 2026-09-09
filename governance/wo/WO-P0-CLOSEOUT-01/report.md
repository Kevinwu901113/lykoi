# P0 清理收尾

本批清理迁移遗物、重复恢复及掩盖真实失败的防御逻辑。没有新增 Runtime 服务、迁移插件归属或扩展角色能力。此前 Concern Floor、Regulation hard-prune 和审批双层 JSON retry 的修复沿用 main 基线。

实际行为变化：
- 学习路径的 JSON framing/recovery 归 lykoi-llm；学习层只解析结果。
- 非法强度不再被夹成合法心理数值；数据库失败不再被描述为容量拒绝或成功完成。
- 未接传输不再产生假成功；损坏持久化状态不再被清空或跳过，包括 token 用量与主动开口额度。
- Focus 缺少有效 outcome 或结论时明确失败，不替模型编造 no_progress。
- 模型可见数字使用原生 toFixed 精度；精确半点从 Python ties-to-even 改为原生舍入。未改数据库原始值和审批阈值。

验证：1200 项测试（1189 通过、11 项既有跳过）；typecheck 与 noUnusedLocals 通过。新增坏 JSON、持久化故障、损坏账本、未接传输和非法强度测试。历史源码注释清理单独比较去注释后的编译输出；纯注释清理的去注释编译输出一致；kernel 另删无消费者的 _DEFAULT_RULES，并拒绝损坏的主动开口账本；gate 权限策略未改。另用 noUnusedLocals 检查并清理无用 import、默认规则和测试常量。

保留的 11 项 devstate 跳过测试需要私有状态，不能视作生产验收。本批未调用外部真实模型、未发送真实 Telegram 消息、未部署生产；真实 HTTP/SSE、取消和投递故障通过本地受控服务器验证。线上体验与后续架构工程分开验收。

机器日志、扫描结果、一次性验证脚本不入 Git；原文索引见 inventory.md。
