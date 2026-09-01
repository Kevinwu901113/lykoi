# WO-LLM-FINISH-01 执行报告

（执行方 opus 子 Agent 一次性输出全文，治理侧存档未改动；受审尖 a2ad35a）

## ① FinishReason 类型定义原文引用

出处：`node_modules/@deepseek-ai/dsh-llm/lib/types/types.d.ts`（包版本 `0.1.1-rc.2`，`package.json` 实测），第 90-114 行逐字：

```
/**
 * Why a model response stopped.
 * Merge-extensible so adapters can surface provider-specific reasons.
 */
export interface FinishReasonMap {
    'stop': {
        kind: 'stop';
    };
    'tool-calls': {
        kind: 'tool-calls';
    };
    'max-tokens': {
        kind: 'max-tokens';
    };
    'aborted': {
        kind: 'aborted';
        failure: LlmFailure;
    };
    'error': {
        kind: 'error';
        failure: LlmFailure;
    };
}
/** Any known finish reason, derived from {@link FinishReasonMap}; switch on `kind` and fall through unknowns (merge-extensible). */
export type FinishReason = FinishReasonMap[keyof FinishReasonMap];
```

`LlmFailure`（同文件 25-37 行）：`readonly message: string` / `readonly code: string` / `readonly status?: number` / `readonly providerRetryAfterMs?: number` / `readonly requestId?: ProviderRequestId`。

**失败类词表 = `{'error', 'aborted'}`**，即五个 kind 里恰好带 `failure: LlmFailure` 的两个。该划分不是我的判断，是上游自己的口径，两处独立佐证：

- `node_modules/@deepseek-ai/dsh-llm/lib/index.js`（`stream` 的 JSDoc）："Adapter selection, dispatch, and iteration failures become terminal `error` or `aborted` finish chunks; middleware, nested-call, cleanup, and consumer failures remain thrown."
- 同文件 `adapterFailureChunk()`：`signal?.aborted || failure.code === "ABORTED"` → `{kind:"aborted", failure}`，否则 `{kind:"error", failure}`；`lib/invariant.js:53` 的未闭合块检查同样只对 `error`/`aborted` 放行。

`FinishReasonMap` 声明为 merge-extensible，故实现按**白名单**判失败类：将来插件新增的 kind 不在表内，按非失败类原样带出（本层不替别人猜语义）。工单前提成立，无冲突。

## ② diff 摘要（文件:行级）

`packages/lykoi-llm/src/index.ts`（+91/-1）

| 行 | 内容 |
|---|---|
| 19 | import 增 `LlmFailure` 类型 |
| 55-60 | `LlmCallResult.finish` 注释改写：原「error/aborted 也原样带出，由调用方裁决」→ 只有非失败类从这里出来 |
| 63-76 | `FAILURE_FINISH_KINDS = ['error','aborted'] as const`（doc 里钉死词表出处与包版本） |
| 78-82 | `FailureFinishKind` / `FailureFinishReason = Extract<FinishReason, {kind: FailureFinishKind}>` |
| 84-87 | `isFailureFinish(reason)` 类型谓词 |
| 89-129 | `export class LlmFinishError extends Error`：`reason`（全量）/`route`/`usage?`/`textLength`；message 形如 `lykoi-llm: model call finished with error (route=mock code=NO_ADAPTER status=503 text_chars=0): <failure.message>` |
| 131-141 | `LykoiLlmService.call` doc 增「失败类 finish 在 charge 之后抛」 |
| 204-216 | **唯一行为改动**：`if (hasThrown) throw thrown` 之后、`return` 之前新增失败类分支抛 `LlmFinishError` |

未改动：`gate` 段（161）、chunk 消费循环（168-184）、`chargeInput` 构造与 `charge` 段（186-202）、`hasThrown` 优先级、非失败类返回语句（218）。budget/gate 语义、usage 缺席按 0 记账的 `TODO(M2)`、prompt/ENVELOPE、vendor payload 全未触碰；零新依赖；kernel/gate 包零改动。

`packages/lykoi-llm/test/llm.test.ts`（+125/-1）：import 增 `LlmAdapter`/`LlmFinishError`/类型；新增 `FinishAdapter`（可编程终止 adapter）与 `setupWith()`；新增 3 个测试。既有 3 个测试一字未改。

`packages/lykoi-converse/test/llm-finish.test.ts`（新建，157 行）：调用点落点实证，真装配（真 `LlmRuntime` + 真 `lykoi-budget` + 真 `converse` 接线 + telegram 入站），无生产代码改动。

## ③ 调用点枚举表与落点判读

`ctx.lykoiLlm.call` 全部调用点（5 处），加 1 处经服务句柄的调用：

