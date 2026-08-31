# WO-FIX-BACKUP-03 复核与待部署记录

- **复核人/实现者**：主治理 Agent（Codex，直接实现）
- **日期**：2026-08-09
- **生产基线**：`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`
- **候选**：`1e19741fde4e1ed63fe24463658b989e8f194467`
- **生产合并**：`74f5907c933dede04c490089418349e887417a08`
- **结论**：**已部署并完成服务器真实 13/13 恢复演练 + Mac 异地 13/13 逐文件 SHA-256 验收**

## 1. 独立复核结论

- [x] 只新增非密钥部署配置恢复包，不改变 Lykoi 运行 authority、state、persona、audit 或 secrets。
- [x] 活体 9 unit、13 drop-in、2 M2 env、attention policy 全部进入 allowlist；包内 36 个成员全部为普通文件。
- [x] raw cron、Git remote URL、命令 stderr 与 root-only controller 正文都不归档；三份 secret 只列名称、不含值。
- [x] 最终候选专项 + P0 为 28 passed / 4 skipped，真实 13/13 恢复演练 PASS，四类负向输入均按预期拒绝。
- [x] 复核额外抓出并修复原脚本 `/tmp/../...` / symlink WORKDIR 逃逸，未进入生产。
- [x] 全量 1458 passed / 6 skipped / 4 failed；两项为确定性旧基线测试陈旧，两项 I/O lock 抖动在候选单独复跑通过，且 writer-lock 在未改基线复现后第二轮通过，新增失败为 0。
- [x] 生产保持 `35ef7c86`、工作树干净、四服务 active/running、`NRestarts=0`、health ready。

## 2. Kevin root 部署命令

### 2.1 预检

```bash
backup03_repo=/home/lykoi/projects/lykoi
backup03_bundle=/tmp/WO-FIX-BACKUP-03-1e19741.bundle

git -c safe.directory="$backup03_repo" -C "$backup03_repo" rev-parse HEAD
git -c safe.directory="$backup03_repo" -C "$backup03_repo" status --short --branch
sha256sum "$backup03_bundle"
git -c safe.directory="$backup03_repo" -C "$backup03_repo" bundle verify "$backup03_bundle"
```

必须分别得到：

- HEAD=`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`；
- 工作树只有 `## main`；
- bundle SHA-256=`6907d8b1874ea1a654f6a76810b30385ba6793c10b820337ac84371570b85a0b`；
- bundle ref=`1e19741fde4e1ed63fe24463658b989e8f194467` 且 complete history。

### 2.2 回滚点、fetch、合并

```bash
git -c safe.directory="$backup03_repo" -C "$backup03_repo" \
  tag pre-WO-FIX-BACKUP-03-35ef7c86 \
  35ef7c86f469e79e93b9a0642805d71ece8fdeaa

git -c safe.directory="$backup03_repo" -C "$backup03_repo" fetch \
  "$backup03_bundle" \
  task/wo-fix-backup-03-direct:refs/heads/task/wo-fix-backup-03

git -c safe.directory="$backup03_repo" -C "$backup03_repo" merge \
  --no-ff task/wo-fix-backup-03 \
  -m "[WO-FIX-BACKUP-03] merge: add non-secret rebuild config backup"
```

### 2.3 逐文件恢复属主与权限

```bash
chown lykoi:lykoi \
  "$backup03_repo/docs/runbook_disaster_recovery.md" \
  "$backup03_repo/scripts/export_rebuild_config.py" \
  "$backup03_repo/scripts/offsite_backup.sh" \
  "$backup03_repo/scripts/restore_drill.sh" \
  "$backup03_repo/tests/test_rebuild_config_backup.py"

chmod 0644 \
  "$backup03_repo/docs/runbook_disaster_recovery.md" \
  "$backup03_repo/scripts/export_rebuild_config.py" \
  "$backup03_repo/tests/test_rebuild_config_backup.py"

chmod 0755 \
  "$backup03_repo/scripts/offsite_backup.sh" \
  "$backup03_repo/scripts/restore_drill.sh"
```

### 2.4 合并后、正式备份前验证

```bash
cd "$backup03_repo"

bash -n scripts/offsite_backup.sh
bash -n scripts/restore_drill.sh

sudo -u lykoi env PYTHONDONTWRITEBYTECODE=1 \
  "$backup03_repo/.venv/bin/python" -m pytest -q -p no:cacheprovider \
  tests/test_rebuild_config_backup.py \
  tests/test_p0_integrity.py

git -c safe.directory="$backup03_repo" -C "$backup03_repo" \
  log --oneline -1
git -c safe.directory="$backup03_repo" -C "$backup03_repo" \
  status --short --branch
```

不需要、也不要重启任何服务。生产 sealed-host 上两文件合计应为 **32 passed**、零失败，工作树为 `## main`。

## 3. 生成第一份正式 13 项备份

