# WO-KINDS-01 · 自主决策 KINDS 评估与收敛方案（E1，分析单）

- 状态：**待派**。执行方：执行子 Agent（分析，opus）。复核：主治理 Agent；收敛方案由 Kevin 裁定后另立施工单。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B（E1 = "评估并收敛 KINDS"，不废）；memo 评估稿 §4（KINDS 路径）；`governance/wo/PROBE-CAP-01/report.md` §5 结论（P2 序列 12/12 合法、11/12 收敛 → 多步工具路径不需要加厚；P3 不选 delegate → 不加 delegate kind，委托由内核路由）。
- 基线：`main@c557af2`。分支：`wo/kinds-01`（只放 `analysis.md` 与只读脚本）。
- **本单零代码改动**。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单产物是 `governance/wo/WO-KINDS-01/analysis.md` + 一个给 Kevin 在服务器只读跑的统计脚本 `count-kinds.sh`（对 `/var/log/lykoi-audit/audit.jsonl` 只读 `jq`/`grep`，输出只有计数）。

## 1 · 事实（起点）

| 项 | 位置 | 事实 |
|---|---|---|
| 两套互不相交的 kind | `packages/lykoi-decide/src/index.ts:61-64` `KINDS = explore, record_note, queue_notification, initiate_chat, tend_inner, rest, contemplate`（数组序 = 候选渲染契约）；`packages/lykoi-converse/src/contract.ts:41` `CONVERSATION_KINDS = reply, silence, tool_call, promise_followup` | 自主 7、对话 4，无交集 |
| 内容必填 | decide `:71-73`（`record_note, queue_notification, initiate_chat, tend_inner`；`contemplate` 刻意豁免）；converse `contract.ts:44`（`reply, promise_followup`） | |
| 安全 kind | decide `:80` `rest`；converse `contract.ts:47` `silence` | |
| 自主消费点 | `packages/lykoi-reflow/src/index.ts:308`（rest）、`:314`（record_note）、`:323`（tend_inner）、`:331`（explore）、`:359`（contemplate）、`:366`（initiate_chat）、`:388`（queue_notification；`:387-390` 注释记 G-1：曾是 else 兜底把新 kind 变成通知，已改显式分支） | 七个显式分支 |
| 对话消费点 | `conversation.ts:1063,1068,1074,1081-1097` | 链式 if |
| 第三套"kind" | `packages/lykoi-converse/src/outcome.ts:35-42` `CycleOutcomeKind = reply, silence, followup, envelope_failed, missing_tool, tool_budget, ask_pending` | 周期结局，不是决策 |
| 可达性 | `parseEnvelope` 传 `kinds: CONVERSATION_KINDS`（`contract.ts:464`）；wake `evaluateMessage` 用缺省 `KINDS`（`lykoi-wake/src/index.ts:363`） | 两条路径各自封闭 |
| 提示词钉面 | `packages/lykoi-decide/test/prompt.test.ts:23-33`（`DECIDE_SYSTEM_PROMPT` 1601 / `d54726e3…`） | 收敛若改自主提示词 = sha 变更 |
| 自主工具面 | wake 的动作经 `KINDS` → reflow 分支 → kernel dispatch；对话的动作经 `TOOL_TABLE`（`contract.ts:150-230`，8 行）→ `#buildAction` → kernel dispatch | 同一内核，两种投影 |

## 2 · 要回答的问题（analysis.md 结构）

1. **每个自主 kind 的现状表**：kind / 内容必填 / reflow 分支做什么（file:line）/ 落到哪个 kernel action（`type`）/ 最近 30 天产线出现次数（Kevin 跑 `count-kinds.sh` 后回填；脚本按 `autonomy_wake_decided` 或等价事件的 `kind` 字段计数——执行方先在代码里找到该事件名与字段）/ 对应到 `TOOL_TABLE` 哪一行（若能）。
2. **两套投影的差异清单**：同一内核动作在两套里的名字、参数形态、内容必填、安全兜底各有何不同；哪些差异是路径性质决定的（自主没有"来话对端"）、哪些只是历史。
3. **收敛方案两案**，各写改动面（文件、提示词 sha 是否变、测试面）、风险、体量：
   - 甲案：保留两套枚举，抽一张共同的"动作表"（`ACTION_TABLE`，`TOOL_TABLE` 与 `KINDS` 都从它渲染），只收编数据不改行为；
   - 乙案：自主信封改用对话信封形态（`kind ∈ tool_call | silence | …`，工具名取自动作表），`KINDS` 退成候选清单的标签而非决策字段。
   每案给"产线零次 kind"的处置（保留 / 删）。
4. **不做的事**：不建 `delegate` kind（依据 PROBE-CAP-01 §5、§6）；说明委托为何走内核路由（37.8 验证器官 + 回执）而不是 kind。
5. **建议**：一句话选案 + 理由；两三条待 Kevin 裁定项。

## 3 · 边界

- 零代码改动；脚本只读。
- 不改任何提示词、不改测试。
- 不评估 Topic/Thread、不评估 Task Runtime。

## 4 · 验收

1. `analysis.md` ≤ 250 行，事实句，每条事实带 file:line。
2. `count-kinds.sh` 只含只读命令，输出只有计数与事件名。
3. 产线计数列在 Kevin 回填前留空并标"待 Kevin"。

## 5 · 报告要求

本单 report.md = analysis.md 本身 + 一段"脚本用法"。
