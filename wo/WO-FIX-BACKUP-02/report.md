# WO-FIX-BACKUP-02 执行报告

## 分支与提交

- 基于 `task/wo-fix-backup-01`（commit `d22ff80`）新建分支 `task/wo-fix-backup-02`。
- 修改文件：仅 `scripts/offsite_backup.sh`。
- 提交：`accda41` `[WO-FIX-BACKUP-02] Expand daily backup coverage: core facts, events, audit, approvals, persona, governance flags`
- 未合并到 main，未推送。

## 改动说明

在保留 WO-FIX-BACKUP-01 的锁重试（`_backup_db`）、offsite 预检（git ls-remote / ssh 连接检测）、7 份滚动、`daily.log` 记录机制基础上，新增三个辅助函数与对应调用：

1. **`_backup_file(src, backup_name, ext, compress)`** — 单文件快照。源不存在→跳过并记录（非失败，返回 0）；`cp` 失败→清残骸、记录 FAILED；`compress=yes` 时 gzip 并按 `backup_name.*.$ext.gz` 保留最新 7 份，`compress=no` 时按 `backup_name.*.$ext` 保留 7 份。
2. **`_backup_dir(src, backup_name)`** — 目录打包快照。用 `tar czf` 在 `dirname` 下打包 `basename`，避免路径泄露到 tar 内部路径；源不存在→跳过；打包失败→清残骸、记录 FAILED；按 `backup_name.*.tar.gz` 保留 7 份。
3. **`_backup_existence_snapshot(src, backup_name)`** — 对无读权限路径，仅 `ls -la` 捕获（含 stderr，"Permission denied" 也会被原样记录进快照文件，不视为脚本失败），写入 `backup_name.$STAMP.txt`，保留 7 份，不 sudo、不改权限。

### 逐项预期行为

| 资产 | 调用 | 产出文件名格式 | 压缩 | 失败/降级路径 |
|---|---|---|---|---|
| `core_facts.db` | `_backup_db`（复用重试逻辑，`if [ -f ]` 存在性前置判断） | `core_facts.$STAMP.db.gz` | gzip | 锁重试 3 次（20s 间隔）失败→清残骸+FAILED 日志，`\|\| true` 不阻断后续 |
| `permission_evidence_shadow.db` | 同上 | `permission_evidence_shadow.$STAMP.db.gz` | gzip | 同上 |
| `events.jsonl` | `_backup_file ... jsonl yes` | `events.$STAMP.jsonl.gz` | gzip | 源不存在→skip 日志；`cp` 失败（权限/IO）→FAILED 日志，无残骸 |
| `audit.jsonl` | `_backup_file ... jsonl yes` | `audit.$STAMP.jsonl.gz` | gzip | 同上 |
| `approval_rules.json` | `_backup_file ... json yes` | `approval_rules.$STAMP.json.gz` | gzip | 同上 |
| `pending_actions.json` | `_backup_file ... json yes` | `pending_actions.$STAMP.json.gz` | gzip | 同上 |
| `core_artifacts/` | `_backup_dir` | `core_artifacts.$STAMP.tar.gz` | tar+gzip | 目录不存在→skip；`tar` 失败→FAILED，清残骸 |
| `runtime/persona/lykoi_base.toml` | `_backup_file ... toml no` | `lykoi_base_persona.$STAMP.toml`（**不压缩，明文只读复制**） | 无 | 0640 权限下 `cp` 若因权限失败→FAILED 日志（预期 claude 账户可能读不到，lykoi 账户实跑应可读，因同组 `lykoi`） |
| `runtime/governance/*.on` | `_backup_existence_snapshot` | `governance_flags.$STAMP.txt`（内容为 `ls -la` 输出，含 Permission denied 逐条也会被记录） | 无 | 不视为失败，始终 "existence snapshot ok" |
| `/var/log/lykoi-audit` | `_backup_existence_snapshot` | `audit_log_source.$STAMP.txt` | 无 | 同上 |

失败隔离：全部新增调用均以 `|| true` 收尾，`_backup_db`/`_backup_file`/`_backup_dir` 内部失败分支各自清理半成品文件并写 FAILED 日志，不 `exit`、不中断脚本主流程，与既有 memory.db 处理方式一致。

0 字节残骸清理已扩展覆盖新扩展名：`*.jsonl.gz`、`*.json.gz`、`*.tar.gz`、`*.toml`、`*.txt`（连同原有 `*.db`、`*.db.gz`）。

## 验证证据

### 1. 语法检查

```
$ bash -n scripts/offsite_backup.sh && echo "SYNTAX OK"
SYNTAX OK
```

