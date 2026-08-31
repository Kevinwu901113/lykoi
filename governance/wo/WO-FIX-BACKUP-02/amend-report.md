# WO-FIX-BACKUP-02 补正报告

## diff

```diff
diff --git a/scripts/offsite_backup.sh b/scripts/offsite_backup.sh
index b01e42e..00c5ece 100755
--- a/scripts/offsite_backup.sh
+++ b/scripts/offsite_backup.sh
@@ -5,7 +5,8 @@
 #     一致性快照(.backup)→ gzip → state/backups/daily/, 各留 7 份。
 #   - 文件/目录类: events.jsonl / audit.jsonl / approval_rules.json / pending_actions.json /
 #     core_artifacts/(tar.gz) / runtime/persona/lykoi_base.toml(只读复制) → state/backups/daily/, 各留 7 份。
-#   - 治理开关(runtime/governance/*.on)与 /var/log/lykoi-audit 无读权限时，仅记录存在性快照，不 sudo。
+#   - /var/log/lykoi-audit/audit.jsonl 是审计正本，lykoi 属组可读 → 真实备份(gzip)，读失败才降级存在性快照。
+#   - 治理开关(runtime/governance/*.on)是 root 0400/0600，lykoi 确实无读权限，仅记录存在性快照，不 sudo。
 # 异地部分(配置后自动生效, 未配置静默跳过):
 #   - repo:  git remote 'offsite' 存在 → push --all --tags (GitHub 需代理, 在 backup.env 里 export)
 #   - state: backup.env 定义 BACKUP_SSH_TARGET=user@host:/path → rsync 整个 state/backups/
@@ -135,7 +136,8 @@ fi
 # 备份 events.jsonl（不可再生：事件日志，约 6MB → gzip）
 _backup_file /home/lykoi/state/events.jsonl "events" "jsonl" "yes" || true
 
-# 备份 audit.jsonl（不可再生：审计记录）
+# 备份 audit.jsonl（state 下这份是空的：审计正本不在这里写，见下方 /var/log/lykoi-audit 备份；
+# 仍照常备份，0 字节成本可忽略，避免未来该路径又被启用时漏备）
 _backup_file /home/lykoi/state/audit.jsonl "audit" "jsonl" "yes" || true
 
 # 备份 approval_rules.json / pending_actions.json（可重建但代价高）
@@ -151,8 +153,14 @@ _backup_file /home/lykoi/runtime/persona/lykoi_base.toml "lykoi_base_persona" "t
 # 治理开关 runtime/governance/*.on（root 属主，可能无读权限）→ 仅记录存在性/文件名清单
 _backup_existence_snapshot /home/lykoi/runtime/governance "governance_flags" || true
 
-# /var/log/lykoi-audit 正本（可能无读权限）→ 仅记录存在性/文件名清单
-_backup_existence_snapshot /var/log/lykoi-audit "audit_log_source" || true
+# /var/log/lykoi-audit/audit.jsonl 正本（root:lykoi 0660，目录 root:lykoi 0750 — lykoi 属组可读，
+# 无需 sudo）→ 真实备份(gzip)；读失败(权限变化/文件不存在)才降级为存在性快照
+if [ -r /var/log/lykoi-audit/audit.jsonl ]; then
+    _backup_file /var/log/lykoi-audit/audit.jsonl "audit_log" "jsonl" "yes" || \
+        _backup_existence_snapshot /var/log/lykoi-audit "audit_log_source"
+else
+    _backup_existence_snapshot /var/log/lykoi-audit "audit_log_source"
+fi
 
 # git push 预检：通过 git ls-remote 检测 offsite 可达性
 if git -C /home/lykoi/projects/lykoi remote get-url offsite >/dev/null 2>&1; then
```

## bash -n

`bash -n scripts/offsite_backup.sh` → 无输出，退出码 0（语法通过）。

## 权限分析

`/var/log/lykoi-audit/` 目录 `drwxr-x--- root:lykoi`（组位有 `r-x`）、`audit.jsonl` 文件 `-rw-rw---- root:lykoi`（组位有 `rw-`）——lykoi 用户是该组成员，对目录有 `x`（可进入定位 inode）加 `r`（可列目录），对文件有 `r`（可读内容），三者齐全，标准 DAC 检查即放行，不需要提权。

`runtime/governance/*.on` 是 `root` 属主、`0400`/`0600`，组位与其他位均为 `0`——lykoi 既非属主也不在授权组内，组/其他位权限位为空，内核直接拒绝，读取必然失败，只能保留存在性快照降级。

区别的本质是：前者是"属组共享读"设计（root 写、lykoi 组读），后者是"仅属主"设计（root 独占，故意不给 lykoi 读权限，属治理隔离要求）。
