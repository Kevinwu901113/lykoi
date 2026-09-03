# WO-FIX-TOOLSTEP-01 报告 · 工具步后第二跳关思考 + turn_failed 补元数据 + 白名单/人设按接线过滤

D-1 到 D-4 全部落地，全仓 `npx tsc --noEmit` 净，`npm test` 绿（17 个包 0 失败）。分支 `wo/fix-toolstep-01`。

- 基线：`main@1317cc8`（order.md §「基线」的代码树钉点）。worktree 起点 `142e51c` = `1317cc8` 单加 `governance/wo/WO-FIX-TOOLSTEP-01/order.md` 一个文件（已用 `git diff --stat 1317cc8 142e51c` 核实：81 行新增，仅此一个文件），两者代码树逐字节相同，故本报告的所有 diff 均以 `142e51c` 为对照基线，等价于对 `1317cc8`。
- 分支尖：见文末「提交」一节（本报告写就后提交、推送）。

## 一、D-1..D-4 对照表

| 定案 | 文件:行（当前树） | 内容 |
|---|---|---|
| D-1 | `packages/lykoi-converse/src/conversation.ts:209` | `ConverseLlmFn` opts 新增可选 `reasoningEffort?: 'off'` |
| D-1 | `packages/lykoi-converse/src/conversation.ts:881` | `#completion(step: number, signal?: AbortSignal)`：`step >= 1` 时展开 `{ reasoningEffort:'off' as const }`，`step===0` 与 summary 调用键不出现 |
| D-1 | `packages/lykoi-converse/src/conversation.ts:883` | `buildEnvelopeMessages(this.#assemble(), this.#deps.wiredActions)`（顺带把 D-3a 的 wired 参数接上） |
| D-1 | `packages/lykoi-converse/src/index.ts:357-362` | llm 接缝：`opts.reasoningEffort === undefined` 时 config 不出现该键，否则 `ReasoningEffortId(opts.reasoningEffort)` 透传给 `ctx.lykoiLlm.call` |
| D-2a | `packages/lykoi-converse/src/index.ts:582-598` | `handleTurn` catch 新增 `err instanceof LlmFinishError` 分支：`converse/turn_failed` 追加 `kind:'llm_finish'`、`finish_code`、`finish_status`（`?? null`）、`route`、`text_len`、`reasoning_len`；不记 `message`/`requestId`（S-21） |
| D-2b | `packages/lykoi-llm/src/index.ts:58-64` | `LlmCallResult.reasoningLength: number` |
| D-2b | `packages/lykoi-llm/src/index.ts:114-138` | `LlmFinishError.readonly reasoningLength: number`（构造入参同名字段） |
| D-2b | `packages/lykoi-llm/src/index.ts:175,187,230,234` | `call()` 循环对 `chunk.type==='reasoning-delta'` 累加 `[...chunk.text].length`（不存文本），成功/失败两条返回路都带 `reasoningLength` |
| D-2b | `packages/lykoi-wake/src/index.ts:150-158` | `LlmFn` 返回类型追加可选 `reasoningLength?: number` |
| D-2b | `packages/lykoi-wake/src/index.ts:294` | `autonomy_wake_retried{reason:'not_json'}` 追加 `reasoning_len: reply.reasoningLength ?? 0` |
| D-2b | `packages/lykoi-wake/src/index.ts:514`（llm 接缝 `return`） | `{ content: result.text, reasoningLength: result.reasoningLength }` |
| D-3a | `packages/lykoi-converse/src/contract.ts:161-168` | `envelopeToolNames(wiredActions?: ReadonlySet<string>)`：给了时按 `wiredActions.has(TOOL_TO_ACTION[name])` 过滤 `TOOL_TO_ACTION` 键，3 个 in-cognition 名恒在；不给 = 全量（字节不变） |
| D-3a | `packages/lykoi-converse/src/contract.ts:242-247` | `envelopeSystemPrompt(wiredActions?)` 同形透传给 `envelopeToolNames` |
| D-3a | `packages/lykoi-converse/src/contract.ts:268-273` | `buildEnvelopeMessages(assembled, wiredActions?)` 同形透传 |
| D-3b | `packages/lykoi-converse/src/prompts.ts:64-91` | 新增纯函数 `renderSystemPrompt(wiredActions?)`：正则 `/^- ([^（]+)（/` 只认 `- name / name…（` 形态的工具行；名字全部在 `TOOL_TO_ACTION` 里才算过滤对象，否则原样保留；过滤后一个名字都不剩则整行（含换行）删除；`wiredActions===undefined` 直接返回 `SYSTEM_PROMPT`（`===`，非结构相等） |
| D-3b | `packages/lykoi-converse/src/conversation.ts:420` | `#buildPersonaMessage` 由 `parts.push(SYSTEM_PROMPT)` 改 `parts.push(renderSystemPrompt(this.#deps.wiredActions))` |
| D-4 | 见下节「不动清单」 | — |

