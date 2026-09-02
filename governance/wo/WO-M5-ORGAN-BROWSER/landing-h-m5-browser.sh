#!/bin/bash
# LANDING-H v2 · WO-M5-ORGAN-BROWSER 落地（v1 在 §6 npm ci 后因 init-state.ts 模式漂移 FATAL；v2 修 npm 的 Node 版本与模式恢复，可从头重跑） —— 产线树 main@481e6d2 → main@482d644
# 本单：零迁移、零 schema 变更；装配面 +1 器官位（browser）；新依赖 playwright-core 1.60.0；
# 新 OS 用户 lykoi-browser + 新 unit lykoi-browser.service + /etc/lykoi-browser/host.json。
# manifest 106 → 113（新包 package.json + 6 个 src），须 root 重签。
# 停机形态（LANDING-G 实证）：大脑用 `systemctl stop`（保持 enabled），不用 disable --now，
#   否则 InactiveEnterTimestamp 被卸掉、重启线索的 downtime 结构性为空。
# 用法：先落盘再执行（交互 shell 直接粘贴时 set -e 遇 FATAL 会关掉会话）：
#   sha256sum /tmp/landing-h-m5-browser.sh   # 须 = 治理侧给出的值
#   sudo bash /tmp/landing-h-m5-browser.sh 2>&1 | tee /root/landing-h-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
NODE=/opt/node-v24.18.0/bin/node
NPM=/opt/node-v24.18.0/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
DB=/home/lykoi/state/memory.db
EXPECT_OLD=481e6d25ff9361558eda58ff97388ae70072de1a
NEW_SHA=482d644dee797e574402d15fa2e17338ecf56f0a
BUNDLE=/tmp/lykoi-landing-h.bundle
BUNDLE_SHA=d918b215419d6988fd674a7fe815b8b54e3f333cc11cc3018169b49496182300
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
BUSER=lykoi-browser
BHOME=/home/lykoi-browser
PROXY_PROBE=http://192.168.0.202:7890/   # 已知在听的私网地址（大脑的 Telegram 代理），只用来验出网闸
AUDIT=/var/log/lykoi-audit/audit.jsonl

echo '== 0 · 前验（全部只读；任何一条不过则整稿未动） =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
echo "$BUNDLE_SHA  $BUNDLE" | sha256sum -c -
echo "$PERSONA_SHA  $PERSONA" | sha256sum -c -
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO" \
  || git config --global --add safe.directory "$REPO"
cd "$REPO"
HEAD_NOW=$(git rev-parse HEAD)
if [ "$HEAD_NOW" != "$EXPECT_OLD" ] && [ "$HEAD_NOW" != "$NEW_SHA" ]; then
  echo "FATAL: 产线 HEAD=$HEAD_NOW 非预期起点——状态未知，停手找治理侧"; exit 1
fi
git bundle verify "$BUNDLE"
V=$(sudo -u lykoi sqlite3 "$DB" 'SELECT MAX(version) FROM mind_schema;')
if [ "$V" != 17 ]; then echo "FATAL: mind_schema=$V ≠ 17——本单零迁移，停手找治理侧"; exit 1; fi
N_PRE=$(sudo -u lykoi sqlite3 "$DB" 'SELECT COUNT(*) FROM focus_insight_state;')
R_PRE=$(sudo -u lykoi sqlite3 "$DB" 'SELECT COUNT(*) FROM autonomy_runs;')
test -x /usr/bin/google-chrome || { echo 'FATAL: /usr/bin/google-chrome 不存在'; exit 1; }
test -f /etc/apparmor.d/chrome || { echo 'FATAL: /etc/apparmor.d/chrome 不存在（命名空间沙箱的前提）'; exit 1; }
if [ "$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)" != 1 ]; then
  echo 'WARN: apparmor_restrict_unprivileged_userns ≠ 1（与 2026-09-02 实核不同，沙箱探针仍会验）'
