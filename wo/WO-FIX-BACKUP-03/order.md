# WO-FIX-BACKUP-03：非密钥部署配置恢复包

- **状态**：主治理 Agent 直接实现并完成候选复核（不使用 Opus/Sonnet/执行 Agent）；待 owner 部署
- **生产基线**：`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`
- **日期**：2026-08-09

## 目标

关闭“数据可恢复但新机器无法重建部署形态”的缺口：在现有每日备份中新增一个明确排除 secrets 的 `deployment_config.<STAMP>.tar.gz`，并由恢复演练验证其完整性。该包是 `WO-DRILL-REBUILD-01` 的前置门。

## 允许范围

- 新增 stdlib-only 导出器 `scripts/export_rebuild_config.py`。
- 修改 `scripts/offsite_backup.sh`，每日生成/轮转配置恢复包。
- 修改 `scripts/restore_drill.sh`，把配置恢复包列为第 13 项并校验安全路径、必需文件与内部哈希。
- 更新 `docs/runbook_disaster_recovery.md`。
- 新增相关测试。

## 配置恢复包内容

只允许下列非密钥资产：

- `/etc/systemd/system/lykoi-*.service` 与对应 drop-in `*.conf`；
- `/etc/lykoi-core-v1-m2/*.env`（当前只含 Core 路径、开关和配额参数）；
- `/var/lib/lykoi-attention-policy/*`；
- `/etc/os-release`；
- 生成式元数据：`lykoi` 用户/组事实、已知 cron 任务的脱敏 schedule、`lykoi-*` unit 启用状态、已安装包清单、root-only apply controller 的文件名/权限/大小清单、代码 HEAD、逐文件权限和 SHA-256 manifest。offsite push 在导出前完成，但不归档可能携带凭证的 remote URL。

## 禁止

- 严禁读取、归档或列出 `/home/lykoi/secrets/*` 内容；恢复包的 archive member path 不得位于 `secrets/`。unit 可以保留 `EnvironmentFile=` 的密钥路径引用，元数据可以列出需带外重签的三份文件名，但都不得包含值。
- 不归档活体 state、memory、persona、audit 内容（它们继续由原 12 项负责）。
- 不直接解包到 `/`；恢复演练只能解到 `/tmp` 并验证。
- 不修改 systemd、cron、运行中服务、生产 checkout 或活体备份目录。
- 不使用 sudo/root 绕过读取限制；`/usr/local/sbin` 的 root-only apply controller 只记录元数据，不读取正文。

## 验收条件

1. 导出器拒绝 symlink/非普通文件，归档路径无绝对路径和 `..`，临时文件原子替换，失败不留残骸。
2. 包含 9 个 unit、当前全部 drop-in、两份 M2 env、attention policy、OS 与恢复元数据；内部 manifest 的哈希和权限事实可验证。
3. archive member path 中没有 `secrets/`，配置/元数据不含任何 secret 值；raw crontab、Git remote URL 与子命令 stderr 不入包。
4. `offsite_backup.sh` 只在导出成功后发布最终 `.tar.gz`，保留 7 份，失败清残骸并写日志。
5. `restore_drill.sh` 对 13/13 完整集 PASS；缺配置包 exit 2，路径穿越/哈希不符 exit 1。
6. 新增测试、现有备份/恢复/P0 相关测试全部通过；全量回归不得新增失败。
7. 部署后手动生成一组 13 项备份，服务器恢复演练 PASS，Mac 拉取后 13/13 SHA-256 与服务器一致。

## 回滚边界

本单只增加第 13 项；回滚代码后旧 12 项备份仍保持原状。不得删除部署前任何备份集。
