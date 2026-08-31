#!/bin/bash
# ============================================================================
# 初始化节点 · 单次 root 会话稿(终稿 2026-08-21 晚)
# 内容: 包14(审批送达修复) + 包15(GW-01 Delegation Gateway) 一条纯 ff 链
# 不含: U3S 切换(owner "结束吧"指令下解耦出今晚,另行落地)——
#       因此本次落地后她的对话行为唯一变化 = 审批问句改引用回复不吃打扰预算;
#       delegation 机器落库但零扰动(不用即逐字节不变,已测试证明)。
# 用法: 逐段粘贴;任何输出与预期不符即停,把输出丢回治理侧。
# 回滚: 代码 = git reset --hard rollback-pre-init-node && 重启五服务
# ============================================================================

# ---- 0 · 前验 ---------------------------------------------------------------
sha256sum /tmp/lykoi-init-node-20260821.bundle
# 必须 = 8f0b2437cff97dda7e0639800667c5322962d53a96276ba982b848236ad6b513
cd /home/lykoi/projects/lykoi && git rev-parse HEAD
# 必须 = 1b8ef063e1e50900323d28857ea304bbd8df632b,不是就 STOP
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
git status --porcelain | head -5    # 必须为空
ps -u lykoi | grep -i remote        # 必须为空(教训 39 桥接检查)

# ---- 1 · 回滚点 + 合并(单 ff) ----------------------------------------------
git tag rollback-pre-init-node 1b8ef063e1e50900323d28857ea304bbd8df632b
git fetch /tmp/lykoi-init-node-20260821.bundle wo/gateway-01
git merge --ff-only 322380137c7951802123f0361e59fc055654339a
git rev-parse HEAD
# 必须 = 322380137c7951802123f0361e59fc055654339a,不是就 STOP

# ---- 2 · 属主(教训 37 三条排除;先验 HEAD 后动手) ---------------------------
test "$(git rev-parse HEAD)" = "322380137c7951802123f0361e59fc055654339a" || echo "STOP: HEAD 不对"
git diff --name-only 1b8ef063..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi
for f in $(git diff --name-only 1b8ef063..HEAD | grep -E '^(guardian/|src/lykoi/kernel/|src/lykoi/core/)'); do chown root:root "$f"; chmod 644 "$f"; done
find src guardian -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null
chown -R lykoi:lykoi /home/lykoi/projects/lykoi/.git

# ---- 3 · C 步测试(lykoi 身份;两包新套件 + 审批环 + 邻接 + p0) --------------
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && timeout 1800 .venv/bin/pytest -q tests/test_approval_delivery.py tests/test_approval_conversation.py tests/test_telegram_device.py tests/test_messenger.py tests/test_gw01_delegation.py tests/test_governance_invariants.py tests/test_p2_data_model_migration.py tests/test_l5_suggestions.py tests/test_p0_integrity.py'
# 预期全绿(已知基线 3 失败不在此清单);红了就 STOP

# ---- 4 · 重启与门(五服务) --------------------------------------------------
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 3
journalctl -u lykoi-server -n 8 --no-pager | grep startup_verify    # 期望: startup_verify: OK
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
curl -s 127.0.0.1:8080/health | head -c 160
# 五 active + health ok(含 browser_request_guard:ready)才继续;否则 STOP 并回滚

# ---- 5 · 节点封章 + 收尾 ----------------------------------------------------
git tag init-node-20260821 322380137c7951802123f0361e59fc055654339a
systemctl disable --now lykoi-gate-readout.timer 2>/dev/null; echo readout-retired
# (证据门已由 owner 2026-08-21 裁决作废,定时器使命结束;数据文件保留)

echo "=== INIT NODE LANDED ==="; git log --oneline -3; git tag | tail -3

# ---- 完。接下来一件事(不在本稿内) ------------------------------------------
# Telegram 让她跑一个终端小任务:
#   预期: 审批问句以【对你消息的引用回复】形态到达(不再被打扰预算吞);
#         你回"同意" → 绑定执行 → 回结果。
# 把这条的结果(或异常时 journalctl -u lykoi-telegram 片段)丢回治理侧。
# ---------------------------------------------------------------------------
# 备注: manifest(112 条)已在分支内用 startup_verify 自家函数重签并经复核,
#       启动闸在步 4 二次核验,无需手工重签。
# 备注: U3S(切换读者)在 wo/u3s 分支继续,复核后另出一张小粘贴稿(ff+翻转)。
