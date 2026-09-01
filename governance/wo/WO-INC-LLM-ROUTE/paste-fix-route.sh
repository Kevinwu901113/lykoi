#!/bin/bash
# ============================================================================
# WO-INC-LLM-ROUTE · 落地粘贴稿 —— LLM 路由名修正（root 执行，单稿一次跑完）
# ============================================================================
# 事故：prod yml route=deepseek，vendor 只注册 deepseek-official → 自 M4 切换起
# wake/converse 全体 LLM 调用无声失败（audit 精确 autonomy_wake=0、charge 全 0）。
# 修正：route=deepseek-official、model=deepseek-v4-flash、budget 键随名——
# 全在 profile/cordis.prod.yml，无代码变更，无依赖变更，不跑 npm ci。
# 树钉点：m4-switch = acb814f08f3ebe17a1c3074ea121f9b74b515c0e
#         （= main 1e82ad8（事故单+修正）+ 六翻位 cherry-pick，措辞同 5f706bd）
# 材料（治理侧已 scp 至 /tmp）：
#   /tmp/lykoi-incroute-20260901.bundle（基 f37aac8，含新 main + 新 m4-switch）
# 断言一律显式 if/exit（教训 48）。全稿幂等，跑一半断了可整稿重跑。
set -euo pipefail

NODE=/opt/node-v24.18.0/bin/node
REPO=/home/lykoi/projects/lykoi-cordis
PIN=acb814f08f3ebe17a1c3074ea121f9b74b515c0e
OLDPIN=5f706bd91fc3c0b0093e566e94943d38e7488bfb
BUNDLE=/tmp/lykoi-incroute-20260901.bundle
BUNDLE_SHA=eb14facafc860fe4e9eda79548198eb372b2a354a6d109fccd777bff71bb25f0

echo '== 0 · 前验（全部只读） =='
if [ "$(id -u)" != 0 ]; then echo 'FATAL: 须 root'; exit 1; fi
echo "$BUNDLE_SHA  $BUNDLE" | sha256sum -c -
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO" \
  || git config --global --add safe.directory "$REPO"
cd "$REPO"
HEAD_NOW=$(git rev-parse HEAD)
if [ "$HEAD_NOW" != "$OLDPIN" ] && [ "$HEAD_NOW" != "$PIN" ]; then
  echo "FATAL: HEAD=$HEAD_NOW 不在旧钉点也不在新钉点——树状态出乎单据，停手找治理侧"; exit 1
fi
git bundle verify "$BUNDLE"

echo '== 1 · 树落地（取 bundle → 钉新点） =='
git fetch "$BUNDLE" \
  '+refs/heads/main:refs/heads/main' \
  '+refs/heads/m4-switch:refs/heads/m4-switch'
git checkout -f --detach "$PIN"
if [ "$(git rev-parse HEAD)" != "$PIN" ]; then echo 'FATAL: HEAD 不在新钉点'; exit 1; fi
if [ -n "$(git status --porcelain)" ]; then
  echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1
fi
echo 'TREE PINNED CLEAN OK'

echo '== 2 · 落地树内容断言（六处修正点 + 翻位不丢） =='
F=$(grep -c '# 切换态启用' profile/cordis.prod.yml)
if [ "$F" != 6 ]; then echo "FATAL: 翻位计数 $F ≠ 6"; exit 1; fi
R=$(grep -c '^    route: deepseek-official$' profile/cordis.prod.yml)
if [ "$R" != 2 ]; then echo "FATAL: route 修正点 $R ≠ 2"; exit 1; fi
M=$(grep -c '^    model: deepseek-v4-flash$' profile/cordis.prod.yml)
if [ "$M" != 2 ]; then echo "FATAL: model 修正点 $M ≠ 2"; exit 1; fi
if ! grep -q '^      deepseek-official: 2000000$' profile/cordis.prod.yml; then
  echo 'FATAL: budget 路由键未随名'; exit 1; fi
if grep -qE '^    route: deepseek$|^    model: deepseek-chat$' profile/cordis.prod.yml; then
  echo 'FATAL: 旧 route/model 残留'; exit 1; fi
echo 'tree content (route fix): OK'

echo '== 3 · root 属主域重整（checkout 后重申，幂等） =='
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"

echo '== 4 · 重签 manifest + 完整性门试跑 =='
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts

echo '== 5 · 起立 =='
systemctl restart lykoi-cordis
sleep 8
if ! systemctl is-active --quiet lykoi-cordis; then
  echo 'FATAL: 起立失败'; journalctl -u lykoi-cordis -n 30 --no-pager; exit 1
fi
if ! journalctl -u lykoi-cordis -n 30 --no-pager | grep 'production assembly up'; then
  echo 'FATAL: 未见 production assembly up'; exit 1
fi
echo 'ASSEMBLY UP OK'
# llm.env 供给位（信息性，不拦）：unit 引用了才有 DEEPSEEK_API_KEY。
if systemctl cat lykoi-cordis | grep -q 'llm.env'; then
  echo 'llm.env referenced by unit: OK'
else
  echo 'NOTE: unit 未引用 llm.env —— 若首拍报 MISSING_CREDENTIAL 从这里查'
fi

echo '== 6 · 记账 =='
if [ -d /home/lykoi-gov/reports ]; then
  printf '%s\n' '{"ts":"'"$(date -Iseconds)"'","actor":"root-paste","action":"landing","wo":"WO-INC-LLM-ROUTE","detail":"树重钉 acb814f：route=deepseek-official/model=deepseek-v4-flash/budget 键随名，manifest 重签，gate 全绿，assembly up"}' \
    >> /home/lykoi-gov/reports/governance-ops.jsonl
fi

echo '== 落地完成。事后实证（本单验收第 3 条，二选一或都做）：=='
echo '>> A（即时）：给她发条 Telegram —— 她回话 = converse 路活了，且立刻可见：'
echo ">>   grep '\"type\":\"budget/charge\"' /var/log/lykoi-audit/audit.jsonl | tail -1   # tokens 应 >0"
echo '>> B（≤30 分钟自然拍，且要有事可想才非 idle）：'
echo ">>   grep -c '\"type\":\"autonomy_wake\"' /var/log/lykoi-audit/audit.jsonl   # 从 0 变 ≥1 即首次成功思考"
