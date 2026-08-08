# WO-FIX-SEC-03：持久浏览器 page-level CDP 请求拦截

- **执行者**：主治理 Agent（Codex，Kevin 明确要求不使用 Opus/Sonnet）
- **生产基线**：`cf4a63383e07f82294937467329cae37fd61ced0`
- **实施方式**：只在本地隔离 clone 修改；不得直接写生产检出；由 Kevin 以 root 合并部署。

## 目标

关闭 SEC-02 已知的同一 page target 绕过：显式 `navigate()` 通过 guard 后，HTTP redirect、链接点击、表单/JS 导航与 subresource 仍可访问私网地址。

## 实现要求

1. `lykoi-server` 生命周期内维持唯一、常驻的 page CDP websocket；该连接同时负责动作 command 与 `Fetch.requestPaused` 事件。
2. 必须先 `Fetch.enable`，再把 guard 标记为 ready；每个 paused request 复用 `resources.url_guard`，拒绝时 `Fetch.failRequest(AccessDenied)`。
3. 服务启动/重连先把既有页面清为 `about:blank`，避免旧不可信页面在 guard 建立前继续活动；正常 shutdown 也先 blank。
4. guard 未 ready 或连接断开时，所有 persistent-browser 动作 fail closed；后台 supervisor 重连。
5. 用进程锁阻止另一个 Lykoi 进程同时成为持久浏览器 guard owner。
6. 保持 `kernel.dispatch` 是唯一允许 import resources 的模块；surface 只能经 dispatch 管理 guard 生命周期。
7. `/health` 保持 HTTP 200 与 `status=ok`，新增非敏感字段 `browser_request_guard=ready|unavailable`，供部署验收。
8. 测试不得连接活体 `127.0.0.1:9222`；全局测试夹具必须把 guard 生命周期替换成 inert fake，专项用 fake websocket 直接测 guard 类。
9. 更新 `guardian/manifest.sha256`，必跑 `tests/test_p0_integrity.py`。

## 明确不宣称解决

- popup/new page target、worker/service-worker 的跨 target 覆盖；
- 代理侧 DNS 与本机 DNS 不一致、DNS rebinding；
- CDP session 非预期断开到 supervisor 重连之间，既有页面的短暂暴露窗口。

这些属于后续 browser-level target supervisor 或受控出口代理边界，不得在本单报告为“彻底关闭 SSRF”。
