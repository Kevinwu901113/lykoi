# WO-GW-02 · 第 2 波交付报告 · T1 执行面(裁决 A:解耦)

**分支** `wo/gateway-02` · **基** `32238013` · **HEAD** `076634f9` · **工作树干净**
**7 个 commit,每判据一个** · 全程前台串行、零后台、每段 `timeout 1800` 包裹

| commit | 判据 |
|---|---|
| `0c573c88` | ② 负例钉死(降级版,attempt 1 已落) |
| `908b983e` | ③ T1 Runner(七态版) |
| `b0b94a67` | ④ broker 三个真实缺口 |
| `a8ba87e5` | ⑤ S4a 四条可测执行面 + 活体脚本 |
| `82626df8` | ⑥ 部署件 |
| `55466f45` | ⑦ 零扰动 + **Core 零 diff** |
| `076634f9` | ⑧ 全量对账 + manifest(空 commit:结论是"零改动") |

**一句话**:T1 执行面可用了 —— Runner 把 `dispatched` 的合同接着推完七态,broker 的三个缺口补齐,S4a 四条上线门里三条在仓内真测、一条(代理箱)按假设交付并写进合并包 E 步。**Core 一个字节没动**。

---

## 0. 与工单表述的三处出入(均已按裁决处理,列在最前免得被埋)

1. **判据③ 的 `completed`/`failed` 两个状态不存在**(裁决第 2 条已确认)。活体七态 CHECK(`kernel/delegation.py:71-90`)是 `draft/dispatched/running/collected/verified/rejected/expired`。映射见 §2。
2. **判据④ 的 broker 大部分已存在**(P2-03A 交付)。真实缺口只有三个,已按裁决第 3 条逐条交付。既有 10 条测试**没有回退**,但其中**一条断言按裁决改了名**(见 §3.2)。
3. **`handles.yaml` 实为 `handles.json`**(P2-03A 既有偏离,`broker/config.py:3-8` 已记理由)。按裁决接受,样例文件里再说明一次。

---

## 1. 判据①(侦查)已完成部分 —— 本波的执行结论

停工报告里的 ①a–①e 全部成立,这里只写**它们在本波变成了什么**。

| 侦查项 | 结论 | 本波落成什么 |
|---|---|---|
| ①a 六处 origin 词表 | 六处一字未变 | 归位到未来的 Core 工单(§7 交接节);本单零 Core diff,有测试站岗 |
| ①b `dispatched` 消费侧挂点 | 选**独立 `lykoi-runner` 单元**(`cognition/` 是别单领地;`autonomous.py` 的让位语义不合) | `lykoi-runner.service` + `src/lykoi/runner/` |
| ①c systemd 登记形态 | 五单元平铺仓库根、无 drop-in 先例 | 照此登记,含 `ExecStartPre=startup_verify`(裁决第 4 条) |
| ①d handles 载体 | 是 `.json`,且**仓内无占位样例** | `handles.example.json`(缺口③) |
| ①e 代理箱 | `192.168.0.202:7890` 真实在用;工作副本无 root、够不到该网段 | 按假设交付 + 活体实测归合并包 E 步(裁决第 5 条) |

---

## 2. 判据③ · T1 Runner(七态版)

`src/lykoi/runner/` 六个模块,`tests/test_gw02_runner.py` **41 条**。

### 2.1 七态映射(原工单文案 → 活体 CHECK)

| 工单文案 | 活体七态 | 语义 |
|---|---|---|
| `dispatched` | `dispatched` | Runner 尚未认领 |
| `running` | `running` | 沙箱已起,子代理在跑 |
| **`completed`** | **`collected`** | 跑完且证据已入账(收据挂上、合同收口) |
| **`failed`** | **`rejected`** | 跑失败 / 合同拒收 —— 证据同样入账 |
| (无) | `expired` | `expires_at` 已过,Runner 扫到即封 |
| (无) | `verified` | **验证平面的笔**(设计 §5 步 4),Runner 永不写 |

`verified` 是唯一 Runner 永不写的出边,这是**边界不是缺陷**:设计 §3.2 末句把 `verdict` 定为验证平面的唯一合法数据源(单写者原则 9.4)。Runner 挂收据、不判收据。今天合同会停在 `collected` —— 已写进合并包遗留节。

### 2.2 一轮做三件事

