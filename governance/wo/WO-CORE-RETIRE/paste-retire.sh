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
# 修订 v2（2026-09-01，首跑实录）：首跑完成步 1/2 后在步 3 中止——旧单元文件
# 实住 /etc/systemd/system/（真文件），mask 造 /dev/null 软链撞真文件被拒。
# 修法：disable→单元文件归档至 $RARCH/units/（D-RET-1 归档不删除）→mask
#（腾位后成立）→daemon-reload。同修两处重跑隐患：步 2 重跑不再截断已存档
# 的 crontab 正本（重定向先截断后失败的坑）；步 7 白名单 glob 条目真展开
#（原写法引号内字面量永不匹配）。
# 修订 v3（2026-09-01，二跑实录）：二跑在步 7 audit.jsonl 中止——旧体给审计
# 上了 chattr 追加/不可变属性，rename 连 root 都拒。修法：移动前摘 i/a 属性，
# 归档后把 append-only 原样补回（封存件继续防篡改）。
# 修订 v4（2026-09-01，三跑实录）：三跑步 1–8 全成，步 9 冷启被完整性门拒——
# 旧仓封存后 kernel 禁区表 PROTECTED_PATHS 的旧 guardian base 解析失败，
# SK-74 fail-closed 使护栏全封锁，检查项④双 FAIL（门按设计履职）。修法归
# WO-GUARD-RETIRE（代码侧退役，随落地稿 B 上产线）；本稿步 9 改为：产线树
# 尚未含该修法时，冷启核验**顺延到落地稿 B**（她保持停机），树已含则照常核验。
set -euo pipefail

ARCH=/home/lykoi/archive/old-body-20260901
RARCH=/root/archive-old-body-20260901
STATE=/home/lykoi/state
CURSOR=$STATE/notify_push.cursor
REPO=/home/lykoi/projects/lykoi-cordis

echo '== 1 · 前验 =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
# v4：新体 active 前验降为记录——三跑后她因检查项④预期停机（见 v4 修订注），
# 「须 active」若仍硬断言，本稿将永远无法收尾。
if systemctl is-active --quiet lykoi-cordis; then
  echo '--- 新体 active（正常在线形态）'
else
  echo '--- 新体不在 active（v4 预期形态：等落地稿 B；见修订注）'
fi
mkdir -p "$ARCH/state" "$RARCH/sbin" "$RARCH/units"
chown root:root /home/lykoi/archive "$ARCH" "$ARCH/state"
chmod 700 /home/lykoi/archive "$ARCH"

echo '== 2 · crontab 存档与退役（D-RET-4）=='
T0=$(date +%s)
CRONTMP=$(mktemp)
if crontab -l -u lykoi > "$CRONTMP" 2>/dev/null; then
  cp "$CRONTMP" "$ARCH/crontab-lykoi.txt"
  echo '--- lykoi crontab（已存档，即将整表移除）：'
  cat "$ARCH/crontab-lykoi.txt"
  crontab -r -u lykoi
  echo '--- lykoi crontab 已移除'
else
  echo '--- lykoi 无 crontab（首跑已退役，或写者另有其人——步 8 会揭穿）'
  if [ ! -e "$ARCH/crontab-lykoi.txt" ]; then
    echo '(no crontab)' > "$ARCH/crontab-lykoi.txt"
  fi
fi
rm -f "$CRONTMP"
echo '--- root crontab（只取证不动）：'
crontab -l -u root 2>/dev/null || echo '(no root crontab)'
if grep -rn lykoi /etc/crontab /etc/cron.d/ 2>/dev/null | grep -v cordis; then
  echo 'WARN: /etc/cron* 有 lykoi 相关行（见上），本稿不动，待治理跟单'
fi

