# WO-OUTCOME-01 · owner 入站的终局保证（TurnOutcome 正本）与 ID 分层

- 状态：**已落地（LANDING-P，2026-09-04 22:38 CST，产线 main@8da87dc）**。执行方：GPT-5.6（外部执行 Agent）；复核：主治理 Agent（PASS，`review.md`）；裁定：Kevin。
- 立单：2026-09-04，主治理 Agent。
- 依据：`governance/docs/gpt_next_phase_memo_assessment_2026-09-04.md` §2 第 2 条；Kevin 2026-09-04 裁定 R-B（技术失败回执用系统口吻、确定性文案、system 盖章，不由角色 LLM 生成）；白皮书 v1.2 37.3（集线器不得自主产生任何对外表述）、37.8（回执背书）；人格分层设计 §2.3（能力缺口不许用沉默掩盖）。
- 基线：`main@db151e1`（产线钉 `main@3c47c2e`，两者 packages/ 同树）。分支 `wo/outcome-01`。
- 包：lykoi-converse（`src/index.ts`、`src/conversation.ts`、测试）；lykoi-adapter-telegram（`src/index.ts` 一处消费位、`src/device.ts` 一处返回值）；lykoi-kernel（`src/dispatch.ts` DispatchContext 加两个可选字段，仅透传到审计行）。gate / profile / 迁移 / 依赖 / 环境变量 **零改动**。

## 0 · 执行方入场须知

- 仓库根在 `packages/*` 工作区，Node ≥ 24。命令：`npm run typecheck`、`npm test`（全量基线 1046 / 1035 过 / 0 失败 / 11 跳过）。单包：`npm test -w packages/lykoi-converse`。
- 不许新增配置键、环境变量或旋钮（GK-6：产线 env 钉面要求旋钮一律未设）。文案与阈值一律源码常量。
- 隐私口径 D-08 / S-21：审计行只带字数、哈希、类别、代号，**不带正文、不带供应商原文、不带 URL**。本单新增的所有审计行同样。
- 提示词不变：本单不改任何 system 段、persona 装配、信封契约（`contract.ts`）。验收断言现有 prompt/persona sha 测试一字不动地通过。
- 命名：新增审计字段一律 snake_case（`turn_id`、`run_id`），与 kernel 行（`action_id`、`correlation_id`）同口径。既有 `runId`（camel）字段与既有事件名**原样保留**，不重命名。
- 产物：分支上的提交 + `governance/wo/WO-OUTCOME-01/report.md`（改了哪些文件、每条 D 的落点、偏离与理由、测试计数、prompt sha 核对、遗留问题）。不合并、不 push main、不碰产线。
- 文档风格：注释与 report 写事实，不写叙事修辞。

## 1 · 根因（现状事实，均已实读）

| 现象 | 位置 | 事实 |
|---|---|---|
| 终局账分散且语义重叠 | `lykoi-converse/src/index.ts:605-718` `handleTurn` | 七种事件：`converse/received`、`turn_failed`（kind = context_budget / llm_finish / 其它）、`silence`、`reply`、`no_transport`、`approval_request_pending`。**`converse/silence` 同时承载有意沉默与契约失败**；区分只在 `conversation.ts` 的 `u3_cycle_envelope(kind=silence)` 与 `u3_cycle_failed`。 |
| `converse/reply` 记在投递之前 | `index.ts:699-713` | 先记 `converse/reply`，再 `sendReply`。`device.ts:214-275` 的 `sendReply` 返回 `delivered / undelivered / needs_approval / dispatch_failed`，**`handleTurn` 丢弃这个返回值**。投递失败在回合层不可见。 |
| 技术失败对 owner 不可见 | `index.ts:624-659` | 三个 catch（ContextBudgetError / LlmFinishError / 其它，含 DeadlineExceededError、BudgetExceeded）只落审计即 return，不发任何话。 |
| 契约失败在回合层等于沉默 | `conversation.ts:934-1068` `#runCycle` | 解析失败、missing_tool、工具步超界（`CYCLE_TOOL_BUDGET_EVENT`）全部 `return ''`，`send()` 返回空串 → `handleTurn` 记 `converse/silence`。`send()` 的返回值无法区分有意沉默与失败。 |
| 审批/建议应答不落回合终局 | `lykoi-adapter-telegram/src/index.ts:408-416`，`device.ts:346-380` | owner 来话先过 `routeOwnerMessage`，被消费即 return，不发 inbound 事件，converse 层零记录。这类入站今天没有任何回合级终局。 |
| ID 三套互不记录 | `index.ts:622`；`lykoi-kernel/src/dispatch.ts:455-456`；`index.ts:368-374` | converse runId = `converse-<updateId>-<messageId>`；kernel 每次 dispatch 自铸 `actionId`/`correlationId`，converse 的 `dispatchFn` 不传任何关联；`converse/received` 无 runId；`conversation.ts` 的 `#log` 只在 `u3_cycle_timeout` 带 `run_id`。`correlationId` 已被 kernel 用于串 dispatch → approval → 重派（`approval.ts:642, 740`；`approval-interpreter.ts:613` 用它当 id 回退），**不可挪作 run 标识**。 |
| 账对不上 | `governance/docs/landing_n_readout_2026-09-04.md` | 落地前 24 h：`telegram/inbound` 16、`converse/reply` 5、`converse/silence` 6、`turn_failed` 0。按 update 无法逐条对到终局。 |
| Kevin 经历的"没回"多是技术失败 | HANDOFF LANDING-J/K/M 读数 | J 前四条全沉默 = 工具步第二跳 400；K 后两次沉默 = json 退化；M 后一条 = DeadlineExceeded。 |

