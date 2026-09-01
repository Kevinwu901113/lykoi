# WO-U2-SENSE-01 · 器官自感知起步 + capability_gap 一等事件

- 签发：治理侧，2026-09-01（观察周砍除后认知主线第一单）
- 承接：执行 Agent（建议 opus；含结构位点判断）
- 基线：main 最新（签发时 595d41c）
- 依据：观察周 runbook"本周之后"节既定候选（OrganInventoryCache 脚手架
  已在）+ Capability Forge 评估落位（governance/docs/
  capability_forge_assessment_2026-09-01.md：三吸收件之一；裁定
  D-FORGE-1/2 为本单上位约束）。

## goal

两件事：① 实证器官自感知在新体生产路径上活着；② 她"想做但没有"的能力
缺口成为一等审计事件 `capability_gap`，留痕但不改变任何拒绝行为。

## scope

1. **侦查段（先做，写进报告）**：实证 organBlock 在 wake 与 converse 两条
   生产装配上生效——audit 事件**精确匹配** `"type":"organ_inventory_built"`
   计数（禁子串 grep，教训 2026-09-01）；若 devstate 无样本，以测试路径
   实证 + 生产装配接线静态核对（组装处文件:行）替代。
2. **位点测绘**："她选择的动作不被承认/不在位"在新体的全部结构位点——
   kernel dispatch 动作词表判定、wake 候选过滤（decision_ungrounded 对应
   物）、schema-registry 在位判定（GK-11：KNOWN_ACTIONS 说合法性，注册表
   说在位性）。报告枚举位点（文件:行）与各自现行拒绝语义。
3. **事件接线**：在最贴近判定处落 audit 事件 `capability_gap`，字段：
   `wanted`（动作/能力名）、`source`（wake|converse）、`runId`、
   `reason`（unknown_action|not_registered|…，与位点对应）。原拒绝语义
   **逐字节不变**（事件是旁路留痕）；事件写失败不毁一轮（fail-safe 对齐
   organ_inventory_bindings_failed 先例）。
4. **测试**：红绿——各位点触发 gap 事件断言（精确匹配 type）+ 合法动作
   零 gap 事件对照组；全量不回归。

## forbidden

- 不改 prompt/ENVELOPE（sha 逐字节不变，反向恢复测试口径）。
- 不改 KNOWN_ACTIONS、硬门判定、schema-registry 语义；不新增她可写的面。
- gap 事件不落用户消息/不可信输入原文（隐私纪律对齐 D-01 失败事件元数据
  口径：只落结构字段）。
- 不做 registryActionCatalog 18→5 切换（归 M5 编排）；不做价值阈值/
  resolution 逻辑（纸面归治理，D-FORGE 落位节）。
- 不动 kernel/gate root 域之外还须满足：若位点测绘表明必须在 kernel 包内
  接线，**停工上报**待治理裁决（kernel 是受保护面，改动须专门批准）。

## success_criteria

侦查段实证结论；位点枚举表完整（复核将独立对照）；gap 事件红绿测试
点名通过 + 对照组零误报；全量对照基线零新增失败；tsc 净。

## required_evidence

报告一次性输出：侦查实证、位点表、diff、全量数字、新测试输出。前台串行，
禁后台挂起交卷。
