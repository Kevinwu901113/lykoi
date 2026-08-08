# WO-FIX-P3-01 返修 01：拒绝相对工作区配置并补齐报告

你正在 `task/wo-fix-p3-01` 分支上返修现有提交 `f1e5978`。不得合并、不得改写历史；完成后新增一个提交，前缀仍为 `[WO-FIX-P3-01]`。

## 主治理 Agent 独立复核发现

当前 `src/lykoi/resources/terminal.py::_workspace()` 直接执行：

```python
raw = os.environ.get(WORKSPACE_ENV, DEFAULT_WORKSPACE)
os.makedirs(raw, exist_ok=True)
return os.path.realpath(raw)
```

当 `LYKOI_AGENT_WORKSPACE=relative-workspace-check-f1e5978` 且进程 cwd 为代码仓根时，独立实跑 `terminal.exec({"command": "pwd"})` 返回：

```text
/tmp/lykoi-p3-review-f1e5978-gov/relative-workspace-check-f1e5978
```

也就是先在代码树中创建相对目录，重新引入本工单要消除的结构性风险。默认值虽安全，但新环境变量自身没有 fail-closed。

## 必须修改

1. `_workspace()` 必须在任何 `os.makedirs()` 或其他写动作之前拒绝相对的 `LYKOI_AGENT_WORKSPACE`，抛出含变量名与错误值的明确异常。绝对路径的现有行为保持不变。
2. 新增回归测试：相对环境变量被拒绝，且进程 cwd 下对应的相对目录没有被创建。不得只测辅助函数，必须通过 `terminal.exec()` 触发真实路径。
3. 因再次修改 `src/lykoi/resources/terminal.py`，同步刷新 `guardian/manifest.sha256` 对应哈希；反向确认本分支所有改动/新增的受保护 `.py` 均已登记。
4. 重跑 `tests/test_terminal_workspace.py`。尝试运行 `tests/test_p0_integrity.py`；若治理账户因读不到 `/home/lykoi/state/approval_rules.json` 而失败，必须如实报告，不能声称通过。主治理 Agent 已以 `lykoi` 身份在隔离 worktree 对 `f1e5978` 跑出 `20 passed, 4 skipped`，返修提交后仍会重新权威复核。
5. 不要修改 systemd，不要触碰活体检出、state、secrets、core.sock 或进程。

## 报告要求

上次会话因 `Connection closed mid-response` 只留下两行残缺报告。本次 stdout 必须是完整报告：

- 第一行 `# WO-FIX-P3-01 返修 01 执行报告`
- 两个提交与最终 HEAD
- 改动文件和完整 diff
- 所有测试命令、逐项结果与任何环境限制
- resources 全目录排查清单
- manifest 反向核对证据
- 给主治理 Agent 的 3–5 条实跑检查点

不要写报告文件；stdout 即报告。禁止用摘要代替明细。
