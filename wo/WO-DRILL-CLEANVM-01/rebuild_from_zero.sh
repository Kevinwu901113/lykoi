#!/usr/bin/env bash
# rebuild_from_zero.sh — 在干净 Ubuntu 24.04 (amd64) 机器上从备份重建 Lykoi
#
# 用途：灾难恢复演练 / 真实灾难恢复。以 root 在目标机内运行。
# 输入（放在 $INPUT，默认 /root/rebuild-input）：
#   lykoi.bundle                 — git bundle（含 main @ 期望 HEAD）
#   deployment_config.tar.gz     — BACKUP-03 非密钥部署配置包
#   constraints.txt              — 活体 venv 的 pip freeze（锁定依赖版本）
#   state/<13 项同一 STAMP 的备份文件>
# 环境变量：
#   STAMP        必填，如 20260809T032908Z
#   PROXY        可选，apt/pip 出口代理（家内网：http://192.168.0.202:7890）
#   WITH_CHROME  可选，=1 时尝试安装 google-chrome-stable（deb 需外网）
#   REAL_SECRETS 可选，=1 表示 owner 已把真实 secrets 放进 /home/lykoi/secrets/
#                （默认写占位值——服务能启动，LLM/推送调用会失败，属预期）
#
# 与灾难手册（runbook_disaster_recovery.md）的关系：本脚本实现其 §2 的落点表 +
# §3 的部署层重建，并按活体实测修正了两处：persona TOML 为 0440（手册写 0640）、
# governance flags 为 narrative_injection.on(0444) + self_state_injection.on(0400)。
set -uo pipefail

INPUT=${INPUT:-/root/rebuild-input}
STAMP=${STAMP:?need STAMP, e.g. 20260809T032908Z}
PROXY=${PROXY:-}
LOG=/root/rebuild.log
PASS=0; FAIL=0
say()  { echo "[STEP] $*" | tee -a "$LOG"; }
ok()   { echo "[OK]   $*" | tee -a "$LOG"; PASS=$((PASS+1)); }
bad()  { echo "[FAIL] $*" | tee -a "$LOG"; FAIL=$((FAIL+1)); }
note() { echo "[NOTE] $*" | tee -a "$LOG"; }

say "0. 前置检查"
grep -q " $(hostname)" /etc/hosts || echo "127.0.1.1 $(hostname)" >> /etc/hosts
grep -q 'VERSION_ID="24.04"' /etc/os-release && ok "OS = Ubuntu 24.04" || bad "OS 不是 Ubuntu 24.04"
[ "$(uname -m)" = x86_64 ] && ok "arch = x86_64" || note "arch=$(uname -m)（生产为 amd64）"
for f in lykoi.bundle deployment_config.tar.gz constraints.txt; do
  [ -f "$INPUT/$f" ] && ok "输入存在: $f" || bad "缺输入: $f"
