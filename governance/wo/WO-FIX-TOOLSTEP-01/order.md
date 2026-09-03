# WO-FIX-TOOLSTEP-01 · 派工单

- 立单：主治理 Agent，2026-09-03
- 状态：**待执行**
- 来源：2026-09-03 13:09–13:12 CST Kevin 在 Telegram 发 4 条，4 条全部沉默。audit 实证四轮都死在**工具步之后的第二跳**：`u3_cycle_envelope{tool_named}` → `action_dispatch`/`action_result`（第一轮真的经 wttr.in 拿到了东莞天气）→ 第二跳 `budget/charge 0/0` 瞬时返回 → `LlmFinishError` → `chat_turn_rolled_back{dropped_messages:3}` → `converse/silence`。根因由 root 探针（`probe-deepseek-toolstep.sh` A/B/C、`-v2.sh` D/E，2026-09-03 下午）定罪，见 §1。
- 基线：main@1317cc8（代码树 = 产线钉点 04bef07）；全仓 999 / 988 / 0 / 11（LANDING-I 记录），tsc 净
- 执行：sonnet（三处小改 + 一处纯函数过滤 + 测试；改动面集中在 converse / llm 两包，wake 只加一个字段）
- 零迁移、零 profile 改动、零新依赖、零 root 落地工作（改的是 `packages/lykoi-{converse,llm,wake}/src/**.ts`，manifest 钉 src → 落地需重签）

## 0 · 一句话

DeepSeek v4-flash 默认开思考；她在工具步之后把「带 `tool_calls` 的 assistant 帧」原样回传时没带 `reasoning_content`，DeepSeek 直接 400，第二跳零 token 失败，整轮回滚成沉默。修法：工具步之后的信封跳**关思考**（探针 B/D 已验证通过），并把这类失败的 code/status 记进 audit；顺手把提示词与契约白名单里 5 个根本没接线的工具名按接线过滤掉（四轮里三轮她点的是未接线的 `research_open`）。

## 1 · 事实（file:line，基线）

**失败链路**

- `conversation.ts:891` `#runCycle` 的 `for (let step = 0; step <= MAX_TOOL_STEPS; ...)`；每一步经 `:874-875` `#completion` → `buildEnvelopeMessages(this.#assemble())` → `this.#deps.llm(messages, { purpose:'envelope', responseFormat, runId, signal? })`。opts 类型在 `conversation.ts:186-202`（`ConverseLlmFn`），**没有 reasoningEffort 一类的思考开关**。
- `conversation.ts:1008` 工具步把 `{ role:'assistant', content:null, tool_calls:[call] }` 压进 `#messages`；`#appendToolResult` 压 `{ role:'tool', tool_call_id, content }`。下一步 `#completion` 把它们原样送回。
- `index.ts:280` `toDshMessage`：assistant+tool_calls → `createAssistantMessage({content:[{type:'tool-call',…}]})`，**无 reasoning 块**；`index.ts:327-360` llm 接缝 → `ctx.lykoiLlm.call({provider, model, system, messages, maxTokens?, temperature?, responseFormat?, signal?})`，只透传这几项。
- `packages/lykoi-llm-deepseek/vendor/index.js` `serializeMessages`：assistant 帧只有在 message 含 reasoning 块时才写 `reasoning_content`；`resolveThinking(options, defaults)`（`vendor/index.js:57-67`）：`options.reasoningEffort === 'off'` → 线上 `thinking:{type:'disabled'}`；`defaults.thinking` 未配置时不写 thinking 键 → **DeepSeek 端默认 = 思考开**。
- `profile/cordis.prod.yml`：`llm-deepseek` 无 config 块（thinking/reasoningEffort 都未设）；converse `model: deepseek-v4-flash`、`cycleTimeoutS: 180`。
- dsh-llm `resolveCallWithInfo`（`node_modules/@deepseek-ai/dsh-llm/lib/index.js:1462-1485`）按 adapter 报的 `reasoning.efforts` 校验 `reasoningEffort`；本 adapter 在 thinking 未 disabled 时报 `REASONING_EFFORTS`（`vendor/index.js:1222-1226`，含 `off`）→ 每次调用传 `reasoningEffort:'off'` **合法**，不会抛 `UNSUPPORTED_REASONING_EFFORT`。
- `packages/lykoi-llm/src/index.ts:170-178` `call()`：`this.#ctx.llm.stream(options)` 整个 options 透传；循环只消费 `text-delta`/`usage`/`finish`，**`reasoning-delta` 被丢弃、不计数**；`:205-212` 失败 finish → `throw new LlmFinishError({reason, route, usage?, textLength})`，`reason.failure` 含 `code/status/message/requestId`（`:100-108`）。
- `index.ts:574-578` converse 的 catch：`converse/turn_failed` 只记 `error: err.name`（S-21：不出 str(exc)）。**code 与 status 没有落任何地方** —— journal 对这次事故一行都没有，audit 只看得见 `LlmFinishError` 五个字。

