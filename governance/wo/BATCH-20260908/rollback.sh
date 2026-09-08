#!/bin/bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'STOP: run in owner root session'; exit 1; }
export PATH=/opt/node-v24.18.0/bin:/usr/sbin:/usr/bin:/sbin:/bin
REPO=/home/lykoi/projects/lykoi-cordis
OLD=257a72ec1f0e09e69fd28f6234ca9266996757e5
NEW=2e152f2650d17ca34b74efbed4c0e10ccce6be7a
SPOOL=/home/lykoi/state/inbound-spool.db
G() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }
[[ -z $(G status --porcelain) ]]
HEAD_NOW=$(G rev-parse HEAD)
[[ "$HEAD_NOW" == "$OLD" || "$HEAD_NOW" == "$NEW" ]]
systemctl stop lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
systemctl stop lykoi-cordis-watchdog.service lykoi-cordis-backup.service
systemctl stop lykoi-cordis.service lykoi-browser.service
[[ $(systemctl show lykoi-cordis.service -p MainPID --value) == 0 ]]
# Preserve accepted messages. Old runtime cannot drain a new spool.
if [[ -f "$SPOOL" ]]; then
  PENDING=$(sudo -u lykoi sqlite3 -readonly "$SPOOL" "SELECT count(*) FROM user_turns WHERE state != 'terminal' OR terminal_audited=0;")
  [[ "$PENDING" -eq 0 ]] || { echo 'STOP: pending/unprojected spool; preserve data and repair forward'; exit 1; }
fi
G checkout --detach "$OLD"
(cd "$REPO" && npm ci --ignore-scripts --no-audit --no-fund)
# Do not restore old state/cursors/audit or delete instance/spool files.
(cd "$REPO" && node packages/lykoi-gate/src/cli.ts --write-manifest && sudo -u lykoi /opt/node-v24.18.0/bin/node packages/lykoi-gate/src/cli.ts)
systemctl start lykoi-browser.service lykoi-cordis.service
sleep 15
for unit in lykoi-browser.service lykoi-cordis.service; do
  systemctl is-active --quiet "$unit"
  [[ $(systemctl show "$unit" -p NRestarts --value) == 0 ]]
done
systemctl start lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
[[ $(G rev-parse HEAD) == "$OLD" ]]
[[ -z $(G status --porcelain) ]]
echo "ROLLED_BACK head=$OLD; state and spool preserved"
