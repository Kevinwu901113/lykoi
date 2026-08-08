# WO-FIX-P3-01 复核记录

- **复核人**：主治理 Agent（Codex）
- **日期**：2026-08-08 至 2026-08-09
- **执行 Agent**：服务器 `claude` 账户，模型 `sonnet`
- **结论**：**代码验收通过（经一轮返修）**；**尚未部署**；部署触及 `guardian/manifest.sha256`，必须由 Kevin 以 root 执行

## 1. 交付物

最终分支：`task/wo-fix-p3-01`

| 提交 | 内容 |
| --- | --- |
| `f1e5978c7761fbbad7abca0c2e1c826373be7695` | 自主命令默认工作区、调用方 `cwd` 边界检查、截图目录绝对路径检查、测试与 manifest |
| `7310f99d98e9a4fcbc2ce436cc20fa642229d946` | 返修：在任何写动作前拒绝相对 `LYKOI_AGENT_WORKSPACE`，补回归测试并刷新 manifest |

最终相对 `cf314c36` 的改动：

- `src/lykoi/resources/terminal.py`
- `src/lykoi/resources/browser.py`
- `src/lykoi/resources/research_browser.py`
- `guardian/manifest.sha256`
- `tests/conftest.py`
- `tests/test_terminal_workspace.py`

部署 bundle：

```text
/tmp/WO-FIX-P3-01-7310f99.bundle
sha256: 1e7ef16737a5d88f668745464b3a35b69549e483737fc30d479788374a919789
ref: 7310f99d98e9a4fcbc2ce436cc20fa642229d946 refs/heads/task/wo-fix-p3-01
```

治理账户与活体账户均已执行 `git bundle verify`，结果 `is okay`、完整历史。

## 2. 代码复核结论

### 2.1 `terminal.exec` 工作区隔离通过

- 默认 `LYKOI_AGENT_WORKSPACE=/home/lykoi/workspace/autonomy`。
- 工作区不存在时由代码创建。
- `asyncio.create_subprocess_exec()` 明确传入 `cwd`，不再继承服务的仓库根工作目录。
- 调用方相对 `cwd` 以工作区为基准解析。
- `os.path.realpath()` 后执行边界判断，拒绝 `../`、工作区外绝对路径和指向外部的符号链接。
- 异常为明确的 `WorkspaceEscape`，包含请求路径、解析路径和工作区。

### 2.2 同类资源排查通过

`src/lykoi/resources/` 共 7 个 `.py`：

- `terminal.py`：原先继承 cwd，现已修复。
- `browser.py`：截图目录由 `LYKOI_SCREENSHOT_DIR` 决定；默认绝对路径，现对相对配置 fail-closed。
- `research_browser.py`：截图目录由 `LYKOI_RESEARCH_SCREENSHOT_DIR` 决定；默认绝对路径，现对相对配置 fail-closed。Chrome profile 使用绝对临时目录，不把下载或 profile 写到仓库。
- `autonomy.py`、`notify.py`、`url_guard.py`、`__init__.py`：未发现依赖继承 cwd 的相对落盘路径。

实际 `systemctl cat` 已确认 `lykoi-autonomy.service` 的部署事实仍为：

```text
WorkingDirectory=/home/lykoi/projects/lykoi
```

本工单未修改 systemd，符合任务边界。

## 3. 主治理 Agent 抓出的缺陷与返修

初版 `f1e5978` 的 `_workspace()` 在校验前直接：

```python
os.makedirs(raw, exist_ok=True)
```

独立复现时设置相对 `LYKOI_AGENT_WORKSPACE=relative-workspace-check-f1e5978`，真实 `terminal.exec({"command": "pwd"})` 返回代码工作树下的相对目录。这会在错误配置时重新把工作区建进仓库，违反工单目标。

返修 `7310f99` 改为在任何写动作之前执行 `os.path.isabs(raw)`；相对值立即抛 `WorkspaceEscape`。新增测试通过真实 `terminal.exec()` 触发，并断言 cwd 下没有创建对应目录。

返修过程中有两次网络问题：

- 初次实现会话在提交 `f1e5978` 后 `Connection closed mid-response`，实际 `EXIT=1`，只留下两行报告；提交本身完整。
- 返修第一次尝试 `ECONNRESET / EXIT=1`，两处正确的未提交改动保留；第二次尝试成功提交 `7310f99`，`EXIT=0`，产生完整报告。

