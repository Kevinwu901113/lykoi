#!/usr/bin/env python3
"""Startup integrity gate v2 — run as ExecStartPre for both lykoi units.

THIS FILE IS STAGED AT scripts/startup_verify.py. The live copy is
guardian/startup_verify.py (root:root 444), installed by scripts/p02_harden.sh.
Edit here, re-install via the harden script — the service account can never
edit the live gate.

Exits non-zero (blocking service start) if the governance perimeter looks
tampered. Stdlib-only; imports only its sibling guardian modules.

Checks (P0-2 extends the v1 set):
1.  Guardian dir + ``*.py`` are root-owned and not writable by group/other.
2.  The protected tree beyond guardian/: the repo-internal immediate boundaries
    ``src`` and ``src/lykoi``, the package import entry ``src/lykoi/__init__.py``,
    ``src/lykoi/{kernel,core}`` (dirs + ``*.py`` + any ``__pycache__``), and the
    persona TOML (file + parent dir), are root-owned and not writable by
    group/other. This closes swaps through those immediate source/package
    boundaries; ancestors above ``src`` and service-account compromise are not
    part of this gate's threat model.
3.  Env pinning: the governance paths (LYKOI_APPROVAL_RULES,
    LYKOI_PERSONA_TOML, LYKOI_AUDIT_PATH) must be unset or canonical in the
    service environment — a redirected policy/persona/audit path aborts boot.
4.  The path guard protects the secrets dir and does not over-block the
    workspace.
5.  Manifest: guardian ``*.py``, root-owned kernel/Core ``*.py``, the remaining
    cognition/state layer
    (``src/lykoi/{cognition,mind,memory,shared,surface,resources}/*.py`` —
    GOV-01, hash-pinned but service-account-owned), the persona TOML, the approval rules
    and the Phase-5 prereg constants doc (``docs/phase5_prereg_v1.md``,
    WO-P5-PREREG-01, hash-pinned) all hash-match guardian/manifest.sha256. A
    missing manifest is a FAILURE (no silent bootstrap). Legitimate changes are
    re-signed by the owner:
    ``sudo python3 guardian/startup_verify.py --write-manifest``.
6.  approval_rules.json: structural schema + no auto-allow of hard-gated
    action types (live rules may only tighten policy_core, never loosen it).
7.  The immutable audit sink is provisioned (root-owned, append-only attr).

Usage:
    startup_verify.py                   # verify; exit 1 on any failure
    startup_verify.py --write-manifest  # (re)write guardian/manifest.sha256
"""
from __future__ import annotations

import array
import fcntl
import glob
import hashlib
import json
import os
import stat
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # guardian dir, when installed
import policy_core

GUARDIAN_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.normpath(os.path.join(GUARDIAN_DIR, ".."))
SOURCE_DIR = os.path.join(REPO_ROOT, "src")
LYKOI_SOURCE_DIR = os.path.join(SOURCE_DIR, "lykoi")
PACKAGE_INIT = os.path.join(LYKOI_SOURCE_DIR, "__init__.py")
PACKAGE_PYCACHE = os.path.join(LYKOI_SOURCE_DIR, "__pycache__")
KERNEL_DIR = os.path.join(LYKOI_SOURCE_DIR, "kernel")
CORE_DIR = os.path.join(LYKOI_SOURCE_DIR, "core")
MANIFEST_PATH = os.path.join(GUARDIAN_DIR, "manifest.sha256")

# Canonical governance paths. The env may not redirect these (check 3) — so the
# protected-tree/manifest checks deliberately verify the CANONICAL persona path,
# not an env-resolved one. ``_check_env_pins`` guarantees the app (config.py reads
# LYKOI_PERSONA_TOML) and this gate agree: boot aborts if the env tries to point
# the persona elsewhere, so checking the canonical path here can never diverge
# from what the process will actually load. This is intentionally stricter than
# rules/audit (which the kernel itself reads from env): the innate persona is the
# most sensitive file and is pinned hardest.
RULES_CANONICAL = "/home/lykoi/state/approval_rules.json"
PERSONA_TOML_CANONICAL = "/home/lykoi/runtime/persona/lykoi_base.toml"
AUDIT_CANONICAL = "/var/log/lykoi-audit/audit.jsonl"

RULES_PATH = os.environ.get("LYKOI_APPROVAL_RULES", RULES_CANONICAL)
AUDIT_PATH = os.environ.get("LYKOI_AUDIT_PATH", AUDIT_CANONICAL)
_FS_IOC_GETFLAGS = 0x80086601
_FS_APPEND_FL = 0x00000020


