# WO-PERS-OVERLAY-01 · relationship overlay（D-PERS-2）

- 签发：治理侧，2026-09-02
- 上位：`governance/docs/persona_layering_design_v1_2026-09-01.md` §3.2（D-PERS-2，
  Kevin 2026-09-01 拍板）、§2 硬边界 P-D2/P-D3、§3.4（D-PERS-4 场景化表达并入 overlay）、
  §1 装配位置铁律 CACHE-INVERT
- 派发依据：Kevin 2026-09-02 15:22（治理主会话）"那现在做 D-PERS-2"。**注记**：同日
  15:12 另一治理会话 Kevin 裁"M5 提前到人格分层前"（已入 main@b6fc33e 设计稿 §5 改序注与
  HANDOFF）；15:22 的点名在后，本单据此签发；两单**并行不冲突**（设计稿 §5 原句），
  合并次序由治理侧在复核时定
- 基线：main `b6fc33e`（代码 = `89b04dd`，其后两提交只动 governance/），治理侧实测
  **880/869/0/11**，tsc 净
- 执行：opus 子 Agent，隔离 worktree，分支 `wo/pers-overlay`
- 产线现状：main@89b04dd，mind_schema **17**（LANDING-E 2026-09-02 15:09 施加）。
  **本单零 schema 变更、零迁移、零 env**：`EXPECTED_MIND_SCHEMA_VERSION` 停在 17；
  落地 = 拉 main + 重启（deploy.md §11），不走停机迁移窗
- 并行在途：`wo/fix-loop-01`（WO-FIX-LOOP-01，sonnet）动 `lykoi-kernel` dispatch /
  `lykoi-decide` 溯源门 / `lykoi-wake` / restart 线索 / `conversation.ts #buildAction`
  一带。本单**不得**碰上述任何位置（§5），使两支可独立合并

## 0. 一句话

给慢变层加一个"对谁"的维度：L4 从 `relationship_thread` 关切里得出的结论不再混进
"她自己想明白的事"，而是落成**按对话者键控**的相处方式条目（category
`relationship` + `memory_scopes` 实体轴），走同一套影子门/衰减/点亮骨架，装配时只把
**眼前这个人**的那些叠进人格块的慢变段位。结构先立，内容从零开始。

## 1. 事实（治理侧 2026-09-02 取证，执行方不必重查，但可复核）

**Canon 里的"关系"是一句话，运行期只读**

- persona TOML `[relationship]` 四字段（`lykoi-decide/src/persona.ts:37-42`
  `PersonaRelationship`：partner/stance/evolution_anchor/owner_authority），由
  `buildPersonaKernel`（:170-190）渲染成一行"我和 X 的关系：…"。P-D2：本单一个字不动它。
- L2/L4 身份守卫（`l2.ts:214`、`l4.ts:248`）只引 `persona.relationship.partner`。

**慢变层现体：单通道、无维度**

- 状态门 `focus_insight_state` 六态（017 起），唯一消费口 `promotedFocusInsights()` =
  `listFocusInsights('active')`（`rw.ts:2177`），SQL 联 `insights` 带出 `content/category`
  （:2158-2160），**不按 category 过滤**。
- 唯一消费者 converse `#promotedInsightsSection`（`conversation.ts:414-432`），拼在
  `#buildPersonaMessage`（:396-406）的人格块末尾：内核 → 重启叙事 → SYSTEM_PROMPT →
  acquired 投影（persona/preference）→ 转正结论。该块是 `#messages[0]`，只在夜间印记
  （`#nightlyEpoch` = last_integration_at + focus cycle id，:472-484）变化时重建
  （`#refreshIdentityIfStale` :486-497）——正是 CACHE-INVERT 要求的慢变段位。
- 运行期 **唯一** 的 insights 生产者是 L4 `applyConclusion`（`l4.ts:650`
  `upsertInsight(FOCUS_INSIGHT_CATEGORY, …)`，`FOCUS_INSIGHT_CATEGORY = 'focus'` :84）。
  L2 信封（`l2.ts:170-185`）**不产 insights**（只产 experience_actions / concern_releases /
  new_concerns / narrative / thought_actions）；persona/preference 两类是出生种子
  （`lykoi-decide/src/seed.ts:83 seedPersona`）。产线 insights：focus 17、persona 1、
  preference 5。
