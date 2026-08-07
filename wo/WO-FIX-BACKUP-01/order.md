# WO-FIX-BACKUP-01：修复每日备份脚本（Kevin 2026-08-07 批准，预授权合并）

你是 Lykoi 治理平面的执行 Agent。本工单允许修改代码，但**仅限指定文件、仅在工单分支**。

## 背景（已确诊）

`scripts/offsite_backup.sh`（每日 04:17 cron）存在三个缺陷：
1. `sqlite3 .backup` 遇 `database is locked` 即因 `set -e` 中止：留 0 字节 `.db` 残骸、当日 memory 与 salience 均无备份、无告警（实际失败日：7/28、8/1、8/6）。
2. rsync 目标 `192.168.0.101`（所有者笔记本，凌晨通常不在线）不可达时输出报错栈；应预检后静默跳过并记一行日志。
3. 清理逻辑只匹配 `*.db.gz`，0 字节 `.db` 残骸永久堆积。

## 目标

修改 `scripts/offsite_backup.sh`（如需辅助文件可加，但优先单文件方案）：

1. **锁重试**：`sqlite3` 加 busy timeout（`-cmd ".timeout 30000"`），失败后最多重试 3 次、间隔 20 秒；memory 与 salience 各自独立重试，一个失败不阻断另一个。
2. **失败处理**：最终失败时删除 0 字节残骸文件，日志写明确的 `FAILED` 行；若仓库存在受支持的通知入口（检查 scripts/ 下通知相关脚本或 kernel 通知队列的官方写入方式），用它发一条"备份失败"通知；若无安全入口，在 `state/backups/daily/LAST_FAILURE` 写入时间戳与原因作为标记（不得直接手写 kernel 的 JSON 队列文件）。
3. **offsite 预检**：git push 与 rsync 前分别做可达性预检（如 `ssh -o ConnectTimeout=5` / `timeout 10 git ls-remote`），不可达则输出一行 `offsite skipped: <原因>` 后跳过，不报错栈。
4. **残骸清理**：每次运行时删除 daily/ 下 0 字节 `.db` 文件（含历史遗留）。
5. 保持现有行为不变的部分：快照命名、gzip、七份滚动保留、日志追加到既有 log。

## 流程与纪律

- 从 main 新建分支 `task/wo-fix-backup-01`，在分支上提交，提交注释前缀 `[WO-FIX-BACKUP-01]`。
- **不得**触碰 `~/state`（例外：为验证可运行一次 `scripts/offsite_backup.sh`，其对 `state/backups/` 的设计内写入是本工单唯一被许可的 state 写入）、`~/secrets`（脚本 source backup.env 的行为保留但你不得读取该文件内容）、`core.sock`、任何 systemd/进程操作。
- 不得合并到 main（合并由主治理 Agent 复核后执行）。

## 验证要求（证据写入报告）

1. `bash -n` 语法检查通过。
2. 实际运行一次修改后的脚本，展示：本次快照成功产出（列出新文件与大小）、offsite 预检跳过的日志行、历史 0 字节残骸被清理。
3. 展示完整 `git diff main...task/wo-fix-backup-01`。

## 输出要求

**你的 stdout 会被逐字存档为 report.md——它就是报告本体，不是聊天回复。**第一行为 `# WO-FIX-BACKUP-01 执行报告`。包含：改动说明、完整 diff、验证证据（命令+输出）、未尽事项。禁止对话式语句。
