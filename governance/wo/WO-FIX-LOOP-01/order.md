# WO-FIX-LOOP-01 · 认知回路四处小修（器官清单如实 / 溯源门放宽 / wake 有界重试 / 重启线索时间戳）

- 签发：治理侧，2026-09-02
- 上位：用户层完成度评估（2026-09-02，治理会话；Kevin 裁决"先开小单修 1/2/3/6"）；
  `docs/persona_layering_design_v1_2026-09-01.md` §5 顺序不受影响；
  `wo/WO-U2-SENSE-01`（capability_gap 纪律，本单扩一条 reason）
- 基线：main `cfd477c`（代码 = 89b04dd + LANDING-E 记录），治理侧实测 **880/869/0/11**，tsc 净
- 执行：sonnet 子 Agent，隔离 worktree，分支 `wo/fix-loop-01`
- 产线现状：main@89b04dd，mind_schema **17**（LANDING-E 2026-09-02 15:09 施加）。
  **本单零迁移、零装配改动、零 env**；落地 = 拉 main + 重启（deploy.md §11）
- 受保护包：`lykoi-kernel` 有一处小改（§2 D-1a），治理复核必过；`lykoi-gate` 不动

## 0. 一句话

她上线两天的活体读数说明四件小事在同时拖累她：清单对她撒谎（说 18 个动作接得通，
实际 5 个），溯源门把她引用了的决定当没引用（13/47 拍降级），wake 一次空回包就
整拍报废（6 拍），重启线索把 CST 当美国中部时间算出负停机。四处各修各的，
每处一条治理定案，不碰提示词、不碰装配、不碰门。

## 1. 事实（治理侧 2026-09-02 取证，执行方不必重查，但可复核）

**器官清单**

- 生产两处（`lykoi-wake/src/index.ts:423-426`、`lykoi-converse/src/index.ts:238-243`）
  的 `OrganInventoryCache` 用 `kernelActionCatalog`（`lykoi-kernel/src/dispatch.ts:509-515`）
  = `KNOWN_ACTION_LIST` 全部 18 项。渲染头 `'动作能力(代码里实际接得通的全部):'`
  （`lykoi-decide/src/organs.ts`）于是对她说谎。
- 真接线的注册表是 `lykoi-adapter-telegram/src/resources.ts:111` `outboundOrganResources()`
  = `unwiredResources()` 替身底座 + 5 个真 handler（messenger.send/read、notify.owner、
  autonomy.queue_notification/initiate_chat）+ `registerOrganHandler` 的追加项；
  两处生产各调一次交给 `createDispatch({resources})`（wake :435、converse :265）。
- 替身 handler（`dispatch.ts:181-190`）一调就抛 `器官未接线: …`，经 `_executeDecision`
  的资源边界 catch 落成 `Observation{success:false,error}`（:340-346）。
- 活体后果：09-01 09:04 对话里她按清单调 `research_open` → 替身失败 → not_json →
  沉默；独处 6 拍 explore 全部撞 `research_browser.read_text` 替身；她自己在关切#9
  写下"通道死"，随后多拍围绕"撞墙"打转。`capability_gap` 两天 **0** 条 ——
  位点⑤（dispatch 替身）本就无发射点（`capability-gap.ts` 文件头纪律 3 只讲了
  `not_registered`）。
- 对话面工具闸 `conversation.ts:1046 #buildAction`：只有"名字不在 `TOOL_TO_ACTION`"
  一路（位点④）；在表但未接线的动作照样走 dispatch。

**溯源门**

- `decide/index.ts:615-630 groundedEntries`：reason 逐字包含某评估条目 item/meaning
  （≥ `GROUND_MIN_CHARS`=4 码点）才算引用；否则 `demote(…,'reason_not_grounded')`
  → safeKind（wake=rest，converse=silence）。提示词（:424）确实要求"逐字引用(原样复制)"。
- 活体 13 条 `decision_ungrounded`（reason 前 200 字全部核过）：她**都在引用**，
  用 『』/'' 包着整句，多条开头就是"逐字引用："；被拒原因只能是引文与
  评估条目之间的标点/空白/截取差异（事件只落 reason 不落 assessment，无法逐条
  对账，但 13/13 均呈引用形态，无一是"绕过评估"）。原 kind：tend_inner 6、
  contemplate 4、explore 1、tool_call 1（对话面，09-01 08:40 "Kevin 问东莞今天天气
  ……必须用工具查询" → 降级 silence，她对 Kevin 的问题不吭声）。
