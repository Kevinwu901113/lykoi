#!/bin/bash
# ============================================================================
# WO-M4-W2 · 粘贴稿 1/2 —— 切换窗**前**准备（root 执行；不触旧体、不写她的 state）
# ============================================================================
# 树钉点：lykoi-cordis @ m4-switch = 7fed677434f99d61ddf48e818111099eebde0a95
#         （= main cb2e27e722387582d569bafef037999ec30d6e31 + 六器官位翻开；WO-M4-FIX-WAKE 重钉）
# 若 main 已前进：m4-switch 先 rebase 重推，本稿两处 sha 同步换（见 runbook §2）。
#
# 前置（Kevin 在 Mac 上先做，仓库私有、服务器零凭据 —— git bundle 传树）：
#   cd ~/Documents/lykoi/lykoi-cordis
#   git bundle create /tmp/lykoi-cordis.bundle main m4-switch
#   shasum -a 256 /tmp/lykoi-cordis.bundle        # 记下这个值，下面 BUNDLE_SHA 用
#   scp /tmp/lykoi-cordis.bundle lykoi-gov:/tmp/lykoi-cordis.bundle
#
# 本稿动作全部幂等或前验拒绝，跑一半断了可整稿重跑。
set -euo pipefail

NODE_V=v24.18.0
NODE_DIR=/opt/node-$NODE_V
NODE=$NODE_DIR/bin/node
NPM=$NODE_DIR/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
SWITCH_SHA=7fed677434f99d61ddf48e818111099eebde0a95
BUNDLE=/tmp/lykoi-cordis.bundle
BUNDLE_SHA='<Kevin 填：Mac 上 shasum -a 256 的输出>'
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56

echo '== 0 · 前验 =='
[ "$(uname -m)" = x86_64 ]
[ "$(id -u)" = 0 ]

echo '== 1 · Node 24 供给（/opt，root 属主；不动系统 node18） =='
if [ ! -x "$NODE" ]; then
  cd /opt
  curl -fLO "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-x64.tar.xz"
  curl -fLO "https://nodejs.org/dist/$NODE_V/SHASUMS256.txt"
  grep " node-$NODE_V-linux-x64.tar.xz\$" SHASUMS256.txt | sha256sum -c -
  tar -xf "node-$NODE_V-linux-x64.tar.xz"
  mv "node-$NODE_V-linux-x64" "node-$NODE_V"
fi
"$NODE" --version   # 必须 v24.18.0

echo '== 2 · 树落地（bundle 校验 → 以 lykoi 身份 clone → 钉点 checkout） =='
if [ ! -e "$REPO" ]; then
  echo "$BUNDLE_SHA  $BUNDLE" | sha256sum -c -
  sudo -u lykoi git clone "$BUNDLE" "$REPO"
fi
cd "$REPO"
sudo -u lykoi git fetch "$BUNDLE" 'refs/heads/*:refs/remotes/bundle/*' || true
sudo -u lykoi git checkout --detach "$SWITCH_SHA"
[ "$(git rev-parse HEAD)" = "$SWITCH_SHA" ] && echo 'TREE PINNED OK'

echo '== 3 · 依赖（--ignore-scripts；钉版由 lockfile；undici 必须 8.10.0） =='
# npm 的 shebang 是 env node —— PATH 必须先见 node24，否则它会拿系统 node18 跑。
sudo -u lykoi env "PATH=$NODE_DIR/bin:$PATH" "$NPM" ci --ignore-scripts
[ "$(sudo -u lykoi "$NODE" -p 'require("undici/package.json").version')" = 8.10.0 ]

echo '== 3b · state 落点调和（D-SC-1；检查项⑧ 的供给面） =='
# 源码的 state 缺省全是**仓库相对**的 var/state/…（approval.ts:36 等十余处），
# 钉面 canonical 全是绝对的 /home/lykoi/state/… —— 两者靠这一条符号链接调和。
# 定案不改源码相对缺省、不加 unit env，所以漏了这一步 = 服务进程会自己在仓库内
# mkdir 一个真实 var/state/ 并往里写，她的 state 当场分叉（2026-09-01 01:18 实证）。
# var/ 在 .gitignore 里 → 链接不随树落地，每台机器供给一次。幂等：ln -sfn。
sudo -u lykoi mkdir -p "$REPO/var"
sudo -u lykoi ln -sfn /home/lykoi/state "$REPO/var/state"
[ -L "$REPO/var/state" ] || { echo 'FAIL: var/state 不是符号链接（真实目录？先核对里面有什么再决定弃/并）'; exit 1; }
[ "$(readlink -f "$REPO/var/state")" = /home/lykoi/state ] \
  || { echo 'FAIL: var/state 没指向 /home/lykoi/state'; exit 1; }
echo 'STATE LANDING OK'

