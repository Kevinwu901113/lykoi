# WO-OUTCOME-01 执行报告

- 基线：`main@db151e1`
- 执行分支：`wo/outcome-01`
- 运行环境：Node `v26.4.0`，npm `11.17.0`
- 结论：D-1～D-8 已落地；typecheck 与全量测试通过；未改 system prompt、persona 装配、`contract.ts`、配置、环境变量、迁移或依赖。

## 改动文件

治理输入与报告：

- `governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md`
- `governance/wo/WO-OUTCOME-01/order.md`
- `governance/wo/WO-OUTCOME-01/report.md`

运行时代码：

- `packages/lykoi-converse/src/outcome.ts`
- `packages/lykoi-converse/src/conversation.ts`
- `packages/lykoi-converse/src/index.ts`
- `packages/lykoi-adapter-telegram/src/device.ts`
- `packages/lykoi-adapter-telegram/src/index.ts`
- `packages/lykoi-adapter-telegram/src/production.ts`
- `packages/lykoi-adapter-telegram/src/transport.ts`
- `packages/lykoi-kernel/src/dispatch.ts`
- `packages/lykoi-kernel/src/approval-conversation.ts`

测试：

- `packages/lykoi-converse/test/outcome.test.ts`
- `packages/lykoi-converse/test/assemble.test.ts`
- `packages/lykoi-converse/test/capability-gap.test.ts`
- `packages/lykoi-converse/test/cycle.test.ts`
- `packages/lykoi-converse/test/e2e.test.ts`
- `packages/lykoi-adapter-telegram/test/adapter.test.ts`
- `packages/lykoi-adapter-telegram/test/outbound.test.ts`
- `packages/lykoi-kernel/test/dispatch.test.ts`
- `packages/lykoi-kernel/test/approval-conversation.test.ts`

## D-1～D-8 落点

### D-1 终局对象与正本事件

- `packages/lykoi-converse/src/outcome.ts:6-47`：`TurnStatus`、`TurnFailReason`、`TurnOutcome`、`CycleOutcome`。
- `packages/lykoi-converse/src/index.ts:626-662`：`resolveTurnOutcome` 与异常分类集中映射。
- `packages/lykoi-converse/src/index.ts:664-852`：`handleTurn` 用单个 `finally` 写入认知路径唯一 `turn/terminal`。
- `packages/lykoi-adapter-telegram/src/index.ts:448-512`：消费路径写 `consumed` 终局；消费路由异常写 `failed/unknown` 终局后推进游标。

### D-2 ID 分层

- `packages/lykoi-converse/src/index.ts:668-705`：`inbound_id = turn_id = tg:<updateId>`；`run_id` 保持 `converse-<updateId>-<messageId>`；`converse/received` 不写 `run_id`。
- `packages/lykoi-converse/src/index.ts:720-839`：既有 `converse/*` 行增加 `turn_id`，既有 `runId` 原样保留。
- `packages/lykoi-converse/src/conversation.ts:410-430`：`#log` 自动合并 `run_id`、`turn_id`，并暴露当前 ID 只读方法。
- `packages/lykoi-converse/src/conversation.ts:1447-1466`：`send()` 接收并保存 `turnId`。
- `packages/lykoi-converse/src/conversation.ts:1508-1514`：`inner_outer_pair.turn_id` 改为 `history_id`，新的 `turn_id` 由 `#log` 写入。
- `packages/lykoi-kernel/src/dispatch.ts:114-124,342-347,492,521,552`：`DispatchContext` 新增可选 snake_case ID，只透传三处不可变审计行，不参与判定；旧 `runId` 兼容。
- `packages/lykoi-kernel/src/approval-conversation.ts:269-289,315-338,379-426`：审批问句及撤回动作继续透传同一 `run_id`、`turn_id`，并把认知 `run_id` 保存在既有 pending `run_id` 字段。

### D-3 技术失败系统回执