# 退役一个旧单元：disable+stop → 单元文件（真文件或指旧仓的软链）归档腾位
# → mask。已 mask 的幂等跳过。绝不受理新体单元。
retire_unit() {
  u=$1
  case "$u" in *cordis*) echo "FATAL: retire_unit 拒收新体单元 $u"; exit 1;; esac
  if [ -L "/etc/systemd/system/$u" ] \
     && [ "$(readlink "/etc/systemd/system/$u")" = /dev/null ]; then
    echo "    $u: 已 mask（幂等跳过）"
    return 0
  fi
  systemctl disable --now "$u" 2>/dev/null || true
  if [ -e "/etc/systemd/system/$u" ] || [ -L "/etc/systemd/system/$u" ]; then
    mv "/etc/systemd/system/$u" "$RARCH/units/$u"
  fi
  if [ -d "/etc/systemd/system/$u.d" ]; then
    mv "/etc/systemd/system/$u.d" "$RARCH/units/$u.d"
  fi
  systemctl mask "$u"
}

echo '== 3 · 旧核心单元退役（D-RET-2：归档单元文件 + mask 占名）=='
for u in lykoi-core.service lykoi-server.service lykoi-autonomy.service \
         lykoi-watchdog.service lykoi-telegram.service \
         lykoi-gate-readout.service lykoi-gate-readout.timer; do
  retire_unit "$u"
done
systemctl daemon-reload
echo 'old core units retired+masked: OK'

echo '== 4 · 浏览器栈停用 + browser-profile 封存（M5 章程）=='
for u in lykoi-chrome.service lykoi-novnc.service lykoi-vnc.service \
         lykoi-fluxbox.service lykoi-xvfb.service; do
  retire_unit "$u"
done
systemctl daemon-reload
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
  for p in $STATE/$f; do
    if [ -e "$p" ]; then
      # 旧体部分文件带 chattr 追加/不可变属性（如 audit.jsonl +a），
      # rename 连 root 都拒；先摘属性，append-only 归档后补回。
      ATTRS=$(lsattr -d -- "$p" 2>/dev/null | awk '{print $1}') || ATTRS=''
      case "$ATTRS" in *a*|*i*) chattr -ia -- "$p";; esac
      mv -- "$p" "$ARCH/state/"
      case "$ATTRS" in *a*) chattr +a -- "$ARCH/state/$(basename "$p")";; esac
      MOVED=$((MOVED+1))
    fi
  done
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
if grep -q "projects/lykoi/guardian'" "$REPO/packages/lykoi-kernel/src/policy-core.ts"; then
  echo '>> 产线树尚未含 WO-GUARD-RETIRE（护栏禁区表仍有旧 guardian 条目）。'
  echo '>> 旧仓已封存 → 该树被完整性门检查项④拦启动是**预期**（fail-closed 履职）。'
  echo '>> 冷启核验顺延到落地稿 B（树重钉 + manifest 重签 + 起立断言在彼处）。'
  systemctl stop lykoi-cordis 2>/dev/null || true
  COLDSTART='deferred-to-landing-b'
  echo 'cold start: DEFERRED（服务保持停机，等落地稿 B）'
else
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
  COLDSTART='ok'
  echo 'cold start after retire: OK'
  journalctl -u lykoi-cordis -n 14 --no-pager | tail -8
fi

echo '== 10 · 记账与清单 =='
ls -la "$ARCH" "$RARCH/sbin" | head -50
if [ -d /home/lykoi-gov/reports ]; then
  printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"retire","wo":"WO-CORE-RETIRE","detail":"旧体退役：lykoi crontab 整表退役、旧单元+浏览器栈退役（单元文件归档+mask）、browser-profile 封存、控制器/旧仓库归档、state 白名单外科归档、僵尸写者死亡核验通过；冷启核验='"$COLDSTART"'"}' \
    >> /home/lykoi-gov/reports/governance-ops.jsonl
fi
echo '== 退役完成：旧体全部机件封存，回滚材料在上述两个封存区。 =='
echo '== 下一稿：WO-STATE-CANON 落地（canonical 调和），等治理侧送达。 =='
