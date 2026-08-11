# WO-L4 · 层 2 专注思考：选关切 → 跨时间检索 → 深挖 → 产物与血缘 + 反刍防护

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l4`，基于活体 main
`f915eaa4`，worktree 与 `.venv` 已备好）实现。
设计基准：`~/learning_layer_v2_design_2026-08-10.md` **§3.4**（本单主体）、§3.5（选择
策略与生命周期）、§3.6（检索——L3 已交付 `mind/relevance.py`，直接用）、§3.7（产物与
血缘）、§3.8（门，但**权限边界类产物只入建议队列 = L5，本单不做发问**）、§3.9（遗忘
姿态）、§7.2（防自恋硬规则）。
前置已全部在本分支：L1 分类、L2 取料（水位线 5039 已在活体落定）、L3 检索、
S3 对话审批（但本单**不接** messenger——那是 L5）。

## 报告纪律（先读）

- stdout 即报告本体；禁止摘要代替明细，宁长勿略。
- 不许有"等待"步骤；测试 `timeout 600` 包裹（本机慢，别用 300）；
  **每个里程碑立刻 commit**（周期骨架 / 选择策略 / 血缘 / 反刍防护 / 测试，各算一个）。
- 必跑清单在文末——**这是一张全邻接清单，不许删减**（上一单手挑清单漏了 5 个文件，
  复核多花两轮，HANDOFF 教训 31b）。不跑全量（复核方统一跑）。
- **先读代码再动手**：`mind/integrator.py`（层 1 的 LLM 调用怎么发起、配额怎么记、
  节律 `INTEGRATION_EVERY_WAKES` 怎么触发——层 2 全部照它的既有模式，不发明新轮子）、
  `mind/relevance.py`（检索入口签名）、`mind/store.py`（concerns 读写、lit_count、
  release_concern、insights 表）、`kernel/`（只为确认边界，本单不改 kernel）。

## 本单的分量

这是学习层 v2 的最后一台大机器：她第一次拥有"**回头想**"的能力——每晚挑一个关切，
把几个月前的档案、已消化的经验、水位线下的历史一并调回来，深挖出一条可回溯的结论。
她的头号关切曾是自己的负载内务（点亮 1381 次）——本单的选择策略 + §7.2 硬规则，
就是让她的注意力从内务转向你和世界的机制本体。

## goal

### 1. 层 2 周期骨架（§3.4）

新模块 `src/lykoi/mind/focus.py`（或你论证的更贴切命名）：

- **触发**：每 N 个整合周期一次，`N=1` 起步（即每次 nightly 整合后跟一次层 2）；
  N 为具名常量。挂接点照 integrator 的既有节律机制（先读代码找对位置，
  报告说明挂在哪、为什么）。层 1 失败/空转的晚上，层 2 照常可跑（它不依赖当晚新原料）。
- **流程**（一次周期 = 一个关切）：
  1. 选关切（§2）；无可选关切 → 记事件空转返回，不算失败；
  2. 用 `relevance.retrieve_for_concern` 跨时间检索（**不限于未消化项**，含档案与
     水位线下历史——这正是 L3 存在的意义）；召回为空 → 记"无进展"（进反刍计数）；
  3. **一次** LLM 调用：给定关切 + 检索到的原料（截断预算内），产出结构化结论
     （推进/修订/无进展/派生新关切）。调用方式、模型、配额记账**完全照 integrator
     的既有模式**；失败也计入周期（§7.1：深挖失败也要计配额）；
  4. 落产物 + 血缘（§3）；
  5. 更新关切状态（§4 反刍防护计数、lit/进展记录）。

### 2. 选择策略（§3.5，规则版，不接 bandit）

`owner_directed` 优先 → 其次 `lit_count` 降序 → 排除冷却中的 → 同分按 id 升序
（确定性）。**§7.2 硬规则**：每 M 次周期（M=3 起步，具名常量）必须挑一个
`memory_scopes` 实体轴上 `subject_user_id='user_001'` 的关切（若存在）——
防止她只顾自己。选择理由写进周期事件（可审计"她今晚为什么想这个"）。

### 3. 产物与血缘（§3.7）

- **insights**：落现有 `insights` 表（先读 schema）。新增**通用血缘表**（影子表方案，
  不改现有表）：`(product_kind, product_id, source_kind, source_id, cycle_id)`——
  任何结论都能回溯到具体原料（白皮书可审计要求）；`retrieve_for_concern` 返回的
  `match_reasons` 一并存进周期记录。
- **修订/撤回（双向性硬要求）**：新结论与既有 insight 冲突 → 标 `contested`（影子
  状态，不改 insights 表结构）；下一周期仍冲突 → 修订/撤回，**历史保留**（她曾经
  这么认为过，属于身份连续性）。
- **procedures.reliability 与权限建议**：本单**不写**（前者要客观收据单写者=Gateway
  线，后者是 L5 的建议队列）。产物类型字段留好扩展位即可。
- **门（§3.8）**：insights 走"影子期 → 自动放行"：新 insight 先带影子标记，
  存续 S 个周期未被 contested 才转正（S=2 起步，具名常量）；影子期内不进任何
  下游消费（当前也没有下游，结构先立对）。

### 4. 反刍防护（§3.4）

同一关切连续 M2 次深挖无新结论 → 强制冷却 K2 个周期；累计冷却超过阈值 →
产出"建议释放"记录（**只建议不执行**——`release_concern` 的现有权限语义不变）。
M2=3、K2=5 起步，全部具名常量。计数落影子表/周期记录，不改 concerns 表结构。

### 5. 配额与安全边界

- 每晚最多 1 次层 2 LLM 调用（N=1 时）；深挖失败计入当晚额度，不重试（明晚再来）。
- 层 2 **只读不写**以下领域：叙事、情绪调节、审批/权限、messenger。它产出的只有
  insights/血缘/关切状态/建议记录。
- prompt 里的原料是她自己的经验内容——含感知与对话，**不含任何 secrets**（检索层
  已保证不触 secrets；prompt 组装时不额外读任何 state 文件）。

## forbidden

- 不改 integrator 的层 1 行为、不动叙事/连续性门/情绪、不改 `INTEGRATION_EVERY_WAKES`
- 不改任何现有表结构、不动触发器（血缘/影子状态一律新表，照 L1/L2 的影子表先例）
- 不接 messenger / 不实现 L5 建议队列的发问；不接 bandit（§4.2 降级留位）
- 不新增依赖；新增状态文件必须进 `tests/conftest.py` 隔离清单
- 不 push；提交留在 `wo/l4`；不跑全量 pytest

## manifest 纪律

触及 `mind/` → 照 L1/L2/L3 的做法自算重签（当前 **104** 条，新增 `focus.py` 应为
**105**），报告给出 diff 与条目数。`pytest tests/test_p0_integrity.py` 报数
（活体 main 的 manifest 已入 git，本分支上 p0 应**满绿**——若有失败都要查明说清）。

## success_criteria（合成 fixture + mock LLM 照 integrator 既有测试模式）

1. **周期端到端**：有关切+有原料 → 一次 mock LLM 调用 → insight 落库 + 血缘行
   齐全（product→cycle→每条原料）+ 关切状态更新；无关切 → 空转事件，零调用。
2. **选择策略**：owner_directed 压倒高 lit_count；冷却中被跳过；M=3 的 user_001
   硬规则触发；同分确定性。
3. **血缘可回溯**：任取一条 insight，能沿血缘表走到具体 experience id 集合。
4. **修订/撤回**：构造冲突 → contested → 再冲突 → 修订且历史保留；影子期 S=2
   未 contested 自动转正。
5. **反刍防护**：连续 3 次无进展 → 冷却 5 周期（期间选择策略跳过它）→ 累计超限
   → 建议释放记录存在且 `release_concern` 未被调用。
6. **配额**：mock LLM 抛错 → 当晚不重试、周期记为失败、明晚可再跑；每周期恰好
   ≤1 次调用（计数钉死）。
7. **行为不变**：文末必跑清单全绿（层 1、检索、分类、审批环全部照旧）。
8. **零 schema 破坏**：现有表 `sqlite_master` 前后一致；新表全部可 downgrade 删除
   （逆迁移测试）。

## required_evidence

git log/diff --stat；周期骨架与选择策略完整代码；血缘表 DDL；LLM prompt 模板原文；
每条 success_criteria 的用例名+结果；manifest diff 与条目数；必答硬数字。

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
