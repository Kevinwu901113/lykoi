# WO-L2 续跑单 3 · 复核发现 4 个漏网测试文件需同款适配——只修这 10 条，别的不动

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l2`）继续 WO-L2。
复核方全量 pytest 发现 **10 条 L2 引发的失败**，全部是你在 `c2948c12` 已经做过的
同款适配，只是这 4 个文件不在原单必跑清单里、漏掉了。**已有提交一行不要重构。**

## 要修的 10 条（复核方已逐条复现，机制确认）

1. `tests/test_p2_data_model_migration.py` ×2
   （`test_v10_downgrade_restores_pre_migration_table_list`、
   `test_v10_downgrade_then_reupgrade_reproduces_same_state`）：
   `_downgrade_to_v9` helper 只回滚 v11→v10，没先撤 `_V12`。
   照你在 `test_l1_experience_class.py` 的做法，helper 里加 `downgrade_v12(conn)`
   于最前（倒序）。`_L1_TABLES` 一类的表清单常量若涉及 `learning_layer_state`
   也同步。**别的断言一个字不动。**

2. `tests/test_p4r12_load_vent.py` ×2、`tests/test_p4r12_release_gate.py` ×2、
   `tests/test_p4r_c2_substrate_write.py` ×4：
   种子材料是 `wake_action`（现为档案类，不入队）→ 消化周期空转 → 吸收/泄压/门控/
   基底写入断言全部落空。**换材料，不换被测行为**：种子源改成 `conversation`
   （或其它 working 类且必要处带 `related_concern_id`），与你在
   `test_mind_integrator_pipeline.py` 的 `_seed_experience` 同款。
   这些套件测的是负载泄压 / 释放门 / 叙事基底写入——材料只是载体。
   逐文件改动在报告里给理由（钉语义不钉来源）。

## 修完之后

1. 跑这 4 个文件 + `tests/test_l2_intake.py`（确认没被波及）：
   `timeout 600 .venv/bin/pytest -q tests/test_p2_data_model_migration.py
   tests/test_p4r12_load_vent.py tests/test_p4r12_release_gate.py
   tests/test_p4r_c2_substrate_write.py tests/test_l2_intake.py`
   期望全绿。修完即 `git commit`（一个提交即可，message 说明"复核补适配"）。
2. **报告（stdout 即本体）**：每个文件的改动行 diff、每条失败的修后用例名+结果、
   为什么这样改的理由（一句话/文件）。

## 纪律

只动上述 4 个测试文件；不动任何 src/；不动已有提交；不 push；不跑全量。