### 2. 实跑

不可执行——claude 账户对 `/home/lykoi/state`（脚本写入目标）与多数源路径无读写权限（0600/属主 lykoi），这是工单预期的隔离边界，未尝试 sudo 或绕过。请主治理 Agent 以 `lykoi` 身份实跑验证。

### 3. 完整 diff

```diff
diff --git a/scripts/offsite_backup.sh b/scripts/offsite_backup.sh
index 3aae08a..b01e42e 100755
--- a/scripts/offsite_backup.sh
+++ b/scripts/offsite_backup.sh
@@ -1,6 +1,11 @@
 #!/usr/bin/env bash
-# WO-HARDEN-01 件3: 每日备份。
-# 本地部分(无需配置即生效): memory.db 一致性快照(.backup)→ gzip → state/backups/daily/, 留 7 份。
+# WO-HARDEN-01 件3 / WO-FIX-BACKUP-02: 每日备份。
+# 本地部分(无需配置即生效):
+#   - sqlite 类: memory.db / salience_shadow.db / core_facts.db / permission_evidence_shadow.db
+#     一致性快照(.backup)→ gzip → state/backups/daily/, 各留 7 份。
+#   - 文件/目录类: events.jsonl / audit.jsonl / approval_rules.json / pending_actions.json /
+#     core_artifacts/(tar.gz) / runtime/persona/lykoi_base.toml(只读复制) → state/backups/daily/, 各留 7 份。
+#   - 治理开关(runtime/governance/*.on)与 /var/log/lykoi-audit 无读权限时，仅记录存在性快照，不 sudo。
 # 异地部分(配置后自动生效, 未配置静默跳过):
 #   - repo:  git remote 'offsite' 存在 → push --all --tags (GitHub 需代理, 在 backup.env 里 export)
 #   - state: backup.env 定义 BACKUP_SSH_TARGET=user@host:/path → rsync 整个 state/backups/
@@ -11,8 +16,10 @@ DAILY=/home/lykoi/state/backups/daily
 BACKUP_LOG=/home/lykoi/state/backups/daily.log
 mkdir -p "$DAILY"
 
-# ponytail: 清理历史 0 字节残骸（含 .db 和 .db.gz）
-find "$DAILY" -maxdepth 1 \( -name "*.db" -o -name "*.db.gz" \) -size 0 -delete 2>/dev/null || true
+# ponytail: 清理历史 0 字节残骸（覆盖所有已知扩展名）
+find "$DAILY" -maxdepth 1 \( -name "*.db" -o -name "*.db.gz" -o -name "*.jsonl.gz" \
+    -o -name "*.json.gz" -o -name "*.tar.gz" -o -name "*.toml" -o -name "*.txt" \) \
+    -size 0 -delete 2>/dev/null || true
 
 _backup_db() {
     local db_path=$1
@@ -40,6 +47,73 @@ _backup_db() {
     return 1
 }
 
+# _backup_file: 单文件快照(可选 gzip)。源不存在 → 跳过并记录；复制失败 → 清残骸、记录失败。
+# 用法: _backup_file <源路径> <backup_name> <目标扩展名> <compress: yes|no>
+_backup_file() {
+    local src=$1
+    local backup_name=$2
+    local ext=$3
+    local compress=$4
+    local dest="$DAILY/$backup_name.$STAMP.$ext"
+
+    if [ ! -e "$src" ]; then
+        echo "$STAMP $backup_name skipped: source not found ($src)" | tee -a "$BACKUP_LOG"
+        return 0
+    fi
+
+    if ! cp -- "$src" "$dest" 2>/dev/null; then
+        rm -f "$dest" 2>/dev/null
+        echo "$STAMP $backup_name snapshot FAILED (read/permission error on $src)" | tee -a "$BACKUP_LOG"
+        return 1
+    fi
+
+    if [ "$compress" = "yes" ]; then
+        gzip -f "$dest"
+        ls -1t "$DAILY"/"$backup_name".*."$ext".gz 2>/dev/null | tail -n +8 | xargs -r rm -- 2>/dev/null || true
+    else
+        ls -1t "$DAILY"/"$backup_name".*."$ext" 2>/dev/null | tail -n +8 | xargs -r rm -- 2>/dev/null || true
+    fi
+    echo "$STAMP $backup_name snapshot ok" | tee -a "$BACKUP_LOG"
+    return 0
+}
+
+# _backup_dir: 目录打包 tar.gz 快照。源不存在 → 跳过并记录；打包失败 → 清残骸、记录失败。
+_backup_dir() {
+    local src=$1
+    local backup_name=$2
+    local dest="$DAILY/$backup_name.$STAMP.tar.gz"
+
+    if [ ! -d "$src" ]; then
+        echo "$STAMP $backup_name skipped: source dir not found ($src)" | tee -a "$BACKUP_LOG"
+        return 0
+    fi
+
+    if tar czf "$dest" -C "$(dirname -- "$src")" "$(basename -- "$src")" 2>/dev/null; then
+        ls -1t "$DAILY"/"$backup_name".*.tar.gz 2>/dev/null | tail -n +8 | xargs -r rm -- 2>/dev/null || true
+        echo "$STAMP $backup_name snapshot ok" | tee -a "$BACKUP_LOG"
+        return 0
+    fi
+
+    rm -f "$dest" 2>/dev/null
+    echo "$STAMP $backup_name snapshot FAILED (tar error on $src)" | tee -a "$BACKUP_LOG"
+    return 1
+}
+
+# _backup_existence_snapshot: 对无读权限的路径，仅记录存在性/文件名清单(ls -la)，不 sudo、不强行读内容。
+_backup_existence_snapshot() {
+    local src=$1
+    local backup_name=$2
+    local dest="$DAILY/$backup_name.$STAMP.txt"
+
+    {
+        echo "# existence snapshot for $src @ $STAMP"
+        ls -la "$src" 2>&1
+    } > "$dest" 2>/dev/null
+
+    ls -1t "$DAILY"/"$backup_name".*.txt 2>/dev/null | tail -n +8 | xargs -r rm -- 2>/dev/null || true
+    echo "$STAMP $backup_name existence snapshot ok (content not read)" | tee -a "$BACKUP_LOG"
+}
+
 # 备份 memory.db
 _backup_db /home/lykoi/state/memory.db "memory" || true
 
@@ -48,6 +122,38 @@ if [ -f /home/lykoi/state/salience_shadow.db ]; then
     _backup_db /home/lykoi/state/salience_shadow.db "salience_shadow" || true
 fi
 
+# 备份 core_facts.db（不可再生：核心事实库）
+if [ -f /home/lykoi/state/core_facts.db ]; then
+    _backup_db /home/lykoi/state/core_facts.db "core_facts" || true
+fi
+
+# 备份 permission_evidence_shadow.db（不可再生：权限证据）
+if [ -f /home/lykoi/state/permission_evidence_shadow.db ]; then
+    _backup_db /home/lykoi/state/permission_evidence_shadow.db "permission_evidence_shadow" || true
+fi
+
+# 备份 events.jsonl（不可再生：事件日志，约 6MB → gzip）
+_backup_file /home/lykoi/state/events.jsonl "events" "jsonl" "yes" || true
+
+# 备份 audit.jsonl（不可再生：审计记录）
+_backup_file /home/lykoi/state/audit.jsonl "audit" "jsonl" "yes" || true
+
+# 备份 approval_rules.json / pending_actions.json（可重建但代价高）
+_backup_file /home/lykoi/state/approval_rules.json "approval_rules" "json" "yes" || true
+_backup_file /home/lykoi/state/pending_actions.json "pending_actions" "json" "yes" || true
+
+# 备份 core_artifacts/（视内容而定，整目录打包）
+_backup_dir /home/lykoi/state/core_artifacts "core_artifacts" || true
+
+# 备份基础人格 persona TOML（root:lykoi 0640，只读复制，不改权限/属主；最高优先级：不在 git 也不在原备份内）
+_backup_file /home/lykoi/runtime/persona/lykoi_base.toml "lykoi_base_persona" "toml" "no" || true
+
+# 治理开关 runtime/governance/*.on（root 属主，可能无读权限）→ 仅记录存在性/文件名清单
+_backup_existence_snapshot /home/lykoi/runtime/governance "governance_flags" || true
+
+# /var/log/lykoi-audit 正本（可能无读权限）→ 仅记录存在性/文件名清单
+_backup_existence_snapshot /var/log/lykoi-audit "audit_log_source" || true
+
 # git push 预检：通过 git ls-remote 检测 offsite 可达性
 if git -C /home/lykoi/projects/lykoi remote get-url offsite >/dev/null 2>&1; then
     if timeout 10 git -C /home/lykoi/projects/lykoi ls-remote offsite >/dev/null 2>&1; then
```

