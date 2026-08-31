# WO-M0-CORE-RETIRE · core 包退役审查报告

基线：`~/lykoi-work-m0/`（HEAD `4463ae8` / tag `cordis-night-20260822` 文件树只读副本）。本单零写入，未运行 pytest，未触碰 `/home/lykoi/`。
标注约定：**[事实]** = 本副本代码/配置直接可证；**[推断]** = 需活体核对；**[建议]** = 处置意见。

---

## 1. core 今天实际提供什么

### 1.1 `core/runtime.py` 主循环（1,732 行）

**[事实]** `lykoi-core.service` 的 ExecStart 是 `python -m lykoi.core.runtime`，进入 `main()`（`runtime.py:1366`）。进程做两件事：

1. **持有一个 Unix socket + lock 的整生命周期**（`serve_forever`，`runtime.py:1246`），协议为 4 字节网络序长度前缀 + 一条 UTF-8 JSON，一连接一请求一响应（`runtime.py:12-19`）。支持的 op：`register_producer`、Event 提交、execution session start/complete、permission evidence 记录。
2. **一个可选的 maintenance tick**（`runtime.py:1255-1264`），默认间隔 2.0s。

**maintenance tick 实际是四选一 + 叠加，不是三种**（`runtime.py:1385-1631`）。按 `main()` 的 if/elif 链精确还原：

| 档 | 门控 env | tick 函数 | 间隔 |
|---|---|---|---|
| （A）schema v2 一次性激活 | `LYKOI_CORE_SCHEMA_V2_ACTIVATION` | **无 tick**，只有 `schema_initializer`（`runtime.py:1424`） | — |
| （B）AttentionDecision 生成 | `LYKOI_CORE_ATTENTION_DECISION_ENABLED`（且必须先有 candidate 权限） | `run_decision_worker`（`runtime.py:1449`） | `attention_decision.DECISION_TICK_SECONDS` |
| （C）AttentionCandidate 回填 | `LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED`（且要求 `LYKOI_CORE_EVENT_INGRESS_ENABLED=1`） | `run_candidate_backfill`（`runtime.py:1509`），**回填完成即自锁**（`candidate_backfill_done`，`runtime.py:1550`） | `BACKFILL_INTERVAL_SECONDS` |
| （D）R2A 执行会话对账 | `LYKOI_CORE_EXECUTION_SESSION_ENABLED` | `run_r2a_maintenance`（`runtime.py:1587`），**包裹**前一档 tick 后再跑 `reconcile_execution_sessions` | `min(前档, RECONCILIATION_TICK_SECONDS)` |

另有两个**只加 initializer、不加 tick** 的档：R2C-R1 permission evidence shadow（`runtime.py:1633`）、R2C-R2 permission replay 一次性只读回放门（`runtime.py:1660`）。

**[事实]** 三档 tick 的错误策略统一：只有 SQLite `locked`/`busy` 与 `TimeoutError` 可重试并打印 `*_RETRY`，其余任何异常**直接掀掉这代 Core 进程**（`runtime.py:1477-1487`、`1531-1545`、`1607-1620`）。配合 `Restart=always` + `RestartSec=2`，一个持续性错误 = 无限重启循环。

**[事实]** 全部 maintenance 语义的实现体不在 `runtime.py`，而在 `shadow.py`（`record_core_events`、`backfill_attention_candidates`、`run_attention_decision_cycle`、`reconcile_execution_sessions`、`start/complete_execution_session`），由 `main()` 内**惰性 import** 拉起（`runtime.py:1414/1422/1433/1498/1564`）。这个惰性设计的目的写在注释里：让 producer 侧 import `runtime_client` 时不获得 DB 写权限。

### 1.2 core.sock 谁在用

**[事实]** 全树 grep `core\.sock|core-v1|core\.lock`（排除 docs/tests）只命中 6 处，全部是**定义方**，无第三方硬编码消费者：

```
lykoi-core.service:13-14        Environment=LYKOI_CORE_RUNTIME_SOCKET / _LOCK
core/runtime.py:58-59           DEFAULT_SOCKET_PATH / DEFAULT_LOCK_PATH
core/attention_decision.py:80   域分隔常量字面量（非路径）
core/baseline.py:31-32          版本字符串（非路径）
```

**唯一的 socket 客户端是 `core/runtime_client.py`**，路径经 `_runtime_socket_path()`（`runtime_client.py:73`）从 `LYKOI_CORE_RUNTIME_SOCKET` 读，缺省回落到 `runtime.DEFAULT_SOCKET_PATH`。

**[事实] 关键：其余五个 .service 文件里没有任何一个设置 `LYKOI_CORE_RUNTIME_SOCKET`**（逐一 grep `Environment=` 已确认）。所以消费者进程若要连对 socket，只能靠**活体 drop-in** 注入该变量，否则用缺省路径。

### 1.3 `runtime_client` 注册对三服务的实际作用

**[事实] 修正 scope 的措辞：调用 `start_registration()` 的只有两个服务，不是三个。**

| 调用点 | 服务 | instance |
|---|---|---|
| `surface/app.py:90`（FastAPI lifespan） | `lykoi-server.service` | `"lykoi-server"` |
| `cognition/autonomous.py:400`（`main()`） | `lykoi-autonomy.service` | `"lykoi-autonomy"` |

**"三服务"的第三方是 socket 协议层的第三类角色，不是第三个注册者**。`execution_session.py:25-26` 的 cgroup 允许表只有 `lykoi-server` 与 `lykoi-autonomy` 两个 executor；`event_protocol.py:33` 的 Event producer 只认 `lykoi-server`；`permission_evidence.py:27` 的 evidence producer 也只认 `lykoi-server`。**[推断]** scope 里的"三服务"更可能指**三类 op**（register / event / execution+evidence），或把 `kernel/dispatch.py` 的 executor 客户端算作独立第三方——dispatch 在 `dispatch.py:566-667` 直接调 `start_execution`/`complete_execution`，走同一条 socket 但**不走注册**。这一点请在活体 drop-in 上核对。

