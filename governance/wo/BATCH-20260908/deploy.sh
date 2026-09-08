#!/bin/bash
set -euo pipefail
[[ $(id -u) -eq 0 ]] || { echo 'STOP: run in owner root session'; exit 1; }
export PATH=/opt/node-v24.18.0/bin:/usr/sbin:/usr/bin:/sbin:/bin
REPO=/home/lykoi/projects/lykoi-cordis
NODE=/opt/node-v24.18.0/bin/node
OLD=257a72ec1f0e09e69fd28f6234ca9266996757e5
NEW=2e152f2650d17ca34b74efbed4c0e10ccce6be7a
DIR=$(cd -- "$(dirname -- "$0")" && pwd)
BUNDLE=$DIR/release.bundle
DB=/home/lykoi/state/memory.db
PERSONA=/home/lykoi/runtime/persona/lykoi_base.toml
SPOOL=/home/lykoi/state/inbound-spool.db
RUN=/root/landing-batch-20260908-$(date +%Y%m%dT%H%M%S)
mkdir -m 700 "$RUN"
exec > >(tee -a "$RUN/deploy.log") 2>&1
trap 'echo "STOP line=$LINENO; preserve all data. Timers may be stopped. Log: $RUN/deploy.log; rollback: bash $DIR/rollback.sh"' ERR
G() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }
ACTIVE() { systemctl is-active --quiet "$1"; }
SCHEMA() { sudo -u lykoi sqlite3 -readonly "$DB" 'SELECT max(version) FROM mind_schema;'; }
GATE() { (cd "$REPO" && sudo -u lykoi "$NODE" packages/lykoi-gate/src/cli.ts); }

