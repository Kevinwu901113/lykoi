# WO-PULSE-01 · report

## 1 · 分支与提交

| 项 | 值 |
|---|---|
| 分支 | `wo/pulse-01`（从 main@3dbd670 开；代码等于产线 257a72e，3dbd670 之后只有治理文档） |
| 代码提交 | 5cb2e19 |
| report 提交 | 分支尾（本文件） |
| 执行方 | 主治理 Agent 自执行（Kevin 令：不派 GPT） |

## 2 · 改动文件

| 文件 | 一句话 |
|---|---|
| `packages/lykoi-converse/src/prompts.ts` | 新增 `SELF_STATE_TEMPLATE`（本单唯一新增提示词面；既有常量零变） |
| `packages/lykoi-converse/src/conversation.ts` | `SELF_STATE_DEVIATION_MIN` / `renderSelfState` / `selfStateBlock`；接口位 `selfState?: (now: Date) =>`；`#selfState()` 读失败记账；`#cyclePulse` 一轮一份，三种被接受 kind 处记录，S-13 清、S-14 丢，传 reflow |
| `packages/lykoi-converse/src/index.ts` | 生产装配接线 `selfState: (now) => selfStateBlock(store, now)` |
| `packages/lykoi-reflow/src/index.ts` | `conversationTurnReflow` 增参 `pulse` / `runId` / `turnId`；新增 `applyPulse`、`PULSE_APPLY_MAX`、`PULSE_SKIP_CAUSE`、`PULSE_APPLIED_EVENT` |
| `packages/lykoi-converse/test/pulse.test.ts` | 新增，10 例 |
| `packages/lykoi-converse/test/prompts.test.ts` | B 表 14 → 15 条，钉 `SELF_STATE_TEMPLATE` |
| `packages/lykoi-reflow/test/conversation-turn.test.ts` | +2 例（applyPulse 纯函数、conversationTurnReflow(pulse)） |

**本单触及 manifest 域：是，触及 src 文件 4**（converse 3 + reflow 1），无新 src 文件 → manifest 条数仍 117，落地重签。

## 3 · D-n 落实位置

| 决定 | 位置 |
|---|---|
| D-1 ① 调节场进对话 prompt | `conversation.ts:385` `renderSelfState`（REGISTRY 键序、一行一变量 `<name>: <0.000>`、偏离 ≥ `SELF_STATE_DEVIATION_MIN`(`:378`) 才出、不渲染 cognitiveEffects）；`:402` `selfStateBlock(store, now)`（`getRegulation` 纯读）；`prompts.ts:168` 骨架 |
| D-1 ③ selfState 缝接线 | `index.ts:489` 生产装配；`conversation.ts:300` 接口位签名 `(now: Date) =>`；`:814` `#selfState()`（抛 → `self_state_read_failed`，块不出）；`:828` / `:837` 装配与 layout 两处取一次；块位置 `:718`（易变尾部末位，undelivered 之后；既有代码） |
| D-2 ② 脉冲消费 | `conversation.ts:429` `#cyclePulse`；`:1142` 在 SILENCE / REPLY / PROMISE_FOLLOWUP 被接受处记录；`:1613-1615` 传 `conversationTurnReflow`；`reflow/index.ts:602` 参数；`:625` 消费点（在 `:622` 固定 `normal_interaction` 之后）；`:646` `applyPulse`：滤 `PULSE_SKIP_CAUSE`(`:636`) → 取前 `PULSE_APPLY_MAX`(`:634`)=3 → 逐个 `applyRegulationCause`（delta 仍只从 CAUSES 查）→ applied 非空才记 `converse/pulse_applied {run_id, turn_id, applied, skipped}`(`:638`) |
| D-3 失败轮不打脉冲 | `conversation.ts:1549`（S-13 清场）、`:1577`（S-14 回滚处丢）；失败轮不到 reflow |
| D-4 工具步中间信封不累加 | `:1142` 只在最终被接受的三种 kind 赋值（覆盖而非追加）；tool_call 步不赋值 |
| D-5 测试 | `converse/test/pulse.test.ts`（10）；`prompts.test.ts` +1 钉面；`reflow/test/conversation-turn.test.ts` +2；`devstate.test.ts` 词表已含 `self_state`（既有，未改） |

## 4 · 测试读数

| 项 | 读数 |
|---|---|
| `npm test`（分支树） | tests 1159 / pass 1148 / fail 0 / skipped 11 |
| 基线 main@3dbd670 | 1147 / 1136 / 0 / 11（+12 = pulse 10 + reflow 2） |
| `npm run typecheck` | 净 |
| `pulse.test.ts` | 10/10 |
| `prompts.test.ts` | 15/15（B 表 15 条钉面全等） |
| `conversation-turn.test.ts` | 6/6 |
| `cycle` / `assemble` / `e2e` | 27/27、18/18、4/4（既有对话面零正文断言过） |

