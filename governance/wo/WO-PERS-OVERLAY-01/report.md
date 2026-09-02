<!-- 治理侧归档：执行 Agent（opus）2026-09-02 完工报告，逐字自其最终消息抄录，未改一字。
     停工上报与 D-2 修订见同目录 deviation_d2_2026-09-02.md。复核结论见 review.md。 -->

# WO-PERS-OVERLAY-01 · 完工报告（章程 §6 全项，一次性输出）

## 1. 提交与工作树

- **尖 sha**：`69ee4fc4103e70189ddb3b9f62dc2e60df7c8011`
- **父 sha**：`9dde0f905aed88c488980abb04194678cb1d4e52`
- 分支 `wo/pers-overlay`，基线 = main `23c65a08cef8888c3504f9583f9d470ffaab70b6`（D-2 修订版章程；已按指示 `git merge --ff-only main` 快进，`5f22e8e..23c65a0` Fast-forward）
- **工作树 clean 证明**：`git status --short --branch` 仅输出 `## wo/pers-overlay`（porcelain 行数 = 0）
- 三个里程碑（`--reverse`）：
  1. `3835a15c2e2dc6ca633016e9134c0ce4818604a8` rw 层（D-2/D-3/D-4）
  2. `9dde0f905aed88c488980abb04194678cb1d4e52` l4 层（D-1/D-3/D-6/D-9）
  3. `69ee4fc4103e70189ddb3b9f62dc2e60df7c8011` converse 层（D-5/D-6）
- 未 push、未 merge、未改 main、未动其他 worktree/分支。

## 2. diff --stat（`23c65a0..HEAD`）

```
 packages/lykoi-converse/src/conversation.ts        |  45 ++-
 packages/lykoi-converse/src/prompts.ts             |   9 +
 packages/lykoi-converse/test/assemble.test.ts      |  98 +++++-
 packages/lykoi-converse/test/fixture.ts            |  40 +++
 packages/lykoi-converse/test/prompts.test.ts       |   8 +-
 packages/lykoi-learn/src/l4.ts                     |  56 +++-
 packages/lykoi-learn/src/shared.ts                 |   8 +
 packages/lykoi-learn/test/boundary.test.ts         |   4 +-
 packages/lykoi-learn/test/l4-overlay.test.ts       | 338 +++++++++++++++++++++
 packages/lykoi-memory/src/rw.ts                    |  88 +++++-
 .../test/rw-relationship-overlay.test.ts           | 185 +++++++++++
 11 files changed, 872 insertions(+), 7 deletions(-)
```

## 3. name-only 滤网（`kernel|gate|decide|wake|adapter|prompt|vendor|profile|schema`）

