#!/bin/bash
# LANDING-P · 三单合批落地（WO-OUTCOME-01 + WO-OVERLAY-WAKE-01 + WO-CONTINUATION-01）—— 产线树 main@db151e1 → bundle 里的 main
# 本稿与 G–O 同形，差异只有一处：**含迁移 018（mind_schema 17 → 18，新表 pending_continuations）**，
#   顺序硬约束：停 → 备份 → 迁移 → 钉树 → 重签 → 起新体（新旧两体都按 MAX(version) 恰等于自己认识的值拒开）。
# 零 unit 变化、零 profile 变化、零新依赖、vendor 不动；src 新增 4 文件（converse/continuation.ts、failure.ts、outcome.ts；decide/overlay.ts）→ manifest 113 → 117。
# 新 sha 不写死：从 bundle 的 refs/heads/main 取，并断言 c99729a（wo/continuation-01 尖）是它的祖先。
# 用法（root）：
#   sha256sum /tmp/lykoi-landing-p.bundle /tmp/landing-p-continuation.sh   # 与 Mac 上 shasum -a 256 的值逐字对
#   sudo bash /tmp/landing-p-continuation.sh 2>&1 | tee /root/landing-p-$(date +%Y%m%dT%H%M%S).log
set -euo pipefail
NODE=/opt/node-v24.18.0/bin/node
NPM=/opt/node-v24.18.0/bin/npm
REPO=/home/lykoi/projects/lykoi-cordis
DB=/home/lykoi/state/memory.db
EXPECT_OLD=db151e143e574dc01732531b57603603b2c5138c
CHAIN_TIP=c99729ad20974f142630ba7abbe03f9607125cf8
BUNDLE=/tmp/lykoi-landing-p.bundle
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56
AUDIT=/var/log/lykoi-audit/audit.jsonl
UP_SQL=governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.up.sql
EXPECT_MANIFEST=117

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
if [ "$V" != 17 ] && [ "$V" != 18 ]; then echo "FATAL: mind_schema=$V 既非 17 也非 18——停手找治理侧"; exit 1; fi
if [ "$V" = 18 ] && [ "$HEAD_NOW" = "$EXPECT_OLD" ]; then echo 'FATAL: 库已 18 但树仍旧——上次中断在迁移后钉树前，找治理侧'; exit 1; fi
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

echo '== 2 · 窗内备份（root 侧，含字节数下限闸；迁移前必做） =='
BK="/root/backup-pre-continuation-$(date +%Y%m%dT%H%M%S).tar.gz"
tar -C /home/lykoi -czf "$BK" state
SZ=$(stat -c %s "$BK")
if [ "$SZ" -lt 1048576 ]; then echo "FATAL: 备份 $SZ 字节 < 1MB"; exit 1; fi
echo "BACKUP OK: $BK ($SZ bytes)"; sha256sum "$BK"

