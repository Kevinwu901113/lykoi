#!/bin/bash
# LANDING-L · WO-FIX-JSONMODE-01 落地 —— 产线树 main@f449fda → main@5e6bf02
# 本单：零迁移、零 schema 变更、零装配面变化、零 unit 变化、零新依赖、零 profile 改动。改的是 converse 一包 src
# （重试跳 attempt ≥ 1 去 json_object，靠 lykoi-decide extractJson 花括号切片抠信封；attempt 0 字节不变；
#   u3_cycle_retried/failed 补 json_mode）。
# 宿主 lykoi-browser.service 不动、不重启。停机形态同 G/H/I：大脑 `systemctl stop`（保持 enabled）。
# 用法：先落盘再执行：
#   sha256sum /tmp/landing-l-jsonmode.sh   # 须 = 治理侧给出的值
#   sudo bash /tmp/landing-l-jsonmode.sh 2>&1 | tee /root/landing-l-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
NODE=/opt/node-v24.18.0/bin/node
NPM=/opt/node-v24.18.0/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
DB=/home/lykoi/state/memory.db
EXPECT_OLD=f449fdab79f3c647e90502f71f42b42e7d81bada
NEW_SHA=5e6bf02c68d367d0e647c69cd8ea9218eccadacc
BUNDLE=/tmp/lykoi-landing-l.bundle
BUNDLE_SHA=dc091957a0ef711a1a6b6f0c375370d799bb9f2ee1f220fb84bf4e49cb17830c
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
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
R_PRE=$(sudo -u lykoi sqlite3 "$DB" 'SELECT COUNT(*) FROM autonomy_runs;')
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主 lykoi-browser.service 不在跑——本单不动它，先查'; exit 1; }
echo "前验通过（HEAD=$HEAD_NOW schema=$V autonomy_runs=$R_PRE 宿主 active）"

echo '== 1 · 停机（watchdog 最先；备份 timer 一并停；大脑 stop 不 disable） =='
systemctl disable --now lykoi-cordis-watchdog.timer
systemctl stop lykoi-cordis-backup.timer
systemctl stop lykoi-cordis.service
sleep 2
if pgrep -u lykoi -f 'lykoi-cordis' >/dev/null 2>&1; then
  echo 'FATAL: 停机后仍有 lykoi-cordis 进程'; pgrep -au lykoi -f 'lykoi-cordis'; exit 1
fi
systemctl is-enabled --quiet lykoi-cordis.service || { echo 'FATAL: 大脑 unit 不再 enabled'; exit 1; }
echo 'STOPPED OK（enabled 保持）'

echo '== 2 · 窗内备份（root 侧，含字节数下限闸） =='
BK="/root/backup-pre-jsonmode-$(date +%Y%m%dT%H%M%S).tar.gz"
tar -C /home/lykoi -czf "$BK" state
SZ=$(stat -c %s "$BK")
if [ "$SZ" -lt 1048576 ]; then echo "FATAL: 备份 $SZ 字节 < 1MB"; exit 1; fi
echo "BACKUP OK: $BK ($SZ bytes)"; sha256sum "$BK"

