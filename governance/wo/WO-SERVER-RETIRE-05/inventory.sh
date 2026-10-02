#!/usr/bin/env bash
# Read-only metadata inventory. No service changes, deletion, credential contents or process argv.
set -eu
printf '%s\n' '=== Old Lykoi deployment candidates: metadata only ==='
printf 'Host: '; hostname
printf 'UTC: '; date -u +'%Y-%m-%dT%H:%M:%SZ'
printf '%s\n' '=== Installed candidate systemd units ==='
if command -v systemctl >/dev/null 2>&1; then
  systemctl list-unit-files --no-pager --no-legend 'lykoi*' || true
  printf '%s\n' '=== Loaded candidate systemd units ==='
  systemctl list-units --all --no-pager --no-legend 'lykoi*' || true
  while read -r unit rest; do
    case "$unit" in
      lykoi*.service|lykoi*.timer|lykoi*.socket|lykoi*.path)
        systemctl show "$unit" --no-pager \
          --property=Id,ActiveState,SubState,UnitFileState,FragmentPath,DropInPaths,WorkingDirectory,User,Group,MainPID || true
        ;;
    esac
  done < <(systemctl list-unit-files --no-pager --no-legend 'lykoi*' 2>/dev/null || true)
fi
printf '%s\n' '=== Historical candidate paths: no file contents ==='
paths=(
  /home/lykoi/projects/lykoi
  /home/lykoi/projects/lykoi-cordis
  /home/lykoi/state
  /home/lykoi/runtime
  /home/lykoi/workspace
  /home/lykoi-browser/profile
  /etc/lykoi-browser
  /home/lykoi/secrets/telegram-cordis.env
  /home/lykoi/secrets/llm.env
  /usr/local/sbin/lykoi-cordis-watchdog.sh
)
for path in "${paths[@]}"; do
  if [[ -e "$path" || -L "$path" ]]; then
    stat --printf='%F | %U:%G | %a | %n\n' -- "$path" || true
    # No recursive size scan of secrets or symlink targets.
    case "$path" in
      /home/lykoi/secrets/*) ;;
      *) [[ -L "$path" ]] || du -sh -- "$path" 2>/dev/null || true ;;
    esac
  else
    printf 'missing/inaccessible | %s\n' "$path"
  fi
done
printf '%s\n' '=== Candidate filenames, not contents ==='
for dir in /etc/systemd/system /usr/local/sbin /usr/local/bin /etc/cron.d /etc/sudoers.d; do
  if [[ -d "$dir" ]]; then
    find "$dir" -maxdepth 1 -name '*lykoi*' -printf '%y | %u:%g | %m | %p\n' 2>/dev/null || true
  fi
done
printf '%s\n' 'Inventory only; nothing stopped, disabled, removed or deployed.'
