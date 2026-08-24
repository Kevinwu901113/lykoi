"""Path guard — symlink-safe containment checks (stdlib only).

The realpath primitive the rest of the governance core builds on, so a symlink
or ".." cannot smuggle a path past a prefix check. Imports nothing from the
lykoi package.
"""
from __future__ import annotations

import os


def is_within(path: str, base: str) -> bool:
    """True if ``path`` resolves to ``base`` or somewhere beneath it (realpath-safe)."""
    try:
        real = os.path.realpath(path)
        base_real = os.path.realpath(base)
    except OSError:
        return True  # unresolvable -> treat as inside (fail closed)
    return real == base_real or real.startswith(base_real + os.sep)


def classify(path: str, deny_zones) -> str:
    """Return "deny" if ``path`` resolves into any deny zone, else "allow"."""
    return "deny" if any(is_within(path, base) for base in deny_zones) else "allow"