**[事实] 注册的作用是"近乎为零"**，三重证据：

1. **默认关**。`enabled()`（`runtime_client.py:63`）读 `LYKOI_CORE_RUNTIME_ENABLED`，**缺省 `"0"`**。该变量在本副本的**任何 .service 文件里都不存在**。未开启时 `start_registration` 直接 `return False`，不做身份收集、不碰 socket、不发遥测。
2. **完全 fail-open**。`register_producer` 的 docstring 明写 "returning success without ever gating startup"（`runtime_client.py:877`）；`ProducerRegistrar.start()` 即使 `Thread.start()` 抛异常也只记一条遥测后 `return False`（`runtime_client.py:812-819`）；`stop_registration` 是无条件 no-throw。
3. **语义上被明确剥夺意义**。`ProducerRegistrar` docstring：「A refresh proves only that this process could reach one runtime generation at that instant. Missing refreshes are connectivity telemetry, **never death evidence and never permission to reconcile a Command**」（`runtime_client.py:688-692`）。

**唯一的实际下游** 是自我模型的一个布尔位：`self_state_sources.py:256` 把 `runtime_client.registration_status()` 作为 `core_registered=` 喂进 capability 快照。`registration_status()`（`runtime_client.py:1005`）自身 docstring 也声明这是 "content-free local fact ... **never a permission decision**"。

### 1.4 `core_runtime_registration_failed` 反复重试的根因

**[事实]** 该观察项只有两个发射点：`runtime_client.py:779`（`ProducerRegistrar._transition_failure`）与 `runtime_client.py:891`（模块级 `register_producer`）。后者在 src/ 内**无调用者**（全树 grep `runtime_client.` 只见 `start_registration`/`stop_registration`/`registration_status`/`submit_events`/`start_execution`/`complete_execution`），所以活体日志实际全部来自前者。

**根因定位（三层，按可能性排序）：**

**[事实] 层一 —— 日志是去重的，所以"反复出现"本身就说明状态在翻转或进程在重启。** `_transition_failure` 只在 `changed = self._status != "unavailable"` 时才 `_safe_log`（`runtime_client.py:770-781`）。持续连不上 socket 的稳态只会打**一条**。因此反复刷屏必然是下面两种之一：

- **[推断] 1a：进程反复重启。** 每次 server/autonomy 重启，`_status` 从 `None` 起步，首次失败必打一条。若 `lykoi-core.service` 因 §1.1 的"非重试异常即掀进程"策略进入 `Restart=always` 循环，其 socket 会周期性消失/重建，消费者侧则每轮翻转一次 registered↔unavailable，**每次翻转都打一条**（`_transition_success` 的 `changed` 同样会触发 `core_runtime_registered`）。**若活体日志里 `core_runtime_registration_failed` 与 `core_runtime_registered` 成对交替出现，即坐实此因。**
- **[事实] 1b：刷新周期是 30s。** `REFRESH_INTERVAL_SECONDS = 30.0`（`runtime_client.py:39`），翻转型故障的日志节奏上限就是 30s 一条。

**[事实] 层二 —— 超时预算极紧，是翻转的天然放大器。** `ROUNDTRIP_TIMEOUT_SECONDS = 0.25`（`runtime_client.py:31`），而这 250ms **从本地身份收集之前就开始计时**（`_register_once`，`runtime_client.py:1174-1177` 附近的注释明确说明 deadline "deliberately begins before local identity collection"）。`_producer_dict()` 要读 `/proc` 拿 `pid`/`proc_start_ticks`/`host_boot_id`/`client_boot_id`，随后还要 connect + 两次 framed I/O，每步都重算 `_remaining()`。**在机器负载高时，250ms 预算天然会间歇性击穿，产生 registered↔unavailable 的抖动，正好喂给层一的翻转型刷屏。**

**[事实] 层三 —— 校验极严，任何一处不匹配都是 `RuntimeRegistrationError`。** `_validate_response`（`runtime_client.py:137-173`）要求响应字段集**精确等于** `{protocol_version, request_id, ok, runtime_boot_id, result}`，`result` 字段集精确等于 `{registered, producer}`，且**回显的 producer 必须与请求逐字段相等**（`dict(echoed) != dict(producer)` 即失败）。跨 Core 代际时 `runtime_boot_id` 变化会走 `_transition_success` 的 `runtime_changed=True` 分支——**这条路径不打 failed，但证明代际翻转是被显式预期的常态**。

**[建议]** 定位收口只需一条活体命令（本单不执行）：比对 journal 中 `core_runtime_registration_failed` 与 `core_runtime_registered` 的时间戳序列。成对交替 → 1a（Core 重启循环）；只有 failed 且间隔 ≫30s → 进程重启；只有 failed 且严格 30s 节拍 → 与 `changed` 去重逻辑矛盾，需查 `_safe_log` 是否被活体改写。**无论哪一支，结论都是同一个：这条观察项对行为零影响，退役 core 后它自然消失，不需要单独修。**

---

## 2. 逐文件判定表（20 文件 / 13,282 行）

先给**外部消费者普查**（grep 实测，`src/` 内排除 `src/lykoi/core/` 自身）。这是全部判定的证据基座：

| 被 import 的 core 模块 | 外部消费者（文件:行） |
|---|---|
| `runtime_client` | `cognition/autonomous.py:38`、`cognition/self_state_sources.py:16`、`surface/app.py:21`、`surface/perception.py:17`、`kernel/dispatch.py:566,580,625,665` |
| `self_state` | `cognition/self_state_context.py:14`、`self_state_live_runtime.py:20`、`self_state_runtime.py:25` |
| `capability_registry` | `cognition/self_state_live_runtime.py:18`、`self_state_runtime.py:20` |
| `capability_status` | `cognition/self_state_live_runtime.py:19`、`self_state_runtime.py:24`、`self_state_sources.py:17` |
| `shadow` | `kernel/dispatch.py:93,124` |
| `execution_session` | `kernel/dispatch.py:187,436,580,625,665` |
| `event_protocol` | `surface/perception.py:17` |
| **以上 7 个之外的 13 个模块** | **零外部 import** |

