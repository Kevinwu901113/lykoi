# WO-FIX-NOTJSON-01 报告 · not_json 重试带引导语 + 有界重试 1→2 + reasoning_len 记账口

D-1 到 D-6 全部落地，全仓 `npx tsc --noEmit` 净，`npm test --workspaces --if-present` 绿（17 个包 0 失败）。分支 `wo/fix-notjson-01`。

- 基线：`main@3d13025`（order.md §「基线」的代码树钉点）。worktree 起点 `2b28061` = `3d13025` 单加 `governance/wo/WO-FIX-NOTJSON-01/order.md` 一个文件（已用 `git diff --stat 3d13025 2b28061` 核实：76 行新增，仅此一个文件），两者代码树逐字节相同，故本报告的所有 diff 均以 `2b28061`（分支起点）为对照基线，等价于对 `3d13025`。
- 分支尖：`7c2c9ab` + 本报告提交（见文末「提交」一节）。

## 一、D-1..D-6 对照表

| 定案 | 文件:行（当前树） | 内容 |
|---|---|---|
| D-1 | `packages/lykoi-decide/src/index.ts:550-552` | 导出 `JSON_RETRY_NUDGE`（string 常量，紧邻 `extractJson`），文案与 order.md D-1 逐字相同（已用脚本核对，见下节） |
| D-2 | `packages/lykoi-converse/src/contract.ts:275-286` | `buildEnvelopeMessages(assembled, wiredActions?, nudge?: boolean)`：`nudge` 缺省/false → 逐字节不变（原两行合一）；`true` → 在契约消息之后再追加一条 `{role:'user', content: JSON_RETRY_NUDGE}` |
| D-2 | `packages/lykoi-converse/src/conversation.ts:893` | `#completion(step, signal?, nudge?: boolean)`：第三参透传给 `buildEnvelopeMessages` |
| D-2 | `packages/lykoi-converse/src/conversation.ts:927` | 重试循环调用点：`this.#completion(step, signal, attempt >= 1)`——attempt 0 不带引导，attempt≥1 带；引导只存在于这一次 `messages` 里，不 push 进 `#messages`（无对应写入点，历史/摘要/下一步装配天然看不到它） |
| D-3 | `packages/lykoi-converse/src/contract.ts:67` | `ENVELOPE_RETRY_MAX = 2`（原 1） |
| D-3 | `packages/lykoi-converse/src/contract.ts:59-66` | 注释改口：「恰一次」→「至多两次，带引导」，补上实证依据（同前缀两次采样同长度空白 = 确定性退化） |
| D-3 | `packages/lykoi-converse/src/conversation.ts:905-906,935-938` | `#runCycle` 头注 + 重试分支注释同步改口 |
| D-4 | `packages/lykoi-converse/src/conversation.ts:189` | `ConverseLlmResult` 加可选 `reasoningLength?: number` |
| D-4 | `packages/lykoi-converse/src/index.ts:373` | llm 接缝 `return` 追加 `reasoningLength: result.reasoningLength`（`ctx.lykoiLlm.call` 的返回本就带这个必填字段，原样透传） |
| D-4 | `packages/lykoi-converse/src/conversation.ts:944-949` | `u3_cycle_retried` 追加 `reasoning_len: result.reasoningLength ?? 0` |
| D-4 | `packages/lykoi-converse/src/conversation.ts:965-969` | `u3_cycle_failed` 追加 `reasoning_len: result.reasoningLength ?? 0`（最后一次尝试的值） |
| D-5 | `packages/lykoi-wake/src/index.ts:56` | 导入 `JSON_RETRY_NUDGE`（`from 'lykoi-decide'`，与 converse 同一处真源） |
| D-5 | `packages/lykoi-wake/src/index.ts:296-300` | 第二次调用改为 `deps.llm([...messages, { role: 'user', content: JSON_RETRY_NUDGE }], llmMeta)`；`autonomy_wake_retried` 载荷不变；仍只重试一次（WO-FIX-LOOP-01 D-3a 不变） |
| D-6 | 见下节「不动清单」 | — |

## 二、不动清单：sha 核验

用 Node ESM 脚本对基线（`git show 3d13025:<path>`）与当前树同名常量的**源码字面量**（模板字符串正文 / 对象字面量花括号内文本）取 `.length`/sha256 比对（脚本为过程性文件，未入库）：

