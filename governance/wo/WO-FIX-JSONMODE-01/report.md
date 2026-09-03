# WO-FIX-JSONMODE-01 报告 · 信封重试跳去 json 模式 + 事件补 json_mode

D-1..D-5 全部落地，全仓 `npx tsc --noEmit -p .` 净，`npm test --workspaces --if-present` 全绿（1021 / 1010 / 0 / 11）。分支 `wo/fix-jsonmode-01`。

- 基线：`main@3cdf1c8`（order.md §「基线」的代码树钉点）。worktree 起点 `bdf0193` = `3cdf1c8` 单加 `governance/wo/WO-FIX-JSONMODE-01/order.md` 一个文件（已用 `git diff --stat 3cdf1c8 bdf0193` 核实：37 行新增，仅此一个文件），两者代码树逐字节相同，故本报告的所有 diff 均以 `bdf0193`（分支起点）为对照基线，等价于对 `3cdf1c8`。
- 分支尖：`9b2f5b8`（本报告提交在此之上再加一条）。

## 一、D-1..D-5 对照表

| 定案 | 文件:行（当前树） | 内容 |
|---|---|---|
| D-1 | `packages/lykoi-converse/src/conversation.ts:898` | `#completion` 里 `responseFormat: envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null` 改为 `responseFormat: nudge ? null : (envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null)`——`nudge` 缺省/false（attempt 0）时走括号里那一支，与原表达式**逐字节同值**；`nudge` 为 true（attempt ≥ 1）才短路成 `null`。 |
| D-1 | `packages/lykoi-converse/src/conversation.ts:935` | `#runCycle` 重试循环：`const nudge = attempt >= 1; const result = await this.#completion(step, signal, nudge)`——沿用 WO-FIX-NOTJSON-01 已有的 `attempt >= 1` 判据，只是抽成变量供后面 `jsonMode` 复用，判据本身不变。 |
| D-2 | `packages/lykoi-converse/src/conversation.ts:938` | `const jsonMode = !nudge && envelopeJsonMode()`——刚发出去的那一次请求是否带了 `json_object`（`nudge` 为 true 时恒 false，因为 D-1 已强制 null；`nudge` 为 false 时看 `envelopeJsonMode()` 钮）。 |
| D-2 | `packages/lykoi-converse/src/conversation.ts:962-964` | `u3_cycle_retried` 载荷追加 `json_mode: jsonMode`（原有 `reason/detail/step/attempt/reasoning_len` 五键不动，只增第六键）。 |
| D-2 | `packages/lykoi-converse/src/conversation.ts:984-986` | `u3_cycle_failed` 载荷追加 `json_mode: jsonMode`（最后一次尝试的值；原有键集不动）。事件名两个都未改、未新增事件名。 |
| D-3 | — | `ENVELOPE_RETRY_MAX = 2`、`JSON_RETRY_NUDGE` 原样未动（`git diff bdf0193 -- packages/lykoi-converse/src/contract.ts packages/lykoi-decide/src/index.ts` 命中为空）。extractJson 对 ` ```json ` 围栏的容错见下节「偏离与附注」①——**只报不改**，因为已实测容错，无需改。 |
| D-4 | `packages/lykoi-converse/test/cycle.test.ts` | 见下节「测试清单」。 |
| D-5 | — | `packages/lykoi-wake/src/index.ts`、`packages/lykoi-decide/src/index.ts` 零改动（`git diff bdf0193 -- packages/lykoi-wake` 命中为空）。 |

## 二、attempt 0 字节不变：证据

1. **表达式层面**：`nudge ? null : (envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null)`——`nudge` 为 `false`（attempt 0 的实参）时求值路径与改动前的 `envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null` 完全相同，三元表达式的 else 分支就是原表达式本身，未做任何变形。
2. **测试钉**（均通过，`node --test packages/lykoi-converse/test/cycle.test.ts`）：
   - `WO-FIX-NOTJSON-01 D-2/D-3 × WO-FIX-JSONMODE-01 D-1/D-2：...` 用例第 118 行：`assert.deepEqual(call0!.opts.responseFormat, { type: 'json_object' })`——三次全空场景下 attempt 0 仍强制 json 模式。
   - `WO-FIX-NOTJSON-01 D-2 × WO-FIX-JSONMODE-01 D-1：首次空、次成功 → ...` 用例第 144 行同一断言；并在第 155-156 行验证**下一轮**全新的 attempt 0（`h.llm.calls[2]`）同样带 `{ type: 'json_object' }`——证明「去 json 模式」只发生在 `nudge` 为 true 的那一次请求上，不是"重试过一次之后这条对话就永久去 json 模式"。
   - `S-52：json 强制默认开且只在信封调用...` 既有用例（第 438、444 行，未改动）：单次成功场景下 attempt 0 的 `responseFormat` 仍为 `{ type: 'json_object' }`（开钮）/ `null`（关钮），逐字节维持 WO-FIX-NOTJSON-01 落地时的断言不变。
3. **结构性 diff**：`git diff bdf0193 -- packages/lykoi-converse/src/conversation.ts` 只命中 `#completion` 的 `responseFormat` 一行、`#runCycle` 循环里新增的 `nudge`/`jsonMode` 两个局部变量声明、两处事件载荷各加一个键、若干条新增注释；`buildEnvelopeMessages` 调用参数、`messages` 装配、`purpose`/`runId`/`signal`/`reasoningEffort` 四个键的求值逻辑均未在 diff 命中范围内。

## 三、全仓测试计数（`npm test --workspaces --if-present`，全绿）

| 包 | tests | pass | fail | skip |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 125 | 124 | 0 | 1 |
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
| **合计** | **1021** | **1010** | **0** | **11** |