## 2 · 决定

### D-1 终局对象与正本事件 `turn/terminal`

新增类型（放 `lykoi-converse/src/outcome.ts`，导出）：

```ts
export type TurnStatus =
  | 'replied'              // 一条对话答复已交付传输（sendReply → delivered）
  | 'intentional_silence'  // 信封 kind=silence，或答复为空且本轮无失败
  | 'deferred'             // 本轮无答复文本，但已向 owner 发出审批问句，等他
  | 'consumed'             // 入站被审批/建议路由消费，未进入认知回合
  | 'failed'               // reason 必填

export type TurnFailReason =
  | 'envelope_failed'        // 契约解析失败（含重试耗尽）；细分见 u3_cycle_failed
  | 'missing_tool'           // 信封 tool_call 无 tool
  | 'tool_budget_exhausted'  // MAX_TOOL_STEPS 收尾周期仍要动手
  | 'llm_failed'             // LlmFinishError
  | 'deadline_exceeded'      // DeadlineExceededError（周期 180 s）
  | 'context_budget'         // ContextBudgetError
  | 'budget_exceeded'        // lykoi-budget BudgetExceeded
  | 'delivery_failed'        // sendReply → undelivered / dispatch_failed
  | 'no_transport'           // telegram 服务缺席
  | 'unknown'                // 其它异常（只记 err.name）

export interface TurnOutcome {
  status: TurnStatus
  reason: TurnFailReason | 'approval_answer' | 'suggestion_answer' | 'approval_pending' | null
  followup_registered: boolean   // 本轮登记了 promise_followup
  ask_sent: boolean              // 本轮 askAbout 已问出
  notice_sent: boolean           // D-3 的系统回执已交付传输
  reply_chars: number            // 0 = 无答复
  elapsed_ms: number             // 从 received 到终局
}
```

审计事件（一条、且只有一条）：

```
type: 'turn/terminal'
turn_id, inbound_id, run_id (无认知回合时 null), update_id, message_id, context_id, user_id, is_owner,
status, reason, followup_registered, ask_sent, notice_sent, reply_chars, elapsed_ms
```

映射规则（`handleTurn` 内，一处函数 `resolveTurnOutcome`）：

| 路径 | status / reason |
|---|---|
| `send()` 抛 ContextBudgetError | failed / context_budget |
| 抛 LlmFinishError | failed / llm_failed |
| 抛 DeadlineExceededError | failed / deadline_exceeded |
| 抛 BudgetExceeded（按 `err.name === 'BudgetExceeded'`） | failed / budget_exceeded |
| 抛其它 | failed / unknown |
| `send()` 返回空串，且 `lastCycleOutcome().kind === 'silence'` | intentional_silence（若同时 askAbout 已发 → deferred / approval_pending） |
| 返回空串，且 `lastCycleOutcome().kind ∈ {envelope_failed, missing_tool, tool_budget}` | failed / 对应 reason |
| 返回空串，且 `lastCycleOutcome().kind === 'ask_pending'`（撞审批门那条腿） | deferred / approval_pending |
| 非空答复，`sendReply` → delivered | replied |
| 非空答复，`sendReply` → undelivered 或 dispatch_failed | failed / delivery_failed |
| 非空答复，`sendReply` → needs_approval | deferred / approval_pending |
| telegram 服务缺席 | failed / no_transport |
| 设备层 `routeOwnerMessage` 消费 | consumed / approval_answer 或 suggestion_answer |