- `packages/lykoi-converse/src/outcome.ts:50-51`：确定性 `SYSTEM_FAILURE_NOTICE` 源码常量。
- `packages/lykoi-converse/src/index.ts:659-698,803-833`：仅规定的技术失败原因走裸 `telegram.send`；异常只记 `error_name`，不重试。
- `packages/lykoi-converse/src/index.ts:683-688`：系统回执显式传 `{ recordUndeliveredExperience: false }`。
- `packages/lykoi-adapter-telegram/src/index.ts:519-577`：裸面经 `transportSend` 单写者发送并保留 `telegram/sent` / `telegram/send_failed`。
- `packages/lykoi-adapter-telegram/src/production.ts:111-127`、`packages/lykoi-adapter-telegram/src/transport.ts:229-231,419-451`：内部选项传到生产 Bot API 失败收口。
- `packages/lykoi-adapter-telegram/src/transport.ts:133-168`：未送达账本与传输遥测照写，只有 experience sink 受内部选项抑制；缺省仍为开启。

### D-4 Conversation 周期结局

- `packages/lykoi-converse/src/conversation.ts:389-430`：保存并只读暴露最近周期结局。
- `packages/lykoi-converse/src/conversation.ts:1029-1102`：`envelope_failed`、`silence`、`reply`、`followup`、`missing_tool`、`tool_budget`、`ask_pending` 的所有返回位先置结局。
- `packages/lykoi-converse/src/conversation.ts:1415-1418`：`hasFollowupRequest()` 只读，不消费请求。
- `packages/lykoi-converse/src/conversation.ts:1457-1466`：每次 `send()` 开始清空上轮周期结局。

### D-5 消费路径终局

- `packages/lykoi-adapter-telegram/src/device.ts:384-423`：`routeOwnerMessage` 返回 `null | approval_answer | suggestion_answer`。
- `packages/lykoi-adapter-telegram/src/index.ts:448-512`：消费成功先写唯一 `consumed` 终局再返回；路由异常也有唯一失败终局。

### D-6 兼容与派生

- `packages/lykoi-converse/src/index.ts:701-833`：`converse/received`、`approval_request_pending`、`silence`、`reply`、`no_transport`、`turn_failed` 均保留。
- `packages/lykoi-converse/src/conversation.ts:999-1102`：`u3_cycle_*` 事件保留；仅自动补关联 ID。
- `packages/lykoi-kernel/src/dispatch.ts:342-347`：ID 透传不进入策略判定。

### D-7 测试

- `packages/lykoi-converse/test/outcome.test.ts:195-420`：19 个正本终局用例，覆盖工单列出的 17 类要求，以及 `ask_sent` 非实际发送态、回复后审批问句异常两个边缘路径。
- `packages/lykoi-converse/test/e2e.test.ts:133-281`：真实 Conversation/adapter/kernel 链验证 reply、契约失败系统回执、沉默及 ID/隐私不变量。
- `packages/lykoi-adapter-telegram/test/adapter.test.ts:259-328,379-404`：消费终局、路由异常唯一终局、生产传输 experience 隔离。
- `packages/lykoi-adapter-telegram/test/outbound.test.ts:448-583`：四态返回值与审批问句 ID 透传。
- `packages/lykoi-kernel/test/dispatch.test.ts:408-541`：ID 在 allow、deny、资源失败、委托拒绝和旧 `runId` 兼容路径的审计形状。
- `packages/lykoi-kernel/test/approval-conversation.test.ts:201-223`：审批问句动作及 pending 行继承认知 `run_id`、`turn_id`。

### D-8 影响面

- 新的 owner 可见行为仅为技术失败时的 `[系统]` 确定性回执。
- 新审计正文为零；新错误字段只写异常类名；没有供应商原文或 URL。
- kernel 仅增加审计关联 ID，不改 policy、approval、quota 或 dispatch 结果。
- system prompt、persona、信封契约、装配序均未修改。

## 偏离与理由