注意 `runtime.py` 虽无外部直接 import，但 `runtime_client.py:25` 导入它（取 `SOCKET_ENV`、`send_frame`、`recv_frame`、`ProducerSession`），**所以每个 import `runtime_client` 的进程都会加载 `runtime.py` 全模块**。这是退役时最容易踩的隐性依赖。

| # | 文件 | 行数 | 外部消费者 | 判定 | 理由 / 新归属 |
|---|---|---|---|---|---|
| 1 | `__init__.py` | 8 | — | **退役** | 纯包 docstring，随目录消失 |
| 2 | `schema_protocol.py` | 46 | — | **退役** | 一次性 schema-v2 激活授权契约；`v2_activation_requested()` 只被 `runtime.py:1391` 用。迁移无 SQLite schema 继承 |
| 3 | `attention_candidate.py` | 111 | — | **语义承接** | 候选形成契约 → **由新世界的心脏显著性（salience）承接**。本体退役，`BACKFILL_INTERVAL_SECONDS`/候选规范化规则值得作为设计输入抄走 |
| 4 | `attention_decision.py` | 163 | — | **语义承接** | 同上，决策层 → 心脏显著性的裁决段。注意其 `load_active_policy()` 的**每 tick 重新哈希封存策略**模式（`runtime.py:1451-1459`）是个好设计，**[建议]** 在 Cordis 侧保留该不变量 |
| 5 | `capability_status.py` | 183 | `self_state_live_runtime.py:19`、`self_state_runtime.py:24`、`self_state_sources.py:17` | **保留（迁移）** | 纯函数时间窗能力状态装配，无 SQLite/无 IO（docstring 自述 "never reads those sources itself"）。**新归属：Cordis 自我模型层**。这是 core 里最值得原样移植的一块 |
| 6 | `capability_registry.py` | 240 | `self_state_live_runtime.py:18`、`self_state_runtime.py:20` | **保留（迁移）** | Guardian 封存的能力拓扑表 + `SEALED_REGISTRY_SHA256`。**新归属：Cordis 自我模型层**。**[风险]** 封存哈希与 `guardian/manifest.sha256` 联动，迁移需重签 |
| 7 | `permission_evidence.py` | 289 | — | **语义承接** | 内容无关的 owner 许可决策事实契约 → **由治理层策略承接**。含 `SERVER_PRODUCER_CGROUP` 角色断言 |
| 8 | `self_state.py` | 291 | `self_state_context.py:14`、`self_state_live_runtime.py:20`、`self_state_runtime.py:25` | **保留（迁移）** | **cognition 侧真实在用，且已接入活体会话路径**（见 §3 详析）。**新归属：Cordis 自我模型层**，`SelfStateView` 是 `CognitionSelfStateContext` 的构造输入 |
| 9 | `execution_session.py` | 377 | `kernel/dispatch.py:187,436,580,625,665` | **语义承接 + 需替身** | dispatch 有 5 处调用，**是全树对 core 耦合最深的模块**。R2A 执行会话 → **由 Cordis 运行时的执行追踪承接**。退役前 dispatch 侧需按 §3 处理 |
| 10 | `capability_contract.py` | 404 | 无直接（`self_state.py:16` 间接） | **保留（迁移）** | `CapabilitySnapshot`/`CapabilityStatus` 数据类，是 #5/#6/#8 的公共类型底座。**必须与它们同批迁移**，否则三者断裂 |
| 11 | `permission_learning.py` | 405 | — | **语义承接** | R2C-R0 纯评估器 → **治理层策略**。docstring 自述不读任何文件/SQLite/prompt |
| 12 | `permission_replay.py` | 431 | 无外部（`runtime.py:49` 内部） | **退役** | R2C-R2 反事实回放门，一次性只读诊断，无下游消费者 |
| 13 | `attention_policy.py` | 433 | — | **语义承接** | 封闭确定性策略解析器 → **心脏显著性策略**。策略字节由 owner 单独封存 |
| 14 | `permission_evidence_shadow.py` | 487 | — | **退役** | ⚠️ **文件不可读（治理账户 0600，R2c 影子产物）**。按引用侧证据推断：仅 `runtime.py:1639,1667` 惰性 import，`permission_evidence_shadow.py:21/394`（manifest 侧行号）显示它只依赖 `permission_evidence`/`permission_replay`。**独立影子 DB，与 `core_facts.db` 分离**，无 cognition 消费者 |
| 15 | `permission_projection.py` | 490 | — | **语义承接** | 封存投影策略 → **治理层策略**。仅被 `permission_replay.py` 用 |
| 16 | `event_protocol.py` | 527 | `surface/perception.py:17` | **语义承接 + 需替身** | Event 信封 + producer 角色契约。`perception.py` 用 `ingress_enabled()` 门控整个 outbox 协程（`perception.py:345`）。→ **由 Cordis 事件总线承接** |
| 17 | `baseline.py` | 923 | — | **退役（可归档）** | CORE-V1-00 只读诊断与离线重放。**[建议]** 不迁移，但**报告产物**（`REPORT_VERSION = "core-v1-baseline/1"`）若有历史留档价值，归档到 docs/ 而非代码 |
| 18 | `runtime_client.py` | 1,047 | 8 处（见上表） | **退役** | 三服务 socket 客户端。core 退役后无服务端可连，全部调用点按 §3 删除 |
| 19 | `runtime.py` | 1,732 | 无直接（`runtime_client.py:25` 间接，**影响面见上文警告**） | **退役** | `lykoi-core.service` 的进程本体。Cordis 运行时整体取代 |
| 20 | `shadow.py` | 4,695 | `kernel/dispatch.py:93,124` | **退役（数据需处置）** | **占全包 35%**，是所有 maintenance 语义的实现体。dispatch 的两处只是 fail-open 影子记录。**⚠️ 但它是 `/home/lykoi/state/core_facts.db` 的唯一写入者**，退役 = 该 DB 冻结，见 §5 |