- 语义正本 SA-20："选择出自评估而非绕过评估的确定性证明"。逐字包含是这条证明
  的**一种**实现，不是证明本身。

**wake 空回包**

- `lykoi-wake/src/index.ts:252-263`：一次 `deps.llm` → `evaluateMessage` →
  `extractJson` 对空串抛 `autonomous model did not return a decision JSON: ''`
  → 整拍 `autonomy_wake_failed`。路由修正后 6 次失败，error **全部是空串**。
- wake 的 llm 适配器（:444-462）调 `ctx.lykoiLlm.call` **不带** `responseFormat`；
  对话面信封带 `{type:'json_object'}`（`converse/index.ts:475`、
  `contract.ts:73 ENVELOPE_RESPONSE_FORMAT`），`lykoi-llm/src/index.ts:47` 已支持。
- 对话面 D-01 已有"not_json 有界重试一次"（`conversation.ts:837-870`，事件
  `u3_cycle_retried`）；wake 没有对应物。

**重启线索**

- `lykoi-snapshot/src/restart-collect.ts:80-106 collectDowntime`：
  `systemctl show <unit> --property=InactiveEnterTimestamp --value` 后 `Date.parse(raw)`。
  systemd 255 的本地格式是 `Wed 2026-09-02 15:09:12 CST`；V8 把 `CST` 解作
  美国中部（UTC−6），比真实（UTC+8）晚 14 小时 → 差值为负 →
  `restart_clue_unreadable{reason:'negative_interval'}`。活体 08-31 16-17 时
  229 条（切换夜崩溃循环，每次进程起一条）、09-01 又 3 条；**每次重启都
  丢掉"停了多久"**。`never_stopped`（`n/a`）三条 —— 那不是"读不到"，是正常首启。
- 调用点唯一：`converse/index.ts:215`，进程起时一次（此前评估写的"每次装配
  一条"有误，本单据实修正）。服务器 `systemctl --version` = 255，支持
  `--timestamp=utc`。

## 2. 治理定案（执行方不得另择）

**D-1 清单只列接得通的动作；未接线的动作在两条路径上都不再走到 dispatch 替身。**

- D-1a（kernel，受保护，仅此一处）：`unwiredResources()` 的每个替身 handler 打
  一个不可枚举标记（`Symbol.for('lykoi.kernel.unwired_handler')`，值 `true`）；
  新增导出 `isUnwiredHandler(h): boolean` 与
  `wiredActionCatalog(resources: ResourceRegistry): { knownActions: readonly string[]; isHardGated(a): boolean }`
  —— `knownActions` = `KNOWN_ACTION_LIST` 中经 `resources[prefix][method]` 解析到
  **可调用且未标记**的那些（保持 `KNOWN_ACTION_LIST` 原序），`isHardGated` 与
  `kernelActionCatalog` 同一实现。`kernelActionCatalog` 保留不删（测试与旧注释仍
  引用），文件头注释改口说明它是"可派发全集"而非"接得通全集"。替身抛错文案、
  `_resolve`、三道门、immutable 行形状**零改动**。
- D-1b（wake/converse 接线）：两处各把 `outboundOrganResources()` 只调一次存为
  `const resources`，同一实例喂 `createDispatch` 与
  `OrganInventoryCache({ catalog: wiredActionCatalog(resources) })`。预期清单
  只剩 5 项（若 `registerOrganHandler` 生产无追加）。渲染头文案不改 —— 改完它
  才是真话。
- D-1c（decide 候选）：`buildCandidates(snap, opts?: { wired?: ReadonlySet<string> })`。
  给了 `wired` 且 `'research_browser.read_text' ∉ wired` → 三个分支一律
  `allowed.delete('explore')`（含 SA-09 饥饿棘轮：泄压出口不存在时不许摆一个
  假的）。不给 `wired` → 行为逐字节不变（既有测试零改动）。wake 传
  `new Set(catalog.knownActions)`。她若仍选 explore → 既有位点②
  `kind_not_in_candidates` 降级 + `capability_gap`，不另造。
- D-1d（converse 工具闸）：`ConversationDeps` 新增可选 `wiredActions?: ReadonlySet<string>`；
  `#buildAction` 在 `TOOL_TO_ACTION` 命中**之后**、参数解析之前加一路：给了
  `wiredActions` 且 `actionType ∉ wiredActions` → `this.#log('u3_cycle_tool_unwired', { name })`
  + `emitCapabilityGap(…, { wanted: name, reason: GAP_NOT_WIRED, source:'converse', runId })`
  + 回填 `{ success:false, error: \`organ not wired: '${name}'\` }`，**不进 dispatch**
  （一个已知必死的调用不该消耗策略判定与 intent 行）。未给 `wiredActions` →
  行为不变。converse index 传 `new Set(catalog.knownActions)`。