fi
if [ "$(stat -fc %T /sys/fs/cgroup)" != cgroup2fs ]; then echo 'FATAL: 非 cgroup v2，出网闸装不上'; exit 1; fi
echo "前验通过（HEAD=$HEAD_NOW schema=$V 状态行=$N_PRE autonomy_runs=$R_PRE Chrome=$(/usr/bin/google-chrome --version 2>/dev/null || echo '?')）"

echo '== 1 · 出网闸探针（systemd cgroup BPF 过滤在本机生效吗；一对结果才算证据） =='
RC1=0; systemd-run --wait --quiet -p IPAddressDeny=any -p IPAddressAllow=127.0.0.53/32 \
  curl -sS -m 3 -o /dev/null "$PROXY_PROBE" || RC1=$?
RC2=0; systemd-run --wait --quiet \
  curl -sS -m 3 -o /dev/null "$PROXY_PROBE" || RC2=$?
echo "带 Deny rc=$RC1（期望非 0）；无 Deny rc=$RC2（期望 0）"
if [ "$RC1" = 0 ]; then echo 'FATAL: 带 Deny 仍连上——本机 IP 过滤未生效，出网闸是 302 hop 缺口的唯一封口，停手'; exit 1; fi
if [ "$RC2" != 0 ]; then echo 'FATAL: 对照组连不上代理——探针目标不应答，证明不了任何事，停手'; exit 1; fi
echo 'IP FIREWALL PROBE OK'

echo '== 2 · 供给：OS 用户、目录、挂载点、组、配置（不停机；幂等） =='
id -u "$BUSER" >/dev/null 2>&1 \
  || useradd --system --create-home --home-dir "$BHOME" --shell /usr/sbin/nologin "$BUSER"
chmod 700 "$BHOME"
install -d -o "$BUSER" -g "$BUSER" -m 700 "$BHOME/profile"
install -d -o "$BUSER" -g "$BUSER" -m 700 "$BHOME/data"
install -d -o root -g root -m 755 /opt/lykoi-browser
install -d -o root -g root -m 755 /opt/lykoi-browser/tree
usermod -aG "$BUSER" lykoi
id -nG lykoi | tr ' ' '\n' | grep -qx "$BUSER" || { echo 'FATAL: lykoi 未入组'; exit 1; }
install -d -o root -g root -m 755 /etc/lykoi-browser
echo "供给 OK（$(id "$BUSER")）"

echo '== 3 · 沙箱探针（以 lykoi-browser 身份、NoNewPrivileges 下 Chrome 能起吗） =='
PT=$(sudo -u "$BUSER" mktemp -d /tmp/probe.XXXX)
RC=0; sudo -u "$BUSER" timeout 40 setpriv --no-new-privs /usr/bin/google-chrome --headless=new \
  --no-first-run --disable-gpu --user-data-dir="$PT" --dump-dom about:blank > "$PT/dom.txt" 2> "$PT/err.txt" || RC=$?
if [ "$RC" != 0 ] || ! grep -q '<html>' "$PT/dom.txt"; then
  echo "FATAL: 沙箱探针失败 rc=$RC —— 不加 --no-sandbox，记录并停手（stderr 如下）"; cat "$PT/err.txt" | tail -20; exit 1
fi
rm -rf "$PT"
echo 'SANDBOX PROBE OK'

echo '== 4 · 停机（watchdog 最先；备份 timer 一并停；大脑 stop 不 disable） =='
systemctl disable --now lykoi-cordis-watchdog.timer
systemctl stop lykoi-cordis-backup.timer
systemctl stop lykoi-cordis.service
sleep 2
if pgrep -u lykoi -f 'lykoi-cordis' >/dev/null 2>&1; then
  echo 'FATAL: 停机后仍有 lykoi-cordis 进程'; pgrep -au lykoi -f 'lykoi-cordis'; exit 1
