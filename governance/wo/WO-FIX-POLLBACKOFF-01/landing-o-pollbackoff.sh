#!/bin/bash
# LANDING-O v2 · WO-FIX-POLLBACKOFF-01 落地 —— 产线树 main@e299c1d → main@3c47c2e
# v2（16:20 CST）：v1 在 §3「packages 改动只许 adapter-telegram」一行因 grep -v 零匹配 + pipefail 静默退出（大脑已停、树已钉、npm ci/重签未做）；
#   v2 只改该行（grep 包进 { … || true; }），其余逐字节相同。v2 可从 v1 中断态直接重跑：§0 接受 HEAD=NEW_SHA，§1/§2/§3 幂等。
#   getUpdates 失败进入轮询循环的退避：production.poll 失败即抛 TelegramPollError（类别 + 数字 status），
#   index.ts 循环体抽成 runPollLoop，catch 内落审计 telegram/poll_backoff {category,status?,backoff_s}；
#   已有的 1→60 s 指数退避（成功复位）从此真的接住 getUpdates 失败。transport #postApi 逻辑不动。
# 本单：零迁移、零 schema 变更、零 unit 变化、零 profile 变化、零新依赖；src 三文件在 manifest 域内，重签 113 条不变。
# 合并树 tsc 净、全量 1046/1035/0/11。
# 宿主 lykoi-browser.service 不动、不重启。停机形态同 G–N：大脑 `systemctl stop`（保持 enabled）。
# 用法：先落盘再执行：
#   sha256sum /tmp/landing-o-pollbackoff.sh   # 须 = 治理侧给出的值
#   sudo bash /tmp/landing-o-pollbackoff.sh 2>&1 | tee /root/landing-o-v2-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
NODE=/opt/node-v24.18.0/bin/node
NPM=/opt/node-v24.18.0/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
DB=/home/lykoi/state/memory.db
EXPECT_OLD=e299c1dc69e3fb4123e92445ebc225510cc151e8
NEW_SHA=3c47c2e9e4ff5424b21fff0c28c59c0fbdcf432c
BUNDLE=/tmp/lykoi-landing-o.bundle
BUNDLE_SHA=e1c9e4a249364cade56b79e70d2d26fa6477fb0e701a5ba8740b4572a8c7abdc
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
BK="/root/backup-pre-pollbackoff-$(date +%Y%m%dT%H%M%S).tar.gz"
tar -C /home/lykoi -czf "$BK" state
SZ=$(stat -c %s "$BK")
if [ "$SZ" -lt 1048576 ]; then echo "FATAL: 备份 $SZ 字节 < 1MB"; exit 1; fi
echo "BACKUP OK: $BK ($SZ bytes)"; sha256sum "$BK"

