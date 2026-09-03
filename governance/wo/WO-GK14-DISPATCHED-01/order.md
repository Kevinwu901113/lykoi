# WO-GK14-DISPATCHED-01 · 派工单

- 立单：主治理 Agent，2026-09-03
- 来源：WO-FIX-LOOP-01 执行方在 `approval-e2e.test.ts:362-371` 留下的附注（GK-14 新例外），治理层判定需要单独一单
- 基线：main@0fb2a10（代码树 = 产线钉点 482d644）；全仓 995 / 984 / 0 / 11，tsc 净
- 执行：sonnet（纯函数改口 + 测试，改动面小）
- 零迁移、零装配改动、零新依赖、零 root 落地工作（改的是 `packages/lykoi-converse/src/**.ts`，manifest 钉 src → 落地仍需重签，但可与下一单合并落地）

## 0 · 一句话

`u3_cycle_envelope.dispatched` 自称的是「她点了一个工具名」，不是「动作到达了 kernel」；把它改成事实，让 GK-14「自称 ⟹ 有 action_dispatch 行」在未接线与词表外两条路上都成立。

## 1 · 事实（file:line，基线）

- `contract.ts:598-633` `cycleRecord()`：`isToolCall = kind === TOOL_CALL && tool != null`；`dispatched: isToolCall ? tool.name : null`。注释自陈「dispatched 是事实不是意向」。
- `conversation.ts:942` 在决策成立后立刻 `#log(CYCLE_EVENT, cycleRecord(...))`；工具在之后 `conversation.ts:1021` 才经 `#buildAction` 走两道闸：
  - `conversation.ts:1099-1111` 词表外（`TOOL_TO_ACTION[name] === undefined`）→ `u3_cycle_unknown_tool` + `capability_gap{unknown_action}`，**不派发**；
  - `conversation.ts:1115-1127` 在词表但未接线（`wiredActions` 给了且不含该动作）→ `u3_cycle_tool_unwired` + `capability_gap{not_wired}`，**不派发**。
- 两条路上信封都已把 `dispatched` 记成了工具名 → 自称派发、audit 零 `action_dispatch` 行。
- `approval-e2e.test.ts:308-315` `selfReportedDispatches` 用 `name in TOOL_TO_ACTION` 把词表外的自称**过滤掉**才让反断言成立 —— 这是绕过，不是验证。`:362-371` 附注点明未接线那条路没有任何用例覆盖。
- `dispatched` 的消费者：全仓 grep 只有 converse 自己与 GK-14 两条测试（kernel 的 `delegation.ts` 里的 `dispatched` 是委托状态机，同名无关）。事件为遥测（`channel:'telemetry'`），不在 immutable 三名之内。
- `wiredActions` 已在 `conversation.ts` 的 deps 里（`index.ts:433` 从 `wiredActionCatalog` 注入）。

## 2 · 定案

- **D-1 `dispatched` = 到达 kernel 的事实**。`cycleRecord` 增一个可选入参 `gate: { known: (name) => boolean; wired?: (actionType) => boolean }`（或等价的纯数据：`toolToAction` 映射 + `wiredActions` Set），在函数内复算 `#buildAction` 的两道闸：`dispatched` 仅当 kind 为 tool_call、工具名在词表、且（给了 wired 时）动作已接线才记工具名；否则 `null`。`dispatched_arg_count` 同步（未派发记 0）。
- **D-2 新字段 `dispatch_gate`**：`'pass' | 'unknown_tool' | 'not_wired' | null`（非 tool_call 为 null）。她点了什么名字仍要留痕但**不叫 dispatched**：新字段 `tool_named: string | null`（tool_call 时恒为工具名）。三字段的语义写进 `cycleRecord` 的文档注释，替换现有「事实不是意向」那段。
- **D-3 闸的真源只有一处**。`#buildAction` 的两道判定不许复制粘贴到 contract.ts：把判定抽成 contract.ts 的纯函数 `toolDispatchGate(name, wiredActions?) → 'pass'|'unknown_tool'|'not_wired'`，`#buildAction` 与 `cycleRecord` 都调它；`#buildAction` 的事件名、`capability_gap` 载荷、错误串逐字节不变。
- **D-4 事件顺序不变**。信封仍在 `conversation.ts:942` 那个位置发；不把它挪到派发之后（那会改变所有下游读账的先后）。
- **D-5 GK-14 测试改口**。`selfReportedDispatches` 去掉 `name in TOOL_TO_ACTION` 过滤（自称即自称）；反断言保留词表外场景并新增**未接线**场景（`terminal_exec` 不 `fakeTerminal()`）：两者都须 claimed = [] 且 `action_dispatch` 行数 0，同时各自的 `dispatch_gate` 为 `unknown_tool` / `not_wired`，`tool_named` 为工具名。正断言不变（仍 fakeTerminal）并加断言 `dispatch_gate === 'pass'`。
- **D-6 不动**：`ENVELOPE_SYSTEM_PROMPT`、`TOOL_TO_ACTION`、`DECIDE_SYSTEM_PROMPT`、`#buildAction` 发的三个事件与 `capability_gap` 载荷、`policy-core.ts`、kernel、任何 `lykoi-organ-browser` 文件。

## 3 · 交付

1. `packages/lykoi-converse/src/contract.ts`：`toolDispatchGate`、`cycleRecord` 改口与注释。
2. `packages/lykoi-converse/src/conversation.ts`：`#buildAction` 改调 `toolDispatchGate`；`:942` 处把 `wiredActions` 传给 `cycleRecord`。
3. 测试：contract 单测（`cycleRecord` 三态 × `dispatch_gate`/`tool_named`/`dispatched`/`dispatched_arg_count` 逐字对表；`toolDispatchGate` 四条：词表外 / 未给 wired / 给了未接 / 给了已接）；`approval-e2e.test.ts` 按 D-5。
4. `governance/wo/WO-GK14-DISPATCHED-01/report.md`：基线与尖 sha、每包计数、D-1..D-6 对照、不动清单 sha 表（`contract.ts` 的 `ENVELOPE_SYSTEM_PROMPT` 与 `TOOL_TO_ACTION` 块 sha 前后相同）、偏离。

## 4 · 纪律

- 分支 `wo/gk14-dispatched-01`，基线 main；≥3 提交，中文提交信息，尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 全仓 `npx tsc --noEmit` 净、`npm test` 绿，数字进 report。不生成 manifest。不动 D-6 清单。
- 结束 `git push origin wo/gk14-dispatched-01`。
