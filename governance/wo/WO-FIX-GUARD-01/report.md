# WO-FIX-GUARD-01 实现与测试报告

- **实现者**：主治理 Agent（Codex，直接实现；未使用 Opus/Sonnet/执行 Agent）
- **基线**：`b5cf7553cd9155d90fc0cc5f5b2d6c5a23601f6a`
- **候选**：`43f4bd57e2f0f78ad628a568c883198547281d14`
- **候选 bundle**：`/tmp/WO-FIX-GUARD-01-43f4bd5.bundle`
- **bundle SHA-256**：`8cad16f8dc9f601c28577edadfc479aded61a81b452979ba7f98d6b66641b5f5`

## 1. 实现

| 文件 | 改动 |
| --- | --- |
| `guardian/startup_verify.py` | 新增 `_mode_writable_by_group_or_other()`，审计目录检查从 `os.access(parent, W_OK)` 改为 `st_mode & (S_IWGRP | S_IWOTH)` |
| `scripts/startup_verify.py` | 与 guardian 活体源同步相同修改，继续保持逐字节一致 |
| `guardian/manifest.sha256` | `startup_verify.py` 更新为 `8fe208486a6125a19b0edf991d253fa0c7c0c45f482300d4d0c6460f32227dd1` |
| `tests/test_p0_integrity.py` | 模拟 root 的 `os.access=True`，证明 `0750` 通过而 `0770` 拒绝 |

目录判断现在与调用身份无关，也更保守：任何组/其他写位都视为审计 sink 可替换。审计文件本身的“服务账户能追加”仍由既有 `os.access(path, W_OK)` 在真实 `lykoi` 启动门中验证，本单不扩大范围。

## 2. 自检与测试

- 本地静态编译：三份 Python 变更均可 `compile()`；`git diff --check` 通过。
- staged/live verifier：`cmp` 一致；两者 SHA-256 均为 `8fe20848...27dd1`；manifest 条目一致。
- 服务器隔离副本（生产 venv、禁用 pyc/cache）相关回归：**52 passed, 5 skipped, 1 warning**。
  - `tests/test_p0_integrity.py`
  - `tests/test_audit_closure.py`
  - `tests/test_audit_provision.py`
  - `tests/test_governance_invariants.py`
- 标准 `umask 0022` 隔离副本全量：**1453 passed, 6 skipped, 2 failed, 1 warning**，耗时 1022.61 秒。
- 全量仅有的两项失败都在 `tests/test_core_v1_shadow.py`，原因是测试仍 monkeypatch 已不存在的 `redaction._SECRETS`。未改 `b5cf7553` 基线在同机、同 venv、同两项测试上逐项复现相同 `AttributeError`，因此不是本变更新增回归。

第一次全量尝试使用服务器默认 `umask 0002` 检出，Git 可执行脚本落成 `0775`，触发一批 rollout 权限断言；确认代表性文件权限后中止。随后以 `umask 0022` 从同一已验证 bundle 创建全新副本重跑，权限类失败全部消失。未修改候选来迎合环境伪差异。

## 3. 生产状态

截至候选验收完成，生产仍为 `b5cf7553`、工作树干净，四服务 active，health 为 `status=ok` / `browser_request_guard=ready`。本实现与测试未修改生产检出、unit/drop-in 或运行中服务。

## 4. 残余与部署门

- root 运行在本单后不再因安全的 `0750` 父目录误报；部署后必须同时以 root 和 `lykoi` 身份实跑启动门。
- 由于触及 guardian，普通用户无法合并；必须由 Kevin root 合并、逐文件恢复权限，并在任何服务重启前先验证 manifest 与启动门。