**判定小计：退役 8（#1,2,12,14,17,18,19,20）· 保留迁移 4（#5,6,8,10）· 语义承接 8（#3,4,7,9,11,13,15,16）。合计 20，无遗漏。**

**关于 `shadow.py` 与 `self_state.py` 的特别小心（scope 点名要求）：**

- **[事实] `shadow.py` 的 cognition 侧消费者为零。** 唯二外部引用在 `kernel/dispatch.py:93`（`_build_attempt`）与 `:124`（`_shadow_call`），两处都在 `try/except Exception` 内，异常只打 `core_shadow_error` 遥测，注释明写 "shadow failure cannot steer dispatch"。且 `shadow.enabled()`（`shadow.py:681`）在 env **absent 或 `"0"` 时返回 False**，`_build_attempt` 随即 `return None`，`_shadow_call` 对 `None` 直接 return。**结论：dispatch 侧删除是纯安全操作。**
- **[事实] `self_state.py` 相反，必须小心。** 链路是：`core.self_state.build_self_state` → `cognition/self_state_context.py:14` 构造 `CognitionSelfStateContext` → `cognition/self_state_live_runtime.py` 组装 → `cognition/conversation.py:1843` 经 `self_state_live_audit.evaluate_and_log_live_injection()` 拿到 `live.context` → `conversation.py:1853,1857` 注入实际对话，同时 `mind/decide.py:295,307` 也以该类型为参数。**这条链已经通到活体会话，不是影子。** 它由 `LIVE_INJECTION_FLAG_PATH = /home/lykoi/runtime/governance/self_state_injection.on` 的**文件存在性**门控（`self_state_live_runtime.py:25`），**不是 env**——**[推断] 该 flag 活体是否置位，本副本无法判定，必须核对。** 这是"保留迁移"而非"退役"的直接原因。

---

## 3. 依赖断链表

**[事实] 先给一个重要的负面结论：`mind/`、`resources/`、`memory/`、`broker/`、`runner/`、`shared/` 对 `lykoi.core` 的 import 数为零**（grep 实测）。scope 提到的 "mind/ 与 resources/ 里对 core 的调用" —— **实测不存在**。`mind/decide.py` 只经 `cognition.self_state_context` 间接接触 `SelfStateView` 类型。断链面比预期小。

| # | 位置 | 引用内容 | 门控现状 | 处置 |
|---|---|---|---|---|
| 1 | `kernel/dispatch.py:93` | `from lykoi.core import shadow` | `shadow.enabled()`，env 缺省 False | **随 core 退役删除**。整个 `_build_attempt` 函数体连同 `core_shadow_error` 遥测一并移除 |
| 2 | `kernel/dispatch.py:124` | `from lykoi.core import shadow` | 同上，且 `attempt is None` 时直接 return | **随 core 退役删除**。`_shadow_call` 整函数移除，其所有调用点改为无操作 |
| 3 | `kernel/dispatch.py:187` | `execution_session.ExecutionAttempt.from_dict` | 由 #4 的 `execution_session_active` 决定是否被调 | **需替身（若 R2B 活体已开）／否则随删**。见下方判定 |
| 4 | `kernel/dispatch.py:436` | `execution_session.client_execution_session_enabled()` | `LYKOI_EXECUTION_SESSION_CLIENT_ENABLED`。**注意此处 fail-closed**：异常时 `execution_session_active = False` 并保留 `execution_configuration_error`（`dispatch.py:441-444`） | **需替身**。这是唯一一处**畸形配置不 fail-open** 的 core 耦合，删除时必须同步删掉 `execution_configuration_error` 的下游处理，否则留下悬空变量 |
| 5 | `kernel/dispatch.py:566,580` | `runtime_client.start_execution(...)` | 同 #4 门控 | **随 core 退役删除** |
| 6 | `kernel/dispatch.py:584,625,667` | `runtime_client.complete_execution(...)` | 同 #4 门控 | **随 core 退役删除** |
| 7 | `surface/app.py:21,90,115` | `runtime_client.start/stop_registration("lykoi-server")` | `LYKOI_CORE_RUNTIME_ENABLED`，缺省 `"0"` | **随 core 退役删除**。lifespan 内两行 + 顶部 import |
| 8 | `surface/perception.py:17,311` | `event_protocol` + `runtime_client.submit_events` | `event_protocol.ingress_enabled()`；**`run_core_event_outbox` 在未开启时第一时间 `return`**（`perception.py:345-346`） | **需替身或整段删除**。若活体 ingress 关，则 `app.py:105` 创建的 `event_outbox` task 是**立即返回的空协程 = 死引用**。**[推断] 需核对 `LYKOI_CORE_EVENT_INGRESS_ENABLED` 活体值** |
| 9 | `cognition/autonomous.py:38,400,414` | `runtime_client.start/stop_registration("lykoi-autonomy")` | `LYKOI_CORE_RUNTIME_ENABLED`，缺省 `"0"` | **随 core 退役删除** |
| 10 | `cognition/self_state_sources.py:16,256` | `runtime_client.registration_status()` → `core_registered=` | 无门控，**总是被调用** | **需替身**。最小替身：常量 `False`，或在 Cordis 侧改喂真实运行时注册位。**这是注册机制唯一的真实下游** |
| 11 | `cognition/self_state_sources.py:17` | `capability_status.StatusObservation` | 无门控 | **随 #5 模块迁移改 import 路径**，不删 |
| 12 | `cognition/self_state_context.py:14` | `core.self_state.SelfStateView` | 无门控 | **随 #8 模块迁移改 import 路径**，不删 |
| 13 | `cognition/self_state_live_runtime.py:18,19,20` | `capability_registry`、`capability_status`、`self_state` | `self_state_injection.on` 文件门控 | **随模块迁移改 import 路径**，不删。**活体链路，最高优先级保住** |
| 14 | `cognition/self_state_runtime.py:20,24,25` | 同上三模块 | `self_state_shadow.on` 文件门控 | **随模块迁移改 import 路径**。**[建议]** 该 shadow provider 与 #13 的 live 版功能重叠（S6 vs S9），退役窗口是个顺手合并的机会 |

