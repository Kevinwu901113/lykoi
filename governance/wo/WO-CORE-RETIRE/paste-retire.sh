#!/bin/bash
# ============================================================================
# WO-CORE-RETIRE · 旧体退役粘贴稿（root 执行，单稿一次跑完；归档不删除）
# ============================================================================
# 定案：D-RET-1 归档不删除（唯一例外 crontab -r，删前全文存档）；
#       D-RET-2 旧单元一律 mask；D-RET-3 state 白名单外科移动；
#       D-RET-4 lykoi crontab 整表退役（新体零 cron）。
# 定序：本稿必须先于 WO-STATE-CANON 落地稿（D-SC-3：僵尸通知轮询器先死，
#       canonical notifications.json 才许回连）。
# 断言一律显式 if/exit（教训 48）。幂等：跑一半断了可整稿重跑。
set -euo pipefail

ARCH=/home/lykoi/archive/old-body-20260901
RARCH=/root/archive-old-body-20260901
STATE=/home/lykoi/state
CURSOR=$STATE/notify_push.cursor

echo '== 1 · 前验 =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
if ! systemctl is-active --quiet lykoi-cordis; then
  echo 'FATAL: 新体不在 active，先排障再退役'; exit 1
fi
mkdir -p "$ARCH/state" "$RARCH/sbin"
chown root:root /home/lykoi/archive "$ARCH" "$ARCH/state"
chmod 700 /home/lykoi/archive "$ARCH"

echo '== 2 · crontab 存档与退役（D-RET-4）=='
T0=$(date +%s)
if crontab -l -u lykoi > "$ARCH/crontab-lykoi.txt" 2>/dev/null; then
  echo '--- lykoi crontab（已存档，即将整表移除）：'
  cat "$ARCH/crontab-lykoi.txt"
  crontab -r -u lykoi
  echo '--- lykoi crontab 已移除'
else
  echo '--- lykoi 无 crontab（僵尸写者另有其人，稿末 mtime 核验会揭穿）'
  echo '(no crontab)' > "$ARCH/crontab-lykoi.txt"
fi
echo '--- root crontab（只取证不动）：'
crontab -l -u root 2>/dev/null || echo '(no root crontab)'
if grep -rn lykoi /etc/crontab /etc/cron.d/ 2>/dev/null | grep -v cordis; then
  echo 'WARN: /etc/cron* 有 lykoi 相关行（见上），本稿不动，待治理跟单'
fi

echo '== 3 · 旧核心单元 mask（D-RET-2）=='
for u in lykoi-core.service lykoi-server.service lykoi-autonomy.service \
         lykoi-watchdog.service lykoi-telegram.service \
         lykoi-gate-readout.service lykoi-gate-readout.timer; do
  systemctl disable --now "$u" 2>/dev/null || true
  systemctl mask "$u"
done
echo 'old core units masked: OK'

echo '== 4 · 浏览器栈停用 + browser-profile 封存（M5 章程）=='
for u in lykoi-chrome.service lykoi-novnc.service lykoi-vnc.service \
         lykoi-fluxbox.service lykoi-xvfb.service; do
  systemctl disable --now "$u" 2>/dev/null || true
  systemctl mask "$u"
done
if [ -d /home/lykoi/browser-profile ]; then
  mv /home/lykoi/browser-profile "$ARCH/browser-profile"
fi
if [ -d "$ARCH/browser-profile" ]; then
  chown root:root "$ARCH/browser-profile"
  chmod 700 "$ARCH/browser-profile"
  echo 'browser stack masked, profile sealed: OK'
else
  echo 'WARN: browser-profile 目录不存在（或早已封存）'
fi

echo '== 5 · 旧控制器归档（root 域）=='
for f in /usr/local/sbin/lykoi-core-v1-* \
         /usr/local/sbin/lykoi-deepseek-v4-compat-apply \
         /usr/local/sbin/lykoi-gate-readout \
         /usr/local/bin/lykoi-admin; do
  [ -e "$f" ] && mv "$f" "$RARCH/sbin/"
