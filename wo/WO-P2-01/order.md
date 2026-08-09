# WO-P2-01 · 阶段 2 数据模型 migration（设计 v1 §2 步骤 1）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（当前已在分支 `wo/p2-01`）实现本工单。
设计基准：`~/phase2_joint_design_v1_2026-08-09.md`（先通读 §1/§2/§5，冻结版，不得偏离）。

## 输出纪律（违反即打回）

- **stdout 即报告本体**：完整技术报告直接写到标准输出，不要写"报告已保存至某文件"。
- **禁止用摘要代替明细，宁长勿略**。报告必须含：每个新表的最终 DDL 原文、迁移模块的
  文件路径与行数、测试清单（逐个用例名+结果）、manifest 变更 diff、下述"必答硬数字"。
- **必答硬数字**：新建表数量；迁移模块新增/修改文件数；pytest 通过数/失败数/跳过数；
  `tests/test_p0_integrity.py` 通过数；manifest 中新增/修改条目数。

## goal

按设计 v1 §2.1–2.5 实现一次性 schema migration（**只实现与测试，不对活体执行**）：

1. memory.db 新表：`users`、`identity_bindings`、`contexts`、`context_members`、
   `memory_scopes`、`procedures`、`note_insight_links` —— DDL 以设计 v1 为准
   （含全部 CHECK/UNIQUE/外键；`users` 需补 `role='owner_primary'` 唯一的部分索引）。
2. 新库 `percept_buffer.db`（独立文件，路径经环境变量 `LYKOI_PERCEPT_BUFFER_DB`
   注入，默认 `/home/lykoi/state/percept_buffer.db`）：`percept_events` 表（§2.3）。
3. 回填逻辑：对 `experiences`/`thoughts`/`insights`/`concerns`/`narrative_threads`/
   `autonomy_notes`/`history` 全量写 `memory_scopes` 行（`user_001`/
   `ctx_direct_user_001`/`private`/`content`），批量事务、可重入（重复执行不产生重复行）。
4. 种子数据：`user_001`(owner_primary, Kevin) + `ctx_direct_user_001`(direct) 两行，
   随迁移写入。
5. 挂接现有 `mind_schema` 版本机制（先阅读现有 migration 代码的写法，保持同一风格与
   调用路径）；迁移必须**幂等**且带**逆迁移**（drop 新表/新库即回滚，设计 §2.6）。

## scope（允许触碰）

- `src/lykoi/mind/`、`src/lykoi/memory/`（迁移与 schema 代码所在处，以现有机制为准）
- `tests/`（新增测试文件）
- `guardian/manifest.sha256`（见下条纪律）

**manifest 纪律（历史上漏过两次、三服务全停）**：你改动 `cognition/mind/memory/shared/
surface/resources` 六目录下任何 .py 都必须同步更新 `guardian/manifest.sha256` 对应条目
（用 `python3 guardian/startup_verify.py --write-manifest` 重签），并在报告中给出
manifest diff。完成后必须跑 `pytest tests/test_p0_integrity.py` 并报数。

## forbidden

- 不得读写 `/home/lykoi/state/`（活体数据）与 `/home/lykoi/projects/lykoi`（活体检出）；
  一切在 `~/lykoi-work` 内进行。
- 不得对任何真实数据库执行迁移。测试用**合成 fixture**：用代码自身的 schema 初始化建
  空库 + 插入伪造行（每张被回填表 ≥3 行），不得使用任何真实 memory 备份。
- 不改 `autonomy_notes` 等既有表结构，不动 append-only 触发器（影子表方案的全部意义）。
- 不实现 integrator 晋升作业、delegation 表、broker（后续工单）。
- 不 push、不合并；全部提交留在分支 `wo/p2-01`。

## success_criteria

1. 合成 fixture 上：迁移 → 全部新表存在且 DDL 与设计一致；重复执行迁移无变化（幂等）；
   逆迁移后库回到迁移前状态（表清单逐一比对）。
2. 回填：fixture 各表行数 = memory_scopes 对应行数；重复回填不产生重复行。
3. 新增单测覆盖上述 1/2 + CHECK 约束拒绝非法值（role/visibility/sensitivity 各至少一例）。
4. 全量 pytest 无新增失败；`tests/test_p0_integrity.py` 全过。
5. manifest 与被改文件一致（startup_verify 在工作副本内通过，可用
   `LYKOI_*` 环境变量指向 fixture 路径绕过活体路径依赖；若脚本存在活体路径硬依赖，
   如实报告，不要伪造通过）。

## required_evidence（报告中逐项给出）

- `git log --oneline` 与 `git diff --stat`（相对分支起点）
- 每张新表最终 DDL 原文（`.schema` 输出）
- 幂等/逆迁移/回填三组验证的实际命令与输出
- pytest 全量输出末尾 summary 行 + p0 专项输出
- manifest diff + 必答硬数字五项
