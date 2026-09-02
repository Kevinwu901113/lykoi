# WO-MEM-DECAY-01 · 慢变层衰减（D-PERS-3）

- 签发：治理侧，2026-09-02
- 上位：`governance/docs/persona_layering_design_v1_2026-09-01.md` §3.3（D-PERS-3，Kevin 2026-09-01 拍板）；调节场宪法"更新规则+衰减规则+因果出口，三缺一不许建"
- 基线：main `8c00fd9`（含 AUDIT-FIX-2026-09-02），治理侧实测 **859/848/0/11**，tsc 净
- 执行：opus 子 Agent，隔离 worktree，分支 `wo/mem-decay`
- 产线现状：mind_schema **16**（LANDING-D 2026-09-02 00:28 施加），本单升 **17**
- 部署口径（AUDIT-FIX-2026-09-02 起）：**main 即生产装配**，m4-switch 已退役
  （尖留标签 `m4-switch-retired`=56d7ead），落地直接钉 main 的 sha

## 0. 一句话

给转正洞见（focus_insight_state）补上缺了的衰减边：长期未被 L4 再触达的
active 结论退为 `dormant`（退出装配、不销毁、可点亮），每次降档带因落史落事件，
随 L4 周期结算走。

## 1. 事实（治理侧 2026-09-02 取证，执行方不必重查，但可复核）

- 慢变层现体 = `focus_insight_state` 五态 CHECK：
  `shadow|active|contested|revised|withdrawn`（STATE-CONTRACT §报告 :395-403，
  `rw.ts:272` `FOCUS_INSIGHT_STATUS_ENUM` 逐字）。契约注记：无回到 shadow 的边，
  无 DELETE；`focus_insight_history` 追加式永不更新，`to_status` 无 CHECK。
- 唯一消费口 `promotedFocusInsights()` = `listFocusInsights('active')`
  （`rw.ts:2171`），converse `#promotedInsightsSection`（`conversation.ts:414`）
  **每一轮对话把全部 active 行注入**。因此"是否被装配引用"在现体**无区分度**
  ——每条 active 行每轮都被引用。
- L4 状态机（`packages/lykoi-learn/src/l4.ts`）：`existingConclusions` 只喂
  shadow/active/contested 最后 20 条（:555）；`applyConflicts` 两段式
  contested→revised/withdrawn（:569）；`recordFocusInsight` 重申**不动状态行、
  不刷 updated_at**、只追加 history（`rw.ts:2181`）；`promoteDueInsights` 按
  **周期序号**（非墙钟，SA-130）shadow→active，在每一种周期结尾结算（:830）。
- 产线读数（只读）：`focus_cycles` 24 个（2026-08-12 起，≈1.1 周期/天），
  23 advanced + 1 revised——**几乎每周期产一条新结论**；state 行 15 active +
  2 shadow；15 条 active 里 **13 条转正后再未被任何周期触达**（history 最后
  cycle = 转正 cycle）。膨胀速度 ≈ 每天 +1 条，全部进每轮上下文。
- 中期层已有同型机制可作范本：`markDimmingDormant`（`rw.ts:707`，concerns
  7 天 dimming / 21 天 dormant，严格大于，永不写 released）+ `lightConcern`
  回点亮（:740）。调用点 `lykoi-snapshot/src/index.ts:531`。
- 事件面：状态迁移统一走 `setFocusInsightStatus` → history 一行 +
  `focus_insight_status` 事件（from/to/reason）。
- **DDL 正本已单一来源**（AUDIT-FIX-2026-09-02）：`packages/lykoi-memory/src/
  schema.ts` 的 `STATE_SCHEMA_DDL`（focus_insight_state 在 :258-265），夹具
  `testing.ts` 与生产创建入口 `init-state.ts`（`lykoi-init-state`，一次建到
  `EXPECTED_MIND_SCHEMA_VERSION`，台账只播一行）共用它。改 CHECK 只改这一处；
  迁移件 017 的重建 DDL 必须与 schema.ts 改后文本**逐字一致**（复核对照）。

## 2. 治理定案（执行方不得另择）

**D-1 `dormant` 入 CHECK 枚举，不做旁列。** 六态：
`shadow|active|contested|revised|withdrawn|dormant`。
否决的两条路：①旁列 `dormant_since`——同一事实两处真值，"status=active 但不
装配"是给后人埋的坑；②借 `withdrawn`——语义错（withdrawn 是被证据推翻，
dormant 只是久未重申）。SQLite 改 CHECK 只能重建表，故本单带迁移件 017
（§4）。停机窗成本已由 LANDING-D 证明为约一分钟，不构成理由。

