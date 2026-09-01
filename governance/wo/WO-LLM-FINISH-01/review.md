# WO-LLM-FINISH-01 · 治理复核记录（2026-09-01）

- 执行：opus 子 Agent（Mac 隔离 worktree，分支 `wo/llm-finish`，基 main@1976325）
- 受审尖：`a2ad35a79483d7328580c53749b57f2ac89b197a`（单 commit，工作树 clean）
- 执行报告：同目录 report.md（执行方一次性全文，未改动）

## 独立复核项与结果

1. **diff 边界**：`git diff 1976325..a2ad35a --stat` = 恰 3 文件
   （lykoi-llm src+test、lykoi-converse 只读落点测试 157 行新文件），
   name-only 过 kernel/gate/vendor/prompt/profile 滤网零命中。forbidden 全守。
2. **实现核对（源码直读）**：失败类白名单 `['error','aborted']` 与
   dsh-llm@0.1.1-rc.2 FinishReasonMap 一致（恰两个带 failure 的 kind）；
   merge-extensible 词表取保守侧（表外 kind 按非失败类原样带出）；抛错位置
   在 charge（③）与 hasThrown 重抛之后——记账口径逐字不变，与既有异常路同序。
3. **全量独立复跑**（前台串行，rerun 带精确退出码）：
   `NPM_TEST_EXIT=0`，16 包 `ℹ fail 0` 全命中、零非零失败行，
   合计 **817/806/0/11** = 基线 813/802/0/11 + 恰 4 个本单新增，零新增失败。
   `TSC_EXIT=0`。与执行方报告逐位一致。
4. **红绿双验**：执行方以临时禁用新分支复跑取得红态（含 converse 落点测试
   以"adapter 被调 2 次"精确复现事故形态=空串下游触发 D-01 重试），验毕
   逐字节还原——采信其记录，绿态由本侧独立复跑覆盖。

## 偏离追认（4 条，全部认可）

① 基线 1976325 非工单所写 595d41c：治理侧建 worktree 所致，区间内
packages/lykoi-llm 零 diff，语义等价。② converse 侧新增只读测试文件：
scope 3"实证落点"的测试授权范围内，零生产代码改动，且为本单亮点。
③ textLength 用码点数：对齐仓内 D-08 口径。④ 失败判定白名单而非
"有 failure 字段即失败"：merge-extensible 下的保守侧，认可并已入源码注释。

## 结论

**PASS**。受审尖 `a2ad35a` 待合并 main；生产落地随下一次部署窗
（需 m4-switch 重钉 + gate hash-pin 重签 + Kevin root），与 WO-U2-SENSE-01
可同窗。合并 main 动作被 Mac 权限分类器拦截（正当拦截），上交 Kevin 裁决。