1. `sweep_expired()` —— 先于认领。一张已过期的合同不该被起起来,而 `expired` 正是 broker 票据失效的信号(判据④ 缺口① 读的就是这个态)。时间读**虚拟时钟**(`shared.clock.now`):压缩时制下合同**先**过期、票据随后作废,失效永不晚于预期。
2. `claim_next()` —— 库层是 `WHERE id=? AND state=?` 的 CAS,两个 Runner 抢同一张合同只有一个能成(有双 Runner 负例)。
3. `execute()` —— 起沙箱、收证据、挂收据、推终态。

### 2.3 失败方向:处处 fail closed

合同看不懂 / 网络白名单非法 / 取不到票 / 沙箱起不来 / 超时 —— 一律**挂收据 + 推到 `rejected`**,绝不"先跑起来再说"。唯一例外是审计写不进去(`DelegationAuditUnavailable`):那时**状态不迁移**,合同留在原地等人工介入 —— 一次没有记录的迁移就是一条凭空出现的合同历史。

> attempt 1 遗留的一个真 bug 已修:`_fail()` 用 `{"kind": ..., **evidence}` 拼收据,而 `evidence` 自带 `kind='t1_runner_execution'`,覆盖顺序反了 —— **失败的收据会自称成功执行**。另一处:`claim_next()` 在 `try` 之外,认领阶段撞上审计不可用会把异常抛出 `run_once()`。两处都有回归用例。

### 2.4 三个刻意的设计选择

- **合同正文是严格子集,不是 YAML**。仓内无 pyyaml。`contract.py` 先试 `json.loads`,否则走一个**只认四种行**的白名单解析器,凡是没见过的语法一律拒收。方向刻意选成"看不懂就拒收"而不是"尽力猜":一张委托合同是权限边界的载体,猜错一个缩进可能猜出一条多开的网络白名单。
- **子代理环境从零构造,不读 `os.environ`**。不是"把危险的变量删掉"(删除法总会漏掉下一个新变量),是"根本没有拷贝这一步"。有一条用例往 Runner 环境里塞一个谁也没见过的变量名,证明白名单法对未来的变量也成立。
- **`Launcher` 抽象的边界很窄**。工作副本里跑不了真的 `sudo -u`,而"子代理不继承 env"必须**可测**,不能只是一段注释。生产用 `SudoUserLauncher`(`sudo -n -u <agent> -- env -i <K=V...>`,三个细节都是安全面),测试用假 launcher 逐字断言 env/argv/cwd。

---

## 3. 判据④ · broker 三个真实缺口

`tests/test_gw02_broker_gaps.py` **22 条**,既有 `tests/test_broker.py` **10 条全绿**。

### 3.1 缺口① · 票据校验读库

设计 §4.2 写"票据与 contract_id 绑定、**合同过期即失效**",P2-03A 只做了时间过期。补上另一半:合同 `state IN ('expired','rejected')` 即失效 —— 裁决逐字定的那两个态。

- **`collected`/`verified` 不掐票**。它们同样是终态,但属**正常收尾**;子代理可能还在读最后一次调用的响应,当场掐票只会造出一批"成功了但最后一段日志没写完"的收据。时间 TTL 会在几十秒内自己收掉它们。有一条测试把这两个态钉成放行。
- **校验在 `/grant` 和每一次 `/proxy` 上各做一次**。后者才是要害:票是合同还活着时发的,而合同可以在票的 TTL 到期**之前**被 Runner 封成 `expired`。"合同失效即票据失效"要成立,校验就必须在每次**用票时**发生。
- **`mode=ro` 硬只读**:即使 broker 账户有写位,那条连接也建不出写事务(单写者原则 9.4)。有一条测试直接拿它去写,断言被 SQLite 挡回来。
- **fail closed**:库不存在 / 不是个库 / 读不出来 —— 一律拒绝出借。一个凭证代理在"我不知道这张合同还算不算数"的时候,唯一安全的答案是不给。
- **没配库 = 只剩时间 TTL**,是**部署选择**不是默认的安全姿态。既有 10 条测试正跑在这个形态下,原样保持可用。

测试用的是**真** `kernel.delegation` 造的合同台账,不是手搓的同名表 —— 要证明的正是"broker 读得懂 Runner 写的那个库"。

### 3.2 缺口② · 审计事件名 + guardian sink 联写

