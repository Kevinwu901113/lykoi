# WO-E4-4 · 部署与网络事实占位符化（E4 第四批）

- 状态：**待派**。执行方：执行子 Agent。复核：主治理 Agent。
- 立单：2026-09-05，主治理 Agent。
- 依据：E4-SPEC §3.3、§2.4、§4 表 E4-4、§6.5（README clone URL 不算实例事实）；审计 A2。
- 基线：WO-E4-2 分支尾（需要实例包加载器）。分支：`wo/e4-4`。
- 包：`profile/`、`deploy/`、`docs/`、`lykoi-organ-browser`（代理取值）、`lykoi-decide`（实例包加载器扩一段）。

## 0 · 执行方入场须知

先读 `governance/wo/EXEC-BRIEF-2026-09-05.md`。本单特别项：

- `profile/*.yml` 与 `gate/surface.ts` 是 root 域，改一字节落地要重签 manifest；本单只改 `profile/cordis.prod.yml` 一处值与注释表。
- 布局约定（`/home/lykoi/...` 四行、`PROD_REPO_ROOT` 等）**保留**，不是实例事实（E4-SPEC §2.4）。

## 1 · 事实

| 位置 | 原文 | 处置 |
|---|---|---|
| `profile/cordis.prod.yml:205` | `proxy: 'http://192.168.0.202:7890'` | 改为从实例包取 |
| `deploy/lykoi-browser.service.template:112`（注释态） | `# IPAddressAllow=192.168.0.202/32` | 占位符 `<BROWSER_PROXY_HOST>/32` |
| `deploy/lykoi-browser.host.json.example:8-9` | `/home/lykoi-browser/profile` | 布局约定，保留 |
| `deploy/lykoi-cordis.service.template:37-41` | `/home/lykoi/...` 四行 | 布局约定，保留 |
| `docs/deploy.md:450`、`docs/browser_organ.md:85,90,253` | 同一内网 IP 作示例 | 改 `192.0.2.10`（RFC 5737） |
| `README.md:99` | clone URL | 保留（§6.5 缺省假设） |
| 实例包 | `loadInstancePackage()`（E4-2） | 本单加 `deploy.toml` 段 `[browser] proxy = "…"` |

## 2 · 决定

- **D-1** `loadInstancePackage` 增读 `deploy.toml`（可选文件）；返回 `deploy: { browser_proxy?: string }`。
- **D-2** `profile/cordis.prod.yml:205` 值改为哨兵 `'instance'`；organ-browser 插件启动时若 `proxy === 'instance'`，从实例包取 `browser_proxy`；取不到 = 启动失败并给出明确错误（不是静默直连）。dev profile（`profile/cordis.yml`）若也有代理值，同法。
- **D-3** 模板与文档改占位符/文档地址。
- **D-4 落地提示**：Kevin 落地前在 `/home/lykoi/runtime/persona/deploy.toml` 写 `[browser] proxy = "<现值>"`；落地脚本 §0 前验要断言该文件存在（写进 report §7）。
- **D-5 测试**：哨兵 + 实例包有值 → 取到；哨兵 + 无值 → 抛且错误文案含 `deploy.toml`；非哨兵 → 原样。

## 3 · 边界

- 不改 `surface.ts`、`policy-core.ts`、`verify.ts`。
- 不改 `deploy/*.template` 的布局约定行。
- 不改 README clone URL。

## 4 · 验收

1. 全绿；新增用例 ≥ 3。
2. `grep -rn "192.168.0.202" .` 归零（除 governance/）。
3. 触及 manifest 域：是（profile root 域 + organ-browser、decide src）。

## 5 · 报告要求

按 brief §4，§7 必含 D-4。
