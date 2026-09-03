# WO-GK14-DISPATCHED-01 · 治理复核

- 复核：主治理 Agent，2026-09-03
- 对象：`wo/gk14-dispatched-01`，执行 4 提交 8bd5813 → 4dcabf0 → be47ecf → 5a8ae88（sonnet）；治理追加 1 提交 bb3cb31（见 §4）
- 基线：main@0fb2a10（代码树 482d644）
- 结论：**PASS，待裁合**

## 1 · 边界

| 项 | 读数 |
|---|---|
| 触碰文件 | `lykoi-converse/src/contract.ts`、`src/conversation.ts`、`test/contract.test.ts`、`test/approval-e2e.test.ts`、`governance/wo/WO-GK14-DISPATCHED-01/report.md`（+ bb3cb31 的 init-state.ts 模式位） |
| 独立复跑（`npm test` 全仓求和） | 999 / 988 / 0 / 11（基线 995 / 984 / 0 / 11，+4 全在 converse） |
| `npx tsc --noEmit` | 净 |
| 复跑后 `git status` | 净 |
| D-6 不动清单 | report §3 的 sha 表核对为改前改后相同；`git diff --stat main...HEAD` 只含上列文件 |
| 迁移 / 装配 / 依赖 / manifest | 零 |

## 2 · 定案对照

| 定案 | 核对 |
|---|---|
| D-1 `dispatched` = 到达 kernel 的事实 | `cycleRecord` 内 `dispatchGate === 'pass' ? tool.name : null`，`dispatched_arg_count` 随之；`wiredActions` 未给时闸二不触发，旧回归用例原样通过 |
| D-2 `dispatch_gate` / `tool_named` | 三字段与文档注释按单落地；非 tool_call 三者 null/0 |
| D-3 单一真源 | `toolDispatchGate(name, wiredActions?)` 在 contract.ts 一处；`#buildAction` 两分支体（事件名、`capability_gap` 载荷、error 串）逐字节未动，只把内联条件换成 `gate === …` |
| D-4 信封位置 | 仍在决策成立处、派发之前；只多传 `wiredActions` |
| D-5 GK-14 测试 | 过滤器去掉 `name in TOOL_TO_ACTION`；正断言加 `dispatch_gate==='pass'`；词表外反断言加三字段；新增未接线反断言（断言先出现 `u3_cycle_tool_unwired`，再 claimed=[] 且 action_dispatch=0） |
| D-6 | 成立 |

## 3 · 张力（不阻断）

- `u3_cycle_envelope` 多了两个字段。事件为遥测，全仓无 `dispatched_arg_count`/`u3_cycle_envelope` 的文档引用，下游读账脚本若按字段名取值不受影响。
- 未接线反断言依赖 `assemble()` 不接 terminal 时 `wiredActionCatalog` 确实把 `terminal.exec` 排除；用例已先断言 `u3_cycle_tool_unwired` 出现，防止该前提失效后用例空转。

## 4 · 顺带定案：init-state.ts 模式漂移根因

执行方在**新建**的工作树里又见到 `packages/lykoi-memory/src/init-state.ts` 为 755。核对：`lykoi-memory/package.json` 的 `bin.lykoi-init-state` 指向该文件，npm 建 bin 链接时给目标加执行位，而它以 100644 入库 ⟹ 任何一次 `npm ci` 之后树必脏。这就是 LANDING-H v1 在 §6 FATAL 的根因，与「谁改的」无关。`lykoi-gate/src/cli.ts` 同为 bin 目标但已按 100755 入库，所以从不漂。治理提交 bb3cb31 把 init-state.ts 入库为 100755，与 cli.ts 同口径；裁合后落地脚本里的 `git checkout -f -- .` 兜底仍保留。

## 5 · 落地要点（并入下一次落地）

- 改的是 `src/**.ts`，manifest 须重签；无迁移、无 unit 改动、无 root 工作以外的新事项。
- 落地后读数：`u3_cycle_envelope` 里 `dispatch_gate` 分布；`not_wired`/`unknown_tool` 若非零须与 `capability_gap` 同数。
