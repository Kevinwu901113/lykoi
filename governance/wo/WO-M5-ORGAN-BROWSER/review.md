# WO-M5-ORGAN-BROWSER · 治理复核

- 复核人：主治理 Agent（Fable 5.1）
- 日期：2026-09-02
- 执行分支：`wo/m5-organ-browser`
- 首轮 tip：`1c249d6bc5961fe3015b71b8d60baacf25808ee7`（基线 `bae1917`，6 提交）
- 修订轮 tip：`0006e75`（修订轮 5 提交：8646653 R-1/R-3、790a7ee R-2、d577560 报告、5ffb7ef 订正、0006e75 R-4）
- 结论：**PASS（经一轮修订）**，交 Kevin 裁合；落地走 LANDING-H（root）。
- Kevin 裁决（2026-09-02）：R-4 的 v4-mapped v6 九段 Deny **保留**（「可以保留」）。合并待 Kevin。

## 0 · 一句话

三个只读动作接上了真身，四道 fail-closed（SSRF / 下载 / 出域 / 不可信标记）在代码里各有红测；复核发现宿主的 OS 隔离方向写反、出域跳转只在导航后查，修订轮已改，其余按单。

## 1 · 边界与不动清单（独立核对）

| 项 | 结果 |
|---|---|
| 变更文件是否越出 §3 交付清单 | 否。25 文件，全部落在 `packages/lykoi-organ-browser/`、`profile/`、`package-lock.json`、`deploy/`、`docs/`、`governance/reports/runbook_disaster_recovery.md`、本单目录 |
| D-10 不动清单 sha | `policy-core.ts` 84aa6f57…、`converse/src/contract.ts` 6c48cefa…、`decide/src/index.ts` 5223f432… 三者与基线逐字一致 |
| `prod.yml` | 64271cf0… → 9e5f7972…，+18 行，只加 browser 位（置于 converse/wake 之前） |
| 新依赖 | 仅 `playwright-core 1.60.0`（精确钉）；零传递依赖、零 install 脚本，`npm ci --ignore-scripts` 纪律不破 |
| 新包 src 内 `process.env` | 零（只有注释提到 GK-6） |
| `lykoi-adapter-telegram/resources` 子路径导出 | 存在（`package.json` exports `./resources`） |
| manifest 影响 | 106 → 113（package.json + 6 src），落地重签 |
| 独立复跑（首轮 tip） | `npx tsc --noEmit` exit 0；`npm test` exit 0，988 / 977 / 0 / 11（新增 59 全在本包） |
| 独立复跑（修订轮 tip 0006e75） | `npx tsc --noEmit` exit 0；`npm test` exit 0，995 / 984 / 0 / 11；本包 66 条；smoke 在 Mac Chrome 152 上 ran。与执行方报告一致 |
| 修订轮 diff | 11 文件，+998 / −61，仍全部在本单目录与 D-10 之外 |

## 2 · D-1 … D-10 对照

| 定案 | 对照结果 |
|---|---|
| D-1 三动作、`research_browser.open` 不接、注销幂等、宿主不可达 2s 内返回 | 符合（plugin.test 六条） |
| D-2 三种返回的 data 键集 | 符合，逐字对表测试在位；`ok:false` 时 `error`/`detail` |
| D-3 调研一次性上下文 | 符合。`chromium.launch()` 另起进程 + `newContext()`，finally 关闭；SSRF 拦下时根本不开 |
| D-4 出域跳转中止 | 首轮：只在 `goto` 后按 final_url 判（合单文字）。复核判定不够：跳转目标页已被持久 profile 加载过一次（cookie 已发、页面 JS 已跑）才丢弃。修订轮 R-2 加请求层拦截，导航后判定保留为第二道。实证结论见 §4 |
| D-5① SSRF | 符合。scheme/端口/IP 字面量/黑名单主机/单标签/dns.lookup 全地址对私网段（含 mapped/compatible/6to4/Teredo）；解析器只经构造函数注入；子请求同判 |
| D-5② 下载 | 符合。两处上下文 `acceptDownloads:false` + `download.cancel()`，有静态断言 |
| D-5③ 不可信标记 | 符合。首行常量 + `untrusted:true` 结构位 |
| D-5④ 上限 | 符合。20000 缺省 / 60000 硬顶，按码点截断 |
| D-6 审计摘要 | 符合。`browser_action` 六字段，域名只到 eTLD+1，零正文。gate 的词汇门 V2 只查与 immutable 三名的碰撞，新名无冲突 |
| D-7 独立 OS 用户 + unit + socket + 零 env | **首轮不符**（见 §3 R-1）；修订轮改为 systemd 挂载命名空间方案。零 env 符合（unit 无 Environment=，宿主零 env 读取，`--config` 传路径） |
| D-8 备份文档 | 文字在位；但「第 13 项进日备份集」与事实不符（日备份以 lykoi 身份跑，读不到 700 的 profile），修订轮 R-3 改为手工项 |
| D-9 yml 位次 | 符合。assembly.test 有正反两条（顺序反了清单看不见） |
| D-10 不动清单 | 符合（§1 sha） |

