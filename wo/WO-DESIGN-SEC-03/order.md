# WO-DESIGN-SEC-03：持久浏览器 CDP 请求拦截设计审查

你是 Lykoi 治理平面的**只读分析 Agent**。本单只做设计审查，不改代码、不建分支、不提交。

## 背景与已核实事实

生产基线为 `main@cf4a63383e07f82294937467329cae37fd61ced0`。

`WO-FIX-SEC-02` 已把共享 `url_guard.guard()` 接入 `resources/browser.py:navigate()`，能在 `Page.navigate` 前拒绝私网字面地址、危险 scheme 和本地解析到非公网地址的主机名。但残余路径仍存在：

- `browser.click()` 可点击链接或提交表单；
- `browser.type()` 会触发页面自己的 `input` / `change` 监听器；
- 公网页面可用 HTTP redirect、meta refresh、JS timer/location、iframe/subresource、worker/service worker、popup/new target 等方式发起后续请求；
- 当前 `browser._cdp()` 每个动作建立一个短生命周期 page websocket，收到对应 command response 后即关闭；没有常驻 reader，也没有启用 `Fetch` domain；
- `browser._evaluate()` 不在 `kernel.dispatch.KNOWN_ACTIONS`，不能作为模型动作直达，但 `browser.click/type/navigate/get_text/screenshot` 均在白名单；自主 origin 当前明确 deny `browser.click`，interactive/system 不受该 profile 限制，因此风险不是纯理论代码死角。

生产 `lykoi-chrome.service` 的真实启动参数含：

```text
--proxy-server=http://192.168.0.202:7890
--remote-debugging-port=9222
--remote-debugging-address=127.0.0.1
--disable-popup-blocking
```

共享 guard 的默认 `proxy_env_var` 是 `LYKOI_RESEARCH_PROXY`：该变量非空时，主机名不在本机解析，只有字面 IP 继续分类。**不得读取该环境变量的真实值或任何 secrets**；设计必须把“代理 DNS 语义未知/可能与本机解析不同”列为独立风险，不得把 URL 字符串 guard 宣称为 DNS rebinding 的完整解法。

官方 CDP 语义参考（可按下列事实分析，无需联网）：

- `Fetch.enable` 让匹配请求产生 `Fetch.requestPaused`；请求会一直暂停，直到 client `continueRequest` / `failRequest` / `fulfillRequest`；重定向后的新请求也会再次报告：<https://chromedevtools.github.io/devtools-protocol/tot/Fetch/>
- `Target.setAutoAttach` 只自动 attach 与当前 target 直接相关的 target，并提示需要递归调用才能覆盖全部相关 target：<https://chromedevtools.github.io/devtools-protocol/tot/Target/>
- `Network.Response.remoteIPAddress` 只有建立传输并收到响应时才知道，不能充当前置阻断：<https://chromedevtools.github.io/devtools-protocol/tot/Network/>

## 本单核心问题

找出在**不触碰活体 Chrome、不扩大 Lykoi authority**前提下，覆盖持久页面后续导航与请求的最小可靠架构。不能只回答“在每次 `_cdp()` 里调用 `Fetch.enable`”；必须证明拦截的 session/target/lifecycle 覆盖了攻击窗口，或明确证明该方案不成立。

## 必须完成的分析

### 1. 当前生命周期与攻击面

从 `kernel.dispatch` 到 `resources/browser.py` 逐条画出 `navigate/get_text/click/type/screenshot` 的调用与 websocket 生命周期，并列出下列请求能否绕过当前 guard：

1. `Page.navigate` 的 HTTP 30x；
2. 点击链接、表单提交；
3. `input/change` handler 与 `setTimeout(location=...)`；
4. meta refresh；
5. iframe、图片/script/fetch/XHR 等 subresource；
6. popup/new page target；
7. dedicated/shared worker、service worker；
8. WebSocket/EventSource；
9. 页面在最后一个 Lykoi 动作结束、CDP websocket 已关闭后才发起的请求。

每项标注：当前是否受控、`Fetch` page session 是否足够、是否需要 browser-level target 管理、已知不确定性。

### 2. 候选架构比较

至少比较：

- A：每个动作临时连接内启用 `Fetch`；
- B：`browser.py` 所在进程内维持 page-level 常驻 guard session；
- C：browser-level CDP session + target discover/auto-attach + 每 target 启用 `Fetch`；
- D：独立 sidecar / 受控出口代理等进程外网络边界。

逐项评价：覆盖窗口、target 覆盖、断线语义、并发/多进程冲突、Chrome 重启恢复、实现复杂度、测试性、是否需要改 systemd/root、是否符合白皮书 authority 边界。

### 3. 推荐方案

给出**一个**阶段 1 可实施的推荐方案，并写清：

- 拦截器由谁拥有、何时建立、何时视为 ready；
- CDP/Chrome 重连、target 新建/销毁、reader task 崩溃时如何恢复；
- guard 不健康时 browser 动作如何 fail closed；已加载页面是否仍可能自行联网，如何处理；
- 多个 Lykoi 进程同时 import `browser.py` 时如何避免重复拦截器或互相等待同一 request；
- `Fetch.requestPaused` handler 的超时、异常与 pending request 清理；
- popup/worker/service-worker/WebSocket 的明确覆盖或残余风险；
- 代理 DNS、DNS rebinding、`remoteIPAddress` 只能事后得知的残余风险；
- 是否需要收紧 Chrome 启动参数（例如 popup）——如需 systemd 改动，必须作为 owner/root 单独步骤，不得悄悄并入普通代码部署。

如果阶段 1 无法仅靠当前进程内 CDP 达到可信的持续拦截，必须直说，并给出“可上线的风险降低版”与“完整边界版”两层方案，不能假装完全关闭。

### 4. 实现工单草案

为后续 `WO-FIX-SEC-03` 提供可直接复制的实现范围：

- 预计修改/新增文件；
- 不变量与 fail-closed 判据；
- network-free 单元测试矩阵；
- 可选的 disposable Chrome 集成测试（必须是全新临时 profile/随机 CDP 端口，**绝不连接 127.0.0.1:9222**）；
- 必跑回归：`tests/test_url_guard.py`、`tests/test_p3_research_browser.py`、`tests/test_governance_invariants.py`、`tests/test_p0_integrity.py`；
- `resources/` 任一 `.py` 改动必须同步 `guardian/manifest.sha256`；
- 部署权限、启动门、服务重启与回滚点要求。

## 禁区

- 不得 Edit/Write 代码或文档，不得创建分支/提交。
- 不得连接、查询或操控活体 Chrome/CDP `127.0.0.1:9222`。
- 不得启动 Chrome，不得发真实网络请求；只读源码分析。
- 不得读取 `/home/lykoi/secrets`、进程环境、`core.sock` 或 `/home/lykoi/state` 内容。
- 不得运行 systemctl、不得改 unit/drop-in、不得重启服务。
- 不得建议用“连接后看 remoteIPAddress 再决定”替代前置阻断。

## 输出要求

stdout 即报告，不写文件。第一行必须是：

```text
# WO-DESIGN-SEC-03 分析报告
```

报告必须包含：结论先行、当前生命周期、威胁矩阵、候选比较、推荐架构、fail-closed/恢复语义、代理 DNS 残余风险、后续实现工单草案、逐项证据（文件与行号）。未验证处明确写“未验证”，不得把推断写成事实。
