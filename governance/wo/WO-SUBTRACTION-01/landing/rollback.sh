#!/bin/bash
# Code-only rollback. No database restore/migration; current experience stays intact.
set -euo pipefail
REPO=/home/lykoi/projects/lykoi-cordis
NODE=/opt/node-v24.18.0/bin/node
OLD=257a72ec1f0e09e69fd28f6234ca9266996757e5
NEW=20ad4c3160a66691f3478fef87b1ff842e1e944e
[[ $(id -u) == 0 ]] || { echo 'STOP: run in the owner root session'; exit 1; }
G() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }
head_now=$(G rev-parse HEAD)
[[ "$head_now" == "$OLD" || "$head_now" == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
systemctl stop lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
systemctl stop lykoi-cordis-watchdog.service lykoi-cordis-backup.service
systemctl stop lykoi-cordis.service lykoi-browser.service
G checkout --detach "$OLD"
[[ -z $(G status --porcelain) ]]
"$NODE" "$REPO/packages/lykoi-gate/src/cli.ts" --write-manifest
[[ $(wc -l < "$REPO/packages/lykoi-gate/manifest.sha256") == 117 ]]
sudo -u lykoi "$NODE" "$REPO/packages/lykoi-gate/src/cli.ts"
systemctl start lykoi-browser.service
sleep 3
systemctl is-active --quiet lykoi-browser.service
systemctl start lykoi-cordis.service
sleep 8
systemctl is-active --quiet lykoi-cordis.service
systemctl start lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
mkdir -p /home/lykoi-gov/reports
printf '{"ts":"%s","actor":"root-owner","action":"rollback-subtraction-01","target":"%s","result":"success","new":"%s"}\n' "$(date -Iseconds)" "$REPO" "$OLD" >> /home/lykoi-gov/reports/governance-ops.jsonl
echo "ROLLBACK_DONE head=$OLD manifest=117; database not restored"
