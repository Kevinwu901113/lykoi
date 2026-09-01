# WO-MEM-SOURCE-01 · 治理复核记录（2026-09-01）

- 执行：opus 子 Agent（Mac 隔离 worktree，分支 `wo/mem-source`，基 main@1eab7e8）
- 受审尖：`688e9d76a78f4e8132857ab046f6c9588e239575`（单 commit，工作树 clean）
- 执行报告：同目录 report.md（头注声明的两处归档处理外逐字未动）

## 独立复核项与结果

1. **commit 事实**：单 commit、父 `1eab7e8`、工作树 clean；主检出未动。
2. **diff 边界**：12 文件 +746/−39；name-only 过
   `kernel|gate|prompt|vendor|profile` 滤网**零命中**。
3. **版本门（forbidden 第 5 条重点）**：diff 直读证实只有常量 15→16 与
   docstring，`!==` 判定逐字未动——"仅登记新版本号"成立。升格而非裸
   ALTER 的论证成立：不升版本会造成两个物理 schema 同号 15，门放行缺列
   库后崩在查询层，恰是门要防的事。
4. **映射与过滤（源码直读）**：`deriveEpistemic`（rw.ts:111）八渠道 +
   conversation 方向劈，与设计稿 §3.1 **逐字一致**；推导路径不可产出
   imagined/simulated；`factualEpistemicClause` 的 `IS NULL OR` 半句对
   SQL 三值逻辑的处理正确（缺它旧行全灭）。三条事实性供给
   （recentExperiences 双面 / INTAKE_CLAUSE / relevanceCandidateRows）
   均挂过滤。遥测载荷 `mind_experience` 四字段未动（rw.ts:483 直读）。
5. **迁移件（两文件全文直读）**：与报告所录逐字一致。幂等为强形式
   （版本行主键撞 + `-bail` 中止，事务未提交则库逐字节不变）；复核补充
   核验：即使误用无 `-bail` 重跑，ALTER 撞 duplicate column、回填句
   `WHERE epistemic IS NULL` 自免疫，**无任何数据损伤路径**。down 只撤
   版本行不删列不清值，与"她的数据不销毁"原则一致。
6. **既有测试改动直读**：memory.test.ts 与 rw-store.test.ts 均为版本号
   重编（14/15→15/16、上界 16→17），双向拒开语义保留；rw-triggers 夹具
   DDL 补 epistemic 列。无掩盖回归。
7. **全量独立复跑**（前台串行，精确退出码）：`NPM_TEST_EXIT=0`、16 包
   `ℹ fail 0` 全命中、零非零失败行，合计 **850/839/0/11** = 基线
   839/828/0/11 + 11 条新测试全绿；`TSC_EXIT=0`。与执行方逐位一致。
8. **真实库零接触**：worktree 无 var/ 目录；迁移仅施加于测试临时库。

## 偏离追认（执行方申报 12 条，全部认可；两条附治理裁定）

①（裁定）STATE-CONTRACT §1.2 增补件由治理侧补——已随本复核落
`governance/wo/WO-M0-STATE-CONTRACT/amendment_016_2026-09-01.md`，
两份可执行副本自此有契约文本锚点。②③ 最小必要改动（②防错账：她自己
产出的未送达消息必须 executed），认可。④ 账面口径 vs 供给口径的区分
正确，countPendingExperiences 不挂滤是对的。⑤ 陈旧引用同步，认可。
⑥（裁定）m1_blueprint 历史实测记录不改——历史不是契约，维持。
⑦⑧ 夹具描迁移后 schema + devstate 副本须先施加 016：均为版本门设计
意图的自然后果，入部署纪律。⑨⑩⑪ 无异议。⑫ forbidden 逐条复核无触碰。

## 部署耦合警示（本单最重要的落地约束）

**合并本分支后，代码要求 schema 16，而生产 memory.db 现为 15。**
下一次落地窗必须是**停机迁移窗**（顺序硬性：停 watchdog+service →
备份 → 施加 016 → 起新体），不能像 LANDING-C 那样直接重启了事。
merge 与落地窗都待 Kevin 裁决；merge 先行是安全的（测试全走夹具），
但 merge 后到迁移窗之间不得再发生"只重启不迁移"的窗口。

## 结论

**PASS**。受审尖 `688e9d7` 待合并 main；生产落地=停机迁移窗
（016 + m4-switch 重钉 + gate hash-pin 重签 + Kevin root）。
