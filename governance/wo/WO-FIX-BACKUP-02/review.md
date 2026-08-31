# WO-FIX-BACKUP-02 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07
- **执行 Agent**：服务器 claude 账户，模型 sonnet（按 Kevin 定的"动手用 sonnet"）
- **结论**：**验收通过**（含一轮补正）；分支已导入活体仓库，**合并待 Kevin 执行**

## 一、复核中发现的交付缺陷（已补正）

初版把 `/var/log/lykoi-audit/audit.jsonl` 降级为"仅记录存在性"，理由是无读权限。**实测证伪**：该文件是 `-rw-rw---- root:lykoi`、目录 `drwxr-x--- root:lykoi`，而脚本以 lykoi 身份运行、属于 lykoi 组，**可以直接读**。

后果如不补正：审计记录看似纳入备份，实际备下的是 `state/audit.jsonl`——那个文件**自 6/5 起就是 0 字节**（正本从不写这里）。等于审计资产仍然零备份，且日志显示 "audit snapshot ok" 会给人已覆盖的错觉。

已下补正工单，执行 Agent 修正为：可读则真备份（`audit_log.*.jsonl.gz`），读失败才降级；`_backup_existence_snapshot` 能力保留给治理开关（那些是 root 0400/0600，确实读不到，降级正确）。

**这条是"自报完成不算完成"的又一个实例**：功能跑通、日志全绿，但备份对象错了。

## 二、实跑验证（主治理 Agent 以 lykoi 身份执行，两轮）

第二轮 12 项全部 ok，落盘实况：

| 资产 | 产出 | 大小 |
| --- | --- | --- |
| memory.db | `.db.gz` | 2.33 MB |
| core_facts.db | `.db.gz` | 1.11 MB |
| events.jsonl | `.jsonl.gz` | 699 KB |
| **audit_log（/var/log 正本）** | `.jsonl.gz` | **110 KB / 1500 行** ✓ 补正生效 |
| core_artifacts/ | `.tar.gz` | 104 KB |
| salience_shadow.db | `.db.gz` | 69 KB |
| **lykoi_base_persona.toml** | `.toml` | **2761 B** ✓ 内容校验通过（首行 "Lykoi persona kernel"） |
| permission_evidence_shadow.db | `.db.gz` | 1.9 KB |
| pending_actions / approval_rules | `.json.gz` | 730 B / 187 B |
| audit.jsonl（state，0 字节正常） | `.jsonl.gz` | 49 B |
| governance_flags | `.txt` 存在性快照 | 307 B ✓ 未 sudo、未强读 |
| audit_log_source | `.txt` 存在性快照 | 230 B |

- 单次约 4.3 MB，7 份滚动稳态约 30 MB；当前 daily/ 共 18 MB。
- 降级路径验证：治理开关（root 0400/0600）如期只记清单不读内容，脚本未尝试 sudo。
- 失败隔离、7 份滚动、残骸清理（扩展名已覆盖新增类型）均在。
- 语法检查 `bash -n` 通过（补正后再验一次）。

## 三、部署状态

- 分支 `task/wo-fix-backup-02`（2 个提交：主体 + 补正）已从治理工作副本经 bundle 导入活体仓库 `~/projects/lykoi`，**未合并**。
- 活体仓库当前仍在 `task/wo-fix-backup-01`。cron 按路径执行 `scripts/offsite_backup.sh`，因此**合并后才会生效**。
- 合并命令（Kevin 执行）：

      ssh lapw1ng.com 'cd ~/projects/lykoi && git checkout main && git merge --no-ff task/wo-fix-backup-01 task/wo-fix-backup-02 -m "[WO-FIX-BACKUP-01/02] merge: backup hardening + coverage expansion"'

## 四、注记（不阻塞，留后续）

1. `cp` 复制 `events.jsonl` / `audit.jsonl` 时源文件可能正被追加，末行可能截断。对 append-only 日志影响可接受，若要严格一致可改为 `tail -c` 定长快照或先 `fsync`。
2. `/home/claude` 是 0750，lykoi 读不到治理工作副本——跨账户交付目前靠 `/tmp` bundle 中转。GitHub 部署密钥装上后可改走 GitHub，更干净。
3. 每日新增约 4.3 MB 中 events.jsonl 占比会随时间增长，建议未来加轮转或只备份增量。
