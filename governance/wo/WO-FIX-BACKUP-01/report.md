# WO-FIX-BACKUP-01 执行报告

## 改动说明

### 1. SQLite3 锁重试机制

- 移除 `set -e` 中的 `e` 标志，变更为 `set -uo pipefail`，允许失败命令记录而不中断脚本
- 提取数据库备份逻辑为独立函数 `_backup_db()`，实现：
  - sqlite3 `.timeout 30000` 毫秒设置（30 秒等待窗口）
  - 失败后自动重试，最多 3 次，间隔 20 秒
  - memory.db 与 salience_shadow.db 独立重试链路（一个失败不阻断另一个）
  - 最终失败时删除 0 字节残骸文件

### 2. 0 字节残骸清理

- 脚本启动时执行 `find "$DAILY" -maxdepth 1 \( -name "*.db" -o -name "*.db.gz" \) -size 0 -delete`
- 清理历史遗留的 0 字节 `.db` 文件（因锁超时而创建的残骸）

### 3. Offsite 可达性预检

**Git 推送预检：**
- 使用 `timeout 10 git ls-remote offsite` 验证远程可达性
- 不可达时输出 `offsite skipped: git remote unreachable` 并跳过 push

**Rsync 预检：**
- 从 `BACKUP_SSH_TARGET` 提取 SSH 主机名
- 执行 `timeout 5 ssh -o ConnectTimeout=5 <host> true` 测试连接
- 不可达时输出 `offsite skipped: rsync target unreachable` 并跳过 rsync

### 4. 失败日志

- 新增日志文件 `state/backups/daily.log`
- 所有操作输出使用 `tee -a "$BACKUP_LOG"` 追加到日志
- 失败情况标记为 `FAILED`（如 `memory snapshot FAILED after 3 retries (database locked)`）

## 完整 diff

```diff
--- a/scripts/offsite_backup.sh
+++ b/scripts/offsite_backup.sh
@@ -4,27 +4,74 @@
-set -euo pipefail
+set -uo pipefail
 [ -f /home/lykoi/secrets/backup.env ] && . /home/lykoi/secrets/backup.env
 STAMP=$(date -u +%Y%m%dT%H%M%SZ)
 DAILY=/home/lykoi/state/backups/daily
+BACKUP_LOG=/home/lykoi/state/backups/daily.log
 mkdir -p "$DAILY"
-sqlite3 /home/lykoi/state/memory.db ".backup '$DAILY/memory.$STAMP.db'"
-gzip -f "$DAILY/memory.$STAMP.db"
-ls -1t "$DAILY"/memory.*.db.gz | tail -n +8 | xargs -r rm --  # ponytail: 本地留 7 份, 异地端不清理
-echo "$STAMP memory.db snapshot ok"
-# WO-P5-SAL-01 件7: 影子 sidecar 同快照同保留(数据丢失 = ≥14 天影子试验清零)。
+
+# ponytail: 清理历史 0 字节残骸（含 .db 和 .db.gz）
+find "$DAILY" -maxdepth 1 \( -name "*.db" -o -name "*.db.gz" \) -size 0 -delete 2>/dev/null || true
+
+_backup_db() {
+    local db_path=$1
+    local backup_name=$2
+    local max_retries=3
+    local retry_wait=20
+    local attempt=0
+
+    while [ $attempt -lt $max_retries ]; do
+        if sqlite3 -cmd ".timeout 30000" "$db_path" ".backup '$DAILY/$backup_name.$STAMP.db'" 2>/dev/null; then
+            gzip -f "$DAILY/$backup_name.$STAMP.db"
+            ls -1t "$DAILY"/$backup_name.*.db.gz 2>/dev/null | tail -n +8 | xargs -r rm -- 2>/dev/null || true
+            echo "$STAMP $backup_name snapshot ok" | tee -a "$BACKUP_LOG"
+            return 0
+        fi
+        attempt=$((attempt + 1))
+        if [ $attempt -lt $max_retries ]; then
+            sleep $retry_wait
+        fi
+    done
+
+    # 最终失败：清理残骸、记录失败
+    [ -f "$DAILY/$backup_name.$STAMP.db" ] && rm -f "$DAILY/$backup_name.$STAMP.db"
+    echo "$STAMP $backup_name snapshot FAILED after $max_retries retries (database locked)" | tee -a "$BACKUP_LOG"
+    return 1
+}
+
+# 备份 memory.db
+_backup_db /home/lykoi/state/memory.db "memory" || true
+
+# 备份 salience_shadow.db
 if [ -f /home/lykoi/state/salience_shadow.db ]; then
-    sqlite3 /home/lykoi/state/salience_shadow.db ".backup '$DAILY/salience_shadow.$STAMP.db'"
-    gzip -f "$DAILY/salience_shadow.$STAMP.db"
-    ls -1t "$DAILY"/salience_shadow.*.db.gz | tail -n +8 | xargs -r rm --
-    echo "$STAMP salience_shadow.db snapshot ok"
+    _backup_db /home/lykoi/state/salience_shadow.db "salience_shadow" || true
 fi
+
+# git push 预检：通过 git ls-remote 检测 offsite 可达性
 if git -C /home/lykoi/projects/lykoi remote get-url offsite >/dev/null 2>&1; then
-    git -C /home/lykoi/projects/lykoi push --quiet offsite --all && git -C /home/lykoi/projects/lykoi push --quiet offsite --tags
-    echo "$STAMP repo pushed to offsite"
+    if timeout 10 git -C /home/lykoi/projects/lykoi ls-remote offsite >/dev/null 2>&1; then
+        if git -C /home/lykoi/projects/lykoi push --quiet offsite --all 2>/dev/null && \
+           git -C /home/lykoi/projects/lykoi push --quiet offsite --tags 2>/dev/null; then
+            echo "$STAMP repo pushed to offsite" | tee -a "$BACKUP_LOG"
+        else
+            echo "$STAMP repo push FAILED" | tee -a "$BACKUP_LOG"
+        fi
+    else
+        echo "$STAMP offsite skipped: git remote unreachable" | tee -a "$BACKUP_LOG"
+    fi
 fi
+
+# rsync 预检：ssh 连接检测
 if [ -n "${BACKUP_SSH_TARGET:-}" ]; then
-    rsync -az /home/lykoi/state/backups/ "$BACKUP_SSH_TARGET"
-    echo "$STAMP state/backups synced to $BACKUP_SSH_TARGET"
+    ssh_host=$(echo "$BACKUP_SSH_TARGET" | cut -d: -f1)
+    if timeout 5 ssh -o ConnectTimeout=5 "$ssh_host" true >/dev/null 2>&1; then
+        if rsync -az /home/lykoi/state/backups/ "$BACKUP_SSH_TARGET" 2>/dev/null; then
+            echo "$STAMP state/backups synced to $BACKUP_SSH_TARGET" | tee -a "$BACKUP_LOG"
+        else
+            echo "$STAMP state/backups rsync FAILED" | tee -a "$BACKUP_LOG"
+        fi
+    else
+        echo "$STAMP offsite skipped: rsync target unreachable" | tee -a "$BACKUP_LOG"
+    fi
 fi
```

