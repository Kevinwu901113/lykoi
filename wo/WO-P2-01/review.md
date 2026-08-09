# WO-P2-01 复核报告（主治理 Agent）· 2026-08-09

**结论：通过，建议合并。** 全部验收标准达成，且关键项经我独立验证（非采信自述），
包括工单明令禁止执行 Agent 做、留给复核方做的**真实数据迁移验证**。

- 分支 `wo/p2-01`，提交 `c308b792`（相对起点 `94be1f2e`，7 文件 +715 行）
- 建议合并方式：`git merge --ff-only`（不触及 guardian 目录本体，但**改了 manifest**，
  见下方部署注意）

---

## 一、独立验证项（我亲手跑的，非读报告）

### 1. 真实数据迁移验证（工单禁止 Agent 做的那项）

在 Mac 上用**真实备份副本**（`memory.20260809T032908Z.db`，12MB / 20 表 / v9）
直接加载它的 `migrations.py` 执行，结果：

| 检查 | 结果 |
|---|---|
| 迁移执行 | v9 → v10，新增 **7 张表**（users / identity_bindings / contexts / context_members / memory_scopes / procedures / note_insight_links） |
| **回填精确性** | 7 张源表**逐表行数完全一致**：experiences 4868、thoughts 1391、history 523、autonomy_notes 59、concerns 9、insights 6、narrative_threads 4 → memory_scopes **6860 行，分表合计相符** |
| 回填默认值 | 6860 行**全部**为 `user_001 / ctx_direct_user_001 / private / content`（符合设计"拿不准往严"） |
| 种子数据 | users=[user_001, owner_primary]、contexts=[ctx_direct_user_001, direct] ✓ |
| **幂等性** | 第二次执行 applied=0，memory_scopes 仍 6860（无重复行）✓ |
| **owner_primary 唯一约束** | 插入第二个 owner_primary 被拒（`UNIQUE constraint failed: users.role`）✓ |
| **逆迁移** | `downgrade_v10()` 后回到 v9 / 20 表，表清单与迁移前**逐一相同** ✓ |
| 完整性 | `integrity_check=ok`，`foreign_key_check` **0 违规** ✓ |

### 2. 专项测试自跑

`tests/test_p2_data_model_migration.py` → **16 passed**（580s，因与其全量测试抢磁盘 I/O）。

### 3. 它"14 个失败均与本改动无关"的说法核对

- **权限位类失败（10 个）属实**：实测工作副本 `scripts/patches/**/root_apply.sh` 为 `0o775`，
  测试期望 `0o755`（活体上确为 755）——是 git checkout 的 umask 产物，与本 WO 未接触的
  文件相关。**环境伪影，非回归。**
- **p0 那 1 个失败已由我先前独立确认**：`PermissionError: /home/lykoi/state/approval_rules.json`
  ——claude 身份读不到 0600 活体文件的伪影；活体以 lykoi 身份跑为 25 passed（见教训 27）。
- **shadow 2 个超时**：属沙箱调度抖动的既有失败（该模块本 WO 未触碰）。

### 4. 它修改两个既有测试的正当性核对（防"改测试掩盖失败"）

`test_v9_migration_does_not_backfill...` 与 `test_d18_migration_runner_accepts_a_v9_database`
把硬编码 `applied_version(conn) == 9` 改为 `== migrations.SCHEMA_VERSION`。
**判定为正当**：这两个断言测的是"库已迁到当时的 schema 尖端"，尖端本就随版本前进而移动；
测试的真实语义由紧随其后的 `apply_migrations(conn) == 0`（冻结版模块面对更新的库不动手）
承载，未被削弱。改动附有清楚注释。**不是掩盖。**

## 二、设计符合性

- 设计 v1 §2.1–2.5 的 7 张表 + percept_buffer 独立库全部落地，DDL 含 CHECK/UNIQUE/外键。
- **现有表零改动**（它用 `PRAGMA table_info` 逐列比对写了锁死测试）——影子表方案的意义保住。
- append-only 触发器未动。
- **percept_buffer.db 为独立文件**（符合 §2.3 决议：整库轮转的生命周期与长期记忆不同）。
- 版本机制扩展最小化：migration 元组元素从"仅 SQL 字符串"扩为"字符串或 callable"，
  向后兼容，仅 `_V10` 用了一个回调做回填（纯 SQL 表达不了"表是否存在"的条件判断）。

## 三、manifest 纪律

已重签：`migrations.py` 哈希更新 + `percept_buffer.py` 新增条目（共 2 条）。
**它主动做了这件事**——这是历史上让三服务全停过两次的坑，本单没踩。

## 四、部署注意（给 Kevin）

1. 本单**改了 `guardian/manifest.sha256`**，但未改 guardian 目录下的 .py。合并后
   须以 **lykoi 身份**跑 `guardian/startup_verify.py` 与 `pytest tests/test_p0_integrity.py`
   确认（root 身份跑会有 os.access 假阳性，教训 8）。
2. **迁移本身不随合并自动执行**——代码合并只是让 v10 可用；对活体 memory.db 执行迁移
   是独立动作，需要停 autonomy 的窗口（设计 v1 §6 决议 5：约 10–30 分钟，interactive 不停）。
   **建议：先合并代码，迁移窗口另约。**
3. 回滚：`downgrade_v10()` 已验证可回到 v9 且表清单一致；代码回滚 `git revert c308b792`。

## 五、遗留

- 全量测试里那 10 个权限位失败是**长期存在的环境噪音**，每次全量跑都会中招，
  建议后续单独出一个小工单让测试对 `0o755/0o775` 都宽容（不属本单范围）。