echo '== 4 · audit sink（前置 #9 逐字；检查项⑦六断言的供给面） =='
install -d -o root -g root -m 755 /var/log/lykoi-audit
[ -e /var/log/lykoi-audit/audit.jsonl ] \
  || install -o root -g lykoi -m 620 /dev/null /var/log/lykoi-audit/audit.jsonl
chattr +a /var/log/lykoi-audit/audit.jsonl
lsattr /var/log/lykoi-audit/audit.jsonl

echo '== 5 · 人格 TOML（前置 #5：内容 sha 是硬约束，先核后动权限；已在规范路径，零拷贝） =='
echo "$PERSONA_SHA  $PERSONA" | sha256sum -c -
chown root:root /home/lykoi/runtime/persona "$PERSONA"
chmod 755 /home/lykoi/runtime/persona
chmod 444 "$PERSONA"

echo '== 6 · 凭据文件（值永不经手治理侧；只查名字有无，不看值） =='
[ -e /home/lykoi/secrets/telegram-cordis.env ] \
  || install -o root -g root -m 600 /dev/null /home/lykoi/secrets/telegram-cordis.env
echo '>> 手动步骤（若还没填）：sudoedit /home/lykoi/secrets/telegram-cordis.env'
echo '>>   写一行：LYKOI_TELEGRAM_BOT_TOKEN=<值>'
echo -n 'llm.env 里 DEEPSEEK_API_KEY 行数（应为 1）：'
grep -cE '^DEEPSEEK_API_KEY=' /home/lykoi/secrets/llm.env || echo '>> 缺行，需 Kevin 补'

echo '== 7 · root 属主域（前置 #9；npm ci 之后做，之后改树=root 动作） =='
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"

echo '== 8 · 签 manifest（GK-15 后签名次序不再是死锁，但先供给后签仍是好次序） =='
cd "$REPO" && "$NODE" packages/lykoi-gate/src/cli.ts --write-manifest

echo '== 9 · 完整性门试跑（以服务用户视角；此处必须 gate: OK） =='
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts

echo '== 10 · unit 三件 + 探针落位（只安装不启用；启用是粘贴稿 2 的事） =='
cat > /usr/local/sbin/lykoi-cordis-watchdog.sh <<'WDSH'
#!/bin/sh
# Lykoi Cordis watchdog 探针（M4 前置 #10；正本见治理仓 WO-M4-W2/units/）。
set -eu
UNIT=lykoi-cordis.service
AUDIT=/var/log/lykoi-audit/audit.jsonl
MAX_AGE_S=4500
if ! systemctl is-active --quiet "$UNIT"; then
  logger -t lykoi-cordis-watchdog "unit not active -> systemctl restart"
  systemctl restart "$UNIT"
  exit 0
fi
now=$(date +%s)
mt=$(stat -c %Y "$AUDIT")
age=$((now - mt))
if [ "$age" -gt "$MAX_AGE_S" ]; then
  logger -t lykoi-cordis-watchdog "audit stale ${age}s (> ${MAX_AGE_S}s) -> systemctl restart"
  systemctl restart "$UNIT"
fi
WDSH
chmod 755 /usr/local/sbin/lykoi-cordis-watchdog.sh
chown root:root /usr/local/sbin/lykoi-cordis-watchdog.sh

cat > /etc/systemd/system/lykoi-cordis.service <<'UNIT'
[Unit]
Description=Lykoi Cordis (M4 new body)
After=network-online.target
Wants=network-online.target

[Service]
User=lykoi
Group=lykoi
WorkingDirectory=/home/lykoi/projects/lykoi-cordis
EnvironmentFile=/home/lykoi/secrets/telegram-cordis.env
EnvironmentFile=/home/lykoi/secrets/llm.env
ExecStartPre=/opt/node-v24.18.0/bin/node /home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/src/cli.ts
ExecStart=/opt/node-v24.18.0/bin/node /home/lykoi/projects/lykoi-cordis/profile/index.prod.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

cat > /etc/systemd/system/lykoi-cordis-watchdog.service <<'UNIT'
[Unit]
Description=Lykoi Cordis watchdog probe (root supervisor)

[Service]
Type=oneshot
User=root
ExecStart=/usr/local/sbin/lykoi-cordis-watchdog.sh
UNIT

cat > /etc/systemd/system/lykoi-cordis-watchdog.timer <<'UNIT'
[Unit]
Description=Run lykoi-cordis watchdog probe every 5 minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min

[Install]
WantedBy=timers.target
UNIT

chmod 644 /etc/systemd/system/lykoi-cordis.service \
          /etc/systemd/system/lykoi-cordis-watchdog.service \
          /etc/systemd/system/lykoi-cordis-watchdog.timer
systemctl daemon-reload
echo '== 粘贴稿 1 完成：新体已备而未启。切换窗跑粘贴稿 2。 =='
