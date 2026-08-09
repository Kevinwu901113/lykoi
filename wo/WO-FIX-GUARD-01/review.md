# WO-FIX-GUARD-01 复核与部署记录

- **复核人/实现者**：主治理 Agent（Codex，直接实现）
- **日期**：2026-08-09
- **候选**：`43f4bd57e2f0f78ad628a568c883198547281d14`
- **生产合并**：`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`
- **结论**：**已部署生效并完成独立活体复核**

## 1. 独立复核结论

- [x] 改动只影响 audit sink 父目录写权限判据；未改变运行时审计写入路径或 capability authority。
- [x] `0750` 在模拟 root `os.access=True` 时不再误报；`0770` 仍 fail closed。
- [x] `guardian/startup_verify.py` 与 `scripts/startup_verify.py` 逐字节一致。
- [x] manifest 已更新启动门自身哈希，`test_p0_integrity.py` 已实跑通过。
- [x] 相关回归 52 passed；全量 1453 passed，唯一两项失败已在未改基线同机复现。
- [x] 生产 root 合并、双身份启动门与服务重启验收。

## 2. 部署前提

- 生产 HEAD 必须仍为 `b5cf7553cd9155d90fc0cc5f5b2d6c5a23601f6a`，工作树必须干净。
- bundle 必须为 `/tmp/WO-FIX-GUARD-01-43f4bd5.bundle`，SHA-256 必须为 `8cad16f8dc9f601c28577edadfc479aded61a81b452979ba7f98d6b66641b5f5`。
- 触及 `guardian/startup_verify.py` 与 manifest，只能由 Kevin root 合并；不得递归 chown。

## 3. Kevin root 部署命令

预检：

```bash
guard01_repo=/home/lykoi/projects/lykoi
guard01_bundle=/tmp/WO-FIX-GUARD-01-43f4bd5.bundle

git -c safe.directory="$guard01_repo" -C "$guard01_repo" rev-parse HEAD
git -c safe.directory="$guard01_repo" -C "$guard01_repo" status --short --branch
sha256sum "$guard01_bundle"
git -c safe.directory="$guard01_repo" -C "$guard01_repo" bundle verify "$guard01_bundle"
```

创建回滚点并合并：

```bash
git -c safe.directory="$guard01_repo" -C "$guard01_repo" \
  tag pre-WO-FIX-GUARD-01-b5cf7553 \
  b5cf7553cd9155d90fc0cc5f5b2d6c5a23601f6a

git -c safe.directory="$guard01_repo" -C "$guard01_repo" fetch \
  "$guard01_bundle" \
  task/wo-fix-guard-01-direct:refs/heads/task/wo-fix-guard-01

git -c safe.directory="$guard01_repo" -C "$guard01_repo" merge \
  --no-ff task/wo-fix-guard-01 \
  -m "[WO-FIX-GUARD-01] merge: root-safe audit directory mode check"
```

逐文件恢复权限：

```bash
chown root:root \
  "$guard01_repo/guardian/manifest.sha256" \
  "$guard01_repo/guardian/startup_verify.py"

chmod 0444 \
  "$guard01_repo/guardian/manifest.sha256" \
  "$guard01_repo/guardian/startup_verify.py"

chown lykoi:lykoi \
  "$guard01_repo/scripts/startup_verify.py" \
  "$guard01_repo/tests/test_p0_integrity.py"

chmod 0644 \
  "$guard01_repo/scripts/startup_verify.py" \
  "$guard01_repo/tests/test_p0_integrity.py"
```

重启前验证：

```bash
cd "$guard01_repo"

cmp guardian/startup_verify.py scripts/startup_verify.py
sha256sum guardian/startup_verify.py scripts/startup_verify.py
grep ' startup_verify.py$' guardian/manifest.sha256

sudo -u lykoi env PYTHONDONTWRITEBYTECODE=1 \
  "$guard01_repo/.venv/bin/python" -m pytest -q -p no:cacheprovider \
  tests/test_p0_integrity.py \
  tests/test_audit_closure.py \
  tests/test_audit_provision.py \
  tests/test_governance_invariants.py

/usr/bin/python3 -I -S guardian/startup_verify.py
sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py

git -c safe.directory="$guard01_repo" -C "$guard01_repo" \
  status --short --branch
```

两次启动门都必须为 `startup_verify: OK`，且工作树仍为 `## main`，再重启：

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy

systemctl is-active \
  lykoi-core \
  lykoi-server \
  lykoi-autonomy \
  lykoi-watchdog

for guard01_try in {1..15}; do
  curl -fsS http://127.0.0.1:8080/health && break
  sleep 1
done

curl -fsS http://127.0.0.1:8080/health

systemctl show \
  lykoi-core.service \
  lykoi-server.service \
  lykoi-autonomy.service \
  lykoi-watchdog.service \
  -p Id -p ActiveState -p SubState -p MainPID -p NRestarts

journalctl \
  -u lykoi-core \
  -u lykoi-server \
  -u lykoi-autonomy \
  -u lykoi-watchdog \
  --since '5 minutes ago' \
  --no-pager -p warning
```

## 4. 生产部署验收

- 部署前确认生产 HEAD=`b5cf7553cd9155d90fc0cc5f5b2d6c5a23601f6a`、工作树干净，bundle SHA-256 与完整历史均验证通过。
- 已创建回滚标签 `pre-WO-FIX-GUARD-01-b5cf7553`，生产 merge commit=`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`。
- 权限逐文件复核通过：manifest 与 guardian verifier 为 `root:root 0444`；staged verifier 与 P0 测试为 `lykoi:lykoi 0644`。
- staged/live verifier 逐字节一致，两份 SHA-256 与 manifest 条目均为 `8fe208486a6125a19b0edf991d253fa0c7c0c45f482300d4d0c6460f32227dd1`。
- 合并后、重启前相关回归：`57 passed`；root 与 `lykoi` 两种身份运行启动门均返回 `startup_verify: OK`。
- `systemctl cat` 证明 core/server/autonomy 的有效 unit/drop-in 都以 `User=lykoi` 调用 `/home/lykoi/projects/lykoi/guardian/startup_verify.py`；server/autonomy 的有效覆写使用 `-I -S`。
- 重启后三主体服务与 watchdog 均为 `active/running`，四服务 `NRestarts=0`；health=`status:ok`、`browser_request_guard:ready`。
- 主治理 Agent 独立只读复核：HEAD=`35ef7c86`、工作树 `## main`、启动门 OK、权限与哈希一致、近十分钟四服务 warning 日志为空。

## 5. 回滚

确认 HEAD 是本单 merge commit 后，以 root：

```bash
git -c safe.directory="$guard01_repo" -C "$guard01_repo" \
  revert -m 1 --no-edit HEAD

chown root:root \
  "$guard01_repo/guardian/manifest.sha256" \
  "$guard01_repo/guardian/startup_verify.py"

chmod 0444 \
  "$guard01_repo/guardian/manifest.sha256" \
  "$guard01_repo/guardian/startup_verify.py"

chown lykoi:lykoi \
  "$guard01_repo/scripts/startup_verify.py" \
  "$guard01_repo/tests/test_p0_integrity.py"

chmod 0644 \
  "$guard01_repo/scripts/startup_verify.py" \
  "$guard01_repo/tests/test_p0_integrity.py"

cd "$guard01_repo"
sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py
systemctl restart lykoi-core lykoi-server lykoi-autonomy
```

`pre-WO-FIX-GUARD-01-b5cf7553` 是部署前不可歧义回滚点。