- 事件名 `grant` → **`secret_handle_grant`**,对齐设计 §4.2 词表。落 broker 自有 audit 照旧。`proxy_use` 设计词表里没有对应物,原样保留。
- **guardian sink 联写做成配置项、默认关**(裁决第 3 条)。联写**不 import** `guardian/audit_sink.py`(会耦合到受保护目录,且 sink 的路径是它 import 期的模块级常量)—— 耦合的是**格式**不是模块,有 **AST 级**测试站岗。
- 联写失败**不回滚出借**:自有 audit 已落账,这份是副本。把一次成功的出借因为副本写不进去而回滚,只会在权限没布置好的机器上把整个 LLM 通路变成不可用,而审计并没有真的丢。失败会留一条 `guardian_sink_error`。

> **一处需要说明的改动**:`tests/test_broker.py` 里那条 `assert grant_line["event"] == "grant"` 改成了 `== EVENT_GRANT`。这是裁决要求的改名带来的**必然**修改,测的性质一个字没变(出借留一条账、只存 8 字符前缀、不含 key)。这是本单对既有测试的**唯一**改动,不是回退。
> 下游影响已核:仓内除测试外**无**按 `event == "grant"` 过滤 broker audit 的地方。

### 3.3 缺口③ · handles 占位样例

`handles.example.json`,通篇标注 PLACEHOLDER,**只写密钥的变量名、不写值**。测试用**真** `config._parse_handles()` 读它 —— 一份读不进去的样例比没有样例更糟,它会在部署那天把人引到错的形状上。

---

## 4. 判据⑤ · S4a 四条可测执行面

`tests/test_gw02_s4a.py` **14 条** + `scripts/verify_s4a.py`(活体版,归合并包 E 步)。

**诚实版的测到哪 / 测不到哪**:

| 门 | 仓内怎么测 | 活体版还剩什么 |
|---|---|---|
| ① `/proc` 读不到 key | **真测**:起真子进程读自己的 `/proc/self/environ` 交回来核对。Runner 环境里**故意**塞满像密钥的东西 | 跨用户那半边(`sudo -u lykoi-agent-1`):本机没那个用户、没窄口 sudo |
| ② 直连上游被拒 | **只测策略**:编译产物里没有 `api.deepseek.com`,子代理出网只有代理箱一条路、`NO_PROXY` 只放行环回 | **真的连一次看它被拒** —— 需要代理箱 ACL + 够得到 `192.168.0.202`,**两样都没有** |
| ③ 经反代调用成功且审计有记录 | **真测**:真 broker(uvicorn + 真 socket,不是 `TestClient` 的 in-process 调用)+ 真子进程 | 换成真 `api.deepseek.com` 与真 key |
| ④ 合同过期后票据失效 | **真测**:过期不是手改库,是 `Runner.sweep_expired()` 读合同正文自己封的 | 同左,换活体库 |

门③ 的那条用例是全链路的:Runner 取票 → 票进子代理环境 → 真子进程只拿着一张票打通反代 → 上游回显的 `Authorization` 证明真 key 确实被注入,**而那次注入发生在 broker 进程里,不在子代理这边**。

门② 是本单**唯一**"按假设交付"的地方。为免它被读成绿灯,专门有一条用例 `test_gate2_live_half_is_declared_not_faked` 钉住:那个判定确实写在活体脚本里,没有随口一说。

### 4.1 顺带修的一个真 bug(实测出来的)

`runner/broker_client.py` 用 urllib 取票,而 urllib **默认读 `*_proxy`**。Runner 宿主的环境里本来就有代理箱变量(`lykoi-telegram.service:15` 用的就是它)—— 一次 `127.0.0.1` 的取票会被送到代理箱、回来一个 **502**,而 Runner 会把它读成"broker 挂了"并**拒收合同**。改成 `ProxyHandler({})` 显式不走代理。broker 服务端为同一件事做过同一个决定(`app.py:52` 的 `httpx.AsyncClient(trust_env=False)`)。有回归用例站岗。

> 这个 bug 是在本工作副本里**被真的触发**才发现的(工作副本恰好设了这四个变量),不是读代码读出来的。若没有"真 socket 而不是 TestClient"这个选择,它会一直活到生产。

---

## 5. 判据⑥ · 部署件

三样东西 + `tests/test_gw02_deployment.py` **24 条**。