不变量：**每条 `telegram/inbound` 恰对应一条 `turn/terminal`**（同 `update_id`）。`handleTurn` 用 try/finally 结构保证任何分支（含 audit 自身抛错之外的异常）都落且只落一条；consumed 路径由适配器 `#handleUpdate` 在 `if (consumed) return` 前落（D-5）。

### D-2 ID 分层

| ID | 含义 | 本单取值 | 后续 |
|---|---|---|---|
| `message_id` | 平台原始消息 id | 现有 `message.messageId` | 不变 |
| `inbound_id` | 一条规范化入站 | `tg:<updateId>` | 通道中性化后前缀随通道 |
| `turn_id` | 一个（合并后的）用户回合 | **= inbound_id**（A1 阶段 1:1） | A2 起多 inbound 归一 turn |
| `run_id` | 一次认知尝试 | 现有 `converse-<updateId>-<messageId>` 字符串**原样**（观测脚本兼容） | A3 起中止重来追加 `-r<n>` |
| `action_id` / `correlation_id` | kernel 动作与审批链 | kernel 照旧自铸 | 不变；**不得**用 run_id 顶替 |

落点：
- D-2a `converse/received` 加 `turn_id`、`inbound_id`（无 run_id，run 在此之后才诞生）。
- D-2b `handleTurn` 内所有既有 `converse/*` 行加 `turn_id`（既有 `runId` 字段保留）。
- D-2c `conversation.ts` `#log` 改为自动合并 `run_id: this.#lastRunId || null`（`u3_cycle_timeout` 既有的显式 `run_id` 与之同值，去重）。`inner_outer_pair` 的 `turn_id` 字段现为 history 行 id，**改名 `history_id`**，避免与本单 `turn_id` 撞名；`turn_id`（本单语义）由 `send()` 的 opts 传入并同样自动合并。
- D-2d kernel `DispatchContext` 加可选 `run_id?: string | null`、`turn_id?: string | null`，`dispatch.ts` 只把它们透传进 `action_dispatch` / `action_result` 审计行（`:469-471, 498-500, 529-531` 三处），不参与任何判定。converse 的 `dispatchFn`（`index.ts:368-374`）从 `Conversation` 取当前 run/turn 填入；`ConverseDispatchFn` 的 context 类型相应加两个可选字段。wake/reflow 调用方不传即 undefined，行为不变。

### D-3 技术失败的系统回执（R-B）

- 常量（`outcome.ts`）：`SYSTEM_FAILURE_NOTICE = (reason) => `[系统] 这一轮没有得到可靠回复（代号 ${reason}）。``。确定性，不经 LLM，不带供应商原文。
- 触发：status = failed 且 reason ∈ {envelope_failed, missing_tool, tool_budget_exhausted, llm_failed, deadline_exceeded, context_budget, budget_exceeded, unknown}。**不触发**：delivery_failed（本就送不出）、no_transport。每回合至多一条。
- 通道：走适配器的**裸出站面** `telegram.send(contextId, text, replyTo=message.messageId)`（`lykoi-adapter-telegram/src/index.ts:421`，经 `transportSend`，设备层单写者），**不走** `sendReply` / kernel dispatch。理由：这不是她的动作，不得进入她的动作审计（`action_dispatch`）、未送达经验（`setUndeliveredExperienceSink`，那是"她自己那句话没送出去"）、对话 history、`#messages`。裸面已自带 `telegram/sent` / `telegram/send_failed` 审计。
- 记账：`turn/terminal.notice_sent = true` 仅当裸面返回 `sent === true`；发送异常吞掉并记 `turn/notice_failed {turn_id, reason, error_name}`，不重试。
- 不进记忆：执行方须在 report 里给出证据（`transportSend` 路径）它不写 history、不写 experience、不进 outbox。

### D-4 `Conversation` 暴露周期结局

- 新增 `lastCycleOutcome(): CycleOutcome | null`：`{ kind: 'reply' | 'silence' | 'followup' | 'envelope_failed' | 'missing_tool' | 'tool_budget' | 'ask_pending', step: number }`。`send()` 开头清空（与 `#followupRequest` 同一清场位 `conversation.ts:1420-1422`），`#runCycle` 每条 return 前置位（`:1046-1068`、撞门那条腿 `#executeCycleTool` 返回非 null 处）。`send()` 返回值类型不变（string），避免改动现有测试。
- `followup_registered` 取自 `#followupRequest !== null`（新增只读 `hasFollowupRequest()`，**不取走**，`takeFollowupRequest()` 语义不动，B3 单接消费者）。

### D-5 消费路径的终局

