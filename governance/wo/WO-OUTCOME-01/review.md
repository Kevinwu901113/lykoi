# WO-OUTCOME-01 · 复核

- 复核方：主治理 Agent。复核日期：2026-09-04。
- 对象：分支 `wo/outcome-01`（执行方提交 b20f794；复核方补 R-1 提交 00f12ff）。基线 `main@db151e1`。
- 结论：**通过**。R-1 由复核方直接落分支；其余备注不阻塞合并。

## 1 · 核对结果

| 项 | 读数 | 结论 |
|---|---|---|
| typecheck | `npm run typecheck` 零错误 | 过 |
| 全量测试 | 1074 / 1063 过 / 0 失败 / 11 跳过（基线 1046 / 1035 / 0 / 11；净增 28 例） | 过 |
| prompt sha | SYSTEM_PROMPT 891 字 075d4282…；persona 内核 401 字 1f5960b7… | 未变 |
| gate / profile / 迁移 / 依赖 / env | 执行方零改动；复核方改 gate 词汇一处（R-1） | 见 R-1 |
| D-1 `turn/terminal` 正本 | `lykoi-converse/src/outcome.ts` 类型五态 + 十种 reason；`index.ts` handleTurn finally 一次落账 | 对 |
| D-2 投递结果进终局 | `sendReply` 返回值消费；delivered → replied，其余 → failed/delivery_failed | 对 |
| D-3 契约失败与有意沉默分开 | `conversation.ts` 每个 `#runCycle` 出口设 cycle outcome；`lastCycleOutcome()` 读面 | 对 |
| D-4 系统口吻回执 | `SYSTEM_FAILURE_NOTICE` 确定性文案；`telegram.send(..., { recordUndeliveredExperience: false })`；不经 kernel dispatch、不入 history、不入经验 | 对（R-B） |
| D-5 消费路径全枚举 | 审批/建议应答 → `turn/terminal status:'consumed'`；路由抛错 → `turn/route_failed` + failed/unknown | 对 |
| D-6 ID 分层 | inbound_id=`tg:<updateId>`，turn_id=inbound_id，run_id=`converse-<u>-<m>`；DispatchContext `run_id`/`turn_id` 只透传审计行；`correlationId` 未挪用 | 对 |
| D-7 不进 kernel 的回执 | 裸 `telegram.send`；`transportSend` 无记忆写入（执行方 report 附证据） | 对 |
| D-8 隐私 | 新增审计行只带 chars/代号/id；复核方逐行读 diff 无正文字段 | 对 |

## 2 · R-1（复核方已落分支 00f12ff）

新增事件 `turn/terminal`、`turn/route_failed`、`turn/notice_failed` 未登记进 gate D-08 对话面词汇
（`packages/lykoi-gate/src/vocabulary.ts` `CONVERSATION_FACING_PREFIXES`）。后果：这些行不受
「对话面零正文」类的运行期断言覆盖。改动：前缀表加 `turn/`，文档表同步；`lykoi-converse/test/e2e.test.ts:206`
的零正文循环纳入 `turn/*`。gate 72/72、converse 154/153/0/1 过。

教训入库：**新增审计事件类型 = 必须同时登记 D-08 类别**，后续工单入场须知加此一条。

## 3 · 执行方六条偏离的评定

| 偏离 | 评定 |
|---|---|
| 隔离 worktree 执行 | 接受 |
| `recordUndeliveredExperience` 作为 `TelegramSendOptions` 内部选项 | 接受。它是调用参数不是配置旋钮，不触 GK-6；符合 D-7「回执不进记忆」 |
| ID 穿过 `approval-conversation.ts` | 接受。审批问句与原回合同 run/turn 是 D-6 的题中之义 |
| 新增 `converse/approval_request_failed`、`turn/route_failed` | 接受。均已入 D-08 类（R-1 覆盖 `turn/`；`converse/` 原本在类内） |
| `ask_sent` 仅 status==='asked' 为真 | 接受，语义更准 |
| 既有测试调整 | 已逐条读，均为字段增补，无断言删除 | 

## 4 · 备注（不阻塞）

1. 空答复分支的 `askAbout()` 未包 try：抛错走 failed/unknown + 回执，与答复分支的 `approval_request_failed` 不对称。可接受，记录。
2. 路由失败语义变化：旧行为是不推游标、下轮重投；新行为是推游标、记 failed/unknown、**不发 owner 回执**。接受（避免重投热循环），但 owner 对"审批回答丢了"不可见，列为候选小单（见 §6）。
3. 适配器用 `Date.now()` 计 elapsed，包内其余处用 clock 注入。惯例问题，不改。
4. 报告 §out-of-scope 第 4 条：`undelivered_recorded` 不穿过 `ProductionTelegramTransport` 桥，可能双记未送达。候选小单。
5. 报告 §out-of-scope 第 7 条：审批重派缺答题回合的 turn_id。候选小单。
6. 其余 out-of-scope（send() governContext 锁外、ask_pending 映射、审批审计带 question_text、BotApi ok 无 message_id、fake 异常测试）记录不立单。

## 5 · 合并与落地清单

1. **合并（Kevin，Mac）**：main 工作树已清理与分支同字节的两份未跟踪文件（order.md、评估稿）；
   `governance/docs/instance_fact_audit_2026-09-04.md` 未跟踪且分支无此文件，不冲突。
   ```
   git merge --no-ff wo/outcome-01
   ```
   合并后本 review.md 与 instance_fact_audit 一并提交。
2. **落地（Kevin，服务器 root）**：停 → 备份 state → 拉 main → `npm ci` → 重签 manifest（本单改动包：
   lykoi-converse、lykoi-adapter-telegram、lykoi-kernel、lykoi-gate）→ 起 → 门读 OK。无迁移、无 env 变化；
   先查 GK-6 env 钉面。编号 LANDING-P。
3. **落地后读数（24 h）**：`telegram/inbound` 行数 == `turn/terminal` 行数；status 分布；`notice_sent` 次数与
   reason 分布；`turn/route_failed` 应为 0。首条 owner 可见变化：技术失败时收到 `[系统] …（代号 …）`。
4. HANDOFF 在落地时补 LANDING-P 条目。

## 6 · 派生候选小单

- WO-FIX-ROUTEFAIL-01：路由失败给 owner 系统回执（§4.2）。
- WO-FIX-UNDELIVERED-BRIDGE-01：`undelivered_recorded` 过桥（§4.4）。
- WO-FIX-APPROVAL-TURNID-01：重派带答题 turn_id（§4.5）。