**断链汇总：随 core 退役删除 6 处（#1,2,5,6,7,9）· 需替身 4 处（#3,4,8,10）· 改 import 路径保留 4 处（#11,12,13,14）。**

---

## 4. 退役步骤建议（工单粒度）

### 4.0 前置：必须先核对的活体事实（阻塞其余步骤）

**[推断]** 本副本无 .git、无 drop-in、无 `/home/lykoi/` 访问，以下五项**必须活体核对后才能定稿工单**：

1. `systemctl show lykoi-server lykoi-autonomy -p Environment` —— 确认 `LYKOI_CORE_RUNTIME_ENABLED` 是否被 drop-in 置为 1。
2. 同上确认 `LYKOI_CORE_EVENT_INGRESS_ENABLED`、`LYKOI_EXECUTION_SESSION_CLIENT_ENABLED`、`LYKOI_CORE_SHADOW_ENABLED`。
3. `ls /etc/systemd/system/lykoi-core.service.d/` —— drop-in 全清单。
4. `test -e /home/lykoi/runtime/governance/self_state_injection.on` —— **决定 §2 #8 是"保留迁移"还是可直接退役**。
5. `test -e /home/lykoi/runtime/governance/self_state_shadow.on`。

### 4.1 服务停用顺序：**先消费者，后 lykoi-core**

**[建议]** 顺序如下，理由紧随：

```
① 关消费者侧开关（drop-in 改 env / systemctl restart lykoi-server lykoi-autonomy）
② 观察一个完整周期，确认 core_runtime_registration_failed 停止刷屏
③ systemctl stop lykoi-core && systemctl disable lykoi-core
④ 代码删除（§3）+ manifest 重签（§4.4）
⑤ 移除 lykoi-core.service 与其 drop-in 目录
```

**[事实] 但要点在于：先后顺序在此处并不影响正确性，只影响日志噪音。** 因为 `runtime_client` 全链 fail-open（§1.3），先停 `lykoi-core` 也不会让任何消费者崩。**[建议] 之所以仍推荐先关消费者，是为了让步骤 ② 提供一个干净的观察窗**——如果关掉消费者开关后仍有 core 相关告警，说明存在本副本看不到的活体耦合，此时尚未 stop core，回退成本为零。

### 4.2 drop-in 清理清单

**[推断]** 本副本无 drop-in 文件，以下按 `docs/` 的 prereg 文档体系与 `main()` 门控逻辑反推**应当存在**的 drop-in，活体逐项核对：

| 推断的 drop-in | 注入的 env | 对应 prereg |
|---|---|---|
| schema v2 激活（一次性，可能已删） | `LYKOI_CORE_SCHEMA_V2_ACTIVATION` | `core_v1_m3_r1b_v2_activation.md` |
| candidate 回填 | `LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED` + `LYKOI_CORE_EVENT_INGRESS_ENABLED` | `core_v1_m3_r1b_candidate_prereg_v1.md` |
| decision 生成 | `LYKOI_CORE_ATTENTION_DECISION_ENABLED` + `_POLICY_PATH` + `_POLICY_SHA256` | `core_v1_m3_r1c_decision_activation_prereg_v1.md` |
| R2A/R2B 执行会话 | `LYKOI_CORE_EXECUTION_SESSION_ENABLED`（core 侧）/ `LYKOI_EXECUTION_SESSION_CLIENT_ENABLED`（消费者侧） | `core_v1_m3_r2b_execution_activation_prereg_v1..v14.md`（**14 个版本**，说明这一档反复调整过，drop-in 最可能有残留） |
| R2C-R1 evidence shadow | `LYKOI_CORE_PERMISSION_EVIDENCE_SHADOW_ENABLED` + `_DB` | `core_v1_m3_r2c_s*_prereg.md` |
| R2C-R2 replay | `LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED` + `_POLICY_PATH` + `_POLICY_SHA256` | 同上 |

### 4.3 env 开关全清单（19 项，grep 实测穷举）

**[事实]** `core/` 内定义的全部 env 变量，退役后应全部消失：

