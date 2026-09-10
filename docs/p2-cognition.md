# P2：共享认知与动态能力

当前状态：P2-A/B 的实现与本地验证完成，P2-C 的真实模型验收待运行。尚未合并、部署或接管生产状态。阶段完成以真实模型验收为准。

Conversation 与 Wake 共用 `lykoi-runtime/cognition` 的有界 reason → act → observe 循环。调用方保留上下文、prompt、状态写入和交付；异常不由循环重试或替换成休息。正常结束、调用失败、主动沉默和预算耗尽分别保留实际结果。JSON recovery 继续由 LLM adapter 单独负责。

插件以 `name / description / inputSchema / handler` 注册能力，注销函数绑定 Cordis 生命周期。Runtime 从同一声明生成模型描述、参数校验、BodySchema 和派发视图。每次模型请求刷新定义；卸载后新派发和持有的旧 handler 都拒绝执行，已经开始的工作仍属于原实例。`KNOWN_ACTION_LIST`、`TOOL_TABLE` 及工具别名映射已删除。

能力名称采用 `namespace.method`。输入使用小型 JSON Schema 子集：type（含 nullable 联合）、properties、required、additionalProperties、items、enum、minimum、maximum、description。不支持的 JSON Schema 特性不应在插件中声明。不进行参数修复或类型转换。注册不会授予权限：Conversation 过滤 deny，Wake 只展示现有自主权限允许的能力，实际执行仍经过 kernel 审批和审计。

Browser 的页面读取现在包含实际链接，支持读取索引 → 发现目标链接 → 读取后续页面。保留既有宿主、SSRF、独立 research context 和不可信内容边界。

可选 `lykoi-organ-workspace` 提供 list/read/write 和 terminal.exec。实例 assembly 将目录绑定至 `<stateRoot>/workspace`；启用器官时创建自己的工作目录。文件读取按 UTF-8 字节分段，使用返回的 nextOffset 继续；命令的大结果返回 artifact，可继续通过 workspace.read 读取。命令仍是需要审批的 OS shell，cwd 不是 OS 沙箱；运行时间和输出大小有显式上限，超限报告失败。

复用实例 console，输出 `instance/capability` 的 started/result/failed 事件和带 outcome 的 `instance/reply`。原有 Telegram 审批入口继续有效；console 展示 approval_pending，不提供新的审批平台。

## 启用与验证

在已有实例运行配置中加入：

```json
{"id":"workspace","name":"lykoi-organ-workspace"}
```

继续使用 `node profile/instance.ts run --registry <registry> --id <id> --config <config> --console`。角色定义和记忆恢复方式不变。

Node 24 本地结果：typecheck 通过；1200 项测试中 1189 通过、0 失败、11 跳过（包括依赖未提供私有 devstate 的测试）。真实 Chrome 与实例 console 已执行。

本地验证覆盖共享循环的观察反馈/预算/异常，Conversation 参数失败后的后续行动，动态卸载，Wake observation 相关 thought/experience 写入，文件越界与软链接，shell 审批，真实 Chrome 链接发现，以及真实子进程 console 和 P1 A/B 连续性。

真实模型脚本为 `profile/test/p2-live.ts`，不加入默认测试。设置 `LYKOI_P2_LIVE=1`、现有 provider 环境和 `CHROME_BIN` 后用 Node 24 运行。它创建全新临时状态，通过真实 LLM、kernel、Runtime、浏览器宿主和 Chrome 验证：

- 页面索引中的随机链接 → 实测报告 → Conversation 回答；答案不在用户输入中。
- 已有 concern → 多步阅读 → Wake 写入包含实际观察的 thought 和 experience。
- 工作区索引 → 实际目标文件 → 回答。
- 临时未知 capability → 真实调用 → 卸载 → 旧 handler/派发拒绝 → 下一次模型调用不可用。

脚本将输入、调用、observation、回复、状态写入和 token 用量保存到临时 evidence.json。只使用合成资料，不读取生产记忆。验收预算为 200,000 tokens；不修改线上服务。

远端验收尚未开始：自动审批拒绝将源码压缩包上传到 lapw1ng.com，要求该具体目的地的明确授权。待授权后运行上述脚本，再根据真实结果收敛；本地测试通过不代替此项。
