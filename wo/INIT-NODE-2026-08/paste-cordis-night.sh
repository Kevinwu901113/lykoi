#!/bin/bash
# Cordis 总攻粘贴稿(2026-08-22) · Kevin root 单会话执行
# = 合并包 16+17 合一:U3S(切换)+ CB-01(心跳影子)+ GW-02(Gateway执行面)+ HARD_ASK 加固 + 切换翻转
# 三单复核:U3S PASS(review.md)/CB-01+GW-02 见各自 review.md;三链合并已治理侧全程预演
# (M1 干净;M2 冲突=conftest 拼接【已固化 /tmp 解决版】+manifest【终局重签】;M3 干净)
# 注意:本稿只落代码。lykoi-runner/lykoi-broker 的系统安装(useradd/单元/ACL)是独立
# 决定,按 docs/wo_gw02_merge_checklist.md 走,前提=代理箱 ACL 可做(S4a 门②)。
set -euo pipefail
R=/home/lykoi/projects/lykoi

echo "=== 0. 前验 ==="
[ "$(git -C $R rev-parse HEAD)" = "322380137c7951802123f0361e59fc055654339a" ] || { echo "HEAD 不是 32238013,停"; exit 1; }
systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
sha256sum -c - <<'EOF'
a026898f61689c336eb355cb367c0c6796ae56f42f6a194bd5e229300af3b7fd  /tmp/lykoi-u3s-merge.bundle
c79e33a7b3ff3c5609c67ae94c34f16173613da0840a58b002fe78d024e4faac  /tmp/lykoi-cb-merge.bundle
178dd7090e75bdfd2a82eb58179754bd89f21b72686e4d6b0834da46a0296918  /tmp/lykoi-gw-merge.bundle
937204146b3dac6b7c2a366f02c2dd8e41d5e3dfb517e6bbf06515481024af5a  /tmp/hard-ask-delegation.patch
96a4375476ded93caa56359b6ea28dca01a51ce44e6d10412e00b0beca9f0e90  /tmp/conftest-cordis-resolved.py
EOF

echo "=== 1. 回滚锚 + 取三分支 ==="
git -C $R tag -f rollback-pre-cordis-night
git -C $R fetch /tmp/lykoi-u3s-merge.bundle "wo/u3s:wo/u3s"
git -C $R fetch /tmp/lykoi-cb-merge.bundle "wo/cb-heart:wo/cb-heart"
git -C $R fetch /tmp/lykoi-gw-merge.bundle "wo/gateway-02:wo/gateway-02"
[ "$(git -C $R rev-parse wo/u3s)" = "55921d33204b95e0cc7785cce97b13c43221c2bf" ] || { echo u3s尖不符; exit 1; }
[ "$(git -C $R rev-parse wo/cb-heart)" = "8dad2770db25755fb26596bb344133a1c48f457d" ] || { echo cb尖不符; exit 1; }
[ "$(git -C $R rev-parse wo/gateway-02)" = "076634f96fa72e37b301ca9e10e26ba627b9abe3" ] || { echo gw尖不符; exit 1; }

echo "=== 2. M1:U3S 合并(预演干净) ==="
git -C $R merge --no-ff wo/u3s -m "[MERGE] WO-U3S 周期合一切换(信封转正,转录机让位)"

echo "=== 3. HARD_ASK 加固补丁(红绿双态已验) ==="
git -C $R apply --check /tmp/hard-ask-delegation.patch
git -C $R apply /tmp/hard-ask-delegation.patch
git -C $R add guardian/policy_core.py tests/test_governance_invariants.py
git -C $R commit -m "[GOV] HARD_ASK_TYPES += delegation.dispatch(GW-01 采纳项)"

echo "=== 4. M2:CB-01 合并(预演冲突两处,按固化方案解) ==="
git -C $R merge --no-ff wo/cb-heart -m "[MERGE] WO-CB-01 心跳影子+调度地基" || true
git -C $R status --porcelain | grep "^UU" | grep -vE "conftest|manifest" && { echo "预演之外的冲突,停"; exit 1; }
cp /tmp/conftest-cordis-resolved.py $R/tests/conftest.py
git -C $R checkout --ours guardian/manifest.sha256 2>/dev/null || true
git -C $R add tests/conftest.py guardian/manifest.sha256
git -C $R -c core.editor=true merge --continue

