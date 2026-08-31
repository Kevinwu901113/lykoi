"""Immutable governance core — hardcoded rules the live kernel consults but
cannot weaken.

Root-owned and read-only at runtime (the lykoi user cannot edit this file), so
these decisions hold even if the agent rewrites its own approval_rules.json.
Stdlib-only; imports nothing from the lykoi package.

Three knobs:

* ``hard_decision(action_type)`` returns "ask" to FORCE owner approval — it
  downgrades any live "allow" (an unrestricted shell can be approved per command
  but never promoted to standing auto-run) — "deny" for the never-approvable, or
  None to defer to the live file rules. The live rules may only TIGHTEN this.
* ``capability_profile(origin, action_type)`` is the origin-scoped reachability
  floor. Only the ``autonomous`` origin is constrained: it may reach exactly the
  actions in ``AUTONOMOUS_ALLOWED`` and nothing else (everything else -> "deny").
  ``interactive``/``system`` get None (the profile has no opinion; the hard rules
  and the live file decide). The kernel evaluates a capability "deny" BEFORE a
  hard "ask", so an autonomous request for a hard-ask action (e.g. terminal.exec)
  is denied outright, not queued for an approver that does not exist in that loop.
* ``is_protected_path(path)`` marks filesystem zones the agent must never reach
  through any resource (secrets, the guardian itself).
"""
from __future__ import annotations

import path_guard  # sibling module in guardian/

# Action types that must always route through owner approval, regardless of what
# the live approval_rules.json says. An unrestricted shell is the canonical case.
# delegation.dispatch joined with WO-GW-01 (owner-adopted executor
# recommendation, 2026-08-21): spawning a sub-agent must always face the owner,
# no matter what the live rules are edited to say.
HARD_ASK_TYPES = frozenset({"terminal.exec", "delegation.dispatch"})

# Action types that can never run, even with owner approval. Empty for now —
# reserved; per-action denials live in the live rules, per-path in PROTECTED_PATHS.
HARD_DENY_TYPES: frozenset[str] = frozenset()

# The ENTIRE set of actions the autonomous runtime may reach. This is an
# allow-list, not a deny-list: anything not named here is denied for the
# ``autonomous`` origin. Kept here (immutable, root-owned, manifest-hashed) so the
# agent cannot widen its own autonomous capability surface by editing live rules.
AUTONOMOUS_ALLOWED = frozenset(
    {
        "research_browser.open",
        "research_browser.read_text",
        "research_browser.extract_links",
        "research_browser.screenshot",
        "autonomy.queue_notification",
        "autonomy.initiate_chat",  # WO-NIGHT-01/B3: 主动开口(对话消息; 日1条/冷却6h 在资源层强制)
        # WO-P2-S1A/S1B: 她自己的社交器官。send 的日1条/冷却6h 同样在资源层强制;
        # read 无副作用。绑定校验在设备层(只接受 identity_bindings 内的发送者)。
        "messenger.send",
        "messenger.read",
    }
)

# Filesystem zones the agent must never reach through any resource. realpath is
# applied (via path_guard) so symlinks / ".." cannot escape these prefixes.
PROTECTED_PATHS = (
    "/home/lykoi/secrets",
    "/home/lykoi/projects/lykoi/guardian",
)


def hard_decision(action_type: str):
    """Return "deny", "ask", or None (defer to the live file rules)."""
    if action_type in HARD_DENY_TYPES:
        return "deny"
    if action_type in HARD_ASK_TYPES:
        return "ask"
    return None


def capability_profile(origin: str, action_type: str):
    """Origin-scoped reachability floor: "allow", "deny", or None.

    Only ``autonomous`` is constrained — allow-listed actions return "allow", all
    others "deny". Every other origin returns None (no opinion)."""
    if origin != "autonomous":
        return None
    return "allow" if action_type in AUTONOMOUS_ALLOWED else "deny"


def is_protected_path(path: str) -> bool:
    """True if ``path`` resolves inside a protected zone (secrets, guardian)."""
    return any(path_guard.is_within(path, base) for base in PROTECTED_PATHS)
