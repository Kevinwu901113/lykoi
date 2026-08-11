# WO-L4 续跑单 · 实现已完成（两个提交）——只补测试/重签/报告，不要重做

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l4`）继续 WO-L4。
上一段被网络中断打断五次（每次都在"正要写测试"处）。**已完成的一行都不要重构：**

- `a581dc1a`：层 2 状态层——`_V13` 五张影子表 + store 单写者接口
- `c99c171e`：层 2 本体——周期骨架 + 选择策略（owner_directed 优先 + user_001
  硬规则）+ 血缘 + 反刍防护
- `68bce35d`：测试骨架（合成 fixture + 八条判据分节）
- `18155b0b` / `c855617e` / `33281c9f`：判据①②③的测试**已写完并提交**

原单在 git 历史（`~/wo/WO-L4/` 早前版本）与下方要点里；设计基准
`~/learning_layer_v2_design_2026-08-10.md` §3.4/3.5/3.7。

## 你要做的

1. 读一遍两个提交确认落盘完整（`git show --stat`），有半成品文件先收尾并 commit。
2. **写测试套件**（上一段五次都倒在这：先 commit 空骨架再逐段补，每写完一个
   criterion 段落就 `git commit` 一次——网络中断时不再丢整文件）：
   **只需补判据④⑤⑥⑦⑧**（①②③已完成，不要重写）：
   ① 周期端到端（mock LLM，insight+血缘+状态更新；无关切空转零调用）
   ② 选择策略（owner_directed 压倒 lit_count；冷却跳过；M=3 user_001 硬规则；确定性）
   ③ 血缘可回溯到 experience id
   ④ contested → 修订且历史保留；影子期 S=2 转正
   ⑤ 反刍：3 次无进展 → 冷却 5 周期 → 超限出建议释放记录且未调 release_concern
   ⑥ 配额：LLM 抛错不重试、周期记失败；每周期 ≤1 次调用计数钉死
   ⑦ 行为不变：文末清单全绿
   ⑧ 零 schema 破坏 + `downgrade_v13` 逆迁移测试
3. 跑文末清单（`timeout 600` 分批），失败就修（只许修 bug 与测试，不许推翻设计），
   修完 commit。
4. 重签 manifest（新增 focus.py 等，条目数以实算为准，当前基线 104），commit。
5. 报告：stdout 即本体，宁长勿略——八条 criteria 逐条用例名+结果、血缘表 DDL、
   LLM prompt 模板原文、manifest diff、硬数字。

## 纪律（不变）

不 push；不跑全量；不动叙事/情绪/审批/messenger；新表全走影子方案；
每个里程碑立刻 commit。

## 必跑清单（全邻接，不许删减）

```
tests/test_l2_intake.py  tests/test_l1_experience_class.py  tests/test_l3_relevance.py
tests/test_mind_integrator_pipeline.py  tests/test_mind_integrator_trigger.py
tests/test_mind_store.py  tests/test_mind_migrations.py  tests/test_concern_floor.py
tests/test_integration_telemetry.py  tests/test_confab_invariant.py
tests/test_p4r12_load_vent.py  tests/test_p4r12_release_gate.py
tests/test_p4r_c2_substrate_write.py  tests/test_perception_ingest.py
tests/test_p2_data_model_migration.py  tests/test_core_v1_event_outbox.py
tests/test_p0_integrity.py  <本单新增的测试文件>
```
