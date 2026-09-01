#!/bin/bash
# WO-BACKUP-OFFSITE-01 · 新体异地备份链 root 安装粘贴稿 v2（2026-09-01 治理侧主笔）
# 用法：Kevin root 会话整段执行。可重复执行（幂等覆盖安装，重跑覆盖当日产物）。
# 纪律：断言一律显式 if/exit（禁 [ … ] && echo，set -e AND-OR 豁免教训）。
# v2 修复 v1 两缺陷（v1 首跑产物缺两库，作废）：
#   ① tar --exclude='./memory.db' 为全局模式，把暂存区快照一并排掉 → 改两步
#      tar：先建 state 包（带 exclude），再无 exclude 追加快照，最后 gzip；
#   ② 验证段 N_DB=$(…|grep -c…) 计数 0 时 grep 退出 1 被 set -e 静默击杀，
#      FAIL 行未达 → grep 后置 || true；且包内容自检下沉进备份脚本本体，
#      每日运行自证，不止装机时查一次。
set -euo pipefail

echo "== 0. 前验 =="
if [ ! -d /home/lykoi/state ]; then
  echo "FAIL: /home/lykoi/state 不存在"; exit 1
fi
if [ ! -f /home/lykoi/state/memory.db ]; then
  echo "FAIL: memory.db 不在 /home/lykoi/state"; exit 1
fi
if ! command -v sqlite3 >/dev/null; then
  echo "FAIL: sqlite3 不在 PATH"; exit 1
fi
if [ ! -f /home/lykoi/runtime/persona/lykoi_base.toml ]; then
  echo "WARN: persona TOML 不在预期路径（元数据将记 unreadable，不阻塞）"
fi
echo "前验通过"

echo "== 1. 安装备份脚本（root 属主、以 lykoi 身份运行） =="
cat > /usr/local/sbin/lykoi-cordis-backup.sh <<'EOS'
#!/bin/bash
# 新体每日 state 备份 v2：sqlite 在线一致性快照 + 全 state 打包 + 装配指纹。
# 由 lykoi-cordis-backup.service（User=lykoi）调用；产物落 state/backups/
# 供 Mac 拉取腿（pull_server_backups.sh，源 state/backups/）零改动取走。
set -euo pipefail
STATE=/home/lykoi/state
DEST="$STATE/backups"
DATE=$(date +%Y%m%d)
ART="$DEST/lykoi-state-$DATE.tar.gz"
mkdir -p "$DEST"
STAGING=$(mktemp -d "$DEST/.staging.XXXXXX")
trap 'rm -rf "$STAGING"' EXIT
mkdir -p "$STAGING/snap"

# ① sqlite 在线快照（服务在跑，禁裸 cp）
sqlite3 "$STATE/memory.db" ".backup '$STAGING/snap/memory.db'"
IC=$(sqlite3 "$STAGING/snap/memory.db" "PRAGMA integrity_check;")
if [ "$IC" != "ok" ]; then
  echo "FAIL: memory.db 快照 integrity_check: $IC" >&2; exit 1
fi
if [ -f "$STATE/salience_shadow.db" ]; then
  sqlite3 "$STATE/salience_shadow.db" ".backup '$STAGING/snap/salience_shadow.db'"
  IC2=$(sqlite3 "$STAGING/snap/salience_shadow.db" "PRAGMA integrity_check;")
  if [ "$IC2" != "ok" ]; then
    echo "FAIL: salience_shadow.db 快照 integrity_check: $IC2" >&2; exit 1
  fi
fi

# ② 装配指纹（重建元数据，非 secrets）
{
  echo "created=$(date -Is)"
  echo "repo_head=$(git -c safe.directory=/home/lykoi/projects/lykoi-cordis \
    -C /home/lykoi/projects/lykoi-cordis rev-parse HEAD 2>/dev/null || echo unknown)"
  echo "persona_sha256=$(sha256sum /home/lykoi/runtime/persona/lykoi_base.toml \
    2>/dev/null | cut -d' ' -f1 || echo unreadable)"
  echo "units=$(systemctl list-unit-files 'lykoi*' --no-legend 2>/dev/null \
    | tr '\n' ';' || true)"
} > "$STAGING/snap/deployment-meta.txt"

# ③ 打包（v2 两步）：第一步建 state 包（exclude 只波及这一步），第二步
# 无 exclude 追加 snap/ 内快照（成员名 ./memory.db 等，不再被模式误伤）。
# 活服务写 json 可能触发 tar rc=1（file changed），属可接受告警级；>1 才失败。
BUNDLE="$STAGING/bundle.tar"
RC=0
tar -cf "$BUNDLE" \
  -C "$STATE" --exclude='./backups' --exclude='./memory.db' \
  --exclude='./salience_shadow.db' . || RC=$?
if [ "$RC" -gt 1 ]; then
  echo "FAIL: tar create rc=$RC" >&2; exit 1
