# WO-GK14-DISPATCHED-01 · 执行报告

- 分支：`wo/gk14-dispatched-01`
- 基线：`main@0fb2a10`
- 尖 sha（本单落笔终点，push 前）：`be47ecf`
  - `8bd5813` contract.ts：`toolDispatchGate` + `cycleRecord` 改口
  - `4dcabf0` conversation.ts：`#buildAction` 改调 `toolDispatchGate`，`:942` 传 `wiredActions`
  - `be47ecf` 测试：contract 单测 + approval-e2e 改口/补场景

## 1 · 全仓测试数字

| | tests | pass | fail | skipped |
|---|---|---|---|---|
| 改动前（`main@0fb2a10`，`npm ci` 后首跑） | 995 | 984 | 0 | 11 |
| 改动后（`be47ecf`） | 999 | 988 | 0 | 11 |

`npx tsc --noEmit` 改动前后均净（零输出，exit 0）。

差值 +4 全部落在 `lykoi-converse`：

| 包 | 改动前 tests/pass/skip | 改动后 tests/pass/skip |
|---|---|---|
| lykoi-converse | 106 / 105 / 1 | 110 / 109 / 1 |
| 其余 15 包 | 逐包同前后一致（未触碰） | 同左 |

`lykoi-converse` 新增的 4 条测试：
- `contract.test.ts` ×3：`toolDispatchGate` 四条真值表；`cycleRecord` 三态（非
  tool_call / 闸放行 / 闸拦下 unknown_tool·not_wired）逐字对表；不给
  `wiredActions` 时行为逐字节不变的回归。
- `approval-e2e.test.ts` ×1：D-5 新增的「词表内但未接线」负断言场景。

## 2 · D-1..D-6 对照

| 定案 | 落实方式 | 位置 |
|---|---|---|
| D-1 | `cycleRecord` 新增可选入参 `wiredActions?: ReadonlySet<string>`；函数内调 `toolDispatchGate(tool.name, opts.wiredActions)` 复算是否真到达；`dispatched` 仅当结果为 `'pass'` 才记工具名，否则 `null`；`dispatched_arg_count` 同步（未派发记 0）。未给 `wiredActions` 时 `toolDispatchGate` 第二道闸不触发（`wiredActions === undefined` 直接放行），与旧行为逐字节一致——旧测试「D-1d 向后兼容：不给 wiredActions → 新闸不触发」原样通过，未改。 | `packages/lykoi-converse/src/contract.ts:604-664` |
| D-2 | 新字段 `dispatch_gate: 'pass'\|'unknown_tool'\|'not_wired'\|null`（非 tool_call 为 `null`）；新字段 `tool_named: string \| null`（tool_call 时恒为工具名，不看闸）。三字段语义写进 `cycleRecord` 上方文档注释，替换了原「sent_chars / dispatched 是事实不是意向」那段。 | 同上，注释块见 `contract.ts:625-644` |
| D-3 | 判定逻辑只在 `toolDispatchGate(name, wiredActions?)` 一处写：词表外 → `'unknown_tool'`；在词表但给了 `wiredActions` 且不含该动作类型 → `'not_wired'`；否则 `'pass'`。`cycleRecord` 与 `#buildAction` 都调用它，不再各自复制判定。`#buildAction` 改动后事件名（`CYCLE_UNKNOWN_TOOL_EVENT`/`CYCLE_TOOL_UNWIRED_EVENT`）、`capability_gap` 载荷（`wanted`/`reason`/`source`/`runId`）、两条 error 结果串（`` `unknown tool '${name}'` `` / `` `organ not wired: '${name}'` ``）逐字节未改——只是判定来源从内联条件换成函数调用，返回结果驱动同一套分支体。 | `contract.ts:597-619`（`toolDispatchGate` 定义）；`conversation.ts:1098-1141`（`#buildAction` 消费点） |
| D-4 | 信封事件仍在 `conversation.ts:942`（原行号；本单在该行前只加了 3 行注释，未挪动语句本身，`this.#log(CYCLE_EVENT, cycleRecord(...))` 调用位置结构不变）那个决策成立、派发之前的位置发出；未挪到派发之后。改动只是在传给 `cycleRecord` 的 opts 里多加一栏 `wiredActions: this.#deps.wiredActions`。 | `conversation.ts` `#log(CYCLE_EVENT, ...)` 调用点（原 `:942`，现因上文注释后移几行，语句本身未动） |
| D-5 | `selfReportedDispatches` 去掉 `name in TOOL_TO_ACTION` 过滤；正断言（`fakeTerminal()` 已接线）新增 `dispatch_gate === 'pass'` 与 `tool_named === 'terminal_exec'` 断言；词表外负断言（`web_search`）新增 `dispatch_gate === 'unknown_tool'` / `tool_named === 'web_search'` / `dispatched === null` 断言；新增未接线负断言（`terminal_exec` 不调 `fakeTerminal()`）：`claimed === []`、`action_dispatch` 行数 0、`dispatch_gate === 'not_wired'`、`tool_named === 'terminal_exec'`、`dispatched === null`。 | `packages/lykoi-converse/test/approval-e2e.test.ts`：`selfReportedDispatches`（原 :309-315）、正断言测试（原 :317-350）、词表外反断言（原 :372-387）、新增未接线反断言 |
| D-6 | 见下表 §3，逐块/逐文件 sha 前后相同。 | — |

