# WO-L1 · 档案/原料分离 + 分流判据 + 历史回填

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1`（分支 `wo/l1`，基于活体 main `89d0247f`，
worktree 与 `.venv` 已备好）实现。
设计基准：`~/learning_layer_v2_design_2026-08-10.md`（§3.1 档案层、§3.2 分流判据、§5 迁移）。

## 报告纪律（先读）

- 你的 **stdout 就是报告本体**，不要把报告写成文件。**禁止用摘要代替明细，宁长勿略。**
- 流程里不许有"等待"步骤；任何测试命令都用 `timeout 300` 包裹；
  **代码写完先 `git commit`，再跑测试**（测试后有修改就再 commit）。
- 只跑本单专项测试与 `pytest tests/test_p0_integrity.py`，**不要跑全量 pytest**（复核方统一跑）。
- 用 `.venv/bin/python` / `.venv/bin/pytest`（已装好）。

## goal

1. 分类判据实现（纯函数，可单测）：
   `classify(source, content) -> 'working' | 'archive'`
   - `'working'`（进原料池）：`source in ('conversation','environment')`
     或 `source='action_result'` 且 `len(content) > 80`
   - `'archive'`：其余全部（`wake_action` / `action_result` 空壳 / `thought_lapse` / `silence`）
   - 阈值 80 定义为具名常量并注释来源（实测 action_result 97% ≤80 字符，均长 29）
   - 判据必须只依赖 source 与 content，不依赖外部状态（保证回填与实时判定一致）

2. 分类存储：新增影子表（照 P2-01 `memory_scopes` 的做法，不改 `experiences` 表结构、
   不动 append-only 触发器）：
   `experience_class(experience_id PK, class TEXT CHECK(class IN ('working','archive')),
                    classified_at TEXT, rule_version INTEGER)`
   带 `rule_version`，便于将来判据升级时重新分类。

3. 历史回填：以脚本/迁移形式交付，对全部历史经验回填分类。批量事务、可重入
   （重复执行不产生重复行、不改变已有分类）。
   **本单内只在合成 fixture 上验证，不接触真实 memory.db 或任何真实备份**；
   活体回填由复核方以 lykoi 身份另行执行（活体预期：working 1337 / archive 3531，合计 4868，
   此数字供复核核对，本单不验）。

4. 实时分类：新经验写入时同步分类（找到 `experiences` 的唯一写入点并接上，
   先读代码确认写入点，不要假设）。

5. 查询辅助：`working_set_pending(limit, by_salience)` 与 `archive_search(...)` 两个
   只读辅助函数，供 L2/L3 使用。**本单不修改 integrator、不改变任何消化行为。**

6. 逆迁移：downgrade 删除影子表即回到现状。

## forbidden

- 不改 `experiences` 表结构、不动触发器、不删任何记录
- 不改 integrator / `pending_experiences` 的现有行为（那是 L2）
- 不新增依赖；不 push；提交留在 `wo/l1`
- 不要跑全量 pytest（复核方统一跑）；完成后立即 `git commit`

## manifest 纪律

触及 `mind/` 或 `memory/` → `python3 guardian/startup_verify.py --write-manifest` 重签，
报告给出 diff，跑 `pytest tests/test_p0_integrity.py` 报数
（claude 身份下有 1 个既有假失败 `PermissionError: approval_rules.json`，如实报告）。

## success_criteria（用合成 fixture，禁止使用真实备份）

1. 判据单测：六类 source × 长短内容的边界用例全覆盖，含 80 字符边界。
2. 回填：可重入（跑两次结果一致）；分类总数 = 经验总数。
3. 实时分类：新写入的经验立即有分类行。
4. 逆迁移后表清单与迁移前一致。
5. **行为不变证明**：integrator 与 `pending_experiences` 的现有测试全部照常通过
   （本单不该影响它们）。

## required_evidence

git log/diff --stat；判据函数完整代码；影子表 DDL；回填的实际命令与输出；
每条 success_criteria 的测试用例名+结果；manifest diff；
必答硬数字（新增/修改文件数与行数、专项测试通过数、p0 通过数、manifest 条目数）。
