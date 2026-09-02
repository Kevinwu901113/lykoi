# WO-M5-ORGAN-BROWSER · 浏览器器官 v1 · 执行报告

- 执行：opus 子 Agent，隔离 worktree `/Users/wukevin/Documents/lykoi/wt-m5-organ-browser`，
  分支 `wo/m5-organ-browser`。
- 基线：`origin/main` = `bae1917`（派工单 §1 写的基线是 `17bfbb7`；开工时 fetch 到的
  origin/main 已是 `bae1917`，本单从 `bae1917` 起分支。基线实测 **929/918/0/11**、tsc 净，
  与派工单给的数一致）。
- 执行尖：**分支 `wo/m5-organ-browser` 的尖 = 本报告所在的第六个提交**
  （`git rev-parse wo/m5-organ-browser`；报告是最后一个提交，文本内无法自指其 sha ——
  可验证的定位是：尖 = 提交⑤ `49842ba` 的唯一子提交）。六个提交，未合并、未推 main。
- 完成度：§3 七项交付物齐全；全仓 `npm test` 零 fail，`npx tsc --noEmit` 净；
  smoke **ran（真 Chrome，本机 Mac）**。

## 1 · 提交（六个，顺序按 §4）

| # | sha | 内容 |
|---|---|---|
| ① | `05a5fbf` | 包骨架 + 协议 + SSRF 纯函数判定器与红测表 |
| ② | `5092835` | driver + 宿主进程：三动作、上下文隔离、四道加固（playwright-core 依赖与 lockfile 在此） |
| ③ | `1927915` | 大脑侧插件：三动作真身上身、身体图式登记、假宿主往返测试 |
| ④ | `770d2af` | 装配：prod.yml 器官位（在 converse/wake 之前）+ profile 依赖 + lockfile |
| ⑤ | `49842ba` | 部署模板 + 运行手册 + 两处备份段 |
| ⑥ | 尖（= `49842ba` 的子提交） | smoke 测试（真 Chrome）+ 本报告 |

**与 §4 的一处偏离**：`playwright-core` 依赖 + lockfile 落在 ②而不是④。原因是
`src/driver.ts` 直接 import 它，而纪律要求"每提交 tsc 净" —— 依赖晚于 import 落地则
②③两个提交都不可能过 tsc。④仍然承担装配面（yml / profile 依赖 / lockfile 第二次改动）。

## 2 · 改动文件全表（`git diff origin/main --stat`，23 + 1 = 24 项）

