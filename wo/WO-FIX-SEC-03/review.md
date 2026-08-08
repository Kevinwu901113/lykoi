# WO-FIX-SEC-03 复核与部署记录

- **复核人/实现者**：主治理 Agent（Codex；按 owner 指示直接实现）
- **日期**：2026-08-09
- **候选提交**：`4bcca714d48c975e2f9c793ec243361bc5474cb2`
- **结论**：**验收通过，待 Kevin root 部署**

## 1. 验收结论

- [x] 同一 page target 的 redirect / click / form / JS navigation / subresource 进入 `Fetch.requestPaused` 后复用共享 guard。
- [x] `Fetch.enable` 与 stale-page blank 完成后才 ready；未 ready 时 browser 动作 fail closed。
- [x] 单进程锁阻止 server/autonomy 两个进程同时拥有 guard。
- [x] surface 没有越过 dispatch 直接 import resources；`KNOWN_ACTIONS` 未扩大。
- [x] 测试不会连接活体 9222。
- [x] browser / dispatch / surface 的 manifest 哈希同步，P0 通过。
- [x] `/health` 可返回 `browser_request_guard=ready|unavailable`，且不改变 `status=ok` 与 HTTP 200。
- [ ] 生产合并、启动门、重启及活体 health ready 验证。

## 2. 不在本单覆盖范围

本单不宣称完整关闭 SSRF：page-level CDP session 不覆盖新 popup/worker target；代理侧 DNS 解析无法由 URL 字符串 guard 证明；CDP 非预期断线后到重连/blank 之间仍有短窗口。下一阶段应在 browser-level target supervisor 与受控出口代理之间做架构选择。

## 3. 部署前提

- 生产 HEAD 必须仍是 `cf4a63383e07f82294937467329cae37fd61ced0`，工作树必须干净。
- Bundle 哈希必须是 `626fdcd8129805b39dc9eba383cd9b1bf2a2c66e6327a7f7d18fae1c873f87ff`。
- 本次触及 guardian manifest 与 root-owned browser/dispatch，必须由 Kevin 以 root 合并；不得普通用户 merge 后递归 chown。
- 重启 `lykoi-server` 时，持久浏览器当前页面会主动清成 `about:blank`。

## 4. Kevin root 部署命令

先在 root shell 设置变量并核对：

```bash
sec03_repo=/home/lykoi/projects/lykoi
sec03_bundle=/tmp/WO-FIX-SEC-03-4bcca71.bundle

git -c safe.directory="$sec03_repo" -C "$sec03_repo" rev-parse HEAD
git -c safe.directory="$sec03_repo" -C "$sec03_repo" status --short --branch
sha256sum "$sec03_bundle"
git -c safe.directory="$sec03_repo" -C "$sec03_repo" bundle verify "$sec03_bundle"
```

期望 HEAD=`cf4a63383e07f82294937467329cae37fd61ced0`、`## main`、上述 bundle 哈希一致。

创建回滚点、获取分支并合并：

```bash
git -c safe.directory="$sec03_repo" -C "$sec03_repo" \
  tag pre-WO-FIX-SEC-03-cf4a6338 cf4a63383e07f82294937467329cae37fd61ced0

git -c safe.directory="$sec03_repo" -C "$sec03_repo" fetch \
  "$sec03_bundle" \
  task/wo-fix-sec-03-direct:refs/heads/task/wo-fix-sec-03

git -c safe.directory="$sec03_repo" -C "$sec03_repo" merge \
  --no-ff task/wo-fix-sec-03 \
  -m "[WO-FIX-SEC-03] merge: persistent page-level CDP request guard"
```

逐文件恢复生产权限：

```bash
chown root:root \
  "$sec03_repo/guardian/manifest.sha256" \
  "$sec03_repo/src/lykoi/resources/browser.py" \
  "$sec03_repo/src/lykoi/kernel/dispatch.py"

chmod 0444 "$sec03_repo/guardian/manifest.sha256"
chmod 0644 \
  "$sec03_repo/src/lykoi/resources/browser.py" \
  "$sec03_repo/src/lykoi/kernel/dispatch.py"

chown lykoi:lykoi \
  "$sec03_repo/src/lykoi/surface/app.py" \
  "$sec03_repo/tests/conftest.py" \
  "$sec03_repo/tests/test_browser_cdp_guard.py"

chmod 0644 \
  "$sec03_repo/src/lykoi/surface/app.py" \
  "$sec03_repo/tests/conftest.py" \
  "$sec03_repo/tests/test_browser_cdp_guard.py"
```

合并后、重启前，以 `lykoi` 身份验证：

```bash
cd "$sec03_repo"

sudo -u lykoi env PYTHONDONTWRITEBYTECODE=1 \
  "$sec03_repo/.venv/bin/python" -m pytest -q -p no:cacheprovider \
  tests/test_browser_cdp_guard.py \
  tests/test_url_guard.py \
  tests/test_p3_research_browser.py \
  tests/test_governance_invariants.py \
  tests/test_terminal_workspace.py \
  tests/test_p0_integrity.py

sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py
```

两步均成功后重启并验收：

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy

systemctl is-active \
  lykoi-core \
  lykoi-server \
  lykoi-autonomy \
  lykoi-watchdog

for sec03_try in {1..15}; do
  curl -fsS http://127.0.0.1:8080/health && break
  sleep 1
done

curl -fsS http://127.0.0.1:8080/health

stat -c '%U:%G %a %n' \
  /home/lykoi/runtime/browser-guard.lock

journalctl \
  -u lykoi-core \
  -u lykoi-server \
  -u lykoi-autonomy \
  -u lykoi-watchdog \
  --since '5 minutes ago' \
  --no-pager -p warning

git -c safe.directory="$sec03_repo" -C "$sec03_repo" \
  status --short --branch
```

期望四个 `active`、health JSON 含 `"status":"ok"` 与 `"browser_request_guard":"ready"`、lock 为 `lykoi:lykoi`、无 warning、工作树 `## main`。

## 5. 回滚

确认 HEAD 是本次 merge commit 后，以 root 创建反向提交并恢复权限：

```bash
git -c safe.directory="$sec03_repo" -C "$sec03_repo" \
  revert -m 1 --no-edit HEAD

chown root:root \
  "$sec03_repo/guardian/manifest.sha256" \
  "$sec03_repo/src/lykoi/resources/browser.py" \
  "$sec03_repo/src/lykoi/kernel/dispatch.py"

chmod 0444 "$sec03_repo/guardian/manifest.sha256"
chmod 0644 \
  "$sec03_repo/src/lykoi/resources/browser.py" \
  "$sec03_repo/src/lykoi/kernel/dispatch.py"

chown lykoi:lykoi \
  "$sec03_repo/src/lykoi/surface/app.py" \
  "$sec03_repo/tests/conftest.py"

chmod 0644 \
  "$sec03_repo/src/lykoi/surface/app.py" \
  "$sec03_repo/tests/conftest.py"

cd "$sec03_repo"
sudo -u lykoi /usr/bin/python3 -I -S guardian/startup_verify.py
systemctl restart lykoi-core lykoi-server lykoi-autonomy
```

`pre-WO-FIX-SEC-03-cf4a6338` 是部署前不可歧义回滚点；不要用递归 chown。
