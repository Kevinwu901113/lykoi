#!/bin/bash
# U3S 切换粘贴稿(草案,复核后定稿) · Kevin root 单会话执行
# 内容 = 合并包 16:wo/u3s 合并 + HARD_ASK 加固补丁 + 切换 drop-in 翻转
# 占位:__U3S_TIP__ / __BUNDLE_SHA__ 由治理侧在复核 PASS 后填入
set -euo pipefail
R=/home/lykoi/projects/lykoi

echo "=== 0. 前验 ==="
[ "$(git -C $R rev-parse HEAD)" = "322380137c7951802123f0361e59fc055654339a" ] || { echo "HEAD 不是 32238013,停"; exit 1; }
systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
echo "__BUNDLE_SHA__  /tmp/lykoi-u3s-merge.bundle" | sha256sum -c -

echo "=== 1. 回滚锚 + 合并(非 ff,并行基) ==="
git -C $R tag -f rollback-pre-u3s-switch
git -C $R fetch /tmp/lykoi-u3s-merge.bundle "wo/u3s:wo/u3s"
[ "$(git -C $R rev-parse wo/u3s)" = "__U3S_TIP__" ] || { echo "u3s 尖不符,停"; exit 1; }
# manifest 必冲突(u3s 基 7b00ae5e 重签 110,live 已 112):先按 live 版收下,步 3 统一重签
git -C $R merge --no-ff wo/u3s -m "[MERGE] WO-U3S 周期合一切换(信封转正)" || {
  git -C $R checkout --ours guardian/manifest.sha256
  git -C $R add guardian/manifest.sha256
  git -C $R -c core.editor=true merge --continue
}

echo "=== 2. HARD_ASK 加固补丁(治理侧作者,红绿双态已验) ==="
git -C $R apply --check /tmp/hard-ask-delegation.patch
git -C $R apply /tmp/hard-ask-delegation.patch
git -C $R add guardian/policy_core.py tests/test_governance_invariants.py
git -C $R commit -m "[GOV] HARD_ASK_TYPES += delegation.dispatch(GW-01 采纳项,集合钉死+never_auto_allow)"

echo "=== 3. manifest 统一重签 + 属主归位(教训 37 三条排除) ==="
python3 $R/guardian/startup_verify.py --write-manifest   # 文档化重签入口(root;含活体绝对路径条目,必须在活体跑)
git -C $R add guardian/manifest.sha256
git -C $R commit -m "[GOV] manifest 重签(U3S 合并 + HARD_ASK 加固后统一)"
git -C $R diff --name-only rollback-pre-u3s-switch..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | while read f; do chown lykoi:lykoi "$R/$f"; done
chown root:root $R/guardian/*.py $R/guardian/manifest.sha256
find $R -name __pycache__ -path "*/core/*" -o -name __pycache__ -path "*/kernel/*" | xargs -r rm -rf

echo "=== 4. C 步(lykoi 身份;清单定稿时 ls 对树核实,教训 42) ==="
sudo -u lykoi bash -c "cd $R && timeout 1800 .venv/bin/pytest tests/test_governance_invariants.py tests/test_p0_integrity.py __U3S_新增套件占位__ -q"

echo "=== 5. 切换翻转(独立可回滚:回滚=删 drop-in + 重启,秒级) ==="
mkdir -p /etc/systemd/system/lykoi-server.service.d
printf '[Service]\nEnvironment=LYKOI_U3_SWITCH_ENABLED=1\n' > /etc/systemd/system/lykoi-server.service.d/20-u3-switch.conf
systemctl daemon-reload
systemctl restart lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
sleep 5; systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
journalctl -u lykoi-server -n 5 --no-pager | grep -i "startup_verify\|error" || true
curl -s http://127.0.0.1:8080/health || true

echo "=== 6. 收尾 ==="
git -C $R tag u3s-switch-$(date +%Y%m%d)
echo "E 步实弹(人工):①发普通消息→信封回复;②让她跑终端任务→审批问句为引用回复且不受打扰预算影响"
