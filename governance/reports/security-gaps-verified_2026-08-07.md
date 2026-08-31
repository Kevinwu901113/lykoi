# 已验证安全缺口（2026-08-07）

来源：WO-BASE-02 执行 Agent 初报的三条断言，由主治理 Agent 逐条读码独立验证。**三条全部属实。**

## 缺口 1：事件日志不脱敏【高】

**证据**

- `src/lykoi/shared/log.py` 的 `log_event()` 把 `**fields` 原样 `json.dumps` 写入 `state/events.jsonl`，全函数无脱敏调用。
- `kernel/redaction.py` 提供 `redact()` / `redact_obj()`，但全仓库只有 3 处调用，全部在 `kernel/dispatch.py`（307、648、650 行）——即脱敏只覆盖"返回给认知层的观测结果"，不覆盖磁盘日志。

**影响**：任何经 `log_event` 落盘的字段（dispatch 参数、URL、错误串）若含凭证，明文进 events.jsonl（当前 5.9MB）。该文件同时是白皮书 30.1 点名的 `_TOKEN 脱敏覆盖不完整` 的具体落点。

**修复方向**：`log_event` 内对 fields 走 `redact_obj`；单独评估日志文件权限。

## 缺口 2：持久浏览器无 SSRF 防护【高】

**证据**

- `resources/browser.py` 的 `navigate()` 直接把 `params["url"]` 交给 CDP `Page.navigate`，无任何校验。
- 对照组 `resources/research_browser.py` 有完整 SSRF 防护：仅允许 http/https、要求主机名解析结果**全部**为公网地址、`ip.is_private` 等判断、显式处理 `::ffff:127.0.0.1` v6 映射绕过、guard 在启动 Chrome 前跑且对每次跳转生效。

**影响**：同一套系统里两个浏览器资源防护等级悬殊。持久浏览器可被导向 `127.0.0.1:8080`（surface API 自身）、`file://`、局域网地址。且 Chrome 与核心同用户运行，CDP 在 9222。

**修复方向**：把 research_browser 的 `_guard` 提为共享模块，persistent browser 复用；同时评估 file:// 协议禁用。

## 缺口 3：截图路径未校验【中】

**证据**：`browser.py` 的截图写入使用 `LYKOI_SCREENSHOT_DIR`，未经 `live_guard` 类路径校验（`shared/live_guard.py` 目前只在部分文件操作处调用，如 `log.py` 的 `assert_not_pytest_live_path`）。

**影响**：环境变量被污染时可写任意路径。属白皮书 30.1 "Protected Paths 声明但未被所有资源路径强制"的具体实例。

**修复方向**：统一路径写入闸门，所有资源层写盘走同一校验。

## 处置

三条均属白皮书第 30 章"实施前必须处理"范畴，建议在基线审查收尾后立即排修复工单（缺口 1、2 优先）。