所有失败收据均保留在服务器工单目录，治理日志已更正真实退出结果。

## 4. 独立验证

### 4.1 专项测试

最终提交 `7310f99`，隔离 worktree + 活体 venv：

```text
pytest -q tests/test_terminal_workspace.py
10 passed in 0.07s
```

覆盖：

- 默认落点；
- 工作区自动创建；
- 相对子目录；
- 工作区内绝对目录；
- `../` 逃逸；
- 工作区外绝对路径；
- 符号链接逃逸；
- 相对环境变量在写入前拒绝。

### 4.2 P0 完整性硬判据

治理账户首次运行会因按设计读不到 `/home/lykoi/state/approval_rules.json` 而出现权限失败；权威复核按交接纪律改用真实服务身份 `lykoi`：

```text
pytest -q -p no:cacheprovider tests/test_p0_integrity.py
20 passed, 4 skipped in 0.16s
```

六个受保护目录共有 60 个 `.py`：

```text
manifest 缺失：0
manifest 幽灵条目：0
```

三个改动资源文件的磁盘 sha256 与 manifest 完全一致：

```text
browser.py          b13a54b80a2ed5d8fe8f2047acf43d830ba141fd88565c4b150e267a9ca60fdd
research_browser.py 502c4cb4060cffc040af31da7cb6d92c9924d2a647e11c41f486175e3a1db3ad
terminal.py         a3c227a3c84b3e892078d4e18451460a72b4831744aaa69997d3ca2f404e501e
```

### 4.3 相关回归

初版提交上运行所有直接或间接导入相关资源模块的选定测试：

```text
132 passed, 1 skipped, 2 failed
```

两个失败均为 `tests/test_core_v1_shadow.py` 对已不存在 `_SECRETS` 属性的假设；已在基线 `cf314c36` 逐项原样复现，确认不是本工单引入。

### 4.4 功能性实跑

最终提交上直接调用真实 `terminal.exec()`：

```text
绝对工作区：/tmp/lykoi-p3-functional-7310f99-gov/workspace
```

相对环境变量实跑：

```text
WorkspaceEscape: LYKOI_AGENT_WORKSPACE must be an absolute path, got 'relative-workspace-check-7310f99'
```

随后确认代码工作树下没有创建该目录。

### 4.5 启动门说明

在临时 worktree 以 `lykoi` 身份执行 `guardian/startup_verify.py` 会报告该临时树不是 root 属主、且组可写。这是临时 worktree 的预期权限事实；输出中没有 manifest 哈希不符。生产部署后必须先还原属主/权限，再以 `lykoi` 身份运行启动门，不能以 root 运行。

### 4.6 未声称全套测试全绿

曾额外尝试无范围全套回归：第一次在约 20% 手动停止前出现 3 个未取得完整失败栈的 `F`；第二次 fail-fast 在服务器 pytest 已结束后卡在 SSH 收尾，停止前未出现首个 `F`。因此本复核**不声称全库所有测试全绿**。

验收依据是：本工单专项测试、受影响资源相关测试、P0 完整性测试、manifest 反向核对及真实功能调用。上述均已独立完成；全套尝试只作为非权威扩展检查记录，不作为已通过证据。

## 5. 部署事实与权限

部署前线上状态：

```text
HEAD cf314c36
guardian/                         root:root 555
guardian/manifest.sha256          root:root 444
resources/browser.py              root:root 644
resources/research_browser.py     root:root 644
resources/terminal.py             lykoi:lykoi 664
tests/conftest.py                  lykoi:lykoi 644
```

活体仅有两个未跟踪历史产物：`P`（58,577 bytes）与 `|`（946 bytes），均为 `lykoi:lykoi 644`，时间戳 2026-07-29 23:23。

因为本分支修改 `guardian/manifest.sha256`，普通 `lykoi` 账户不能合并；必须 root 合并并逐文件恢复权限，禁止递归 `chown`。

## 6. 给 Kevin 的精确部署步骤

以下命令在 root 会话中执行。任一步不符合预期就停止，不重启服务。

### 6.1 预检与回滚点