- D-1e（capability-gap 词表）：新增 `GAP_NOT_WIRED = 'not_wired'` 入 `GAP_REASONS`；
  文件头纪律 3 补一段：`not_registered` 仍无发射点（注册表未接 catalog），
  `not_wired` 是"在 KNOWN_ACTIONS、在 catalog 全集、但注册表里是替身"这一判定
  的发射点，判定源 = D-1a 的标记（不是异常文本匹配）。
- 否决：在 kernel `_executeDecision` 的 catch 里按错误文案发 gap（文本匹配 +
  kernel 反向依赖 decide 词表，两条都不许）；把替身从注册表里**拿掉**（`_resolve`
  "handler 可调用"不变量与 SK-02 四重拒绝的测试面会整体挪动，不是小单）。

**D-2 溯源门放宽为四路任一（SA-20 修订为 SA-20b），提示词一字不动。**

`groundedEntries(assessment, reason, decisionConcernId?)` 返回被引用条目，判定
任一命中即算：

1. 现行逐字包含（保留，先跑）；
2. 规范化包含：对条目文本与 reason 各做 `normalizeForGrounding`（NFKC → 去全部
   空白 → 去下列标点与引号：`『』「」“”‘’""''—–-…,.;:!?、，。；：！？（）()[]【】`）
   后按 ≥ `GROUND_MIN_CHARS` 逐字包含；
3. 片段引用：规范化后的条目文本任一长度 **≥ `GROUND_FRAGMENT_CHARS` = 10** 码点
   的连续子串出现在规范化 reason 中（覆盖"引了前半句"）；
4. 结构引用：`decision.concern_id` 非 null 且等于某条目的 `concern_id`
   （concern_id 已过 `allowedConcerns` 闸，SA-23 不变）。

`grounded_concern_ids` = 命中条目 concern_id 的并集（去重、升序）。
`decision_ungrounded` 事件形状不变；demote 顺序（safeKind → 候选表 → 溯源）不变。
`DECIDE_SYSTEM_PROMPT` **零改动**（sha 钉住；提示词继续要求逐字引用，门只是
不再因标点判她死刑）。

D-2b（对话面）：`EvaluateOptions` 新增可选 `groundingExempt?: ReadonlySet<string>`；
kind 在集合内 → 跳过第 3 道（溯源），第 2 道（候选表）照过。converse 契约
（`contract.ts:326` 调用处）传 `new Set(['tool_call'])`。理由：tool_call 不是终局，
工具结果回到下一周期、回复仍过门；而把一次查询降级成对 Kevin 沉默是对话面
最坏的结果（09-01 08:40 实证）。wake 不传（独处的她四路够用）。

否决：改提示词（sha）；降 `GROUND_MIN_CHARS`；"评估非空即算引用"（那是把 SA-20
整条删掉）。

**D-3 wake 有界重试一次 + 认知调用带 JSON 模式。**

- D-3a：`lykoi-wake` 阶段 4b 拿到 `reply` 后先探一次 `extractJson(reply.content)`
  （decide 已导出）；抛 → `deps.logEvent('autonomy_wake_retried', { run_id, reason:'not_json', content_len })`
  → 再调一次 `deps.llm`（同 runId/route/origin，budget 两笔照记）→ 用第二份
  `reply` 进 `evaluateMessage`。第二份仍坏 → 现行路径逐字节不变
  （`autonomy_wake_failed`）。**最多一次**，不做循环；探测只用 `extractJson`，
  不做异常文本匹配。
- D-3b：wake 的 llm 适配器（`index.ts:444`）给 `ctx.lykoiLlm.call` 加
  `responseFormat: { type: 'json_object' }` —— 与对话信封同款，只加在阶段 4b
  这一条 `LlmFn` 上；SA-171 整合/专注两处调用（:513/:521）**不改**（它们不解析 JSON）。
  若 `LlmFn` 类型需要区分，允许给 `meta` 加可选 `responseFormat` 字段由调用点传入。

**D-4 重启线索：UTC 时间戳 + 严格解析；首启不报"读不到"。**

- `collectDowntime` 改为 `systemctl show <unit> --property=InactiveEnterTimestamp --value --timestamp=utc`；
  解析用严格正则 `^(?:[A-Za-z]{3} )?(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$`
  拼成 `${date}T${time}Z` 再 `Date.parse`；不匹配 → 现行 `unparsable_timestamp`
  事件（文案不变）。**不再调用 `Date.parse(raw)` 裸解析。**