fi
systemctl is-enabled --quiet lykoi-cordis.service || { echo 'FATAL: 大脑 unit 不再 enabled'; exit 1; }
echo 'STOPPED OK（enabled 保持）'

echo '== 5 · 窗内备份（root 侧，含字节数下限闸） =='
BK="/root/backup-pre-m5browser-$(date +%Y%m%dT%H%M%S).tar.gz"
tar -C /home/lykoi -czf "$BK" state
SZ=$(stat -c %s "$BK")
if [ "$SZ" -lt 1048576 ]; then echo "FATAL: 备份 $SZ 字节 < 1MB"; exit 1; fi
echo "BACKUP OK: $BK ($SZ bytes)"; sha256sum "$BK"

echo '== 6 · 树落地（钉 main 提交）+ 依赖 + 属主 =='
git fetch "$BUNDLE" '+refs/heads/main:refs/heads/main'
git checkout -f --detach "$NEW_SHA"
[ "$(git rev-parse HEAD)" = "$NEW_SHA" ] || { echo 'FATAL: HEAD 不在钉点'; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1; }
# 内容断言：本单之为本单
test -f packages/lykoi-organ-browser/src/host.ts || { echo 'FATAL: 无 host.ts'; exit 1; }
N=$(grep -c '^    socketPath: /run/lykoi-browser/host.sock' profile/cordis.prod.yml || true)
[ "$N" = 1 ] || { echo "FATAL: prod.yml browser 位计数 $N ≠ 1"; exit 1; }
N=$(grep -c '"playwright-core": "1.60.0"' package-lock.json || true)
[ "$N" -ge 1 ] || { echo 'FATAL: lockfile 无 playwright-core 1.60.0'; exit 1; }
N=$(grep -c '^IPAddressDeny=' deploy/lykoi-browser.service.template || true)
[ "$N" = 2 ] || { echo "FATAL: unit 模板 IPAddressDeny 行数 $N ≠ 2"; exit 1; }
grep -q '^IPAddressAllow=127.0.0.53/32 127.0.0.1/32$' deploy/lykoi-browser.service.template || { echo 'FATAL: unit 模板 Allow 行不对'; exit 1; }
grep -q 'SupplementaryGroups' deploy/lykoi-browser.service.template && { echo 'FATAL: unit 模板仍有 SupplementaryGroups'; exit 1; }
N=$(grep -c 'EXPECTED_MIND_SCHEMA_VERSION = 17' packages/lykoi-memory/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: 版本常量 17 计数 $N ≠ 1"; exit 1; }
N=$(find governance/wo -path '*/migrations/018_*' 2>/dev/null | wc -l)
[ "$N" = 0 ] || { echo "FATAL: 树里出现 018 迁移件"; exit 1; }
[ "$(readlink -f "$REPO/var/state")" = /home/lykoi/state ] || { echo 'FATAL: var/state 软链非 canonical'; exit 1; }
echo 'TREE PINNED CLEAN OK'
# npm ci 必须在 chown root 之前（GOV：npm 要写 workspace 目录）
chown -R lykoi:lykoi "$REPO/packages" "$REPO/profile"
# npm 的 shebang 走 PATH 上的 node；sudo 会把 PATH 重置成 secure_path（/usr/bin/node 是系统 Node 18），必须显式给 Node 24
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" "$NPM" ci --ignore-scripts --prefix "$REPO"
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" node -v | grep -q "^v24" || { echo "FATAL: npm ci 用的不是 Node 24"; exit 1; }
PV=$("$NODE" -p "require('$REPO/node_modules/playwright-core/package.json').version")
[ "$PV" = 1.60.0 ] || { echo "FATAL: node_modules/playwright-core 版本 $PV ≠ 1.60.0"; exit 1; }
[ -d "$REPO/node_modules/playwright-core/node_modules" ] && echo 'WARN: playwright-core 带了嵌套 node_modules（应零传递依赖）' || true
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"
# 宿主经只读 bind 读树：树对 other 须可读
N=$(find "$REPO" -path "$REPO/.git" -prune -o \( -type d ! -perm -o=rx -o -type f ! -perm -o=r \) -print | wc -l)
if [ "$N" != 0 ]; then echo "WARN: 树内 $N 项对 other 不可读，补 o+rX"; chmod -R o+rX "$REPO"; fi
# 属主/权限重整会刷新 git 的 stat 缓存，把此前就存在的模式漂移（如 init-state.ts 盘上 755、索引 644）暴露出来；
# 树必须与钉点逐位一致，按索引把模式恢复回去（内容差异不会被这一步掩盖：checkout -f 后仍不净则 FATAL）
if [ -n "$(git status --porcelain)" ]; then
  echo 'INFO: 重整后有差异，按钉点恢复：'; git status --porcelain; git checkout -f -- . ; chmod -R go-w "$REPO/packages" "$REPO/profile"
fi
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: 恢复后树仍不净（内容差异）'; git status --porcelain; git diff | head -40; exit 1; }
echo 'DEPS + OWNERSHIP OK'

echo '== 7 · 重签 manifest + 完整性门（期望 113 条） =='
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts
M=$(wc -l < packages/lykoi-gate/manifest.sha256)
echo "manifest 条目数: $M（G 时 106；本单 +7）"
[ "$M" = 113 ] || { echo "FATAL: manifest 条目数 $M ≠ 113"; exit 1; }

echo '== 8 · 宿主：配置 + unit + 起立 + health =='
if [ ! -f /etc/lykoi-browser/host.json ]; then
  install -o root -g root -m 644 "$REPO/deploy/lykoi-browser.host.json.example" /etc/lykoi-browser/host.json
  echo 'host.json 已从范例安装（proxy 空 = 直连；服务器直连出网 2026-09-02 实核 200）'
else
  echo 'host.json 已存在，保留'
fi
install -o root -g root -m 644 "$REPO/deploy/lykoi-browser.service.template" /etc/systemd/system/lykoi-browser.service
sed -i "s#<NODE_BIN>#$NODE#" /etc/systemd/system/lykoi-browser.service
grep -q '<NODE_BIN>' /etc/systemd/system/lykoi-browser.service && { echo 'FATAL: 占位符未替换'; exit 1; }
systemd-analyze verify /etc/systemd/system/lykoi-browser.service
systemctl daemon-reload
systemctl enable --now lykoi-browser.service
sleep 4
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主起立失败'; journalctl -u lykoi-browser -n 40 --no-pager; exit 1; }
if journalctl -u lykoi-browser.service -b --no-pager | grep -i 'ip firewall' | grep -qi 'fail'; then
  echo 'FATAL: 出网闸装载失败（fail-open 形态），停手'; journalctl -u lykoi-browser.service -b --no-pager | grep -i 'ip firewall'; exit 1
fi
systemctl show lykoi-browser.service -p IPAddressDeny -p IPAddressAllow -p NoNewPrivileges
ls -l /run/lykoi-browser/host.sock
SOCK_OWN=$(stat -c '%U:%G %a' /run/lykoi-browser/host.sock)
[ "$SOCK_OWN" = "$BUSER:$BUSER 660" ] || { echo "FATAL: socket 属主/权限 $SOCK_OWN ≠ $BUSER:$BUSER 660"; exit 1; }
H=$(sudo -u lykoi "$NODE" -e '
  const net=require("net");const s=net.connect("/run/lykoi-browser/host.sock");
  s.on("connect",()=>s.write(JSON.stringify({id:"1",op:"health",args:{}})+"\n"));
  s.on("data",d=>{process.stdout.write(String(d).trim());s.end()});
  s.on("error",e=>{console.log("ERR "+e.message);process.exit(2)});')
echo "health: $H"
echo "$H" | grep -q '"alive":true' || { echo 'FATAL: health 未返回 alive:true'; exit 1; }
echo 'HOST UP OK'

echo '== 9 · 起大脑（带新组）=='
systemctl start lykoi-cordis.service
sleep 8
systemctl is-active --quiet lykoi-cordis || { echo 'FATAL: 大脑起立失败'; journalctl -u lykoi-cordis -n 30 --no-pager; exit 1; }
journalctl -u lykoi-cordis -n 30 --no-pager | grep -q 'production assembly up' || { echo 'FATAL: 未见 production assembly up'; exit 1; }
systemctl enable --now lykoi-cordis-watchdog.timer
systemctl start lykoi-cordis-backup.timer
echo 'ASSEMBLY UP OK（watchdog/备份 timer 已回位）'
tail -n 200 "$AUDIT" | grep -q '"browser_organ_wired"' && echo 'audit: browser_organ_wired 在' || echo 'WARN: 审计尾 200 行未见 browser_organ_wired'

echo '== 10 · 服务器实证（信息性，不回滚；两条各自写清期望） =='
echo '-- 10a smoke 六步（服务器 Chrome 148；ran 才算数）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test packages/lykoi-organ-browser/test/smoke.test.ts 2>&1 | tail -n 25 ) || echo 'WARN: smoke 非 0'
echo '-- 10b 302 → 私网：期望 ok:false 且 error=navigation_failed（内核拒连）；若是 redirect_off_domain 说明请求已打到代理，出网闸没拦住 —— 找治理侧'
sudo -u lykoi "$NODE" -e '
  const net=require("net");const s=net.connect("/run/lykoi-browser/host.sock");
  const url="https://httpbin.org/redirect-to?url="+encodeURIComponent("http://192.168.0.202:7890/");
  s.on("connect",()=>s.write(JSON.stringify({id:"2",op:"research_read_text",args:{url}})+"\n"));
  s.on("data",d=>{console.log(String(d).trim().slice(0,400));s.end()});
  s.on("error",e=>{console.log("ERR "+e.message)});' || true
echo '-- 10c 读数'
systemctl show lykoi-cordis -p NRestarts
sudo -u lykoi sqlite3 "$DB" "SELECT 'autonomy_runs', COUNT(*) FROM autonomy_runs; SELECT 'max_focus_cycle', MAX(id) FROM focus_cycles;"
tail -n 300 "$AUDIT" | grep -E '"type":"(browser_organ_wired|browser_action|restart_event|deploy_event)"' | cut -c1-300 || true
head -c 400 /home/lykoi/state/budget.json; echo

echo '== 11 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-h-m5-browser","wo":"WO-M5-ORGAN-BROWSER","detail":"零迁移落地：产线树 main@481e6d2→main@482d644；新 OS 用户 lykoi-browser + lykoi-browser.service（挂载命名空间 + cgroup 出网闸）+ /etc/lykoi-browser/host.json；playwright-core 1.60.0；manifest 113；gate 过；宿主 health 通；assembly up"}' \
  >> /home/lykoi-gov/reports/governance-ops.jsonl
echo '== 落地稿 H 完成：产线钉点 main@482d644，schema 仍 17，宿主 lykoi-browser.service 在位 =='

# ---- ROLLBACK（§7 门红 / §8 宿主起不来 / §9 大脑起不来时手动执行；库未动，不需恢复备份）----
# systemctl disable --now lykoi-browser.service || true
# cd /home/lykoi/projects/lykoi-cordis
# git checkout -f --detach 481e6d25ff9361558eda58ff97388ae70072de1a
# chown -R root:root packages profile && chmod -R go-w packages profile
# /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest     # 期望 106 条
# sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts        # 须 gate: OK
# systemctl start lykoi-cordis.service && sleep 8 && systemctl is-active lykoi-cordis
# systemctl enable --now lykoi-cordis-watchdog.timer && systemctl start lykoi-cordis-backup.timer
# （多出来的 node_modules/playwright-core 与 lykoi-browser 用户/组无害，留待下次落地）
