# WO-L1 复核 · PASS（带一个复核修复）· 2026-08-10

- **复核人**：治理平面 L1 窗口 Agent（Mac Claude Code, Fable 5）
- **对象**：`wo/l1` 分支，基于活体 main `89d0247f`，执行 Agent opus 一把过（attempt=1）
- **最终提交**：`cdd21dd0`（含复核修复；执行 Agent 交付到 `df3119f9`）
- **结论**：**PASS**。代码可合并。活体回填方案见 §五。

---

## 一、独立验证过的事实（不是转抄报告）

| 项 | 复核方法 | 结果 |
|---|---|---|
| 专项测试 | 执行 Agent 报 45/45 | 复核方全量跑中包含，通过 ✓ |
| **全量 pytest** | 复核方在 `.venv` 下跑（执行 Agent 权限受限没跑成的 `test_perception_ingest.py` 含在内） | **1520 passed / 19 failed / 6 skipped**（27min24s）；19 个失败逐一定性，见 §二 |
| manifest | **97 条全量重算**（sha256sum 逐条比对） | 96 吻合 / 0 不匹配 / 1 读不到（`approval_rules.json`，已知伪影，本单未触及）✓ |
| 三条实质 hash 变化 | 手算 vs manifest | `experience_class.py`（新增）、`migrations.py`、`store.py` 逐一吻合 ✓；4 条 `memory/*` 仅排序归位，hash 未变 ✓ |
| 写入点覆盖 | `grep -c "INSERT INTO experiences" store.py` | 3 处，3 处全接线 ✓（工单原文写"唯一写入点"，实际 3 个——执行 Agent 读代码后如实纠正并加了结构性守卫测试） |
| 未 push | `git branch -r --contains wo/l1` | 空 ✓ |
| 合成回填 | 演示脚本输出 | 4868 → working 1337 / archive 3531，跑两次一致 ✓（fixture 按设计分布合成，只证算术一致，活体核对另行做——执行 Agent 自己也如实声明了这一点） |
| P2 测试改动 | 逐行读 diff | 版本钉桩改为对迁移链表述，合规；V10 专属断言（七表、种子、回填计数）未动 ✓；顺带修出"只回滚 v10 会被 `MAX(version)=11` 挡住重放"的真陷阱 |

## 二、19 个全量失败的定性（全部闭合）

- **1 个真回归，已由复核方修复**：
  `test_core_v1_event_outbox.py::test_v9_migration_does_not_backfill_existing_v8_environment_receipts`
  ——基线过、`wo/l1` 败。机制：该测试用 `MIGRATIONS[:-1]` 冻结"链尾减一"模拟旧 schema
  写入，但用的是链尾代码；L1 的实时分类钩子硬依赖链尾表 `experience_class`，在 v10 库上
  `no such table`。**修复（`cdd21dd0`）**：冻结上下文里如实拿掉钩子（旧时代写入本来出自
  没有钩子的旧代码），并新增断言：升级后 `_V11` 回填必须覆盖这条中途历史行。修后该文件
  27/27 过。
  - 注：钩子硬失败是**正确姿态**——静默容错会造出"经验在、分类不在"的中间态并掩盖真实的
    迁移缺失。不改产品代码。
- **18 个基线复现（逐一在 `89d0247f` 上重跑核实，非推断）**：
  realtime 扫描 ×4（`confab`/`gate5`×2/`telemetry`，违规行全在 `src/lykoi/broker/`，
  P2-03A 合并时带进 main 的既有债）；m3 控制器族 + deepseek ×11（claude 身份读不到
  root 封印控制器的环境伪影）；`core_v1_shadow` ×2（同类）；p0 manifest ×1（已知伪影）。

## 三、遗留问题（不阻塞本单，应记账）

1. **main 的 realtime 扫描债**：`broker/audit.py:19`（`datetime.now`）、`tickets.py:40`
   （`time.time`）等使 4 个扫描测试在 main 上红。应开小单补 `# realtime-allow:` 标记或改走
   `shared/clock`。
2. **outbox 测试的语义漂移**（早于 L1，P2-01 加 v10 时发生）：`MIGRATIONS[:-1]` 冻结点随
   链长漂移，"v8 时代收据不被 v9 回填"的原始命题已名存实亡。复核修复保住了测试的现行价值
   （升级链不动收据/不补 outbox + v11 回填覆盖中途行），完整还原 v8 语义需另开测试整备单。
3. `backfill_experience_class.py --dry-run` 在无 `experiences` 表的库上会裸崩——活体不存在
   此场景，不改。

## 四、验收要点对照（交接 §五）

1. 分类数字：合成域吻合（1337/3531/4868）；活体核对随回填做（见 §五，注意活体数字会因
   持续写入而**大于**快照值，验收判据改为"自洽等式 + 快照下界"）。
2. 行为零变化：integrator 36 + store 18 + migrations 8 + p2 16 全过 ✓；
   `pending_experiences` 语义有专测钉住未变 ✓。
3. 不改表结构/触发器：有逐字节比对测试 ✓。
4. 可重入：迁移重放与直接再调两路都测了 ✓。
5. 逆迁移：v11→v10 倒序回滚后 `sqlite_master` 全集相等 ✓。
6. manifest 重签 + p0：97 条，20 passed + 1 已知伪影 ✓。

## 五、活体执行方案（给 Kevin，root 手）

L1 回填与 v10 迁移**并一个停机窗口**（回填载体 `apply_migrations` 本就应用整条链
v10+v11；分开做反而多停一次）：

1. 合并 `wo/l1` → 活体 main（root，`--write-manifest` 重签，同 P2-01 流程）。
   S2 lane 尚未合并——L1 先合，**S2 合并时须重签 manifest**（已在 handoff.md 记录）。
2. 照 `wo/WO-P2-MIGRATE/procedure.md` 原步骤执行（备份 → 停 autonomy → 迁移 → 起服务），
   仅期望输出改为：`applied = 2 | after version = 11`，并追加 L1 验收查询：

   ```sql
   SELECT
     (SELECT COUNT(*) FROM experiences
       WHERE source IN ('conversation','environment')
          OR (source='action_result' AND LENGTH(content)>80))  AS expect_working,
     (SELECT COUNT(*) FROM experience_class WHERE class='working') AS got_working,
     (SELECT COUNT(*) FROM experiences)        AS experiences,
     (SELECT COUNT(*) FROM experience_class)   AS classified;
   ```

   判据：`expect_working == got_working`、`experiences == classified`、
   `got_working ≥ 1337`、`classified ≥ 4868`（快照下界；活体在长大，等号只在她这段时间
   零新经验时成立）。
3. 迁移用 procedure 的内联 python（`PRAGMA foreign_keys=ON`，与备份验证时行为一致）；
   `scripts/backfill_experience_class.py` 迁移后再跑一次作**审计回执**（应报
   `migrations_applied=0` + 全量计数）。
