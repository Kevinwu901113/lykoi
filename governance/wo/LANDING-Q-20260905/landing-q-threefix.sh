#!/bin/bash
# LANDING-Q · 三单合批落地（WO-FIX-TAILBRACE-01 + WO-FIX-UNDELIVERED-BRIDGE-01 + WO-UTTER-01）—— 产线树 main@8da87dc → bundle 里的 main
# 与 P v2 同形，去掉迁移段：**零迁移（mind_schema 仍 18）**、零 unit、零 profile、零新依赖、vendor 不动。
# src 改动 7 文件、无新文件（decide/index.ts；converse/contract.ts、conversation.ts；adapter-telegram/transport.ts、index.ts、production.ts、testing.ts）→ manifest 仍 117，须 root 重签。
# EXPECT_OLD = 产线钉点 8da87dc（LANDING-P），不是 main 尖（教训 55）。8da87dc..main 除三单外只动 governance/ 与两个 test 文件。
# 新 sha 不写死：从 bundle 的 refs/heads/main 取，并断言三分支尖都是它的祖先。
# 用法（root）：
#   sha256sum /tmp/lykoi-landing-q.bundle /tmp/landing-q-threefix.sh   # 与 Mac 上 shasum -a 256 的值逐字对
#   sudo bash /tmp/landing-q-threefix.sh 2>&1 | tee /root/landing-q-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
NODE=/opt/node-v24.18.0/bin/node
NPM=/opt/node-v24.18.0/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
DB=/home/lykoi/state/memory.db
EXPECT_OLD=8da87dc9c4dc4dfd1a6a1fba8f878762c77a8cb7
TIP_TAILBRACE=3698defdb967c59418967fedc04908a108d66978
TIP_BRIDGE=5830ca8ca292ea3e5fb242d6d0899d054f29b922
TIP_UTTER=ad41233a3439921bbc0c615b2a191aee53169481
BUNDLE=/tmp/lykoi-landing-q.bundle
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
PROMPTS_SHA=fa741ce26cb4ba7851ad666a2d7807aaee55cf77cb9c688dd02d74cd712703a5
AUDIT=/var/log/lykoi-audit/audit.jsonl
EXPECT_MANIFEST=117
EXPECT_SCHEMA=18

echo '== 0 · 前验（全部只读；任何一条不过则整稿未动） =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
[ -f "$BUNDLE" ] || { echo "FATAL: 缺 $BUNDLE"; exit 1; }
sha256sum "$BUNDLE"
echo "$PERSONA_SHA  $PERSONA" | sha256sum -c -
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO" \
  || git config --global --add safe.directory "$REPO"
cd "$REPO"
git bundle verify "$BUNDLE"
NEW_SHA=$(git bundle list-heads "$BUNDLE" | awk '$2 == "refs/heads/main" {print $1}')
[ -n "$NEW_SHA" ] || { echo 'FATAL: bundle 里没有 refs/heads/main'; exit 1; }
HEAD_NOW=$(git rev-parse HEAD)
if [ "$HEAD_NOW" != "$EXPECT_OLD" ] && [ "$HEAD_NOW" != "$NEW_SHA" ]; then
  echo "FATAL: 产线 HEAD=$HEAD_NOW 非预期起点——状态未知，停手找治理侧"; exit 1
fi
V=$(sudo -u lykoi sqlite3 "$DB" 'SELECT MAX(version) FROM mind_schema;')
[ "$V" = "$EXPECT_SCHEMA" ] || { echo "FATAL: mind_schema=$V ≠ $EXPECT_SCHEMA——本单零迁移，停手找治理侧"; exit 1; }
R_PRE=$(sudo -u lykoi sqlite3 "$DB" 'SELECT COUNT(*) FROM autonomy_runs;')
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主 lykoi-browser.service 不在跑——本单不动它，先查'; exit 1; }
command -v sqlite3 >/dev/null || { echo 'FATAL: 无 sqlite3'; exit 1; }
echo "前验通过（HEAD=$HEAD_NOW NEW=$NEW_SHA schema=$V autonomy_runs=$R_PRE 宿主 active）"

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
BK="/root/backup-pre-threefix-q-$(date +%Y%m%dT%H%M%S).tar.gz"
tar -C /home/lykoi -czf "$BK" state
SZ=$(stat -c %s "$BK")
if [ "$SZ" -lt 1048576 ]; then echo "FATAL: 备份 $SZ 字节 < 1MB"; exit 1; fi
echo "BACKUP OK: $BK ($SZ bytes)"; sha256sum "$BK"