**探针实证（DeepSeek 官方端点，model deepseek-v4-flash，response_format json_object）**

| 探针 | 构造 | 结果 |
|---|---|---|
| A | 与她第二跳同形：assistant{content:"", tool_calls:[cycle-0]} + tool 帧，thinking 未设 | **400** `invalid_request_error`：「The `reasoning_content` in the thinking mode must be passed back to the API.」 |
| B | A + `thinking:{type:'disabled'}` | 200，content = 合法信封（「当前东莞天气：多云有阵雨，31°C。」） |
| C | A + 声明 tools | 同 A，400 |
| D | 工具帧在**上一轮**（后面跟 assistant 回复 + 新 user），thinking 默认 | 200 —— 历史里的旧工具帧不触发 400，只有**紧接工具帧的那一跳**要求回传 reasoning |
| E | assistant 帧带合成 `reasoning_content`，thinking 默认 | 200，但 `content:""`，信封 JSON 整个落在 `reasoning_content` 里（reasoning_tokens 33） |

- 由 D：关思考只需作用于工具步之后的跳；回滚被修掉之后，历史里留下的工具帧在后续轮次不会再炸。
- 由 E：思考模式 + json_object 会把答案吞进 `reasoning_content`、content 空 —— 与自主路径 `autonomy_wake_retried{reason:'not_json', content_len:0}`（约 1/6 的唤醒）同形。本单**只记数不修**（D-2b），修不修另立单。
- 时间：四轮 step 0（思考开）各 79–94 s、7–10k tokens，`cycleTimeoutS` 180 s；若第二跳也开思考，两跳相加撞线。关思考同时解掉这层。

**白名单与提示词**

- `contract.ts:126-137` `TOOL_TO_ACTION` 10 项；`contract.ts:156` `envelopeToolNames()` = 全部 10 项 + 3 个 in-cognition 工具，**不按接线过滤**；`contract.ts:233-236` `envelopeSystemPrompt()` 把它渲进 `{tools}`。
- `prompts.ts:18-19` `SYSTEM_PROMPT` 逐字列出 `research_open / research_read_text / research_extract_links` 与 `browser_navigate / browser_click / browser_type / browser_screenshot / browser_get_text`。
- 产线接线（`lykoi-organ-browser/src/protocol.ts:37,47`）：`research_browser.read_text`、`browser.navigate`、`browser.get_text`（+ terminal.exec、notify.owner）。**未接线 5 个**：research_open、research_extract_links、browser_click、browser_type、browser_screenshot。GK-14 之后这些会被 `toolDispatchGate` 判 `not_wired` 不派发（`conversation.ts:1105`），但她仍会先点它 —— 四轮里三轮点的是 `research_open`，白白烧掉一步。
- `conversation.ts:296` deps 已有 `wiredActions?: ReadonlySet<string>`；`:947` 已传给 `cycleRecord`。`#buildPersonaMessage`（`:411`）直接 `parts.push(SYSTEM_PROMPT)`。
- `prompts.test.ts:29` 钉 `SYSTEM_PROMPT` sha；`:95-101` 钉 `ENVELOPE_SYSTEM_PROMPT` sha 与 `envelopeSystemPrompt()` 码点数 2245；`:117` 断 `envelopeToolNames()`。这些**无参调用**的钉必须保持字节不变。