| # | 文件:行 | 用途 | 新抛错的既有落点 | 判读 |
|---|---|---|---|---|
| 1 | `packages/lykoi-converse/src/index.ts:334` | `ConverseLlmFn`（信封周期，`conversation.ts:823 #completion`） | `conversation.ts:1274` catch → `chat_turn_rolled_back`（S-14 整轮回滚）→ 重抛 → `index.ts:553` `handleTurn` catch → audit `converse/turn_failed{error:'LlmFinishError'}` → return | 既有失败路，无新面。**已实证**（见 ④） |
| 2 | 同上（同一 seam） | 摘要（`conversation.ts:775 #summarize`） | `conversation.ts:729` catch → `context_summary_failed` 事件 → return（摘要失败不是坏回合） | 既有失败路，已吞 |
| 3 | `packages/lykoi-converse/src/index.ts:379` | vision `describeImage` | `conversation.ts:1119` catch → `vision_error` 事件 + `{success:false, error:'vision model failed'}` 回填模型 | 既有失败路。注：M4 定案 vision 显式 `disabled`，此路生产上零真调用 |
| 4 | `packages/lykoi-converse/src/index.ts:458` | 审批判读（`runInterpretWithDeadline` 内） | `deadline.ts:167` catch → 有界重试 → 终局 `INTERPRET_FAILURE_EVENT` → 重抛 → `kernel/approval-interpreter.ts:451` catch → `_unclear('llm_unavailable', {error: exc.message})` | 既有失败路。**永不 approve、永不挡路**（SK-36 五失败路之一）；`error` 栏记 `exc.message`，含 reason/code |
| 5 | `packages/lykoi-converse/src/index.ts:492` | 规则建议判读 | `kernel/suggestion-conversation.ts:551` catch → `rule_suggestion_interpret_failed{error}` → `{...fallback, reason:'llm_unavailable'}` | 既有失败路，永不 accept |
| 6 | `packages/lykoi-wake/src/index.ts:450` | wake `LlmFn`（自主拍 `index.ts:252`） | `index.ts:274` catch → `finishAutonomyRun(status:'failed')` + `bumpWakesSince` + `autonomy_wake_failed{run_id, error}` → 返回 `{status:'failed'}` | 既有失败路（SA-170「一拍失败不杀循环」）；`error` = `exc.message`，含 reason/code |
| 6b | 同上（`index.ts:509` / `517`） | 整合 L2 / 专注 L4（同一 `LlmFn` 闭包） | `index.ts:318` / `327` catch → `autonomy_integrate_failed` / `autonomy_focus_failed` | 既有失败路，已吞成遥测 |
| — | `profile/index.ts:64` | M1 smoke 序列（`llm.call` 经服务句柄，非 `ctx.lykoiLlm`） | `catch` 只放行 `BudgetExceeded`，其余重抛 → smoke 非零退出 | mock adapter 恒发 `finish{stop}`，此路不受影响；即便受影响，行为是 smoke 大声失败，符合意图 |

**无新的 unhandled rejection 面**：6 个调用点全部已在 `await` 表达式上、全部有上游 catch；本次未新增任何未 await 的调用。`.finish`/`finishReason` 的消费点只有 `converse/src/index.ts:350`（`result.finish?.kind ?? null`）与 `conversation.ts:877`（日志栏），均只在非失败类路径上取值，无一处依赖 error/aborted 从返回值出来（全仓 grep 佐证）。

## ④ 测试数字与新测试输出

Node v24.18.0，`npm ci` 后前台串行跑，`npm test`（workspaces 全量）。

| 包 | 基线 tests/pass/fail/skip | 修改后 tests/pass/fail/skip | Δ |
|---|---|---|---|
| lykoi-adapter-telegram | 55/55/0/0 | 55/55/0/0 | 0 |
| lykoi-audit | 3/3/0/0 | 3/3/0/0 | 0 |
| lykoi-budget | 5/5/0/0 | 5/5/0/0 | 0 |
| lykoi-converse | 94/93/0/1 | 95/94/0/1 | **+1（本单新增）** |
| lykoi-decide | 69/69/0/0 | 69/69/0/0 | 0 |
| lykoi-gate | 72/72/0/0 | 72/72/0/0 | 0 |
| lykoi-heart | 14/14/0/0 | 14/14/0/0 | 0 |
| lykoi-kernel | 194/194/0/0 | 194/194/0/0 | 0 |
| lykoi-learn | 68/67/0/1 | 68/67/0/1 | 0 |
| lykoi-llm | 3/3/0/0 | 6/6/0/0 | **+3（本单新增）** |
| lykoi-llm-deepseek | 5/5/0/0 | 5/5/0/0 | 0 |
| lykoi-memory | 80/71/0/9 | 80/71/0/9 | 0 |
| lykoi-reflow | 31/31/0/0 | 31/31/0/0 | 0 |
| lykoi-regulation | 45/45/0/0 | 45/45/0/0 | 0 |
| lykoi-snapshot | 49/49/0/0 | 49/49/0/0 | 0 |
| lykoi-wake | 26/26/0/0 | 26/26/0/0 | 0 |
| **合计** | **813/802/0/11** | **817/806/0/11** | **+4 全部为本单新增** |

