#!/bin/bash
# ============================================================================
# WO-M4-W2 · 粘贴稿 2/2 —— 切换窗（root 执行；R-01 严格串行：停旧→备份→起新）
# ============================================================================
# 先决：粘贴稿 1 已全绿（gate: OK 见过一次）；token 已填；追认呈批稿已过目
# （approval-briefing.md —— 本稿一跑，追认清单里的东西就都是活的了）。
#
# 停机窗从「停旧」起算。旧体在整个窗内保持**可启动**（rollback 路径；
# CORE-RETIRE 在 48h 观察期后另开收尾窗，本稿绝不动 core 的任何数据）。
set -euo pipefail

NODE=/opt/node-v24.18.0/bin/node
REPO=/home/lykoi/projects/lykoi-cordis
TS=$(date +%Y%m%dT%H%M%S)

echo '== 0 · 前验（一条不过就别继续） =='
[ "$(id -u)" = 0 ]
[ -x "$NODE" ]
[ -f /etc/systemd/system/lykoi-cordis.service ]
echo -n 'telegram-cordis.env 里 LYKOI_TELEGRAM_BOT_TOKEN 行数（应为 1）：'
grep -cE '^LYKOI_TELEGRAM_BOT_TOKEN=.+' /home/lykoi/secrets/telegram-cordis.env
echo '旧体现状（信息性）：'
for u in lykoi-watchdog lykoi-server lykoi-telegram lykoi-autonomy lykoi-core; do
  printf '  %-16s %s\n' "$u" "$(systemctl is-active $u.service || true)"
done

echo '== 1 · 停旧（R-01 第一步；看门狗最先停，否则它把 server 拉回来） =='
for u in lykoi-watchdog lykoi-server lykoi-telegram lykoi-autonomy lykoi-core; do
  systemctl disable --now "$u.service"
done
sleep 3
if pgrep -u lykoi -af 'uvicorn|telegram_device|cognition\.autonomous|core\.runtime'; then
  echo '!! 旧体进程未清 —— 禁止继续。等它退净或人工 systemctl kill 后重跑本段。'
  exit 1
fi
echo '旧体进程已清（display 栈 chrome/xvfb/vnc 刻意不动 —— 封存待 M5 退役审批）'

echo '== 2 · 备份 state（停稳之后 = 一致快照；同时是回滚前提） =='
tar -C /home/lykoi -czf "/home/lykoi/m4-backup-$TS.tar.gz" state
ls -lh "/home/lykoi/m4-backup-$TS.tar.gz"

echo '== 3 · GK-9 owner 预授权（先 --dry-run 体检，后实跑；以 lykoi 身份，state 属主不变） =='
cd "$REPO"
sudo -u lykoi "$NODE" packages/lykoi-kernel/src/bootstrap-preauth.ts \
  --state-db /home/lykoi/state/memory.db \
  --rules    /home/lykoi/state/approval_rules.json \
  --standing /home/lykoi/state/standing_grants.json \
  --dry-run
sudo -u lykoi "$NODE" packages/lykoi-kernel/src/bootstrap-preauth.ts \
  --state-db /home/lykoi/state/memory.db \
  --rules    /home/lykoi/state/approval_rules.json \
  --standing /home/lykoi/state/standing_grants.json

echo '== 4 · 完整性门（服务用户视角，必须 gate: OK） =='
sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts

echo '== 5 · 起新 =='
systemctl enable --now lykoi-cordis.service
systemctl enable --now lykoi-cordis-watchdog.timer
sleep 8
systemctl --no-pager --lines=0 status lykoi-cordis.service | head -6
journalctl -u lykoi-cordis -n 25 --no-pager

echo '== 6 · 验收八条（m4_handoff §D 逐条；任一不过 → 走文末回滚段） =='
echo '  [1] 门绿：上面第 4 步已见 gate: OK；ExecStartPre 又跑了一遍（journal 可见）'
echo -n '  [2] audit 在长且只增（lsattr 有 a）：'
lsattr /var/log/lykoi-audit/audit.jsonl
tail -3 /var/log/lykoi-audit/audit.jsonl
echo '  [3] 收得到：Kevin 手机发一条普通消息 → journal/audit 见入站'
echo '  [4] 说得出：她回信封；audit 里 action_dispatch + action_result 成对'
echo '      核对：grep -c action_dispatch /var/log/lykoi-audit/audit.jsonl'
echo '  [5] 终端硬门实弹：让她跑一条 terminal.exec → 问句到 Kevin → 引用回复批准 → 执行回执'
echo '  [6] 审批环另一半：拒绝路 + unclear 路各走一次'
echo '  [7] restart 事件：systemctl restart lykoi-cordis → 她知道自己重启过'
echo '      （history/audit 的 restart 行带 HEAD/downtime；采不到=省略，不许编造值）'
echo '  [8] GK-14 e2e：信封自称 dispatched ⟺ audit 真有对应 action_dispatch 行'
echo ''
echo '== 八条全过 = 切换完成，进入 48h 观察期（旧体保持可启动，不做 CORE-RETIRE）。 =='

# ============================================================================
# 回滚段（人工触发；R-01 反向：停新 → 恢复 state → 起旧）。整段复制出来跑。
# ============================================================================
: <<'ROLLBACK'
set -euo pipefail
TS=$(date +%Y%m%dT%H%M%S)
systemctl disable --now lykoi-cordis-watchdog.timer
systemctl disable --now lykoi-cordis.service
sleep 3
pgrep -u lykoi -f 'profile/index.prod.ts' && { echo '新体进程未清，等退净再继续'; exit 1; }

# 恢复 state：mv 保全现场（绝不 rm —— 删除纪律：逐目标、显式确认，此处零删除）
mv /home/lykoi/state "/home/lykoi/state.m4-failed-$TS"
tar -C /home/lykoi -xzf /home/lykoi/m4-backup-*.tar.gz   # 若有多份，指名最新那份
chown -R lykoi:lykoi /home/lykoi/state

# 起旧（与停序相反；watchdog 最后）
for u in lykoi-core lykoi-autonomy lykoi-telegram lykoi-server lykoi-watchdog; do
  systemctl enable --now "$u.service"
done
sleep 5
for u in lykoi-core lykoi-autonomy lykoi-telegram lykoi-server lykoi-watchdog; do
  printf '  %-16s %s\n' "$u" "$(systemctl is-active $u.service || true)"
done
echo '回滚完成：旧体在跑。新体 unit 保留在盘（disabled），事后复盘用。'
ROLLBACK