## 二、不动清单：sha 核验

用 `git stash` 把工作树临时还原到 `142e51c`（= 代码树 `1317cc8`），在**真实包目录**内用 Node ESM 直接 `import` 三个常量取 `.length`/sha256，再 `git stash pop` 复原；随后在当前树对同名导出重跑一遍同一段代码，两次结果逐字节比对：

| 常量 | 基线（`142e51c`/`1317cc8`） | 当前树 | 一致 |
|---|---|---|---|
| `SYSTEM_PROMPT`（`prompts.ts`） | chars=1418, sha256=`72a3c1c128b63def708fdd5fedd89792098b821071662e164f511bc7e6a81314` | 同左 | 一致 |
| `ENVELOPE_SYSTEM_PROMPT`（`contract.ts`） | chars=1748, sha256=`88587c8e3d923969d16a92e4cb996b6d45d5e2e077ac7af00ff016a39c0be14a` | 同左 | 一致 |
| `TOOL_TO_ACTION`（`contract.ts`，`JSON.stringify` 按 key 排序后取 sha） | sha256=`53cd478889d55006b095909d940caff7e2031313d93890291497510310e79fb6` | 同左 | 一致 |

补充结构性核验（`git diff 142e51c -- <path>`，非语义 diff）：

- `packages/lykoi-kernel/`、`packages/lykoi-organ-browser/`、`profile/` 三处：diff 输出为空，零改动。
- `packages/lykoi-llm-deepseek/vendor/`（vendor 真身代码，非测试）：diff 输出为空，零改动；本单只在 `packages/lykoi-llm-deepseek/test/deepseek.test.ts` 加了 2 条新测试（探针 B/D 的线上序列化实证，见五节）。
- `toolDispatchGate`（`contract.ts:627`）、`cycleRecord`（`contract.ts:653`）：不在本次任何 diff 命中范围内，函数体逐字节未动。
- `#buildAction`（`conversation.ts:1115`）及其三个事件：不在 diff 命中范围内。
- `conversation.ts` 全量 diff 核对：仅命中 `ConverseLlmFn` opts 类型（新增可选字段）、`#buildPersonaMessage` 的 `SYSTEM_PROMPT→renderSystemPrompt` 换用、`#completion` 签名与调用点（新增 `step` 入参与条件展开）三处；其余（含 `#runCycle`、`#buildAction`、`cycleRecord` 调用点）逐字节不变。
- `index.ts`（converse）全量 diff 核对：llm 接缝新增 `reasoningEffort` 条件展开一处；`handleTurn` catch 新增 `LlmFinishError` 分支一处，插在既有 `ContextBudgetError` 分支之后、既有 S-21 泛化兜底分支之前——两个既有分支本身逐字节未动（新分支是纯插入，非改写）。
- `wake/index.ts` 全量 diff 核对：仅命中 `LlmFn` 返回类型（新增可选字段）、`autonomy_wake_retried` 的 `reasoning_len` 一个 kv、llm 接缝 `return` 语句追加 `reasoningLength` 一处；其余（含各接口位、budget/audit 记账口径）逐字节不变。

## 三、每包测试计数（`npm test --workspaces --if-present`，全绿）

