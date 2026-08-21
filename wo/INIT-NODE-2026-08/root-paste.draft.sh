#!/bin/bash
# ============================================================================
# 初始化节点 · 单次 root 会话稿(草稿——U3S 复核后由治理侧填占位定稿)
# 占位符: __INIT_TIP__ / __BUNDLE_SHA__ / __C_SUITES__
# 内容: 包14(审批送达) + 包15(GW-01) + 包16(U3S切换读者) + HARD_ASK 加固
#       一条统一尖 wo/init-node,单 bundle 单 ff;然后切换翻转+tag+收尾
# 用法: 逐段粘贴,每段看到 STOP 字样即停,把输出丢回治理侧
# ============================================================================

# ---- 0 · 前验(教训 39) -----------------------------------------------------
sudo -u claude sha256sum /tmp/lykoi-init-node-20260821.bundle
# 必须 = __BUNDLE_SHA__
cd /home/lykoi/projects/lykoi && git rev-parse HEAD
# 必须显示 1b8ef063…,不是就 STOP
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
git status --porcelain | head -5   # 必须为空
ps -u lykoi | grep -i remote       # 必须为空(教训 39 桥接检查)

# ---- 1 · 回滚点 -------------------------------------------------------------
git tag rollback-pre-init-node 1b8ef063

# ---- 2 · 合并(单 ff 到统一尖) ----------------------------------------------
git fetch /tmp/lykoi-init-node-20260821.bundle wo/init-node
git merge --ff-only __INIT_TIP__
git rev-parse HEAD   # 必须 = __INIT_TIP__,不是就 STOP

# ---- 3 · 属主(教训 37 三条排除;先验 HEAD 后动手) ---------------------------
test "$(git rev-parse HEAD)" = "__INIT_TIP__" || echo "STOP: HEAD 不对"
git diff --name-only 1b8ef063..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi
for f in $(git diff --name-only 1b8ef063..HEAD | grep -E '^(guardian/|src/lykoi/kernel/|src/lykoi/core/)'); do chown root:root "$f"; chmod 644 "$f"; done
find src guardian -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null
chown -R lykoi:lykoi /home/lykoi/projects/lykoi/.git

# ---- 4 · C 步测试(lykoi 身份;新套件并集 + 审批环 + p0) ---------------------
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && timeout 1800 .venv/bin/pytest -q __C_SUITES__'
# 预期全绿(基线已知 3 失败不在此清单);红了就 STOP

# ---- 5 · 重启与门(五服务;切换键此刻仍关) -----------------------------------
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 3
journalctl -u lykoi-server -n 8 --no-pager | grep startup_verify   # 期望 OK
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram
curl -s 127.0.0.1:8080/health | head -c 160
# 五个 active + health ok 才继续;否则 STOP(回滚: git reset --hard rollback-pre-init-node + 重启)

# ---- 6 · 切换翻转(owner 2026-08-21 明示授权的盲切) -------------------------
mkdir -p /etc/systemd/system/lykoi-server.service.d
cat > /etc/systemd/system/lykoi-server.service.d/20-u3-switch.conf <<'CONF'
[Service]
Environment=LYKOI_U3_SWITCH_ENABLED=1
CONF
systemctl daemon-reload && systemctl restart lykoi-server && sleep 3
systemctl is-active lykoi-server && curl -s 127.0.0.1:8080/health | head -c 160
# 行为回滚(秒级,任何时候): rm /etc/systemd/system/lykoi-server.service.d/20-u3-switch.conf && systemctl daemon-reload && systemctl restart lykoi-server

# ---- 7 · 节点封章 -----------------------------------------------------------
git tag init-node-20260821 __INIT_TIP__
systemctl disable --now lykoi-gate-readout.timer 2>/dev/null; echo readout-retired
# (证据门已由 owner 裁决作废;此定时器使命结束)

# ---- 8 · 完 ----------------------------------------------------------------
echo "=== INIT NODE LANDED ==="; git log --oneline -3; git tag | tail -3
# 接下来(不在本稿内): Telegram 给她发两条实弹——
#   ① 随便聊一句 → 应收到信封周期驱动的回复
#   ② 让她跑一个终端小任务 → 审批问句应为【引用回复】,回"同意"→执行并回结果
# 两条结果丢回治理侧。
