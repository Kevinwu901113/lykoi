# WO-FIX-SEC-02：持久浏览器 SSRF 防护（S2）

你是 Lykoi 治理平面的执行 Agent。允许修改代码，仅在工单分支，不得合并。

## 现状（已核实）

同一系统里两个浏览器资源，防护等级悬殊：

- `src/lykoi/resources/research_browser.py`：**防护完整**。仅允许 http/https；主机名必须解析结果**全部**为公网地址（任一为私网即整体拒绝）；显式处理 `::ffff:127.0.0.1` 这类 v6 映射绕过；guard 在启动 Chrome 前执行且对每次跳转生效（模块 docstring 第 11–17 行有完整说明）。
- `src/lykoi/resources/browser.py`：**零防护**。`navigate()` 直接把 `params["url"]` 交给 CDP `Page.navigate`。

风险面：持久浏览器与核心同用户运行，CDP 在 127.0.0.1:9222。模型可导航至 `127.0.0.1:8080`（surface API 自身）、`file:///`、局域网地址（含 `192.168.0.202` 代理与家内其他设备）。

## 目标

把已验证的 guard 提为共享实现，持久浏览器复用，**不降低 research_browser 现有防护强度**。

### 要求

1. **抽取而非重写**：把 `research_browser.py` 中的 SSRF guard（含其对 v6 映射、多 A 记录、协议白名单的处理）提取为共享模块（建议 `src/lykoi/resources/url_guard.py`，命名可自定但需说明）。`research_browser` 改为引用共享实现，**行为必须逐字保持**——它现有的单元测试必须全部继续通过，这是"未削弱"的判据。
2. `browser.py` 的 `navigate()` 接入同一 guard。被拒绝时抛出与 research_browser 一致的异常类型，并确保错误经由现有 dispatch 路径变成一条正常的失败观测（而不是未捕获异常崩掉自主循环）——请核实 dispatch 侧如何处理资源异常并说明。
3. **同时检查 browser.py 的其他入口**：不只 `navigate`。逐个列出该模块所有接受 URL 或可触发导航的函数（如 evaluate 执行 JS 里的 `location.href`、点击可能触发跳转等），说明哪些能被 guard 覆盖、哪些覆盖不到（覆盖不到的如实列出，这是有价值的结论，不要假装全覆盖）。
4. **file:// 协议**：确认 guard 是否已排除；若持久浏览器有独立配置允许 file 访问，一并指出。
5. 补测试：至少覆盖 `127.0.0.1`、`localhost`、`192.168.x.x`、`::ffff:127.0.0.1`、`file:///etc/passwd` 五种被拒绝，以及一个正常公网 URL 被放行。测试不得真的发起网络请求（用 mock/monkeypatch 解析函数）。

## 纪律

- 从 main 新建分支 `task/wo-fix-sec-02`，提交前缀 `[WO-FIX-SEC-02]`。
- 禁区：`/home/lykoi/secrets`、`core.sock`、systemd/进程操作、写 `/home/lykoi/state`。
- **不要启动或连接真实 Chrome**（9222 是活体持久浏览器，属活体状态）。测试一律 mock。
- 不得合并到 main。

## 验证要求

1. research_browser 现有测试全部通过（列出测试文件与结果）——这是"未削弱"的硬判据。
2. 新增测试通过。
3. `git diff` 全文。
4. §3 的入口清单（能覆盖/不能覆盖）。
5. 给主治理 Agent 的实跑检查点 3-5 条。

## 输出要求

**不要写报告文件；stdout 即报告。**第一行 `# WO-FIX-SEC-02 执行报告`。禁止对话性语句，禁止用摘要代替明细。
