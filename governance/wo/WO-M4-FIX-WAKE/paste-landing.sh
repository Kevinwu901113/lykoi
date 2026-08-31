#!/bin/bash
# ============================================================================
# WO-M4-FIX-WAKE · 落地粘贴稿 —— 完全修法上线（root 执行，单稿一次跑完）
# ============================================================================
# 树钉点：m4-switch = 7fed677434f99d61ddf48e818111099eebde0a95
#         （= main cb2e27e + 六器官位翻开；learn 位已退役，ebaeda8 七位版作废）
# 材料（治理侧已 scp 至服务器 /tmp）：
#   /tmp/lykoi-m4fixwake-20260901.bundle   增量 bundle（基 27f4682，含 main+m4-switch）
# 运行：sudo bash /tmp/paste-landing-m4fixwake.sh   （或整稿粘贴 root shell）
#
# 【已执行：2026-09-01 01:46，落地成功——十二插件起立（基线六 + 翻位六）、
#  gate OK、manifest 仍 103 文件。本版为执行后修正稿：原稿第 2 步六位断言
#  两处作者错误——① grep 模式取严格子串「切换态启用（m4-switch）」，heart 位
#  注释是「（m4-switch；R-01：…）」变体，只命中 5；② `[ … ] && echo` 在
#  set -e 下测试失败**不会中止**（AND-OR 列表豁免），断言静默滑过。
#  修正：模式放宽为「# 切换态启用」，全部软断言改显式 if/exit 硬断言。
#  树本身核实无误（六位逐名对上 apply 日志）。教训入 HANDOFF 候选。】
#
# 本稿会**覆盖**止损标注（2026-09-01 01:17 对 yml 两行的 sed）——那是治理侧
# 已知且预期的：checkout -f 后树回到签名对象，止损痕迹无需手工回收。
# 树属 root 动作域（W2 粘贴稿 1 步 7 定案），git 以 root 跑，.git 内混入
# root 属主对象为预期；后续树操作一律 root。
# 全稿幂等，跑一半断了可整稿重跑。无依赖变更（lockfile 未动），不跑 npm ci。
set -euo pipefail

NODE=/opt/node-v24.18.0/bin/node
REPO=/home/lykoi/projects/lykoi-cordis
SWITCH_SHA=7fed677434f99d61ddf48e818111099eebde0a95
BUNDLE=/tmp/lykoi-m4fixwake-20260901.bundle
BUNDLE_SHA=03e1e9872a131dce2aa09a452256f313c9db8a0a832531a9fa4dd1ccc1861bf4
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
PERSONA_SHA=df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56

echo '== 0 · 前验（全部只读；任何一条不过则整稿未动） =='
[ "$(id -u)" = 0 ]
echo "$BUNDLE_SHA  $BUNDLE" | sha256sum -c -
git config --global --get-all safe.directory 2>/dev/null | grep -qx "$REPO" \
  || git config --global --add safe.directory "$REPO"
cd "$REPO"
git bundle verify "$BUNDLE"   # 顺带核前置血统 27f4682 在树（服务器克隆自带）
# 人格 TOML：wake 起立即读它（D-FIX-1），先核内容 sha 与 lykoi 可读
echo "$PERSONA_SHA  $PERSONA" | sha256sum -c -
if ! sudo -u lykoi test -r "$PERSONA"; then
  echo 'FATAL: persona TOML 对 lykoi 不可读'; exit 1
fi
echo 'persona readable by lykoi: OK'

echo '== 1 · 树落地（取 bundle → 钉点 checkout，覆盖止损 sed 痕迹） =='
git fetch "$BUNDLE" \
  '+refs/heads/main:refs/heads/main' \
  '+refs/heads/m4-switch:refs/heads/m4-switch' \
  '+refs/heads/*:refs/remotes/bundle/*'
git checkout -f --detach "$SWITCH_SHA"
[ "$(git rev-parse HEAD)" = "$SWITCH_SHA" ]
# 注意：断言一律显式 if/exit —— `[ … ] && echo` 在 set -e 下失败不中止。
if [ -n "$(git status --porcelain)" ]; then
  echo 'FATAL: checkout 后树不净'; git status --porcelain; exit 1
fi
echo 'TREE PINNED CLEAN OK'

echo '== 2 · 落地树内容断言（本单两根因的出生规格核验） =='
if ! grep -q '^    personaToml: /home/lykoi/runtime/persona/lykoi_base.toml' \
  profile/cordis.prod.yml; then
  echo 'FATAL: wake 块缺 personaToml（D-FIX-1）'; exit 1
fi
echo 'wake personaToml: OK'
if grep -qE '^\s*name: lykoi-learn' profile/cordis.prod.yml; then
  echo 'FATAL: learn 条目仍在（应已退役，D-FIX-2）'; exit 1
fi
echo 'no learn entry: OK'
# 模式取「# 切换态启用」前缀：六条注释有一条带「；R-01：…」变体后缀
FLIPS=$(grep -c '# 切换态启用' profile/cordis.prod.yml)
if [ "$FLIPS" != 6 ]; then
  echo "FATAL: 翻位注释计数 $FLIPS ≠ 6"; exit 1
fi
echo 'six organ flips: OK'

echo '== 3 · root 属主域重整（checkout 后重申，幂等） =='
chown -R root:root "$REPO/packages" "$REPO/profile"
chmod -R go-w "$REPO/packages" "$REPO/profile"

echo '== 4 · 重签 manifest + 完整性门试跑（止损时点 103 文件，新数以输出为准记录） =='
"$NODE" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts

echo '== 5 · 重启与读数（停机窗 = 这一瞬） =='
systemctl restart lykoi-cordis
sleep 8
systemctl is-active lykoi-cordis
systemctl status lykoi-cordis --no-pager -n 0 | head -12
journalctl -u lykoi-cordis -n 30 --no-pager | tail -20
if ! journalctl -u lykoi-cordis -n 30 --no-pager | grep 'production assembly up'; then
  echo 'FATAL: 未见 production assembly up'; exit 1
fi
echo 'ASSEMBLY UP OK'
# 插件起立数实测：十二 = 基线六件 + 翻位六器官（apply plugin 行逐名可对）

echo '== 6 · wake 首拍观察（不必守着；最长等心跳基线 30 分钟） =='
echo '>> 首拍到账看审计流（出现 autonomy_wake 即她第一次自主醒拍）：'
echo '>>   grep -c autonomy_wake /var/log/lykoi-audit/audit.jsonl'
echo '>>   journalctl -u lykoi-cordis --since "-40min" --no-pager | grep -i wake'
echo '== 落地稿完成：wake 以 personaToml 配置面首次真启用，learn 位已不存在。 =='
