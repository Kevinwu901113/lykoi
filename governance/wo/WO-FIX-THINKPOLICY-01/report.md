# WO-FIX-THINKPOLICY-01 · 收工报告

- 执行：opus 执行子 Agent（D-0/D-3/D-5，2026-09-04 01:40–01:55 CST）+ 主治理 Agent（D-1 探针 v5、D-2 profile 档位、report.md 代写入库）
- 分支 `wo/fix-thinkpolicy-01`（基于 main@4aec35f）：e4e4d1c D-0、d1e5fc7 D-3、fab43c8 D-5、6363b39 D-3 补正、D-2 profile 一提（见 git log）
- tsc `--noEmit -p .`：净
- lykoi-converse 131/130/0/1（既有 skip）；执行方全量 1027/1016/0/11；profile 改后我方复跑 converse 130/131、gate 72/72、organ-browser 66/66、llm-deepseek 7/7
- 改动：`packages/lykoi-converse/src/contract.ts`（+21）、`src/conversation.ts`（+44/-25）、`test/cycle.test.ts`、`test/toolstep.test.ts`、`test/wire.test.ts`、`profile/cordis.prod.yml`（+9）

## D-0 事件字段

`u3_cycle_envelope` 只在 `conversation.ts` `cycleRecord` 一处记。新增 `prompt_tokens` / `completion_tokens` / `reasoning_len` 三键追加在 `grounded` 之后，既有字段名与次序不动；缺席语义与 `u3_cycle_failed` 对齐（null / null / 0）。来源：`LlmCallResult.usage.inputTokens/outputTokens` 与 `reasoningLength`，经 converse index.ts 转接。`lastResult` 是循环外变量，记的是成立那一跳。

注意：vendor `mapUsage` 按 harness 不相交约定 `inputTokens = prompt_tokens − cached_tokens`，所以 `prompt_tokens` 读到的是**缓存未命中的那部分**。前缀缓存命中时它会明显塌下去，正好把「思考长」与「缓存未命中」分开；读数时不要当成 wire 上的 prompt_tokens。因此原 §5 追加的 `cache_hit_tokens` 不再另加。

## D-2 profile

`profile/cordis.prod.yml` `llm-deepseek` 加 `config: { thinking: enabled, reasoningEffort: low }`，档位取值见 order.md §5（探针 v5 按 D-4 规则）。vendor `resolveAdapterOptions` 只禁 `thinking: disabled` 搭非 off 档位，本组合合法。

## D-3 删 per-step 覆盖

`conversation.ts` 原 912 行 `...(step >= 1 ? { reasoningEffort: 'off' as const } : {})` 连同注释整行删除；`#completion` 的 `step` 形参随之删除（唯一调用点同步改）。`ConverseLlmFn.reasoningEffort?: 'off'` 接缝类型保留（删类型会牵动 index.ts、mock、两处测试，超出范围），注释改口为「接缝类型位，不是策略」。

## D-5 测试

红 4 条翻面（toolstep 两条、wire 一条、cycle 一条），断言由 `'off'` 翻为「键不在」，用例名保留原单号并注 `（THINKPOLICY-01 D-5 翻面）`；同用例无关断言未动。新增 3 条 D-0 用例（有 usage / 三键全缺 / 重试后记成立那跳）。

## 与工单的偏差

1. `#completion` 删 `step` 形参（死参数）。
2. `ConverseLlmFn.reasoningEffort` 类型保留，注释改写。
3. 翻面范围三个文件 4 条，多于工单字面的「wire 用例」。

## 发现但未动

- **隐式 HIGH 的出处**：profile 无 config 时 vendor `resolveThinking` 返回 `{}`，wire 上 thinking/reasoning_effort 两键都不出现，HIGH 是供应商侧模型缺省，不是「vendor 兜底」。分析稿 §3 与工单 §1 措辞已由治理侧改口（6363b39 补正了代码注释）。
- vendor `mapUsage` 的 `reasoningTokens`（供应商自报思考 token，可对计费）未被 lykoi-llm `LlmCallResult` 带出；比自数的 `reasoningLength` 码点数更权威。要不要接出来留治理侧定，本单不动。
- `resolveThinking`：`thinking: disabled` 与非 off 档位同配会抛 `UNSUPPORTED_REASONING_EFFORT`；D-2 取 low 时 profile 不可同时写 disabled（已按此写）。
