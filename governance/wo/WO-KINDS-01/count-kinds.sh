#!/usr/bin/env bash
# WO-KINDS-01 · 自主决策 kind 产线计数（只读）。
#
# 事件形态（`packages/lykoi-wake/src/index.ts:415`）：一拍结束落一条
#   {"type":"autonomy_wake","run_id":…,"decision":"<kind>","demoted":…,"actions":…,"status":…}
# 其中 `decision` 就是 kind 名（`auditLogEvent` 把事件名放进 `type`，见 :113）。
#
# 全部命令只读：不写、不删、不改属性。输出只有事件名与计数，零正文。
# 用法（服务器）：
#   sudo bash governance/wo/WO-KINDS-01/count-kinds.sh [天数]
# 天数缺省 30。审计文件 root 属主，故需 sudo 读；脚本自身不写任何文件。
set -euo pipefail

LOG=/var/log/lykoi-audit/audit.jsonl
DAYS="${1:-30}"

if [[ ! -r "$LOG" ]]; then
  echo "audit log 不可读：$LOG" >&2
  exit 1
fi

SINCE=$(date -u -d "${DAYS} days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null \
  || date -u -v-"${DAYS}"d +%Y-%m-%dT%H:%M:%S)

echo "窗口：${SINCE}Z 起 ${DAYS} 天"
echo

if command -v jq >/dev/null 2>&1; then
  echo "--- autonomy_wake 的 decision 计数（kind × status）---"
  jq -r --arg since "$SINCE" '
    select(.type == "autonomy_wake" and .ts >= $since)
    | "\(.decision)\t\(.status)"
  ' "$LOG" | sort | uniq -c | sort -rn

  echo
  echo "--- demoted 计数（护栏降级到 rest 的次数）---"
  jq -r --arg since "$SINCE" '
    select(.type == "autonomy_wake" and .ts >= $since and .demoted == true) | .decision
  ' "$LOG" | sort | uniq -c | sort -rn

  echo
  echo "--- 相关事件总量（只数条数，不看字段）---"
  jq -r --arg since "$SINCE" '
    select(.ts >= $since)
    | select(.type | test("^(autonomy_wake|autonomy_rest|unknown_decision_kind|capability_gap)"))
    | .type
  ' "$LOG" | sort | uniq -c | sort -rn
else
  echo "jq 不在，退回 grep 粗计数（可能少计跨行/字段序不同的行）"
  echo "--- autonomy_wake 的 decision 计数（不带时间窗）---"
  grep -o '"type":"autonomy_wake"[^}]*"decision":"[a-z_]*"' "$LOG" \
    | grep -o '"decision":"[a-z_]*"' | sort | uniq -c | sort -rn
fi