1. 原始 checkout 含尚未跟踪的工单、背景 memo 和一份无关审计文档，不满足工单的“工作树干净”前提。经 Kevin 授权，从 `db151e1` 建立隔离 worktree `/Users/wukevin/lykoi/wo-outcome-01`，只带入本工单 `order.md` 与指定 memo；无关 `instance_fact_audit_2026-09-04.md` 未带入、未修改。
2. D-3 对生产路径的描述与代码现实冲突：`telegram.send -> transportSend -> ProductionTelegramTransport -> BotApiTransport.sendMessage -> recordUndelivered` 在发送失败时会调用 `setUndeliveredExperienceSink`。按纪律暂停并取得 Kevin 明确授权后，新增源码固定的内部参数 `recordUndeliveredExperience`；系统回执传 `false`，普通发送缺省 `true`。因此增加了原工单文件清单之外的 `production.ts`、`transport.ts` 及生产链测试。没有新增配置键、环境变量或运行时旋钮。
3. 为保证 D-2 所称同一 turn 的动作账可追溯，ID 继续穿过审批问句的 `ApprovalConversation`。这扩展了原工单只点名 `dispatch.ts` 的 kernel 修改面，但只增加审计上下文和既有 pending `run_id`，不参与审批或 dispatch 判定。
4. 对抗复核发现两条未在表格中单列的异常边：已成功交付回复后 `askAbout` 抛错会错误覆盖终局并发送第二条系统提示；owner 消费路由抛错会没有终局且游标不推进。前者改为保留已交付回复的终局并记 `converse/approval_request_failed`；后者记 `turn/route_failed` 与唯一 `failed/unknown` 终局后推进游标。新增事件均无正文、无 URL、只带类别。
5. `ask_sent` 只在 `requestApproval.status === asked` 时为真；`already_pending`、`quiet_period`、`send_failed`、`enqueue_failed` 不再误报为本轮已问出。
6. 工单 D-7 写“既有测试只允许因 D-2c 调整”，但 D-3 新的 owner 可见回执、D-5 返回类型、D-2d 审计字段和获授权的生产隔离无法在不更新既有跨层断言的情况下验收。既有测试的调整只覆盖这些直接语义变化；prompt/persona SHA 测试零改动。

没有未获授权且会改变工单结论的偏离。

## `transportSend` 不进记忆的证据

系统失败回执的生产路径如下：

1. `packages/lykoi-converse/src/index.ts:683-688` 调用裸 `telegram.send`，并显式关闭未送达经验回灌。
2. `packages/lykoi-adapter-telegram/src/index.ts:519-530` 只转入 `transportSend`；`:541-577` 只调用设备 transport、更新计数并写 `telegram/sent` 或 `telegram/send_failed`。
3. `packages/lykoi-adapter-telegram/src/production.ts:111-127` 只把形状转给 `BotApiTransport.sendMessage`。
4. `packages/lykoi-adapter-telegram/src/transport.ts:443-451` 发送失败仍调用 `recordUndelivered`，因此 `telegram_undelivered.json` 与 `telegram_send_undelivered` 保留；`:165-166` 在内部参数为 `false` 时不调用 `_recordUndeliveredExperience`。
5. 这条路径没有调用 Conversation/history、`recordExperience`、`appendOutbox`、kernel dispatch 或 `recordUndelivered` 之外的角色出站收口。系统文案不会进入 `#messages`、history、experience 或 outbox，也不会产生 `action_dispatch`。
6. `packages/lykoi-adapter-telegram/test/adapter.test.ts:379-404` 用生产 `ProductionTelegramTransport + BotApiTransport` 验证：系统回执失败后未送达账本为 1、experience sink 调用为 0；紧接着普通发送失败后账本为 2、experience sink 调用为 1。

## `inner_outer_pair.turn_id` 读者清单

仓内 `rg "inner_outer_pair|history_id"` 结果分类如下：

- 生产者：`packages/lykoi-converse/src/conversation.ts:1508-1514`。旧 history 行 ID 字段已改为 `history_id`；新的认知回合 `turn_id` 由 `#log` 自动加入。
- 唯一读取该 history ID 值的可执行读者：`packages/lykoi-converse/test/cycle.test.ts:47-50`，断言已同步为 `pair.history_id`，并新增断言 `pair.turn_id === t1`。
- 只判断事件存在或读取其它字段、不读取旧 `turn_id` 值的测试：`packages/lykoi-converse/test/cycle.test.ts:496-498`、`deadline.test.ts:218,234`、`e2e.test.ts:164,252`。
- `packages/lykoi-gate/src/vocabulary.ts:94-100` 只登记事件名 `inner_outer_pair`，不读取字段。
- 其余命中均为历史治理报告或本工单文档，没有运行时观测脚本读取旧字段。

## 验证结果

### 计数

| 项目 | 基线 | 当前 | 增量 |
|---|---:|---:|---:|
| tests | 1046 | 1074 | +28 |
| pass | 1035 | 1063 | +28 |
| fail | 0 | 0 | 0 |
| skipped | 11 | 11 | 0 |