`npx tsc --noEmit -p .`（全仓）：净，exit 0，无输出。

converse 包净增 1 条测试（124→125，本单只新增 D-4③ 那一条「切片容错抠信封」用例；其余 D-4 覆盖点都是在既有用例里改口/加断言，未新增 `test()` 块）；`skip` 合计 11 与 WO-FIX-NOTJSON-01 落地时持平，均为既有的 golden devstate 只读测试 + node:test 嵌套计数口径差异，非本单引入。`fail` 全零是唯一要紧的数字。

## 四、测试清单（按 D-4 编号，均在既有测试文件里改口/新增，未加新文件）

`packages/lykoi-converse/test/cycle.test.ts`：

- ①②（attempt 0 含 json_object；attempt 1/2 为 null 且 messages 末尾是 `JSON_RETRY_NUDGE`）：「三次全空」用例（原 WO-FIX-NOTJSON-01 用例改口，第 73-124 行）与「首空次好」用例（第 130-157 行）。
- ③（重试返回「前缀说明 + JSON 对象」的正文能解析成信封并出 reply）：新增用例 `WO-FIX-JSONMODE-01 D-4③`（第 159-169 行）——LLM 第二次回包是 ``好的，这是我的回复：\n<JSON>\n以上。``，断言 `reply === '在的'`、总调用数 2、第二次请求 `responseFormat === null`、零 `u3_cycle_failed`。
- ④（retried/failed 事件 `json_mode` 取值正确）：
  - 「三次全空」用例：`retriedEvents[0].json_mode === true`（attempt 0 失败，那一次带 json）、`retriedEvents[1].json_mode === false`（attempt 1 失败，已去 json）、`failed.json_mode === false`（attempt 2，最后一次）。
  - 「首空次好」用例：`retriedEvents[0].json_mode === true`。
  - `step ≥ 1 的重试...` 用例（第 172-189 行）追加 `step1Retry.opts.responseFormat === null` 与 `retried.json_mode === true`。
  - `e2e.test.ts` 「失败路（红）」golden 用例追加 `retriedEvents[0].json_mode === true`、`retriedEvents[1].json_mode === false`、`failed.json_mode === false`（第 247-249、255 行附近）。

## 五、偏离与附注

1. **extractJson 对 ` ```json ` 围栏的容错——order.md 的担忧未成立，按「只报不改」原样验证**：order.md D-3 提示「若发现 extractJson 对 ```json 围栏不容错，只在 report 里报，不改」。实测 `packages/lykoi-decide/src/index.ts:558-574` 的 `extractJson`：`JSON.parse(text)` 失败后退化为 `text.indexOf('{')` 到 `text.lastIndexOf('}')` 的切片再 `JSON.parse`——这个切片本身就与围栏文本（` ```json\n `、结尾的 ` ``` `）无关，只认花括号位置。用脚本验证：
   ```js
   extractJson("```json\n" + JSON.stringify({a:1,b:{c:2}}) + "\n```")
   // => {"a":1,"b":{"c":2}}  一次通过，无需二次修复
   ```
   即今天的 `extractJson` 对 fence 形态**已经容错**，D-3 提到的隐患不存在，因此本单在 D-4③ 的测试里直接覆盖了「前缀说明文字 + JSON + 后缀说明文字」这一更宽的场景（比单纯 fence 更贴近实测中 `first_char:cjk`/自然语言开场的退化态），同样一次通过。未对 `contract.ts`/`lykoi-decide` 做任何改动。
2. **`json_mode` 字段未写进 `lykoi-gate/src/vocabulary.ts`**：核对过该文件与其测试 `packages/lykoi-gate/test/vocabulary.test.ts`，均未提及 `u3_cycle_retried`/`u3_cycle_failed` 的字段集合（`grep -rn "u3_cycle_retried\|u3_cycle_failed" packages/lykoi-gate/` 零命中），说明这两个事件的载荷形状不受词汇表钉；也未见任何其它包对这两个事件的完整键集合做 `deepEqual`（除本单改口的 `cycle.test.ts` 自身）。按 order.md 的口径——「若……钉住了事件字段集合，按其规则同步，但不得新增事件名」——这里没有需要同步的钉点，只是照旧在 `cycle.test.ts`/`e2e.test.ts` 里更新断言。
3. **`nudge` 从「布尔实参」抽出成局部变量 `nudge`/`jsonMode`**：order.md 的伪代码把 `nudge`（attempt≥1）与 json_mode 的关系写得比较隐含（"值 = 刚失败的那一次请求是否带了 json_object"）。实现上直接在调用点把 `attempt >= 1` 存成 `const nudge`，再用 `const jsonMode = !nudge && envelopeJsonMode()` 显式表达"这次请求带没带 json_object"，避免在两处事件载荷里各自重算一遍判据（`envelopeJsonMode()` 读 env，两次调用理论上同值，但显式复用变量更不容易在未来改动时踩错）。此举未改变任何行为，只是把判据在同一次循环迭代内提成一个变量。
4. 未生成 manifest（order.md 明确只说「manifest 须重签」是治理侧后续动作，不在本单交付范围内）；未碰 `profile/**`、secrets、任何服务器/ssh；未做迁移；`governance/` 下除本文件外未改动其它文件。

## 提交

```
3e0745f [WO-FIX-JSONMODE-01] D-1/D-2：重试跳（nudge=true）去 json 模式 + 两事件补 json_mode
9b2f5b8 [WO-FIX-JSONMODE-01] D-4：测试——attempt 0 字节不变、重试去 json 模式、json_mode 事件字段、切片容错抠信封
<本提交> [WO-FIX-JSONMODE-01] report：收工报告
```
