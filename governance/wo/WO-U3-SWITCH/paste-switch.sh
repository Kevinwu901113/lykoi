#!/bin/bash
# U3S 切换粘贴稿(定稿 2026-08-22) · Kevin root 单会话执行
# = 合并包 16:wo/u3s 合并 + HARD_ASK 加固补丁 + manifest 统一重签 + 切换 drop-in 翻转
# 复核:WO-U3S 复核 PASS(wo/WO-U3-SWITCH/review.md);合并预演零冲突(治理侧已模拟)
# 材料(服务器上已就位,先核哈希):
#   /tmp/lykoi-u3s-merge.bundle   sha256 a026898f61689c336eb355cb367c0c6796ae56f42f6a194bd5e229300af3b7fd
#   /tmp/hard-ask-delegation.patch sha256 937204146b3dac6b7c2a366f02c2dd8e41d5e3dfb517e6bbf06515481024af5a
set -euo pipefail
R=/home/lykoi/projects/lykoi

echo "=== 0. 前验 ==="
[ "$(git -C $R rev-parse HEAD)" = "322380137c7951802123f0361e59fc055654339a" ] || { echo "HEAD 不是 32238013,停"; exit 1; }
systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
sha256sum -c - <<'EOF'
a026898f61689c336eb355cb367c0c6796ae56f42f6a194bd5e229300af3b7fd  /tmp/lykoi-u3s-merge.bundle
937204146b3dac6b7c2a366f02c2dd8e41d5e3dfb517e6bbf06515481024af5a  /tmp/hard-ask-delegation.patch
EOF

echo "=== 1. 回滚锚 + 合并(并行基,预演零冲突;fallback 仅防意外) ==="
git -C $R tag -f rollback-pre-u3s-switch
git -C $R fetch /tmp/lykoi-u3s-merge.bundle "wo/u3s:wo/u3s"
[ "$(git -C $R rev-parse wo/u3s)" = "55921d33204b95e0cc7785cce97b13c43221c2bf" ] || { echo "u3s 尖不符,停"; exit 1; }
git -C $R merge --no-ff wo/u3s -m "[MERGE] WO-U3S 周期合一切换(信封转正,转录机让位)" || {
  echo "预演之外的冲突,人工看一眼再决定;若仅 manifest:"; git -C $R status --porcelain | grep "^UU" || true
  exit 1
}

echo "=== 2. HARD_ASK 加固补丁(治理侧作者,红绿双态已验) ==="
git -C $R apply --check /tmp/hard-ask-delegation.patch
git -C $R apply /tmp/hard-ask-delegation.patch
git -C $R add guardian/policy_core.py tests/test_governance_invariants.py
git -C $R commit -m "[GOV] HARD_ASK_TYPES += delegation.dispatch(GW-01 采纳项,集合钉死+never_auto_allow)"

echo "=== 3. manifest 统一重签(补丁改了 policy_core.py)+ 属主归位(教训 37) ==="
python3 $R/guardian/startup_verify.py --write-manifest
[ "$(wc -l < $R/guardian/manifest.sha256)" = "112" ] || { echo "manifest 条数不是 112,停(0c 交接点:自动合流需全量对账)"; exit 1; }
git -C $R add guardian/manifest.sha256
git -C $R commit -m "[GOV] manifest 重签(U3S 合并 + HARD_ASK 加固后统一,112 条对账过)" || true
git -C $R diff --name-only rollback-pre-u3s-switch..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | while read f; do chown lykoi:lykoi "$R/$f"; done
chown root:root $R/guardian/*.py $R/guardian/manifest.sha256
find $R/src/lykoi/core $R/src/lykoi/kernel $R/guardian -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

echo "=== 4. C 步(lykoi 身份,清单已按树核实) ==="
sudo -u lykoi bash -c "cd $R && timeout 1800 .venv/bin/pytest -q -p no:randomly tests/test_u3s_switch.py tests/test_u3s_approval_delivery.py tests/test_u3s_zero_disturbance.py tests/test_u3_policy_exemption.py tests/test_p2_s3_approval_wiring.py tests/test_approval_delivery.py tests/test_governance_invariants.py tests/test_p0_integrity.py"

echo "=== 5a. A 段:合并态(开关仍关)重启验证 —— 判据④ ==="
systemctl restart lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
sleep 5; systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
curl -s http://127.0.0.1:8080/health; echo
echo "A 段人工确认点:随便聊一句 → 行为与今天一致;events 里 u3_shadow_envelope 照旧、u3_cycle_envelope 零条"

echo "=== 5b. B 段:切换翻转(回滚=删 drop-in+重启 lykoi-server,秒级) ==="
mkdir -p /etc/systemd/system/lykoi-server.service.d
printf '[Service]\nEnvironment=LYKOI_U3_SWITCH_ENABLED=1\n' > /etc/systemd/system/lykoi-server.service.d/20-u3-switch.conf
systemctl daemon-reload
systemctl restart lykoi-server
sleep 5; systemctl is-active lykoi-server
curl -s http://127.0.0.1:8080/health; echo

echo "=== 6. 收尾 ==="
git -C $R tag u3s-switch-20260822
echo "E 步实弹(人工):①发普通消息 → 信封回复(events 出现 u3_cycle_envelope、shadow 停);"
echo "  ②让她跑终端任务 → 审批问句为引用回复且不计打扰预算;③盯 u3_cycle_failed 计数,非零就删 drop-in 重启止损"
