# WO-FIX-NOTJSON-01 · 治理复核

- 复核：主治理 Agent，2026-09-03
- 对象：`wo/fix-notjson-01`，执行 4 提交 d414b5b → 15b2ee3 → 7c2c9ab → 3340122（sonnet），origin 已同步
- 基线：main@2b28061（代码树 = 产线钉点 47fb05a）
- 结论：**PASS，待裁合**

## 1 · 边界

| 项 | 读数 |
|---|---|
| 触碰文件（src） | `lykoi-decide/src/index.ts`、`lykoi-converse/src/{contract,conversation,index}.ts`、`lykoi-wake/src/index.ts` |
| 触碰文件（test） | converse 2（cycle、e2e）、decide 1、wake 1 |
| 独立复跑（全仓求和） | 1020 / 1009 / 0 / 11（基线 1015 / 1004 / 0 / 11，+5） |
| `npx tsc --noEmit` | 净 |
| 复跑后 `git status` | 净 |
| D-6 不动清单 | 三块常量 sha 由 report 表与 `prompts.test.ts` 钉证明未动；`lykoi-llm`、`lykoi-llm-deepseek`、`profile`、kernel、organ-browser 零 diff；`parseEnvelope`/`classifyFailure`/`firstCharClass` 在 hunk 之外；温度、json 模式未动 |
| 迁移 / 装配 / 依赖 / profile | 零；manifest 须重签（三包 src 变） |

## 2 · 定案对照

| 定案 | 核对 |
|---|---|
| D-1 引导语一处真源 | `lykoi-decide/src/index.ts:549-551` `JSON_RETRY_NUDGE`，文案逐字同单；converse `contract.ts:25` 与 wake `index.ts:56` 各 import 一次 |
| D-2 重试带引导、临时 | `buildEnvelopeMessages(assembled, wired?, nudge?)`：缺省逐字节不变，`true` 时契约后追加一条 user 引导；`#completion(step, signal, nudge)`；循环处 `attempt >= 1`。引导不 push 进 `#messages`（返回值局部） |
| D-3 有界重试 1 → 2 | `ENVELOPE_RETRY_MAX = 2`；contract.ts:59-66 与 conversation.ts:912-913、941-944 注释同步改口 |
| D-4 reasoning_len | `ConverseLlmResult.reasoningLength?`；接缝 `index.ts:373` 填 `result.reasoningLength`；`u3_cycle_retried` / `u3_cycle_failed` 各 `reasoning_len: ?? 0` |
| D-5 wake 重试带引导 | `deps.llm([...messages, {role:'user', content: JSON_RETRY_NUDGE}], llmMeta)`，仍只一次；`autonomy_wake_retried` 载荷未动 |
| D-6 | 成立 |

## 3 · 偏离核定

1. 引导追加放在 `buildEnvelopeMessages` 第三参而非 `#completion` 内联：字节结果相同，且契约与引导同在 contract.ts 一处，更好。**接受。**
2. `e2e.test.ts` 既有「恰一次重试」用例随 D-3 改口（mock 恒返同一非 JSON 文本 → 现在重试两次）。必然后果。**接受。**
3. D-4 类型与事件字段在提交 ①、接缝填值在提交 ②。**接受。**

## 4 · 张力（不阻断）

- 引导语是 user 角色、落在 system 契约之后。生成点前最后一条不再是 system，DeepSeek 对此无约束（探针 D 的形态即 user 收尾）。缓存只影响尾部。
- 每次重试是一次完整 charge。实证缓存命中时 prompt 侧只计十几 token，成本可忽略；周期 signal 照旧兜底。
- 引导语本身若也退化成空白，第三次结束仍归 silence —— 本单只把杠杆换成改前缀，不承诺根除 DeepSeek 端的空输出。落地后按 `u3_cycle_retried.attempt` 分布与 `u3_cycle_failed{not_json}` 日频读效果。

## 5 · 落地要点（LANDING-K）

- 三包 src 变，manifest 重签，条目数应仍 113（无新 src 文件）；无迁移、无 profile 改动、宿主不动。
- 内容断言：`lykoi-decide/src/index.ts` 含 `export const JSON_RETRY_NUDGE`；`contract.ts` 含 `ENVELOPE_RETRY_MAX = 2`；`conversation.ts` 含 `this.#completion(step, signal, attempt >= 1)`；`lykoi-wake/src/index.ts` 含 `content: JSON_RETRY_NUDGE }], llmMeta)`。
- 落地后读数：`u3_cycle_retried` 的 `attempt` 与 `reasoning_len` 分布；`u3_cycle_failed{reason:'not_json'}` 日频对比落地前（今日 1）；`autonomy_wake_retried` 后是否接 `autonomy_wake_failed`。