- `upsertInsight` 按 `(category, content)` 去重（`rw.ts:1824-1840`）；重申语义建在其上。
- L4 状态机对 category **不敏感**：`promoteDueInsights`（:858）、`retireStaleInsights`
  （:913）、`existingConclusions`（:582）、`applyConflicts` 全走 `listFocusInsights(status)`。
  这正是"复用机制骨架"的物理基础：给 relationship 条目一行状态就够，**零新状态机**。

**实体轴已存在，但运行期无人写**

- `memory_scopes(table_name, row_id) → subject_user_id / origin_context / visibility /
  sensitivity`（`schema.ts:221-227`），`subject_user_id REFERENCES users(id)`；
  `PRAGMA foreign_keys = ON`（`rw.ts:381`）。
- 产线只读读数：memory_scopes 主体非空 7056 行，其中 insights 6（= 六条种子）、
  concerns 10、experiences 4992。experiences 总数 6536 > 4992、concerns 总数 15 >
  10（MAX(id)=15，scope 最大 row_id=10）——**全部是 Python 期回填**，TS 体
  没有任何 `memory_scopes` 写者（`grep` 全仓 src 只有 4 处读：`rw.ts:1867`
  检索实体轴、`:2015` focusCandidates 联查）。STATE-CONTRACT 报告 :563 原注
  "只回填，无运行时写者"仍成立；**本单将成为第一个运行期写者**（只写 insights 行）。
- 后果之一（记录，不在本单修）：港后新建的关切（id 11-15）没有实体轴，
  `focusCandidates` 联出的 `subject_user_id` 为 NULL，`selectConcern` 的 owner 轴
  （`l4.ts:47 OWNER_AXIS_USER_ID = 'user_001'`）只看得见老关切。

**对话者是谁**

- 适配器盖章：`lykoi-adapter-telegram/src/index.ts:375-385` 每条入站带
  `userId`（identity_bindings 绑定）/`contextId`/`isOwner`；未绑定者更早被拒。
- converse 消费：`converse/src/index.ts:531-556` 对**所有**绑定发信人走同一个
  `Conversation` 实例的 `send(text, {runId})`——`Conversation` 不知道本轮对话者；
  L3 检索实体轴取 `store.ownerPrimaryUserId()`（`conversation.ts:601`）。
- 产线：users 1（owner_primary，`user_001`）、identity_bindings 1（telegram，
  owner_manual）、contexts 1（direct）、context_members 0。**当前实际只有一个键**
  （设计稿 §3.2 原话），Conversation 单实例单对话者与之相符。
- `users.role` 三值 `owner_primary|group_member|agent`，owner 部分唯一索引。

**relationship_thread 关切**

- `concerns.kind` 含 `relationship_thread`（L2 `l2.ts:181` 与 L4 `l4.ts:223`
  的 `new_concern.kind` 枚举都允许它）。产线历史上出现 1 条（已 released）。
- `focusCandidates`（`rw.ts:2004-2020`）不按 kind 过滤：relationship_thread 关切
  与其他关切同等进入 L4 选材。

**装配带标（设计稿 §5 尾句"随 overlay 单捎带"）——现体无位点**

- 检索唯一 SQL `relevanceCandidateRows`（`rw.ts:1857-1860`）无条件挂
  `factualEpistemicClause`：`imagined|simulated` **不在候选域**。converse
  `#buildRelevantMemories`/`#renderMemoryLine`（:596-626）与 L4 `retrieveForConcern`
  同走此口。因此"引用 imagined 须带标"在现体**没有一条能到装配面的 imagined 行**——
  带标无处可标。本单据实**不做**带标（§5）；contemplate 产物标 imagined 的写入方
  接线是另一单的事。

**测试面**

- learn 夹具 `packages/lykoi-learn/test/fixture.ts`：`makeStore()` =
  `createStateFixture` + `ReadWriteMemory`（事件槽可断言）、`rawOpen`、`T0`、
  `fakeCompletion`、`seedExperience`；`l4-decay.test.ts` 的 `seedCyclesUpTo` 是压周期
  序号的范本。夹具播两行身份契约种子 `user_001`（owner_primary）与
  `ctx_direct_user_001`（`testing.ts:41`）。
- converse 夹具 `packages/lykoi-converse/test/fixture.ts:55 makeStore()`；
  `assemble.test.ts:50-70` 是人格块顺序与 `promoted_insights_injected` 的现成样式
  （`seedPromotedInsight(path, content, status)`）。
- `prompts.test.ts` §3.2 B 表钉 13 条装配头部/骨架的 chars+sha256（:35-49）。

