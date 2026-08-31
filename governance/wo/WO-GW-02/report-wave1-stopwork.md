I need to stop and report before burning hours on a foundation that may have to change. 判据② — the headline hard prerequisite — collides with another work order's guarded territory. Here is the verified reconnaissance.

## WO-GW-02 · 侦查节(判据①)+ 一处必须停下的冲突

**分支** `wo/gateway-02` ·**基** `32238013` ·**工作树干净** ·**尚未产生任何 commit**

---

### ①a 六处 origin 词表现状(逐处复核,引代码行)

六处全部在 GW-01 报告①d 所述位置,一字未变:

| # | 位置 | 现状 | 扩词表成本 |
|---|---|---|---|
| 1 | `core/execution_session.py:34` | `_ORIGINS = frozenset({4值})` | 改 1 行 |
| 2 | `core/permission_evidence.py:32` | 同上 | 改 1 行 |
| 3 | `core/permission_learning.py:34` | 同上 | 改 1 行 |
| 4 | `core/shadow.py:198` | SQLite `CHECK`,在 `_V1` 内 | **见下,受阻** |
| 5 | `core/permission_evidence_shadow.py:41-42` | SQLite `CHECK`,在 `_SCHEMA_STATEMENTS` 内 | **见下,受阻** |
| 6 | `resources/notify.py:19` | `_ALLOWED_ORIGINS`(3 值,故意排除 `autonomous`) | 判断题,见下 |

绊线测试 `tests/test_gw01_delegation.py:314` 现值已核:它断言前三处 `== four`,并额外对第 4/5 处做**子串断言**(`:333-336`)——扩词表必红,与其自述一致。

### ⚠ 判据② 受阻:两处 CHECK 的"新版本迁移"在本单内无法合规完成

**第 4 处 `core/shadow.py`** —— 阶梯存在,但**活动版本被别的工单钉死**:

- `shadow.py:59-61`:`CORE_SCHEMA_VERSION = 1`、`CORE_ACTIVE_SCHEMA_VERSION = 1`、`CORE_SUPPORTED_SCHEMA_VERSION = 2`;`MIGRATIONS = ((1,_V1),(2,_V2))`(`:664`)。
- `_V1` 哈希钉死(`_validate_registered_migrations:714-724`),禁改——与工单一致。
- 因此只能加 `_V3` 重建 `commands` 表。但 `_apply_migrations:772-778` 只应用 `version <= target_version`,而普通写者传的正是 `CORE_ACTIVE_SCHEMA_VERSION`。**要让 `_V3` 生效就必须把 ACTIVE 抬到 3,而抬到 3 会顺带把 `_V2` 一并应用**(循环按序补齐)。
- `_V2` 是 M3-R1b 的 attention 表组,源码注释明写(`:662-663`):*"The bridge validates both hashes but only applies migrations through v1. R1b will raise ACTIVE to 2 in a later, independently reviewable commit."*
- 它被**两道测试钉住**:`test_core_v1_event_store.py:205-206` 硬断言 `ACTIVE == 1 and SUPPORTED == 2`;`test_core_v1_m3_r1b_v2_activation.py:321-357` 做 **AST 级**扫描,断言全仓只有 `activate_core_schema_v2` 一个函数可以请求 `migration_target=2`。

→ 本单做第 4 处 = 越权激活 WO M3-R1b 的 v2,并踩红其专属套件。这是**另一个工单的领地**,与"同机另有执行器在跑"的并行纪律直接冲突。

**第 5 处 `core/permission_evidence_shadow.py`** —— **根本没有阶梯可照**:

- `_SCHEMA_STATEMENTS` 是一个扁平元组(`:29-71`),`SCHEMA_VERSION = 1`(`:26`),`_verify_schema:208-214` 要求账本**恰好一行**且等于 `(1, sha(_SCHEMA_STATEMENTS))`。
- 工单说"迁移哈希机制**照 shadow 既有阶梯**"——此处不存在这样的阶梯。就地改 `_SCHEMA_STATEMENTS` 会让每个存量库报 `permission evidence schema ledger mismatch`,而这是 **pre-READY 启动闸**(`verify_permission_evidence_runtime:275`),后果是 Core 运行时拒绝启动。
- 合规做法需要**从零发明**一套迁移阶梯 + 改写 `_verify_schema` 接受多行账本。那是一次独立的 Core schema 工程,不是本单的加法。

### 一个可能让②整体降级的发现(需治理侧确认)

GW-01 把扩词表定为"头号硬前提(不做就静默丢数据)"。该判断成立的前提是**存在一条真以 `origin="delegated"` 落到 Core 的路径**。按 §3.3 的 T1 形态,这条路径**并不出现**:

- 子代理是 `lykoi-agent-1` 下的 **Claude Code 无头进程**,它不 import `lykoi.kernel.dispatch`,其动作不经 Lykoi 的 dispatch 管线;
- Runner 自己的合同状态迁移走 `kernel.delegation.transition()`(`delegation.py:312`),写 memory.db + guardian sink,**不经 `_shadow_call`**;
- `delegation.*` 三动作按 GW-01 是**她**以 `origin="interactive"` 发起的。

→ 六处词表是**未来**"子代理动作经 Lykoi dispatch 中介"时的前提,不在 T1 执行面的关键路径上。**请治理侧裁决**:②是整单前置(则需与 M3-R1b 合并为一张 Core schema 工单),还是可与 T1 执行面解耦、留到解钉那一步。

