# WO-FIX-TOOLSPEC-01 · 工具表带参数形状，一处真相渲染进契约

- 状态：**执行中**（Kevin 2026-09-04 01:40 放行，三单并行；opus 于 wt-fix-toolspec-01 / wo/fix-toolspec-01 执行，基线 main@4aec35f）
- 立单：2026-09-04 01:30 CST，主治理 Agent
- 分析：governance/docs/tool_step_structural_analysis_2026-09-04.md §1、§4
- 包：lykoi-converse（contract.ts、prompts.ts、测试）；不动 conversation.ts 的派发逻辑，不动 kernel/器官

## 1 · 根因

模型读到的三处工具信息（SYSTEM_PROMPT 散文、契约 `{tools}` 裸名、器官清单）都不带参数形状；参数只在动作层代码里，模型靠失败串学。SYSTEM_PROMPT 还含旧栈遗留的 `query` 用法。`notify_owner` 与 reply 的分工未写。

## 2 · 决定

- D-1 `contract.ts`：`TOOL_TO_ACTION: Record<string,string>` 改为 `TOOL_TABLE: Record<string, { action: string; signature: string; purpose: string }>`，10 项照旧；`TOOL_TO_ACTION` 保留为从表派生的投影（`Object.fromEntries(... .action)`），既有引用（`EnvelopeToolName`、`toolDispatchGate`、`#buildAction`）零改动。signature 与 purpose 以动作层实际接受的参数为准：
  - `terminal_exec(command)`；`browser_navigate(url)`；`browser_get_text(max_chars?)`；`browser_click(...)`/`browser_type(...)`/`browser_screenshot()`/`research_open(url)`/`research_extract_links(url)` 按各自 handler 实参写（执行方逐个核对 handler，不许猜）；`research_read_text(url, max_chars?)`（只收 url，不收 query）；`notify_owner(content)`，purpose：对话之外主动找 Kevin（问验证码、联系方式、后台跟进结果）；正在对话时直接 reply，不用它送答案。
  - 三个 in-cognition 工具同表同形（`vision_describe(attachment_id, question?)`、`promise_followup(task)`、`post_progress(content)`——实参以 `#handleVision/#handleFollowup/#handleProgress` 为准）。
- D-2 `envelopeToolNames()` 语义不变（仍是名字投影，供 wiredActions 过滤与测试）；新增 `renderToolTable(wiredActions?)` 渲染 `name(signature) — purpose` 每行一条，`{tools}` 改用它。过滤规则与 D-3a 相同：未接线不出现，in-cognition 三项恒在。
- D-3 `prompts.ts` SYSTEM_PROMPT：删「你的环境与工具」段里逐工具的散文行（虚拟电脑一句与「查数据优先结构化来源」一句保留，它们不是工具描述）；删「在 query 里加年份」句，改为不点名参数的说法（「换检索词重搜」）；notify_owner 相关两句并入表的 purpose 后删除。
- D-4 测试：契约渲染快照更新；新增用例断言 `{tools}` 每行含括号签名、`notify_owner` 行含 `content`、未接线工具不出现、in-cognition 三项恒在；`TOOL_TO_ACTION` 投影与表逐项相等。
- D-5 字节变化声明：SYSTEM_PROMPT 与契约文本变化 → 稳定前缀缓存失效一次，属预期；不改 `#messages` 形状、不改 M 的缝。

## 3 · 边界

- 不引入 JSON Schema、不引入函数调用 tools 声明、不给 wire 加字段。表是文本渲染，模型仍从信封里自由填 arguments。
- 不改动作层校验；猜错仍由动作层回失败串，模型自纠（重模型）。

## 4 · 验收

- tsc clean；converse 全包绿；契约渲染测试覆盖 D-2 四条。
- 落地后读数：`action_result` 里 `requires 'content'`/`url 必填` 类失败归零；`research_read_text` 不再出现 `query` 参数（bad_request 归零）。