echo '== 3 · 树落地（钉 bundle 的 main）+ 依赖 + 属主 =='
git fetch "$BUNDLE" '+refs/heads/main:refs/heads/main'
for TIP in "$TIP_TAILBRACE" "$TIP_BRIDGE" "$TIP_UTTER"; do
  git merge-base --is-ancestor "$TIP" "$NEW_SHA" || { echo "FATAL: $NEW_SHA 不含分支尖 $TIP"; exit 1; }
done
git checkout -f --detach "$NEW_SHA"
[ "$(git rev-parse HEAD)" = "$NEW_SHA" ] || { echo 'FATAL: HEAD 不在钉点'; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1; }
# 内容断言：三单落点
N=$(grep -cF 'export function repairTrailingClosers(' packages/lykoi-decide/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: TAILBRACE repairTrailingClosers 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'export const REPAIR_CLOSERS_MAX = 4' packages/lykoi-decide/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: TAILBRACE REPAIR_CLOSERS_MAX 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF "'u3_cycle_repaired'" packages/lykoi-converse/src/contract.ts || true)
[ "$N" = 1 ] || { echo "FATAL: TAILBRACE u3_cycle_repaired 常量计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'repairTrailingClosers(' packages/lykoi-converse/src/conversation.ts || true)
[ "$N" -ge 1 ] || { echo "FATAL: conversation.ts 未调用 repairTrailingClosers"; exit 1; }
N=$(grep -cF 'undelivered_recorded: result.undelivered_recorded' packages/lykoi-adapter-telegram/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: BRIDGE 桥透传计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'undelivered_recorded: result.undelivered_recorded' packages/lykoi-adapter-telegram/src/production.ts || true)
[ "$N" = 1 ] || { echo "FATAL: BRIDGE 生产 transport 透传计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'export const TELEGRAM_TEXT_MAX = 4096' packages/lykoi-adapter-telegram/src/transport.ts || true)
[ "$N" = 1 ] || { echo "FATAL: UTTER TELEGRAM_TEXT_MAX 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'export function splitForTelegram(' packages/lykoi-adapter-telegram/src/transport.ts || true)
[ "$N" = 1 ] || { echo "FATAL: UTTER splitForTelegram 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF "logEvent('telegram_transport_split'" packages/lykoi-adapter-telegram/src/transport.ts || true)
[ "$N" = 1 ] || { echo "FATAL: UTTER split 事件计数 $N ≠ 1"; exit 1; }
N=$(grep -cF "'partial_delivery'" packages/lykoi-adapter-telegram/src/transport.ts || true)
[ "$N" -ge 1 ] || { echo "FATAL: UTTER partial_delivery 不在"; exit 1; }
N=$(grep -cF 'parts: result.parts ?? 1' packages/lykoi-adapter-telegram/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: UTTER telegram/sent.parts 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'result.parts >= 2' packages/lykoi-adapter-telegram/src/production.ts || true)
[ "$N" = 2 ] || { echo "FATAL: UTTER production parts 透传计数 $N ≠ 2"; exit 1; }
# G-2：提示词一字未动
echo "$PROMPTS_SHA  packages/lykoi-converse/src/prompts.ts" | sha256sum -c - || { echo 'FATAL: prompts.ts sha 变了——三单声明不动提示词'; exit 1; }
# 越界检查：src 改动只许在三个包，且恰 7 文件（grep 零匹配不许静默死——教训 54）
CHANGED_SRC=$(git diff --name-only "$EXPECT_OLD" HEAD -- packages | { grep '/src/' || true; })
N=$(printf '%s\n' "$CHANGED_SRC" | { grep -c . || true; })
[ "$N" = 7 ] || { echo "FATAL: src 改动 $N 文件 ≠ 7："; printf '%s\n' "$CHANGED_SRC"; exit 1; }
OUT=$(printf '%s\n' "$CHANGED_SRC" | { grep -vE '^packages/lykoi-(decide|converse|adapter-telegram)/src/' || true; })
[ -z "$OUT" ] || { echo 'FATAL: src 改动越出 decide/converse/adapter-telegram：'; printf '%s\n' "$OUT"; exit 1; }
# N/M/O/P 落点仍在
N=$(grep -cF 'EXPECTED_MIND_SCHEMA_VERSION = 18' packages/lykoi-memory/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: P 的版本常量 18 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'export class ContinuationRunner' packages/lykoi-converse/src/continuation.ts || true)
[ "$N" = 1 ] || { echo "FATAL: P 的 ContinuationRunner 丢了（计数 $N）"; exit 1; }
N=$(grep -cF "'turn/'," packages/lykoi-gate/src/vocabulary.ts || true)
[ "$N" = 1 ] || { echo "FATAL: P 的 turn/ 前缀丢了（计数 $N）"; exit 1; }
N=$(grep -cF '.ok === false' packages/lykoi-kernel/src/dispatch.ts || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 ok===false 规则丢了（计数 $N）"; exit 1; }
N=$(grep -cF 'export const TOOL_TABLE' packages/lykoi-converse/src/contract.ts || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 TOOL_TABLE 丢了（计数 $N）"; exit 1; }
N=$(grep -cE '^    reasoningEffort: low$' profile/cordis.prod.yml || true)
[ "$N" = 1 ] || { echo "FATAL: N 的 reasoningEffort: low 丢了（计数 $N）"; exit 1; }
N=$(grep -cF 'export function toDshEnvelopeMessages(' packages/lykoi-converse/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: M 的缝处文本帧丢了（计数 $N）"; exit 1; }
N=$(grep -cF 'export function runPollLoop(' packages/lykoi-adapter-telegram/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: O 的 runPollLoop 丢了（计数 $N）"; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- profile || { echo 'FATAL: profile 有变——本单声明零 profile'; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- deploy package.json package-lock.json \
  || { echo 'FATAL: deploy/依赖有变——本单声明零 unit 零依赖'; exit 1; }
git diff --quiet "$EXPECT_OLD" HEAD -- packages/lykoi-llm-deepseek/vendor \
  || { echo 'FATAL: vendor 有变——本单声明 adapter 不动'; exit 1; }
ls packages/lykoi-memory/src 2>/dev/null | { grep -c '019' || true; } | grep -qx 0 || { echo 'FATAL: 出现 019 迁移件——本单声明零迁移'; exit 1; }
[ "$(readlink -f "$REPO/var/state")" = /home/lykoi/state ] || { echo 'FATAL: var/state 软链非 canonical'; exit 1; }
echo 'TREE PINNED CLEAN OK'
chown -R lykoi:lykoi "$REPO/packages" "$REPO/profile"
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" "$NPM" ci --ignore-scripts --prefix "$REPO"
sudo -u lykoi -H env PATH="/opt/node-v24.18.0/bin:/usr/bin:/bin" node -v | grep -q "^v24" || { echo "FATAL: npm ci 用的不是 Node 24"; exit 1; }
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"
N=$(find "$REPO" -path "$REPO/.git" -prune -o \( -type d ! -perm -o=rx -o -type f ! -perm -o=r \) -print | wc -l)
if [ "$N" != 0 ]; then echo "WARN: 树内 $N 项对 other 不可读，补 o+rX"; chmod -R o+rX "$REPO"; fi
if [ -n "$(git status --porcelain)" ]; then
  echo 'WARN: npm ci 后树不净（记给治理侧）：'; git status --porcelain
  git checkout -f -- . ; chmod -R go-w "$REPO/packages" "$REPO/profile"
fi
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: 恢复后树仍不净（内容差异）'; git status --porcelain; git diff | head -40; exit 1; }
echo 'DEPS + OWNERSHIP OK（npm ci 后树净）'

echo '== 4 · 库只读复核（零迁移：只看不动） =='
V=$(sudo -u lykoi sqlite3 "$DB" 'SELECT MAX(version) FROM mind_schema;')
[ "$V" = "$EXPECT_SCHEMA" ] || { echo "FATAL: mind_schema=$V ≠ $EXPECT_SCHEMA"; exit 1; }
sudo -u lykoi sqlite3 "$DB" "PRAGMA integrity_check;" | grep -qx ok || { echo 'FATAL: integrity_check 非 ok'; exit 1; }
echo "DB READ-ONLY OK（schema $V）"

echo "== 5 · 重签 manifest + 完整性门（期望 $EXPECT_MANIFEST 条 = 117，本批无新 src 文件） =="
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts
M=$(wc -l < packages/lykoi-gate/manifest.sha256)
echo "manifest 条目数: $M"
[ "$M" = "$EXPECT_MANIFEST" ] || { echo "FATAL: manifest 条目数 $M ≠ $EXPECT_MANIFEST"; exit 1; }

echo '== 6 · 起大脑 =='
systemctl start lykoi-cordis.service
sleep 8
systemctl is-active --quiet lykoi-cordis || { echo 'FATAL: 大脑起立失败'; journalctl -u lykoi-cordis -n 30 --no-pager; exit 1; }
journalctl -u lykoi-cordis -n 30 --no-pager | grep -q 'production assembly up' || { echo 'FATAL: 未见 production assembly up'; exit 1; }
systemctl enable --now lykoi-cordis-watchdog.timer
systemctl start lykoi-cordis-backup.timer
systemctl is-active --quiet lykoi-browser.service || { echo 'FATAL: 宿主在落地中掉了'; exit 1; }
echo 'ASSEMBLY UP OK（watchdog/备份 timer 已回位；宿主未动仍 active）'
tail -n 200 "$AUDIT" | grep -q '"browser_organ_wired"' && echo 'audit: browser_organ_wired 在' || echo 'WARN: 审计尾 200 行未见 browser_organ_wired'

echo '== 7 · 服务器实证（信息性，不回滚） =='
echo '-- 7a 四个单测文件（decide 修复纯函数；converse 信封周期含修复三例；adapter 桥四例 + 切分 21 例）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test \
    packages/lykoi-decide/test/repair.test.ts packages/lykoi-converse/test/cycle.test.ts \
    packages/lykoi-adapter-telegram/test/bridge.test.ts packages/lykoi-adapter-telegram/test/split.test.ts \
    2>&1 | grep -E '^(ℹ|✖|not ok)' ) || echo 'WARN: 单测非 0'
echo '-- 7b 读数'
systemctl show lykoi-cordis -p NRestarts
sudo -u lykoi sqlite3 "$DB" "SELECT 'autonomy_runs', COUNT(*) FROM autonomy_runs;"
tail -n 300 "$AUDIT" | grep -E '"type":"(restart_event|deploy_event)"' | cut -c1-300 || true
echo '-- 7c 落地前账（对照：落地后缺尾括号时出现 u3_cycle_repaired 且不伴 u3_cycle_retried；telegram/sent 每条带 parts；超长回复才有 telegram_transport_split）'
grep -c '"type":"u3_cycle_repaired"' "$AUDIT" | sed 's/^/u3_cycle_repaired 累计（落地前，预期 0）: /' || true
grep -c '"type":"telegram\/sent"' "$AUDIT" | sed 's/^/telegram\/sent 累计: /' || true
grep '"type":"telegram\/sent"' "$AUDIT" | { grep -vc '"parts"' || true; } | sed 's/^/telegram\/sent 不带 parts（落地前 = 全部；落地后新增应为 0）: /'
grep -c 'telegram_transport_split' "$AUDIT" | sed 's/^/telegram_transport_split 累计（落地前，预期 0；若事件流不在审计文件则恒 0）: /' || true
grep -c '"partial_delivery"' "$AUDIT" | sed 's/^/partial_delivery 累计（落地前，预期 0）: /' || true

echo '== 8 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-q-threefix","wo":"WO-FIX-TAILBRACE-01+WO-FIX-UNDELIVERED-BRIDGE-01+WO-UTTER-01","detail":"零迁移落地：产线树 main@8da87dc→main@'"${NEW_SHA:0:7}"'；信封缺尾括号本地修复 + 未送达记账位过桥 + 出站 4096 逐字切分；manifest 117 重签；零 unit 零 profile 零依赖；宿主未动"}' >> /home/lykoi-gov/reports/governance-ops.jsonl
echo "== 落地稿 Q 完成：产线钉点 main@${NEW_SHA:0:7}，schema $EXPECT_SCHEMA，宿主未动 =="

# ---- ROLLBACK（§5 门红 / §6 大脑起不来时手动执行；零迁移，库不动）----
#   cd /home/lykoi/projects/lykoi-cordis
#   git checkout -f --detach 8da87dc9c4dc4dfd1a6a1fba8f878762c77a8cb7
#   chown -R root:root packages profile && chmod -R go-w packages profile
#   /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest     # 期望 117 条
#   sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts        # 须 gate: OK
#   systemctl start lykoi-cordis.service && sleep 8 && systemctl is-active lykoi-cordis
#   systemctl enable --now lykoi-cordis-watchdog.timer && systemctl start lykoi-cordis-backup.timer