## 2 · 定案

- **D-1 工具步之后的信封跳关思考。** `ConverseLlmFn` opts 增可选 `reasoningEffort?: 'off'`；`#completion` 增 `step` 入参，`step >= 1` 时带 `reasoningEffort:'off'`，`step === 0` 与 summary 调用**不带**（字节不变）。`index.ts` llm 接缝把它原样透传进 `ctx.lykoiLlm.call` 的 config（`GenerateOptions.reasoningEffort` 本就存在，lykoi-llm 整体透传，adapter `resolveThinking` 落成线上 `thinking:{type:'disabled'}`）。不改 profile、不改 adapter、不改 lykoi-llm 的调用签名。
  - 弃 Route 2（截住 reasoning 再回传）：要在 `ConverseMessage`/聊天历史里持久化思考文本、要改 `toDshMessage` 造 reasoning 块，且第二跳仍开思考 → 两跳撞 180 s。探针 D 证明关思考的跳后面跟着旧工具帧不会再炸，Route 1 足够。
- **D-2a `converse/turn_failed` 记失败元数据。** `index.ts:574-578` catch 里若 `err instanceof LlmFinishError`：追加 `kind:'llm_finish'`、`finish_code: err.reason.failure.code`、`finish_status: err.reason.failure.status ?? null`、`route: err.route`、`text_len: err.textLength`、`reasoning_len`（见 D-2b）。**不记 message/requestId**（S-21 口径不变）。其他错误分支字节不变。
- **D-2b lykoi-llm 计 reasoning 长度。** `call()` 循环增一支 `chunk.type === 'reasoning-delta'` → 只累加码点数，**不保存文本**。`LlmCallResult` 增 `reasoningLength: number`；`LlmFinishError` 增 `readonly reasoningLength: number`。wake 的 `autonomy_wake_retried{reason:'not_json'}`（`lykoi-wake/src/index.ts:282-283`）追加 `reasoning_len`，用来验证 E 假说；wake 其他一字不动。
- **D-3a 契约白名单按接线过滤。** `envelopeToolNames(wiredActions?: ReadonlySet<string>)`：给了 wired 时，`TOOL_TO_ACTION` 只保留 `wiredActions.has(action)` 的项；3 个 in-cognition 工具照旧；不给 = 现状（全量）。`envelopeSystemPrompt(wiredActions?)`、`buildEnvelopeMessages(assembled, wiredActions?)` 同形透传；`conversation.ts:874` 传 `this.#deps.wiredActions`。无参调用输出字节不变（`prompts.test.ts` 现有钉全部保持）。
- **D-3b 人设提示词的工具行按接线过滤。** `SYSTEM_PROMPT` 常量**一字不改**（sha 钉保持）；`prompts.ts` 新增纯函数 `renderSystemPrompt(wiredActions?)`：给了 wired 时，只对以 `- ` 开头、首段为 `name / name / …（` 形态的工具行动手 —— 用 `TOOL_TO_ACTION` 把名字映到动作、剔除未接线的名字、剩余名字仍以 ` / ` 连接；一行一个都不剩就整行删；括号里的说明文字、其余所有行、空行、顺序**逐字节不动**。不给 wired 或全接线 → 返回值 === `SYSTEM_PROMPT`。`#buildPersonaMessage` 改 `parts.push(renderSystemPrompt(this.#deps.wiredActions))`。
  - 已知残留、本单不处理：产线过滤后第 19 行变成 `- browser_navigate / browser_get_text（…导航/点击/读页/截图免审批；browser_type 输入会问 Kevin…）`，说明文字仍提到点击/截图/输入。改说明文字是改活体 raw，留给 Kevin 裁。
