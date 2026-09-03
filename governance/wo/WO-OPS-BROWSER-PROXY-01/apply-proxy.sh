#!/bin/bash
# WO-OPS-BROWSER-PROXY-01 · 浏览器器官宿主开出站代理（零代码、零树改动、大脑不动）
# 用法：sha256sum /tmp/apply-proxy.sh 对上治理侧给出的值后：
#   sudo bash /tmp/apply-proxy.sh 2>&1 | tee /root/ops-browser-proxy-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
PROXY=http://192.168.0.202:7890
PROXY_HOST=192.168.0.202
HOSTJSON=/etc/lykoi-browser/host.json
DROPIN_DIR=/etc/systemd/system/lykoi-browser.service.d
DROPIN=$DROPIN_DIR/proxy.conf
AUDIT=/var/log/lykoi-audit/audit.jsonl
TS=$(date +%Y%m%dT%H%M%S)

echo '== 0 · 前验（只读） =='
[ "$(id -u)" = 0 ] || { echo 'FATAL: 须 root'; exit 1; }
[ -f "$HOSTJSON" ] || { echo "FATAL: $HOSTJSON 不存在"; exit 1; }
grep -q '"proxy": ""' "$HOSTJSON" || { echo 'FATAL: host.json 的 proxy 不是空串——状态非预期，停手'; grep -n '"proxy"' "$HOSTJSON"; exit 1; }
[ ! -e "$DROPIN" ] || { echo "FATAL: $DROPIN 已存在——状态非预期，停手"; exit 1; }
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主不在跑，先查'; exit 1; }
systemctl is-active --quiet lykoi-cordis.service || { echo 'FATAL: 大脑不在跑，先查'; exit 1; }
systemctl show -p IPAddressAllow lykoi-browser | grep -q '127.0.0.53/32' || { echo 'FATAL: 出网闸表形状非预期'; systemctl show -p IPAddressAllow -p IPAddressDeny lykoi-browser; exit 1; }
if journalctl -u lykoi-browser -b --no-pager 2>/dev/null | grep -qi 'ip firewall'; then
  echo 'FATAL: 本次启动已有 IP firewall 告警行（表装不上=fail open），先查'; exit 1; fi
printf '代理连通性 -> '; curl -sS -m 10 -x "$PROXY" -o /dev/null -w '%{http_code} %{time_total}s\n' https://api.coingecko.com/api/v3/ping \
  || { echo 'FATAL: 从本机经代理连 coingecko 失败，不落地'; exit 1; }
echo '前验通过'

echo '== 1 · 备份 + 改 host.json =='
cp -p "$HOSTJSON" "$HOSTJSON.bak-$TS"
sed -i "s|\"proxy\": \"\"|\"proxy\": \"$PROXY\"|" "$HOSTJSON"
grep -n '"proxy"' "$HOSTJSON"
python3 -c "import json,sys; d=json.load(open('$HOSTJSON')); assert d['proxy']=='$PROXY', d['proxy']; print('host.json JSON 合法，proxy 已置')"
[ "$(stat -c %U:%G:%a "$HOSTJSON")" = root:root:644 ] || { echo "WARN: host.json 属主/权限 $(stat -c %U:%G:%a "$HOSTJSON") ≠ root:root:644，纠回"; chown root:root "$HOSTJSON"; chmod 644 "$HOSTJSON"; }

echo '== 2 · unit drop-in：放行代理地址（Allow 累加、优先于 Deny） =='
mkdir -p "$DROPIN_DIR"
printf '[Service]\n# WO-OPS-BROWSER-PROXY-01：host.json 开了代理，出网闸放行代理那一台（模板第 111 行既定做法）\nIPAddressAllow=%s/32\n' "$PROXY_HOST" > "$DROPIN"
chmod 644 "$DROPIN"; cat "$DROPIN"
systemctl daemon-reload
systemctl show -p IPAddressAllow lykoi-browser | grep -q "$PROXY_HOST/32" || { echo 'FATAL: daemon-reload 后 Allow 表未含代理条'; systemctl show -p IPAddressAllow lykoi-browser; exit 1; }
systemctl show -p IPAddressAllow lykoi-browser | grep -q '127.0.0.53/32' || { echo 'FATAL: 原 Allow 条被覆盖（应累加）'; systemctl show -p IPAddressAllow lykoi-browser; exit 1; }
echo 'Allow 表：'; systemctl show -p IPAddressAllow lykoi-browser

echo '== 3 · 重启宿主（大脑不动） =='
systemctl restart lykoi-browser.service
sleep 5
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主起不来'; journalctl -u lykoi-browser -n 30 --no-pager; exit 1; }
if journalctl -u lykoi-browser -b --no-pager | grep -i 'ip firewall'; then echo 'FATAL: 出网闸表装不上（fail open）——按回滚段退回'; exit 1; fi
systemctl is-active --quiet lykoi-cordis.service || { echo 'FATAL: 大脑在本次操作中掉了'; exit 1; }
sleep 10
if tail -n 100 "$AUDIT" | grep -q '"browser_host_unreachable"'; then echo 'WARN: 审计尾 100 行见 browser_host_unreachable（重启窗口内可能是旧行，看时间戳）'; tail -n 100 "$AUDIT" | grep '"browser_host_unreachable"' | tail -3 | cut -c1-200; fi
echo 'HOST UP OK（大脑未动仍 active）'

echo '== 4 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"ops-browser-proxy","wo":"WO-OPS-BROWSER-PROXY-01","detail":"零代码：/etc/lykoi-browser/host.json proxy 置 http://192.168.0.202:7890（备份 host.json.bak-'"$TS"'）；drop-in IPAddressAllow=192.168.0.202/32；restart lykoi-browser.service；大脑与树未动"}' >> /home/lykoi-gov/reports/governance-ops.jsonl
echo '== 完成：宿主已走代理；验收 = Telegram 再问一次境外取数，审计 browser_action 应 status:ok chars>0 =='

# ---- ROLLBACK（手动）----
# rm -f /etc/systemd/system/lykoi-browser.service.d/proxy.conf
# cp -p /etc/lykoi-browser/host.json.bak-<TS> /etc/lykoi-browser/host.json
# systemctl daemon-reload && systemctl restart lykoi-browser.service && systemctl is-active lykoi-browser