## 3 · 复核发现（修订轮处理）

**R-1 隔离方向反了（必须修）**。首轮 docs §2 ② `usermod -aG lykoi lykoi-browser` + unit `SupplementaryGroups=lykoi`，目的是让 socket（0660 组 lykoi）能被大脑连上。副作用：Chrome 进程带 lykoi 组，可穿越 `/home/lykoi`（750 lykoi:lykoi），读到其下所有组可读目录 —— 服务器实核：`.config/ .claude/ .codex/ reports/ runtime/browser-artifacts/（旧 cookie）state/backups/（DB 备份）` 均为 775/755。与 unit 自己的注释「lykoi-browser 读不到 /home/lykoi 的任何东西」矛盾。服务器无 `setfacl`（acl 未装）。改法：`ProtectHome=tmpfs` + `BindPaths=/home/lykoi-browser` + `BindReadOnlyPaths=/home/lykoi/projects/lykoi-cordis:/opt/lykoi-browser/tree`，ExecStart 走 `/opt/lykoi-browser/tree/...`，删 `SupplementaryGroups`；socket 属组保持 `lykoi-browser`，改为**大脑**入 `lykoi-browser` 组（`usermod -aG lykoi-browser lykoi`，重启后生效），家目录强制 700。

**R-2 出域跳转要在请求层拦**。见 §2 D-4 行。要求执行方在真 Chrome 上实证（本机两跳，断言出域端计数为 0），若 Playwright 的 route 对跳转 hop 不回调则记录实证并保留导航后判定。

**R-3 备份文档措辞**。见 §2 D-8 行。

**R-4 内核层封口（R-2 实证否定后追加）**。R-2 实证出的缺口比预期锋利：Chromium 上 `context.route` 不为重定向 hop 回调，所以 D-5① 的判定器对「经 302 抵达私网地址」这一形态失效 —— 实测 302 → 私网的请求确实发出（响应回不到她手里）。封口放在 systemd 的 cgroup eBPF 防火墙：unit 加 `IPAddressDeny=` 13 段私网/保留段（另加 v4-mapped v6 9 段）+ `IPAddressAllow=127.0.0.53/32 127.0.0.1/32`（DNS 存根与 screencast 隧道入口），代理开启时另加一行。它对整个 cgroup（含 Chrome 全部子进程、WS、SW）在 `connect()` 时判最终 IP，与 URL 怎么来的无关。systemd 语义 Allow 优先于 Deny，执行方核对 `systemd.resource-control(5)` 后去掉了我写顺手的 `IPAddressAllow=0.0.0.0/0`。**两条必须带进 LANDING-H**：① 该防火墙装不上时 systemd 只记警告、单元照常起（fail open），docs §2 前验给了 `systemd-run` 正反两条探针，起服务后还要查 journal 无 "ip firewall" 失败行；② 「302 → 私网落 `navigation_failed`」本轮无法在 Mac 实证，要在服务器走一次 `research_browser.read_text` 验证。

**沙箱可用性（已实核，不必改代码）**。unit 带 `NoNewPrivileges=true`，Chrome 的 SUID 助手在其下不可用；但服务器 `/etc/apparmor.d/chrome` 为 `profile chrome /opt/google/chrome/chrome flags=(unconfined) { userns, }`，`apparmor_restrict_unprivileged_userns=1` 下命名空间沙箱因此可建。实测（claude 账号）`setpriv --no-new-privs /usr/bin/google-chrome --headless=new --no-first-run --disable-gpu --user-data-dir=<tmp> --dump-dom about:blank` exit 0 正常出 DOM。该探针写进 docs §2 前验；探针失败时禁止 `--no-sandbox`。

## 4 · 修订轮结果

