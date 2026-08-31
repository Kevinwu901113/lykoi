# WO-M0-CORE-RETIRE · core 包退役审查（只读审查单）

你是 Lykoi 治理平面的执行 Agent。背景：Lykoi 将整体移植到 Cordis(TS/Node) 运行时（M0–M5
计划），Owner 已定案 **CF-B2：src/lykoi/core（约 13k 行，大部影子态）不迁移、整体退役**。
本单产出退役审查报告：退役清单+步骤+风险，报告要能直接变成后续退役/切换工单的依据。

## 基线与工作区

- 工作区 `~/lykoi-work-m0/` 是活体 HEAD `4463ae8`（tag cordis-night-20260822）的**文件树
  只读副本**（无 .git）。行号引用以此为准。
- 本单**零代码修改**，只读代码、只写报告（stdout）。

## goal

回答"退役 core 要动什么、按什么顺序、有什么会断"，精确到文件与配置项。

## scope

- `src/lykoi/core/` 全部 20 个 .py（13,282 行）逐文件判定
- `lykoi-core.service` 与其 drop-in 体系（工作区有 .service 文件；活体 drop-in 只能从
  docs/ 的 prereg/设计文档推断，标注"活体待核对"）
- `src/lykoi/cognition/` 与 `src/lykoi/mind/` 里对 core 的全部 import/调用（grep 实测）
- `runtime_client.py` 的三服务注册机制
- `tests/test_core_v1_*.py` 全集（数一下有多少文件多少用例）
- `guardian/` 与 manifest 对 core 文件的覆盖
- `docs/` 里 core_v1 相关 prereg/activation 文档（列清单即可，不逐篇精读）

## deliverables（报告六节）

1. **core 今天实际提供什么**：`core/runtime.py` 主循环做什么（三种 maintenance 模式）、
   core.sock 谁在用（全树 grep 消费者）、`runtime_client` 注册对三服务的实际作用、
   观察项 `core_runtime_registration_failed` 反复重试的根因定位。
2. **逐文件判定表**（20 文件）：退役 / 保留（理由+新归属）/ 语义承接（标注"由新世界的 X
   承接"，如 attention→心脏显著性、permission_evidence→治理层策略）。`shadow.py`、
   `self_state.py` 等被 cognition 侧消费的要特别小心——先列消费者再下判。
3. **依赖断链表**：cognition/mind/surface/resources 里每一处 core import 的处置
   （随 core 退役删除 / 需要替身 / 本来就是死引用）。
4. **退役步骤建议**（可直接变工单的粒度）：服务停用顺序（先消费者还是先 lykoi-core）、
   drop-in 清理清单、env 开关清单、manifest 影响（多少条目消失）、测试影响
   （test_core_v1_* 文件数与用例数，退役后基线数字怎么变）、`startup_verify` 对 core
   root 封存的检查要不要同步改。
5. **风险表**：退役后旧体还要在切换前继续跑一段——**分"移植期间可以先做"与"必须等 M4
   切换时一起做"两档**。特别回答：现在就停 lykoi-core 服务，其余四服务会不会受影响
   （runtime_client 注册失败是致命还是降级）。
6. **白皮书更新点**：28 章事实基线里哪些条目随退役失效（列条目，不改文档）。

## forbidden

零写入；不碰 `/home/lykoi/` 与任何服务/state/secrets；不跑 git 写命令；不跑 pytest
（用例数用 grep -c 数，不用运行）。

## success_criteria

六节齐；20 文件判定无遗漏；所有消费者断言有 grep 证据；[事实]/[推断]/[建议] 标注贯穿。

## 纪律（逐字遵守）

- **stdout 即报告本体**，不要聊天式摘要。
- 全程前台串行，禁止后台；完成的定义 = 六节报告打印完毕。

## 副本已知缺口（如实告知）

工作副本比活体少 5 个 .py（治理账户 0600 不可读，属 R2c 影子产物）：
`src/lykoi/cognition/permission_evidence_shadow.py`、`tests/test_core_v1_m3_r2c_r1_permission_evidence.py`、
`tests/test_core_v1_m3_r2c_r2_permission_replay.py`、`tests/test_core_v1_m3_r2c_r3_projection_candidate.py`、
`tests/test_salience_shadow_release_audit.py`。活体 tests 共 154 个 .py，副本 150。
涉及这些文件的判断标注"文件不可读，按引用侧证据推断"。
