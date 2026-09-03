# WO-FIX-TOOLSTEP-01 · 治理复核

- 复核：主治理 Agent，2026-09-03
- 对象：`wo/fix-toolstep-01`，执行 4 提交 0891d5b → 17038a6 → 564d6dd → fdbab51（sonnet），origin 已同步
- 基线：main@142e51c（代码树 = 1317cc8 = 产线钉点 04bef07）
- 结论：**PASS，待裁合**

## 1 · 边界

| 项 | 读数 |
|---|---|
| 触碰文件（src） | `lykoi-converse/src/{contract,conversation,index,prompts}.ts`、`lykoi-llm/src/{index,mock}.ts`、`lykoi-wake/src/index.ts` |
| 触碰文件（test） | converse 4（新 `toolstep.test.ts`）、llm 1、llm-deepseek 1、wake 4 |
| 独立复跑（`npm test --workspaces` 全仓求和） | 1015 / 1004 / 0 / 11（基线 999 / 988 / 0 / 11，+16） |
| `npx tsc --noEmit` | 净 |
| 复跑后 `git status` | 净 |
| D-4 不动清单 | `SYSTEM_PROMPT`、`ENVELOPE_SYSTEM_PROMPT` 由 `prompts.test.ts` 的 sha 钉证明未动；`TOOL_TO_ACTION` 块（contract.ts:126-137）在所有 hunk 之外；`lykoi-llm-deepseek/vendor`、`profile`、kernel、organ-browser 的 diff 为空 |
| 迁移 / 装配 / 依赖 / profile | 零；manifest 须重签（src 变） |

## 2 · 定案对照

| 定案 | 核对 |
|---|---|
| D-1 step ≥ 1 关思考 | `#completion(step, signal)`：`step >= 1` 条件展开 `reasoningEffort:'off'`；step 0、summary 路径（conversation.ts:827）不带键。接缝 `index.ts` 用 dsh-llm 导出的 `ReasoningEffortId('off')` 做 brand 转换，缺席时键不出现。`toolstep.test.ts` 四条：step 0 无键、step 1 与多步每跳 `'off'`、工具帧成对留在历史、summary 无键 |
| D-2a turn_failed 元数据 | 新分支插在 `ContextBudgetError` 与泛化兜底之间；载荷 `kind/finish_code/finish_status/route/text_len/reasoning_len`，无 message/requestId；两条既有分支逐字节未动 |
| D-2b reasoning 长度 | lykoi-llm 只累加 `reasoning-delta` 码点数，不存文本；`LlmCallResult.reasoningLength` 必填、`LlmFinishError.reasoningLength`；wake `LlmFn` 返回型加可选 `reasoningLength`，`autonomy_wake_retried{not_json}` 记 `reasoning_len`（缺省 0）。wake 其余未动 |
| D-3a 白名单过滤 | `envelopeToolNames(wired?)` 从 `TOOL_TO_ACTION` 过滤、三个 in-cognition 恒在；`envelopeSystemPrompt`/`buildEnvelopeMessages` 透传；`#completion` 传 `deps.wiredActions`。产线集合下白名单精确为 `browser_get_text, browser_navigate, notify_owner, research_read_text, terminal_exec` + 三个 |
| D-3b 人设工具行过滤 | `renderSystemPrompt(wired?)` 纯函数；只对首段全部为 `TOOL_TO_ACTION` 名字的 `- a / b（` 行动手，其他行原样；产线集合下第 18 行 `- research_read_text（…）`、第 19 行 `- browser_navigate / browser_get_text（…）`，说明文字与其余行逐字节相同（测试逐字对表）；无参 / 全接线 `=== SYSTEM_PROMPT` |
| D-4 | 成立 |

## 3 · 偏离核定

1. **测试用 adapter 补 `resolveModel()`**（`lykoi-llm/src/mock.ts`、`wire.test.ts` 的 CapturingAdapter）：dsh-llm `resolveCallWithInfo` 按 adapter 申报的 `reasoning.efforts` 校验请求，不申报 `off` 则任何 step ≥ 1 的红测假摔。改动只声明 `efforts:[off]`、不给 `defaultEffort`，理由成立（给了会让 dsh-llm 在未请求时也材化 effort，污染 D-1「step 0 无键」断言）。`mock.ts` 是 src 但产线 profile 不装 mock 适配器，落地无影响。**接受。**
2. **产线默认值订正**：单 §1 写「thinking 未配置 → 不写 thinking 键」，执行方抓包证明实际 wire 是 `thinking:{type:'enabled'}` + `reasoning_effort:'high'` —— 机制是 dsh-llm 用 adapter 申报的 `defaultEffort`（vendor `modelInfoFor` 未配置时报 HIGH）兜底了未显式请求的调用。结论比单上更硬：产线每一跳都在显式要求思考 + high。这同时解释 step 0 的 79–94 s。**接受，单 §1 以此为准。** 附带一个后续议题（不在本单）：step 0 是否降到 `low`，是产线时延取舍，留 Kevin 裁。
3. 非 LlmFinishError 分支未加端到端红测，以结构 diff 证明未动。**接受。**
4. 提交切分与 §4 建议不同（跨 D 的 hunk 不可分），报告如实写明，未改写历史。**接受。**

## 4 · 张力（不阻断）

- `LlmCallResult.reasoningLength` 为必填字段：全仓消费方（converse 接缝、wake 接缝、decide 若有）由 tsc 保证已适配；外部若有第三方调用 lykoi-llm 的 fake 需补字段。全仓无。
- `renderSystemPrompt` 的行匹配依赖 `- 名字 / 名字（` 这一书写形态；将来改 `SYSTEM_PROMPT` 的工具行若换了分隔符或括号，过滤会静默失效（行原样保留）。`prompts.test.ts` 的产线集合逐字对表用例是这条的守门人。
- 产线过滤后第 19 行的说明文字仍提「点击/截图/输入」（单 D-3b 已注明），改活体 raw 留 Kevin 裁。

## 5 · 落地要点（LANDING-J）

- 改的是三包 `src/**.ts`，manifest 须重签（期望条目数 = 113 + 0；新文件只在 test/，manifest 是否收 test 由脚本读数为准）；无迁移、无 profile 改动、无 unit 改动、宿主 lykoi-browser.service 不动。
- 内容断言：`conversation.ts` 含 `reasoningEffort: 'off' as const`；`index.ts` 含 `kind: 'llm_finish'`；`prompts.ts` 含 `export function renderSystemPrompt(`；`lykoi-llm/src/index.ts` 含 `reasoning-delta`。
- 落地后读数：Kevin 发一条需要查资料的消息 → 期望链路 `u3_cycle_envelope{tool_named}` → `action_result` → 第二跳 `budget/charge` 非 0/0 → `converse/reply`；`converse/turn_failed` 若再出现须带 `finish_code`。`autonomy_wake_retried{not_json}` 出现时看 `reasoning_len` 是否 > 0（E 假说）。
