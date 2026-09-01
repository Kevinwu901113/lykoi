#!/bin/bash
# ============================================================================
# WAVE-OBS-PREP · 落地粘贴稿 B —— 观察周前收官上线（root 执行，单稿一次跑完）
# ============================================================================
# 携带三单：WO-STATE-CANON（gate 检查项⑧ + var/state 调和）、
#           WO-CACHE-PERSONA（getPersona 缓存面 + path 守卫）、
#           WO-GUARD-RETIRE（护栏旧体条目退役——本稿之前她因检查项④停机）。
# 树钉点：m4-switch = 5f706bd91fc3c0b0093e566e94943d38e7488bfb
#         （= main f37aac8 + 六器官位翻开，重钉自 7fed677 同文措辞）
# 材料（治理侧已 scp 至服务器 /tmp）：
#   /tmp/lykoi-obsprep-20260901.bundle   增量 bundle（基 cb2e27e，含 main+m4-switch）
# 定序（D-SC-3 硬闸）：本稿步 0 验证退役稿已执行（浏览器栈 mask、旧仓封存）——
# 任何一条不过整稿不动。退役稿 v4 的顺延冷启核验由本稿步 6 兑现。
# 断言一律显式 if/exit（教训 48）。全稿幂等，跑一半断了可整稿重跑。
# 无依赖变更（lockfile 未动），不跑 npm ci。
set -euo pipefail

NODE=/opt/node-v24.18.0/bin/node
REPO=/home/lykoi/projects/lykoi-cordis
SWITCH_SHA=5f706bd91fc3c0b0093e566e94943d38e7488bfb
BUNDLE=/tmp/lykoi-obsprep-20260901.bundle
BUNDLE_SHA=ee8c90ef1fc543d884a9a6a8fe923812c23232b860655bf5885359300740ae8e
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
STATE=/home/lykoi/state
ARCH=/home/lykoi/archive/old-body-20260901

echo '== 0 · 前验（全部只读；任何一条不过则整稿未动） =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
echo "$BUNDLE_SHA  $BUNDLE" | sha256sum -c -
# --- D-SC-3 硬闸：退役稿必须已执行 ---
if [ "$(systemctl is-enabled lykoi-chrome.service 2>/dev/null)" != masked ]; then
  echo 'FATAL: lykoi-chrome 未 mask —— 退役稿（/tmp/paste-retire.sh）未执行，先跑它'; exit 1
fi
if [ -e /home/lykoi/projects/lykoi ]; then
  echo 'FATAL: 旧仓仍在原位 —— 退役稿未执行完'; exit 1
fi
echo 'retire precondition: OK'
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO" \
  || git config --global --add safe.directory "$REPO"
cd "$REPO"
git bundle verify "$BUNDLE"
echo "$PERSONA_SHA  $PERSONA" | sha256sum -c -
if ! sudo -u lykoi test -r "$PERSONA"; then
  echo 'FATAL: persona TOML 对 lykoi 不可读'; exit 1
fi
echo 'persona readable by lykoi: OK'

echo '== 1 · 树落地（取 bundle → 钉点 checkout） =='
git fetch "$BUNDLE" \
  '+refs/heads/main:refs/heads/main' \
  '+refs/heads/m4-switch:refs/heads/m4-switch' \
  '+refs/heads/*:refs/remotes/bundle/*'
git checkout -f --detach "$SWITCH_SHA"
if [ "$(git rev-parse HEAD)" != "$SWITCH_SHA" ]; then
  echo 'FATAL: HEAD 不在钉点'; exit 1
fi
if [ -n "$(git status --porcelain)" ]; then
  echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1
fi
echo 'TREE PINNED CLEAN OK'

echo '== 2 · 落地树内容断言（三单之为三单） =='
FLIPS=$(grep -c '# 切换态启用' profile/cordis.prod.yml)
if [ "$FLIPS" != 6 ]; then echo "FATAL: 翻位注释计数 $FLIPS ≠ 6"; exit 1; fi
if ! grep -q '^    personaToml: /home/lykoi/runtime/persona/lykoi_base.toml' \
  profile/cordis.prod.yml; then echo 'FATAL: wake 块缺 personaToml'; exit 1; fi
if grep -qE '^\s*name: lykoi-learn' profile/cordis.prod.yml; then
  echo 'FATAL: learn 条目仍在'; exit 1; fi
# WO-GUARD-RETIRE 在树：禁区表已无旧 guardian 条目（数组条目形态 '…',）
if grep -q "projects/lykoi/guardian'" packages/lykoi-kernel/src/policy-core.ts; then
  echo 'FATAL: PROTECTED_PATHS 仍含旧 guardian 条目（WO-GUARD-RETIRE 未入树）'; exit 1
