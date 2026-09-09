# P0-D 本批去留

| 机制 | 处理 | 保留的真实边界 |
| --- | --- | --- |
| Concern Floor | 删除自动补造入口、实现和专用旧测试；maintain 不再需要 createConcern | 已存关切（包括 floor origin）照常读取/老化，不删除数据；模型仍可创建新关切 |
| Regulation hard-prune / 饥饿例外 / 预算折扣 | 删除按 coherence/load 删候选、补回 explore 的例外及半额预算；状态/偏好仍可见 | 实际小时/通知/主动联系额度和当前注册能力；kernel 审批与派发门未改 |
| safe-kind / grounding demotion | 删除改写 rest/silence 和 demotion 字段；不可用选择抛 DecisionRejectedError，缺口照记；文字引用匹配只服务关切关联 | kind、必填字段、注入 ID 域、工具参数验证；真实失败不产生伪造休息经验 |
| provider JSON workaround | 移到 lykoi-llm；最多三次请求、语法括号修复、取消检查、逐次 gate/charge；只重试明确 EMPTY_RESPONSE 或坏 JSON | 无工具重放；不修复截断字符串；其他 provider 错误直接失败；合法 JSON 的业务语义由认知校验 |
| 迁移遗物 | 清理此次涉及的 10 个源码文件中的历史注释，退休旧 SHA/字段数/降级/重试位置约束；repair 测试随代码迁移 | 原文可追溯基线 8b81c80，不新增机器清单或重复归档。其余包的历史注释、全仓迁移不变量留待继续分类 |

学习层 narrative 重试只重写叙事、不重放已执行操作；状态事务、实际副作用审计、投递失败区分、数据升级测试仍保留。本批没有全仓逐个 catch/fallback 语义审核完成的声明，也不提前宣布 P0-E 完成。