- `raw` 为空或 `n/a` → 直接 `return null`，**不发事件**（首启没有停机时长是
  事实，不是故障；`restart_event` 缺 downtime 字段即是留痕）。`never_stopped`
  字面量从代码里移除。
- `negative_interval` 分支保留（钟真被调过时仍该说不出）。
- 单元名未配（dev/Mac）→ 现行 `return null`，逐字节不变。

**D-5 边界（本单不做）**：不接 `registryActionCatalog`（归 M5）；不给
`research_browser.*` 接真 handler（M5）；不改 `TOOL_TO_ACTION`/信封契约/
`DECIDE_SYSTEM_PROMPT`/`ENVELOPE`（sha 全部不变，报告须附改前改后 sha 对照）；
不改 `profile/cordis.prod.yml`；不加 env（GK-6）；不动 `lykoi-gate`。

## 3. 交付项

1. `lykoi-kernel/src/dispatch.ts`：D-1a（标记 + `isUnwiredHandler` + `wiredActionCatalog`）。
2. `lykoi-decide/src/capability-gap.ts`：D-1e。
3. `lykoi-decide/src/index.ts`：D-1c、D-2、D-2b。
4. `lykoi-decide/src/organs.ts`：仅注释改口（"生产两处已换 wiredActionCatalog"）。
5. `lykoi-wake/src/index.ts`：D-1b、D-1c 传参、D-3a、D-3b。
6. `lykoi-converse/src/index.ts`、`conversation.ts`、`contract.ts`：D-1b、D-1d、D-2b 传参。
7. `lykoi-snapshot/src/restart-collect.ts`：D-4。
8. 测试（每条定案至少一条新测试，放各包既有 test 目录）：
   - kernel：替身全部被 `isUnwiredHandler` 识别；`wiredActionCatalog(unwiredResources())`
     为空；混入真 handler 后只列真的、顺序随 `KNOWN_ACTION_LIST`；`isHardGated`
     与 `kernelActionCatalog` 逐项相等。
   - decide：候选 —— 传 `wired` 不含 read_text 时三分支均无 explore（含饥饿棘轮
     分支），不传时与基线相同；溯源 —— 四路各一正例一反例（含 『』 包裹、
     半角/全角标点差异、前半句片段、concern_id 结构引用），`groundingExempt`
     只跳第 3 道；gap 词表含 `not_wired`。
   - wake：第一次空串第二次合法 → 拍成功且落一条 `autonomy_wake_retried`、
     llm 被调恰 2 次；两次都空 → `autonomy_wake_failed` 且 llm 恰 2 次；
     阶段 4b 调用带 `responseFormat`。
   - converse：在表但未接线的工具 → `u3_cycle_tool_unwired` + `capability_gap{not_wired}`
     + error 回填 + dispatchFn **未被调用**；未传 `wiredActions` 行为不变；
     tool_call 不再因溯源降级。
   - snapshot：`--timestamp=utc` 参数被传入；`Wed 2026-09-02 07:09:12 UTC` 解析正确；
     本地格式 `… CST` → `unparsable_timestamp`；`n/a`/空 → null 且零事件。
9. 全量 `npm test` + `npm run typecheck` 绿；报告列出**每一条被改动的既有测试**
   及理由（预期：organs 清单快照、restart-collect 的 never_stopped 断言、
   wake 事件计数）。
10. `docs/`：`m4_handoff.md` 或 `deploy.md` 若有"18 个动作"/"never_stopped"字样
    一并改口（grep 后列清单，没有就写"无"）。

## 4. 执行纪律

- 分支 `wo/fix-loop-01` 自 main `cfd477c` 切；提交按交付项分（≥4 提交，kernel 单独一提交）。
- 每次改完跑对应包测试；收尾跑全量 + typecheck，报告贴总数四元组。
- 报告 = `governance/wo/WO-FIX-LOOP-01/report.md`，**一次完整输出**：
  §1 改动清单（文件:行）、§2 定案逐条落点、§3 测试四元组 + 新增/改动测试清单、
  §4 sha 对照（`DECIDE_SYSTEM_PROMPT`、信封契约、`profile/cordis.prod.yml`
  改前改后）、§5 未做与偏离（有就写，没有写"无"）、§6 落地口径（拉 main + 重启，
  零迁移）。
- 不合并、不 push 到 main；push 分支即可。治理侧复核（独立复跑全量 + typecheck +
  kernel diff 逐行）后由 Kevin 裁决并入。