echo '== 3 · 树落地（钉 main 提交）+ 依赖 + 属主 =='
git fetch "$BUNDLE" '+refs/heads/main:refs/heads/main'
git checkout -f --detach "$NEW_SHA"
[ "$(git rev-parse HEAD)" = "$NEW_SHA" ] || { echo 'FATAL: HEAD 不在钉点'; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1; }
# 内容断言：本单之为本单
N=$(grep -c "responseFormat: nudge ? null : (envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null)" packages/lykoi-converse/src/conversation.ts || true)
[ "$N" = 1 ] || { echo "FATAL: conversation.ts 重试跳未去 json 模式（计数 $N）"; exit 1; }
N=$(grep -c 'json_mode: jsonMode,' packages/lykoi-converse/src/conversation.ts || true)
[ "$N" = 2 ] || { echo "FATAL: retried/failed 事件缺 json_mode（计数 $N）"; exit 1; }
# 上两单（J/K）的落点仍在
N=$(grep -c "reasoningEffort: 'off' as const" packages/lykoi-converse/src/conversation.ts || true)
[ "$N" = 1 ] || { echo "FATAL: J 的关思考落点丢了（计数 $N）"; exit 1; }
N=$(grep -c 'ENVELOPE_RETRY_MAX = 2' packages/lykoi-converse/src/contract.ts || true)
[ "$N" = 1 ] || { echo "FATAL: K 的重试上限丢了（计数 $N）"; exit 1; }
N=$(grep -c 'EXPECTED_MIND_SCHEMA_VERSION = 17' packages/lykoi-memory/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: 版本常量 17 计数 $N ≠ 1"; exit 1; }
N=$(find governance/wo -path '*/migrations/018_*' 2>/dev/null | wc -l)
[ "$N" = 0 ] || { echo "FATAL: 树里出现 018 迁移件"; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- profile deploy package.json package-lock.json \
  || { echo 'FATAL: profile/deploy/依赖有变——本单声明零装配零依赖'; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- packages/lykoi-llm-deepseek/vendor \
  || { echo 'FATAL: vendor 有变——本单声明 adapter 不动'; exit 1; }
[ "$(readlink -f "$REPO/var/state")" = /home/lykoi/state ] || { echo 'FATAL: var/state 软链非 canonical'; exit 1; }
echo 'TREE PINNED CLEAN OK'
# npm ci 在 chown root 之前；sudo 重置 PATH，显式给 Node 24
chown -R lykoi:lykoi "$REPO/packages" "$REPO/profile"
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" "$NPM" ci --ignore-scripts --prefix "$REPO"
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" node -v | grep -q "^v24" || { echo "FATAL: npm ci 用的不是 Node 24"; exit 1; }
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"
N=$(find "$REPO" -path "$REPO/.git" -prune -o \( -type d ! -perm -o=rx -o -type f ! -perm -o=r \) -print | wc -l)
if [ "$N" != 0 ]; then echo "WARN: 树内 $N 项对 other 不可读，补 o+rX"; chmod -R o+rX "$REPO"; fi
# LANDING-I 实证：init-state.ts 已 100755 入库，npm ci 后树应直接是净的。兜底仍保留。
if [ -n "$(git status --porcelain)" ]; then
  echo 'WARN: npm ci 后树不净（记给治理侧）：'; git status --porcelain
  git checkout -f -- . ; chmod -R go-w "$REPO/packages" "$REPO/profile"
fi
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: 恢复后树仍不净（内容差异）'; git status --porcelain; git diff | head -40; exit 1; }
echo 'DEPS + OWNERSHIP OK（npm ci 后树净）'

echo '== 4 · 重签 manifest + 完整性门（期望 113 条，与 K 相同；test/ 不入域） =='
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts
M=$(wc -l < packages/lykoi-gate/manifest.sha256)
echo "manifest 条目数: $M"
[ "$M" = 113 ] || { echo "FATAL: manifest 条目数 $M ≠ 113"; exit 1; }

echo '== 5 · 起大脑 =='
systemctl start lykoi-cordis.service
sleep 8
systemctl is-active --quiet lykoi-cordis || { echo 'FATAL: 大脑起立失败'; journalctl -u lykoi-cordis -n 30 --no-pager; exit 1; }
journalctl -u lykoi-cordis -n 30 --no-pager | grep -q 'production assembly up' || { echo 'FATAL: 未见 production assembly up'; exit 1; }
systemctl enable --now lykoi-cordis-watchdog.timer
systemctl start lykoi-cordis-backup.timer
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主在落地中掉了'; exit 1; }
echo 'ASSEMBLY UP OK（watchdog/备份 timer 已回位；宿主未动仍 active）'
tail -n 200 "$AUDIT" | grep -q '"browser_organ_wired"' && echo 'audit: browser_organ_wired 在' || echo 'WARN: 审计尾 200 行未见 browser_organ_wired'

echo '== 6 · 服务器实证（信息性，不回滚） =='
echo '-- 6a converse 周期单测在服务器 Node 24 上跑（attempt 0 字节不变、重试去 json 模式、json_mode 字段、切片容错）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test packages/lykoi-converse/test/cycle.test.ts 2>&1 | grep -E '^(ℹ|not ok)' ) || echo 'WARN: cycle 单测非 0'
echo '-- 6b converse e2e（真 seam：responseFormat null 时 wire 不发键）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test packages/lykoi-converse/test/e2e.test.ts 2>&1 | grep -E '^(ℹ|not ok)' ) || echo 'WARN: e2e 单测非 0'
echo '-- 6c 读数'
systemctl show lykoi-cordis -p NRestarts
sudo -u lykoi sqlite3 "$DB" "SELECT 'autonomy_runs', COUNT(*) FROM autonomy_runs;"
tail -n 300 "$AUDIT" | grep -E '"type":"(restart_event|deploy_event)"' | cut -c1-300 || true
echo '-- 6d 落地前 not_json 账（对照：落地后 retried 应带 json_mode，json_mode:false 的重试之后应出 u3_cycle_envelope）'
grep -c '"u3_cycle_failed".*"not_json"' "$AUDIT" | sed 's/^/u3_cycle_failed not_json 累计: /' || true
grep '"u3_cycle_retried"' "$AUDIT" | tail -n 3 | cut -c1-300 || echo 'INFO: 无 u3_cycle_retried'

echo '== 7 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-l-jsonmode","wo":"WO-FIX-JSONMODE-01","detail":"零迁移零装配落地：产线树 main@f449fda→main@5e6bf02；信封 not_json 重试跳去 json_object 靠 extractJson 抠信封（attempt 0 字节不变）；retried/failed 事件补 json_mode；manifest 113 重签；宿主未动"}' >> "$OPS"
  >> /home/lykoi-gov/reports/governance-ops.jsonl
echo '== 落地稿 L 完成：产线钉点 main@5e6bf02，schema 仍 17，宿主未动 =='

# ---- ROLLBACK（§4 门红 / §5 大脑起不来时手动执行；库未动，不需恢复备份）----
# cd /home/lykoi/projects/lykoi-cordis
# git checkout -f --detach f449fdab79f3c647e90502f71f42b42e7d81bada
# chown -R root:root packages profile && chmod -R go-w packages profile
# /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest     # 期望 113 条
# sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts        # 须 gate: OK
# systemctl start lykoi-cordis.service && sleep 8 && systemctl is-active lykoi-cordis
# systemctl enable --now lykoi-cordis-watchdog.timer && systemctl start lykoi-cordis-backup.timer
