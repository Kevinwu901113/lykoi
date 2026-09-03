# WO-FIX-NOTJSON-01 · 派工单

- 立单：主治理 Agent，2026-09-03
- 状态：**已落地**（LANDING-K，2026-09-03 17:34 CST，产线钉 main@f449fda，一次通过；服务器实证 cycle 19/19、wake 12/12，downtime 6 秒，NRestarts 0；**已验 18:23 CST**：一轮内 step 1 空白 + step 2 brace 两次 not_json 均被引导拉回，17.5 s 闭环 112 字）
- 来源：LANDING-J 验收（2026-09-03 16:39–16:52 CST）。第二跳 400 已修，但 16:39 那条仍沉默：step 1 两次采样都返回 58/59 token 的**纯空白**（finish_reason stop、有 charge、`first_char:empty`），有界重试打满 → `u3_cycle_failed{not_json, attempts:2}` → silence。16:51 那条 step 0 也空过一次（重试成功后 24 秒闭环）。今日 5 跳 3 跳出过空白；与自主路径 `autonomy_wake_retried{not_json}`（约 1/6 拍）同源 —— DeepSeek json_object 模式的空输出（DeepSeek 文档自认「可能偶发返回空内容，建议改提示词缓解」）。Kevin「可以试试」（16:58）。
- 基线：main@3d13025（代码树 = 产线钉点 47fb05a）；全仓 1015 / 1004 / 0 / 11，tsc 净
- 执行：sonnet（两处重试改口 + 一个常量 + 事件补字段 + 测试）
- 零迁移、零 profile 改动、零新依赖、零 root 落地工作（改 `packages/lykoi-{converse,wake,decide}/src/**.ts`，manifest 须重签）

## 0 · 一句话

重试不再原样重发：第二次起在末尾追加一条引导（「上一次输出是空的，只输出那一个 JSON 对象」），有界重试从 1 次放到 2 次；converse 的重试/失败事件补 `reasoning_len`，让「答案被吞进 reasoning」在对话路径上也可读数；wake 的那一次重试同样带引导。不碰温度、不关 json 模式。

## 1 · 事实（file:line，基线）

**重试是原样重发**

- `conversation.ts:910-947` `for (let attempt = 0; ; attempt += 1)`：每次 `this.#completion(step, signal)`，**同一份 messages、同一份 options**；`:925` `attempt < ENVELOPE_RETRY_MAX && reason === FAIL_NOT_JSON` 才重试；`:926-928` 注释自陈「空回复/截断是采样偶发，重试有实际收益」。
- `contract.ts:63` `ENVELOPE_RETRY_MAX = 1`。
- `contract.ts:474-492` `classifyFailure`：`extractJson` 抛 → `[FAIL_NOT_JSON, 'first_char:'+firstCharClass(text)]`；`firstCharClass`（`:413-425`）trim 后为空 → `'empty'`，以 ``` 开头 → `'fence'`（fence **不会被解析**，同样归 not_json —— 所以「关掉 json 模式让她随便写」不是出路，会把空白换成代码块）。
- `lykoi-wake/src/index.ts:284-295`：`extractJson(reply.content)` 抛 → 记 `autonomy_wake_retried` → `reply = await deps.llm(messages, llmMeta)` —— 同一份 `messages`。

**实证：空白是确定性的退化，不是采样噪声**

- audit 2026-09-03T08:39:55/56Z（runId converse-626114512-229）：attempt 1 `promptTokens 7697 / completionTokens 58`，attempt 2 `promptTokens 17（缓存命中）/ completionTokens 59`，`u3_cycle_failed{content_chars:58, has_content:true, finish_reason:'stop'}`。信封调用不传 temperature（`conversation.ts` 只有 summary 传 `SUMMARY_TEMPERATURE`，`:845`），DeepSeek 默认 1.0 —— 温度 1.0 下两次得到同样 58 个 token 的空白，说明该前缀上模型已进入退化模式，抬温度不是杠杆；改变前缀（追加引导）才是。
- 同轮诱因：`browser_action{research_read_text, baidu.com, chars:0}` —— 工具结果为空文本后她「无话可说」。16:51 那条 step 0 的空白无此诱因，说明空白并不只由空工具结果触发。

**reasoning_len 缺口**

- WO-FIX-TOOLSTEP-01 D-2b 只给了 wake 的 `autonomy_wake_retried` 和 converse 的 `turn_failed{llm_finish}` 记 `reasoning_len`；converse 的 `u3_cycle_retried`（`conversation.ts:928`）与 `u3_cycle_failed`（`:932-944`）**没有**。`ConverseLlmResult`（`conversation.ts:177-184`）没有 `reasoningLength` 字段；接缝 `index.ts:365-370` 返回 `{content, finishReason, promptTokens, completionTokens, extraKeys: []}`，而 `result.reasoningLength` 已经在 lykoi-llm 的返回里（LANDING-J 后）。

**两条路径的共同真源**

- converse 的 `classifyFailure` 与 wake 的重试判定都用 `lykoi-decide` 的 `extractJson`（`packages/lykoi-decide/src/index.ts:549`）。引导语放同一处，两条路径各引一次。

**消息形状**

- `ConverseMessage`（`contract.ts:249-254`）`{role, content, tool_calls?, tool_call_id?}`；接缝 `toDshMessage`（`index.ts:280`）把 `user` 角色映成 `createUserMessage`。信封消息 = `buildEnvelopeMessages(assembled, wired)` = 装配 + 末尾一条 system 契约（`contract.ts:272`）。
- wake 接缝（`lykoi-wake/src/index.ts:497-513`）把前导 system 之外的所有消息都映成 user 消息 —— 末尾追加一条 `{role:'user'}` 引导直接可用。

**既有测试**

- `cycle.test.ts:73-106`：`u3_cycle_retried` 载荷 `deepEqual {reason, detail, step, attempt}`（四键，`:81`），「恰一次」语义（`:73` 标题）—— 本单要改口。
- `wake.test.ts:179-184, 240-247`：重试 `calls.length === 2` 语义不变；`:209-217, 220-238` `reasoning_len` 用例不变。

## 2 · 定案

- **D-1 引导语常量**：`packages/lykoi-decide/src/index.ts` 在 `extractJson` 旁导出 `JSON_RETRY_NUDGE`（string）：
  `你上一次的输出是空的，或者不是一个 JSON 对象。现在只输出那一个 JSON 对象：以 { 开始、以 } 结束，不要代码块，不要任何别的字。`
  一处真源，converse 与 wake 各 import 一次；不允许各抄一份。
- **D-2 converse 重试带引导**：`#completion(step, signal, nudge?: boolean)`（或等价形态）；`attempt >= 1` 时 messages = `[...buildEnvelopeMessages(...), { role: 'user', content: JSON_RETRY_NUDGE }]`。**引导是临时的**：不 push 进 `#messages`、不进历史、不进摘要、不进下一步 step 的装配。attempt 0 的请求字节不变（messages、options 同今）。不改 temperature、不改 responseFormat、不改 `reasoningEffort` 规则（step ≥ 1 仍 off）。
- **D-3 有界重试 1 → 2**：`contract.ts:63` `ENVELOPE_RETRY_MAX = 2`。`u3_cycle_retried.attempt` 取 1、2；`u3_cycle_failed.attempts` 最多 3。每次重试仍是完整 charge（缓存命中时便宜，实证 attempt 2 prompt 17 token）。周期 `cycleTimeoutS` 的 signal 照旧递到每一跳，不另加时限。
- **D-4 converse 事件补 `reasoning_len`**：`ConverseLlmResult` 加可选 `reasoningLength?: number`；接缝 `index.ts:365-370` 填 `result.reasoningLength`；`u3_cycle_retried` 与 `u3_cycle_failed` 各加 `reasoning_len: result.reasoningLength ?? 0`（与 wake 口径一致）。
- **D-5 wake 重试带引导**：`lykoi-wake/src/index.ts:294` 的第二次调用改为 `deps.llm([...messages, { role: 'user', content: JSON_RETRY_NUDGE }], llmMeta)`；仍只重试一次（WO-FIX-LOOP-01 D-3a 的"不做循环"不变）；`autonomy_wake_retried` 载荷不变。wake 的消息类型若不含 `user` 角色，按最小改动扩 role 联合，不动 `buildMessages`。
- **D-6 不动**：`ENVELOPE_SYSTEM_PROMPT`、`SYSTEM_PROMPT`、`TOOL_TO_ACTION`、`parseEnvelope` / `classifyFailure` / `firstCharClass` 语义、json 模式恒开、温度、`lykoi-llm`、`lykoi-llm-deepseek/**`、`profile/**`、kernel、organ-browser。