两次 exit code 均 0。**差异逐条解释：唯一差异是 +4 个新测试点（3 个 lykoi-llm + 1 个 lykoi-converse），无任何既有测试的通过/跳过状态变化，零新增失败。** 11 个 skipped 与基线同一批（lykoi-memory 9、lykoi-converse 1、lykoi-learn 1），本单未触碰。

新测试点名输出（`packages/lykoi-llm` 全量）：

```
✔ 红测：gate 拒绝时调用不发生（adapter 零调用、charge 零发生）
✔ 绿测：gate 放行 → 调用发生 → 恰好一次 charge，用量按 dsh-llm usage 词汇映射
✔ 红测（WO-LLM-FINISH-01）：finish{error} → call() reject（LlmFinishError，reason 全量保真）
✔ 红测：finish{aborted} 同属失败类；usage 缺席仍按 0 记账（M2 口径不变）
✔ 绿测：非失败类 finish（tool-calls / max-tokens / stop）行为不变，仍随返回值带出
✔ mock 插件形态：经 cordis 装载注册路由，listProviders 可见
ℹ tests 6  ℹ pass 6  ℹ fail 0
```

```
✔ WO-LLM-FINISH-01 落点：finish{error} → converse 既有失败路（turn_failed=LlmFinishError），charge 仍发生
ℹ tests 1  ℹ pass 1  ℹ fail 0
```

**红绿双验（临时禁用 `if (isFailureFinish(finish))` 分支后复跑，验毕已还原并逐字节比对源文件）：**

- `lykoi-llm`：2 个新红测均以 `AssertionError: Missing expected rejection` 失败（pass 4 / fail 2）；绿测仍过 → 证明红测测的是新行为本身。
- `lykoi-converse` 落点测试：以 `调用发生过（不是被闸拦下）: 2 !== 1` 失败——**这正是事故形态的复现**：无修复时空 text 流到下游，信封解码空串 → D-01 `not_json` 有界重试再打一次模型（adapter 被调 2 次），根因以 `u3_cycle_failed` 的形态晚两层出现。修复后 adapter 恰 1 次调用、`converse/turn_failed{error:'LlmFinishError'}` 一条、`u3_cycle_failed` 零条、`budget/charge{route:'mock', promptTokens:10, completionTokens:0}` 一条。

记账断言（工单 scope 4）在两处独立成立：`lykoi-llm` 单测断言 `charges` 恰一条且用量按 dsh-llm 词汇映射；converse 落点测试断言真 budget 插件落了 `budget/charge` audit 行。

## ⑤ typecheck

`npm run typecheck`（`tsc --noEmit`，root tsconfig：strict / NodeNext / erasableSyntaxOnly）：**净，exit 0，零输出**。基线亦为 exit 0。

## ⑥ 分支尖 commit sha

- 分支：`wo/llm-finish`（未 push、未合并）
- 尖：`a2ad35a79483d7328580c53749b57f2ac89b197a`（`a2ad35a`）
- 父：`1976325`
- 单 commit，标题 `[WO-LLM-FINISH-01] lykoi-llm: 失败类 finish 就近抛，不再静默随返回值带出`；工作树 clean。

## ⑦ 偏离工单处

1. **基线 commit 不是工单写的 595d41c**。隔离工作区分支基于 `main@1976325`（签发后 main 又前进了两个提交：`79f7bbb` README 重写、`1976325` 治理条目）。两者均不含业务代码改动（`packages/lykoi-llm` 从 `595d41c` 到 `1976325` 无 diff），基线语义等价。此为派发时已给定的工作区状态，非我的选择。
2. **测试新增落在两个包，其中一个不是 lykoi-llm**。工单 scope 3 要求「实证新抛错落入各自既有失败处理路径」且「只核对与测试，不重构调用方」。纯静态阅读不算实证，故在 `packages/lykoi-converse/test/` 新增一个**只读**测试文件做真装配落点验证，零生产代码改动、零调用方重构。视作 scope 3 的「测试」授权范围内，非扩权。
3. **`textLength` 用码点数（`[...text].length`）而非 UTF-16 长度**。与仓内 D-08 口径（`conversation.ts:875 content_chars` 等处一律 `[...s].length`）对齐。工单只写「text 长度」，未指定口径；事故场景（空串）两种口径均为 0。
4. **失败类判定用白名单而非「有 failure 字段即失败」**。因 `FinishReasonMap` 声明为 merge-extensible，未来扩展的 kind 语义未知，按工单「非失败类行为逐字节不变」的要求取保守侧：不在词表内即按非失败类原样带出。已在源码 doc 注释中写明。
5. 其余无偏离。forbidden 全项遵守：budget/gate 语义与记账口径零改动（`usage` 缺席按 0 记账的 `TODO(M2)` 原样保留并被新测试钉死）、prompt/ENVELOPE 零改动、vendor payload 构建零改动、零新依赖、kernel/gate 包零改动。