| 项 | 结果 |
|---|---|
| R-1 | 已修。unit：`ProtectHome=tmpfs` + `BindPaths=/home/lykoi-browser` + `BindReadOnlyPaths=…:/opt/lykoi-browser/tree`，ExecStart 走挂载点，无 `SupplementaryGroups`；执行方顺带删了 `ReadWritePaths=/home/lykoi-browser`（tmpfs 之下只有 BindPaths 能打洞，留着是误导）—— 接受。docs §2：家目录 700、`/opt/lykoi-browser/tree` 挂载点、`usermod -aG lykoi-browser lykoi`、沙箱探针前验。产线树复核：`find` 无一文件/目录对 other 不可读，bind 只读挂载可行 |
| R-2 | 代码已做（`RequestInfo{url,isNavigation,redirectedFrom}` + `#requestedUrl`），**实证否定**：真 Chrome 上 `A -302-> B` 只回调一次 route（A），B 只在只读 `on('request')` 出现。smoke ⑥⑦ 写成倒挂断言（backend 行为改善时会红）。请求层的门保留。§4 第 1 条原文「每一跳重定向同样判定」改为「每个子请求」 |
| R-3 | 已修。runbook / deploy.md / browser_organ.md §6 三处同步为手工项 |
| R-4 | 已做，服务器实证待 LANDING-H。执行方主动加了 v4-mapped v6 段与 `systemd-analyze verify` 步、故障表两行 —— 接受（BPF 按地址族查表，判定器已有同形态分支；写法错时 verify 当场报）。探针目标改为代理 `192.168.0.202:7890`（对照组要一个确实应答的目标）—— 接受 |
| 复跑 | tsc 净；995 / 984 / 0 / 11（首轮 988/977/0/11，+7 全在本包） |

## 5 · 张力与遗留（不阻塞裁合）

1. **`research_browser.*` 在 `AUTONOMOUS_ALLOWED` 里**（派工时已向 Kevin 说明）：她自主调研走 `research_browser.read_text` 时，审批门第 ④ 步 autonomous 放行早于第 ⑧ 步逐域审批，不会逐域问。SSRF 判定因此是她独自上网的唯一硬边界。要改口是 policy-core 的单。
2. **DNS rebinding TOCTOU 与 WS/SW 不经 route**：这两条在用户态都成立（判定时与连接时是两次 lookup；Playwright 路由不覆盖 WebSocket 与 Service Worker）。R-4 之后它们都落在 cgroup 防火墙的 `connect()` 判定之下，用户态判定器退为第一道（拒得早、给 reason）。前提是防火墙确实装上（fail-open，见 §3 R-4）。
3. **Playwright 重定向 hop 不可拦**是实证事实（R-2）；若要在用户态拦，唯一路径是 `route.fetch({maxRedirects:0})` + `fulfill`，但那会把请求挪到驱动进程、换掉 Chrome 网络栈（代理/TLS/cookie 语义全换），是新安全面。M5 总盘另立单，v1 不做。
4. **screencast 只绑 127.0.0.1 但未鉴权**：同机任何用户（root/lykoi/claude）都能看画面。三个账号都是 Kevin 的，接受；写进 docs §5。
5. **第 13 项备份是手工项**：纳入日备份要一个 root 身份的独立定时器（宿主 stop → tar → start）。M5 后续。
6. 执行方报告的六条张力照收：注册表住在 telegram adapter 包里；`BodySchemaRegistry` 与 `registerOrganHandler` 双真源；D-9 靠顺序；research 自主放行使 SSRF 成为治理边界；profile = 登录凭据入备份；Mac smoke 用的 Chrome 152 与服务器 148 不同版 —— LANDING-H 后在服务器复跑 smoke 六步。
7. `docs/m3_schema_registry.md:15-18` 措辞（清单在 converse/wake apply 时快照，不随注册失效）与 M5 总盘三项（注册表迁出 adapter、切 `registryActionCatalog`、注册时失效清单）继续挂账。

## 6 · LANDING-H 要点（脚本另出）

- 大脑 `systemctl stop`（保持 enabled）；watchdog timer 先停。
- 前验：沙箱探针（setpriv --no-new-privs）；出网闸正反两条 `systemd-run` 探针。任一失败即停，不改 `--no-sandbox`、不「反正还有判定器」。
- root：`useradd --system` lykoi-browser、家目录 700、`profile/ data/` 700、`/etc/lykoi-browser/host.json`（root 644）、`/opt/lykoi-browser/{,tree}` 挂载点、`usermod -aG lykoi-browser lykoi`、装 unit、`systemd-analyze verify`、daemon-reload。
- 树落地后 `sudo -u lykoi npm ci --ignore-scripts` **先于** chown root；重签 manifest 期望 113；gate exit 0。
- 起宿主 → journal 无 "ip firewall" 失败行 → health 往返 → 起大脑（带新组）→ 审计见 `browser_organ_wired` → 清单三项 → 服务器 Chrome 148 复跑 smoke 六步 → 302 → 私网走一次 `research_browser.read_text` 确认 `navigation_failed`（R-4 实证）。
- 记账：`governance-ops.jsonl` 一行 `landing-h-m5-browser`。