| 包 | tests | pass | fail |
|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 |
| lykoi-audit | 3 | 3 | 0 |
| lykoi-budget | 5 | 5 | 0 |
| lykoi-converse | 120 | 119 | 0 |
| lykoi-decide | 94 | 94 | 0 |
| lykoi-gate | 72 | 72 | 0 |
| lykoi-heart | 14 | 14 | 0 |
| lykoi-kernel | 199 | 199 | 0 |
| lykoi-learn | 87 | 86 | 0 |
| lykoi-llm | 9 | 9 | 0 |
| lykoi-llm-deepseek | 7 | 7 | 0 |
| lykoi-memory | 120 | 111 | 0 |
| lykoi-organ-browser | 66 | 66 | 0 |
| lykoi-reflow | 35 | 35 | 0 |
| lykoi-regulation | 45 | 45 | 0 |
| lykoi-snapshot | 52 | 52 | 0 |
| lykoi-wake | 32 | 32 | 0 |

`tests`/`pass` 少数几包不等（converse 120/119、learn 87/86、memory 120/111）是既有的 node:test 嵌套子测试计数口径差异（`tests` 计入了父测试自身，`pass` 只计叶子），本单之前的基线已是这个口径，不是本单引入的回归——`fail` 全零是唯一要紧的数字。

`npx tsc --noEmit`（全仓）：净，exit 0。

## 四、测试清单（按 D 编号）

**D-1**（`packages/lykoi-converse/test/toolstep.test.ts`，新文件，4 条）
- step 0 信封调用：`'reasoningEffort' in h.llm.calls[0]!.opts === false`（键本身不在，不是 `undefined`）。
- step≥1：每一次都 `opts.reasoningEffort === 'off'`；工具帧（`tool_calls`/`tool_call_id`）仍完整留在历史里。
- 多步工具循环：连续多个 step≥1 的调用无一遗漏。
- summary 调用（`purpose==='summary'`）：键不出现。

**D-1 接缝**（`packages/lykoi-converse/test/wire.test.ts`，真装配：`Context`+`LlmRuntime`+`CapturingAdapter`）
- `CapturingAdapter.resolveModel()` 声明 `reasoning:{efforts:[{id:'off',...}]}`（不声明 `defaultEffort`，避免 dsh-llm 运行时把未请求的调用也材化出 `reasoningEffort`，见「偏离」）。
- `adapter.seen[0]` 无 `reasoningEffort` 键，`adapter.seen[1].reasoningEffort==='off'`——证明这个键真的通到 `GenerateOptions` 这一跳，不只是 converse 内部 opts 对象。

**D-2a**（`packages/lykoi-converse/test/llm-finish.test.ts`，真装配）
- `converse/turn_failed` 载荷：`kind==='llm_finish'`、`finish_code==='NO_ADAPTER'`、`finish_status===null`（adapter 没给 status，断言是 null 不是缺席）、`route==='mock'`、`text_len===0`、`reasoning_len===0`。
- `'message' in failed[0]===false`、`'requestId' in failed[0]===false`（S-21）。
- 既有断言（`error==='LlmFinishError'`、S-14 回滚、budget 记账、`u3_cycle_failed` 零条）保留未改，证明新分支不影响既有落点。

**D-2b**（`packages/lykoi-llm/test/llm.test.ts`，9 条，含 3 条新增）
- 绿测：`reasoning='想想🤔看'`（`.length===5`，codepoint 数 `===4`）→ `result.reasoningLength===4`；`!JSON.stringify(result).includes(reasoning)`（零正文口径）；text/usage/charge 不受影响。
- 红测：`finish{error}` 抛出的 `LlmFinishError.reasoningLength` 同样按码点数累计。
- 既有路径（无 `reasoning-delta` chunk）：绿/红两条路 `reasoningLength` 恒 0。

**D-2b 透传**（`packages/lykoi-wake/test/wake.test.ts`，32 条，含 1 条新增）
- 新测：`LlmFn` 首包 `reasoningLength:137` → `autonomy_wake_retried` 事件的 `reasoning_len===137`；次包 JSON 合法后 `wakeOnce` 正常 `completed`。