```
LYKOI_CORE_RUNTIME_SOCKET              runtime.py:56     ← lykoi-core.service:13 显式设置
LYKOI_CORE_RUNTIME_LOCK                runtime.py:57     ← lykoi-core.service:14 显式设置
LYKOI_CORE_RUNTIME_ENABLED             runtime_client.py:65   ← 消费者侧总开关，缺省 "0"
LYKOI_CORE_EVENT_INGRESS_ENABLED       event_protocol.py:20
LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED attention_candidate.py:17
LYKOI_CORE_ATTENTION_DECISION_ENABLED  attention_decision.py:12
LYKOI_CORE_ATTENTION_POLICY_PATH       attention_decision.py:13
LYKOI_CORE_ATTENTION_POLICY_SHA256     attention_decision.py:14
LYKOI_CORE_EXECUTION_SESSION_ENABLED   execution_session.py:21
LYKOI_EXECUTION_SESSION_CLIENT_ENABLED execution_session.py:22
LYKOI_CORE_PERMISSION_EVIDENCE_SHADOW_ENABLED   permission_evidence.py:22
LYKOI_PERMISSION_EVIDENCE_SHADOW_CLIENT_ENABLED permission_evidence.py:23
LYKOI_PERMISSION_EVIDENCE_SHADOW_DB    permission_evidence.py:24
LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED     permission_replay.py:28
LYKOI_CORE_PERMISSION_REPLAY_POLICY_PATH        permission_replay.py:29
LYKOI_CORE_PERMISSION_REPLAY_POLICY_SHA256      permission_replay.py:30
LYKOI_CORE_SCHEMA_V2_ACTIVATION        schema_protocol.py:15
LYKOI_CORE_SHADOW_ENABLED              shadow.py:681
LYKOI_CORE_FACTS_DB                    shadow.py:690   ← 缺省 /home/lykoi/state/core_facts.db
LYKOI_CORE_ARTIFACT_DIR                shadow.py:695   ← 缺省 /home/lykoi/state/core_artifacts
```

**[事实] `LYKOI_CORE_SHADOW_ENABLED` 有一个已修复的历史陷阱值得记录**：`shadow.py:675-680` 的中文注释说明，早期实现在配置畸形（如 `Environment=LYKOI_CORE_SHADOW_ENABLED=` 空串）时 **fail-open 打开影子层**；现已改为「absent 或 `0` 关闭，恰好 `1` 打开，其余抛 `ShadowConflict`」。**清理 drop-in 时若留下空值赋值，在旧版本上会是打开而非关闭——[建议] 清理时直接删行，不要留空赋值。**

### 4.4 manifest 影响

**[事实]** `guardian/manifest.sha256` 共 **113 行**，其中 **core 条目 20 条（第 30–49 行），占 17.7%**。退役后精确剩 **93 条**。20 条与 §2 的 20 个文件一一对应，无遗漏无多余。

**[事实] 必须由 root 重签**：`startup_verify.py:260` —— `manifest missing: ... (run --write-manifest as root)`。

### 4.5 `startup_verify` 对 core root 封存的检查：**必须同步改，否则五服务全部起不来**

**[事实] 这是整个退役里最高危的一处。** `startup_verify.py:219` 的 `_check_protected_tree`：

```python
for label, directory, sources in (
    ("kernel", KERNEL_DIR, _kernel_py()),
    ("core",   CORE_DIR,   _core_py()),
):
    if not os.path.isdir(directory):
        problems.append(f"{label} dir missing: {directory}")   # ← 硬失败
        continue
```

**[事实] 删掉 `src/lykoi/core/` 目录会让 `startup_verify.py` 报 `core dir missing` 并失败。** 而 `startup_verify.py` 是 **`lykoi-server` / `lykoi-autonomy` / `lykoi-runner` / `lykoi-telegram` / `lykoi-core` 五个单元的 `ExecStartPre`**（逐服务 grep 确认；`lykoi-broker.service` 是唯一例外，没有这行）。

⇒ **删 core 目录 = 五个服务同时 ExecStartPre 失败 = 全系统停摆。**

**[建议] 因此步骤 ④ 的顺序不可颠倒**，必须严格：

```
1. 先改 startup_verify.py：从 _check_protected_tree 的元组里摘掉 ("core", CORE_DIR, _core_py())
   同时清理 CORE_DIR (:64)、_core_py() (:93-94)、_build_manifest_entries 里的 core 循环 (:130-131)
2. root 重签 manifest（93 条）
3. 才可以删 src/lykoi/core/
```

**[建议]** 另注意 `startup_verify.py` 的模块 docstring 第 13/16/26 行三处提到 core，属注释，**同批更新以免误导后人**。

### 4.6 测试影响

**[事实]** 精确数字（`grep -c "def test_"`，未运行 pytest）：

| 指标 | 副本实测 | 活体推算 |
|---|---|---|
| `test_core_v1_*.py` 文件数 | **39** | **[推断] 42**（副本缺 3 个：`test_core_v1_m3_r2c_r1_permission_evidence.py`、`_r2_permission_replay.py`、`_r3_projection_candidate.py`） |
| `test_core_v1_*` 用例数 | **558** | **[推断] > 558**（缺 3 文件的用例数不可读） |
| tests/ 总文件数 | **150** | **154**（题面给定；副本另缺 `test_salience_shadow_release_audit.py`） |
| tests/ 总用例数 | **2,074** | **[推断] > 2074** |

**[事实] 退役后基线数字（副本口径）：150 − 39 = 111 文件，2074 − 558 = 1,516 用例。core_v1 测试占总用例的 26.9%——退役会让基线用例数掉掉超过四分之一，这个跌幅必须提前写进工单，否则会被误读为测试丢失。**

**[事实] 另有 7 个非 `test_core_v1_*` 的测试文件 import `lykoi.core`，它们不随 core 退役删除，必须逐个改造：**

```
tests/test_gw01_delegation.py
tests/test_gw02_delegated_origin_negative.py
testsis/test_gw02_deployment.py
tests/test_gw02_zero_disturbance.py
tests/test_perception_ingest.py
tests/test_rebuild_config_backup.py
tests/test_u3s_zero_disturbance.py
```

（更正：上表第三行为 `tests/test_gw02_deployment.py`。）

**[建议]** 这 7 个是退役工单里最容易漏的一块——它们不在 `test_core_v1_*` 命名域内，按文件名批量删除的脚本会放过它们，然后在 CI 里以 `ImportError` 形式炸出来。**单独列一条子工单。**

**[事实]** 副本缺的 5 个文件中，3 个是 `test_core_v1_*`（随退役删除，无风险），`test_salience_shadow_release_audit.py` 按文件名**[推断]** 与 attention→显著性承接相关，**是 §2 #3/#4 语义承接的重要参考，退役前应先读过它再删**。

