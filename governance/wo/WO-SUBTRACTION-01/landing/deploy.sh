#!/bin/bash
# Only WO-SUBTRACTION-01: production 257a72e -> 20ad4c3. No migration or npm ci.
set -euo pipefail
REPO=/home/lykoi/projects/lykoi-cordis
NODE=/opt/node-v24.18.0/bin/node
DB=/home/lykoi/state/memory.db
OLD=257a72ec1f0e09e69fd28f6234ca9266996757e5
NEW=20ad4c3160a66691f3478fef87b1ff842e1e944e
BUNDLE=/tmp/lykoi-subtraction-01/release.bundle
BUNDLE_SHA=b59ae12392294479cf078b8687d534571da82cbe8fb68aa065ce5ec1a6b915b2
LOG=/root/landing-subtraction-01-$(date +%Y%m%dT%H%M%S).log
[[ $(id -u) == 0 ]] || { echo 'STOP: run in the owner root session'; exit 1; }
exec > >(tee -a "$LOG") 2>&1
trap 'echo "STOP at line $LINENO. Do not continue blindly. For this release, rollback: bash /tmp/lykoi-subtraction-01/rollback.sh"' ERR
G() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }
SCHEMA() { sudo -u lykoi sqlite3 -readonly "$DB" 'SELECT MAX(version) FROM mind_schema;'; }
ACTIVE() { systemctl is-active --quiet "$1"; }

echo '1. Preflight: exact artifact, clean tree, schema, current services'
printf '%s  %s\n' "$BUNDLE_SHA" "$BUNDLE" | sha256sum -c -
G bundle verify "$BUNDLE"
[[ $(G bundle list-heads "$BUNDLE" | awk '$2=="refs/heads/release/subtraction-01" {print $1}') == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
[[ $(SCHEMA) == 18 ]]
[[ $(readlink -f "$REPO/var/state") == /home/lykoi/state ]]
for unit in lykoi-cordis.service lykoi-browser.service lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer; do ACTIVE "$unit"; done
HEAD_NOW=$(G rev-parse HEAD)
if [[ "$HEAD_NOW" == "$NEW" ]]; then
  sudo -u lykoi "$NODE" "$REPO/packages/lykoi-gate/src/cli.ts"
  echo "ALREADY_DEPLOYED $NEW; no changes made"; exit 0
fi
[[ "$HEAD_NOW" == "$OLD" ]]
[[ -d /home/lykoi-browser/profile ]]
# Fetch only the verified release ref; no production source changes yet.
G fetch "$BUNDLE" refs/heads/release/subtraction-01:refs/heads/release/subtraction-01
G merge-base --is-ancestor "$OLD" "$NEW"
G diff --quiet "$OLD" "$NEW" -- profile deploy package.json package-lock.json packages/lykoi-decide packages/lykoi-reflow packages/lykoi-converse/src/index.ts packages/lykoi-converse/src/prompts.ts
sudo -u lykoi "$NODE" "$REPO/packages/lykoi-gate/src/cli.ts"
[[ $(wc -l < "$REPO/packages/lykoi-gate/manifest.sha256") == 117 ]]
PERSONA_BEFORE=$(sha256sum /home/lykoi/runtime/persona/lykoi_base.toml | cut -d ' ' -f 1)

echo '2. Stop watchdog/backup timers, brain and browser; keep enabled settings'
START=$(date +%s)
systemctl stop lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
# A timer-triggered oneshot must not race the stop/backup window.
systemctl stop lykoi-cordis-watchdog.service lykoi-cordis-backup.service
systemctl stop lykoi-cordis.service lykoi-browser.service
for unit in lykoi-cordis.service lykoi-browser.service; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive ]]
done

echo '3. Consistent backup: state, browser profile and previous manifest'
BK=/root/backup-pre-subtraction-01-$(date +%Y%m%dT%H%M%S).tar.gz
tar -C / -czf "$BK" home/lykoi/state home/lykoi-browser/profile home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/manifest.sha256
[[ $(stat -c %s "$BK") -ge 1048576 ]]
gzip -t "$BK"
sha256sum "$BK"
echo "BACKUP=$BK"
[[ $(sudo -u lykoi sqlite3 -readonly "$DB" 'PRAGMA integrity_check;') == ok ]]

echo '4. Install exact release; existing dependencies and configuration stay in place'
G checkout --detach "$NEW"
[[ $(G rev-parse HEAD) == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
while IFS= read -r file; do
  [[ "$file" == packages/* ]] || continue
  chown root:root "$REPO/$file"
  chmod a+r,go-w "$REPO/$file"
done < <(G diff --name-only "$OLD" "$NEW" -- packages)
[[ $(sha256sum /home/lykoi/runtime/persona/lykoi_base.toml | cut -d ' ' -f 1) == "$PERSONA_BEFORE" ]]
[[ $(SCHEMA) == 18 ]]
"$NODE" "$REPO/packages/lykoi-gate/src/cli.ts" --write-manifest
[[ $(wc -l < "$REPO/packages/lykoi-gate/manifest.sha256") == 119 ]]
sudo -u lykoi "$NODE" "$REPO/packages/lykoi-gate/src/cli.ts"

echo '5. Start browser; verify health and actual get_text failure mapping before brain starts'
systemctl start lykoi-browser.service
sleep 3
ACTIVE lykoi-browser.service
sudo -u lykoi "$NODE" --input-type=module <<'JS'
import { createConnection } from 'node:net'
async function request(op) {
  return await new Promise((resolve, reject) => {
    const socket = createConnection('/run/lykoi-browser/host.sock')
    let text = ''
    socket.setTimeout(5000, () => socket.destroy(new Error('browser probe timeout')))
    socket.on('error', reject)
    socket.on('connect', () => socket.write(JSON.stringify({id: 'subtraction-check', op, args: {}}) + '\n'))
    socket.on('data', chunk => {
      text += chunk
      if (!text.includes('\n')) return
      socket.end()
      try { resolve(JSON.parse(text.split('\n')[0])) } catch (error) { reject(error) }
    })
  })
}
const health = await request('health')
if (health.ok !== true || health.data?.alive !== true) throw new Error('browser health failed')
const read = await request('get_text')
if (read.ok !== false || read.error !== 'no_page') throw new Error('browser get_text mapping differs')
console.log('BROWSER_PROBE_OK: health=true; get_text=no_page')
JS
systemctl start lykoi-cordis.service
sleep 8
ACTIVE lykoi-cordis.service
systemctl start lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
for unit in lykoi-cordis.service lykoi-browser.service lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer; do ACTIVE "$unit"; done
for unit in lykoi-cordis.service lykoi-browser.service; do
  [[ $(systemctl show "$unit" -p NRestarts --value) == 0 ]]
done
[[ $(G rev-parse HEAD) == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
systemctl show lykoi-cordis.service lykoi-browser.service -p Id -p ActiveState -p NRestarts -p MainPID -p ActiveEnterTimestamp
mkdir -p /home/lykoi-gov/reports
printf '{"ts":"%s","actor":"root-owner","action":"landing-subtraction-01","target":"%s","result":"success","old":"%s","new":"%s","manifest":119,"schema":18,"backup":"%s"}\n' "$(date -Iseconds)" "$REPO" "$OLD" "$NEW" "$BK" >> /home/lykoi-gov/reports/governance-ops.jsonl
echo "DONE head=$NEW schema=18 manifest=119 window_seconds=$(( $(date +%s) - START )) log=$LOG"
