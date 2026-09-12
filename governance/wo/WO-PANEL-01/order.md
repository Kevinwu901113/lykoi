# WO-PANEL-01 · Cordis owner Panel

2026-09-12，所有者授权自行设计实现第一批 Panel，并要求轻框架、复用、简洁，尊重 Cordis 插件边界。基线 main `9bb57eb`。本单在独立分支 `wo/panel-01` 实现。

交付：本机所有者 Web 控制台，可查看 Instance、Heart、Mind、Task、Skill、Capability，发送真实 Converse 回合，创建/修改/暂停/恢复/取消任务，查看操作参数及批准对应 Task 操作。

约束：Panel 是基础设施/交互入口，不拥有另一份业务状态，不运行认知、不直接写数据库、不直连器官实现。状态来自 Cordis 服务，写操作复用已有所有者入口。Runtime 能力表随注册/卸载变化。HTTP 随插件卸载关闭。固定回环监听，校验浏览器来源；本机用户是控制台的所有者信任边界。

必要验收：真实 Cordis 插件装配与 HTTP、共享历史/Mind、持久 Task 控制、Skill 原文件读取、动态能力和卸载重载；浏览器操作与窄屏检查；全量测试及 typecheck。合成模型验证机制，不声称生产或真实模型验收。生产配置不在本单启用。