echo "=== 5. M3:GW-02 合并(预演干净) ==="
git -C $R merge --no-ff wo/gateway-02 -m "[MERGE] WO-GW-02 Gateway执行面(T1 Runner+broker,裁决A)"

echo "=== 6. manifest 终局重签(应 113 条:112+heartbeat.py)+ 属主归位(教训 37) ==="
python3 $R/guardian/startup_verify.py --write-manifest
[ "$(wc -l < $R/guardian/manifest.sha256)" = "113" ] || { echo "manifest 条数不是 113,停"; exit 1; }
git -C $R add guardian/manifest.sha256
git -C $R commit -m "[GOV] manifest 终局重签(U3S+HARD_ASK+CB+GW,113 条对账过)" || true
git -C $R diff --name-only rollback-pre-cordis-night..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | while read f; do [ -f "$R/$f" ] && chown lykoi:lykoi "$R/$f"; done
chown root:root $R/guardian/*.py $R/guardian/manifest.sha256
find $R/src/lykoi/core $R/src/lykoi/kernel $R/guardian -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

echo "=== 7. C 步(lykoi 身份,清单已按树核实;三段各自 timeout) ==="
sudo -u lykoi bash -c "cd $R && timeout 1800 .venv/bin/pytest -q -p no:randomly tests/test_u3s_switch.py tests/test_u3s_approval_delivery.py tests/test_u3s_zero_disturbance.py tests/test_u3_policy_exemption.py tests/test_p2_s3_approval_wiring.py tests/test_approval_delivery.py tests/test_governance_invariants.py tests/test_p0_integrity.py"
sudo -u lykoi bash -c "cd $R && timeout 1800 .venv/bin/pytest -q -p no:randomly tests/test_cb_snapshot_split.py tests/test_cb_deliberation_zero_write.py tests/test_cb_run_forever.py tests/test_cb_wake_storm_guards.py tests/test_cb_heartbeat_shadow.py tests/test_cb_llm_attribution.py tests/test_p4_autonomy.py"
sudo -u lykoi bash -c "cd $R && timeout 1800 .venv/bin/pytest -q -p no:randomly tests/test_gw02_runner.py tests/test_gw02_broker_gaps.py tests/test_gw02_s4a.py tests/test_gw02_deployment.py tests/test_gw02_zero_disturbance.py tests/test_gw02_delegated_origin_negative.py tests/test_broker.py tests/test_gw01_delegation.py"

echo "=== 8. A 段:合并态重启(开关关)——U3S 判据④ + CB 影子自动上岗 ==="
systemctl restart lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
sleep 5; systemctl is-active lykoi-server lykoi-autonomy lykoi-telegram lykoi-core lykoi-perception-ingest
curl -s http://127.0.0.1:8080/health; echo
echo "A 段确认:聊一句行为如常;events 里 u3_shadow_envelope 照旧、u3_cycle_envelope 零;heartbeat_shadow 开始出现(心跳影子零副作用自动生效)"

echo "=== 9. B 段:切换翻转(回滚=删 drop-in+重启 lykoi-server,秒级) ==="
mkdir -p /etc/systemd/system/lykoi-server.service.d
printf '[Service]\nEnvironment=LYKOI_U3_SWITCH_ENABLED=1\n' > /etc/systemd/system/lykoi-server.service.d/20-u3-switch.conf
systemctl daemon-reload
systemctl restart lykoi-server
sleep 5; systemctl is-active lykoi-server
curl -s http://127.0.0.1:8080/health; echo

echo "=== 10. 收尾 ==="
git -C $R tag cordis-night-20260822
cp /home/claude/HANDOFF.md /home/lykoi/HANDOFF.md 2>/dev/null || true
echo "E 步实弹(人工):①普通消息→信封回复(u3_cycle_envelope 出现,shadow 停);②终端任务→审批问句引用回复不计打扰预算;③盯 u3_cycle_failed,非零删 drop-in 止损"
echo "另册(非本稿):lykoi-runner/broker 系统安装按 docs/wo_gw02_merge_checklist.md(前提=代理箱 ACL);broker 审计联写权限方案推荐 C-a 待拍板"