```bash
p3_repo=/home/lykoi/projects/lykoi
p3_bundle=/tmp/WO-FIX-P3-01-7310f99.bundle

git -c safe.directory="$p3_repo" -C "$p3_repo" rev-parse HEAD
git -c safe.directory="$p3_repo" -C "$p3_repo" status --short --branch
sha256sum "$p3_bundle"
git -c safe.directory="$p3_repo" -C "$p3_repo" bundle verify "$p3_bundle"
```

必须分别看到：

- HEAD `cf314c363e0643041bba84929642160eb6d5326f`；
- 仅 `?? P` 与 `?? |`；
- bundle sha256 `1e7ef16737a5d88f668745464b3a35b69549e483737fc30d479788374a919789`；
- bundle `is okay`，ref 为最终 `7310f99...`。

建立明确回滚标签：

```bash
git -c safe.directory="$p3_repo" -C "$p3_repo" tag pre-WO-FIX-P3-01-cf314c36 cf314c363e0643041bba84929642160eb6d5326f
```

### 6.2 可恢复地移出两个历史产物，并预建私有工作区

```bash
install -d -o lykoi -g lykoi -m 0700 /home/lykoi/quarantine/WO-FIX-P3-01-20260809
mv -- "$p3_repo/P" "$p3_repo/|" /home/lykoi/quarantine/WO-FIX-P3-01-20260809/
install -d -o lykoi -g lykoi -m 0700 /home/lykoi/workspace/autonomy
```

这里以隔离移动代替不可恢复删除；健康验证完成后再决定是否永久清理 quarantine 副本。

### 6.3 导入分支并 root 合并

```bash
git -c safe.directory="$p3_repo" -C "$p3_repo" fetch "$p3_bundle" task/wo-fix-p3-01:refs/heads/task/wo-fix-p3-01
git -c safe.directory="$p3_repo" -C "$p3_repo" rev-parse task/wo-fix-p3-01
git -c safe.directory="$p3_repo" -C "$p3_repo" merge --no-ff task/wo-fix-p3-01 -m "[WO-FIX-P3-01] merge: isolate autonomous action workspace"
git -c safe.directory="$p3_repo" -C "$p3_repo" rev-parse HEAD
```

分支必须解析为 `7310f99d98e9a4fcbc2ce436cc20fa642229d946`。记录最后一条输出的 merge commit。

### 6.4 精确恢复属主与权限

```bash
chown root:root \
  "$p3_repo/guardian/manifest.sha256" \
  "$p3_repo/src/lykoi/resources/browser.py" \
  "$p3_repo/src/lykoi/resources/research_browser.py"
chmod 0444 "$p3_repo/guardian/manifest.sha256"
chmod 0644 \
  "$p3_repo/src/lykoi/resources/browser.py" \
  "$p3_repo/src/lykoi/resources/research_browser.py"

chown lykoi:lykoi \
  "$p3_repo/src/lykoi/resources/terminal.py" \
  "$p3_repo/tests/conftest.py" \
  "$p3_repo/tests/test_terminal_workspace.py"
chmod 0664 "$p3_repo/src/lykoi/resources/terminal.py"
chmod 0644 \
  "$p3_repo/tests/conftest.py" \
  "$p3_repo/tests/test_terminal_workspace.py"
```

不要 `chown -R`。

### 6.5 重启前验证

```bash
cd "$p3_repo"

sudo -u lykoi env PYTHONDONTWRITEBYTECODE=1 \
  "$p3_repo/.venv/bin/python" -m pytest -q -p no:cacheprovider \
  tests/test_terminal_workspace.py tests/test_p0_integrity.py

sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py

sudo -u lykoi env -u LYKOI_AGENT_WORKSPACE \
  PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$p3_repo/src" \
  "$p3_repo/.venv/bin/python" -c \
  'import asyncio; from lykoi.resources import terminal; print(asyncio.run(terminal.exec({"command":"pwd"}))["stdout"].strip())'

git -c safe.directory="$p3_repo" -C "$p3_repo" status --short --branch
stat -c '%U:%G %a %n' \
  "$p3_repo/guardian/manifest.sha256" \
  "$p3_repo/src/lykoi/resources/browser.py" \
  "$p3_repo/src/lykoi/resources/research_browser.py" \
  "$p3_repo/src/lykoi/resources/terminal.py" \
  "$p3_repo/tests/conftest.py" \
  "$p3_repo/tests/test_terminal_workspace.py" \
  /home/lykoi/workspace/autonomy
```