fi
RC=0
tar -rf "$BUNDLE" -C "$STAGING/snap" . || RC=$?
if [ "$RC" -ne 0 ]; then
  echo "FAIL: tar append rc=$RC" >&2; exit 1
fi
gzip -c "$BUNDLE" > "$ART.tmp"

# ③b 每日自检：产物必须真含两库快照与元数据（v1 教训：装完不等于装对）
N_DB=$(tar -tzf "$ART.tmp" | grep -c '^\./memory\.db$' || true)
if [ "$N_DB" -ne 1 ]; then
  echo "FAIL: 包内 ./memory.db 计数=$N_DB（应为 1）" >&2; rm -f "$ART.tmp"; exit 1
fi
N_META=$(tar -tzf "$ART.tmp" | grep -c '^\./deployment-meta\.txt$' || true)
if [ "$N_META" -ne 1 ]; then
  echo "FAIL: 包内缺 deployment-meta.txt" >&2; rm -f "$ART.tmp"; exit 1
fi
if [ -f "$STATE/salience_shadow.db" ]; then
  N_SAL=$(tar -tzf "$ART.tmp" | grep -c '^\./salience_shadow\.db$' || true)
  if [ "$N_SAL" -ne 1 ]; then
    echo "FAIL: 包内 ./salience_shadow.db 计数=$N_SAL（应为 1）" >&2; rm -f "$ART.tmp"; exit 1
  fi
fi
mv "$ART.tmp" "$ART"
( cd "$DEST" && sha256sum "$(basename "$ART")" > "$(basename "$ART").sha256" )

# ④ 轮转：保留 14 天
find "$DEST" -maxdepth 1 -name 'lykoi-state-*.tar.gz' -mtime +14 -delete
find "$DEST" -maxdepth 1 -name 'lykoi-state-*.tar.gz.sha256' -mtime +14 -delete

echo "backup ok: $ART ($(du -h "$ART" | cut -f1))"
EOS
chown root:root /usr/local/sbin/lykoi-cordis-backup.sh
chmod 755 /usr/local/sbin/lykoi-cordis-backup.sh
echo "脚本已装 /usr/local/sbin/lykoi-cordis-backup.sh"

echo "== 2. 安装 service + timer（与 v1 相同，幂等覆盖） =="
cat > /etc/systemd/system/lykoi-cordis-backup.service <<'EOU'
[Unit]
Description=Lykoi Cordis daily state backup (WO-BACKUP-OFFSITE-01)

[Service]
Type=oneshot
User=lykoi
Group=lykoi
Nice=10
ExecStart=/usr/local/sbin/lykoi-cordis-backup.sh
EOU
cat > /etc/systemd/system/lykoi-cordis-backup.timer <<'EOU'
[Unit]
Description=Daily trigger for lykoi-cordis-backup (01:30 CST, before Mac pull)

[Timer]
OnCalendar=*-*-* 01:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOU
systemctl daemon-reload
systemctl enable --now lykoi-cordis-backup.timer
echo "timer 已启用"

echo "== 3. 首跑 + 验证 =="
systemctl start lykoi-cordis-backup.service
ART=$(ls -t /home/lykoi/state/backups/lykoi-state-*.tar.gz 2>/dev/null | head -1)
if [ -z "$ART" ]; then
  echo "FAIL: 首跑后无产物"; journalctl -u lykoi-cordis-backup.service --no-pager | tail -20; exit 1
fi
if ! ( cd /home/lykoi/state/backups && sha256sum -c "$(basename "$ART").sha256" ); then
  echo "FAIL: sha256 对账不过"; exit 1
fi
N_DB=$(tar -tzf "$ART" | grep -c '^\./memory\.db$' || true)
if [ "$N_DB" -ne 1 ]; then
  echo "FAIL: 包内 ./memory.db 计数=$N_DB（应为 1）"; exit 1
fi
N_SAL=$(tar -tzf "$ART" | grep -c '^\./salience_shadow\.db$' || true)
if [ "$N_SAL" -ne 1 ]; then
  echo "FAIL: 包内 ./salience_shadow.db 计数=$N_SAL（应为 1）"; exit 1
fi
if ! tar -tzf "$ART" | grep -q '^\./deployment-meta\.txt$'; then
  echo "FAIL: 包内缺 deployment-meta.txt"; exit 1
fi
SIZE_BYTES=$(stat -c %s "$ART")
if [ "$SIZE_BYTES" -lt 1000000 ]; then
  echo "FAIL: 产物仅 $SIZE_BYTES 字节，装不下 18M 库的快照（v1 症状复现）"; exit 1
fi
echo "--- 产物与定时器 ---"
ls -la /home/lykoi/state/backups/
systemctl list-timers lykoi-cordis-backup.timer --no-pager
echo "ALL GREEN: 服务器侧备份链就绪（v2）。请把从 == 3 == 起的输出贴回治理侧。"
