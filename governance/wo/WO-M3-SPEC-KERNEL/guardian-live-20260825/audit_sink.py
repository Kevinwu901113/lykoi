"""Append-only audit sink (stdlib only).

Writes one JSON line per record, opening the log in append mode only — it never
truncates or rewrites. The file is meant to be made append-only at the OS level
(root-owned + ``chattr +a``, an owner step), so even a compromised agent that
can append cannot rewrite or delete history. Imports nothing from lykoi.
"""
from __future__ import annotations

import json
import os

AUDIT_PATH = os.environ.get("LYKOI_AUDIT_PATH", "/var/log/lykoi-audit/audit.jsonl")


def audit(record: dict) -> None:
    """Append one JSON record to the audit log (append-only)."""
    line = json.dumps(record, ensure_ascii=False, default=str)
    with open(AUDIT_PATH, "a", encoding="utf-8") as handle:
        handle.write(line + "\n")