## 2. 治理定案（执行方不得另择）

**D-1 overlay 条目的来源 = L4 从 `relationship_thread` 关切得出的结论；不改任何
提示词。** 判别式是**代码按关切 kind 做**，不由她自陈、不加信封字段。
否决的三条路：① 给 FOCUS 信封加 `about_relationship_with` 字段——要动 SA-138 逐字
钉死的 FOCUS_SYSTEM_PROMPT，内容级改动另开单；② 让 L2 产 relationship insights——
L2 现体不产 insights，等于新造一条生产线；③ owner 手写 overlay 条目——运行期人格
可写面，撞 P-D2/P-D3。"一条 relationship_thread 关切被深挖出的结论就是相处方式层面
的结论"是本单立的**结构性**约定；内容质量随产线读数校准，不由执行方猜。

**D-2 类别常量 `RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'`，定义在
`lykoi-memory/src/rw.ts`（与 `FOCUS_INSIGHT_STATUS_ENUM` 同处），`l4.ts` 从
`'lykoi-memory/rw'` 值导入**（learn 已依赖 lykoi-memory 包；这是 learn src 第一处
运行期导入，报告点名）。字面量 `'relationship'` 在 src 只出现一次。
`PERSONA_PROJECTION_CATEGORIES`（`persona.ts:204`，persona/preference 白名单）**不动**：
overlay 不进 decide 共用投影，只进对话路径——与 S-34 转正结论同一口径。

**D-3 键 = `memory_scopes` 实体轴，不新建表、不加列。** L4 落一条 relationship 结论时
写 `('insights', insight_id, subject_user_id = KEY, origin_context = NULL,
visibility = 'private', sensitivity = 'content')`，`INSERT OR IGNORE`（同一结论重申/
点亮撞主键即不动：键在首次落地时钉死）。
KEY 的推导（代码，非自陈）：`concern.subject_user_id ?? store.ownerPrimaryUserId()`
——关切有实体轴用关切的；没有（§1：港后新关切都没有）退到 owner_primary，因为
现体能与她对话的只有 owner（§1 对话者段）。**两者皆 null → 这条结论按普通 focus
结论落地（category `focus`、不写 scope）并发事件 `relationship_overlay_unkeyed`**——
宁可少一条 overlay，不凭空指一个人。
否决：新表 `relationship_overlay(insight_id, subject_user_id)` 或 `focus_insight_state`
加列——都是 DDL 变更 = 018 + 停机窗，而实体轴现成且语义正是"这一行关于谁"。

**D-4 读口两分：**
- 新增 `promotedRelationshipInsights(subjectUserId: string): RawRow[]` =
  status `active` ∧ `i.category = 'relationship'` ∧ `ms.subject_user_id = ?`
  （JOIN memory_scopes ON table_name='insights'），`ORDER BY s.insight_id`。
- `promotedFocusInsights()` 改为 status `active` ∧ `i.category <> 'relationship'`
  （LEFT JOIN 下 category 为 NULL 的孤儿状态行仍归通用层，用 `COALESCE(i.category,'')
  <> ?`）。对现存数据是**空操作**（产线 17 行状态行全是 focus）。
- `listFocusInsights` **一字不动**；L4 的 promote / retire / relit / contested /
  existingConclusions 因此自动覆盖 relationship 行——这就是"复用骨架"。

**D-5 装配：converse `#buildPersonaMessage` 在转正结论段**之后**追加
`#relationshipOverlaySection()`**，读 `store.promotedRelationshipInsights(subject)`，
`subject = store.ownerPrimaryUserId()`（Conversation 单实例单对话者，§1）；subject
为 null 或行为空 → **零字节**（判据⑧a 同 promoted 段）；读失败 → 事件
`relationship_overlay_read_failed` + 零字节（同 promoted 段的失败口径）。
注入时发事件 `relationship_overlay_injected {count, subject_user_id}`。
头部常量 `RELATIONSHIP_OVERLAY_HEADER` 放 `prompts.ts` `PROMOTED_INSIGHTS_HEADER`
之后，文本**逐字**为：

```
你和眼前这个人相处的方式(专注思考里得出、已经站住、只关于这个人的结论):\n
```

（末尾一个换行，与 PROMOTED_INSIGHTS_HEADER 同形。）行格式 `- {content}` 同 promoted 段。
`prompts.test.ts` §3.2 B 表加第 14 条（chars + sha256 由执行方实测填入，报告给出值）。
位置理由：它是慢变层，随 `#messages[0]` 在夜间印记变化时重建，不进每轮易变尾部。