echo '1. Exact release and live preflight; no service changes'
printf '%s  %s\n' d64e8f52a601174fa94ff39a222f689bb4ca1fdbc126df9357b91e9a46227407 "$BUNDLE" | sha256sum -c -
G bundle verify "$BUNDLE"
[[ $(G bundle list-heads "$BUNDLE" refs/heads/main | awk '{print $1}') == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
[[ $(SCHEMA) == 18 ]]
[[ $(readlink -f "$REPO/var/state") == /home/lykoi/state ]]
for unit in lykoi-cordis.service lykoi-browser.service lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer; do ACTIVE "$unit"; done
HEAD_NOW=$(G rev-parse HEAD)
if [[ "$HEAD_NOW" == "$NEW" ]]; then
  GATE
  [[ -f "$SPOOL" ]]
  [[ $(sudo -u lykoi sqlite3 -readonly "$SPOOL" 'PRAGMA user_version;') == 2 ]]
  echo "ALREADY_DEPLOYED $NEW; no deployment changes"; exit 0
fi
[[ "$HEAD_NOW" == "$OLD" ]]
GATE
[[ ! -e "$SPOOL" ]] # Initial landing only; do not overwrite an existing spool.
[[ ! -e /home/lykoi/runtime/persona/deploy.toml ]]
[[ ! -e /home/lykoi/runtime/persona/seeds.toml ]]
command -v fuser >/dev/null
[[ -r "$PERSONA" ]]
[[ $(stat -c '%U:%G:%a' "$PERSONA") == root:root:444 ]]
sudo -u lykoi test -r /var/log/lykoi-audit/audit.jsonl
sudo -u lykoi test -w /var/log/lykoi-audit/audit.jsonl
JOURNAL_BEFORE=$(sudo -u lykoi sqlite3 -readonly "$DB" 'PRAGMA journal_mode;')
PERSONA_BEFORE=$(sha256sum "$PERSONA" | cut -d ' ' -f 1)
G fetch "$BUNDLE" refs/heads/main:refs/heads/release/batch-20260908
G merge-base --is-ancestor "$OLD" "$NEW"
G diff --quiet "$OLD" "$NEW" -- packages/lykoi-memory/src/schema.ts
# Extract only the current transport proxy into a private file; never echo it.
REPO="$REPO" OUTPUT="$RUN/deploy.toml" "$NODE" --input-type=module <<'JS'
import {createRequire} from 'node:module'
import {readFileSync,writeFileSync} from 'node:fs'
const require=createRequire(process.env.REPO+'/package.json')
try {
  const config=require('js-yaml').load(readFileSync(process.env.REPO+'/profile/cordis.prod.yml','utf8'))
  const matches=config.filter(p=>p.name==='lykoi-adapter-telegram/production')
  if(matches.length!==1) throw new Error()
  const proxy=matches[0].config.proxy
  if(typeof proxy!=='string'||!proxy) throw new Error()
  const url=new URL(proxy)
  if(!['http:','https:'].includes(url.protocol)||!url.hostname) throw new Error()
  writeFileSync(process.env.OUTPUT,'[telegram]\nproxy = '+JSON.stringify(proxy)+'\n',{mode:0o600,flag:'wx'})
  console.log('PROXY_CAPTURE_OK (value withheld)')
} catch { console.error('STOP: cannot uniquely capture valid existing Telegram proxy'); process.exit(1) }
JS

echo '2. Stop writers and timers, then take consistent backup'
START=$(date +%s)
systemctl stop lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
systemctl stop lykoi-cordis-watchdog.service lykoi-cordis-backup.service
systemctl stop lykoi-cordis.service lykoi-browser.service
for unit in lykoi-cordis.service lykoi-browser.service; do
  [[ $(systemctl show "$unit" -p ActiveState --value) == inactive ]]
  [[ $(systemctl show "$unit" -p MainPID --value) == 0 ]]
done
# Detect any other process with the cognitive DB open; do not assume service stop is enough.
if fuser "$DB" >/dev/null 2>&1; then echo 'STOP: memory.db still open'; exit 1; fi
BK=$RUN/backup.tar.gz
tar -C / -czf "$BK" home/lykoi/state home/lykoi/runtime/persona home/lykoi-browser/profile var/log/lykoi-audit/audit.jsonl home/lykoi/projects/lykoi-cordis/packages/lykoi-gate/manifest.sha256
[[ $(stat -c %s "$BK") -ge 1048576 ]]
gzip -t "$BK"
sha256sum "$BK"
[[ $(sudo -u lykoi sqlite3 -readonly "$DB" 'PRAGMA integrity_check;') == ok ]]
echo "BACKUP=$BK"

echo '3. Install exact tree, dependencies, and local instance deployment data'
G checkout --detach "$NEW"
[[ $(G rev-parse HEAD) == "$NEW" ]]
(cd "$REPO" && npm ci --ignore-scripts --no-audit --no-fund)
[[ -z $(G status --porcelain) ]]
install -o root -g root -m 444 "$RUN/deploy.toml" /home/lykoi/runtime/persona/deploy.toml
# New root-domain files inherit the same gate rules as existing ones.
chown root:root "$REPO/packages" "$REPO/profile"
chmod go-w "$REPO/packages" "$REPO/profile"
for pkg in lykoi-gate lykoi-kernel; do
  chown -R root:root "$REPO/packages/$pkg"
  chmod -R a+rX,go-w "$REPO/packages/$pkg"
done
for file in package.json index.ts index.prod.ts cordis.yml cordis.prod.yml; do
  chown root:root "$REPO/profile/$file"
  chmod a+r,go-w "$REPO/profile/$file"
done
# Validate instance using the actual release loader, without printing persona/config.
(cd "$REPO" && "$NODE" --input-type=module <<'JS'
import {loadPersona} from './packages/lykoi-decide/src/persona-toml.ts'
import {loadInstancePackage} from './packages/lykoi-decide/src/instance.ts'
try {
  const p='/home/lykoi/runtime/persona/lykoi_base.toml'
  loadPersona(p)
  const instance=loadInstancePackage(p)
  if(!instance.deploy.telegram_proxy||instance.seeds.length!==0) throw new Error()
  console.log('INSTANCE_OK: existing persona; zero seed writes; proxy configured')
} catch { console.error('STOP: instance validation failed (values withheld)'); process.exit(1) }
JS
)
[[ $(sha256sum "$PERSONA" | cut -d ' ' -f 1) == "$PERSONA_BEFORE" ]]
[[ $(SCHEMA) == 18 ]]
[[ $(sudo -u lykoi sqlite3 -readonly "$DB" 'PRAGMA journal_mode;') == "$JOURNAL_BEFORE" ]]
(cd "$REPO" && "$NODE" packages/lykoi-gate/src/cli.ts --write-manifest)
GATE
MANIFEST=$(wc -l < "$REPO/packages/lykoi-gate/manifest.sha256")
[[ "$MANIFEST" -eq 129 ]]

echo '4. Start and verify before restoring watchdog'
systemctl start lykoi-browser.service
sleep 3
ACTIVE lykoi-browser.service
sudo -u lykoi "$NODE" --input-type=module <<'JS'
import {createConnection} from 'node:net'
const socket=createConnection('/run/lykoi-browser/host.sock')
let data=''
socket.setTimeout(5000,()=>socket.destroy(new Error('browser health timeout')))
socket.on('error',()=>{console.error('STOP: browser health failed');process.exit(1)})
socket.on('connect',()=>socket.write(JSON.stringify({id:'batch-health',op:'health',args:{}})+'\n'))
socket.on('data',chunk=>{
  data+=chunk
  if(!data.includes('\n')) return
  socket.end()
  try {
    const reply=JSON.parse(data.split('\n')[0])
    if(reply.ok!==true||reply.data?.alive!==true) throw new Error()
    console.log('BROWSER_HEALTH_OK')
  } catch {console.error('STOP: browser health response failed');process.exit(1)}
})
JS
systemctl start lykoi-cordis.service
sleep 15
ACTIVE lykoi-cordis.service
for unit in lykoi-cordis.service lykoi-browser.service; do
  [[ $(systemctl show "$unit" -p NRestarts --value) == 0 ]]
done
[[ -f "$SPOOL" ]]
[[ $(sudo -u lykoi sqlite3 -readonly "$SPOOL" 'PRAGMA user_version;') == 2 ]]
[[ $(sudo -u lykoi sqlite3 -readonly "$SPOOL" 'PRAGMA integrity_check;') == ok ]]
[[ $(sudo -u lykoi sqlite3 -readonly "$SPOOL" "SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('user_turns','inbound_parts');") == 2 ]]
GATE
[[ $(G rev-parse HEAD) == "$NEW" ]]
[[ -z $(G status --porcelain) ]]
[[ $(SCHEMA) == 18 ]]
systemctl start lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer
for unit in lykoi-cordis.service lykoi-browser.service lykoi-cordis-watchdog.timer lykoi-cordis-backup.timer; do ACTIVE "$unit"; done
systemctl show lykoi-cordis.service lykoi-browser.service -p Id -p ActiveState -p SubState -p NRestarts -p MainPID
sudo -u lykoi sqlite3 -readonly "$SPOOL" 'SELECT state,count(*) FROM user_turns GROUP BY state;'
printf '{"ts":"%s","actor":"root-owner","action":"landing-batch-20260908","old":"%s","new":"%s","schema":18,"spool_version":2,"manifest":%s,"result":"startup_verified"}\n' "$(date -Iseconds)" "$OLD" "$NEW" "$MANIFEST" >> "$RUN/record.jsonl"
echo "DONE head=$NEW schema=18 spool=2 manifest=$MANIFEST window_seconds=$(( $(date +%s)-START )) log=$RUN/deploy.log"
echo 'PENDING: real inbound/approval/revision/utterances/continuation delivery acceptance; C1/C2/Recall experiments.'