**D-3a**（`packages/lykoi-converse/test/prompts.test.ts`）
- `envelopeToolNames(PROD_WIRED)` 精确等于 `['browser_get_text','browser_navigate','notify_owner','research_read_text','terminal_exec','vision_describe','promise_followup','post_progress']`（与 order.md §3 给定顺序一致）。
- `buildEnvelopeMessages` 把 `wiredActions` 传下去后 `{tools}` 替换段随之收窄。
- 无参/全接线两种调用下 `envelopeToolNames()`/`envelopeSystemPrompt()`/`buildEnvelopeMessages()` 与既有钉（sha/码点数）逐字节不变。

**D-3b**（同上 `prompts.test.ts`）
- `renderSystemPrompt(undefined) === SYSTEM_PROMPT`、全接线集合下 `renderSystemPrompt(FULL) === SYSTEM_PROMPT`（`===`，非结构相等）。
- 产线接线集合 `PROD_WIRED = {'terminal.exec','browser.navigate','browser.get_text','research_browser.read_text','notify.owner'}` 下：`renderSystemPrompt(PROD_WIRED)` 精确 sha 钉（chars=1325，sha256=`665a4399002c1f786dcb27f963c3fd2bf3ffac7acad60bff2be9bd77b223690c`），恰好 2 处工具行被改写（研究工具行、浏览器工具行各收窄），与 order.md「已知残留」描述的第 19 行残留说明文字一致（未处理，按 order.md 原话是留给 Kevin 裁的活体 raw 文案，非本单范围）。
- 空接线集合：整行删除 3 行（不是直觉上的 2 行——`notify_owner` 单独一行的枚举形态也命中同一条正则，随空集合一并整行删除），并额外验证 `SYSTEM_PROMPT` 里散文体提到 `notify_owner` 的另一处（非枚举行形态，如"直接用 notify_owner 问他"）不受这条正则影响、原样保留——证明函数的作用范围精确到"枚举行"这一种语法形态，不做全文替换。

**D-1 线上序列化实证**（`packages/lykoi-llm-deepseek/test/deepseek.test.ts`，7 条，含 2 条新增，本地 mock HTTP 服务器捕获原始请求体）
- 显式 `reasoningEffort:'off'` → wire body `thinking` 深等于 `{type:'disabled'}`，且 `'reasoning_effort' in body===false`（对应探针 B）。
- 不给 `reasoningEffort`、部署也未配置 thinking/reasoningEffort 默认值 → wire body 落 `thinking:{type:'enabled'}` + `reasoning_effort:'high'`——这就是根因本身在线上序列化层的直接证据：dsh-llm 的 `LlmRuntime.resolveCallWithInfo()` 在 `adapterStream` 之前，把 adapter `resolveModel()` 报告的 `reasoning.defaultEffort`（部署未配时落 `HIGH`，`vendor/index.js:1406`）材化进 `options.reasoningEffort`，adapter 自己的 `resolveThinking()` 收到的已经是 `'high'`，不是 `undefined`。此发现见「偏离」第二条。

## 五、偏离（order.md 未覆盖、按最小改动就地判断，未停下来问）