echo '== 3 · 树落地（钉 main 提交）+ 依赖 + 属主 =='
git fetch "$BUNDLE" '+refs/heads/main:refs/heads/main'
git checkout -f --detach "$NEW_SHA"
[ "$(git rev-parse HEAD)" = "$NEW_SHA" ] || { echo 'FATAL: HEAD 不在钉点'; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1; }
# 内容断言：本单四处落点
N=$(grep -cF 'export class TelegramPollError extends Error' packages/lykoi-adapter-telegram/src/transport.ts || true)
[ "$N" = 1 ] || { echo "FATAL: transport.ts 缺 TelegramPollError（计数 $N）"; exit 1; }
N=$(grep -cF 'throw new TelegramPollError(result.error, result.status)' packages/lykoi-adapter-telegram/src/production.ts || true)
[ "$N" = 1 ] || { echo "FATAL: production.ts 缺失败即抛（计数 $N）"; exit 1; }
N=$(grep -cF 'export function runPollLoop(' packages/lykoi-adapter-telegram/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: index.ts 缺 runPollLoop（计数 $N）"; exit 1; }
N=$(grep -cF "type: 'telegram/poll_backoff'" packages/lykoi-adapter-telegram/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: index.ts 缺 poll_backoff 审计（计数 $N）"; exit 1; }
# 改动只许 adapter-telegram 一包
P=$(git diff --name-only "$EXPECT_OLD" HEAD -- packages | { grep -v '^packages/lykoi-adapter-telegram/' || true; } | tr '\n' ' ')
[ -z "$P" ] || { echo "FATAL: packages 改动越出 adapter-telegram：$P"; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- profile || { echo 'FATAL: profile 有变——本单声明零 profile'; exit 1; }
# N/K/L/M 落点仍在
N=$(grep -cF '.ok === false' packages/lykoi-kernel/src/dispatch.ts || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 ok===false 规则丢了（计数 $N）"; exit 1; }
N=$(grep -cF 'export const TOOL_TABLE' packages/lykoi-converse/src/contract.ts || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 TOOL_TABLE 丢了（计数 $N）"; exit 1; }
N=$(grep -cE '^    reasoningEffort: low$' profile/cordis.prod.yml || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 reasoningEffort: low 丢了（计数 $N）"; exit 1; }
N=$(grep -cF "{ role: 'user', content: JSON_RETRY_NUDGE }" packages/lykoi-converse/src/contract.ts || true)
[ "$N" = 1 ] || { echo "FATAL: K 的 nudge 落点丢了（计数 $N）"; exit 1; }
N=$(grep -c 'json_mode: jsonMode,' packages/lykoi-converse/src/conversation.ts || true)
[ "$N" = 2 ] || { echo "FATAL: L 的 json_mode 字段丢了（计数 $N）"; exit 1; }
N=$(grep -cF 'export function toDshEnvelopeMessages(' packages/lykoi-converse/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: M 的缝处文本帧丢了（计数 $N）"; exit 1; }
N=$(grep -c 'EXPECTED_MIND_SCHEMA_VERSION = 17' packages/lykoi-memory/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: 版本常量 17 计数 $N ≠ 1"; exit 1; }
N=$(find governance/wo -path '*/migrations/018_*' 2>/dev/null | wc -l)
[ "$N" = 0 ] || { echo "FATAL: 树里出现 018 迁移件"; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- deploy package.json package-lock.json \
  || { echo 'FATAL: deploy/依赖有变——本单声明零 unit 零依赖'; exit 1; }
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

echo '== 4 · 重签 manifest + 完整性门（期望 113 条，与 N 相同；三个 src 文件在域内、内容变而条目不变） =='
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
echo '-- 6a adapter-telegram 单包测试（production.poll 失败即抛；runPollLoop 退避序列与 poll_backoff 审计）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test packages/lykoi-adapter-telegram/test/adapter.test.ts 2>&1 | grep -E '^(ℹ|not ok)' ) || echo 'WARN: adapter 单测非 0'
echo '-- 6b 读数'
systemctl show lykoi-cordis -p NRestarts
sudo -u lykoi sqlite3 "$DB" "SELECT 'autonomy_runs', COUNT(*) FROM autonomy_runs;"
tail -n 300 "$AUDIT" | grep -E '"type":"(restart_event|deploy_event)"' | cut -c1-300 || true
echo '-- 6c 落地前账（对照：落地后 502 连发相邻间隔 ≥ 1 s 递增；telegram/poll_backoff 开始出现）'
grep -c '"type":"telegram_transport_api_error"' "$AUDIT" | sed 's/^/telegram_transport_api_error 累计（落地前）: /' || true
grep -c '"type":"telegram_transport_network_error"' "$AUDIT" | sed 's/^/telegram_transport_network_error 累计（落地前）: /' || true
grep -c '"type":"telegram/poll_backoff"' "$AUDIT" | sed 's/^/telegram\/poll_backoff 累计（落地前，预期 0）: /' || true

echo '== 7 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s
' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-o-pollbackoff","wo":"WO-FIX-POLLBACKOFF-01","detail":"零迁移落地：产线树 main@e299c1d→main@3c47c2e；production.poll 失败即抛 TelegramPollError，runPollLoop 退避 1→60s 真正接住 getUpdates 失败，审计新增 telegram/poll_backoff；manifest 113 重签；宿主未动"}' >> /home/lykoi-gov/reports/governance-ops.jsonl
echo '== 落地稿 O 完成：产线钉点 main@3c47c2e，schema 仍 17，宿主未动 =='

# ---- ROLLBACK（§4 门红 / §5 大脑起不来时手动执行；库未动，不需恢复备份）----
# cd /home/lykoi/projects/lykoi-cordis
# git checkout -f --detach e299c1dc69e3fb4123e92445ebc225510cc151e8
# chown -R root:root packages profile && chmod -R go-w packages profile
# /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest     # 期望 113 条
# sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts        # 须 gate: OK
# systemctl start lykoi-cordis.service && sleep 8 && systemctl is-active lykoi-cordis
# systemctl enable --now lykoi-cordis-watchdog.timer && systemctl start lykoi-cordis-backup.timer
