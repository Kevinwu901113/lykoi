# WO-FIX-SEC-03 直接实现报告

- **日期**：2026-08-09
- **执行者**：主治理 Agent（Codex；owner 指示不使用 Opus/Sonnet）
- **基线**：`cf4a63383e07f82294937467329cae37fd61ced0`
- **候选提交**：`4bcca714d48c975e2f9c793ec243361bc5474cb2`
- **结论**：代码与相关回归验收通过；尚未部署生产。

## 1. 改动

| 文件 | 结果 |
| --- | --- |
| `src/lykoi/resources/browser.py` | 新增常驻 page-level CDP guard、Fetch request handler、重连 supervisor、进程锁、fail-closed 动作门、启动/关闭 blank、ready 状态 |
| `src/lykoi/kernel/dispatch.py` | 在唯一资源网关内提供 guard 生命周期与 ready 状态包装，不扩大 `KNOWN_ACTIONS` |
| `src/lykoi/surface/app.py` | lifespan 经 dispatch 启停 guard；`/health` 增加 `browser_request_guard` 字段 |
| `tests/conftest.py` | guard lock 指向临时目录；所有非专项测试替换 guard 启停，防止连接活体 9222 |
| `tests/test_browser_cdp_guard.py` | 新增 7 项 network-free 测试：私网拒绝、公网继续、事件/command 解复用、Fetch-before-ready、fail closed、进程锁、health 状态 |
| `guardian/manifest.sha256` | 同步 browser / dispatch / surface 三个 protected source 哈希 |

## 2. 自我复核抓到并修正的问题

1. 初版让 `surface/app.py` 直接 import resources，触发 `test_only_dispatch_imports_resources`；已把生命周期入口收回 `kernel.dispatch`，未放宽不变量。
2. 初版 autouse fixture 依赖 pytest `monkeypatch`，改变 teardown 顺序，导致两项 registrar 清理测试报错；已改为手工保存/恢复 browser 生命周期函数，两项在候选上转绿。
3. shutdown blank 最初可能等待 CDP 默认 30 秒；已加 2 秒外层上限，超时后继续 fail-safe shutdown。
4. 初版首次 ready 没有治理账户可见的活体验收点；已加入 `/health` 非敏感状态字段。

## 3. 测试

最终独立 clone `/tmp/lykoi-sec03-final-4bcca71`，以 `lykoi` 身份、生产 venv、`PYTHONDONTWRITEBYTECODE=1`、禁用 pytest cache：

- SEC-03 + URL guard + research browser + governance invariants + terminal + P0：**83 passed, 5 skipped**。
- surface / lifespan / runtime 相关回归：**99 passed, 1 skipped**。
- P0 单独结果已包含于首组；此前单独运行：**20 passed, 4 skipped**。
- 全量：**1433 passed, 6 skipped, 20 failed**。失败进一步隔离后：
  - 18 项由跨用户 worktree 的 `.git` 不可达或 server `umask 0002` 把既有 executable checkout 为 0775 引起；独立 clone + 恢复既有脚本 0755 后全部通过。
  - 剩余 2 项均因测试仍 monkeypatch 已不存在的 `redaction._SECRETS`；在未修改的 `cf4a6338` 独立基线 clone 完全同样失败，确认不是本单回归。

不宣称“原始环境下全量全绿”；本单相关代码路径与治理硬门均通过。

## 4. 交付

- Bundle：`/tmp/WO-FIX-SEC-03-4bcca71.bundle`
- SHA-256：`626fdcd8129805b39dc9eba383cd9b1bf2a2c66e6327a7f7d18fae1c873f87ff`
- Bundle：完整历史，ref `task/wo-fix-sec-03-direct` → `4bcca714d48c975e2f9c793ec243361bc5474cb2`

## 5. 残余风险

本单是 page-level 风险降低，不是完整浏览器网络沙箱。popup/new target、worker/service-worker、代理 DNS/DNS rebinding、CDP 断线重连间隙仍需后续 browser-level supervisor 或出口代理控制。生产 Chrome 固定使用 `192.168.0.202:7890`；代码没有读取或修改 secrets，也没有改 systemd。
