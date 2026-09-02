# WO-MEM-DECAY-01 · 治理复核记录（2026-09-02）

- 执行：opus 子 Agent（Mac 隔离 worktree，分支 `wo/mem-decay`，基 main@34a4650）
- 受审尖：`9dc85d19fe5d9419773d2ee2c06346ef1850b285`（四提交
  fcfd68c → e9e2ba9 → 693c9a0 → 9dc85d1，父链连续接 34a4650，工作树 clean）
- 执行报告：同目录 report.md。执行环境拦截了子 Agent 写 `.md`，报告由治理侧
  自其最终消息逐字落盘（头注注明）；代码尖不受影响。

## 独立复核项与结果

1. **commit 事实**：四提交父链连续；`git status --porcelain` 零输出；主检出
   （main@34a4650，clean）与 devstate 本体未动。
2. **diff 边界**：12 文件 +1024/−35；name-only 过
   `kernel|gate|prompt|vendor|profile` 滤网**零命中**；src 只触
   l4.ts / rw.ts / schema.ts / index.ts / testing.ts；`lykoi-converse` 不在
   diff 中（D-8 装配零改动的直证）。
3. **src diff 全文直读，D-1..D-8 逐条**：
   - D-1：schema.ts 唯一改点 :266（CHECK 六态）；rw.ts 枚举六态；
     `EXPECTED_MIND_SCHEMA_VERSION` 16→17，`!==` 判定行不在 diff 中。
     无旁列、无借 withdrawn。
   - D-2：`lastTouchedCycle` = history 最后一行 `cycle_id`（history 空退回
     `updated_cycle_id`）；判据 `cycleId - touched < 30 → continue`，即严格
     ≥30 才降。
   - D-3：`INSIGHT_STALE_AFTER_CYCLES = 30` 住 l4 常量区；整段 diff
     `process.env` 零命中，profile 未动。
   - D-4：单一落点 `'dormant'`；`markDimmingDormant` 零命中。
   - D-5：active→dormant 唯一新增入边，只由 `retireStaleInsights` 从
     `listFocusInsights('active')` 出发；点亮分支
     `existing.status === 'dormant'` → active + `contested_since_cycle` 清空 +
     history reason `relit`，其余分支（`else if (existing)`）逐字原样；
     `existingConclusions` 加 `'dormant'`，上限 20 不变；迁 dormant 的
     contested_since 落既有 else 分支保留（判定分支一行未加）。
   - D-6：降档走既有 `setFocusInsightStatus` 事件面，reason 格式逐字如定案；
     点亮复用 `focus_insight_status` 事件名；`FocusSummary.retired`。
   - D-7：五个调用位与 `promoteDueInsights` 一一配对
     （l4.ts :483 / :510 / :534 / :545 / :568），正常路排在 `applyConclusion`
     （:560）之后。
   - D-8：`promotedFocusInsights` 在 rw.ts diff 零命中。
4. **迁移件（两文件全文直读，与报告所录逐字一致）**：首句版本行无
   `OR IGNORE`；表重建列定义段与 schema.ts 块经治理侧抽块 diff **IDENTICAL**
   （5 行）；显式列名搬行；索引复位；回执只出计数与 DDL（整份脚本不提
   `insights` 表）。down 只撤版本行。
5. **迁移件治理侧独立施加实录**（devstate 的副本 → `scratchpad/gov-mig017/
   dev.db`：schema 16、状态 9 行 = 7 active / 2 shadow、history 18 行）：
   第一次 exit 0，行数 9 不变、逐状态不变、`check_has_dormant` yes、索引 1、
   残留临时表 0；第二次 `UNIQUE constraint failed: mind_schema.version`
   exit 1，文件 **sha256 逐字节相同**（15562b76…）；无 -journal / -wal 残留；
   `integrity_check` ok；`foreign_key_check` 空；down exit 0 → 台账 1..16；
   down 重跑 exit 0 零副作用；只重放版本行前滚 → 17，integrity ok。
   与执行方临时库实录同结论。
6. **产线只读预检**（ssh，计数与 DDL，不出任何内容）：schema 16；
   `focus_insight_state` 15 active / 2 shadow；history 39 行；该表 trigger /
   view 依赖 **0**（迁移件头注要求的预检命中"可施加"）；15 条 active 全部
   有 history 行（`lastTouchedCycle` 的兜底路径不会在产线触发）。DDL 与
   列集读数见文末附录。