- **D-4 不动**：`ENVELOPE_SYSTEM_PROMPT`、`SYSTEM_PROMPT`、`TOOL_TO_ACTION`、`toolDispatchGate`、`cycleRecord`、`#buildAction` 及其三个事件、`packages/lykoi-llm-deepseek/**`、`profile/**`、kernel、`lykoi-organ-browser/**`、summary 调用路径、wake 除 D-2b 一个字段外的一切。

## 3 · 交付

1. `packages/lykoi-converse/src/conversation.ts`：`ConverseLlmFn` opts、`#completion(step, signal)`、`:874` 白名单透传、`:411` `renderSystemPrompt`。
2. `packages/lykoi-converse/src/index.ts`：接缝透传 `reasoningEffort`；catch 分支 D-2a。
3. `packages/lykoi-converse/src/contract.ts`：`envelopeToolNames` / `envelopeSystemPrompt` / `buildEnvelopeMessages` 可选 wired 入参。
4. `packages/lykoi-converse/src/prompts.ts`：`renderSystemPrompt`。
5. `packages/lykoi-llm/src/index.ts`：D-2b。
6. `packages/lykoi-wake/src/index.ts:282-283`：`reasoning_len` 一个字段。
7. 测试：
   - `cycle.test.ts`（或新 `toolstep.test.ts`）：fake llm 记录每次 opts —— step 0 无 `reasoningEffort`、工具步之后每一跳都是 `'off'`、summary 调用没有；工具帧仍在 `#messages` 里（不因关思考而丢）。
   - `wire.test.ts` 或接缝测试：`reasoningEffort:'off'` 到达 `lykoiLlm.call` config；未给时 config **没有这个键**。
   - `llm-finish.test.ts`：`turn_failed` 载荷含 `kind/finish_code/finish_status/route/text_len/reasoning_len`，且不含 message/requestId；非 LlmFinishError 分支载荷逐字不变。
   - `lykoi-llm` 单测：reasoning-delta 计数、成功与失败两条路都带 `reasoningLength`；text/usage/charge 口径逐字不变。
   - `prompts.test.ts`：现有钉全保留；新增 `envelopeToolNames(prodWired)` 精确等于 `[browser_get_text, browser_navigate, notify_owner, research_read_text, terminal_exec, vision_describe, promise_followup, post_progress]`（顺序按现有实现）；`renderSystemPrompt(undefined) === SYSTEM_PROMPT`、全接线 `=== SYSTEM_PROMPT`、产线集合下第 18/19 行按 D-3b 逐字对表、其余行逐字节相同。
   - `lykoi-llm-deepseek` 若已有线上序列化的测试夹具，加一条 `reasoningEffort:'off'` → body 含 `thinking:{type:'disabled'}`；没有夹具就在 report 里写明，以探针 B/D 为证。
8. `governance/wo/WO-FIX-TOOLSTEP-01/report.md`：基线与尖 sha、每包计数、D-1..D-4 对照、不动清单 sha 表（`SYSTEM_PROMPT`、`ENVELOPE_SYSTEM_PROMPT`、`TOOL_TO_ACTION` 三块前后 sha 相同）、偏离。

## 4 · 纪律

- 分支 `wo/fix-toolstep-01`，基线 main；≥3 提交，中文提交信息，尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。
- 全仓 `npx tsc --noEmit` 净、`npm test` 绿，数字进 report。不生成 manifest。不动 D-4 清单。不碰 profile、secrets、任何服务器。
- 结束 `git push origin wo/fix-toolstep-01`。