## 3 · D-6 不动清单：sha 表（改动前 = 改动后）

| 项 | 定位 | sha256（改动前=改动后，全部一致） |
|---|---|---|
| `TOOL_TO_ACTION` 块（`contract.ts:126-136`，含定义行） | 未动 | `e0a3c2846a634b9af24ca62682f7267a86494565a7d52f3ae15268732efd35dd` |
| `ENVELOPE_SYSTEM_PROMPT` 块（`contract.ts:176-353`，模板字面量整段） | 未动 | `168a2b44e352437fe55d8cd4d8626d1273d4c8b69c0130ae5d2eb22ab040a8b8` |
| `packages/lykoi-decide/src/index.ts`（含 `DECIDE_SYSTEM_PROMPT`） | 全文件未动 | `5223f43282c6a3392e6ac5a753d678c45eb03bd58aee8493a76f325a641fc1e2` |
| `packages/lykoi-kernel/src/policy-core.ts` | 全文件未动 | `84aa6f57f5652ad632b7fe6759f53e36b8082f88f39858196060e44125acdbd4` |
| `packages/lykoi-kernel/src/**/*.ts`（35 个源文件，逐个 diff）| 全部未动 | `diff` 逐文件比对空差 |
| `packages/lykoi-organ-browser/**/*.ts`（src+test，同批 35 文件清单内） | 全部未动 | 同上，`diff` 空差 |

`git status --porcelain` 与 `git diff --stat` 复核：本单最终 diff 只触碰
`packages/lykoi-converse/src/contract.ts`、
`packages/lykoi-converse/src/conversation.ts`、
`packages/lykoi-converse/test/contract.test.ts`、
`packages/lykoi-converse/test/approval-e2e.test.ts` 四个文件，
`TOOL_TO_ACTION`/`DECIDE_SYSTEM_PROMPT`/`policy-core.ts`/kernel/
`lykoi-organ-browser` 均零改动。

## 4 · 偏离与治理复核点

1. **派工单文件的可见性**：执行开始时，工作树 `wt-gk14`（`wo/gk14-dispatched-01`
   分支，基线 `main@0fb2a10`）里不存在
   `governance/wo/WO-GK14-DISPATCHED-01/order.md`——该文件是在分支切出**之后**
   才提交到 `main`（`main@d732000`，晚于分支基线 `0fb2a10`），因此没有随
   `git worktree add` 落进这条分支。派工单原文是从另一份工作副本
   （`/Users/wukevin/Documents/lykoi/lykoi-cordis`，其 `main` 已推进到
   `13c4fe4`）读到的。本单未据此改动分支基线或做任何 rebase/merge——按派工单
   自述的基线（`main@0fb2a10`）与全仓读数（995/984/0/11）原样执行，仅记此
   事实供治理层核对派工单落盘时序是否符合预期（是否应在切分支**之前**先落
   订单，避免下一次执行方要跨仓库找单）。
2. **两条历史例外的消失未另单验证**：派工单 §2/§4 与旧测试附注
   （`approval-e2e.test.ts:362-371`，改动前原文）都提到 D-1d 曾引入的
   「自称但未到达」新例外——本单的改口（`dispatched` 由 `toolDispatchGate`
   复算）让这条例外与词表外那条例外同时消失，新增的「词表内未接线」负断言
   （见 §1/§2）就是对这一点的直接验证。这不是偏离，是订单 D-5 要求的交付，
   记在这里是提醒治理层：旧附注中"这属于新工单范围"的判断，其新工单就是
   本单，附注本身已随 D-5 一并改写，不再需要额外挂起。
3. **提交数与内容**：3 次功能性提交（源码×2、测试×1），未生成 manifest，
   未触碰 D-6 清单之外的任何文件；执行途中检测到工作树里
   `packages/lykoi-memory/src/init-state.ts` 有一处与本单无关的文件权限漂移
   （644→755，历史上 LANDING-H 脚本记录过同类漂移），已用 `chmod 644` 复位、
   未计入本单改动/提交（`git status` 复核为空）。
4. **无功能性偏离**：D-1..D-6 全部按订单原文落地，未发现需要治理层裁决的
   语义分歧。
