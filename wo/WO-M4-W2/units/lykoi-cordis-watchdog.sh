#!/bin/sh
# Lykoi Cordis watchdog 探针（M4 前置 #10 的新体对应物；WO-M4-W2 定案形态）。
# 安装：install -o root -g root -m 755 → /usr/local/sbin/lykoi-cordis-watchdog.sh
# 由 lykoi-cordis-watchdog.timer 每 5 分钟以 root oneshot 拉起。
#
# 活体 watchdog 每 10s 打 /health；新体没有 HTTP 面，也不为看门狗新造一个
# （W2 定案）。改探两样：
#   ① unit 活性：inactive/failed → restart。补 Restart=always 的盲区
#     （StartLimit 撞顶后 systemd 弃疗的那种死法）。
#   ② 认知新鲜度：audit sink 的 mtime 距今超过 4500s（= 心跳基线 30min 的
#     2.5 倍）→ 进程在而心不跳（挂起态）→ restart。健康时每拍心跳 + 每一次
#     器官动作都会 append audit，mtime 是「她还活着」最便宜的真信号。
#     取舍：挂起态检出延迟最长约 75 分钟（活体是 30 秒）。M4 接受 —— 崩溃态
#     由 Restart=always 秒接，watchdog 只兜挂起与弃疗两类慢死法。
#
# 看守者与被看守者物理分离（前置 #10 原则）：本脚本住 /usr/local/sbin，
# 不在 /home/lykoi 任何可写树里。
set -eu
UNIT=lykoi-cordis.service
AUDIT=/var/log/lykoi-audit/audit.jsonl
MAX_AGE_S=4500

if ! systemctl is-active --quiet "$UNIT"; then
  logger -t lykoi-cordis-watchdog "unit not active -> systemctl restart"
  systemctl restart "$UNIT"
  exit 0
fi

now=$(date +%s)
mt=$(stat -c %Y "$AUDIT")
age=$((now - mt))
if [ "$age" -gt "$MAX_AGE_S" ]; then
  logger -t lykoi-cordis-watchdog "audit stale ${age}s (> ${MAX_AGE_S}s) -> systemctl restart"
  systemctl restart "$UNIT"
fi