7. **测试直读**：`l4-decay.test.ts` 10 条 + `rw-insight-dormant.test.ts` 11 条，
   覆盖工单 ①-⑨ 全部——① D-2 边界 29 不降 / 30 降；② D-7 本周期重申不降；
   ③ D-8 不进装配口；④ D-5 点亮（history relit + 事件 from/to + 返回 false）；
   ⑤ D-5 喂入集两条（含 prompt 载荷正断言：dormant 进、withdrawn 不进）；
   ⑥ 无 dormant→shadow 按现行为如实钉（直发仍可写，产品路径无此边）；
   ⑦ 017 up / 重跑（logicalDigest + 文件 sha 双比）/ down / 前滚四条；
   ⑧ 空转周期 + LLM 失败周期两条；⑨ `countStatusEvents` 按落盘形态序列化后
   字段等值，零子串。时钟纪律：全部 Date 由 T0 派生，零真实时钟。
   `seedCyclesUpTo` 直接补 `focus_cycles` 台账行把边界压进两个周期跑——
   被测判据是序号差，做法合理。既有三个测试文件改动 = 版本号重编
   （16/17，上界 18）+ rw-epistemic 钉字面 16（正确：那条断言钉的是 016
   脚本自己登记的号）。
8. **全量独立复跑**（前台串行，精确退出码）：`npm run typecheck` exit 0；
   `npm test` exit 0；16 包 `ℹ fail 0` 全命中、零非零失败行；合计
   **880/869/0/11** = 基线 859/848/0/11 + 21 条新测试全绿；与执行方逐位一致。
9. **真实库零接触**：执行方只施加于 worktree 外临时库与测试 tmpdir；治理侧
   只施加于 devstate 的副本。

## 偏离追认（执行方申报 4 条，全部认可）

① 表名一截带引号 —— `ALTER … RENAME` 的 SQLite 语义，不可控；可控的列定义段
已钉成等值测试。② `init-state.test.ts` 无字面量无需改；rw-epistemic 钉字面
16 正确。③ order §6 的"850/839"是签发时沿用旧基线的笔误，以 §1 / 派工令的
859/848 为准（治理侧记一笔：签发前须把 §6 与 §1 数字对齐）。④ report.md
由治理侧落盘 —— 已办。

## 治理侧裁定与补件

- STATE-CONTRACT 增补件 017 已落
  `governance/wo/WO-M0-STATE-CONTRACT/amendment_017_2026-09-02.md`。
- 无 dormant→shadow：接受"产品路径无此边、状态机无边表"的现行为钉法，
  不为此扩 scope 加边表。
- 阈值 30 首月校准：产线现读数（cycle 24；近 7 天 9 周期 ≈ 1.3/天；15 条
  active 距上次触达 1..21 周期，分布 1/2/2/3/6/7/11/12/13/14/15/16/19/20/21）
  下，落地后约第 9 个周期（≈ 1 周）起首批降档（距离 19–21 的 3 条），随后
  两周内距离 11–16 的 6 条相继；一个月后 active 集应稳定为"近 30 周期被
  L4 触达过"的子集。复核时**不改 30**；首月读数进下一次校准。

## 部署耦合警示（本单最重要的落地约束）

**合并本分支后，代码要求 schema 17，而生产 memory.db 现为 16。** 下一落地窗
必须是停机迁移窗（LANDING-D 范本去掉 cherry-pick 段、直接钉 main sha）：
停 watchdog.timer → 停 backup.timer → 停 service → 备份 → 树落地 main 尖 →
内容断言 → `sqlite3 -bail` 施加 017 → chown / manifest 重签 / gate 试跑 →
起新体 → timer 回位 → 记账。merge 到窗之间不得发生"只重启不迁移"。

## 结论

**PASS**。受审尖 `9dc85d1` 待 Kevin 裁决合并 main；生产落地 = 停机迁移窗
（017，schema 16→17）。

## 附：产线预检读数（2026-09-02 ssh 只读，schema 层，不出内容）

- 产线 HEAD 56d7ead，service active；`journal_mode = delete`（无 WAL，
  停机窗内不会有 -wal 残留问题）。
- `focus_insight_state` 现 DDL 为旧体（Python migrations.py）书写的五态形态，
  七列 `insight_id / status / created_cycle_id / updated_cycle_id /
  contested_since_cycle / superseded_by / updated_at`，类型、NOT NULL、主键与
  017 重建目标表逐列相同（`PRAGMA table_info` 直读）——`INSERT … SELECT`
  显式列名一一对上；旧 DDL 的缩进 / 换行与 schema.ts 不同，重建后即统一为
  schema.ts 文本。
- 索引 `idx_focus_insight_state_status` 在位，DROP 时连带删除、⑤ 步复建。
- trigger / view 依赖 0；15 条 active 距上次 L4 触达 1..21 周期（cycle 24）。