```bash
backup03_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)

sudo -u lykoi bash "$backup03_repo/scripts/offsite_backup.sh"

backup03_config=$(find /home/lykoi/state/backups/daily \
  -maxdepth 1 -type f -name 'deployment_config.*.tar.gz' \
  -newermt "$backup03_started" -print | sort | tail -n 1)

test -n "$backup03_config"
backup03_name=${backup03_config##*/}
backup03_stamp=${backup03_name#deployment_config.}
backup03_stamp=${backup03_stamp%.tar.gz}
printf 'BACKUP03_STAMP=%s\n' "$backup03_stamp"

for backup03_spec in \
  memory:db.gz \
  core_facts:db.gz \
  salience_shadow:db.gz \
  permission_evidence_shadow:db.gz \
  events:jsonl.gz \
  audit:jsonl.gz \
  audit_log:jsonl.gz \
  approval_rules:json.gz \
  pending_actions:json.gz \
  core_artifacts:tar.gz \
  lykoi_base_persona:toml \
  governance_flags:txt \
  deployment_config:tar.gz
do
  backup03_item=${backup03_spec%%:*}
  backup03_ext=${backup03_spec#*:}
  test -f "/home/lykoi/state/backups/daily/$backup03_item.$backup03_stamp.$backup03_ext"
done

sudo -u lykoi env \
  LYKOI_BACKUP_DIR=/home/lykoi/state/backups/daily \
  LYKOI_REPO="$backup03_repo" \
  bash "$backup03_repo/scripts/restore_drill.sh" "$backup03_stamp" \
  -d "/tmp/lykoi-restore-$backup03_stamp"

sha256sum "$backup03_config"
stat -c '%a %U:%G %s %n' "$backup03_config"
tar -xOzf "$backup03_config" metadata/source-head.txt

if tar -tzf "$backup03_config" | grep -Eq '(^|/)secrets(/|$)'; then
  echo 'FAIL: deployment config contains a secrets member path' >&2
  exit 1
fi
```

恢复演练必须为 `VERDICT: PASS`，并报告 13/13、25 config files、13 drop-ins、SHA256SUMS verified。`metadata/source-head.txt` 应为本单生产 merge commit，不是候选 commit。

## 4. 服务无影响复核

```bash
systemctl is-active \
  lykoi-core \
  lykoi-server \
  lykoi-autonomy \
  lykoi-watchdog

curl -fsS --noproxy 127.0.0.1 \
  http://127.0.0.1:8080/health

systemctl show \
  lykoi-core.service \
  lykoi-server.service \
  lykoi-autonomy.service \
  lykoi-watchdog.service \
  -p Id -p ActiveState -p SubState -p MainPID -p NRestarts \
  --no-pager
```

四服务应继续 active/running、`NRestarts=0`，health 保持 `browser_request_guard=ready`。随后把 `BACKUP03_STAMP` 和 server config archive SHA-256 发给主治理 Agent，由主治理 Agent触发 Mac pull 并完成 13/13 逐文件 SHA 对比。

## 5. 生产部署与正式验收（已完成）

- Kevin 以 root 从已验证 bundle 合并，生产 HEAD=`74f5907c933dede04c490089418349e887417a08`；改动严格为工单预期的 5 个文件，工作树 `## main`。
- 合并后恢复属主/权限：两份 shell 脚本为 `lykoi:lykoi 0755`，其余三份文件为 `lykoi:lykoi 0644`。
- 生产仓脚本语法门通过；`tests/test_rebuild_config_backup.py` + `tests/test_p0_integrity.py` 为 **32 passed**。
- 首份正式 13 项备份 STAMP=`20260809T032908Z`；配置包 SHA-256=`8d214d1ebb738a5026ee2ac709f737309f92af93bdacd2bcfba35eb06141f7f0`，`0640 lykoi:lykoi`，20,852 bytes，包内 `metadata/source-head.txt`=`74f5907c933dede04c490089418349e887417a08`，无 `secrets/` 成员路径。
- 服务器真实恢复演练 **VERDICT: PASS**：13/13 完整，4 个 SQLite integrity check 均 OK，关键表计数与活体单调一致，persona 匹配，25 个配置文件、13 个 drop-in、SHA256SUMS 全通过，`build_persona_prompt()`=226 chars。
- 本轮服务器主动 offsite rsync 因目标不可达而跳过；随后主治理 Agent 触发既有 Mac LaunchAgent `com.lykoi.backup-pull`，第 6 次运行 `last exit code=0`。Mac 同一 STAMP 的 13 项全部到位，服务器与 Mac **13/13 逐文件 SHA-256 完全一致**。
- 未重启任何服务。收尾复核 core/server/autonomy/watchdog 全部 active/running、`NRestarts=0`；health=`status:ok`、`browser_request_guard:ready`；生产工作树保持 `## main`。

因此 BACKUP-03 已闭环，干净 Ubuntu 24.04 VM 的从零重建演练具备开始条件；secrets 仍必须由 owner 带外重签，不能进入归档。

## 6. 回滚

确认生产 HEAD 是本单 merge commit后，以 root：

```bash
git -c safe.directory="$backup03_repo" -C "$backup03_repo" \
  revert -m 1 --no-edit HEAD

chown lykoi:lykoi \
  "$backup03_repo/docs/runbook_disaster_recovery.md" \
  "$backup03_repo/scripts/offsite_backup.sh" \
  "$backup03_repo/scripts/restore_drill.sh"

chmod 0644 "$backup03_repo/docs/runbook_disaster_recovery.md"
chmod 0755 \
  "$backup03_repo/scripts/offsite_backup.sh" \
  "$backup03_repo/scripts/restore_drill.sh"

bash -n "$backup03_repo/scripts/offsite_backup.sh"
bash -n "$backup03_repo/scripts/restore_drill.sh"
git -c safe.directory="$backup03_repo" -C "$backup03_repo" \
  status --short --branch
```

`pre-WO-FIX-BACKUP-03-35ef7c86` 是不可歧义的部署前回滚点。回滚只撤代码；已经生成的第 13 项归档保留为恢复证据，不要删除。无需重启服务。