- **`lykoi-runner.service`** —— 照仓库根平铺登记约定。`User/Group=lykoi`、`UMask=0077`、`PYTHONPATH`、`ExecStart` 均与既有五单元同款;**`ExecStartPre=startup_verify.py`**(裁决第 4 条,与 core/autonomy 同款)。admin token 不写进单元(单元 world-readable),走 `EnvironmentFile`。只有 `After=`/`Wants=`,**没有** `Requires=`/`BindsTo=` —— 排序不是干预。
- **`scripts/provision_delegation_users.sh`**(幂等,需 root)—— 六步,每步先查后改。子代理**不在 lykoi 组**是硬失败而非自动修(一个已经在组里的账户可能已经读过它不该读的东西,那需要人来判断);sudoers 落盘前先 `visudo -c`;动 `memory.db` 权限要**显式**加 `--with-broker-acl`(活体数据权限该由 Kevin 拍板);最后**以子代理身份实测** secrets / core.sock / memory.db 全部系统级拒绝。
- **`docs/wo_gw02_merge_checklist.md`** —— A–F 六步,每步不过就停。含裁决点名的两项:**C 节 broker 审计联写的权限方案**(三个方案列了取舍,推荐 C-a:`lykoi-audit` 组 + `0620`,`chattr +a` 的 append-only 保证一点没丢)与 **E2a 代理白名单实测项**(该怎么装、判定方向是什么、做不了时的后果)。

测试钉的是**部署件与代码之间会漂的地方**:单元里的 `LYKOI_RUNNER_*` 必须是 `RunnerConfig.from_env` 真读的那些(拼错不报错,只会**静默回落到默认值**);脚本里的 sudoers 行必须与 `SudoUserLauncher.sudoers_line()` 逐字相同(不一致的症状是服务器上一句"Runner 起不来子代理");清单点名的每个文件都得真的在仓里。

---

## 6. 判据⑦ · 零扰动 + Core 零 diff

`tests/test_gw02_zero_disturbance.py` **21 条**。两个方向都测。

**Core 零 diff(本波硬断言)**:`src/lykoi/core` 与 `src/lykoi/kernel` 逐字节零 diff。这条断言不是"我们碰巧没改",是"**不许**碰" —— 它替另一个工单的边界站岗,和绊线测试 `test_gw01_delegation.py:314` 站的是同一班岗。另有一条钉住两处 CHECK 的现值(`ACTIVE==1`/`SUPPORTED==2`、evidence 侧仍是扁平元组无阶梯):交接节引的那些位置今天仍然成立,它红了就得重核再交。

**零扰动(GW-01 原文照旧)**:六个受保护目录、`guardian/*.py`、`policies/`、既有五个 systemd 单元 —— 全部零 diff。绊线测试原样(裁决 1b)。**反方向**:整条分支 `git diff --name-only` 逐个文件过白名单,挡"改了一个谁也没想到的文件"。

**"不装不影响"是可测的而不是一句承诺**:

