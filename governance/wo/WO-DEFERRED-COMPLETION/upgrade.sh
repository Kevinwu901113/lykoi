#!/usr/bin/env bash
# Run as root on the existing production host. No credential values are printed.
set -euo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root on the production host.' >&2; exit 1; }
bundle=${1:?usage: upgrade.sh BUNDLE EXPECTED_COMMIT}
target=${2:?expected commit required}
[[ $target =~ ^[0-9a-f]{40}$ ]] || { echo 'Expected a full commit hash.' >&2; exit 1; }
repo=/home/lykoi/projects/lykoi-cordis
node=/opt/node-v24.18.0/bin/node
export PATH=/opt/node-v24.18.0/bin:$PATH
repo_git() { git -c safe.directory="$repo" -C "$repo" "$@"; }
[[ -x $node && -f $bundle ]]
repo_git diff --quiet
repo_git diff --cached --quiet
before=$(repo_git rev-parse HEAD)
repo_git bundle verify "$bundle"
repo_git fetch "$bundle" wo/deferred-completion
[[ $(repo_git rev-parse FETCH_HEAD) == "$target" ]]
repo_git merge-base --is-ancestor "$before" "$target"

# Supply the already implemented Runner before advertising it in the production profile.
npm install --prefix /opt/lykoi-pi --omit=dev --save-exact @earendil-works/pi-coding-agent@0.85.1
"$node" /opt/lykoi-pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js --version
install -d -o root -g root -m 755 /home/lykoi/runtime/deployment/pi
model_config=$(mktemp)
trap 'rm -f "$model_config"' EXIT
cat > "$model_config" <<'JSON'
{"providers":{"deepseek":{"baseUrl":"https://api.deepseek.com","apiKey":"$DEEPSEEK_API_KEY","modelOverrides":{"deepseek-v4-flash":{"maxTokens":4096,"contextWindow":32768}}}}}
JSON
if [[ -f /home/lykoi/runtime/deployment/pi/models.json ]]; then
  cmp "$model_config" /home/lykoi/runtime/deployment/pi/models.json
else
  install -o root -g root -m 644 "$model_config" /home/lykoi/runtime/deployment/pi/models.json
fi

watchdog=$(systemctl is-active lykoi-cordis-watchdog.timer || true)
systemctl stop lykoi-cordis-watchdog.timer
systemctl stop lykoi-cordis
[[ $(systemctl show lykoi-cordis --property=MainPID --value) == 0 ]]
backup=/home/lykoi/runtime/backups/deferred-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$backup"
printf '%s\n' "$before" > "$backup/previous-commit"
tar -C /home/lykoi -czf "$backup/state-and-runtime.tgz" state runtime/instances runtime/governance
echo "Stopped; backup: $backup. On any subsequent error, keep service stopped and inspect."
repo_git checkout --detach "$target"
cd "$repo"
sudo -u lykoi env PATH="$PATH" npm ci
chown -R root:root packages profile
chmod -R go-w packages profile
"$node" packages/lykoi-gate/src/cli.ts --write-manifest
sudo -u lykoi "$node" packages/lykoi-gate/src/cli.ts
systemctl start lykoi-cordis
if [[ $watchdog == active ]]; then systemctl start lykoi-cordis-watchdog.timer; fi
systemctl show lykoi-cordis --property=ActiveState,SubState,NRestarts
echo 'Expected: active/running and stable NRestarts. Panel is loopback-only at port 3210.'
echo 'Verify real chat and one approved workspace file before accepting production. Vision stays disabled until a real image-capable route is supplied.'