---

## 5. 风险表（分"移植期间可先做" / "必须等 M4 切换"两档）

### 5.0 先直答 scope 的点名问题：**现在就停 `lykoi-core`，其余四服务不受影响；注册失败是降级，不是致命**

**[事实] 四条独立证据链，全部指向"降级"：**

1. **总开关缺省关闭。** `LYKOI_CORE_RUNTIME_ENABLED` 缺省 `"0"`（`runtime_client.py:65`），且**不在任何 .service 文件中**。未开启时 `start_registration` 第一行就 `return False`，连 socket 都不碰。
2. **开启后也 fail-open。** `_attempt()` 的 `except Exception` 覆盖一切（`runtime_client.py:781-787`），失败只走 `_transition_failure` 记遥测。`register_producer` docstring 明写 "**never gating startup**"。
3. **刷新线程创建失败也不致命。** `runtime_client.py:812-819`，`Thread.start()` 抛异常时清理状态后 `return False`，调用方 `surface/app.py:90` / `autonomous.py:400` 都是裸调用，不检查返回值、不进 try。
4. **`stop_registration` 是无条件 no-throw**（`runtime_client.py:1023`，`except Exception: return`），关停路径不会阻塞 app shutdown。

**[事实] 唯一可观察的行为变化**：`self_state_sources.py:256` 的 `core_registered` 恒为 `False`，使能力自我模型里那一位翻转。而 `registration_status()` 的 docstring 已明确声明它 "**never a permission decision**"，且其消费链（`capability_status.build_snapshot` → `self_state` → cognition envelope）在 `self_state_context.py:20-26` 里被标注为 `{"instruction": "none", "permission": "none"}`——**没有任何权限或行为分支读它**。

**[事实] 但有两处必须同时确认，否则"停 core"不等于"无影响"：**

- **[事实] `lykoi-core.service:3` 有 `Before=lykoi-server.service lykoi-autonomy.service`。** 这是 `Before=` 而非 `Requires=`/`After=`，**只排序、不建立依赖**，所以 stop/disable core 不会连带停掉那两个。**[建议]** 仍需在移除 unit 文件时确认活体没有额外的 drop-in 把它升级成 `Requires=`——**[推断] 本副本无从判断**。
- **[事实] `kernel/dispatch.py:436` 的 execution session 门控是 fail-closed 的**（唯一一处）。若 `LYKOI_EXECUTION_SESSION_CLIENT_ENABLED` 活体为开，停掉 core 后 `start_execution` 会连不上 socket。**[建议] 停 core 前必须先关这个客户端开关**——这正是 §4.1 "先消费者后 core" 的实质理由。

**结论：[建议] 按 §4.1 顺序执行的前提下，现在就停 `lykoi-core` 是安全的，属可回退的低风险操作。**

### 5.1 档一：移植期间**可以先做**（不影响旧体继续跑）

| # | 动作 | 风险 | 缓解 |
|---|---|---|---|
| 1 | 关闭消费者侧 env（`LYKOI_CORE_RUNTIME_ENABLED`、`LYKOI_EXECUTION_SESSION_CLIENT_ENABLED`） | 低 | 全 fail-open；`core_registered` 位翻 False，无权限下游 |
| 2 | `systemctl stop/disable lykoi-core` | 低 | `Before=` 非依赖；停后 `core_runtime_registration_failed` 反而消停（§1.4） |
| 3 | 删除 `test_core_v1_*.py`（39/42 文件，558+ 用例） | 低 | 纯测试面，但**基线数字掉 26.9%，须提前报备** |
| 4 | 改造 7 个非 core_v1 但 import core 的测试 | 中 | 易漏，需独立子工单（§4.6） |
| 5 | 删除 §3 的 6 处"随退役删除"引用（dispatch shadow×2、runtime_client×4 路径、app.py、autonomous.py） | 低 | 全在 fail-open 分支内 |
| 6 | 迁移 4 个"保留"模块（`capability_contract`/`capability_registry`/`capability_status`/`self_state`）到 Cordis 侧 | 中 | 四者互相依赖，**必须同批**；`SEALED_REGISTRY_SHA256` 需重签 |
| 7 | 归档 `baseline.py` 的历史报告产物到 docs/ | 极低 | — |
| 8 | 清理 drop-in 与 §4.3 的 19 个 env | 中 | **删行，不要留空赋值**（§4.3 陷阱） |

### 5.2 档二：**必须等 M4 切换时一起做**

| # | 动作 | 为什么不能提前 |
|---|---|---|
| 1 | **改 `startup_verify.py` 摘掉 core 检查 + root 重签 manifest（113→93）+ 删 `src/lykoi/core/`** | **[事实] 五服务的 ExecStartPre 全依赖它**（§4.5）。改动窗口内任一步失败 = 全系统起不来。必须与 Cordis 切换同一个维护窗、同一次回滚脚本 |
| 2 | 处置 `/home/lykoi/state/core_facts.db` 与 `/home/lykoi/state/core_artifacts` | **[事实] `shadow.py` 是唯一写入者**（`shadow.py:690,695`），退役即冻结。**[事实] 但 `self_state_sources.py:256` 区域仍在读 `CORE_FACTS_DB` 取 `_latest_mac_event`**（`self_state_sources.py:238-244`，`source_ref="core-events.mac-environment"`）——**读侧比写侧活得久**，冻结后该观察项会持续返回陈旧数据直到 TTL（`MAC_EVENT_TTL_SECONDS`）过期。切换时必须与 Cordis 事件源一起换掉，不能单独冻结 |
| 3 | 删除 `surface/perception.py` 的 Event outbox 链路（#8） | outbox 是 mind_store 里 `environment_core_events` 的**唯一 drain 路径**。提前删会让未投递事实永久 pending。必须等 Cordis 事件总线接管 |
| 4 | 切断 `self_state_live_runtime` → `conversation.py:1853` 的活体注入链 | **[事实] 已通到真实会话**。提前动 = 影响她当下的自我认知输入。必须与 Cordis 自我模型同时上线 |
| 5 | 移除 `lykoi-core.service` unit 文件本体 | 保留 unit（stopped+disabled）成本为零，却保住了一条一键回退路径。**[建议] 直到 M4 验收通过再删** |
| 6 | `execution_session` 语义承接（dispatch 的 5 处） | dispatch 是执行主干，`:436` 的 fail-closed 分支改错会**静默禁掉执行**。需与 Cordis 执行追踪同批切换并有对照测试 |

