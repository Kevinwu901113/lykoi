# P2：共享认知与动态能力

当前状态：P2-A/B/C 实现与验收完成，已合并 main；尚未部署，生产角色状态未修改。

Conversation 与 Wake 共用 `lykoi-runtime/cognition` 的有界 reason → act → observe 循环。调用方保留上下文、prompt、状态写入和交付；异常不由循环重试或替换成休息。正常结束、调用失败、主动沉默和预算耗尽分别保留实际结果。JSON recovery 继续由 LLM adapter 单独负责。Wake 的 run decision 只记录已进入执行阶段的选择，预算耗尽后的 closing 响应不覆盖它；零步执行时存储 null。

插件以 `name / description / inputSchema / handler` 注册能力，注销函数绑定 Cordis 生命周期。Runtime 从同一声明生成模型描述、参数校验、BodySchema 和派发视图。每次模型请求刷新定义；卸载后新派发和持有的旧 handler 都拒绝执行，已经开始的工作仍属于原实例。`KNOWN_ACTION_LIST`、`TOOL_TABLE` 及工具别名映射已删除。

能力名称采用 `namespace.method`。输入使用小型 JSON Schema 子集：type（含 nullable 联合）、properties、required、additionalProperties、items、enum、minimum、maximum、description。不支持的 JSON Schema 特性不应在插件中声明。不进行参数修复或类型转换。注册不会授予权限：Conversation 过滤 deny，Wake 只展示现有自主权限允许的能力，实际执行仍经过 kernel 审批和审计。自主能力的内建列表仅提供既有默认授权；新能力默认 deny，可由运行规则的 `autonomous.always_allow` 显式放行，`autonomous.always_deny` 优先，终端/委托硬边界不放宽。注册与授权须同时具备。

Browser 的页面读取现在包含实际链接，支持读取索引 → 发现目标链接 → 读取后续页面。保留既有宿主、SSRF、独立 research context 和不可信内容边界。

可选 `lykoi-organ-workspace` 提供 list/read/write 和 terminal.exec。实例 assembly 将目录绑定至 `<stateRoot>/workspace`；启用器官时创建自己的工作目录。文件读取按 UTF-8 字节分段，使用返回的 nextOffset 继续；命令的大结果返回 artifact，可继续通过 workspace.read 读取。命令仍是需要审批的 OS shell，cwd 不是 OS 沙箱；运行时间和输出大小有显式上限，超限报告失败。

复用实例 console，输出 `instance/capability` 的 started/result/failed 事件和带 outcome 的 `instance/reply`。原有 Telegram 审批入口继续有效；console 展示 approval_pending，不提供新的审批平台。

## 启用与验证

在已有实例运行配置中加入：

```json
{"id":"workspace","name":"lykoi-organ-workspace"}
```

继续使用 `node profile/instance.ts run --registry <registry> --id <id> --config <config> --console`。角色定义和记忆恢复方式不变。

Node 24 本地结果：typecheck 通过；1206 项测试中 1195 通过、0 失败、11 跳过（包括依赖未提供私有 devstate 的测试）。真实 Chrome 与实例 console 已执行。

本地验证覆盖共享循环的观察反馈/预算/异常，Conversation 参数失败后的后续行动，动态卸载，Wake observation 相关 thought/experience 写入，文件越界与软链接，shell 审批，真实 Chrome 链接发现，以及真实子进程 console 和 P1 A/B 连续性。

真实模型脚本为 `profile/test/p2-live.ts`，不加入默认测试。设置 `LYKOI_P2_LIVE=1`、现有 provider 环境和 `CHROME_BIN` 后用 Node 24 运行。它创建全新临时状态，通过真实 LLM、kernel、Runtime、浏览器宿主和 Chrome 验证：

- 页面索引中的随机链接 → 实测报告 → Conversation 回答；答案不在用户输入中。
- 已有 concern → 多步阅读 → Wake 写入包含实际观察的 thought 和 experience。
- 工作区索引 → 实际目标文件 → 回答。
- 临时未知 Cordis capability plugin → 真实调用 → fiber.dispose → 旧 handler/派发拒绝 → 下一次模型调用不可用。

脚本将输入、调用、observation、回复、状态写入和 token 用量保存到临时 evidence.json。只使用合成资料，不读取生产记忆。验收预算为 200,000 tokens；不修改线上服务。

## 2026-09-10 实测结果

经用户授权，在 lapw1ng.com 独立临时目录使用 deepseek-v4-flash 和真实 Chrome 验收：

- Conversation 连续执行 navigate → get_text → navigate → get_text，最终正确回答第二页随机色标 `青色-77bc1da2` 和 21.7 摄氏度。
- Wake 两次读取后选择 record_note 正常结束，实际 thought 和 experience 包含该色标。
- 工作区连续读取索引及随机文件，正确回答 `文件-349656f2`。
- 真实 Cordis 临时插件返回 `标本-aff89dda`；dispose 后 BodySchema、模型工具描述与派发均撤销。模型明确表示无法重新查询，旧编号只是历史回执。

完整验收 14 次模型调用，真实 Cordis 生命周期补验 3 次。最初另有 1 次因隔离配置只放行 research、未放行 navigate 而停在审批；仅补齐测试只读权限后通过。三次运行共 33,291 tokens，低于 200,000 上限。生产仍为 cd5bfadb，active，NRestarts=0。

机器证据不进入 Git：完整链为服务器 `/tmp/lykoi-p2-live-RM4KrJ/evidence.json`，Cordis 补验为 `/tmp/lykoi-p2-live-M1Fzia/evidence.json`。本地归档在 `/Users/wukevin/lykoi/p2-evidence-20260910/`，包括初始失败，便于复核。
