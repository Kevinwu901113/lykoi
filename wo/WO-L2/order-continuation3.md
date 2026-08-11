# WO-L2 续跑单 4（终轮）· 剩余 10 条：confab ×9 一行根因 + outbox ×1 冻结点钉死

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l2`）继续。
复核方串行全量已拿到完整清单，L2 相关失败只剩这 10 条。**已有提交一行不要重构。**

## 1. `tests/test_confab_invariant.py` ×9 —— 同款换材料，根因一行

`:87` `_seed_experience` 默认 `source="wake_action"` → 档案类不入队 → 消化空转 →
`experiences_integrated == 0` 起连锁（含那个 TypeError，是空结果的下游）。
改默认值为 `"conversation"`（与 `test_mind_integrator_pipeline.py` 的适配同款）。
该文件里显式传了 `source=` 的调用一律不动；改完逐一确认 9 条转绿，
若仍有个别红，按其真实根因单独处理并在报告里说明（不许扩大改动面）。

## 2. `tests/test_core_v1_event_outbox.py::test_v9_migration_does_not_backfill_existing_v8_environment_receipts` ×1 —— 冻结点从"链相对"钉成"绝对"

这条是复核方在 L1 时修过的测试，修法里保留了 `MIGRATIONS[:-1]` 的链相对冻结——
链长到 v12 后又漂了：冻结点落在 v11，分类钩子被 patch 掉而 v11 回填已应用过，
重连只跑 v12，冻结期写入的经验没人分类，末尾的"回填覆盖"断言失败。

**修法（钉死，不再随链漂）**：
```diff
-        v8.setattr(migrations, "MIGRATIONS", migrations.MIGRATIONS[:-1])
+        # 冻结在 v10 —— 最后一个"分类系统尚不存在"的版本。链相对的 [:-1] 每长
+        # 一版就漂一次(v11、v12 各咬过一口)；这个场景要的是"分类前时代的写入,
+        # 升级时由 _V11 回填补上",冻结点必须绝对。
+        v8.setattr(migrations, "MIGRATIONS", migrations.MIGRATIONS[:10])
```
钩子 patch-out 与末尾"回填覆盖"断言**保留原样**（v10 冻结下语义正确）。

## 修完之后

跑 `timeout 900 .venv/bin/pytest -q tests/test_confab_invariant.py
tests/test_core_v1_event_outbox.py tests/test_l2_intake.py`，期望全绿
（confab 文件内 `test_l1_scan_still_clean` 应本来就绿——fix-clock 在基线里）。
`git commit`（一个提交，message 说明复核终轮补适配）。
报告：每条转绿的用例名、confab 里显式传 source 的调用清单（证明没动）、硬数字。

## 纪律

只动这 2 个测试文件；不动 src/；不动已有提交；不 push；不跑全量。