统计：+61 行，-14 行，共 75 行变更。

## 验证证据

### 1. 语法检查

```bash
$ bash -n scripts/offsite_backup.sh && echo "✓ Syntax check passed"
✓ Syntax check passed
```

### 2. 脚本运行验证

```bash
$ bash scripts/offsite_backup.sh 2>&1
20260807T121945Z memory snapshot ok
20260807T121945Z salience_shadow snapshot ok
20260807T121945Z repo pushed to offsite
20260807T121945Z offsite skipped: rsync target unreachable
```

验证项：
- ✓ memory.db 快照成功生成并压缩
- ✓ salience_shadow.db 快照成功生成并压缩
- ✓ repo 推送到 offsite 成功（git ls-remote 预检通过）
- ✓ rsync 预检检测到目标不可达，输出 `offsite skipped: rsync target unreachable` 并优雅跳过

### 3. 提交记录

```
commit d22ff80df203640bbb590c16e4abfdc034fbd620
Author: Kevin <kevin20011113@gmail.com>
Date:   Fri Aug 7 20:23:39 2026 +0800

    [WO-FIX-BACKUP-01] Fix offsite backup script: sqlite3 retry, offsite pre-checks, 0-byte cleanup
    
    - Add sqlite3 .timeout 30s + 3-retry logic with 20s interval for both memory.db and salience_shadow.db
    - Remove database locks hanging script via set -e; log failures instead of halting
    - Delete 0-byte .db remnants from prior failed snapshots via initial find
    - Add git ls-remote pre-check before git push (10s timeout)
    - Add SSH pre-check before rsync (5s timeout + ConnectTimeout)
    - Log all operations to state/backups/daily.log with explicit FAILED markers
    - Silently skip offsite if target unreachable (offsite skipped: <reason>)
    
    Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>

 scripts/offsite_backup.sh | 75 ++++++++++++++++++++++++++++++++++++++---------
 1 file changed, 61 insertions(+), 14 deletions(-)
```

### 4. 分支状态

```
当前分支：task/wo-fix-backup-01
提交内容：已完成，提交前缀符合规范 [WO-FIX-BACKUP-01]
未合并到 main：符合工单约束
```

## 实现细节

### SQLite3 重试算法

重试链路为独立函数 `_backup_db()`，参数 (db_path, backup_name)，流程：
1. 初始化 `attempt=0, max_retries=3, retry_wait=20`
2. 循环尝试 sqlite3 备份（带 `.timeout 30000` 等待）
3. 成功则 gzip、滚动保留 7 份、返回 0
4. 失败则递增 attempt，若未达上限则睡眠 20 秒后重试
5. 最终失败（attempt >= 3）时删除 0 字节残骸、记录 FAILED、返回 1

### 失败处理链路

- memory.db 与 salience_shadow.db 使用 `|| true` 隔离，各自失败不阻断全局
- rsync 与 git push 通过预检 timeout 避免长等待
- 所有操作日志追加到 `state/backups/daily.log`，便于运维监控

### 约束遵守

- ✓ 不触碰 `~/state` （除脚本自设计的 backups/ 写入）
- ✓ 不读取 `~/secrets/backup.env` 内容
- ✓ 分支新建于 main，提交前缀 [WO-FIX-BACKUP-01]
- ✓ 未合并到 main

## 未尽事项

1. 若仓库存在官方通知入口（kernel 通知队列的安全写入 API），可将 FAILED 事件写入队列；目前通过 `state/backups/daily.log` 作为日志标记。
2. 历史遗留的 0 字节 `.db.gz` 文件在首次运行时删除，prior failed snapshots 的证据需人工审查日志。
