# WO-U2-SENSE-01 · 治理复核记录（2026-09-01）

- 执行：opus 子 Agent（Mac 隔离 worktree，分支 `wo/u2-sense`，基 main@1976325）
- 受审尖：`473804dfe37de625d051e7c146984f9f68136391`（单 commit，工作树 clean）
- 执行报告：同目录 report.md（执行方一次性全文，未改动）

## 独立复核项与结果

1. **commit 事实**：单 commit、父 `1976325`、工作树 clean；主检出
   `/Users/wukevin/Documents/lykoi/lykoi-cordis` 全程未动（status 干净、尖 02a475f）。
2. **diff 边界**：`git diff 1976325..473804d --stat` = 12 文件 +636/−8；
   name-only 过 `kernel|gate|prompt|vendor|profile` 滤网**零命中**——
   受保护两包一行未动，位点⑤⑥不接线 ⇒ 停工线确未触发，与执行方测绘结论互证。
3. **既有测试改动逐字核对**（本单唯一动既有断言处，源码直读）：
   `evaluate.test.ts` 红测 6 与 `reflow.test.ts` G-1 均为**纯追加**——原有
   deepEqual 期望逐字保留，新事件 `['capability_gap', {...}]` 追加在原事件
   之后（红测 6 在 `decision_ungrounded` 后、G-1 在 `unknown_decision_kind`
   后），与"gap 排在原事件之后"的实现顺序一致。
4. **抽查两处关键声明**：
   - `registryActionCatalog` 全仓 grep（排除 test 与 schema-registry 本体）
     仅两处注释命中，**零生产消费者**——⑥ 不接线的理由成立；
   - `'capability_gap'` 字面量全 src 恰两处：常量定义
     （capability-gap.ts:42）+ 唯一发射点（:119 字面量，gate `EMISSION_RE`
     只认字面量，测试 1 钉死不分叉）。
5. **全量独立复跑**（前台串行，rerun 带精确退出码）：
   `NPM_TEST_EXIT=0`，16 包 `ℹ fail 0` 全命中、零非零失败行，
   合计 **835/824/0/11** = 基线 813/802/0/11 + 22 新测试全绿（4 处既有断言
   为追加式修改不计数），零新增失败，skip 恒 11。`TSC_EXIT=0`。
   与执行方报告逐位一致。

## 偏离追认（执行方申报 6 条，全部认可）

① 无停工——测绘理由充分（⑤ dispatch 只见内部映射常量，触发=接线 bug
而非能力缺口，混发会脏账；⑥ 零生产消费者）。② 侦查段活体探针替代降级
路径：往严处偏离，真实 apply() + 双通道判别（converse 无 channel /wake 带
telemetry 戳），是本单亮点。③ **`not_registered` 保留值域、不设发射点：
治理裁定维持现状**——值域是词表承诺、发射点是接线事实，M5 接注册处时补
发射点免改值域（改值域撞事件消费者），报告 ② 节已白纸黑字记录该档
reserved。④ 既有断言两处追加式修改：核对为纯追加（复核项 3），认可。
⑤ 探针脚本未入提交：合规。⑥ 发射点字面量：正确做法非偏离，
gate 遥测扫描机制所迫，且有测试防"好心优化"。

## 结论

**PASS**。受审尖 `473804d` 待合并 main；生产落地随下一次部署窗
（m4-switch 重钉 + gate hash-pin 重签 + Kevin root），与 WO-LLM-FINISH-01
同窗（批量合并建议③）。合并 main 需 Kevin 裁决（分类器拦截先例）。