**D-6 事件面（精确匹配可计数）：**
- L4：`relationship_overlay_keyed {insight_id, concern_id, cycle_id, subject_user_id}`
  （scope 行**成功写入或已存在**都发；同一事务内写 scope）；
  `relationship_overlay_unkeyed {insight_id, concern_id, cycle_id}`（D-3 兜底路）。
- converse：`relationship_overlay_injected`、`relationship_overlay_read_failed`。
- 状态迁移照旧走 `focus_insight_status`（不另造）。

**D-7 提示词与 Canon 零改动。** FOCUS_SYSTEM_PROMPT / INTEGRATION_SYSTEM_PROMPT /
SYSTEM_PROMPT / 两条身份守卫的 chars+sha 不变；`buildPersonaKernel` 不动；persona
TOML 不动。本单**唯一**新增的提示词面是 D-5 那一行头部。

**D-8 零 schema 变更。** 不动 `schema.ts`；`EXPECTED_MIND_SCHEMA_VERSION` 停在 17；
无迁移件。`memory_scopes` 的运行期写者一事由治理侧出 STATE-CONTRACT 增补件（同
016/017 之例），执行方不改历史存档件。

**D-9 `FocusSummary` 加 `overlay_subject_user_id: string | null`**（默认 null，
D-3 成功键控时填 KEY）——让周期摘要能回答"这条结论是关于谁的"，与 `retired`
同为账面字段。

## 3. 交付项

1. `rw.ts`：`RELATIONSHIP_INSIGHT_CATEGORY`；`scopeInsightSubject(insightId, subjectUserId)`
   （D-3 的 INSERT OR IGNORE，返回 boolean = 是否新写；文档注明这是 TS 体第一个
   memory_scopes 运行期写者）；`promotedRelationshipInsights(subjectUserId)`；
   `promotedFocusInsights()` 排除 relationship（D-4）。
2. `l4.ts`：`applyConclusion` 按 `concern.kind === 'relationship_thread'` 选类别
   （D-1/D-2）、KEY 推导 + scope 写 + 事件（D-3/D-6）、`FocusSummary.overlay_subject_user_id`
   （D-9）；`FocusStore` 接口补 `ownerPrimaryUserId()` 与 `scopeInsightSubject(...)`。
3. converse：`prompts.ts` `RELATIONSHIP_OVERLAY_HEADER`；`conversation.ts`
   `ConverseStore.promotedRelationshipInsights`、`#relationshipOverlaySection`、
   `#buildPersonaMessage` 接入（D-5/D-6）。
4. 新测试 `packages/lykoi-memory/test/rw-relationship-overlay.test.ts`、
   `packages/lykoi-learn/test/l4-overlay.test.ts`、`assemble.test.ts` 增例、
   `prompts.test.ts` B 表 14 条。至少钉死：
   ① relationship_thread 关切 + advanced → insights.category = relationship、
   focus_insight_state 一行 shadow、memory_scopes 一行 (insights, id, user_001)、
   事件 `relationship_overlay_keyed` 精确字段；② 非 relationship_thread 关切（如
   interest）→ category focus、无 scope 行、无 keyed 事件；③ 关切自带实体轴
   （rawOpen 给 concerns 写一行 scope 指向第二个 user）时 KEY 取关切的，不取 owner；
   ④ 关切无实体轴且 owner 行被置 archived → 走 D-3 兜底：category focus + 事件
   `relationship_overlay_unkeyed`；⑤ 影子期后 `promoteDueInsights` 把 relationship
   行转 active，`promotedRelationshipInsights('user_001')` 见到它、
   `promotedFocusInsights()` 见不到它；⑥ 键到第二个 user 的 active 行对
   `promotedRelationshipInsights('user_001')` 不可见（负例，"不同的人不同的脸"的
   结构证明）；⑦ 衰减：relationship 行距离 ≥ INSIGHT_STALE_AFTER_CYCLES 照降 dormant、
   点亮照回 active（骨架复用的证明，用 `seedCyclesUpTo` 压序号）；⑧ 重申同一结论
   不重复写 scope（`scopeInsightSubject` 二次返回 false，行数不变）；⑨ converse：
   人格块顺序 内核 → … → 转正结论 → overlay 头部 → `- 内容`，shadow 的 overlay
   行不进，键到第二个 user 的行不进，`relationship_overlay_injected.count` 精确；
   ⑩ overlay 为空时人格块**逐字节**等于本单之前的形态（零字节），且
   `promoted_insights_injected` 行为不变；⑪ 五条既有提示词/守卫 sha 不变（既有
   测试即覆盖，报告点名）。