**D-2 衰减信号 = L4 触达周期距离，单位是周期序号，不是墙钟。**
设计稿 §3.3 写的"长期未被装配引用"在现体无区分度（§1），治理侧据实改为
"长期未被 L4 再触达"：一条 active 结论，其 `focus_insight_history` 最后一行
的 `cycle_id` 距当前周期 **≥ `INSIGHT_STALE_AFTER_CYCLES`** 即降 dormant。
单位取周期序号与 SA-130 同理：她的思考发生在周期里，停机三周不该让她
"忘掉"什么。

**D-3 阈值常量 `INSIGHT_STALE_AFTER_CYCLES = 30`**，放 `l4.ts` 常量区
（与 `SHADOW_PERIOD_CYCLES` 同处），**不做配置项、不读 env**（GK-6）。
理由：现节律 ≈1 周期/天，30 周期≈一个月的持续思考；按现数据当日零降档
（最老触达距离 21），约第 33 周期起开始退役最早三条；稳态 active 规模封顶
≈30 + 被重申者。这是治理估值，复核时以产线首月读数校准，不由执行方改。

**D-4 单步，无 dimming 中间态。** 装配是二值的（进/不进），concerns 的
dimming 是为权重与点亮服务的，慢变层没有那两样。

**D-5 边的定案（状态机）：**
- `active → dormant`：只由衰减结算产生（本单新增的唯一入边）。
- `dormant → active`（点亮）：`recordFocusInsight` 重申路径遇 `existing.status
  === 'dormant'` 时**改写状态行为 active**（updated_cycle_id/updated_at 刷新），
  history 一行 reason `relit`，事件 `focus_insight_status` from dormant to
  active。她又想到了同一结论，它就是现行的。重申其他状态的行为**不变**
  （shadow 不重新计时等，`rw.ts:2200` 注释原义保留）。
- `dormant → contested → revised|withdrawn`：`existingConclusions` 的喂入集
  **加入 dormant**（`l4.ts:556`），使一条休眠结论被新证据推翻时如实落
  withdrawn，而不是将来被点亮时带着已被推翻的内容复活。喂入上限 20 不变。
- **无 `dormant → shadow`**、无 `→ dormant` 除衰减外的边、无 DELETE。
  `contested_since_cycle` 规则：迁到 dormant **保留**（同 revised/withdrawn
  分支，`rw.ts:2254-2258`）；dormant→active 清空（已在 active 分支）。

**D-6 因果出口 = 既有通道，不另造事件。** 降档走 `setFocusInsightStatus`，
reason 固定格式 `stale: last touched cycle N, now cycle M (>= 30)`；
事件 `focus_insight_status` 精确匹配 `"to":"dormant"` 可计数。
`promoteDueInsights` 同位新增 `retireStaleInsights(cycleId, summary, deps)`，
`FocusSummary` 增 `retired: number[]`。

**D-7 节律 = 随 L4 周期结算，与 `promoteDueInsights` 同调用位、同覆盖面**
（每一种周期结尾，含空转与失败），且**必须在本周期的 applyConclusion 之后**
（本周期刚重申/新建的结论其 history 最后 cycle 已是本周期，自然不降）。

**D-8 装配零改动。** `promotedFocusInsights` 仍 = active；dormant 自然出局。
prompt/ENVELOPE 任何模板 sha 不变（本单只动数据面与 L4 状态机）。

## 3. 交付项

1. `rw.ts`：`FOCUS_INSIGHT_STATUS_ENUM` 加 `'dormant'`；`recordFocusInsight`
   点亮分支（D-5）；`setFocusInsightStatus` 的 contested_since 分支核对 D-5；
   `EXPECTED_MIND_SCHEMA_VERSION` **16 → 17**，判定逐字不动。
2. `l4.ts`：常量 `INSIGHT_STALE_AFTER_CYCLES = 30`；`retireStaleInsights`
   （D-2/D-6/D-7）；`existingConclusions` 喂入集加 dormant（D-5）；
   `FocusSummary.retired`。
3. `schema.ts`：`focus_insight_state` DDL 改六态 CHECK（唯一改点；夹具与
   `init-state` 自动跟随）。既有版本号断言随升（memory.test.ts /
   rw-store.test.ts / init-state.test.ts 照 016 之例只重编号）；`init-state`
   建出的库须能被 17 代码打开（既有测试应自然覆盖，报告里点名证实）。
4. 迁移件 `governance/wo/WO-MEM-DECAY-01/migrations/017_focus_insight_dormant.up.sql`
   + `.down.sql`（§4）。
