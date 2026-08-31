# WO-FIX-SEC-02 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-08
- **执行 Agent**：服务器 claude 账户，模型 sonnet
- **结论**：**验收通过**（经一轮补正）；**部署需 root**（同 SEC-01）；存在一处**残余风险**，见 §4

## 1. 交付物

提交 `ae2814f` + 补正 `9cccb80`：

| 文件 | 变化 |
| --- | --- |
| `src/lykoi/resources/url_guard.py` | 新增 83 行，导出 `guard` / `UrlBlocked` / `is_forbidden_ip` / `ALLOWED_SCHEMES` |
| `src/lykoi/resources/research_browser.py` | **-76 行**（改为引用共享实现，确认是抽取而非复制） |
| `src/lykoi/resources/browser.py` | +42 行（`navigate()` 接入 guard） |
| `tests/test_url_guard.py` | 新增 136 行 |
| `guardian/manifest.sha256` | 补正时更新（见 §3） |

## 2. 验证（主治理 Agent 实跑）

### 硬判据：未削弱原有防护 ✓

`tests/test_p3_research_browser.py` + `tests/test_url_guard.py`：**31 passed**。research_browser 的既有测试全部继续通过，证明 guard 抽取没有改变其行为。

全套（含完整性与治理不变量）：**66 passed, 5 skipped**。

### 功能性验证：持久浏览器真的被挡住 ✓

直接调用 `browser.navigate()`，六个目标全部抛 `UrlBlocked`，且**均在触达 CDP 之前拒绝**（未碰活体 Chrome）：

    拒绝 [UrlBlocked]: http://127.0.0.1:8080/health     ← surface API 自身
    拒绝 [UrlBlocked]: http://localhost:8080/
    拒绝 [UrlBlocked]: http://192.168.0.202:7890        ← 局域网代理
    拒绝 [UrlBlocked]: http://[::ffff:127.0.0.1]/       ← v6 映射绕过
    拒绝 [UrlBlocked]: file:///etc/passwd
    拒绝 [UrlBlocked]: ftp://example.com/x              ← 协议白名单

无过度拦截：`https://www.example.com/x`、`http://neverssl.com/` 均放行（纯 guard 逻辑测试，未连 CDP）。

### 反向核对 ✓

`COGNITION_DIRS` 六个目录下每个 `.py` 都在 manifest 中有条目，无遗漏。

### 启动门

在临时工作树运行 `startup_verify.py` 报大量 FAIL，**全部是 `not root-owned (uid 1000)` / `writable by group/other` 类的属主假象**（工作树文件本就是 lykoi 属主），**没有任何一条哈希不符**——这才是关键判据。活体环境中这些文件是 root 属主，不会触发。

## 3. 复核发现的缺陷：manifest 未更新（第二次）

初版提交改了 `browser.py`、`research_browser.py` 并**新增** `url_guard.py`，但**完全没动 `guardian/manifest.sha256`**：

- `grep -c url_guard guardian/manifest.sha256` → **0**
- `pytest tests/test_p0_integrity.py` → **1 failed**

`resources/` 属于 `COGNITION_DIRS` 覆盖范围，该目录下任何 `.py` 的新增或修改都必须同步清单。若部署：启动门非零退出 → **三服务全部拒绝启动**。

**这是同类缺陷第二次出现**（SEC-01 是漏更新 `startup_verify.py` 自身条目）。已在补正工单里明确要求把它当结构性纪律，并已写入 `HANDOFF.md` 第四节第 5 条，建议后续所有触及这六个目录的工单模板都默认带上这条要求 + 复核必跑 `test_p0_integrity`。

补正提交 `9cccb80` 后全部转绿。

## 4. 残余风险（如实记录，未解决）

guard 只覆盖 `navigate()` 这一个入口。经查 `kernel/dispatch.py:261 _resolve()`，动作解析受 `KNOWN_ACTIONS` 白名单约束，因此：

- `_evaluate()`（可执行任意 JS，能用 `location.href` 导航）**不可作为动作直达** —— 风险被白名单挡住 ✓
- **`browser.click()` 可以**：点击页面上的链接会触发跳转，**这条路径绕过 guard**。攻击路径是：导航到一个公网页面（合法放行）→ 该页面含指向 `127.0.0.1` 或局域网的链接 → 点击 → 到达内网。在 prompt injection 场景下这是现实可行的。

**当前状态**：主要入口已堵，但"页面自身发起的导航"仍无约束。彻底解法需在 CDP 层做请求拦截（如 `Fetch.enable` 对每个请求施加同一 guard），属于独立工单范围。建议列入阶段 1 尾项或阶段 2。

执行 Agent 的补正报告应对此有进一步结论（原工单 §3 要求），但其 stdout 两次因网络中断未完整产出——本节结论由主治理 Agent 独立排查得出。

## 5. 部署（需 root，Kevin 执行）

**为什么需要 root**：本次改动触及 `guardian/manifest.sha256`（root:root 444）；且 `src/lykoi/resources/browser.py` 在活体是 **root:root 644**。虽然 `resources/` 目录是 lykoi 可写（775），lykoi 合并**能**成功，但会把 browser.py 的属主悄悄改成 lykoi，削弱"服务账户不能篡改源"的性质。**必须以 root 合并。**

记录回滚点：

    ssh lapw1ng.com 'cd ~/projects/lykoi && git rev-parse --short HEAD'

以 root 执行：

    sudo git -c safe.directory=/home/lykoi/projects/lykoi -C /home/lykoi/projects/lykoi merge --no-ff task/wo-fix-sec-02 -m "[WO-FIX-SEC-02] merge: shared SSRF url_guard; persistent browser navigate protected"

还原权限位（新文件 url_guard.py 按安全控制件对待，与 browser.py 同级）：

    sudo chown root:root /home/lykoi/projects/lykoi/src/lykoi/resources/url_guard.py && sudo chmod 644 /home/lykoi/projects/lykoi/src/lykoi/resources/url_guard.py && sudo chmod 444 /home/lykoi/projects/lykoi/guardian/manifest.sha256

验证启动门（**必须以 lykoi 身份**，root 会因 `os.access` 假阳性误报）：

    ssh lapw1ng.com 'cd ~/projects/lykoi && python3 -I -S guardian/startup_verify.py; echo exit=$?'

exit=0 后重启：

    sudo systemctl restart lykoi-server lykoi-autonomy lykoi-core

## 6. 待办

- [ ] 部署（Kevin，需 root）
- [ ] 残余风险：CDP 层请求拦截（§4）——独立工单
- [ ] WO-FIX-P3-01（自主动作 CWD 隔离）工单已就绪待发，部署本单后再派

## 7. 部署结果（2026-08-08，Kevin 以 root 执行）

- 合并提交 `cf314c36`，回滚点 `7b567cec`。
- 权限位符合设计：`url_guard.py` root:root 644、`browser.py` root:root 644、`manifest.sha256` root:root 444。
- 三服务 + watchdog 全部 active，`/health` 200。
- **活体代码功能验证**：`browser.navigate()` 对 `127.0.0.1:8080`、`192.168.0.202:7890`、`file:///etc/passwd` 全部抛 `UrlBlocked`。持久浏览器 SSRF 防护在生产环境生效。
- 事件日志回归正常（SEC-01 的脱敏未受影响）。

阶段 1 安全项 S1 / S2 / S5 至此全部上线。