### 5.3 两个跨档的隐性风险

- **[事实] `runtime.py` 的隐性加载面。** 任何 import `runtime_client` 的进程都会连带加载 1,732 行的 `runtime.py`（`runtime_client.py:25`）。**这意味着 `runtime.py` 的删除时机被绑死在 §3 全部 8 处 `runtime_client` 引用清干净之后**，不能因为"它只是个 daemon"就提前删。
- **[事实] `Restart=always` + "非重试异常即掀进程" 的组合。** 若在退役过程中误改了 core 侧任何 env（如 §4.3 的策略 SHA 不匹配），`lykoi-core` 会进入 2 秒一次的无限重启，同时把消费者侧的注册状态打成高频翻转刷屏（§1.4 层一）。**[建议] 停用应当用 `systemctl disable` 而非改 env 让它自己崩。**

---

## 6. 白皮书更新点（28 章事实基线）

**[事实] 副本缺口如实告知：本工作副本的 `docs/` 里没有 28 章结构的白皮书。** 已实测：`docs/lykoi_v0_blueprint.md` 只有 12 章（0–11 节），`docs/` 根目录 16 个非 core/wo 文档中无匹配项，`docs/archive/` 17 个文件亦无。全树 grep `事实基线` 只命中 `docs/phase5_prereg_v1.md`。**⇒ 28 章白皮书在活体的位置在本副本之外，[推断] 可能属治理账户 0600 或仓外。**

**[建议] 因此本节改为交付"待失效条目的判定清单"**：按下列 12 个**主题键**去白皮书里检索条目号，命中者即随退役失效。每条附本报告的证据锚点，便于逐条核销。

| # | 主题键（检索词） | 失效性质 | 证据锚点 |
|---|---|---|---|
| 1 | 「五服务 / 六服务」「lykoi-core 是常驻单元」 | **完全失效**：常驻单元由 6 降为 5（broker/server/autonomy/runner/telegram） | §4.1、`lykoi-core.service` |
| 2 | 「core.sock」「Core 本地运行时」「单所有者 socket」 | **完全失效**：socket 与其协议整体消失 | §1.2 |
| 3 | 「三服务注册 / producer 注册」 | **失效且原表述本就不准**：实为两服务注册（server/autonomy）+ 三类 op | §1.3 |
| 4 | 「`core_runtime_registration_failed` 为已知观察项」 | **完全失效**：观察项随退役消失 | §1.4 |
| 5 | 「M3-R0/R1/R1a/R1b/R1c 阶段成果」 | **失效**：Event ingress、candidate、decision 全部转由心脏显著性承接 | §2 #3,#4,#16 |
| 6 | 「M3-R2A/R2B 执行会话」「执行对账」 | **失效**：转 Cordis 执行追踪 | §2 #9、§5.2 #6 |
| 7 | 「M3-R2C-R0/R1/R2 permission 影子体系」 | **失效**：转治理层策略 | §2 #7,#11,#12,#14,#15 |
| 8 | 「R2C-S0..S10 自我模型链」 | **部分失效**：S0/S1/S2/S3（`capability_contract`/`registry`/`status`/`self_state`）**保留但换归属**，S6/S9 的 shadow/live 双провider 结构建议合并 | §2 #5,#6,#8,#10、§3 #13,#14 |
| 9 | 「`core_facts.db` / `core_artifacts` 为活跃事实存储」 | **改为冻结/归档**，且读侧生命周期长于写侧 | §5.2 #2 |
| 10 | 「Core 树受 root 封存 / startup_verify 检查 kernel+core 双树」 | **改为只检查 kernel 单树** | §4.5 |
| 11 | 「manifest 覆盖 113 条」 | **数字变更：113 → 93** | §4.4 |
| 12 | 「测试基线 154 文件 / 2000+ 用例」 | **数字变更：副本口径 150→111 文件、2074→1516 用例（−26.9%）** | §4.6 |

**[建议]** 另需新增（而非删除）一条：**§4.5 的 `startup_verify` 五服务 ExecStartPre 耦合**，是本次审查发现的、白皮书**[推断]** 大概率未记载的高危事实——它把"删一个目录"变成了"全系统停摆"，值得单独立条。

---

## 附：本单未能覆盖 / 需活体核对项（如实清单）

1. **28 章白皮书不在副本内** —— §6 已降级为主题键清单，需活体检索定稿。
2. **活体 drop-in 全部不可见** —— §4.2 六项均为 `docs/` prereg 反推，`Requires=` 升级风险（§5.0）无法排除。
3. **5 个 .py 不可读**（治理账户 0600）：`permission_evidence_shadow.py` 的判定（§2 #14）按 `runtime.py:1639,1667` 引用侧证据推断；4 个测试文件仅计入数量差。
4. **两个治理 flag 文件的活体状态未知** —— `self_state_injection.on` / `self_state_shadow.on`，直接决定 §2 #8 是"保留迁移"还是可退役（§4.0 #4/#5）。
5. **未运行 pytest** —— 用例数为 `grep -c "def test_"` 静态计数，不含参数化展开（`pytest.mark.parametrize` 会使实际收集数高于 558/2074）。

**六节报告完毕。**