| 文件 | 行 | 说明 |
|---|---|---|
| `packages/lykoi-organ-browser/package.json` | +29 | 新包（private、type module、exports 指 src/*.ts） |
| `packages/lykoi-organ-browser/src/protocol.ts` | +168 | op / 消息类型 / 错误码 / 时间预算 / NDJSON 编解码；零 I/O |
| `packages/lykoi-organ-browser/src/ssrf.ts` | +338 | 纯函数判定器 + 构造函数注入的解析器 |
| `packages/lykoi-organ-browser/src/untrusted.ts` | +95 | `UNTRUSTED_MARKER` + 包装 + 截断 |
| `packages/lykoi-organ-browser/src/driver.ts` | +659 | backend 抽象 + 纯策略（上半） / Playwright 实现（下半，唯一 import playwright-core 处） |
| `packages/lykoi-organ-browser/src/host.ts` | +434 | 宿主守护进程入口：`--config`、Unix socket、NDJSON、串行、截图清理、screencast |
| `packages/lykoi-organ-browser/src/index.ts` | +289 | Cordis 插件 + 宿主客户端 + 三个动作 handler |
| `packages/lykoi-organ-browser/test/fake-backend.ts` | +143 | 夹具（非 .test.ts）：假 backend / 假站点表 / 表解析器 |
| `packages/lykoi-organ-browser/test/ssrf.test.ts` | +246 | 红测表 |
| `packages/lykoi-organ-browser/test/untrusted.test.ts` | +118 | 标记 / 截断 |
| `packages/lykoi-organ-browser/test/redirect.test.ts` | +110 | 出域跳转 |
| `packages/lykoi-organ-browser/test/download.test.ts` | +99 | 下载隔离 |
| `packages/lykoi-organ-browser/test/isolation.test.ts` | +106 | 上下文隔离 |
| `packages/lykoi-organ-browser/test/plugin.test.ts` | +233 | 假 socket 宿主：注册往返 / 不可达 / busy / 审计摘要 / 返回形状 |
| `packages/lykoi-organ-browser/test/assembly.test.ts` | +153 | 装配 + 部署模板 + 备份段 |
| `packages/lykoi-organ-browser/test/smoke.test.ts` | +150 | 真 Chrome |
| `profile/cordis.prod.yml` | +18 | browser 器官位（在 converse/wake 之前） |
| `profile/package.json` | +1 −1 | 依赖本包 |
| `package-lock.json` | +35 −1 | 三个新条目（下 §6） |
| `deploy/lykoi-browser.service.template` | +62 | systemd 单元模板 |
| `deploy/lykoi-browser.host.json.example` | +25 | 宿主配置范例 |
| `docs/browser_organ.md` | +177 | 运行手册（含 root 落地逐条命令） |
| `docs/deploy.md` | +16 −1 | 备份段第 10 条（D-8）+ "器官真身是显式替身"那条改成事实 |
| `governance/reports/runbook_disaster_recovery.md` | +6 −1 | 还原表第 13 行（D-8）+ 备份集项数说明 |

**受保护面零改动**：`packages/lykoi-kernel`、`packages/lykoi-gate`、`policy-core.ts`、
`TOOL_TO_ACTION`、两条提示词常量、reflow / memory / decide / wake / converse 的 src、
manifest、迁移目录 —— `git diff origin/main` 对这些路径为空。
`packages/lykoi-decide/src/organs.ts` 那"允许只加一行"的额度**没有用**：
`PREFIX_LABELS` 里已经有 `browser: '浏览器(她自己的, 带登录态)'`，不需要补。

## 3 · 测试

全仓 `npm test`（`--workspaces --if-present`）：**tests 988 / pass 977 / fail 0 / skipped 11**
（基线 929/918/0/11；新增 59 项全部来自本包，skipped 的 11 项与基线同一批、位置未变）。
`npx tsc --noEmit` 净。

| 包 | tests | pass | fail | skipped |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 106 | 105 | 0 | 1 |
| lykoi-decide | 94 | 94 | 0 | 0 |
| lykoi-gate | 72 | 72 | 0 | 0 |
| lykoi-heart | 14 | 14 | 0 | 0 |
| lykoi-kernel | 199 | 199 | 0 | 0 |
| lykoi-learn | 87 | 86 | 0 | 1 |
| lykoi-llm | 6 | 6 | 0 | 0 |
| lykoi-llm-deepseek | 5 | 5 | 0 | 0 |
| lykoi-memory | 120 | 111 | 0 | 9 |
| **lykoi-organ-browser** | **59** | **59** | **0** | **0** |
| lykoi-reflow | 35 | 35 | 0 | 0 |
| lykoi-regulation | 45 | 45 | 0 | 0 |
| lykoi-snapshot | 52 | 52 | 0 | 0 |
| lykoi-wake | 31 | 31 | 0 | 0 |
| **合计** | **988** | **977** | **0** | **11** |

### smoke：**ran**

本机 Mac 有 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
（**152.0.7977.65** —— 比服务器的 148 新一线；playwright-core 1.60 的 CDP 面在它上面
跑通，无沙箱或权限问题）。一条 smoke 跑完六步全绿，用时约 2.6 s：
navigate → get_text（首行是标记）→ research_read_text（另一个 Chrome 进程）→
两张截图文件真的在盘上 → 下载被拦 → 302 出域被拦（`smoke.test->other.test`）。

端口那一关的解法记在测试文件头：SSRF 只许 80/443，所以本地 http 服务不能直接用随机
端口的 URL；用 Chrome 的 `--host-resolver-rules=MAP smoke.test:80 127.0.0.1:<port>`，
她看到的 URL 是 `http://smoke.test/`（按 80 口过判定），落到线上才改道本地端口；
同时注入把 `smoke.test` / `other.test` 判为公网的测试解析器（真 `dns.lookup` 会
NXDOMAIN 然后 fail closed，那样测不到浏览器这一层）。

下载那一步在真 Chrome 上的实测事实：顶层导航到 attachment 时
`page.goto` 抛 `Download is starting`（于是动作返回 `navigation_failed`），**同时**
`download` 事件确实触发、被 `cancel()`、落一条
`browser_download_blocked{url_domain:'smoke.test', suggested_name_len:24}`。
测试对"走事件还是直接 abort"保持宽容，但硬约束不放：宿主目录里除 `shots/` 不许多出
任何文件。

## 4 · D-1..D-10 逐条对应的测试

| 定案 | 测试 |
|---|---|
| **D-1** 两个进程 / NDJSON / 串行 busy / 2s 不可达 | `plugin.test.ts`：`D-1/D-9：三动作注册往返 —— 注册后 wired 含三项，注销后替身回位（无幻肢）`；`D-1：注销器幂等（cordis 异常路径上可能调两次）`；`D-1：宿主不可达 → browser_host_unreachable，且远早于 2.5s（不抛、不阻塞）`；`D-1：宿主串行 —— 第二个并发请求立刻拿到 busy，不排队`；`D-1：health 通 + 三个动作经真宿主往返（假 driver）`；`D-1：get_text 不需要 url；navigate/read_text 缺 url 在大脑侧就被拦（不打扰宿主）` |
| **D-2** 三动作与返回形状 | `plugin.test.ts`：`D-2：navigate / get_text / research_read_text 的 data 键集逐字对表`；`D-2：其余六项刻意不接 —— research_browser.open 在 op 表里也没有对应项`；另 `plugin.test.ts` 的注册往返里逐项断言六个未接动作不在 wired |
| **D-3** 上下文隔离 | `isolation.test.ts` 六条：成功路径已关闭 / 两次 research 两个不同上下文 / 导航抛异常照样关 / 超时路径照样关 / SSRF 拦下压根不开 / research 不动持久上下文 |
| **D-4** 出域即中止 | `redirect.test.ts` 六条：`www.` 不算出域 / 子域与 http→https 不算 / navigate 出域带两端域名 + 审计 + 不读文本 / research 出域同样中止且上下文照关 / 纯函数 fail closed / 与审批门同一个 eTLD+1 切分器 |
| **D-5①** SSRF | `ssrf.test.ts` 十四条（scheme / 畸形 / 端口 / IP 字面量 / 主机名黑名单 / 单标签 / v4 十段 / v6 五段 / IPv4-mapped·6to4·Teredo / 地址解析 fail closed / **DNS rebinding** / 解析器抛或零地址 / 构造函数注入 / 语法拒不碰 DNS） |
| **D-5②** 下载隔离 | `download.test.ts` 五条（持久上下文钩子 + 审计字段 / 一次性上下文同样有钩子 / 两处都装子请求判定 / blob·data·file·javascript 顶层导航拒 / 静态断言 `acceptDownloads:false` 两处 + `cancel()`）；smoke 里的第④步 |
| **D-5③** 不可信标记 | `untrusted.test.ts`：`标记常量逐字`、`首行 = 标记，次行 = url= title=`、`正文里的"忽略以上指令"排在标记之后`、`走 driver：两个读页动作都带 untrusted:true 且首行是标记`；smoke 第②③步 |
| **D-5④** 文本上限 | `untrusted.test.ts`：`截断：超上限切到上限 + truncated:true`、`截断按码点切`、`max_chars 归一：缺省 20000、硬顶 60000`、`折叠空白` |
| **D-6** 观察面 | `plugin.test.ts`：`D-6：browser_action 摘要只有六个字段，不含正文、不含完整 URL`、`D-6：auditDomain 只到 eTLD+1，畸形 URL 落 unknown`；截图路径 `untrusted.test.ts` 末条与 smoke 第①③步（`shots/YYYYMMDD/<ts>-<op>.png` 且文件真存在）；screencast 只绑环回由 `assembly.test.ts` 的 `D-7：host.json 范例…` 断言 `listen` 匹配 `^127\.0\.0\.1:\d+$` |
| **D-7** 宿主隔离与资源 | `assembly.test.ts`：`D-7：host.json 范例能被 loadHostConfig 原样吃下，值与定案一致`（socketPath / executablePath / userDataDir / maxChars 20000 / retention 7 / 三个超时 30·15·45s / proxy 空 = null）；`D-7：unit 模板带齐隔离与资源闸，且一个 Environment= 都没有` |
| **D-8** 备份面 | `assembly.test.ts`：`D-8：两份备份文档都写了 /home/lykoi-browser/profile 与"先停服务"` |
| **D-9** 装配 | `assembly.test.ts` 六条：yml 位存在且形状对 / 位置在 converse 与 wake 之前 / profile 依赖 / 按序装配后清单块含三动作且 read_text ∈ wired / 顺序反了就看不见（反证）/ 宿主不可达时清单照列三项且动作返回 `browser_host_unreachable` |
| **D-10** 不动清单 | 无测试，靠 §2 的 `git diff origin/main` 全表与 §5 sha 表：四个 sha 与 main 逐字相同，受保护包 diff 为空；`manifest.sha256` 未碰，`--write-manifest` 未跑；零 `process.env`（下 §7 复核） |

## 5 · sha 表

| 对象 | sha256 | 变动 |
|---|---|---|
| `profile/cordis.prod.yml`（改前，= origin/main） | `64271cf093148d45d2db0088074092b74eedd6ec0052cd3d34c737d073a2f1f8` | — |
| `profile/cordis.prod.yml`（改后） | `9e5f79722fc197ae82b10a40f47957c82dce99a6141ed1f2dbcd650be41285ab` | **变**（D-9 加了 18 行：注释 14 + 器官位 4） |
| `TOOL_TO_ACTION` 常量文本（`packages/lykoi-converse/src/contract.ts`，477 字节） | `53bd692c889f721ca7fdf2b2f85522413232c662f32bc6165ff30be732d00854` | **不变** |
| `DECIDE_SYSTEM_PROMPT`（`packages/lykoi-decide/src/index.ts`，1639 字节） | `00b3de788eda38618b79f8c3af6d164d8a657493c09f86618b00014e974f14b2` | **不变** |
| `ENVELOPE_SYSTEM_PROMPT`（`packages/lykoi-converse/src/contract.ts`，1710 字节） | `8bd1bf3c3e58f32048628f8f425ac105ed11bcbf6d32519dfea6d1a5d1cc2ae8` | **不变** |
| `packages/lykoi-kernel/src/policy-core.ts`（整文件） | `84aa6f57f5652ad632b7fe6759f53e36b8082f88f39858196060e44125acdbd4` | **不变** |

（常量 sha 的取法：从 `export const <NAME>` 起到模板字符串结束反引号 / 对象字面量右花括号
为止的那一段源文本，逐字节 sha256。后四项与 `origin/main` 上同法取出的结果相同 ——
`git diff origin/main` 对这两个文件本来也是空的。）

## 6 · 依赖与 lockfile

- 新增第三方依赖**只有一个**：`playwright-core@1.60.0`（`--save-exact`，精确钉版）。
- **传递依赖数：0**。`node_modules/playwright-core/package.json` 的 `dependencies` 为空对象，
  `scripts` 也是空对象 —— 无 postinstall，不下载浏览器，`npm ci --ignore-scripts` 纪律不受影响。
- 选版理由：1.60 线 bundle 的 Chromium 是 **148.0.7778.96**，与服务器的 Google Chrome 148
  同线（1.58→145、1.59→147、1.61→149、1.62→151，逐个查过 browsers.json）。器官驱动的是
  **系统 Chrome**，bundle 版本只用来判 CDP 协议面的世代对齐。
- lockfile 新增条目 **3 个**：`node_modules/playwright-core`（真包）、
  `node_modules/lykoi-organ-browser`（workspace 链接）、`packages/lykoi-organ-browser`
  （workspace 定义）。另有两处既有条目的字段改动：本包 `devDependencies` 里的
  `lykoi-decide`（**workspace 内部边，非第三方** —— `assembly.test.ts` 要用
  `OrganInventoryCache` 复刻 wake/converse 的清单建法）与 `profile` 的依赖列表加本包。
  净 +35 −1 行。

## 7 · 落地预告的输入（LANDING-H）

- **manifest 条目数：106 → 113**。本包进 hash-pin 域（补集规则，`surface.ts:141`），
  新增 = `packages/lykoi-organ-browser/package.json` 1 项 + `src/**.ts` 6 项
  （`protocol.ts` / `ssrf.ts` / `untrusted.ts` / `driver.ts` / `host.ts` / `index.ts`）。
  `test/` 不进钉面。`profile/cordis.prod.yml` 在 root 属主域、内容变了，同样要重签。
- **零 env 复核**：`packages/lykoi-organ-browser/src` 下没有任何一处读环境变量的代码
  （`process.env` 只在 `host.ts` 的文件头注释里作为一句纪律出现，不构成读取；
  `scanEnvReads` 的正则只认 `process.env.LYKOI_*` 与 `'LYKOI_*'` 两种形，本包里
  两者各 0 次，实跑 `scanEnvReads` 得到的名字集与加本包之前一样是 22 项）。宿主的全部配置经 argv `--config` 指到
  `/etc/lykoi-browser/host.json`；插件的全部配置是 yml 里的 `socketPath` 一项。
- **root 落地七步逐条命令**在 `docs/browser_organ.md` §2（建用户与目录 → 加 lykoi 组 →
  放 host.json → 装单元 → 起宿主并用一行 node 验 health → **chown 之前** `sudo -u lykoi
  npm ci --ignore-scripts` → 重签 manifest → 起大脑）。
- 首日读数建议不变（`browser_action` 计数、`capability_gap{not_wired}` 的 `wanted` 分布、
  explore 是否回到候选、`decision_ungrounded` 日频）。

## 8 · 发现的张力

1. **器官依赖通道适配器**（派工单已预告，本单不改）：真身注册口
   `registerOrganHandler` 住在 `packages/lykoi-adapter-telegram/src/resources.ts`，于是
   `lykoi-organ-browser` 必须依赖 `lykoi-adapter-telegram` 才挂得上手。浏览器与 Telegram
   之间没有任何语义关系，这条边纯粹是"注册表恰好住在那儿"。归 M5 总盘迁到 kernel 或
   独立的 `lykoi-organs` 包。

2. **身体图式在生产里仍然是个空转的登记簿**：插件按 D-1 建了 `BodySchemaRegistry` 实例
   并 `ctx.provide('bodySchema', …)`，但生产的器官清单读的还是
   `wiredActionCatalog(resources)`，`registryActionCatalog` 依旧零消费者。于是同一件事
   （"哪些器官在位"）此刻有两个事实源，只是碰巧一致。切换归 M5 总盘（m4_handoff §E），
   但两源并存的窗口期越长，它们分叉时越难被发现。

3. **D-9 靠装配顺序而不是靠机制**：wake / converse 在 apply 里各取一次
   `outboundOrganResources()` 快照，所以"器官位必须排在它们前面"是一条**写在 yml 注释里
   的隐式契约** —— `assembly.test.ts` 能钉住当前这一版 yml，钉不住"以后有人在 wake 之后
   加第二个器官"。真正的修法是让清单在器官注册时 `invalidate()`（图式注册表已经有
   `onChange` 钩子，缺的是接线），归 M5 总盘。

4. **`research_browser.*` 在 autonomous 起源不逐域问，是不可变核的既有定案**
   （`policy-core.ts` 的 `AUTONOMOUS_ALLOWED`，本单不动）：她独处 explore 上网时，唯一
   拦得住她的就是本单这四道硬化。这不是缺陷，但它把"SSRF 判定器写对了没有"从一个工程
   问题抬成了一条治理边界 —— 判定器的每一次改动都该按不可变核的标准复核。

5. **她的登录态是 Kevin 的东西，不是她的记忆**：`/home/lykoi-browser/profile` 里存的是
   Kevin 授权她用的那些账号的 cookie。备份、灾备、退役三条链路上它都得被当作凭据处理
   （本单已把它写进两份备份文档并要求"先停服务"），但仓库里现在没有任何机制阻止它被
   打包进一份可读的日常备份 —— 备份脚本本来就不在本仓库。留给灾备侧一条待办。

6. **smoke 用的 Chrome 与生产不同版本**：本机 152、服务器 148、playwright-core bundle
   的是 148。smoke 在 152 上绿说明 CDP 面向后兼容，但它**不是**对生产那一版的证明；
   LANDING-H 起宿主之后应当在服务器上跑一次同样的六步（手册 §2 第⑤步的 health 只验
   了活着）。