期望：

- 测试 `30 passed, 4 skipped`；
- 启动门 `startup_verify: OK`、exit 0；
- `pwd` 输出 `/home/lykoi/workspace/autonomy`；
- 仓库无未跟踪 `P` / `|` 或其他新文件；
- 权限与 §6.4 一致，工作区 `lykoi:lykoi 700`。

### 6.6 重启与上线验证

只有 §6.5 全部通过后执行：

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy
systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/health
```

期望四个 `active`、health `200`。watchdog 在重启窗口出现一次连接失败属预期，但不得达到连续三次自动重启阈值。

## 7. 回滚

### 合并尚未完成

```bash
git -c safe.directory="$p3_repo" -C "$p3_repo" merge --abort
```

### 已产生 merge commit、但验证或上线失败

确认 HEAD 仍是本次 merge commit 后，以 root 创建反向提交：

```bash
git -c safe.directory="$p3_repo" -C "$p3_repo" revert -m 1 --no-edit HEAD
chown root:root "$p3_repo/guardian/manifest.sha256" "$p3_repo/src/lykoi/resources/browser.py" "$p3_repo/src/lykoi/resources/research_browser.py"
chmod 0444 "$p3_repo/guardian/manifest.sha256"
chmod 0644 "$p3_repo/src/lykoi/resources/browser.py" "$p3_repo/src/lykoi/resources/research_browser.py"
chown lykoi:lykoi "$p3_repo/src/lykoi/resources/terminal.py" "$p3_repo/tests/conftest.py"
chmod 0664 "$p3_repo/src/lykoi/resources/terminal.py"
chmod 0644 "$p3_repo/tests/conftest.py"

cd "$p3_repo"
sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py
systemctl restart lykoi-core lykoi-server lykoi-autonomy
```

如需恢复两个历史产物：

```bash
mv -- /home/lykoi/quarantine/WO-FIX-P3-01-20260809/P /home/lykoi/quarantine/WO-FIX-P3-01-20260809/\| "$p3_repo/"
```

回滚不要用递归 `chown`；`pre-WO-FIX-P3-01-cf314c36` 是不可歧义的原始回滚点。

## 8. 部署结果（2026-08-09）

- root 已创建回滚标签 `pre-WO-FIX-P3-01-cf314c36`，指向部署前提交 `cf314c363e0643041bba84929642160eb6d5326f`。
- 历史未跟踪产物 `P` 与 `|` 已移入 `/home/lykoi/quarantine/WO-FIX-P3-01-20260809/`；隔离目录权限为 `lykoi:lykoi 0700`。
- 任务提交 `7310f99d98e9a4fcbc2ce436cc20fa642229d946` 已以 `--no-ff` 合并为生产提交 `cf4a63383e07f82294937467329cae37fd61ced0`。
- root-only 与运行账户权限已逐文件恢复；生产工作树为干净的 `main`。
- 生产合并后测试：`tests/test_terminal_workspace.py tests/test_p0_integrity.py` 共 `34 passed`；以 `lykoi` 身份执行 `guardian/startup_verify.py` 返回 `startup_verify: OK`。
- `lykoi-core`、`lykoi-server`、`lykoi-autonomy` 已重启；连同 `lykoi-watchdog` 四个服务持续为 `active`。
- 重启命令后的第一次即时 health 请求发生连接拒绝并返回 `000`；服务日志显示 Uvicorn 随后约 1 秒完成监听。再次及独立复核均返回 HTTP `200`，重启窗口四服务无 warning 级日志，因此判定为正常就绪窗口，不触发回滚。
- autonomy 进程未显式设置 `LYKOI_AGENT_WORKSPACE`，使用代码默认值；活体功能复核 `pwd` 返回 `/home/lykoi/workspace/autonomy`。

## 9. 当前状态

- [x] 工单补强并派发
- [x] 初版实现
- [x] 主治理 Agent 发现相对环境变量缺陷
- [x] 返修提交 `7310f99`
- [x] 专项测试、P0、manifest 反向核对、功能性实跑
- [x] 执行报告与部署 bundle 归档
- [x] Kevin root 部署（生产 merge `cf4a6338`）
- [x] 部署后启动门、服务健康与活体功能验证
