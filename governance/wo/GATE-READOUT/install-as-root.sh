#!/bin/bash
# GATE-READOUT · 证据门读数自动导出 · root 一次性安装(2026-08-19)
# 作用: root 定时器每 3h 读 /home/lykoi/state/events.jsonl(0600),聚合成
# 一行 JSON 追加到 /var/log/lykoi-audit/gate-readout.jsonl(root:lykoi 0640,
# 治理账户经 lykoi 组可读)。只聚合计数/直方图/时延,失败 detail 本身已是
# U3-FIX 白名单模板文本;她的对话原文不经过此管道。
set -euo pipefail

cat > /usr/local/sbin/lykoi-gate-readout <<'PYEOF'
#!/usr/bin/env python3
"""Evidence-gate readout exporter. Root-only reader; appends one JSON line."""
import json, statistics, datetime

SRC = "/home/lykoi/state/events.jsonl"
OUT = "/var/log/lykoi-audit/gate-readout.jsonl"
WINDOWS = {
    "since_shadow_live": "2026-08-18T16:17:32",   # 合并包 12 重启(影子上线)
    "since_json_mode":  "2026-08-19T08:08:03",    # 合并包 13 重启(json 强制)
}

def summarize(w0):
    env, fails, refresh = [], [], 0
    llm, ev_hist = {}, {}
    with open(SRC) as fh:
        for line in fh:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            if str(e.get("ts", "")) < w0:
                continue
            name = e.get("event")
            ev_hist[name] = ev_hist.get(name, 0) + 1
            if name == "u3_shadow_envelope":
                env.append(e)
            elif name == "u3_shadow_failed":
                fails.append(e)
            elif name == "stable_prefix_rebuilt":
                refresh += 1
            elif name == "llm_call":
                r = llm.setdefault(e.get("route"), [0, 0, 0, 0, 0])
                r[0] += 1
                for i, k in enumerate(("prompt_tokens", "completion_tokens",
                                       "cache_hit_tokens", "cache_miss_tokens"), 1):
                    r[i] += e.get(k) or 0
    freasons = {}
    for f in fails:
        key = "%s/%s" % (f.get("reason", "?"), f.get("detail", "?"))
        freasons[key] = freasons.get(key, 0) + 1
    nt = [x for x in env if not x.get("tool_turn")]
    lat = sorted((x.get("elapsed_ms") or 0) for x in nt)
    kinds = {}
    for x in env:
        kinds[x.get("kind")] = kinds.get(x.get("kind"), 0) + 1
    routes = {}
    for route, (c, p, co, h, m) in llm.items():
        routes[str(route)] = {
            "calls": c,
            "hit_rate": round(h / (h + m), 3) if (h + m) else None,
            "completion_avg": round(co / c) if c else 0,
        }
    return {
        "samples_total": len(env),
        "samples_non_tool": len(nt),
        "latency_ms_median_non_tool": statistics.median(lat) if lat else None,
        "shadow_failed": len(fails),
        "failure_histogram": freasons,
        "demoted": sum(1 for x in env if x.get("demoted")),
        "unbacked_claim": sum(1 for x in env
                              if (x.get("receipt_backing") or {}).get("unbacked_claim")),
        "has_action_claim": sum(1 for x in env
                                if (x.get("receipt_backing") or {}).get("has_action_claim")),
        "stable_prefix_rebuilt": refresh,
        "kinds": kinds,
        "llm_routes": routes,
        "event_histogram_top": dict(sorted(ev_hist.items(),
                                           key=lambda kv: -kv[1])[:20]),
    }

record = {
    "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "windows": {name: summarize(w0) for name, w0 in WINDOWS.items()},
}
with open(OUT, "a") as out:
    out.write(json.dumps(record, ensure_ascii=False) + "\n")
PYEOF
chmod 750 /usr/local/sbin/lykoi-gate-readout
chown root:root /usr/local/sbin/lykoi-gate-readout

touch /var/log/lykoi-audit/gate-readout.jsonl
chown root:lykoi /var/log/lykoi-audit/gate-readout.jsonl
chmod 640 /var/log/lykoi-audit/gate-readout.jsonl

cat > /etc/systemd/system/lykoi-gate-readout.service <<'EOF'
[Unit]
Description=Lykoi evidence-gate readout exporter (governance observability)

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/lykoi-gate-readout
EOF

cat > /etc/systemd/system/lykoi-gate-readout.timer <<'EOF'
[Unit]
Description=Run lykoi-gate-readout every 3h

[Timer]
OnBootSec=10min
OnUnitActiveSec=3h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now lykoi-gate-readout.timer
systemctl start lykoi-gate-readout.service
sleep 1
echo "=== 首次读数 ==="
tail -1 /var/log/lykoi-audit/gate-readout.jsonl | head -c 600
echo
echo "=== INSTALL OK ==="