## 3 · 交付

1. `packages/lykoi-decide/src/index.ts`：`JSON_RETRY_NUDGE`。
2. `packages/lykoi-converse/src/contract.ts`：`ENVELOPE_RETRY_MAX = 2`。
3. `packages/lykoi-converse/src/conversation.ts`：`#completion` 引导形态、重试循环、两事件 `reasoning_len`、`ConverseLlmResult.reasoningLength`。
4. `packages/lykoi-converse/src/index.ts`：接缝填 `reasoningLength`。
5. `packages/lykoi-wake/src/index.ts`：D-5。
6. 测试：
   - `cycle.test.ts:73-106` 改口：三次全空 → `u3_cycle_retried` 两条（attempt 1、2，各带 `reasoning_len`），`u3_cycle_failed.attempts === 3`；fake llm 记录的三次调用里，第 1 次末尾是 system 契约、第 2/3 次末尾是 `{role:'user', content: JSON_RETRY_NUDGE}`；除末尾这一条外三次 messages 逐字相等；options（purpose/responseFormat/reasoningEffort/signal）三次相等。
   - 新用例：首空次好 → 只一条 retried、正常 reply；**下一轮** `send` 的首次调用 messages 里不含引导语（引导不进历史）；step ≥ 1 的重试同时带 `reasoningEffort:'off'` 与引导。
   - 新用例：fake llm 回包带 `reasoningLength: 137` 且非 JSON → `u3_cycle_retried.reasoning_len === 137`；三次都带 → `u3_cycle_failed.reasoning_len` 为最后一次的值。
   - `wake.test.ts`：重试那次调用的 messages = 首次 messages + 末尾一条 user 引导（逐字 `JSON_RETRY_NUDGE`）；首次调用 messages 不含引导；`:179-184`、`:240-247` 的 `calls.length === 2` 照旧。
   - `lykoi-decide` 单测：`JSON_RETRY_NUDGE` 非空、含「JSON」四字（DeepSeek 文档要求提示词里出现 json 才稳定）。
7. `governance/wo/WO-FIX-NOTJSON-01/report.md`：基线与尖 sha、每包计数、D-1..D-6 对照、不动清单 sha 表（`SYSTEM_PROMPT`、`ENVELOPE_SYSTEM_PROMPT`、`TOOL_TO_ACTION` 前后相同）、偏离。

## 4 · 纪律

- 分支 `wo/fix-notjson-01`，基线 main；≥3 提交，中文提交信息，尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 全仓 `npx tsc --noEmit` 净、`npm test` 绿，数字进 report。不生成 manifest。不动 D-6 清单。不碰 profile、secrets、任何服务器。
- 结束 `git push origin wo/fix-notjson-01`。
