# WO-FIX-THINKPOLICY-01 复核

- 复核人：主治理 Agent，2026-09-04 02:45 CST
- 复核对象：分支 `wo/fix-thinkpolicy-01` tip `9fab7a9`（执行方 e4e4d1c D-0 / d1e5fc7 D-3 / fab43c8 D-5 / 6363b39 补正；治理侧 9eda71a D-2 / 9fab7a9 report.md），基线 main@`4aec35f`
- 结论：**PASS**

## 一、逐条对照

| 条 | 要求 | 实际 | 判 |
|---|---|---|---|
| D-0 | `u3_cycle_envelope` 补 prompt_tokens / completion_tokens / reasoning_len | `contract.ts` cycleRecord 三键追加在 grounded 之后，缺席 null/null/0 与 failed 事件对齐；`conversation.ts` 循环外 `lastResult` 记成立那一跳；零正文口径有用例断言 | ✅ |
| D-1 | 探针 v5 | Kevin root 跑，14/14 合法，结果与定档记 order.md §5 | ✅ |
| D-2 | profile 显式档位 | `cordis.prod.yml` `llm-deepseek` `config: { thinking: enabled, reasoningEffort: low }`；vendor Config 两字段均为可选 union，合法；不与 disabled 同配 | ✅ |
| D-3 | 删 per-step 覆盖 | 原 912 行整行删；`step` 形参随删；接缝类型保留、注释改口 | ✅ |
| D-4 | 定档规则 | low：step 0 ≤ 15 s、step ≥ 1 ≤ 5 s、合法率 100%；不取 high；off 在 step 0 有放弃工具的读数 | ✅ |
| D-5 | 测试翻面 + 新增 | 红 4 条翻为「键不在」（toolstep 2、wire 1、cycle 1），同用例无关断言未动；新增 3 条 D-0 用例 | ✅ |

偏差三处，均接受：`step` 死参数删除；`ConverseLlmFn.reasoningEffort` 类型保留（删会牵动四处，超范围）；翻面范围为三文件 4 条而非仅 wire。

## 二、我方独立验证（worktree `wt-fix-thinkpolicy-01`）

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit -p .`（6363b39） | clean |
| lykoi-converse（6363b39 与 9eda71a 各跑一次） | 131 / 130 / 0 / 1（既有 skip） |
| lykoi-gate（9eda71a） | 72 / 72 |
| lykoi-organ-browser（9eda71a） | 66 / 66 |
| lykoi-llm-deepseek（9eda71a） | 7 / 7 |
| 执行方全量（6363b39） | 1027 / 1016 / 0 / 11 |
| vendor `resolveThinking` 读码 | 无 config → `{}`，wire 无两键；执行方 ③ 属实，分析稿 §3 与工单 §1 已改口 |

## 三、风险评估

- profile 改动没有测试覆盖真实 adapter 的 config 解析（wire 测试用假 adapter）；vendor schema 读码确认合法。落地 §5 「production assembly up」是真实检查，起不来按回滚指针退。
- `prompt_tokens` 语义是缓存未命中部分（vendor 不相交约定），读数时须知；恰好能分开思考长与缓存未命中。
- J 的安全网撤除：文本帧下思考开着也干净（探针 v4/v5 S1 形态 4/4 合法）。落地后看 step ≥ 1 的 `first_char:other` 仍为零。
- `cordis.prod.yml` 在 gate 根属清单内，重签覆盖，条目数不变。
- 回退：profile 一行 + conversation.ts 一处。

## 四、落地要点

- 与 ORGANOK / TOOLSPEC 同批（LANDING-N）。脚本须把「profile 零改动」断言改为：`git diff --quiet $EXPECT_OLD HEAD -- deploy package.json package-lock.json`（profile 移出），并加内容断言 `cordis.prod.yml` 含 `reasoningEffort: low` 与 `thinking: enabled`；`conversation.ts` 不含 `reasoningEffort: 'off'`（J 撤除）；`contract.ts` 含 `prompt_tokens: opts.promptTokens ?? null`（`grep -F`）。
- §6 服务器实证跑 `cycle.test.ts`、`toolstep.test.ts`、`wire.test.ts`。
- 落地后读数：`u3_cycle_envelope` step 0 的 `elapsed_ms` 对 `prompt_tokens` / `reasoning_len`；`prompt_tokens` 小值比例 = 缓存命中率；step ≥ 1 `first_char:other` 仍零；step 0 tool_call 比例不掉（off 那种「没法查」不出现）。