done
NSTATE=$(ls "$INPUT"/state/*"$STAMP"* 2>/dev/null | wc -l)
[ "$NSTATE" -ge 12 ] && ok "state 备份 $NSTATE 项 (STAMP=$STAMP)" || bad "state 备份仅 $NSTATE 项"

say "1. 账户：删 ubuntu，建 lykoi (uid/gid 1000)"
id ubuntu >/dev/null 2>&1 && userdel -r ubuntu 2>/dev/null
getent group lykoi >/dev/null || groupadd -g 1000 lykoi
id lykoi >/dev/null 2>&1 || useradd -m -u 1000 -g 1000 -s /bin/bash lykoi
[ "$(id -u lykoi)" = 1000 ] && ok "lykoi uid=1000" || bad "lykoi uid 异常"
note "治理账户 claude(1001) 不在本脚本范围（属治理平面，另行按协作方案重建）"

say "2. apt 安装运行时依赖"
if [ -n "$PROXY" ]; then
  printf 'Acquire::http::Proxy "%s";\nAcquire::https::Proxy "%s";\n' "$PROXY" "$PROXY" > /etc/apt/apt.conf.d/95rebuild-proxy
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >>"$LOG" 2>&1
apt-get install -y -qq python3-venv python3-pip sqlite3 git curl gzip \
  xvfb fluxbox x11vnc novnc websockify >>"$LOG" 2>&1 \
  && ok "apt 基础包 + 浏览器桌面栈(xvfb/fluxbox/x11vnc/novnc/websockify)" \
  || bad "apt 安装失败（看 $LOG）"
if [ "${WITH_CHROME:-0}" = 1 ]; then
  curl -fsSL ${PROXY:+-x "$PROXY"} -o /tmp/chrome.deb \
    https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb >>"$LOG" 2>&1 \
    && apt-get install -y -qq /tmp/chrome.deb >>"$LOG" 2>&1 \
    && ok "google-chrome-stable" || bad "chrome 安装失败"
else
  note "跳过 Chrome（WITH_CHROME=1 开启）；lykoi-chrome.service 将无法启动"
fi

say "3. 代码：从 git bundle 检出"
rm -rf /home/lykoi/projects/lykoi
git clone -q -b main "$INPUT/lykoi.bundle" /home/lykoi/projects/lykoi >>"$LOG" 2>&1 || bad "clone 失败"
# bundle 只含 refs/heads/main、无 HEAD，必须 -b main 才能检出工作树
chown -R lykoi:lykoi /home/lykoi/projects
cd /home/lykoi/projects/lykoi || bad "检出目录不存在"
HEAD=$(sudo -u lykoi git rev-parse HEAD)
ok "HEAD=$HEAD"

say "4. venv：按活体 freeze 锁版本重建"
install -m 0644 "$INPUT/constraints.txt" /tmp/constraints.txt
rm -rf .venv
sudo -u lykoi python3 -m venv .venv
sudo -u lykoi ${PROXY:+env http_proxy="$PROXY" https_proxy="$PROXY"} \
  .venv/bin/pip install -q -r requirements.txt -c /tmp/constraints.txt >>"$LOG" 2>&1 \
  && ok "venv + $( .venv/bin/pip list 2>/dev/null | tail -n +3 | wc -l ) 包" || bad "pip install 失败"
sudo -u lykoi .venv/bin/python -c "import lykoi" 2>>"$LOG" \
  && ok "import lykoi" \
  || { sudo -u lykoi env PYTHONPATH=/home/lykoi/projects/lykoi/src .venv/bin/python -c "import lykoi" 2>>"$LOG" \
       && note "import 需 PYTHONPATH=src（systemd 单元里应有对应设置）" || bad "import lykoi 失败"; }

say "5. 部署配置包：校验 + 按 MANIFEST 落位"
STG=/root/rebuild-staging; rm -rf "$STG"; mkdir -p "$STG"
tar xzf "$INPUT/deployment_config.tar.gz" -C "$STG"
( cd "$STG" && sha256sum -c metadata/SHA256SUMS --quiet ) && ok "SHA256SUMS 全部一致" || bad "配置包哈希校验失败"
grep -q "^$HEAD" "$STG/metadata/source-head.txt" && ok "source-head 与 bundle HEAD 一致" || note "source-head=$(head -1 "$STG/metadata/source-head.txt") ≠ HEAD=$HEAD"
N=0
while IFS=$'\t' read -r sha mode uid gid size path; do
  [ "$sha" = sha256 ] && continue
  install -D -m "$mode" -o "$uid" -g "$gid" "$STG/$path" "/$path" && N=$((N+1)) || bad "落位失败: /$path"
done < "$STG/metadata/MANIFEST.tsv"
ok "配置文件落位 $N 项（systemd 单元/drop-in、env 骨架、attention policy）"
note "/usr/local/sbin 17 个 apply 控制器内容不在备份内（设计如此），历史部署工具，运行时非必需"

say "6. secrets：占位或真值"
install -d -m 0700 -o lykoi -g lykoi /home/lykoi/secrets
if [ "${REAL_SECRETS:-0}" != 1 ]; then
  cat > /home/lykoi/secrets/llm.env <<'EOF'
LYKOI_DEEPSEEK_API_KEY=REHEARSAL_PLACEHOLDER
LYKOI_DEEPSEEK_BASE_URL=https://api.deepseek.com
LYKOI_MIMO_API_KEY=REHEARSAL_PLACEHOLDER
LYKOI_MIMO_BASE_URL=https://api.deepseek.com
EOF
  printf 'LYKOI_SURFACE_TOKEN=rehearsal-%s\n' "$(head -c16 /dev/urandom | md5sum | cut -c1-16)" > /home/lykoi/secrets/surface.env
  note "backup.env 未造占位（offsite_backup 在演练中不运行）"
  chown lykoi:lykoi /home/lykoi/secrets/*.env; chmod 0600 /home/lykoi/secrets/*.env
  note "REQUIRED_SECRETS 用占位值：服务应能启动，LLM/推送外呼会失败（演练预期内）"
fi

say "7. state 还原（灾难手册 §2 的 13 项）"
install -d -m 0750 -o lykoi -g lykoi /home/lykoi/state
S="$INPUT/state"
for db in memory core_facts salience_shadow permission_evidence_shadow; do
  gzip -dc "$S/$db.$STAMP.db.gz" > /home/lykoi/state/$db.db && chown lykoi:lykoi /home/lykoi/state/$db.db && chmod 0600 /home/lykoi/state/$db.db
  R=$(sqlite3 /home/lykoi/state/$db.db "PRAGMA integrity_check;" 2>>"$LOG")
  [ "$R" = ok ] && ok "$db.db integrity_check=ok" || bad "$db.db integrity_check=$R"
done
for j in events audit; do
  gzip -dc "$S/$j.$STAMP.jsonl.gz" > /home/lykoi/state/$j.jsonl && chown lykoi:lykoi /home/lykoi/state/$j.jsonl && chmod 0600 /home/lykoi/state/$j.jsonl
done
for j in approval_rules pending_actions; do
  gzip -dc "$S/$j.$STAMP.json.gz" > /home/lykoi/state/$j.json && chown lykoi:lykoi /home/lykoi/state/$j.json && chmod 0600 /home/lykoi/state/$j.json
done
tar xzf "$S/core_artifacts.$STAMP.tar.gz" -C /home/lykoi/state/ && chown -R lykoi:lykoi /home/lykoi/state/core_artifacts 2>/dev/null
ok "events/audit/approval_rules/pending_actions/core_artifacts 落位"
install -d -m 0750 -o root -g lykoi /var/log/lykoi-audit
chattr -a /var/log/lykoi-audit/audit.jsonl 2>/dev/null || true
gzip -dc "$S/audit_log.$STAMP.jsonl.gz" > /var/log/lykoi-audit/audit.jsonl
chown root:lykoi /var/log/lykoi-audit/audit.jsonl && chmod 0660 /var/log/lykoi-audit/audit.jsonl
chattr +a /var/log/lykoi-audit/audit.jsonl 2>>"$LOG" \
  && ok "审计正本 root:lykoi 0660 + append-only(chattr +a)" \
  || bad "chattr +a 失败（需 CAP_LINUX_IMMUTABLE；非特权容器设不了，startup_verify 会拒绝）"
install -d -m 0775 -o lykoi -g lykoi /home/lykoi/runtime
install -d -m 0755 -o root -g root /home/lykoi/runtime/persona
install -m 0440 -o root -g lykoi "$S/lykoi_base_persona.$STAMP.toml" /home/lykoi/runtime/persona/lykoi_base.toml
ok "persona TOML (root:lykoi 0440，活体实测值；手册 §2 写 0640 应修订)"
install -d -m 0755 -o root -g root /home/lykoi/runtime/governance
touch /home/lykoi/runtime/governance/narrative_injection.on && chmod 0444 /home/lykoi/runtime/governance/narrative_injection.on
touch /home/lykoi/runtime/governance/self_state_injection.on && chmod 0400 /home/lykoi/runtime/governance/self_state_injection.on
chown root:root /home/lykoi/runtime/governance/*.on
ok "governance flags 按 $STAMP 快照重建（2 项，root-only）"
install -d -m 0755 -o lykoi -g lykoi /home/lykoi/workspace/autonomy /home/lykoi/browser-profile
sudo -u lykoi mkdir -p /home/lykoi/state/backups/daily
note "workspace/autonomy（P3 CWD 隔离落点）与 browser-profile 已建"

say "8. 权限位复刻：guardian root-only + src 内 44 个 root 属主路径"
cd /home/lykoi/projects/lykoi
# 字节码缓存的规范态是"不存在"（startup_verify: rollout removes these caches；
# 存在时会被 pin 属主检查拒绝——venv 安装期间以 lykoi 生成的 pyc 会卡启动门）
find . -name __pycache__ -prune -exec rm -rf {} +
chown -R root:root guardian
find guardian -maxdepth 1 -type f -exec chmod 0444 {} +
chmod 0555 guardian
ok "guardian/ = root:root, dir 555, files 444；全仓 __pycache__ 已清"
while read -r p; do
  rp="${p#/home/lykoi/projects/lykoi/}"
  [ -e "$rp" ] || { note "root 属主清单路径不存在: $rp"; continue; }
  chown root:root "$rp"
  if [ -d "$rp" ]; then chmod 0755 "$rp"; else chmod 0644 "$rp"; fi
done < "$INPUT/root-owned.list"
ok "src 内 root 属主路径按活体清单复刻（服务账户不可改核心/脱敏器）"

say "9. 启动门：以 lykoi 身份跑 startup_verify"
sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py >>"$LOG" 2>&1
RC=$?
[ $RC -eq 0 ] && ok "startup_verify (lykoi) exit=0" || bad "startup_verify exit=$RC（看 $LOG 末尾）"

say "10. systemd：enable + 分层启动"
systemctl daemon-reload
UNITS_DESKTOP="lykoi-xvfb lykoi-fluxbox lykoi-vnc lykoi-novnc"
UNITS_CORE="lykoi-watchdog lykoi-core lykoi-server lykoi-autonomy"
systemctl enable $UNITS_DESKTOP $UNITS_CORE lykoi-chrome >>"$LOG" 2>&1
systemctl start $UNITS_DESKTOP >>"$LOG" 2>&1; sleep 3
[ "${WITH_CHROME:-0}" = 1 ] && systemctl start lykoi-chrome >>"$LOG" 2>&1
systemctl start $UNITS_CORE >>"$LOG" 2>&1; sleep 8
for u in $UNITS_DESKTOP $UNITS_CORE; do
  ST=$(systemctl is-active $u); NR=$(systemctl show $u -p NRestarts --value)
  if [ "$ST" = active ]; then ok "$u active (NRestarts=$NR)"; else bad "$u $ST (NRestarts=$NR)"; fi
done

say "11. 健康检查"
sleep 3
H=$(curl -fsS -m 10 http://127.0.0.1:8080/health 2>>"$LOG")
echo "$H" | tee -a "$LOG"
echo "$H" | grep -q '"status":"ok"' && ok "/health status=ok" || bad "/health 异常"
echo "$H" | grep -q browser_request_guard && note "browser_request_guard=$(echo "$H" | grep -o '"browser_request_guard":"[^"]*"')"

say "12. crontab（记录但默认不安装）"
note "生产 crontab 2 项（notify_push 每分钟 / offsite_backup 04:17）演练中不安装，避免占位密钥外呼噪音；真实恢复时: crontab -u lykoi <(生成自 metadata/lykoi.crontab)"

echo "==================================================" | tee -a "$LOG"
echo "REBUILD VERDICT: PASS=$PASS FAIL=$FAIL" | tee -a "$LOG"
[ $FAIL -eq 0 ] && echo "ALL GREEN" | tee -a "$LOG"
exit $FAIL