5. 报告（§6）——因执行环境禁止子 Agent 写 report/summary 类 .md，报告以**最终消息
   一次性完整输出**，治理侧逐字归档为 `governance/wo/WO-PERS-OVERLAY-01/report.md`。

## 4. 测试纪律

- 全部 Date 由夹具 `T0` 派生，**零真实时钟读取**；周期序号用 `seedCyclesUpTo`。
- 事件计数精确匹配（`"type":"relationship_overlay_keyed"` 且字段相等），禁子串 grep。
- 只用合成夹具（`createStateFixture`）；**不得**打开 `~/Documents/lykoi/lykoi-cordis-devstate/`
  任何文件，也不得复制它。
- 前台跑测试并回报精确退出码；基线 880/869/0/11，新增只增不减；tsc 净。

## 5. forbidden

- 不动 `schema.ts`、不出迁移件、不动 `EXPECTED_MIND_SCHEMA_VERSION`。
- 不动任何提示词常量的文本（FOCUS/INTEGRATION/SYSTEM_PROMPT/守卫/既有 13 条头部）；
  不动 persona TOML、`buildPersonaKernel`、`PERSONA_PROJECTION_CATEGORIES`。
- 不动 `listFocusInsights`、`recordFocusInsight`、`setFocusInsightStatus`、
  `retireStaleInsights`、`promoteDueInsights`、`existingConclusions` 的逻辑。
- 不动 `lykoi-kernel`、`lykoi-gate`、`lykoi-decide`（persona.ts 注释也不动）、
  `lykoi-wake`、`lykoi-adapter-telegram`、`conversation.ts #buildAction/#executeCycleTool`
  一带（WO-FIX-LOOP-01 在途）。
- 不做装配带标（§1 事实：无位点）；不给 `Conversation.send` 加对话者参数（单实例单
  对话者是现体事实，多对话者是另一单的结构改动）；不给 concerns 补写实体轴。
- 不加配置项、不读 env（GK-6）。
- 不写 `memory_scopes` 的 insights 以外任何表行。
- 头部文本、类别名、事件名、KEY 推导序——不得改；有异议写偏离表停工上报，不得先做。

## 6. 报告要求（一次性完整输出，不分段）

- commit 尖 sha、父 sha、工作树 clean 证明；`diff --stat`；`name-only` 过
  `kernel|gate|decide|wake|adapter|prompt|vendor|profile|schema` 滤网结果（应只剩
  prompts.ts 一条并说明是新增常量）。
- 全量测试精确退出码 + 逐包 `ℹ fail 0` + 合计（基线 880/869/0/11 + 新增）；tsc 退出码。
- `RELATIONSHIP_OVERLAY_HEADER` 的 chars 与 sha256（B 表第 14 条的值）。
- 五条既有提示词/守卫 sha 不变的证明（prompt.test.ts / prompts.test.ts 通过即可，点名）。
- 偏离表（逐条：位置/原文要求/实际做法/理由），无偏离写"无"。
- D-1..D-9 逐条自证位置（文件:行）。
- learn src 首次运行期导入 lykoi-memory 的说明（D-2）。

## 7. 复核要点（治理侧）

- D-4 两分读口互斥且并集 = 旧 `promotedFocusInsights`；对产线 17 行状态行为空操作
  （只读复核：`SELECT category, COUNT(*)` 联查）。
- KEY 推导序与兜底路（D-3）三条分支各有测试。
- 装配空态逐字节不变（⑩），既有 assemble/e2e/kernel-e2e 测试零改动即绿。
- 事件名与字段精确；`focus_insight_status` 未被复制。
- 与 `wo/fix-loop-01` 的合并：`git merge-tree` 预演无冲突（conversation.ts 不同区段）。
- 落地耦合：**零迁移**——合并后拉 main + 重启即生效；不需要停机窗。
- STATE-CONTRACT 增补件（memory_scopes 运行期写者、insights.category 新值、
  promotedFocusInsights 语义收窄）由治理侧随复核补。
- 首月观察点：`"type":"relationship_overlay_keyed"` 计数（预期极低——取决于
  L2/L4 派生 relationship_thread 关切的频率）；若 30 天为 0，D-1 的判别式回炉。
