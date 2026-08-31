# WO-L2 续跑单（收尾）· 实现与测试文件已写完——只跑测试、重签、出报告

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l2`）继续 WO-L2。
前两段会话因额度撞限中断（已重置）。**已完成的一行都不要重构：**

- `eab07978`：实现全量——integrator 取料改口（原料池+水位线）、`_V12` 水位线迁移、
  K=30 实测注释、关切 origin（emergent/owner_directed）
- `c2948c12`：既有测试随取料口的语义适配
- `1572cc30`（WIP）：`tests/test_l2_intake.py` 548 行已写完

## 你要做的

1. 读一遍上述提交确认落盘完整，把 WIP 换成正式里程碑提交：
   `[WO-L2] tests: intake watermark + K + origin suite`。
2. 跑测试（`timeout 300 .venv/bin/pytest ...`，被拒就去掉 timeout 前缀）：
   `tests/test_l2_intake.py` + `tests/test_mind_integrator_pipeline.py` +
   `tests/test_mind_integrator_trigger.py` + `tests/test_mind_store.py` +
   `tests/test_mind_migrations.py` + `tests/test_l1_experience_class.py` +
   `tests/test_l3_relevance.py` + `tests/test_concern_floor.py` +
   `tests/test_integration_telemetry.py` + `tests/test_perception_ingest.py` +
   `tests/test_p0_integrity.py`。
   失败就修（只许修 bug 与测试；不许推翻水位线/K/origin 的设计决策），修完 commit。
3. 重签 manifest（mind/ 三个文件被改：integrator/migrations/store；照既有做法自算，
   `--write-manifest` 在 claude 身份会崩；条目数应保持 103，只有哈希变化）。commit。
4. **报告（stdout 即本体，宁长勿略）**必含：原单六条 success_criteria 逐条的用例名+
   结果；水位线迁移与取料查询的最终代码；被 `c2948c12` 改过的既有测试逐条列出改动理由
   （钉语义不钉版本号）；manifest diff；硬数字（文件数/行数/各套件通过数/p0 通过数，
   claude 身份 1 个既有假失败如实报）。

## 纪律（不变）

不 push；不跑全量 pytest（复核方统一跑）；不动叙事/连续性门/情绪；`integrated` 语义
不变；每个里程碑立刻 commit。