fi
# WO-STATE-CANON 在树：检查项⑧存在
if ! grep -q 'state_canon' packages/lykoi-gate/src/verify.ts; then
  echo 'FATAL: gate 缺检查项⑧ state_canon（WO-STATE-CANON 未入树）'; exit 1
fi
# WO-CACHE-PERSONA 在树：两个生产调用点走缓存面
CPCALLS=$(grep -c 'getPersona(resolve(config.personaToml))' \
  packages/lykoi-converse/src/index.ts packages/lykoi-wake/src/index.ts | \
  awk -F: '{s+=$2} END {print s}')
if [ "$CPCALLS" != 2 ]; then
  echo "FATAL: getPersona 调用点计数 $CPCALLS ≠ 2（WO-CACHE-PERSONA 未入树）"; exit 1
fi
echo 'tree content (3 WOs): OK'

echo '== 3 · state 落点调和（D-SC-1/2：分叉游标归档 → canonical 软链） =='
if [ -L "$REPO/var/state" ]; then
  if [ "$(readlink -f "$REPO/var/state")" != "$STATE" ]; then
    echo 'FATAL: var/state 软链指错'; readlink -f "$REPO/var/state"; exit 1
  fi
  echo 'var/state symlink already canonical: OK'
elif [ -d "$REPO/var/state" ]; then
  # D-SC-2：分叉真实目录 —— 只许已知爆炸半径（唯一游标文件），否则人工复核
  if [ -e "$REPO/var/state/chat_outbox.json" ]; then
    echo 'FATAL: 分叉目录含 chat_outbox.json —— 超出已知爆炸半径，停手找治理侧'; exit 1
  fi
  EXTRA=$(ls -A "$REPO/var/state" | grep -v '^telegram_outbox.cursor$' || true)
  if [ -n "$EXTRA" ]; then
    echo "FATAL: 分叉目录有未知条目：$EXTRA —— 停手找治理侧"; exit 1
  fi
  if [ -e "$REPO/var/state/telegram_outbox.cursor" ]; then
    mv "$REPO/var/state/telegram_outbox.cursor" \
       "$ARCH/state/telegram_outbox.cursor.var-state-fork"
    echo 'forked cursor archived'
  fi
  rmdir "$REPO/var/state"
  echo 'forked dir removed'
fi
if [ ! -L "$REPO/var/state" ]; then
  sudo -u lykoi mkdir -p "$REPO/var"
  sudo -u lykoi ln -sfn "$STATE" "$REPO/var/state"
fi
if [ ! -L "$REPO/var/state" ]; then echo 'FATAL: var/state 不是软链'; exit 1; fi
if [ "$(readlink -f "$REPO/var/state")" != "$STATE" ]; then
  echo 'FATAL: var/state 软链指错'; exit 1
fi
echo 'var/state -> canonical: OK'

echo '== 4 · root 属主域重整（checkout 后重申，幂等） =='
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"

echo '== 5 · 重签 manifest + 完整性门试跑（八检查项首次产线全绿在此一瞬） =='
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts

echo '== 6 · 起立与读数（含退役稿 v4 顺延的冷启核验） =='
systemctl restart lykoi-cordis
sleep 8
if ! systemctl is-active --quiet lykoi-cordis; then
  echo 'FATAL: 起立失败'; journalctl -u lykoi-cordis -n 30 --no-pager; exit 1
fi
journalctl -u lykoi-cordis -n 30 --no-pager | tail -20
if ! journalctl -u lykoi-cordis -n 30 --no-pager | grep 'production assembly up'; then
  echo 'FATAL: 未见 production assembly up'; exit 1
fi
echo 'ASSEMBLY UP OK（退役后冷启核验一并兑现）'

echo '== 7 · 记账 =='
if [ -d /home/lykoi-gov/reports ]; then
  printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-b","wo":"WAVE-OBS-PREP","detail":"落地稿B：树重钉 5f706bd（STATE-CANON+CACHE-PERSONA+GUARD-RETIRE 三单入产线），var/state 调和为 canonical 软链，manifest 重签，八检查项 gate 全绿，assembly up（含退役稿 v4 顺延冷启核验）"}' \
    >> /home/lykoi-gov/reports/governance-ops.jsonl
fi
echo '== 落地稿 B 完成：WAVE-OBS-PREP 收官，观察周 W1 自此起算 =='
echo '== 每日读数见 governance/docs/observation_week_1_runbook_2026-09-01.md =='