done
if [ ! -e /usr/local/sbin/lykoi-cordis-watchdog.sh ]; then
  echo 'FATAL: cordis watchdog 探针失踪（不应被本步移动）'; exit 1
fi
echo "controllers archived: $(ls "$RARCH/sbin/" | wc -l) 件"

echo '== 6 · 旧仓库封存 =='
for d in lykoi lykoi-ui; do
  if [ -d "/home/lykoi/projects/$d" ]; then
    mv "/home/lykoi/projects/$d" "$ARCH/projects-$d"
    chown root:root "$ARCH/projects-$d"
    chmod 700 "$ARCH/projects-$d"
  fi
done
echo 'old repos sealed: OK'

echo '== 7 · state 外科归档（D-RET-3 白名单，canonical 面一个不动）=='
OLD_STATE=(
  core_facts.db core_facts.db.epoch.lock core_facts.db.init.lock
  core_artifacts core_artifacts.usage.json
  events.jsonl watchdog.jsonl soak_watch.log screenshots
  autonomy.lock interactive_activity.json
  restart_marker.json
  telegram_cursor.json telegram_cursor.json.lock
  continuations.json continuations.json.lock
  messenger_inbound.json messenger_inbound.json.lock
  notify_push.cursor notify_push.lock
  percept_buffer.db permission_evidence_shadow.db
  p4_trial_t0.env audit.jsonl backups
  memory.db.pre_p4.20260619T222000+0800
  memory.db.pre_V3.20260615T123611Z
  memory.db.pre_V4.20260615T123611Z
  '*.sqlite3'
)
MOVED=0
for f in "${OLD_STATE[@]}"; do
  if [ -e "$STATE/$f" ]; then
    mv -- "$STATE/$f" "$ARCH/state/"
    MOVED=$((MOVED+1))
  fi
done
echo "archived from state: $MOVED 项"
echo '--- state 剩余（应全部属 canonical/新体活面）：'
ls -la "$STATE"

echo '== 8 · 僵尸写者死亡核验（写者按原位路径写，窗口期后不得重现）=='
ELAPSED=$(( $(date +%s) - T0 ))
if [ "$ELAPSED" -lt 135 ]; then sleep $(( 135 - ELAPSED )); fi
if [ -e "$STATE/notify_push.cursor" ] || [ -e "$STATE/notify_push.lock" ]; then
  echo 'FATAL: notify_push.* 在原位重现——写者未死（不是 lykoi cron），须治理跟单'
  ls -la "$STATE"/notify_push.* 2>/dev/null
  exit 1
fi
echo 'zombie writer dead: OK'

echo '== 9 · 新体冷启核验 =='
systemctl restart lykoi-cordis
sleep 8
if ! systemctl is-active --quiet lykoi-cordis; then
  echo 'FATAL: 退役后新体起不来 —— 立即联系治理侧（归档全部可 mv 回滚）'
  journalctl -u lykoi-cordis -n 30 --no-pager
  exit 1
fi
if ! journalctl -u lykoi-cordis -n 30 --no-pager | grep -q 'production assembly up'; then
  echo 'FATAL: 未见 production assembly up'; exit 1
fi
echo 'cold start after retire: OK'
journalctl -u lykoi-cordis -n 14 --no-pager | tail -8

echo '== 10 · 记账与清单 =='
ls -la "$ARCH" "$RARCH/sbin" | head -50
if [ -d /home/lykoi-gov/reports ]; then
  printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"retire","wo":"WO-CORE-RETIRE","detail":"旧体退役：lykoi crontab 整表退役、旧单元+浏览器栈 mask、browser-profile 封存、控制器/旧仓库归档、state 白名单外科归档；新体冷启核验通过"}' \
    >> /home/lykoi-gov/reports/governance-ops.jsonl
fi
echo '== 退役完成：旧体全部机件封存，回滚材料在上述两个封存区。 =='
echo '== 下一稿：WO-STATE-CANON 落地（canonical 调和），等治理侧送达。 =='