- 既有代码里**没有一处** import `lykoi.runner`(AST 级扫描)—— 既有五服务根本不知道它存在。
- Runner 不 import `lykoi.resources`(治理不变量 #1)。
- `requirements.txt` 零 diff 且 Runner 只用 stdlib:新单元与既有服务**共用同一个 `.venv`**,引一个新依赖就是**所有**服务的依赖变了。
- 判据④ 两个新配置项**都默认关** —— 这是"既有五单元零 diff"能成立的另一半:代码加了开关,不开时 broker 行为与 P2-03A 逐字相同。**两件事必须同时成立,零扰动才是真的。**

---

## 7. 判据② · Core schema 工单交接节

> **这一节是未来 `WO-CORE-DELEGATED-VOCAB` 的输入。本单零 Core diff。**

### 7.1 本单实际交付的是什么

`tests/test_gw02_delegated_origin_negative.py` **7 条负例**,把现状**钉成事实**:两处 SQLite `CHECK` 实测**拒绝** `delegated`;而 `kernel/dispatch.py:120-135` 的 `_shadow_call` 把 `IntegrityError` 吞掉,只留一条 `core_shadow_error` 遥测 —— 净效果是**静默丢影子记录而不是崩溃**(fail-open);**静态守卫**:`src/` 里没有任何模块构造 `origin='delegated'` 的 `DispatchContext` —— 哪天有了,那一刻正是六处词表必须先扩完的那一刻。

绊线测试 `tests/test_gw01_delegation.py:314` 原样不动(裁决 1b)。

### 7.2 六处词表的完整扩法

| # | 位置 | 现状(实查) | 扩法 |
|---|---|---|---|
| 1 | `core/execution_session.py:36` | `_ORIGINS = frozenset({4 值})` | 加 `"delegated"`,改 1 行 |
| 2 | `core/permission_evidence.py:32` | 同上 | 同上 |
| 3 | `core/permission_learning.py:34` | 同上 | 同上 |
| 4 | `core/shadow.py:198` | SQLite `CHECK`,在 `_V1` 内 | **见 7.3,受阻** |
| 5 | `core/permission_evidence_shadow.py:41-42` | SQLite `CHECK`,在 `_SCHEMA_STATEMENTS` 内 | **见 7.4,受阻** |
| 6 | `resources/notify.py:19` | `_ALLOWED_ORIGINS`(**3 值**,故意排除 `autonomous`) | **判断题,见 7.5** |

### 7.3 第 4 处 —— 阶梯存在,但活动版本被别的工单钉死

- `shadow.py:59-61`:`CORE_ACTIVE_SCHEMA_VERSION=CORE_SCHEMA_VERSION=1`、`CORE_SUPPORTED_SCHEMA_VERSION=2`;`MIGRATIONS=((1,_V1),(2,_V2))`(`:664`)。
- `_V1` 哈希钉死(`_validate_registered_migrations:714-724`),**禁改**。只能加 `_V3` 重建 `commands` 表。但 `_apply_migrations:772-778` 只应用 `version <= target_version`,而普通写者传的正是 `CORE_ACTIVE_SCHEMA_VERSION`。**要让 `_V3` 生效就必须把 ACTIVE 抬到 3,而抬到 3 会顺带把 `_V2` 一并应用**。
- `_V2` 是 M3-R1b 的 attention 表组,源码注释明写(`:662-663`):*"The bridge validates both hashes but only applies migrations through v1. R1b will raise ACTIVE to 2 in a later, independently reviewable commit."*
- 被**两道测试钉住**:`test_core_v1_event_store.py:205-206` 硬断言 `ACTIVE==1 and SUPPORTED==2`;`test_core_v1_m3_r1b_v2_activation.py:321-357` 做 **AST 级**扫描,断言全仓只有 `activate_core_schema_v2` 可以请求 `migration_target=2`。

**→ 这一处必须与 M3-R1b 的 v2 激活同批做**,或排在其后。

### 7.4 第 5 处 —— 根本没有阶梯可照

`_SCHEMA_STATEMENTS` 是**扁平元组**(`:29-71`),`SCHEMA_VERSION = 1`,`_verify_schema:208-214` 要求账本**恰好一行**且等于 `(1, sha(_SCHEMA_STATEMENTS))`。原工单说"照 shadow 既有阶梯"—— **此处不存在这样的阶梯**。就地改会让**每个存量库**报 `permission evidence schema ledger mismatch`,而这是 **pre-READY 启动闸**(`verify_permission_evidence_runtime:275`),后果是 **Core 运行时拒绝启动**。合规做法需要**从零发明**一套迁移阶梯 + 改写 `_verify_schema` 接受多行账本。

**→ 这一处是那张工单里最重的一块,建议单独估工。**

### 7.5 第 6 处 —— 这是判断题,不是填空题

`_ALLOWED_ORIGINS` 只有 3 个值、**故意排除 `autonomous`** —— 它问的不是"origin 的合法取值有哪些",而是"**哪些 origin 可以发通知**"。所以 `delegated` 加不加取决于产品判断:**子代理的动作该不该直接推通知给 Kevin?**

我的看法(供参考,不是结论):**不加**。委托执行的结果应当经收据 → 验证平面 → 再决定是否惊动主人;让子代理直连通知面,等于给了它一条绕过验证平面的出口。这与 `autonomous` 被排除在外是同一个理由。

### 7.6 那张工单的建议形态

前置 M3-R1b v2 激活 → 步 1 第 5 处(发明阶梯,最重)→ 步 2 第 4 处(`_V3` + ACTIVE 抬到 3)→ 步 3 第 1/2/3 处(三行,**必须与步 1/2 同批**:单独先改会让代码层收下、库层拒绝,那是最难查的一类不一致)→ 步 4 第 6 处按 7.5 拍板 → 收尾:绊线测试与本单 7 条负例**双双转正**(负例文件里每一条都写明了"它红了意味着什么")。

**验收**:那时才会有一条真以 `origin="delegated"` 落 Core 的路径。今天没有(§7.1 的静态守卫在证明这件事),所以"静默丢数据"**不在 T1 的关键路径上** —— 这正是裁决 A 成立的前提。

---

## 8. 判据⑧ · 全量对账与 manifest

### 8.1 manifest:112 → 112,**零条新增 / 零条改哈希 / 零条删除**

与 GW-01 的 110→112 不同,本波**不需要重签**,理由是覆盖面:`_protected_files()` 覆盖 `guardian/*.py`、`kernel/*.py`、`core/*.py`、六个受保护目录的 `*.py`、persona TOML、approval rules、phase5 预注册文档。本单新增的 `src/lykoi/runner/` 与改动的 `src/lykoi/broker/` **都不在覆盖面内**,而覆盖面内的文件本波逐字节零 diff。

自证(按 GW-01 同款方法,直接调 `startup_verify` 自己的 `_protected_files()` 与 `_sha256()` 整表重算,不手改行):

```
manifest 行数 112 / _protected_files() 条目数 112
应新增 无, 应删除 无
逐条重算: 一致 111 / 不一致 0 / 不可读 1
```

不可读那条仍是 `/home/lykoi/state/approval_rules.json`(PermissionError)—— 与 GW-01 同一条,沿用原摘要。它读不到恰是"approval_rules 永无写路径"的系统级实证。

### 8.2 全量:**2294 passed / 7 failed / 6 skipped**(collected 2307)

144 个测试文件切 **15 段**,前台串行,每段独立 `timeout 1800` 包裹。

| 段 | 结果 | 耗时 | 段 | 结果 | 耗时 |
|---|---|---|---|---|---|
| 01 | 136p / 1s | 210s | 09 | 147p | 940s |
| 02 | 166p | 513s | 10 | 154p | 567s |
| 03 | 149p | 166s | 11 | 204p / **1f** / 4s | 794s |
| 04 | 122p | 16s | 12 | 86p | 737s |
| 05 | 91p | 10s | 13 | 109p | 334s |
| 06 | 214p / **6f** | 187s | 14 | 199p | 765s |
| 07 | 185p / 1s | 204s | 15 | 99p | 4s |
| 08 | 233p | 1556s | | | |

**与基线 2169/3/6(collected 2178)逐数闭合:**

```
collected  2178 -> 2307   (+129)  = 本波新增六个测试文件 129 条, 精确相等
passed     2169 -> 2294   (+125)
failed        3 ->    7   (+4)
skipped       6 ->    6   (0)
闭合式:  125 + 4 = 129  ✓   (新增 129 条全部到账, 无一条静默消失)
```

新增 129 条构成:负例 7 + Runner 41 + broker 缺口 22 + S4a 14 + 部署件 24 + 零扰动 21 = **129**。

### 8.3 7 条失败逐条归因 —— **零条归因于本单**

**① `test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources`** — `PermissionError: /home/lykoi/state/approval_rules.json`。与 GW-01 基线那条**逐字相同**;单跑该文件得 `1 failed / 20 passed / 4 skipped`,与 GW-01 报告记录的数字**逐数相同**。纯环境项。

**②–⑦ `test_core_v1_shadow.py` 6 条** —— 教训 38 的已知浮动。本波把它**钉死成了实验事实**,而不只是引用一条教训:

| 实验 | 分段 | 代码 | 结果 |
|---|---|---|---|
| 全量那一次 | chunk06(10 文件) | HEAD | **6 failed** |
| 立刻重跑一次 | **同一个 chunk06** | **同一个 HEAD** | **11 failed** |
| 对照 | **同一个 chunk06** | 基线 `32238013` 的独立 worktree | **11 failed** |

即:**同一份代码、同一个分段,两次跑出不同结果**。浮动是**跑与跑之间**的,不只是分段方式带来的;且基线跑出的失败数**不少于** HEAD。该组用例存在进程内状态污染 / 顺序依赖,失败数在 2..11 的带里游走,与本单改动无关 —— 本单 `core/` 逐字节零 diff。

> GW-01 的建议("另开工单收敛该组的用例隔离")**本波再次实证**,并补一句:这组用例的失败数**不适合作为回归基线的一部分**,建议那张工单同时决定是隔离修好,还是先 `xfail` 标注,免得每一单都要重做一遍这个归因。

### 8.4 conftest(教训 36)

`tests/conftest.py` 与 `pytest.ini` **零 diff**,全程未动。所有分段共用同一份仓内 conftest,无任何 `-p` / `-c` / `--rootdir` 覆盖。唯一的例外是 §8.3 那次基线对照跑 —— 它按设计指向 worktree 自己的 `pytest.ini`,并在此写明。

---

## 9. C-C 交接清单(承接 GW-01 F′,逐项结账)

### 9.1 Runner 出生环境需要的接口点 —— 六项

| 接口点 | 本波用在哪 |
|---|---|
| `DelegationRef` 四字段 | `sandbox.build_child_env` 把四字段写成子代理的环境事实 |
| 第五个 origin | **没用上** —— T1 下 Runner 不经 dispatch 管线(§7.1) |
| `dispatched` 挂点 | `Runner.claim_next()` 就挂在这里 |
| `ensure_agent_user()` | 合同的 `agent_user_id` 进子代理环境与收据 |
| `MAX_DELEGATION_DEPTH=1` | 写成 `LYKOI_DELEGATION_MAX_CHILD_AGENTS=0` 让子代理**知道**;真正的闸仍在数据面 |
| `add_receipt()` / `set_verdict()` | Runner 只调 `add_receipt`,**从不调 `set_verdict`** |

### 9.2 broker 票据绑 `contract_id` —— 已接上

`audit_session_id(contract_id) -> f"dsess_{contract_id}"` 确定性派生、不落列,broker 侧拿到的与审计行里的是**同一个键**。§4.2 的"过期"信号读 `delegation_contracts.state IN ('expired','rejected')` —— 缺口① 读的正是这个,索引 `idx_delegation_contracts_state` 已就绪。

### 9.3 §4.3 四条 —— GW-01 标 ❌ 的三条,本波结账

| §4.3 | GW-01 | 本波 |
|---|---|---|
| ① `/proc` 读不到 key | ❌ GW-02 | ✅ 仓内真测;跨用户半边归 E 步 |
| ② 直连被拒 | ❌ GW-02 | ⚠ **策略已测,活体实测归 E 步**(唯一按假设交付项) |
| ③ 经反代成功且审计有记录 | ❌ GW-02 | ✅ 仓内真测(真 broker + 真 socket + 真子进程) |
| ④ 合同过期票据失效 | ✅ 数据面 / ❌ 票据侧 | ✅ 票据侧补齐,两层(合同 / TTL)分得开 |

### 9.4 GW-01 留给治理侧的三件事

1. **追认 `verdict` CHECK 的写法** —— 本单未动,仍待追认。
2. **`policy_core.HARD_ASK_TYPES` 加入 `delegation.dispatch`** —— 本单同样 forbidden 不许动 guardian,**只提不做**,原样转呈。
3. **另开工单收敛 `core_v1` 用例隔离** —— 本波用 §8.3 的三次实验再次实证,建议加强。

---

## 10. 需要治理侧决断 / 转呈的事项

1. **C 节 broker 审计联写的权限方案**(裁决已指明由 Kevin 裁):推荐 C-a(`lykoi-audit` 组 + `0620`,`chattr +a` 保留)。
2. **代理箱 ACL 是 S4a 的最后一块**:做不了则 S4a 不算达成,`lykoi-runner.service` 就不要装。
3. **建议把 `src/lykoi/runner/` 纳入 manifest 覆盖面**。`lykoi-runner` 是一个**能生子代理**的进程,却不在覆盖面内。这要改 `guardian/startup_verify.py` —— 本波 guardian 零 diff 不允许,且扩治理边界该是一次独立决定。**只提不做。**
4. **`verified` 态今天没有写者**:合同会停在 `collected`。这是设计 §5 步 4 的领地,不是缺陷,但要有人记着它。
5. **`test_core_v1_shadow.py` 的失败数不宜再作为回归基线的一部分**(§8.3 末)。

---

## 11. forbidden 遵守自证

未碰 `cognition/`、未动 guardian 代码(`guardian/*.py` 零 diff)、未碰 conversation/telegram/surface、`approval_rules` 无写路径、无自批路径、未动 U3 影子与切换键、**未动 Core 一个字节**、未动既有五个 systemd 单元、未改 `requirements.txt`、未改 `conftest.py`/`pytest.ini`、绊线测试 `test_gw01_delegation.py` 原样。全部有测试站岗。

**未装任何东西到系统上**:没有 `useradd`、没有 `systemctl`、没有动 `/etc/sudoers.d/`、没有动活体 `memory.db` 的权限。部署脚本交付的是**脚本**,执行归合并包 D 步。