5. 新测试 `packages/lykoi-learn/test/l4-decay.test.ts`（或并入 l4.test.ts）
   + `packages/lykoi-memory/test/rw-insight-dormant.test.ts`，至少钉死：
   ① 距离 ≥30 降 dormant、29 不降（边界严格按 D-2 的 ≥）；② 本周期刚重申
   的不降；③ dormant 不进 `promotedFocusInsights`；④ 重申 dormant → active
   + history reason relit + 事件 from/to；⑤ dormant 进 existingConclusions、
   被报冲突可走 contested→withdrawn；⑥ 无 dormant→shadow（setFocusInsightStatus
   到 shadow 仍按现规则，本单不新增禁边逻辑但测试要写明现行为）；
   ⑦ 迁移件对临时库施加：行数/索引/CHECK 文本一致，二次施加 -bail 中止且库
   逐字节不变，down 只撤版本行；⑧ 空转周期也结算（对照 promoteDueInsights
   的覆盖面）；⑨ 事件精确匹配计数（`"type":"focus_insight_status"` 且
   `"to":"dormant"`）。
6. STATE-CONTRACT 增补件由治理侧随复核补（同 016 之例），执行方**不改**
   历史存档件。
7. 报告 `governance/wo/WO-MEM-DECAY-01/report.md`（§6）。

## 4. 迁移件 017 规格

- 头注含施加口令（同 016：停 watchdog.timer → 停 service → 备份 →
  `sqlite3 -bail` → 起），并写明"只在治理侧人工施加"。
- `BEGIN IMMEDIATE;` 第一句 = `INSERT INTO mind_schema (version, applied_at)
  VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ','now'))`，**无 OR IGNORE**
  （幂等强形式：重跑撞主键 → -bail 中止 → 事务未提交 → 库逐字节不变）。
- 表重建（SQLite 无 ALTER CHECK）：`CREATE TABLE focus_insight_state__017
  (...)` 六态 CHECK、其余列/约束/REFERENCES 逐字同 STATE-CONTRACT :397-401
  → `INSERT INTO ... SELECT insight_id, status, created_cycle_id,
  updated_cycle_id, contested_since_cycle, superseded_by, updated_at FROM
  focus_insight_state`（**显式列名，禁 SELECT \***）→ `DROP TABLE
  focus_insight_state` → `ALTER TABLE ... RENAME TO focus_insight_state`
  → `CREATE INDEX idx_focus_insight_state_status ON
  focus_insight_state(status)`。执行前查 `sqlite_master` 确认该表无触发器/视图
  依赖（夹具与契约均无；若产线库有，报告并停）。`PRAGMA foreign_keys` 在
  sqlite3 CLI 默认 OFF，头注写明**不得**在施加会话里打开。
- `COMMIT;` 后回执：`MAX(version)`、`focus_insight_state` 行数、按 status 计数、
  `sqlite_master` 中该表的 sql 文本含 `'dormant'` 的断言式 SELECT。**只出计数与
  DDL，不出任何 insight 内容。**
- down：`DELETE FROM mind_schema WHERE version = 17` 只撤版本行；六态 CHECK
  与 dormant 行**保留**（旧体 16 的读侧按状态名取数，dormant 行对它不可见，
  安全）。头注写明重新前滚只重放版本行那一句（表已是六态，重建会撞名）。
- **禁止对任何真实 db 运行**（含 `~/Documents/lykoi/lykoi-cordis-devstate/`
  ——那份已施加 016，是治理侧的；要用就复制一份到 worktree 外再施加）。

## 5. forbidden

- 不动 `experiences`/`concerns`/调节场；不动 `markDimmingDormant`。
- 不物理删除任何 insight/state/history 行；不改 `insights.content`。
- 不动 kernel/gate；prompt/ENVELOPE 模板 sha 不变；不加配置项、不读 env。
- 不改 `promotedFocusInsights` 的语义（仍 = active）。
- 版本门 `!==` 判定逐字不动；只改常量。
- 迁移件不施加于任何真实库。
- 阈值 30、单位周期序号、单步无 dimming——不得改；有异议写偏离表停工上报，
  不得先做。

## 6. 报告要求（一次性完整输出，不分段）

- commit 尖 sha、父 sha、工作树 clean 证明；diff --stat；name-only 过
  `kernel|gate|prompt|vendor|profile` 滤网结果。
- 全量测试精确退出码 + 逐包 `ℹ fail 0` + 合计（基线 850/839/0/11 + 新增）；
  tsc 退出码。
- 迁移件两文件全文；对临时库施加两次的实录（第二次 -bail 中止、sha 前后一致）。
- 偏离表（逐条：位置/原文要求/实际做法/理由），无偏离写"无"。
- D-1..D-8 逐条自证位置（文件:行）。

## 7. 复核要点（治理侧）

- 状态机六态图闭合：入边/出边逐条对 D-5；无 dormant→shadow。
- 迁移件重建段列名逐字对契约；回执不泄内容；幂等强形式。
- 边界测试严格 ≥30；空转周期覆盖；点亮路径不误伤 shadow 重申不计时规则。
- 落地耦合：合并后代码要求 schema 17，产线 16——**下一落地窗必须再走停机迁移窗
  （LANDING-D 范本，去掉 cherry-pick 段：直接钉 main sha）**，merge 到窗之间禁
  "只重启不迁移"。
