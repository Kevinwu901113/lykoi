#!/usr/bin/env python3
"""Watchdog — an independent supervisor for lykoi-server.

Polls the surface /health endpoint every 10s. After 3 consecutive failures
it records the death in state/watchdog.jsonl and restarts the service.

This script deliberately imports nothing from the lykoi package and uses
only the standard library: it must keep working even if the package or the
venv is broken. The unit runs as root (see watchdog.service), so the restart
is a direct ``systemctl`` call — no sudo, and the lykoi user holds no
privilege of its own.
"""
import json
import subprocess
import time
import urllib.request
from datetime import datetime, timezone

HEALTH_URL = "http://127.0.0.1:8080/health"
LOG_PATH = "/home/lykoi/state/watchdog.jsonl"
SERVICE = "lykoi-server"
INTERVAL_S = 10
MAX_FAILURES = 3

# Never route the loopback health check through an outbound proxy.
_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def _log(record):
    record["ts"] = datetime.now(timezone.utc).isoformat()
    with open(LOG_PATH, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def _healthy():
    """Return (ok, reason). reason is None when ok."""
    try:
        with _OPENER.open(HEALTH_URL, timeout=5) as resp:
            if resp.status == 200:
                return True, None
            return False, f"status {resp.status}"
    except Exception as exc:
        return False, str(exc)


def _restart():
    # The unit runs as root, so call systemctl directly (no sudo).
    return subprocess.run(
        ["systemctl", "restart", SERVICE], capture_output=True, text=True
    )


def main():
    _log({"event": "watchdog_start"})
    failures = 0
    while True:
        ok, reason = _healthy()
        if ok:
            failures = 0
        else:
            failures += 1
            _log({"event": "health_check_failed", "consecutive_failures": failures, "reason": reason})
            if failures >= MAX_FAILURES:
                _log({"event": "health_lost", "consecutive_failures": failures, "action": "restart"})
                result = _restart()
                _log(
                    {
                        "event": "restart_done",
                        "returncode": result.returncode,
                        "stderr": (result.stderr or "").strip()[:300],
                    }
                )
                failures = 0
        time.sleep(INTERVAL_S)


if __name__ == "__main__":
    main()
