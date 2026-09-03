# WO-FIX-TOOLFRAME-01 · 收工报告

- 执行：sonnet 执行子 Agent，2026-09-03 20:20 CST（report.md 由主治理 Agent 代写入库：子代理被 harness 禁止写 report 文件，内容原文照录）
- 分支 `wo/fix-toolframe-01` tip 5b91e7b（基于 main@656f7a1）
- tsc `--noEmit -p .`：净
- 定向测试（wire/toolstep/cycle/e2e）：32/32
- 全仓 `npm test --workspaces --if-present`：1024 / 1013 / 0 / 11（基线 1021/1010/0/11；converse +3）
- 只动两文件：`packages/lykoi-converse/src/index.ts`、`packages/lykoi-converse/test/wire.test.ts`

## 改动

| 项 | 文件:行 | 内容 |
|---|---|---|
| D-1 | index.ts:63 | 引入 `stripMarkup`；移除不再用的 `CallId`、`createToolResultMessage` 导入 |
| D-1 | index.ts:189-283 | 新模块级导出 `toDshEnvelopeMessages(sliced, provider)`（原为 apply() 内逐条闭包 `toDshMessage`）：先建 id→tool-name 表；user → 文本帧；assistant 含 tool_calls → 每 call 一条 assistant 文本帧，`{decision:{kind:'tool_call',tool:{name,arguments:parsedArgs}}}`，arguments 解析失败回退原字符串；tool → `[工具结果 <name>] stripMarkup(content)` 的 user 文本帧，name 查表、缺则回退 tool_call_id；system 直通不变 |
| D-1 | index.ts:397 | 调用点改为 `toDshEnvelopeMessages(messages.slice(i), {route, model})` |
| D-2 | — | conversation.ts diff 为空：`#executeCycleTool` 仍 push assistant/tool_calls；`#appendToolResult` 仍 push role tool |
| D-3 | — | conversation.ts / contract.ts diff 为空：J/K/L 落点原样 |
| D-5 | index.ts:190-208 | 注释改写：v3/v4 探针结论、三病同源；保留 M3-W2 原理由一句并注明让位原因 |

## 测试（wire.test.ts）

- 主用例翻面（:106）：无 tool-call/tool-result block；找到 assistant tool_call 信封帧并核 `decision.tool.name/arguments` 与 cycleCall 一致；紧随其后一条为 `[工具结果 research_read_text] ` 前缀的 user 帧；最后一条为契约 system（以「上面是你此刻的全部处境」开头）；旧折文本形态（`[tool_calls]`、裸 `[工具结果]`）不出现。既有 M4-W1 断言（signal、reasoningEffort off、vision seam）保留。
- D-4①（:252）id→name 解析，含找不到回退 tool_call_id。
- D-4②（:282）tool 结果含 `｜｜DSML｜｜tool_calls` 标记时 user 文本已剥净。
- D-4③（:308）经 fixture 的 FakeLlm（绕过 index.ts 映射）证 `#messages` 内部仍是 assistant+tool_calls（content null）与 role tool+tool_call_id。

## 偏离（只报）

- 工单 D-4 写的「倒数第三、二条」不准：`#volatileTail`（conversation.ts:622-656，S-25）总在契约前插一条 `[当前时间]` system 帧，实际为倒数第四、三条。测试改为按 findIndex 定位并断言工具结果帧紧随其后（S-29 相邻），契约以固定开头文字而非下标断言。语义与工单一致。
- 该 fixture 里工具结果是 `organ not wired: 'research_read_text'`（M2#13 fixture 的 `research_browser.read_text` 与 `research_read_text` 名字不一致），既有行为，与本单无关；测试只断前缀。

## 提交

- 5c32da7 D-1：seam 工具步改回文本帧
- 5b91e7b D-4：wire.test.ts 翻面 + 三条新测试