| 常量 | 基线（`3d13025`） | 当前树 | 一致 |
|---|---|---|---|
| `SYSTEM_PROMPT`（`prompts.ts`） | chars=1421, sha256=`91f459e954f875235648148b63627c9075bb8d7fd0e833a68a8b1bf0165a5e0b` | 同左 | 一致 |
| `ENVELOPE_SYSTEM_PROMPT`（`contract.ts`） | chars=1670, sha256=`4f8096ef0d4ec0a5370811a7b99dd23adacdd4ba3809f0044f424ac922eb26bf` | 同左 | 一致 |
| `TOOL_TO_ACTION`（`contract.ts`，花括号内原文 sha） | chars=413, sha256=`acfca16bee7fa5b80cbc6b867aa6523f8729e08613a77dc9440b4ab6ea00ce7f` | 同左 | 一致 |

补充结构性核验（`git diff main -- <path>`，非语义 diff）：

- `packages/lykoi-kernel/`、`packages/lykoi-organ-browser/`、`packages/lykoi-llm/`、`packages/lykoi-llm-deepseek/`、`profile/` 五处：diff 输出为空，零改动。
- `parseEnvelope`/`classifyFailure`/`firstCharClass`（`contract.ts`）：函数体逐字节未动——`classifyFailure` 的 diff 命中范围为 0（只有它上方的 `ENVELOPE_RETRY_MAX` 注释与 `buildEnvelopeMessages` 变了，两者都在 `classifyFailure` 之前的独立函数）。
- json 模式（`envelopeJsonMode`）、温度（信封调用不传 `temperature`）：`contract.ts`/`conversation.ts`/`index.ts` 全量 diff 核对，无命中。
- `conversation.ts` 全量 diff 核对：仅命中 `ConverseLlmResult` 新增可选字段、`#completion` 签名新增第三参、`#runCycle` 重试循环调用点与两处事件、三处注释改口；`#buildAction`、`cycleRecord`、`toolDispatchGate`、`#executeCycleTool` 等其余函数体不在 diff 命中范围内。
- `index.ts`（converse）全量 diff 核对：仅命中 llm 接缝 `return` 追加一个 kv；`toDshMessage`、`dispatchFn`、vision 分支等其余逐字节不变。
- `wake/index.ts` 全量 diff 核对：仅命中 import 列表新增一个符号名、第二次 `deps.llm` 调用点追加一条消息、一段新注释；`autonomy_wake_retried` 载荷、六阶段其余顺序逐字节不变。

## 三、每包测试计数（`npm test --workspaces --if-present`，全绿）

| 包 | tests | pass | fail | skip |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 124 | 123 | 0 | 1 |
| lykoi-decide | 95 | 95 | 0 | 0 |
| lykoi-gate | 72 | 72 | 0 | 0 |
| lykoi-heart | 14 | 14 | 0 | 0 |
| lykoi-kernel | 199 | 199 | 0 | 0 |
| lykoi-learn | 87 | 86 | 0 | 1 |
| lykoi-llm | 9 | 9 | 0 | 0 |
| lykoi-llm-deepseek | 7 | 7 | 0 | 0 |
| lykoi-memory | 120 | 111 | 0 | 9 |
| lykoi-organ-browser | 66 | 66 | 0 | 0 |
| lykoi-reflow | 35 | 35 | 0 | 0 |
| lykoi-regulation | 45 | 45 | 0 | 0 |
| lykoi-snapshot | 52 | 52 | 0 | 0 |
| lykoi-wake | 32 | 32 | 0 | 0 |
| **合计** | **1020** | **1009** | **0** | **11** |

基线（order.md）为 1015 / 1004 / 0 / 11——本单净增 5 条测试（converse +5：cycle.test.ts 重写 1 条 + 新增 4 条；decide +1、wake 计数不变是因为只在既有用例里加断言，没新增 `test()` 块）；`skip` 合计 11 与基线持平（都是既有的 golden devstate 只读测试 + node:test 嵌套计数口径差异，非本单引入）。`fail` 全零是唯一要紧的数字。

`npx tsc --noEmit`（全仓）：净，exit 0。

## 四、测试清单（按 D 编号，均在既有测试文件里改口/新增，未加新文件）

**D-1**（`packages/lykoi-decide/test/evaluate.test.ts`，新增 1 条）
- `JSON_RETRY_NUDGE` 非空字符串，且含「JSON」四字。

