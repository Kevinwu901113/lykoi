# 工具步四项观察的结构分析（2026-09-04）

范围：LANDING-M 与 WO-OPS-BROWSER-PROXY-01 落地后三条 Telegram 的读数（HANDOFF §五）。四项观察：notify_owner 参数名猜错、接地缺口（超时记 success）、step 0 延迟 85/10/69 s、答案走通知道而非回复道。

原则：不打补丁；轻框架/重模型；改动落在结构缝上，一处真相。

## 1 · 工具的参数形状没有真相源

模型能读到工具的地方有三处，没有一处带参数：

| 位置 | 内容 | 参数 |
|---|---|---|
| `lykoi-converse/src/prompts.ts` SYSTEM_PROMPT | 工具名 + 用途散文 | 无；另含「在 query 里加年份」——`query` 不是任何已接线工具的参数（旧 Python 栈搜索工具遗留；`research_open/extract_links` 未接线） |
| `contract.ts` `{tools}` | `envelopeToolNames()` 裸名 join | 无 |
| 器官清单块（`lykoi-decide/src/organs.ts`） | 动作类型按前缀分组 | 无 |

参数形状只存在于动作层：`organ-browser/src/index.ts toArgs()`（url / max_chars）、`adapter-telegram/src/resources.ts notifyOwner()`（content）。模型只能从失败字符串里学（`url 必填`、`requires 'content'`）。实测模型一步自纠，但每次猜错耗一个 step（上限 8）与一跳时延；`notify.owner` 猜错是抛错路径，成 `success:false` 回执。

`TOOL_TO_ACTION`（contract.ts）已经是工具名的唯一真相源（D-02：白名单、枚举类型、派发闸都从它派生）。结构缺的是这张表没有第二列。

## 2 · 两套成功词汇在内核缝上错接

`kernel/dispatch.ts` 的 `Observation.success` 语义是「handler 跑完没抛」（SK-10 资源边界）；抛错路径 `data:{}` 只留 error 串。器官宿主为了不让她读到「一团黑」（organ-browser 红线 #5）刻意**返回** `{ok:false,error,detail}` 而不抛，于是超时/拦截都成了 `success:true`。

下游三处都读 `success`：审计 `action_result`（记 success:true）、converse `#resultPayload` 原样透传给模型、`contract.ts receiptsPresentInContext()`（`payload.success !== false` 即算有回执）。白皮书 37.8「回执背书」因此在超时上失效：「我刚查了」被判有据。

缝在 dispatch：handler 返回值到 Observation 的那一步。器官已经用 `ok` 说了真话，内核没听。

## 3 · 推理策略有两个主人

DeepSeek 思考档位由两处决定：adapter 缺省（profile `llm-deepseek` 无 config → vendor 兜底 HIGH，隐式）与 converse `#completion` 的 per-step 覆盖（WO-FIX-TOOLSTEP-01：step ≥ 1 `reasoningEffort:'off'`）。后者是原生工具帧 400 的绕行；根因已由 TOOLFRAME-01 消除（探针 v4：文本帧下思考开也干净）。

现状读数：step 0（HIGH）85 / 10 / 69 s；step ≥ 1（off）1–3 s。但 `u3_cycle_envelope` 只记 `elapsed_ms`，不记 prompt/completion/reasoning tokens，85 s 是思考长还是前缀缓存未命中无法区分。`LlmResult` 已带 `usage` 与 `reasoningLength`，converse 只在失败事件里记后者。

DeepSeek 档位只有 off/low/high/max（vendor `Config`），无 medium。

## 4 · 通知道替代回复道

模型在对话中用 `notify_owner` 送答案后选 silence。`notify_owner` 在 SYSTEM_PROMPT 里的描述是「主动联系 Kevin」与「要联系方式/验证码时直接问他」，未说明它与 reply 的分工。这是描述问题，归第 1 条：工具表的用途列。

## 5 · 决定

三张单，各改一处结构缝，均不加新机制：

- **WO-FIX-TOOLSPEC-01**（converse）：`TOOL_TO_ACTION` 升为工具表 `{action, signature, purpose}`；`{tools}` 从表渲染 `name(参数) — 用途`；SYSTEM_PROMPT 工具散文段删除、`query` 句删除；`notify_owner` 用途写明「对话之外主动找他；对话中直接 reply」。三个 in-cognition 工具同表。J 的 wiredActions 过滤保留。
- **WO-FIX-ORGANOK-01**（kernel）：dispatch 收到 handler 返回值后，若 `ok === false` 则 Observation `{success:false, data, error: data.error}`，data 保留；不改器官、不改 converse、不改回执逻辑。审计 `action_result.success` 随之如实。
- **WO-FIX-THINKPOLICY-01**（profile + converse）：D-0 `u3_cycle_envelope` 补 usage/reasoning_len；D-1 profile 显式声明 thinking/reasoningEffort（消灭隐式 HIGH）；D-2 删 converse per-step 覆盖，推理策略回到 adapter 一处。档位取值由探针 v5（step 0 形态 × off/low/high，各两次，记时延与 reasoning 长度）决定，探针先于代码。

不立单：45 s/180 s 期限（代理落地后单次取数 3 s，期限不再是瓶颈）；`&amp;`（审计显示转义，已撤回）。