def _guardian_py() -> list[str]:
    return sorted(glob.glob(os.path.join(GUARDIAN_DIR, "*.py")))


def _kernel_py() -> list[str]:
    return sorted(glob.glob(os.path.join(KERNEL_DIR, "*.py")))


def _core_py() -> list[str]:
    return sorted(glob.glob(os.path.join(CORE_DIR, "*.py")))


# WO-NIGHT-01/B5 GOV-01: 认知/状态层源码入 manifest。只做哈希核验, 不加 root
# 属主要求 — 服务账户仍可在工作树开发, 但任何触及这些文件的部署必须 root 重签
# manifest 才能过启动闸(与 kernel 同一条部署纪律)。
# WO-FIX-SEC-01: 补入 memory/ —— insights 表的唯一写入点 upsert_insight 此前不在
# manifest 覆盖范围内, 同一纪律补齐。
COGNITION_DIRS = ("cognition", "mind", "memory", "shared", "surface", "resources")


def _cognition_py() -> list[str]:
    src_root = os.path.join(REPO_ROOT, "src", "lykoi")
    files: list[str] = []
    for sub in COGNITION_DIRS:
        files.extend(glob.glob(os.path.join(src_root, sub, "*.py")))
    return sorted(files)


def _sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _protected_files() -> dict[str, str]:
    """Manifest key -> absolute path, for everything the manifest must pin.
    Guardian sources keep their legacy basename keys; kernel sources are keyed
    by repo-relative path; the persona TOML and the approval rules by their
    canonical absolute paths."""
    entries = {os.path.basename(p): p for p in _guardian_py()}
    entries[os.path.relpath(PACKAGE_INIT, REPO_ROOT)] = PACKAGE_INIT
    for path in _kernel_py():
        entries[os.path.relpath(path, REPO_ROOT)] = path
    for path in _core_py():
        entries[os.path.relpath(path, REPO_ROOT)] = path
    for path in _cognition_py():  # GOV-01: 认知/状态层同锚
        entries[os.path.relpath(path, REPO_ROOT)] = path
    entries[PERSONA_TOML_CANONICAL] = PERSONA_TOML_CANONICAL
    entries[RULES_CANONICAL] = RULES_CANONICAL
    # WO-P5-PREREG-01: Phase 5 预注册常数文档同锚(hash-only) — 预注册锁的物理面。
    # 常数改动必须出新版本文件 + root 重签 manifest, 与 GOV-01 同纪律; 放这里
    # (而非只加 manifest 行)是为了让日后任何 --write-manifest 重签都保留此锚。
    entries["docs/phase5_prereg_v1.md"] = os.path.join(REPO_ROOT, "docs", "phase5_prereg_v1.md")
    return entries


def _resolve_manifest_name(name: str) -> str:
    if os.path.isabs(name):
        return name
    if "/" in name:
        return os.path.join(REPO_ROOT, name)
    return os.path.join(GUARDIAN_DIR, name)


