# WO-FIX-GUARD-01：启动门 audit 目录权限检查去调用身份化

- **状态**：主治理 Agent 直接实现（Kevin 明确要求不使用 Opus/Sonnet）
- **生产基线**：`b5cf7553cd9155d90fc0cc5f5b2d6c5a23601f6a`
- **日期**：2026-08-09

## 背景

`guardian/startup_verify.py::_check_audit_sink()` 用 `os.access(parent, os.W_OK)` 判断审计目录是否可被服务账户替换。该调用回答的是“当前调用进程是否可写”：以 root 手工运行时，即使目录实际为安全的 `root:lykoi 0750`，也会恒真并误报：

```text
audit sink directory /var/log/lykoi-audit writable by the service user
```

systemd 的 `ExecStartPre` 以 `lykoi` 身份执行，因此生产启动不受影响；但 root 手工诊断会得到错误结论，可能诱发不必要回滚。

## 实现范围

1. 审计目录替换风险改为直接检查 `st_mode` 的组/其他写位，不再依赖调用者身份。
2. `guardian/startup_verify.py` 与 staged 副本 `scripts/startup_verify.py` 保持逐字节一致。
3. 更新 `guardian/manifest.sha256` 中 `startup_verify.py` 自身哈希。
4. 在 `tests/test_p0_integrity.py` 增加 root 调用语义回归：模拟 `os.access=True` 时，`0750` 不得误报；`0770` 必须失败。

## 不在范围

- 不改变审计文件 append-only、属主或服务账户可追加检查。
- 不改变 `/var/log/lykoi-audit` 的活体权限与 ACL。
- 不改变任何 systemd unit、drop-in 或运行中服务。

## 验收条件

- staged/live verifier 逐字节一致，manifest 哈希匹配。
- `tests/test_p0_integrity.py`、audit closure/provision 与 governance invariants 全绿。
- 全量测试无本变更新增失败；既有失败须在未改基线上同机复现。
- 部署后 root 与 `lykoi` 两种身份运行 `guardian/startup_verify.py` 都返回 `OK`。
- 三个主体服务重启后，四服务 active、health 保持 `browser_request_guard=ready`。
