# WO-FIX-BACKUP-01 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07
- **结论**：**验收通过**；合并因权限分类器拦截移交 Kevin 亲手执行（命令已提供）

## 验证

| 项 | 结果 |
| --- | --- |
| diff 范围 = 仅 scripts/offsite_backup.sh（+61/-14） | ✓ |
| `bash -n` 语法检查（分支上、复核时各一次） | ✓ |
| 实跑证据：memory/salience 快照均成功（20260807T121945Z） | ✓ |
| **独立交叉验证**：该时间戳快照已被 Mac 拉取机制收到（两条证据链互相咬合） | ✓ |
| 历史 0 字节残骸清理：复核时 `find -size 0` = 0 | ✓ |
| offsite 预检：rsync 目标不可达时输出 skipped 行、无报错栈 | ✓ |
| 分支纪律：task/wo-fix-backup-01，未合并 main，提交前缀合规 | ✓ |
| 禁区遵守：未读 backup.env 内容、state 写入仅限 backups/ 设计内 | ✓ |

## 注记（不阻塞验收，列入后续改进）

1. `sqlite3 ... 2>/dev/null` 丢弃了真实错误输出；最终失败时日志硬编码 "(database locked)"，若实际原因是磁盘满等会误导排障。建议后续小补丁：捕获 stderr 进 daily.log，失败原因如实记录。
2. 失败告警仅落 daily.log 与既有 cron 日志，未接 kernel 通知队列（执行 Agent 判断无安全写入口，符合工单的保守指令）。通知接入留待感知/通知管线工单。
3. 执行 Agent 署名显示服务器端 claude 默认模型为 Haiku 4.5；本工单复杂度下质量合格，更重的工单可考虑指定模型。
4. 意外收获：验证运行中 `git push offsite` 成功，说明服务器→GitHub ssh 通道已恢复（今晚早些时候曾不通）。

## 生效说明

服务器工作区当前停在修复分支，cron 按路径执行脚本——修复已实际生效，不依赖合并。合并入 main 属仓库卫生，由 Kevin 执行：

    ssh lapw1ng.com 'cd ~/projects/lykoi && git checkout main && git merge --no-ff task/wo-fix-backup-01 -m "[WO-FIX-BACKUP-01] merge: backup lock-retry + offsite precheck + residue cleanup"'

## 关联

- Mac 侧拉取机制（同日建立）：`~/lykoi/backups/pull_server_backups.sh` + launchd `com.lykoi.backup-pull`（每 6h + 登录时；rc=24 视为成功）。首次全量 48MB 已落地，含本工单验证运行产出的快照。
- 教训沉淀：macOS launchd 跑 ~/Documents 内脚本会被 TCC 拦（Operation not permitted, exit 126）——Mac 侧自动化一律放 `~/lykoi/`。
