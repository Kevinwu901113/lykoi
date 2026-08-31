# WO-L3 · 跨时间相关性检索（实体 + 关键词，接口可替换）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l3`，基于 `wo/l1` @ `cdd21dd0`，
worktree 与 `.venv` 已备好）实现。
设计基准：`~/learning_layer_v2_design_2026-08-10.md` **§3.6**（本单主体）、
§3.4（唯一消费方：层 2 专注思考的第 2 步）、§3.9（档案不遗忘，是"回想细节"的基础）。
前置已在本分支：WO-L1 的 `mind/experience_class.py`（working/archive 分流）与
`store.archive_search` / `store.working_set_pending`。

## 报告纪律（先读）

- 你的 **stdout 就是报告本体**，不要把报告写成文件。**禁止用摘要代替明细，宁长勿略。**
- 流程里不许有"等待"步骤；任何测试命令都用 `timeout 300` 包裹；
  **每完成一个里程碑（判据/检索/测试各算一个）立刻 `git commit`**，最后再整体自查。
- 只跑本单专项测试与 `pytest tests/test_p0_integrity.py`，**不要跑全量 pytest**（复核方统一跑）。
- 用 `.venv/bin/python` / `.venv/bin/pytest`（已装好）。

## 本单在整个重构里的位置（就一段）

层 2（L4，未来单）每晚要"挑一个关切 → **跨时间检索**相关原料 → 一次 LLM 调用推进它"。
本单只造第 2 步那台检索机器：给定一个关切，从她的全部经验里把相关的捞出来——
**不限于未消化项**，已消化的、几个月前的、档案里的都要能召回。这是档案层从
"垃圾桶"变成"可调用的记忆"的关键一步。本单**不建层 2 循环、不选关切、不调 LLM**。

## goal

1. **检索入口（一个函数，签名即接口契约）**：
   `retrieve_for_concern(concern: dict, *, limit=20, since=None, until=None) -> list[dict]`
   放 `src/lykoi/mind/` 下新模块（建议 `relevance.py`）。
   - 入参 `concern` 至少认 `title` / `description` / `subject_user_id`（可空）三个键，
     **不要求是 concerns 表的行**（层 2 也会用临时问题查询）；
   - 检索域 = **全部 experiences**（working + archive、integrated 0/1 都在内），
     按四个轴召回：
     - **关键词轴**：从 title/description 提取匹配项，对 `experiences.content` 匹配；
     - **实体轴**：`subject_user_id` 走 P2-01 `memory_scopes`（照 `archive_search` 的接法）；
     - **时间轴**：`since`/`until` 过滤；
     - **来源轴**：结果里带 `source`，不做硬过滤（层 2 自己决定要不要挑食）。
   - 返回按**相关性降序**，每条结果附 `match_reasons`（命中了哪些关键词/实体轴），
     让层 2 的结论能回溯"为什么调了这条原料"（§3.7 血缘的前置）。
     排序必须**确定性**（同分按 id 定序）。

2. **中文健壮的关键词匹配（本单的设计重心）**：她的经验内容几乎全是中文，
   **没有空格分词可用，也禁止新增分词依赖**（不许装 jieba 等任何包）。
   你要自己设计纯 stdlib 的提取与匹配方案（提示：字符 n-gram 重叠是一条被验证过的
   稳妥路线，但方案由你定），并在代码注释里写清楚：提取规则、为什么对中文成立、
   已知的召回盲区。英文/混排也要过得去（大小写不敏感）。
   LIKE 通配符照 `archive_search` 的做法转义。

3. **可替换性（升级到向量检索时不动调用方）**：`retrieve_for_concern` 的签名与返回
   结构就是接口；把"怎么算相关"收进模块内部私有函数，文档字符串里写明升级路径
   （§3.6：向量检索本版不做）。不要做成类继承体系——一个函数一个模块就够。

4. **只读**：全模块零写入。照 L1 `test_query_helpers_are_read_only` 的做法给出
   前后快照逐行相等的证明测试。

5. **零 schema**：**不新增表、不新增迁移、不新增索引**。原料池约千条量级，
   实体+关键词全扫足以召回（§3.6"为什么够用"）。如果你实现中认为必须建表/索引，
   **停下来在报告里说明理由**，不要自作主张建。

## forbidden

- 不改 integrator / `pending_experiences` / 任何消化行为（那是 L2）
- 不动 concerns 的生命周期逻辑、不实现关切选择策略（那是 L4，§3.5）
- 不新增表/迁移/索引；不新增依赖；不新增任何带默认绝对路径的状态文件
  （若确需状态文件即违规，停下来报告）
- 不 push；提交留在 `wo/l3`
- 不跑全量 pytest；每个里程碑立刻 `git commit`

## manifest 纪律

新增/修改 `mind/` 下 .py → 重签 `guardian/manifest.sha256`。claude 身份下
`--write-manifest` 会因 `approval_rules.json` 崩：照 WO-L1 的做法用
`startup_verify._protected_files()` / `._sha256()` 自身重算，唯一读不到的那条沿用旧行，
报告给出 diff 与条目数。跑 `pytest tests/test_p0_integrity.py` 报数
（claude 身份下有 1 个既有假失败 `PermissionError: approval_rules.json`，如实报告）。

## success_criteria（用合成 fixture，禁止使用真实备份）

1. **四轴召回**：关键词/实体/时间/组合过滤各有正反用例；检索域覆盖证明
   （working 与 archive、integrated 0 与 1 都能被召回——各至少一条用例钉死）。
2. **中文用例是主角**：中文关切标题命中中文内容、中文近词不误召、
   英文混排、LIKE 通配符字符（`%`/`_`）出现在关切标题里不炸不越权。
3. **排序**：相关性降序可解释（`match_reasons` 非空且真实）；同分确定性（跑两次同序）。
4. **只读证明**：调用前后 `experiences` / `experience_class` / `memory_scopes` /
   `concerns` 快照逐行相等。
5. **行为不变**：integrator 与 `pending_experiences` 现有测试照常通过（本单不该影响它们）。
6. **零 schema 证明**：迁移链版本不变（仍是 11），`sqlite_master` 前后一致。

## required_evidence

git log/diff --stat；检索模块完整代码；关键词提取规则的文字说明（含已知盲区）；
每条 success_criteria 的测试用例名+结果；manifest diff 与条目数；
必答硬数字（新增/修改文件数与行数、专项测试通过数、p0 通过数）。