- `device.ts:346` `routeOwnerMessage` 返回值由 `boolean` 改为 `null | 'approval_answer' | 'suggestion_answer'`（两处调用点同步）。
- 适配器 `index.ts:408-416`：`consumed !== null` 时先 `#audit.record({ type: 'turn/terminal', status: 'consumed', reason: consumed, turn_id, inbound_id, run_id: null, ... , elapsed_ms })` 再 return。适配器仍零认知：这一行是账，不是表述。

### D-6 兼容与派生

既有事件（`converse/reply`、`silence`、`turn_failed`、`no_transport`、`approval_request_pending`、`u3_cycle_*`）**一条不删、语义不改**，只加 `turn_id`。`turn/terminal` 是正本；旧事件的退役由治理侧另排。

### D-7 测试（`packages/lykoi-converse/test/outcome.test.ts` 新增；既有测试只允许因 D-2c 改名 `history_id` 与 `#log` 多出 `run_id` 字段而调整断言）

每条路径断言：恰一条 `turn/terminal`、status/reason 相符、`notice_sent` 相符、同一 turn 的全部 `converse/*` 与 `u3_cycle_*` 行 `turn_id` 一致、`action_dispatch` 行带 `run_id`/`turn_id`：

1. reply → delivered：replied，reply_chars > 0，无 notice。
2. 信封 kind=silence：intentional_silence，无 notice。
3. not_json 连续三次（重试耗尽）：failed/envelope_failed，notice 走裸面（假 transport 记到一条 `[系统]` 开头文本、replyTo = 入站 message_id），`#messages` 与 history 不含该文本。
4. LlmFinishError：failed/llm_failed + notice。
5. DeadlineExceededError（注入短 cycleTimeoutS）：failed/deadline_exceeded + notice；`u3_cycle_timeout` 与 `turn/terminal` 同 run_id。
6. ContextBudgetError：failed/context_budget + notice。
7. BudgetExceeded（假 llm 抛 name='BudgetExceeded'）：failed/budget_exceeded + notice。
8. 工具步超界：failed/tool_budget_exhausted + notice。
9. tool_call 无 tool：failed/missing_tool + notice。
10. sendReply → undelivered：failed/delivery_failed，**无** notice。
11. sendReply → needs_approval：deferred/approval_pending。
12. 空答复 + delegatedAsk 已问出：deferred/approval_pending，ask_sent = true。
13. promise_followup：replied，followup_registered = true。
14. telegram 服务缺席：failed/no_transport，无 notice。
15. 设备层消费（approval_answer / suggestion_answer 各一）：consumed，`run_id` = null；不触发 inbound 事件。
16. notice 裸面抛错：`turn/notice_failed` 一条，`notice_sent` = false，回合不抛。
17. 不变量：对以上全部用例统一断言 `count(turn/terminal) === 1`。

### D-8 影响面声明

- 新的对外行为：技术失败时 owner 收到一条 `[系统]` 前缀的确定性回执，reply_to 入站消息。每回合至多一条。
- `inner_outer_pair.turn_id` 改名 `history_id`（观测脚本若读此字段需同步；执行方在 report 列出仓内所有读者）。
- kernel 审计行多两个可选字段；无判定变化。
- 提示词、契约、persona、装配序零变化。

## 3 · 边界（不做）

入站合并、队列、中止/重来、`utterances[]`、信封契约变更、wake 路径、工具步超界时的部分答复、旧事件退役、任何配置/环境/迁移/依赖变更、对 `sendReply` 语义与出站配额的改动、通道中性化事件名（A2）。

## 4 · 验收

- `npm run typecheck` 净；`npm test` 0 新增失败，新增用例 ≥ 17 条全过。
- prompt/persona sha 相关既有测试零改动通过。
- 落地面：src 变更在 manifest 域内（converse、adapter-telegram、kernel 三包），零迁移、零 unit、零 profile、零依赖。
- 落地后读数（治理侧验）：任意 24 h 窗内 `count(telegram/inbound) == count(turn/terminal)`，且按 `update_id` 一一对应；status 分布可读；Kevin 侧：一次人为失败（例如临时把 cycleTimeoutS 调短的影子环境）能在周期期限内收到 `[系统]` 回执。

## 5 · 报告要求

`report.md` 含：改动文件清单；D-1～D-8 各自落点（file:line）；偏离与理由；`transportSend` 不进记忆的证据；`inner_outer_pair.turn_id` 读者清单；测试计数（基线 → 现在）；prompt sha 核对结果；执行中发现的、不在本单范围的问题（只列不改）。
