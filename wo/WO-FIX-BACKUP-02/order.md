# WO-FIX-BACKUP-02：扩大每日备份覆盖面

你是 Lykoi 治理平面的执行 Agent。本工单允许修改代码，**仅限指定文件、仅在工单分支**，**不得合并**。

## 背景（WO-BASE-05 结论）

当前 `scripts/offsite_backup.sh` 只快照两个文件：`memory.db` 与 `salience_shadow.db`。身份连续性资产清点发现以下资产**完全不在任何备份内**，其中多项属"不可再生"：

| 资产 | 位置 | 性质 |
| --- | --- | --- |
| **基础人格** | `/home/lykoi/runtime/persona/lykoi_base.toml` | 不在备份、不在 git（仓库只有测试 fixture）——最高优先级 |
| 核心事实库 | `/home/lykoi/state/core_facts.db` | 不可再生 |
| 事件日志 | `/home/lykoi/state/events.jsonl` | 不可再生 |
| 审计记录 | `/home/lykoi/state/audit.jsonl`（及 `/var/log/lykoi-audit` 正本） | 不可再生 |
| 权限证据 | `/home/lykoi/state/permission_evidence_shadow.db` | 不可再生 |
| 审批规则与待办 | `approval_rules.json`、`pending_actions.json` | 可重建但代价高 |
| 核心工件 | `/home/lykoi/state/core_artifacts/` | 视内容而定 |
| 治理开关 | `/home/lykoi/runtime/governance/*.on` | root 属主，记录当前启用态 |

## 目标

修改 `scripts/offsite_backup.sh`，在保留 WO-FIX-BACKUP-01 已有机制（锁重试、失败清残骸、offsite 预检、7 份滚动、daily.log）的前提下扩大覆盖：

1. **SQLite 类**（走现有 `_backup_db` 重试函数）：新增 `core_facts.db`、`permission_evidence_shadow.db`。
2. **文件/目录类**（新增一个 `_backup_file` 辅助函数）：`events.jsonl`、`audit.jsonl`、`approval_rules.json`、`pending_actions.json`、`core_artifacts/`（目录用 tar.gz）、`runtime/persona/lykoi_base.toml`。
   - persona TOML 是 `root:lykoi` 0640——**只读复制即可，不要尝试改它的权限或属主**。
   - 治理开关 `runtime/governance/*.on` 是 root 0600/0644，**读不到的不要强行读**：改为记录其**存在性与文件名清单**到一个 `governance_flags.txt` 快照（`ls -la` 输出即可），读不到内容属预期。
   - `/var/log/lykoi-audit` 若无读权限，同样只记录存在性，不要 sudo。
3. **保留策略**：新增项与现有一致，各留 7 份；清理逻辑要覆盖新增的扩展名（`.tar.gz`、`.jsonl.gz`、`.toml`、`.txt`）。
4. **失败隔离**：任一项失败不阻断其余项（沿用 `|| true` + FAILED 日志模式）。
5. **体积注意**：`events.jsonl` 约 6MB、`core_facts.db` 约 5.6MB，均需 gzip。总量应控制在每日新增 10MB 量级以内，7 份滚动即约 70MB——若你判断某项体积不合理，在报告中说明并给替代方案（如仅备份增量或降低频率），不要自行改变频率。

## 流程与纪律

- 从当前分支状态出发，新建分支 `task/wo-fix-backup-02`，提交前缀 `[WO-FIX-BACKUP-02]`。
- 禁区：`/home/lykoi/secrets`（不读）、`core.sock`、任何 systemd/进程操作、任何对 `/home/lykoi/state` 的写入（例外：为验证可运行一次脚本，其对 `state/backups/` 的设计内写入被许可）。
- 不得合并到 main。

## 验证要求（证据写进报告）

**注意：你（claude 账户）读不到 `/home/lykoi/state` 下的文件（0600 属主 lykoi），因此无法实跑本脚本——这是预期的，不要尝试绕过，也不要用 sudo。** 实跑验证由主治理 Agent 以 `lykoi` 身份执行。

你需要交付：

1. `bash -n` 语法检查通过（这个你能做）。
2. **逐项预期行为说明**：新增的每一项，说明产出文件名格式、压缩方式、失败时的降级路径。
3. 展示 `git diff` 全文。
4. 基于源码中已知的文件体积（events.jsonl ≈6MB、core_facts.db ≈5.6MB 等）估算"单次备份新增体积"与"7 份滚动稳态占用"。
5. **自检清单**：列出你认为主治理 Agent 实跑时应该重点观察的 3-5 个点（例如某项降级是否生效、清理逻辑会不会误删）。

## 输出要求（严格遵守）

**不要写报告文件；你的 stdout 会被逐字存档为 report.md。**第一行为 `# WO-FIX-BACKUP-02 执行报告`。禁止对话性语句。包含：改动说明、完整 diff、验证证据（命令+输出）、体积估算、未尽事项。
