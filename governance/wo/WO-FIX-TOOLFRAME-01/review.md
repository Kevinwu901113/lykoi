# WO-FIX-TOOLFRAME-01 复核

- 复核人：主治理 Agent
- 复核对象：分支 `wo/fix-toolframe-01` tip `d5400ec`（代码 `5c32da7` D-1 + `5b91e7b` D-4 + `d5400ec` report.md），基线 main@`656f7a1`
- 结论：**PASS**

## 一、逐条对照

| 条 | 要求 | 实际 | 判 |
|---|---|---|---|
| D-1 | 缝处改帧：assistant tool_calls → assistant 文本帧（信封 JSON）；tool → user 文本帧 `[工具结果 <name>] <content>` | `packages/lykoi-converse/src/index.ts` 新增导出 `toDshEnvelopeMessages(sliced, provider)`，替换原 apply 内闭包 `toDshMessage`；原生 `tool-call`/`tool-result` block 映射整体删除；name 按 `tool_call_id` 从预建映射解析，解析不到回退成 id；工具结果经 `stripMarkup` 剥 DSML（S-32） | ✅ |
| D-2 | `conversation.ts` 不动，`#messages` 内部形状不变 | 差异文件仅 `index.ts` 与 `wire.test.ts`；D-4③ 用例断言 `#executeCycleTool`/`#appendToolResult` 仍 push 原生 role tool / tool_calls | ✅ |
| D-3 | J（工具步后关思考）/K（not_json nudge）/L（json_mode 只在首跳）三处保留 | `conversation.ts` 零改动，三处逻辑原样 | ✅ |
| D-4 | M2#13 翻面 + 新增用例 | #13 改为断言无原生 block、assistant 信封帧 `decision.tool.name/arguments` 正确、下一条为 `[工具结果 research_read_text] ` user 帧、最后一条为契约；新增 ①id→name 与回退 ②DSML 剥净 ③内部形状 | ✅ |
| D-5 | 缝处注释说明为何不走原生工具帧 | 函数头注释引探针 v3/v4 结论（原生帧 → 65 空格 / 400 / DSML 泄漏；文本帧 8/8 通过） | ✅ |

偏差一处，接受：工单 D-4 按「倒数第三/二条」定位，实际因 S-25 `[当前时间]` 挥发帧夹在中间，执行方改用 `findIndex` 定位 assistant 信封帧并断言其后一条即工具结果帧，语义等价且更稳。

## 二、我方独立验证（worktree `wt-fix-toolframe-01`，tip d5400ec）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit -p .` | clean |
| 定向 `wire/toolstep/cycle/e2e` | 32/32 |
| `lykoi-converse` 全包 `npm test` | 128 tests，127 pass，0 fail，1 skipped（既有 skip） |
| 执行方报告的全仓 | 1024/1013/0/11 skipped（既有） |

## 三、风险评估

- 影响面：仅出线那一缝。内部状态、审计事件、契约、重试策略均不变。
- 供应商侧：换成文本帧后 thinking×json 四种组合均得有效信封（探针 v4），预期 step≥1 的 `first_char:other`（65 空格）归零、DSML 泄漏归零。
- 回退：单文件回退即可（`index.ts` 恢复原生映射），无数据迁移。
- 待观察：TOOLFRAME 落地后 J 的 step≥1 `reasoningEffort:'off'` 是否还需要，由 Kevin 另裁，不在本单。

## 四、落地要点（LANDING-M）

- 脚本沿 landing-l-jsonmode.sh 派生：`EXPECT_OLD=5e6bf02c68d367d0e647c69cd8ea9218eccadacc`，`NEW_SHA=<裁合 sha>`，bundle `5e6bf02..main`，backup 前缀 `backup-pre-toolframe-`，ops action `landing-m-toolframe`，wo/detail 整行重写，回滚指针 `5e6bf02`。
- 清单仍 113 条（无新增文件），§4 重签 + gate 必须 PASS。
- 内容断言（§0 或 §3 后）：
  - `packages/lykoi-converse/src/index.ts` 含 `export function toDshEnvelopeMessages(` 与 `[工具结果 ${name}] ${stripMarkup(m.content ?? '')}`（用 `grep -F`）；不含 `createToolResultMessage`。
  - J/K/L 三处仍在（用 `grep -F`）：`conversation.ts` 含 `step >= 1 ? { reasoningEffort: 'off'`（J）与 `json_mode: jsonMode`（L）；`contract.ts` 含 `{ role: 'user', content: JSON_RETRY_NUDGE }`（K）。
- §6 服务器实证：跑 `wire.test.ts`、`cycle.test.ts`、`e2e.test.ts`（各慢 ~5 min，信息性不回滚）。
- 落地后读数：`u3_cycle_retried`/`u3_cycle_failed` 中 step≥1 的 `first_char:other` 应为零；step≥1 首跳 `json_mode:false` 空回复率；沉默率对比 L 后基线。