def _write_manifest() -> None:
    lines = [f"{_sha256(path)}  {name}" for name, path in sorted(_protected_files().items())]
    with open(MANIFEST_PATH, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")
    print(f"startup_verify: wrote manifest for {len(lines)} files -> {MANIFEST_PATH}")


def _check_owned_and_unwritable(path: str, problems: list[str]) -> None:
    st = os.stat(path)
    if st.st_uid != 0:
        problems.append(f"{path}: not root-owned (uid {st.st_uid})")
    if st.st_mode & 0o022:
        problems.append(f"{path}: writable by group/other (mode {oct(st.st_mode & 0o777)})")


def _check_protected_pycache(path: str, problems: list[str]) -> None:
    """If bytecode exists under a protected import boundary, pin its ownership.

    The rollout removes these caches.  This check also fails closed if a stale
    cache survives or a non-directory/symlink is planted in its place.
    """
    if not os.path.lexists(path):
        return
    info = os.lstat(path)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        problems.append(f"protected pycache is not a real directory: {path}")
        return
    _check_owned_and_unwritable(path, problems)
    for entry in sorted(glob.glob(os.path.join(path, "*"))):
        info = os.lstat(entry)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            problems.append(f"protected pycache entry is not a regular file: {entry}")
        else:
            _check_owned_and_unwritable(entry, problems)


def _check_perms(problems: list[str]) -> None:
    for path in [GUARDIAN_DIR, *_guardian_py()]:
        _check_owned_and_unwritable(path, problems)


def _check_protected_tree(problems: list[str]) -> None:
    """Kernel/Core and the persona TOML are root-domain.

    The files, their directories, and the repo-internal immediate source/package
    boundaries must be outside the service account's write reach. Protecting
    only ``core/`` or ``kernel/`` is insufficient when ``src/lykoi`` can replace
    either child. This check intentionally does not claim to seal the complete
    home/repository ancestor chain or survive service-account compromise; that
    requires a separately managed root-owned runtime tree.
    """
    for label, directory in (
        ("source root", SOURCE_DIR),
        ("lykoi source root", LYKOI_SOURCE_DIR),
    ):
        if not os.path.isdir(directory):
            problems.append(f"{label} dir missing: {directory}")
        else:
            _check_owned_and_unwritable(directory, problems)

    if not os.path.isfile(PACKAGE_INIT):
        problems.append(f"package import entry missing: {PACKAGE_INIT}")
    else:
        _check_owned_and_unwritable(PACKAGE_INIT, problems)
    _check_protected_pycache(PACKAGE_PYCACHE, problems)

    for label, directory, sources in (
        ("kernel", KERNEL_DIR, _kernel_py()),
        ("core", CORE_DIR, _core_py()),
    ):
        if not os.path.isdir(directory):
            problems.append(f"{label} dir missing: {directory}")
            continue
        for path in [directory, *sources]:
            _check_owned_and_unwritable(path, problems)
        # A service-writable bytecode cache under a protected source dir is a
        # code-injection vector (a planted .pyc shadows the .py).
        _check_protected_pycache(os.path.join(directory, "__pycache__"), problems)

    if not os.path.exists(PERSONA_TOML_CANONICAL):
        problems.append(f"persona TOML missing: {PERSONA_TOML_CANONICAL}")
    else:
        _check_owned_and_unwritable(PERSONA_TOML_CANONICAL, problems)
        _check_owned_and_unwritable(os.path.dirname(PERSONA_TOML_CANONICAL), problems)


def _check_env_pins(problems: list[str]) -> None:
    pins = {
        "LYKOI_APPROVAL_RULES": RULES_CANONICAL,
        "LYKOI_PERSONA_TOML": PERSONA_TOML_CANONICAL,
        "LYKOI_AUDIT_PATH": AUDIT_CANONICAL,
    }
    for var, canonical in pins.items():
        value = os.environ.get(var)
        if value and os.path.realpath(value) != os.path.realpath(canonical):
            problems.append(
                f"{var} redirects a governance path to {value!r} (canonical: {canonical})"
            )


def _check_guard(problems: list[str]) -> None:
    if not policy_core.is_protected_path("/home/lykoi/secrets/llm.env"):
        problems.append("path guard does not protect the secrets dir")
    if policy_core.is_protected_path("/home/lykoi/projects/lykoi/src/lykoi"):
        problems.append("path guard over-blocks the workspace")


def _check_manifest(problems: list[str]) -> None:
    if not os.path.exists(MANIFEST_PATH):
        problems.append(f"manifest missing: {MANIFEST_PATH} (run --write-manifest as root)")
        return
    expected: dict[str, str] = {}
    with open(MANIFEST_PATH, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                digest, name = line.split(None, 1)
                expected[name.strip()] = digest

    protected = _protected_files()
    for name, path in protected.items():
        if name not in expected:
            problems.append(f"{name}: protected but not in manifest (re-sign required)")
        elif not os.path.exists(path):
            problems.append(f"{name}: protected file missing")
        elif _sha256(path) != expected[name]:
            problems.append(f"{name}: hash mismatch (tampered?)")
    for name in expected:
        if name not in protected:
            path = _resolve_manifest_name(name)
            if not os.path.exists(path):
                problems.append(f"{name}: in manifest but file is gone")
            elif _sha256(path) != expected[name]:
                problems.append(f"{name}: hash mismatch (tampered?)")


def _rules_schema_problems(rules) -> list[str]:
    """Structural schema for the approval rules document (stdlib twin of
    kernel.approval.validate_rules — this copy lives in the root domain)."""
    if not isinstance(rules, dict):
        return ["approval_rules schema: document must be a JSON object"]
    problems: list[str] = []
    keys = ("always_allow", "always_deny", "ask")

    def _check_str_list(block: dict, key: str, where: str) -> None:
        value = block.get(key, [])
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            problems.append(f"approval_rules schema: {where}{key} must be a list of strings")

    for key in keys:
        _check_str_list(rules, key, "")
    extra = set(rules) - set(keys) - {"autonomous"}
    if extra:
        problems.append(f"approval_rules schema: unknown top-level keys {sorted(extra)}")
    block = rules.get("autonomous")
    if block is not None:
        if not isinstance(block, dict):
            problems.append("approval_rules schema: autonomous block must be an object")
        else:
            for key in ("always_allow", "always_deny"):
                _check_str_list(block, key, "autonomous.")
            extra = set(block) - {"always_allow", "always_deny"}
            if extra:
                problems.append(f"approval_rules schema: unknown autonomous keys {sorted(extra)}")
    return problems


def _check_rules(problems: list[str]) -> None:
    if not os.path.exists(RULES_PATH):
        return  # the kernel bootstraps an empty default; nothing to loosen
    try:
        with open(RULES_PATH, encoding="utf-8") as handle:
            rules = json.load(handle)
    except (OSError, ValueError) as exc:
        problems.append(f"{RULES_PATH}: unreadable ({exc})")
        return
    problems.extend(_rules_schema_problems(rules))
    if not isinstance(rules, dict):
        return
    hard = policy_core.HARD_ASK_TYPES | policy_core.HARD_DENY_TYPES
    for entry in rules.get("always_allow", []):
        if entry in hard:
            problems.append(f"approval_rules.json auto-allows hard-gated {entry!r}")
    # The autonomous sub-block's allow-list is a second place a hard-gated action
    # could be planted; the runtime kernel denies it via the capability floor, but
    # the boot gate must catch it too (defense in depth, symmetric with above).
    autonomous = rules.get("autonomous") or {}
    if isinstance(autonomous, dict):
        for entry in autonomous.get("always_allow", []):
            if entry in hard:
                problems.append(
                    f"approval_rules.json autonomous.always_allow auto-allows hard-gated {entry!r}"
                )


def _audit_append_only(path):
    """True/False if the append-only inode flag could be read, else None."""
    try:
        fd = os.open(path, os.O_RDONLY)
    except OSError:
        return None
    try:
        buf = array.array("i", [0])
        fcntl.ioctl(fd, _FS_IOC_GETFLAGS, buf, True)
        return bool(buf[0] & _FS_APPEND_FL)
    except OSError:
        return None
    finally:
        os.close(fd)


def _mode_writable_by_group_or_other(mode):
    """Return whether ``mode`` grants write access beyond the file owner.

    This is deliberately identity-independent.  ``os.access`` answers for the
    calling process, so a manual root invocation would otherwise report every
    directory as writable even when the service account cannot write it.
    """
    return bool(mode & (stat.S_IWGRP | stat.S_IWOTH))


def _check_audit_sink(problems):
    """Narrow provisioning check for the immutable audit sink."""
    path = AUDIT_PATH
    if os.path.islink(path):
        problems.append(f"audit sink {path} is a symlink")
        return
    if not os.path.exists(path):
        problems.append(f"audit sink missing: {path}")
        return

    st = os.stat(path)
    if st.st_uid != 0:
        problems.append(f"audit sink {path} not root-owned (uid {st.st_uid})")
    if not os.access(path, os.W_OK):
        problems.append(f"audit sink {path} not appendable by the service user")
    if not _audit_append_only(path):
        problems.append(f"audit sink {path} missing append-only attribute")

    parent = os.path.dirname(os.path.abspath(path))
    pst = os.stat(parent)
    if pst.st_uid != 0:
        problems.append(f"audit sink directory {parent} not root-owned")
    if _mode_writable_by_group_or_other(pst.st_mode):
        problems.append(f"audit sink directory {parent} writable by group/other")


def verify() -> list[str]:
    """Run every check and return a list of problems ([] means all good)."""
    problems: list[str] = []
    _check_perms(problems)
    _check_protected_tree(problems)
    _check_env_pins(problems)
    _check_guard(problems)
    _check_manifest(problems)
    _check_rules(problems)
    _check_audit_sink(problems)
    return problems


def main() -> int:
    if "--write-manifest" in sys.argv:
        _write_manifest()
        return 0
    problems = verify()
    if problems:
        for problem in problems:
            print(f"startup_verify: FAIL: {problem}", file=sys.stderr)
        return 1
    print("startup_verify: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