命中 **2 条，均为 `prompt` 模式**，无 kernel/gate/decide/wake/adapter/vendor/profile/**schema** 任何一条：

- `packages/lykoi-converse/src/prompts.ts` —— **纯新增常量**，diff 为 +9 行（一段块注释 + `RELATIONSHIP_OVERLAY_HEADER` 两行），插在 `PROMOTED_INSIGHTS_HEADER` 之后，既有行零改动（`git diff` 全文见下）：
  ```
  +export const RELATIONSHIP_OVERLAY_HEADER
  +  = '你和眼前这个人相处的方式(专注思考里得出、已经站住、只关于这个人的结论):\n'
  ```
- `packages/lykoi-converse/test/prompts.test.ts` —— B 表 13 → 14 条（章程 §3.4 第 4 项明令）。此条同为 `prompt` 模式命中，章程 §6 预期"应只剩 prompts.ts 一条"未计入这个测试文件；据实报告，二者性质相同（新增常量 + 钉它的那一行）。

补充证明：`git diff --name-only` 对 `lykoi-learn/src/prompts.ts`、`lykoi-learn/src/l2.ts`、`lykoi-decide/src/persona.ts`、`lykoi-memory/src/schema.ts` **全部为空**（未触碰）。

## 4. 全量测试与 tsc（前台，精确退出码）

- **`npm test` 退出码 = `0`**；**`npx tsc --noEmit` 退出码 = `0`**
- 逐包 `ℹ fail 0`，**16 个包无一例外**（`cancelled` 同为全 0）：

| 包 | tests | pass | fail | skipped |
|---|---:|---:|---:|---:|
| lykoi-adapter-telegram | 55 | 55 | **0** | 0 |
| lykoi-audit | 3 | 3 | **0** | 0 |
| lykoi-budget | 5 | 5 | **0** | 0 |
| lykoi-converse | 104 | 103 | **0** | 1 |
| lykoi-decide | 79 | 79 | **0** | 0 |
| lykoi-gate | 72 | 72 | **0** | 0 |
| lykoi-heart | 14 | 14 | **0** | 0 |
| lykoi-kernel | 194 | 194 | **0** | 0 |
| lykoi-learn | 87 | 86 | **0** | 1 |
| lykoi-llm | 6 | 6 | **0** | 0 |
| lykoi-llm-deepseek | 5 | 5 | **0** | 0 |
| lykoi-memory | 120 | 111 | **0** | 9 |
| lykoi-reflow | 35 | 35 | **0** | 0 |
| lykoi-regulation | 45 | 45 | **0** | 0 |
| lykoi-snapshot | 49 | 49 | **0** | 0 |
| lykoi-wake | 29 | 29 | **0** | 0 |
| **合计** | **902** | **891** | **0** | **11** |

**基线 880/869/0/11（退出码 0、tsc 0，本次开工前在 `5f22e8e` 实测，与章程给定值逐值相符）→ 交付后 902/891/0/11**：净增 **22**（rw 9 + l4 9 + assemble 4），**只增不减，skipped 不变，fail 恒 0**。

## 5. `RELATIONSHIP_OVERLAY_HEADER` 实测值（B 表第 14 条）

- 文本（章程 D-5 逐字，末尾一个 `\n`）：`你和眼前这个人相处的方式(专注思考里得出、已经站住、只关于这个人的结论):\n`
- **chars（码点）= 38**
- **sha256 = `a0553be7100bd34013ac54ac67b11e3628beb5d0b3e48c3f5f9ac2b2b674c22e`**
- 已写入 `packages/lykoi-converse/test/prompts.test.ts` B 表第 14 行，该测试标题同步改为「14 条 sha 全等」，单跑 7/7 通过。

## 6. 五条既有提示词/守卫 sha 不变的证明

- **`packages/lykoi-converse/test/prompts.test.ts`** 单跑 **7 tests / 7 pass / 0 fail**：A 表钉 `SYSTEM_PROMPT`(1418, `72a3c1c1…`)、`SUMMARIZE_SYSTEM_PROMPT`(142, `3eb2679b…`)、`CYCLE_CLOSING_NOTE`(92, `575ffe30…`)，B 表原 13 条 sha 全等，`ENVELOPE_SYSTEM_PROMPT` 反向恢复对拍（`9d4f169e…`, 1677）。
- **`packages/lykoi-learn/test/prompt.test.ts`** 单跑 **5 tests / 5 pass / 0 fail**：FOCUS/INTEGRATION 提示词与两条身份守卫逐字。
- 源文件层面：`lykoi-learn/src/prompts.ts`、`lykoi-learn/src/l2.ts`、`lykoi-decide/src/persona.ts` 均**不在 diff 名单内**（`git diff --name-only` 对它们为空）。`buildPersonaKernel`、persona TOML、`PERSONA_PROJECTION_CATEGORIES` 一字未动。

## 7. D-2 修订版落点（章程 §6 新末条）

- **正本**：`packages/lykoi-memory/src/rw.ts:299` `export const RELATIONSHIP_INSIGHT_CATEGORY = 'relationship'`（与 `FOCUS_INSIGHT_STATUS_ENUM` 同处，:277-278 紧邻上方）。
- **副本**：`packages/lykoi-learn/src/shared.ts:122`，与 `LINEAGE_*` 六常量同一范式、同一段落，注释点名正本位置与守面理由。
- **对拍新增行**：`packages/lykoi-learn/test/boundary.test.ts:114`
  `assert.equal(RELATIONSHIP_INSIGHT_CATEGORY, rw.RELATIONSHIP_INSIGHT_CATEGORY)`（导入见 :17）。
- **import 面守卫仍绿且一字未动**：`boundary.test.ts:44-53` 的白名单判据 `spec === 'lykoi-regulation' || spec.startsWith('./')` 保持原样；`boundary.test.ts` 单跑 **6 tests / 6 pass / 0 fail**，其中「包 import 面：learn src 只 import lykoi-regulation 与包内文件」✔。`l4.ts` 的新导入是 `from './shared.ts'`（:31），未越界。
- **package.json 依赖零改动**：`lykoi-learn/package.json` 的 `lykoi-memory` 仍在 devDependencies，未与 `lykoi-memory/package.json:24` 构成循环。

## 8. 偏离表

| # | 位置 | 原文要求 | 实际做法 | 理由 |
|---|---|---|---|---|
| 1 | §6「name-only 滤网结果应只剩 prompts.ts 一条」 | 滤网命中一条 | 命中**两条**：`src/prompts.ts` + `test/prompts.test.ts` | 二者都被 `prompt` 模式匹配。第二条正是章程 §3.4 第 4 项明令的「B 表 14 条」，非计划外改动。据实报告，无实质偏离 |

**其余无偏离。** D-1..D-9（含 D-2 修订版）逐条照做；§5 forbidden 全部条目未触碰：`schema.ts` 未改、无迁移件、`EXPECTED_MIND_SCHEMA_VERSION` 停在 17（`lykoi-memory/src/index.ts:34`，文件不在 diff 内）；`listFocusInsights` / `recordFocusInsight` / `setFocusInsightStatus` / `retireStaleInsights` / `promoteDueInsights` / `existingConclusions` 逻辑一字未动；`lykoi-kernel`/`gate`/`decide`/`wake`/`adapter-telegram` 零改动；`conversation.ts` 四处 hunk 在 :65 / :137 / :408 / :439，与 `#executeCycleTool`(:994) / `#buildAction`(:1089) 相距数百行，**WO-FIX-LOOP-01 区段零接触**；未做装配带标；未给 `Conversation.send` 加对话者参数；未给 concerns 补写实体轴；未加配置项、未读 env；`memory_scopes` 只写 insights 行。

## 9. D-1..D-9 逐条自证（文件:行）

- **D-1** 判别式 = 关切 kind：`lykoi-learn/src/l4.ts:97` `RELATIONSHIP_CONCERN_KIND = 'relationship_thread'`；判定点 `l4.ts:675` `const isRelationship = concern.kind === RELATIONSHIP_CONCERN_KIND`。信封结构与 FOCUS 提示词零改动（`l4.ts` 的 `parseFocusEnvelope` 未动）。
- **D-2** 正本/副本/对拍：`lykoi-memory/src/rw.ts:299`、`lykoi-learn/src/shared.ts:122`、`lykoi-learn/test/boundary.test.ts:114`（详见 §7）。`PERSONA_PROJECTION_CATEGORIES` 未动（`lykoi-decide/src/persona.ts` 不在 diff 内）。
- **D-3** 键 = 实体轴、INSERT OR IGNORE、KEY 推导序、兜底路：写者 `rw.ts:1881` `scopeInsightSubject`（`INSERT OR IGNORE INTO memory_scopes (table_name,row_id,subject_user_id,origin_context,visibility,sensitivity) VALUES ('insights',?,?,NULL,'private','content')`，返回 `changes > 0`）；KEY 推导 `l4.ts:679-683` `concern.subject_user_id ?? store.ownerPrimaryUserId()`；键在手才落 relationship `l4.ts:684-685`；兜底路 `l4.ts:706-709`。零新表、零新列。
- **D-4** 读口两分：`rw.ts:2255` `promotedRelationshipInsights(subjectUserId)`（`s.status='active' AND i.category=? AND ms.subject_user_id=?`，JOIN `memory_scopes ON table_name='insights'`，`ORDER BY s.insight_id`）；`rw.ts:2236` `promotedFocusInsights()` 收窄为 `s.status='active' AND COALESCE(i.category,'') <> ?`（LEFT JOIN 保孤儿行）；`listFocusInsights`（`rw.ts:2172` 一带）**一字未动**。互斥 + 并集 = 旧全集由 `rw-relationship-overlay.test.ts` 的「D-4 两口互斥且并集 = 旧全集」钉死。
- **D-5** 装配：头部 `lykoi-converse/src/prompts.ts:72`；段函数 `conversation.ts:454` `#relationshipOverlaySection()`（subject 取 `ownerPrimaryUserId()` :455，null → 零字节 :456；读失败事件 :461 + 零字节；行格式 `- {content}` :467-469；空 → 零字节 :470）；接入点 `conversation.ts:408-409`，在转正结论段（:406-407）**之后**；`ConverseStore` 补口 `conversation.ts:138`。
- **D-6** 事件面：`l4.ts:700` `relationship_overlay_keyed {insight_id, concern_id, cycle_id, subject_user_id}`（成功写入或已存在都发——⑧ 二周期各发一次为证）；`l4.ts:707` `relationship_overlay_unkeyed {insight_id, concern_id, cycle_id}`；`conversation.ts:471` `relationship_overlay_injected {count, subject_user_id}`；`conversation.ts:461` `relationship_overlay_read_failed`。状态迁移仍走既有 `focus_insight_status`，未复制。
- **D-7** 提示词与 Canon 零改动：见 §6。本单唯一新增提示词面 = `prompts.ts:72` 一条。
- **D-8** 零 schema 变更：`schema.ts` 不在 diff 内；`EXPECTED_MIND_SCHEMA_VERSION = 17`（`lykoi-memory/src/index.ts:34`）未动；无迁移件；未改历史存档件。
- **D-9** `FocusSummary.overlay_subject_user_id`：声明 `l4.ts:410`，初值 null `l4.ts:438`，成功键控时填 KEY `l4.ts:699`。

## 10. 判据 ①-⑪ 落点

`packages/lykoi-memory/test/rw-relationship-overlay.test.ts`（9 例）、`packages/lykoi-learn/test/l4-overlay.test.ts`（9 例）、`packages/lykoi-converse/test/assemble.test.ts`（+4 例）、`prompts.test.ts`（B 表 14 条）：

① 关系关切 + advanced → category `relationship` / 一行 shadow / `memory_scopes` 一行 `(insights, id, user_001)` 形状全等 / `relationship_overlay_keyed` 四字段精确 —— l4-overlay ①。② interest 关切 → category `focus`、无 scope 行、无 keyed 事件 —— l4-overlay ②。③ 关切自带实体轴（指向 `user_002`）→ KEY 取关切的 —— l4-overlay ③。④ 关切无实体轴 + owner 行 archived → 兜底 category `focus` + `relationship_overlay_unkeyed`，结论照落 —— l4-overlay ④。⑤ 影子期后 `promoteDueInsights` 转正 relationship 行，`promotedRelationshipInsights('user_001')` 见到、`promotedFocusInsights()` 见不到 —— l4-overlay ⑤。⑥ 键到第二个 user 的 active 行对 `user_001` 不可见 —— l4-overlay ⑥ + rw 「三条件齐备才可见」。⑦ 距离 ≥ `INSIGHT_STALE_AFTER_CYCLES` 照降 dormant、重申照点亮回 active、键不变 —— l4-overlay ⑦（`seedCyclesUpTo` 压序号）。⑧ 重申不重复写 scope（二次返回 false、行数不变、键不被改写）—— rw「D-3 幂等」+ l4-overlay ⑧。⑨ 人格块顺序 内核→…→转正结论→overlay 头部→`- 内容`，shadow 行与他人行都不进，`relationship_overlay_injected.count` 精确（overlay 段整段**逐字节**断言）—— assemble ⑨。⑩ overlay 为空时人格块不含头部、仍以转正结论段收尾（逐字节回到本单之前的形态）、`promoted_insights_injected` 行为不变 —— assemble ⑩。⑪ 五条既有提示词/守卫 sha 不变 —— 见 §6（既有测试即覆盖，零改动通过）。

另加：读失败口径（一条事件 + 零字节，不毁整轮）、subject 为 null 口径（零字节且零读库）、`scopeInsightSubject` 的 FK 真生效（不存在的 user id 抛而非静默落键）、LEFT JOIN 孤儿行归通用层、两读口排序确定性、D-9 空转周期默认 null。

**测试纪律**：全部 Date 由夹具 `T0` 派生，**零真实时钟读取**；周期序号一律用 `seedCyclesUpTo`；事件按审计落盘形态 `{type, ...fields}` 序列化后**逐字段精确匹配**（`exactEvents` 助手），无一处子串 grep；只用 `createStateFixture` 合成夹具，未打开或复制 `~/Documents/lykoi/lykoi-cordis-devstate/` 任何文件。

## 11. 与 `wo/fix-loop-01` 的合并预演（章程 §7 附带）

`git merge-tree --write-tree wo/pers-overlay wo/fix-loop-01` **退出码 0 = 无冲突**（对端尖 `64fe479`）。两支可独立合并。

## 12. 落地耦合

**零迁移**：`mind_schema` 停在 17，无 DDL 变更、无迁移件、无 env、无配置项。合并后拉 main + 重启（deploy.md §11）即生效，**不需要停机窗**。对产线现存 17 行状态行，`promotedFocusInsights()` 的收窄是**空操作**（产线 insights 全为 focus/persona/preference，无 relationship 行；治理侧可用 `SELECT category, COUNT(*)` 联查只读复核）。首月观察点：`"type":"relationship_overlay_keyed"` 计数（预期极低，取决于 L2/L4 派生 `relationship_thread` 关切的频率）。

## 13. 纪律声明

全程只在 worktree `/private/tmp/.../scratchpad/wo-pers-overlay` 内读写；**未触碰 `~/Documents/lykoi/` 下任何文件**，**未打开或复制 `lykoi-cordis-devstate/`**；未 ssh、未联网、未读任何 secrets/.env/凭据；未 push、未 merge 到 main、未动其他 worktree/分支；未写任何 report/summary 类 .md（本报告即最终消息）。