## 体积估算

单次备份新增体积（gzip 后估算，压缩比参考 jsonl/db 类文本或半结构化数据经验值约 3–6 倍）：

| 项 | 原始体积 | 估算压缩后 |
|---|---|---|
| `core_facts.db.gz` | ~5.6MB | ~1.5–2.5MB（sqlite 二进制页压缩比一般较低，取保守 2.5MB） |
| `permission_evidence_shadow.db.gz` | 未知，假设与 salience_shadow 量级相近（<1MB） | <0.5MB |
| `events.jsonl.gz` | ~6MB | ~1–1.5MB（jsonl 文本压缩比通常较高） |
| `audit.jsonl.gz` | 未知，假设与 events 量级相近或更小 | ~0.3–1MB（保守估） |
| `approval_rules.json.gz` / `pending_actions.json.gz` | 通常 KB 级 | 可忽略（<50KB 合计） |
| `core_artifacts.tar.gz` | 视内容而定，未知 | **不确定项，见下方说明** |
| `lykoi_base_persona.toml`（不压缩） | 通常 KB 级 | 与原始体积相同（<50KB） |
| `governance_flags.txt` / `audit_log_source.txt` | 存在性清单，极小 | <5KB 合计 |
| 既有 `memory.db.gz` + `salience_shadow.db.gz` | 沿用原脚本 | 不变（工单未要求重估） |