**D-2/D-3/D-4**（`packages/lykoi-converse/test/cycle.test.ts`，改口 1 条 + 新增 4 条；`test/e2e.test.ts`，改口 1 条）
- 三次全空：`u3_cycle_retried` 两条（attempt 1、2，各带 `reasoning_len:0`），`u3_cycle_failed.attempts===3`；三次调用里第 1 次末尾是 system 契约，第 2/3 次末尾是 `{role:'user', content: JSON_RETRY_NUDGE}`；除末尾这一条引导外三次 `messages` 逐字相等；`opts.{purpose,responseFormat,reasoningEffort,signal}` 三次相等。
- 首空次好：只一条 retried、正常 reply；下一轮 `send` 的首次调用 `messages` 不含引导语。
- step≥1 的重试：`reasoningEffort:'off'` 与引导同带一次调用里。
- `reasoningLength:137` 且非 JSON → `u3_cycle_retried.reasoning_len===137`；三次都带 → `u3_cycle_failed.reasoning_len` 取最后一次的值。
- e2e：mock LLM 固定回同一份非 JSON 文本 → 两条 `u3_cycle_retried`（attempt 1、2）+ `u3_cycle_failed.attempts===3`；`reasoning_len` 恒 0（mock adapter 不带 `reasoningLength`）。

**D-5**（`packages/lykoi-wake/test/wake.test.ts`，在既有「D-3a：首包非 JSON、次包合法」用例里追加断言，未新增 `test()` 块）
- 重试那次调用的 `messages` = 首次 `messages` + 末尾一条 `{role:'user', content: JSON_RETRY_NUDGE}`（逐字）；首次调用 `messages` 不含引导；既有 `calls.length===2` 断言不变。

## 五、偏离与附注

1. **`buildEnvelopeMessages` 加第三参而非在 `#completion` 里手写拼接**：order.md D-2 的伪代码写的是 `messages = [...buildEnvelopeMessages(...), {role:'user', content: JSON_RETRY_NUDGE}]`，读起来像是在调用点（`conversation.ts`）拼接。但派工指示明确点名「contract.ts:27」是 `JSON_RETRY_NUDGE` 该导入的位置，而 `contract.ts` 此前并不使用这个符号——唯一站得住的理由是把「引导怎么拼进信封消息」这件事收在 `buildEnvelopeMessages` 内部（它本就是这条消息序列的唯一装配点），`conversation.ts` 只管「要不要拼」（`attempt>=1` 传 `true`）。最终产物字节与 order.md 的伪代码完全一致，只是拼接代码挪了个文件。已在 D-2 对照表里写清楚两处落点。
2. **e2e.test.ts 不在 order.md §3 的「测试」清单里，但被本单牵连改口**：`test/e2e.test.ts:220` 的失败路用例原先钉的是「重试恰一次」，`ENVELOPE_RETRY_MAX` 1→2 后其断言（`llm.calls.length===2`、`failed.attempts===2`）会失败——这是 mock LLM 固定返回同一份非 JSON 文本导致两次重试都打满的必然结果，不是新缺陷。按最小改动原则同步改口（`assertSubsequence` 里多插一组 `retried→charge`，`attempts` 改 3），未改变测试覆盖的语义主张（契约失败→有界重试→仍败→降级沉默）。
3. **`ConverseLlmResult.reasoningLength` 的类型落点算作 D-2/D-4 共用**：这个字段在 D-2/D-3 提交（`d414b5b`）里就加了（因为同一次编辑顺手把 `u3_cycle_retried`/`u3_cycle_failed` 的 `reasoning_len` 记账口一起写了，读的正是这个字段），但让它真正非零的接缝填值（`index.ts:373`）留到 D-4 提交（`15b2ee3`）单独完成——三次提交的顺序因此和 order.md 建议的「① D-1+D-3+D-2+测试；② D-4+测试；③ D-5+测试」略有出入：D-4 拆成了「记账口（提交①）+ 接缝填值（提交②）」两半。功能上 D-4 完整落地，只是提交切分点不同，已在两条提交信息里互相引用说清楚。
4. 未生成 manifest（order.md 明确不要求）；未碰 `profile/**`、secrets、任何服务器/ssh；未做迁移。

## 提交

```
d414b5b WO-FIX-NOTJSON-01 D-1/D-2/D-3：not_json 重试带引导，有界重试 1→2
15b2ee3 WO-FIX-NOTJSON-01 D-4：converse LLM 接缝透传 reasoningLength
7c2c9ab WO-FIX-NOTJSON-01 D-5：wake 重试同带 JSON_RETRY_NUDGE 引导
<本提交> WO-FIX-NOTJSON-01 report：收工报告
```
