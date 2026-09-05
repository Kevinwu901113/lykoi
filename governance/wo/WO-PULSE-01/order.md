# WO-PULSE-01 · 对话路径接调节场：三断点（C-7）

- 状态：**已完成，待合并**（`wo/pulse-01`，2026-09-05，主治理 Agent 自执行；Kevin 令不派 GPT）。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：Kevin 裁定 R-B（"提进阶段一：对话路径接调节场与情绪脉冲回路三断点"）；memo 评估稿第 162-166 行（三断点原文）与第 173-174 行（"先补断点再谈 Expression Layer，断点是小单体量"）；白皮书 v1.3 候选 C-7。
- 基线：`main@c557af2`（与 INGRESS/INTERRUPT/UTTER/CHANNEL 无代码交叉；若排在它们之后，从最新分支尾开）。分支：`wo/pulse-01`。
- 包：`lykoi-converse`（主）、`lykoi-reflow`（脉冲消费）、`lykoi-memory`（只用既有 `getRegulation`/`applyRegulationCause`）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- **允许新增一个提示词块模板常量**（self_state 块），并在 `prompts.test.ts` 钉 sha；**不允许改既有常量**（`SYSTEM_PROMPT`、`ENVELOPE_SYSTEM_PROMPT` 等一字不动）。
- 调节场变量名与 CAUSES 名是枚举，不是正文；审计里可以出现。
- 自主路径（wake/snapshot）已接调节场（`packages/lykoi-snapshot/src/index.ts:385-400` `regulationBlock`），本单不动它，只补对话路径。

## 1 · 根因（事实）

| 断点 | 位置 | 事实 |
|---|---|---|
| ① 调节场不进对话 prompt | `packages/lykoi-converse/src/conversation.ts` 无 `getRegulation` 调用；`getRegulation` 调用者只有 `lykoi-snapshot/src/index.ts:390`、`lykoi-learn/src/l2.ts:151`；定义 `lykoi-memory/src/rw.ts:598` | 对话 LLM 看不到 `relational_tension` 等任何变量 |
| ② 信封 `情绪脉冲` 解析后只落审计 | 契约文本 `contract.ts:342`（"调节场唯一合法的因果入口"）、示例 `:322`（`["normal_interaction"]`）、`{causes}` 渲染 `:292,:372`（15 个 CAUSES 名）；解析 `:445-458`（`sanitizePulse`，S-42）、`:494`（`pulse:` 入 envelope）；审计 `:834`（`u3_cycle_envelope.pulse`）；`conversation.ts:158` 声明 `applyRegulationCause` 于 store 接口但 `packages/lykoi-converse/src` 零调用 | 回路断在消费侧 |
| ②′ 已有的对话侧调节写入 | `packages/lykoi-reflow/src/index.ts:617`（`conversationTurnReflow` 内 `applyRegulationCause('normal_interaction')`）、`:479,:522,:556`（contact_answered / contact_unanswered / owner_silence_anomaly） | 每轮固定打一次 `normal_interaction`；若脉冲也含它会双打 |
| ③ `selfState` 缝双侧留位无接线 | `conversation.ts:295`（`deps.selfState?: () => ConverseMessage | null`）、`:109`（`BLOCK_SELF_STATE='self_state'`）、`:645-676`（`#volatileTail` 在非 null 时 push 该块）、`:772,:781`（每次装配取一次）；`packages/lykoi-converse/src/index.ts` 装配处不传 `selfState` | 块名、位置、类型都在，没人喂 |
| 调节场数据形态 | `packages/lykoi-regulation/src/index.ts:34`（`REGISTRY`：变量名 → `RegulationVariable`）、`:69`（`CAUSES`：名 → `[变量, delta]`）；`rw.ts:562-`（`applyRegulationCause` 未知名抛错，SA-75） | 值域 0–1，`clamp01` |
| 装配测试 | `packages/lykoi-converse/test/assemble.test.ts`、`devstate.test.ts:34`（块标签合法性）、`prompts.test.ts:39-64`（14 个块字面量 chars+sha） | self_state 块加入后要进块顺序与 sha 断言 |

## 2 · 决定

- **D-1 接 ①③**：`packages/lykoi-converse/src/index.ts` 装配时传 `selfState: () => renderSelfState(store.getRegulation({ now: clock() }))`。`renderSelfState` 在 `conversation.ts`（或新文件 `self_state.ts`）：模板常量 `SELF_STATE_TEMPLATE`，渲染为一行一变量：`<变量名>: <0.000>`，按 `REGISTRY` 键序，值三位小数；仅当至少一个变量偏离其 `REGISTRY` 基线 ≥ 0.05 时输出，否则返回 null（块不出现，省 token）。不渲染 cognitiveEffects（那是 wake 的候选权重语义，对话路径不用）。
- **D-2 接 ②**：`#runCycle` 记录本轮最终被接受信封的 `pulse`（新私有 `#cyclePulse: string[]`，S-13 清态处重置）；成功路径 `:1511-1521` 调 `conversationTurnReflow` 时增参 `pulse`。`conversationTurnReflow`（reflow `:617` 附近）对 `pulse` 里每个名字调一次 `applyRegulationCause`，**跳过 `normal_interaction`**（它已固定打），单轮上限 3 个（超出丢弃，按 sanitizePulse 保序取前 3）。审计 `converse/pulse_applied {run_id, turn_id, applied: string[], skipped: number}`（只在 applied 非空时记）。
- **D-3 失败轮不打脉冲**：抛错/超时/打断的轮走 S-14 回滚，`#cyclePulse` 随之丢弃。
- **D-4 工具步中间信封的脉冲**：多步轮里只取**最后一个被接受的信封**（reply/silence/promise_followup 那个）的脉冲；工具步信封的脉冲不累加。
- **D-5 测试**：`converse/test/pulse.test.ts`：装配含 `self_state` 块当且仅当偏离 ≥ 0.05；块在 `#volatileTail` 顺序位置；信封 `["explore_completed","normal_interaction"]` → 恰一次 `explore_completed` 写入 + `normal_interaction` 仍只一次；四个名字 → 前三个；失败轮零写入；`u3_cycle_envelope.pulse` 与 `converse/pulse_applied.applied` 一致。`prompts.test.ts` 增 `SELF_STATE_TEMPLATE` chars+sha 钉面；`devstate.test.ts` 块标签断言含 `self_state`。

## 3 · 边界

- 不改契约文本，不改 `CAUSES`/`REGISTRY`。
- 不做 Learned Self（`narrativeFlag`）、不做 Relationship Moment 事件对象（memo 165-166 行，阶段二）。
- 不改 wake/snapshot 的调节场投影。
- 不引入新的调节变量。

## 4 · 验收

1. 全绿；新增用例 ≥ 6；`prompts.test.ts` 多一条钉面。
2. report 贴 sha 变更表（新增一行，无旧值）。
3. report 贴一段"对话路径调节场回路图"：prompt 投影点（file:line）→ 信封解析点 → 消费点 → 审计点。
4. 触及 manifest 域：是（converse、reflow src）。

## 5 · 报告要求

按 brief §4。