**单次新增合计（不含 core_artifacts）**：约 3.5–5.5MB。加上工单给出的 events(~6MB)/core_facts(~5.6MB) 原始体积作为压缩前上限交叉核对，压缩后估算落在 10MB 量级以内是合理的，符合工单"每日新增 10MB 量级以内"的目标——**前提是 `core_artifacts/` 体积可控**。

7 份滚动稳态占用：约 (3.5MB–5.5MB) × 7 ≈ **25–40MB**（不含 core_artifacts，不含既有 memory/salience 两项）。

**未知项说明——`core_artifacts/`**：工单本身注明"视内容而定"，源码中未给出该目录体积。若其中包含大型二进制或频繁变化的工件，`tar.gz` 全量打包 × 7 份可能显著超出预算。**建议**：主治理 Agent 实跑前先用 `du -sh /home/lykoi/state/core_artifacts` 确认体积；若超过几 MB 且内容变化不频繁，可考虑改为增量方案（如仅当目录 mtime/校验和变化时才生成新快照，而非每日全量 tar），但本工单未授权我改变频率或做该项判断落地，此处仅作为报告中的替代方案说明，未写入脚本。

## 自检清单（供主治理 Agent 实跑时重点观察）

1. **persona TOML 权限**：`lykoi_base.toml` 是 `root:lykoi 0640`，脚本以 `lykoi` 身份运行时应可读（同组）；确认 `cp` 是否成功而非静默走入 FAILED 分支，并核对复制出的文件内容与原文件一致（尤其换行/编码，`cp` 不应有损）。
2. **governance_flags / audit_log_source 降级路径是否真正触发**：确认这两项即使目录/文件不可读，也应始终写出 `.txt` 文件且日志显示 "existence snapshot ok"，而不是脚本因 `ls` 报错中断（`_backup_existence_snapshot` 内部未做 `return 1`，理论上不会失败，需实跑确认）。
3. **`core_artifacts/` 实际体积与打包耗时**：确认 `tar czf` 未因目录过大导致锁等待期间与其他 I/O 冲突，且压缩后体积是否落入预算，为后续是否需要改为增量方案提供数据支撑。
4. **0 字节清理是否误删正常小文件**：新增的 `approval_rules.json.gz`、`pending_actions.json.gz`、`governance_flags.txt` 等本身可能体积很小但非 0 字节；需确认清理逻辑（`-size 0`）不会误伤这些合法小文件，仅命中真正的残骸。
5. **7 份滚动的 glob 匹配精确性**：`ls -1t "$DAILY"/"$backup_name".*."$ext"[.gz]` 依赖 `backup_name` 前缀唯一性，需确认例如 `audit.*.jsonl.gz`（audit.jsonl）与未来若有 `audit_log_source.*.txt` 等不会互相匹配污染彼此的保留计数（当前命名已刻意区分前缀，但建议实跑后 `ls "$DAILY"` 抽查确认无交叉误删）。

## 未尽事项

- `core_artifacts/` 与 `permission_evidence_shadow.db` / `audit.jsonl` 的真实体积未知，估算基于工单给出的两个基准值外推，存在偏差风险，需实跑后用真实文件大小复核。
- `governance_flags.txt` 快照仅捕获 `ls -la` 输出（含 Permission denied 逐条文本），未验证在无 `read` 但有 `execute`（可 `ls` 目录项）权限的组合下输出格式是否符合预期——该组合行为取决于目标系统实际 ACL，建议 lykoi 实跑时人工核对一次输出内容。