echo '== 3 · 树落地（钉 bundle 的 main）+ 依赖 + 属主 =='
git fetch "$BUNDLE" '+refs/heads/main:refs/heads/main'
git merge-base --is-ancestor "$CHAIN_TIP" "$NEW_SHA" || { echo "FATAL: $NEW_SHA 不含 wo/continuation-01 尖 $CHAIN_TIP"; exit 1; }
git checkout -f --detach "$NEW_SHA"
[ "$(git rev-parse HEAD)" = "$NEW_SHA" ] || { echo 'FATAL: HEAD 不在钉点'; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1; }
# 内容断言：三单落点
N=$(grep -cF 'EXPECTED_MIND_SCHEMA_VERSION = 18' packages/lykoi-memory/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: 版本常量 18 计数 $N ≠ 1"; exit 1; }
N=$(grep -cF 'CREATE TABLE IF NOT EXISTS pending_continuations' packages/lykoi-memory/src/schema.ts || true)
[ "$N" = 1 ] || { echo "FATAL: schema.ts 缺 pending_continuations（计数 $N）"; exit 1; }
[ -f "$UP_SQL" ] || { echo "FATAL: 缺迁移件 $UP_SQL"; exit 1; }
N=$(grep -cF 'export class ContinuationRunner' packages/lykoi-converse/src/continuation.ts || true)
[ "$N" = 1 ] || { echo "FATAL: continuation.ts 缺 ContinuationRunner（计数 $N）"; exit 1; }
N=$(grep -cF 'export function failureReason(' packages/lykoi-converse/src/failure.ts || true)
[ "$N" = 1 ] || { echo "FATAL: failure.ts 缺 failureReason（计数 $N）"; exit 1; }
N=$(grep -cF "'turn/'," packages/lykoi-gate/src/vocabulary.ts || true)
[ "$N" = 1 ] || { echo "FATAL: vocabulary.ts 缺 turn/ 前缀（计数 $N）"; exit 1; }
N=$(grep -cF "'continuation/'," packages/lykoi-gate/src/vocabulary.ts || true)
[ "$N" = 1 ] || { echo "FATAL: vocabulary.ts 缺 continuation/ 前缀（计数 $N）"; exit 1; }
N=$(grep -cF 'export function buildRelationshipOverlay(' packages/lykoi-decide/src/overlay.ts || true)
[ "$N" = 1 ] || { echo "FATAL: decide/overlay.ts 缺 buildRelationshipOverlay（计数 $N）"; exit 1; }
N=$(grep -cF 'export function runCheapTick(' packages/lykoi-wake/src/index.ts || true)
[ "$N" = 1 ] || { echo "FATAL: wake/index.ts 缺 runCheapTick（计数 $N）"; exit 1; }
# N/K/L/M/O 落点仍在
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

echo '== 4 · 迁移 018（lykoi 身份，-bail；重跑撞版本行主键即整段回滚，库不变） =='
V=$(sudo -u lykoi sqlite3 "$DB" 'SELECT MAX(version) FROM mind_schema;')
if [ "$V" = 17 ]; then
  sudo -u lykoi sqlite3 -bail "$DB" < "$UP_SQL"
else
  echo "库已是 $V，跳过施加（重入）"
fi
V=$(sudo -u lykoi sqlite3 "$DB" 'SELECT MAX(version) FROM mind_schema;')
[ "$V" = 18 ] || { echo "FATAL: 迁移后 mind_schema=$V ≠ 18"; exit 1; }
sudo -u lykoi sqlite3 "$DB" "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%continuation%' ORDER BY name;" \
  | grep -qx 'idx_pending_continuations_due' || { echo 'FATAL: 索引 idx_pending_continuations_due 不在'; exit 1; }
sudo -u lykoi sqlite3 "$DB" "PRAGMA integrity_check;" | grep -qx ok || { echo 'FATAL: integrity_check 非 ok'; exit 1; }
echo 'MIGRATION 018 OK（schema 18）'

echo "== 5 · 重签 manifest + 完整性门（期望 $EXPECT_MANIFEST 条 = 113 + 4 个新 src 文件） =="
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
echo '-- 7a 四个单测文件（memory 续跑行 + 迁移 018 实录；converse 续跑器；wake cheap tick 扫描）'
( cd "$REPO" && sudo -u lykoi -H "$NODE" --test \
    packages/lykoi-memory/test/rw-continuations.test.ts packages/lykoi-memory/test/migration-018.test.ts \
    packages/lykoi-converse/test/continuation.test.ts packages/lykoi-wake/test/cheap-tick-continuation.test.ts \
    2>&1 | grep -E '^(ℹ|not ok)' ) || echo 'WARN: 单测非 0'
echo '-- 7b 读数'
systemctl show lykoi-cordis -p NRestarts
sudo -u lykoi sqlite3 "$DB" "SELECT 'autonomy_runs', COUNT(*) FROM autonomy_runs;"
sudo -u lykoi sqlite3 "$DB" "SELECT 'pending_continuations', state, COALESCE(terminal_reason,''), COUNT(*) FROM pending_continuations GROUP BY 2,3;"
tail -n 300 "$AUDIT" | grep -E '"type":"(restart_event|deploy_event)"' | cut -c1-300 || true
echo '-- 7c 落地前账（对照：落地后 turn/terminal 每回合一行且带 continuation_id；她说"稍后做"后出现 continuation/terminal）'
grep -c '"type":"turn/terminal"' "$AUDIT" | sed 's/^/turn\/terminal 累计（落地前，预期 0）: /' || true
grep -c '"type":"continuation/' "$AUDIT" | sed 's/^/continuation\/* 累计（落地前，预期 0）: /' || true

echo '== 8 · 记账 =='
mkdir -p /home/lykoi-gov/reports
printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing-p-continuation","wo":"WO-OUTCOME-01+WO-OVERLAY-WAKE-01+WO-CONTINUATION-01","detail":"含迁移落地：产线树 main@db151e1→main@'"${NEW_SHA:0:7}"'；mind_schema 17→18（pending_continuations）；turn/* 终局正本 + 关系覆盖层入 wake 装配 + promise_followup 续跑器；manifest 117 重签；零 unit 零 profile 零依赖；宿主未动"}' >> /home/lykoi-gov/reports/governance-ops.jsonl
echo "== 落地稿 P 完成：产线钉点 main@${NEW_SHA:0:7}，schema 18，宿主未动 =="

# ---- ROLLBACK（§5 门红 / §6 大脑起不来时手动执行）----
# 库：018 只加表；down 只撤版本行（表与行留着），旧体（17）即可开门：
#   sudo -u lykoi sqlite3 -bail /home/lykoi/state/memory.db < /home/lykoi/projects/lykoi-cordis/governance/wo/WO-CONTINUATION-01/migrations/018_pending_continuations.down.sql
# 树：
#   cd /home/lykoi/projects/lykoi-cordis
#   git checkout -f --detach db151e143e574dc01732531b57603603b2c5138c
#   chown -R root:root packages profile && chmod -R go-w packages profile
#   /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts --write-manifest     # 期望 113 条
#   sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts        # 须 gate: OK
#   systemctl start lykoi-cordis.service && sleep 8 && systemctl is-active lykoi-cordis
#   systemctl enable --now lykoi-cordis-watchdog.timer && systemctl start lykoi-cordis-backup.timer
# 再前滚：只重放版本行那一句（down 文件头注），树回到 NEW_SHA 重签 117。
