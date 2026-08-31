# WO-FIX-RESTORE-01：恢复脚本与运行手册

你是 Lykoi 治理平面的执行 Agent。本工单允许**新建文件**，仅在工单分支，不得合并。

## 背景

白皮书第 30.2 节风险 C3："缺少完整恢复脚本、缺少灾难恢复演练"。演练部分已由主治理 Agent 于 2026-08-07 完成（结果见下），本工单补齐**可重复执行的恢复工具与手册**。

演练已验证的事实（作为你实现的依据）：

- 备份集位于 `/home/lykoi/state/backups/daily/`，同一时间戳 `<STAMP>` 一组，共 12 项：
  - SQLite（gz）：`memory` / `core_facts` / `salience_shadow` / `permission_evidence_shadow`
  - JSONL（gz）：`events` / `audit`（state 那份恒为 0 字节）/ `audit_log`（/var/log 正本）
  - JSON（gz）：`approval_rules` / `pending_actions`
  - 目录：`core_artifacts`（tar.gz）
  - 原样文件：`lykoi_base_persona`（.toml）
  - 存在性快照：`governance_flags`（.txt）
- 四个 SQLite 全部通过 `PRAGMA integrity_check`；memory.db 20 张表；行数与活体一致（差值仅来自快照后继续运行）。
- 应用代码可直接读还原库：`LYKOI_MEMORY_DB=<还原库> PYTHONPATH=src .venv/bin/python` 调 `lykoi.memory.store.get_insights` 与 `persona.build_persona_prompt()` 成功（返回 226 字符人格提示词）。
- Mac 侧异地副本与服务器逐字节一致（sha256 比对通过）。

## 交付物

### 1. `scripts/restore_drill.sh`（可重复执行的演练脚本，只读安全）

- 参数：`[STAMP]`，省略则取最新一组。
- 行为：把该组备份解到**隔离目录**（默认 `/tmp/lykoi-restore-<STAMP>`，可用 `-d` 指定），然后逐项校验并输出结论：
  1. 每个 SQLite 的 `PRAGMA integrity_check`
  2. memory.db 表数量 + 关键表行数（`history` / `insights` / `autonomy_notes` / `autonomy_runs` / `autonomy_state` / `health_metrics`），并与活体同表行数对比（**只取 COUNT，禁止 SELECT 任何内容行**）
  3. persona TOML 与 `/home/lykoi/runtime/persona/lykoi_base.toml` 的 `diff -q`
  4. 功能性测试：用 venv python 打开还原库调 `build_persona_prompt()`，报告字符数
  5. 备份集完整性：12 项是否齐全，缺项列出
- **绝对禁止**：任何对 `/home/lykoi/state`（备份目录之外）、`/home/lykoi/runtime`、活体数据库的写操作；不得 `systemctl`；不得 sudo。脚本必须是纯读 + 只写隔离目录。
- 退出码：全部通过 0；有校验失败 1；备份集不完整 2。
- 输出人类可读的结论表，末行给总判定。

### 2. `docs/runbook_disaster_recovery.md`（灾难恢复运行手册）

面向"服务器没了，要用备份把她重建起来"的场景，按真实操作顺序写：

1. **前置**：拿到哪份备份（服务器 daily/ 或 Mac `~/lykoi/backups/server-state/daily/`）、需要什么依赖（sqlite3、python venv、系统包）。
2. **恢复顺序与落点**：每一项还原到哪个路径、权限应该是什么。特别注明：
   - `lykoi_base_persona.toml` → `/home/lykoi/runtime/persona/lykoi_base.toml`，属主 `root:lykoi` 0640（需 root 手动设置）
   - `audit_log.jsonl` → `/var/log/lykoi-audit/audit.jsonl`，`root:lykoi` 0660
   - `governance_flags.txt` **不是可还原资产**，只是记录当时启用了哪些开关，需人工按它重建 `/home/lykoi/runtime/governance/*.on`（root 属主）
3. **无法从备份恢复的部分**（必须显式列出，这是手册最重要的一节）：`/home/lykoi/secrets/*`（密钥，需重新签发）、`/etc/systemd/system/lykoi-*.service` 与 drop-in（部署配置）、`/var/lib/lykoi-attention-policy/`（注意力策略 + SHA256）、`/etc/lykoi-core-v1-m2/*.env`。对每项说明重建来源。
4. **验证清单**：恢复后如何确认成功（跑 `restore_drill.sh`、启动顺序、健康检查端点、看哪些日志）。
5. **已知限制**：7 份滚动 = 最多回溯 7 天；`cp` 快照的 JSONL 末行可能截断。

## 流程与纪律

- 从 main 新建分支 `task/wo-fix-restore-01`，提交前缀 `[WO-FIX-RESTORE-01]`。
- 你（claude 账户）读不到 `/home/lykoi/state` 下的活体文件与部分备份（0600/0660），因此**无法实跑脚本**——这是预期的，不要绕过、不要 sudo。实跑验证由主治理 Agent 以 lykoi 身份执行。
- 你能做的验证：`bash -n` 语法检查、逻辑走查。
- 不得合并到 main。

## 输出要求（严格遵守）

**不要写报告文件；stdout 即报告。**第一行 `# WO-FIX-RESTORE-01 执行报告`。禁止对话性语句。包含：两个交付物的完整内容或 diff、`bash -n` 结果、你认为主治理 Agent 实跑时应重点观察的 3-5 个点。
