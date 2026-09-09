# WO-RUNTIME-SERVICES-01 — P0-B/C 首个结构批次

状态：实现与本地验证完成，待本批评审合并。基线 main@5464f5d。用户批准 P0-A 合并并授权推进结构改造。

当前规划：P0-A 清单与安全减法；P0-B contracts/runtime；P0-C lifecycle/capability/BodySchema；P0-D 防御审查；P0-E 迁移不变量退休。此顺序可随产品证据调整，不是永久契约。

决策：每个 Cordis Runtime 持有独立能力注册及 BodySchema；插件通过 contracts 注册，消费者使用实时资源视图。反对仅移动全局 Map 或由具体器官代建服务，因为那仍依赖装载顺序。BodySchema 底层验证暂复用 kernel 的纯注册实现，所有权只在 Runtime，审批和策略仍在 kernel。

范围：新增 contracts/runtime；Browser 与 Telegram 注册；Converse/Wake 消费动态能力；清理旧全局 registry；profile 显式装配 Runtime。kernel 仅提取类型及支持实例注入遥测，不修改审批/策略/path guard；没有生产动作。Telegram 传输和 kernel 其他历史单例不在这一批解决，不宣称全应用已支持多实例。

验收：双 Context 与 isolate 不串能力；消费者先加载仍能发现后加载器官；卸载后图式/目录/已有派发引用同步失效；旧 disposer 不移除重载后的器官；重复/非法注册不留半成品；实际 Browser 插件配真实本地宿主验证装卸；全量测试和 typecheck。P0-A 机器输出/一次性脚本退出 Git，保留三个文档及历史 archive。