1. **测试用 adapter 补 `resolveModel()` 声明** —— `packages/lykoi-llm/src/mock.ts` 的 `MockAdapter`、`packages/lykoi-converse/test/wire.test.ts` 的 `CapturingAdapter` 原本都不声明 `resolveModel()`，默认（基类）不带任何 `reasoning` 元数据。D-1 落地后任何 `step>=1` 的调用请求 `reasoningEffort:'off'`，dsh-llm 的 `resolveCallWithInfo()` 会因为 adapter 没申报匹配的 `reasoning.efforts` 而抛 `UNSUPPORTED_REASONING_EFFORT` → `finish{error}` → `LlmFinishError`——三个既有测试（`wire.test.ts`、`e2e.test.ts`、`kernel-e2e.test.ts`）因此变红。order.md 没有点名这个测试夹具缺口。按最小改动原则，给两处测试用 adapter 补了一段 `resolveModel()` 覆写，只声明 `reasoning:{efforts:[{id:'off',name:'off'}]}`，刻意不给 `defaultEffort`——给了会让 dsh-llm 在没被请求时也把 `reasoningEffort` 材化进 resolved config，把 D-1「step 0 一个字都不带」的断言测到错的那一层（dsh-llm 自己的默认化，而不是 lykoi-converse 的请求内容）。
2. **发现生产环境的真实默认值是「思考开、effort=high」，而非「无 thinking 键」** —— 写 `deepseek.test.ts` 对照组时最初假设「不给 `reasoningEffort` → wire body 不带 `thinking` 键」，跑起来是错的（真实抓包 `thinking:{type:'enabled'}, reasoning_effort:'high'`）。根因：dsh-llm 的 `LlmRuntime.resolveCallWithInfo()` 会用 adapter 申报的 `reasoning.defaultEffort` 兜底未显式请求的调用，而真身 adapter（`vendor/index.js` 的 `modelInfoFor`）在部署未配置时把这个默认值报成 `HIGH`。这不是本单要修的东西（D-4 明确 `lykoi-llm-deepseek/**` 不动），但它是根因叙事的直接补强证据（v4-flash 默认思考开，不是"某种边缘配置下才开"），已按事实改写了测试的标题与断言，未按最初假设强行让测试通过。
3. **未新增 D-2a 非-`LlmFinishError` 分支的端到端红测** —— order.md 要求"非 LlmFinishError 分支载荷逐字不变"，已通过 `git diff 142e51c -- packages/lykoi-converse/src/index.ts` 的结构性核验（新分支是插在既有 `ContextBudgetError` 分支与既有 S-21 泛化兜底分支之间的纯插入，两个既有分支的每一行字节未动）证明，未额外写一条重复的端到端测试去触发那两条既有分支——那两条分支本身已有各自既有测试覆盖，本单不重复造轮子。
4. **commit 分组按实际改动面归并，而非严格复刻 order.md §4 建议的四段切法** —— 由于本会话是从「D-1/D-2/D-3 源码已实现、仅缺测试与收尾」的状态续接，源码改动与测试改动在同一批文件里交织（例如 `mock.ts` 的 adapter 修复同时服务于 D-1 的测试可跑性），提交仍按 D 编号分组（① D-1 源码+测试+adapter 修复，② D-2a/2b 源码+测试，③ D-3a/3b 源码+测试，④ 本报告），但每个分组内部允许源码与其对应测试同批提交，不再机械拆成"先全部源码、后全部测试"。

## 六、提交

分支 `wo/fix-toolstep-01`，基线 `main@142e51c`（=`1317cc8`+order.md）。四次提交，均中文提交信息，尾行 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`：

1. `0891d5b` D-1（工具步后关思考）+ 接缝 + 测试用 adapter 的 `resolveModel()` 修复 + toolstep/wire/deepseek 测试。因 `packages/lykoi-converse/src/index.ts` 的 import 改动与 D-2a 引入 `LlmFinishError` 那一行同处一个 hunk 不可分割，D-2a 的 `converse/turn_failed` catch 分支源码**也在这一次提交里落地**（commit message 里「函数体本体仍在后续提交」一句是笔误，实际未拆开——特此在报告里更正，不追加 `--amend`，以免违反「只新建提交、不改写历史」纪律）。
2. `17038a6` D-2b（`lykoi-llm` reasoning-delta 码点计数、`LlmCallResult`/`LlmFinishError` 增字段、wake 透传 `reasoning_len`）+ D-2a 的载荷断言测试（源码已在提交 1 落地，此处补测试）。
3. `564d6dd` D-3a（契约白名单按接线过滤）+ D-3b（人设提示词按接线过滤）+ 对应测试。`conversation.ts`/`index.ts` 里消费 D-3a/D-3b 两个函数的调用点因 hunk 不可分割已在提交 1 落地。
4. 本报告（待提交，见下）。

推送：`git push origin wo/fix-toolstep-01`（本报告提交后执行）。