### ①b `dispatched` 消费侧挂点 —— 选独立 `lykoi-runner` 单元

现状:**无人轮询 `dispatched`**,GW-01 把合同推到该态即停。三个候选宿主:

- `cognition/scheduler.py:140 TASKS` —— 形态最贴合(`ScheduledTask` + `run_scheduler:146` 轮询循环),**但 `cognition/` 是本单 forbidden 领地(WO-CB-01 在跑)**,排除;
- `cognition/autonomous.py` —— 同样 forbidden,且它有 `interactive_lock` 让位语义,委托执行不该被对话让位,语义也不合;
- **独立 `lykoi-runner` systemd 单元** —— 自带轮询循环,零侵入既有五服务,满足判据⑦"Runner/broker 不装不影响既有五服务";判据⑥ 本身也已预设 `lykoi-runner` 入 repo。

→ **选独立单元**,论证如上。

### ①c systemd 登记形态

五个 `.service` **平铺在仓库根目录**(`lykoi-{core,server,autonomy,telegram,broker}.service`),另有 `guardian/watchdog.service`。约定:`User=/Group=lykoi`、`WorkingDirectory=/home/lykoi/projects/lykoi`、`PYTHONPATH=.../src`、`ExecStart=.../.venv/bin/python -m <module>`、`UMask=0077`、`ExecStartPre=guardian/startup_verify.py`(core/autonomy 有,broker 无)。无 drop-in 先例。`lykoi-runner.service` 照此登记。

### ①d handles.yaml 载体 —— ⚠ 与工单表述不符

**`lykoi-broker.service` 与 `src/lykoi/broker/` 已经存在**(WO-P2-03A 交付),且:

- 载体是 **`handles.json` 不是 `handles.yaml`**:`lykoi-broker.service:16` `LYKOI_BROKER_HANDLES=/home/lykoi/secrets/handles.json`;`broker/config.py:3-8` 明写该偏离及理由(仓内无 yaml 依赖,`requirements.txt` 确无 pyyaml)。
- 仓内**尚无占位样例文件**——这一条是本单的真实缺口。
- 权限假设:`root:lykoi 0640` → 实际单元用 `User=lykoi-broker`,secrets 只对该账户可读;`UMask=0077`。

### ①e 代理箱

`192.168.0.202:7890` 是**真实在用**的 Telegram 代理:`resources/telegram_transport.py:39 DEFAULT_PROXY`、`lykoi-telegram.service:15`。工作副本无 root、无该网段可达性,**Runner 侧网络白名单只能按假设交付**(合同 `network.allow` → 代理白名单参数),活体实测归合并包 E 步。

---

## 另外三处与工单表述不符(一并请裁决)

1. **判据④ 的 broker 大部分已存在**。已有:独立单元+独立用户、`http_proxy` 反代注入真 key(`app.py:129`)、`allowed_paths` 白名单(`:118`)、票据带 `contract_id`(`tickets.py:29`)、10 条测试。**真实缺口只有三个**:①票据**不读库**,合同 `state IN ('expired','rejected')` 不使票据失效(现仅时间过期 `tickets.py:39`);②审计落自有 `audit.jsonl` 且事件名是 `grant`/`proxy_use`,**不是**落既有 guardian sink 的 `secret_handle_grant`(`audit.py:6-8` 明写"must not couple to guardian");③无 handles 占位样例。
2. **判据③ 的 `completed`/`failed` 两个状态不存在**。冻结设计七态 CHECK 已入活体(`delegation.py:71-90`):`draft/dispatched/running/collected/verified/rejected/expired`。`dispatched→running→completed/failed` 无法照写;对应的合法迁移是 `running→collected`(成功)与 `→rejected`(失败)。我按设计的七态实现并在报告写明映射,除非你要求改 CHECK(那又是一次 Core 迁移)。
3. **broker 审计双写的矛盾**:判据④ 要求落既有 guardian sink,但 sink 写 `LYKOI_AUDIT_PATH`(`guardian/audit_sink.py:13`,生产为 root-owned append-only),而 broker 以 `lykoi-broker` 身份跑。跨用户写同一 append-only 文件需要 root 侧权限布置——这条我会写进判据⑥ 的合并包核对清单。

---

## 我的建议与下一步

**②按"解耦"处理**:不强行激活 Core v2/v3(会踩红 M3-R1b 专属套件、越权改另一工单领地),改为交付一条**先红后绿之外的第三形态**——把现状钉死成显式负例测试(记录"delegated 落 Core 会被 fail-open 静默吞"这一事实 + 指向所需的 Core 工单),并把六处词表的完整扩法写成合并包事项。然后**完整交付 ③④⑤⑥⑦⑧**(Runner、broker 三缺口、四条可测执行面、部署件、零扰动、manifest 重签)。

**这需要你拍板**,因为两种读法产出的东西差别很大:
- **(A) 解耦**(我推荐):本单交出可用的 T1 执行面,②降级为负例+合并包事项;
- **(B) 硬做②**:则本单必须扩大为"GW-02 + M3-R1b 联合 Core schema 工单",并与同机在跑的执行器协调——超出当前工单边界。

另:全量基线尚未复跑。实测 `test_gw01_delegation.py` 单文件 **61 passed / 338s**,按此速率 2178 条约需 3 小时以上、20+ 个分段。若你选 (A) 我就照判据⑧ 跑完;若选 (B) 则基线要等工单重划后再跑,现在跑会白费。

请指示 A 还是 B。
