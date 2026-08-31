All changes verified. Here's the report.

# WO-FIX-RESTORE-01 补正二报告

## diff — scripts/restore_drill.sh

```
--- a/scripts/restore_drill.sh
+++ b/scripts/restore_drill.sh
@@ header/usage
+#   --keep  若隔离目录已存在且非空，保留旧内容用于对比（默认：清空后重建）。
+# 幂等性说明段落（rm -f + chmod 0644 策略）

@@ arg parsing
+KEEP=0
+        --keep) KEEP=1; shift ;;

@@ workdir handling
+if [ -d "$WORKDIR" ] && [ -n "$(ls -A "$WORKDIR" 2>/dev/null)" ]; then
+    if [ "$KEEP" -eq 1 ]; then
+        echo "# workdir exists and is non-empty, --keep set: leaving old contents in place: $WORKDIR"
+    else
+        echo "# workdir exists and is non-empty, clearing and rebuilding (pass --keep to preserve): $WORKDIR"
+        rm -rf -- "$WORKDIR"
+    fi
+fi

@@ extract_gz()
-    gzip -dc -- "$src" > "$dest" 2>/dev/null
+    rm -f -- "$dest" 2>/dev/null
+    if gzip -dc -- "$src" > "$dest" 2>/dev/null; then
+        chmod 0644 -- "$dest" 2>/dev/null
+        return 0
+    fi
+    return 1

@@ table count (dual convention)
+    user_table_count=$(sqlite3 ... "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite\_%' ESCAPE '\';")
+    record "[INFO] memory.db table count: ${table_count} raw (... includes sqlite_* bookkeeping) / ${user_table_count} excluding sqlite_* (matches \`sqlite3 <db> .tables | wc -w\`)"

@@ persona copy
+    rm -f -- "$persona_dest" 2>/dev/null
-    if cp -- "$persona_src" "$persona_dest" 2>/dev/null; then
+    if cp -- "$persona_src" "$persona_dest" 2>/dev/null && chmod 0644 -- "$persona_dest" 2>/dev/null; then
```

(full diff shown above in tool output; unrelated `LYKOI_REPO`/`LYKOI_BACKUP_DIR`/SKIP changes were pre-existing uncommitted work from a prior session, not part of this fix.)

## diff — docs/runbook_disaster_recovery.md

Added: **幂等性** subsection (workdir 清空/`--keep` 语义) and **table count 统计口径** subsection under 验证清单 §4.1. Full text shown above.

## bash -n

```
SYNTAX_OK
```

## 幂等性验证方法

未止于逻辑走查，构建了合成 fixture（`memory.db` 含一张 `AUTOINCREMENT` 表以复现 `sqlite_sequence`；persona 源文件权限设为默认只读拷贝行为会产生的等价状态），针对修正后的脚本同一 `$WORKDIR` 连续跑 3 次（含一次 `--keep`）：

- 3 次 exit code 一致（`1`，因 fixture 无真实活体 persona 导致 diff 不匹配，属预期，非本次要修的 bug）
- 无一次出现 `[FAIL] persona TOML: failed to copy ...`
- 第 2、3 次输出可见 `# workdir exists and is non-empty, clearing and rebuilding ...` 提示行
- workdir 内产物全部为 `-rw-r--r-- (0644)`
- `--keep` 模式下不清空目录，同样不因旧文件只读而报错（每个写入点自带 `rm -f` + `chmod 0644`，与清空策略是两层独立保险）

逻辑走查覆盖的写入点：`extract_gz()`（4 个 `.db` 解压目标）、persona `cp` 目标；`core_artifacts.tar.gz` 未在脚本中解包（仅存在性检查），无需处理。

## 表计数口径结论

`sqlite_master WHERE type='table'` 原始计数会包含 SQLite 内部记账表 `sqlite_sequence`（由任意表的 `AUTOINCREMENT` 列触发自动创建）；`sqlite3 <db> .tables` 默认会过滤掉 `sqlite_%` 前缀的表。二者对同一库计数必然相差 1（若恰好存在一张 `sqlite_sequence`）。fixture 实测复现：raw=2 / excluding sqlite_\*=1，与「20 vs 21」的偏差方向和幅度一致。**结论：非表丢失/多出，是统计口径差异**——脚本现同时输出两个数字并标注口径，主治理 Agent 后续核对表数量时应以脚本标注的口径对齐，不再需要额外确认。