pulse.test.ts 用例：renderSelfState 基线 null / 偏离四行；阈值恰 0.05 出块、0.049 不出、缺席变量跳行；装配基线时刻无块 → 打一因后块在 `time` 之后；有 undelivered 时序 `time, undelivered, self_state` 且真装配里模型看到 `relational_tension: 0.500`；接口位抛 → 记账不毁轮；reply `["explore_completed","normal_interaction"]` → explore_completed 恰一次、normal_interaction 仍一次、`pulse_applied` 与 `u3_cycle_envelope.pulse` 对得上；四名 → 前三 skipped 1；silence 信封脉冲照消费、无脉冲轮不记事件；LLM 抛 → 零 regulation 写入；工具步 `["rested"]` + reply `["action_taken"]` → 只写 action_taken。

## 5 · sha 变更表

| 常量 | 旧 chars + sha | 新 chars + sha | 改动 |
|---|---|---|---|
| `SELF_STATE_TEMPLATE` | —（新增） | 29 / `936c4350d8d5f1a3c81af9e12bf454c72d576e3da1a7f5247dc8b2ad8f0888f3` | self_state 块骨架 `[自我状态(调节场;只读;只在明显偏离基线时出现)]\n{}` |

既有 17 条钉面（A 表 3 + B 表 14）原样通过；`SYSTEM_PROMPT` / `ENVELOPE_SYSTEM_PROMPT` 一字未动。

## 6 · 对话路径调节场回路图

```
prompt 投影点   conversation.ts:828 #assemble → :814 #selfState → :402 selfStateBlock → :385 renderSelfState
                ↑ index.ts:489 selfState: (now) => selfStateBlock(store, now)   ↑ rw.ts:598 getRegulation（懒衰减纯读）
      ↓ 模型看到 self_state 块（易变尾部末位 :718）
信封解析点     contract.ts:494 parseEnvelope → :449 sanitizePulse（CAUSES 名、去重保序）
      ↓ conversation.ts:1142 #cyclePulse = 被接受信封的 pulse（SILENCE / REPLY / PROMISE_FOLLOWUP）
消费点         conversation.ts:1613 → reflow/index.ts:625 applyPulse → :646 逐名 store.applyRegulationCause
                （rw.ts:562：delta 只从 CAUSES 查；跳 normal_interaction；上限 3）
审计点         contract.ts:843 u3_cycle_envelope.pulse（信封说了什么）
               reflow/index.ts:638 converse/pulse_applied {run_id, turn_id, applied, skipped}（真打了什么）
               rw.ts mind_regulation {name, cause, delta, value_after}（落到哪个变量）
```

## 7 · 与 order 的偏差（都在允许范围内，列出供复核）

- 接口位签名改为 `selfState?: (now: Date) => ConverseMessage | null`（order 写 `() =>`）：懒衰减读依赖 now，`now` 由 Conversation 的时钟递入，不在接口位里裸 `new Date()`（CLAUDE.md 测试时钟纪律）。缝此前无任何生产者，签名改动零影响。
- 偏离判定按三位小数圆整后比：`0.25 − 0.2` 在浮点下是 `0.04999…`，呈现却是 `0.050`；按呈现精度比才不出"读数看着够了却不出块"。
- `skipped` = 信封脉冲总数 − applied 数（含被跳过的 `normal_interaction` 与超上限丢弃的）。上限取法 = 先滤 `normal_interaction` 再按信封序取前 3。
- 新增非对话面事件 `self_state_read_failed {error_type}`（与 `undelivered_context_read_failed` 同口径；无前缀，不需登记 gate 词汇；零正文）。

## 8 · 越界未做 / 候选小单（只列不做）

- 未改契约文本、CAUSES、REGISTRY、wake/snapshot 投影（边界 §3）。
- 候选 ①：契约 `contract.ts:342` 说"调节场唯一合法的因果入口"，本单起为真；但契约没告诉模型"每轮最多 3 个、`normal_interaction` 已固定打"。要不要写进契约文本（`ENVELOPE_SYSTEM_PROMPT` sha 变）留裁。
- 候选 ②：self_state 块的出块率没有直接审计（块不记事件，避免每轮一行）。若要读数，加一条 `self_state_injected {deviating}`（只在出块时记）。
- 观察项：`exploration_hunger` 是 accumulate 型（0.008/h，只升不降，泄压因只有 `explore_completed`）。长期不 explore 它会漂到 1.0 并让 self_state 块**每轮常驻**，模型每轮看到 `exploration_hunger: 1.000`。这是既定因果出口，不是缺陷，但落地后要看它是否把块变成常量噪声；若是，候选按"偏离且 24h 内有变化"再收紧。

## 9 · 给 Kevin 的落地提示

| 项 | 值 |
|---|---|
| 迁移 | 无 |
| 重签 manifest | 是（4 个 src 改动，条数仍 117） |
| 服务器只读命令 | 无 |
| gate 词汇 | `converse/pulse_applied` 走既有 `converse/` 前缀（`vocabulary.ts:95`），无需登记 |
| 落地后读数 | `converse/pulse_applied` 出现率与 `applied` 分布；`u3_cycle_envelope.pulse` 非空率；`mind_regulation` 里 cause 来自脉冲（非 normal_interaction / experience_recorded / contact_*）的占比；`self_state_read_failed` 预期 0 |