- `npm run typecheck`：通过。
- `npm test`：退出码 0。
- `packages/lykoi-converse`：154 tests / 153 pass / 0 fail / 1 skipped。
- `packages/lykoi-adapter-telegram`：68 / 68 / 0 / 0。
- `packages/lykoi-kernel`：209 / 209 / 0 / 0。
- `git diff --check`：通过。

### Prompt/persona SHA

既有 SHA 测试文件未修改，最终全量测试通过：

- `SYSTEM_PROMPT`：891 chars，`075d4282f604f93dc74f9caf6d4a5963d65e449cdd49daf8206975606dc1bc17`。
- `SUMMARIZE_SYSTEM_PROMPT`：142 chars，`3eb2679bd75cfd812bbbf0ffaf1156d284c771f0e1e59dac2daa40173ee32759`。
- `CYCLE_CLOSING_NOTE`：92 chars，`575ffe30c167b2e111789deee1a4702ffe93bc0384e381ff9d78b35eaf06a36a`。
- `ENVELOPE_SYSTEM_PROMPT` raw：1748 chars，`88587c8e3d923969d16a92e4cb996b6d45d5e2e077ac7af00ff016a39c0be14a`；反向恢复活体 raw：1677 chars，`9d4f169eb3ea368be6cf46e44445fc0ea943a4d7052a3c03744ea63bdf869eb7`；渲染后：2984 chars，`29f1377755b5890c14ab151f269ecb55a97e749e0fbe401546da30538786988f`。
- persona 内核九段：401 chars，`1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71`。

## 本单范围外的问题

1. `Conversation.send()` 在锁外执行 `governContext()`；`#log` 读取可变的 `#lastRunId/#lastTurnId`。若同一 Conversation 实例并发进入下一轮，上一轮锁外摘要事件可能取得下一轮 ID。本单不改变锁、摘要或并发模型。
2. `lastCycleOutcome=ask_pending` 按工单固定映射为 `deferred/approval_pending`。当审批机返回 `quiet_period`、`send_failed` 或 `enqueue_failed` 时，`ask_sent=false` 能如实反映没有一条仍待回答的新问句，但正本 reason 仍为 `approval_pending`；进一步细分需要新增 outcome reason，超出本单类型表。
3. owner 审批/建议消费路由发生异常时，适配器现在保证唯一 `failed/unknown` 终局并推进游标，但该异常发生在 converse 之前，当前不会发送 D-3 系统回执。是否为这种认知前失败增加通道中性的系统回执，需要另立单决定文案所有权和依赖方向。
4. 生产普通角色发送失败时，`BotApiTransport.sendMessage` 产出的 `undelivered_recorded=true` 没有穿过 `ProductionTelegramTransport` 与 `messengerTransportBridge`，`OutboundOrgan.sendReply` 因而可能再补一条未送达记录和经验。该问题不影响本单裸系统回执路径；修复会改变既有普通回复记账语义，未在本单处理。
5. 审批对话的既有审计事件含 `question_text` / `answer_text`，可能带命令或 URL。本单新增的终局、失败事件和 ID 字段均不带这些内容，但若治理要把 D-08 扩展到既有审批审计，需要单独做契约与迁移评估。
6. `BotApiTransport` 收到 `ok=true` 但缺少 `result.message_id` 时返回未送达形状，却没有调用 `recordUndelivered`，形成“无 message_id、无未送达账”的既有第三种结局；本单未改 Bot API 响应契约。
7. 审批问句的初始 `action_dispatch` 已有关联 ID，认知 `run_id` 也进入 pending；owner 随后批准时的实际工具重派仍没有新的 approval-answer `turn_id`。补齐它需要把设备入站 ID 继续穿过 `handleOwnerAnswer` 和 pending/重派边界，超出 D-2d 点名的 converse dispatch 范围。
8. D-7 的异常分类用例主要通过 fake Conversation/Telegram 精确注入；真实跨层测试覆盖 reply、契约失败、沉默、消费和生产传输隔离，但没有把每一种 LLM/预算异常都逐一跑成完整跨包链。当前满足工单的路径数与结果断言，后续若提高证据等级可另加 gated integration 测试。
