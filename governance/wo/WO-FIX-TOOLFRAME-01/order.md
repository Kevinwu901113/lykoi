# WO-FIX-TOOLFRAME-01 · 派工单

- 立单：主治理 Agent，2026-09-03 19:45 CST
- 状态：**执行中**（Kevin 19:50 放行；sonnet 于 wt-fix-toolframe-01 / wo/fix-toolframe-01 执行）
- 来源：探针 v3/v4（Kevin root 跑，2026-09-03 19:30–19:42）。v3：历史含原生 tool_calls/tool 帧时，json_object 必退化为 65 个空格（思考开关无关）；思考默认 + 回传 reasoning_content + 无 json 时 content 是 DSML 原生工具调用标记泄漏。v4：把同一工具步改写成**文本帧**（assistant = 信封 JSON 原文，user = 工具结果说明），思考×json 四组合各两次，**八次全部合法信封**。结论：J（reasoning_content 400）、K/L（json 空白）、19:19 沉默（DSML 泄漏 102 字）三病同源 —— seam 把工具步以 dsh 原生 ToolCallBlock / tool-result 帧发上 wire（M3-W2 定案，index.ts:288-316）。
- 基线：main@（本单提交）；代码树 = 产线钉点 5e6bf02；全仓 1021 / 1010 / 0 / 11，tsc 净
- 执行：sonnet（seam 一处映射 + 一张测试翻面 + 新增测试）
- 零迁移、零 profile 改动、零新依赖、零 root 落地工作（改 `packages/lykoi-converse/src/index.ts`，manifest 须重签）

## 0 · 一句话

只改 wire 渲染：`#messages` 里的 assistant/tool_calls 帧与 tool 结果帧**内部形状一字不动**（S-29 裁剪配对、回执探针、CallId 全部照旧），但 seam 发给 dsh-llm 时不再造 `tool-call` block / `tool-result` 帧，而是渲染成两条文本帧：assistant 文本 = 契约 tool_call 信封形状的 JSON；user 文本 = `[工具结果 <tool.name>] <content>`。不声明 tools（本来也没声明）。

## 1 · 定案

- **D-1** `index.ts` seam（约 287-316 行）：
  - `m.role === 'assistant' && m.tool_calls?.length`：`createAssistantMessage({ content: [{ type:'text', text }] })`，`text = JSON.stringify({ decision: { kind: 'tool_call', tool: { name, arguments: parsedArgs } } })`，其中 `parsedArgs = JSON.parse(c.function.arguments)`（解析失败则原字符串）。多 call 时按顺序各渲染一条（现实只有一条，cycleCall 单 call）。
  - `m.role === 'tool'`：`createUserMessage({ content: [{ type:'text', text }], source: { kind:'plugin', plugin:'lykoi-converse' } })`，`text = `[工具结果 ${name}] ${stripMarkup(m.content ?? '')}``；`name` 由同一 messages 数组里前面最近一条含 `tool_calls` 且 id 相同的 assistant 帧解析（预建 id→name 表），找不到则用 `tool_call_id`。`stripMarkup` 来自 hygiene.ts（页面正文若含 DSML 标记不许经 user 帧回流）。
- **D-2** `conversation.ts` 不动：`#executeCycleTool` 仍 push `{role:'assistant', content:null, tool_calls:[call]}`，`#appendToolResult` 仍 push `{role:'tool', tool_call_id, content}`；`#assemble`/裁剪/摘要/回执一律不碰。
- **D-3** 保持 J/K/L 的落点（step ≥ 1 `reasoningEffort:'off'`、带引导重试、重试跳去 json）**原样**。它们在文本帧下是无害的安全网；撤 `off` 是另一单（时延取舍，Kevin 裁）。
- **D-4** 测试：
  - `test/wire.test.ts` 的「M2#13 收口」用例**翻面**：断言第二次调用的 messages 里无 `tool-call` block、无 `tool-result` 帧；倒数第三、二条为 assistant 文本（可 JSON.parse，`decision.kind==='tool_call'`、`tool.name`/`tool.arguments` 与 cycleCall 一致）与 user 文本（前缀 `[工具结果 research_read_text] `，正文 = tool 帧 content）；契约 system 仍是最后一条（CACHE-INVERT 不破）。
  - 新增：① id→name 解析（含找不到时回退 id）；② tool 结果含 `｜｜DSML｜｜` 标记时 user 文本已剥净；③ `#messages` 内部仍是 role tool / tool_calls（从 assemble 或 history 面断言，证明 D-2）。
- **D-5** 注释：index.ts 该段注释改写为本单理由（v3/v4 探针结论、三病同源），保留 M3-W2 的原理由一句并注明为何让位。

## 2 · 不许

- 不改 `#messages` 形状、`cycleCall`、契约文本、prompts、hygiene、wake。
- 不改 J/K/L 的任何落点；不改温度/maxTokens/response_format 逻辑。
- 不新增事件；不动 profile/ 与 test/ 之外的 manifest 域外文件。

## 3 · 交付

- 分支 `wo/fix-toolframe-01`，工作树 `~/Documents/lykoi/wt-fix-toolframe-01`，基于本单提交后的 main。
- report.md：改动清单（文件:行）、翻面测试名、全仓测试数、tsc、偏离。

## 4 · 验收读数（落地后）

- step ≥ 1 的 json 首答不再恒空：`u3_cycle_retried{step≥1, json_mode:true, first_char:empty}` 应从 6/6 降到偶发。
- `first_char:other`（DSML 泄漏形态）应归零。
- 沉默率：L 当日 4 条 1 沉默为基线。
