# WO-BASE-04 模块成熟度矩阵与三分类

## 执行摘要（10 行内）

1. 代码库呈**双层分化**：治理层（kernel/guardian/surface/resources/shared）成熟稳定；心智层（mind）功能完整但设计债集中；`core/` 包为 M3 未完工线，占全库 40.6%（11,782/29,030 行）却**零生产行为消费者**。
2. `core/shadow.py` 单文件 4,685 行（全库 16%），是最大的单点债务。
3. **全库 `user_id` 出现次数 = 0**（`grep -rn "user_id" src/lykoi` → 0）。多用户/群成员身份不是"缺字段"，是**整个数据模型与鉴权模型的单主体假设**。
4. 单例阻碍点已定位：`surface/app.py:128` 进程级 `conversation = Conversation()`；`shared/*` 全部为单文件全局台账（notifications / chat_outbox / proactive_chat / pending_actions）。
5. Delegation Gateway 无挂载点：`kernel/dispatch.py:227` `_RESOURCES` 为 5 项硬编码字典，`DispatchContext`（:207）只有 `origin` + `run_id`，无委托主体、无子代理身份、无隔离域。
6. 程序性学习**有结构但被显式钉死**：`core/shadow.py:263` `evaluation_kind CHECK(evaluation_kind='unassessed_legacy')`、`:281 CHECK(proposal_ref IS NULL)`。
7. 三分类结果：可保留 5（kernel / guardian / resources / shared / memory）、待重构 4（surface / cognition / mind / scripts）、可删除或大幅收缩 1（core 的 R2C 分支）。
8. 过度设计候选 6 处，均以 grep 交叉验证生产调用者为 0。
9. 白皮书 31.3 原文不在本工作副本内（`grep -rn "31\.3" docs` 无命中），本报告依 WO 正文给出的三大缺口定义 + 仓内 `docs/lykoi_v0_blueprint.md`、`docs/lykoi_constitution.md`、`docs/core_v1_contract.md` 作为对齐基线，凡需白皮书原文裁定处标"待核实"。
10. 全程只读：未修改文件、未切分支、未访问网络、未读 `/home/lykoi/secrets`。

---

## 0. 判据与证据口径说明

- **不跑测试**：测试覆盖一栏用「测试文件对包的 import 引用数」+「是否存在按模块命名的专用测试」两项客观统计，不代表行覆盖率。统计命令：`grep -rl "lykoi\.<pkg>" tests | wc -l`。
- **测试总量**：`find tests -name '*.py' | wc -l` = 109（含 `conftest.py`，与前序清点的 108 测试文件一致）。
- **源文件总量**：`find src -name '*.py' | wc -l` = 85；`wc -l` 合计 = 29,030 行（含 guardian 4 文件 + scripts 7 个 .py）。
- **接口稳定性**用「被多少个非自身模块 import」度量（fan-in），命令见各格。
- **生产调用者**判定：调用点存在 **且** 不在 `tests/`、`scripts/` 下 **且** 不被 default-off 开关包裹。default-off 判定依据 `os.environ.get(...,"0")` 模式与三个 systemd unit 文件中**未出现**该环境变量。

**production 开关基线（重要）**：`lykoi-core.service`、`lykoi-server.service`、`lykoi-autonomy.service` 三个 unit 中，`Environment=` 行只出现 `PYTHONUNBUFFERED`、`PYTHONPATH`、`LYKOI_CORE_RUNTIME_SOCKET`、`LYKOI_CORE_RUNTIME_LOCK`。以下开关**在 unit 文件中完全不出现**，因此其守卫的代码在本工作副本的部署描述下为 default-off：

`LYKOI_CORE_SHADOW_ENABLED`、`LYKOI_CORE_RUNTIME_ENABLED`、`LYKOI_CORE_EVENT_INGRESS_ENABLED`、`LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED`、`LYKOI_CORE_ATTENTION_DECISION_ENABLED`、`LYKOI_CORE_EXECUTION_SESSION_ENABLED`、`LYKOI_CORE_PERMISSION_EVIDENCE_SHADOW_ENABLED`、`LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED`、`LYKOI_CORE_SCHEMA_V2_ACTIVATION`（共 9 个）。

> 注：真实线上环境可能通过 root-owned 的 EnvironmentFile 或 drop-in 注入这些开关，本副本无法观测。此处结论限定为"按仓内 unit 文件描述"。**待核实**：线上 `systemctl show lykoi-core.service -p Environment` 实际值。

---

## 1. 模块成熟度矩阵

### 1.1 规模底数（先给分母，后面各格引用）

| 包 | 源文件数 | 行数 | 占比 | 最大单文件 |
| --- | ---: | ---: | ---: | --- |
| core | 19 | 11,782 | 40.6% | `shadow.py` 4,685 |
| mind | 14 | 4,798 | 16.5% | `store.py` 1,369 |
| cognition | 19 | 3,530 | 12.2% | `conversation.py` 1,040 |
| kernel | 6 | 1,395 | 4.8% | `dispatch.py` 650 |
| shared | 12 | 1,043 | 3.6% | `clock.py` 242 |
| surface | 3 | 670 | 2.3% | `perception.py` 359 |
| resources | 6 | 623 | 2.1% | `research_browser.py` 363 |
| memory | 4 | 457 | 1.6% | `store.py` 397 |
| guardian | 4(+1 svc) | 615 | 2.1% | `startup_verify.py` 413 |
| scripts | 7 (.py) | 1,713 | 5.9% | `p4r_compressed_harness.py` 468 |

（`__init__.py` 计入文件数；`src/lykoi/*/__init__.py` 中 5 个为 0 行，仅 core/kernel/memory/resources 的 `__init__` 有 7–8 行。）

---

### 1.2 surface

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **高（相对 v0 目标）**。蓝图 §1「直接继承 surface/：FastAPI 面、鉴权、审批端点」已全部在位：健康、审批列表/批准/拒绝、通知、chat、chat 出站、continuations、环境 ingest。 | `surface/app.py` 端点清单：`/`(:141) `/health`(:147) `/approvals`(:152) `/notifications`(:159) `/chat/outbox`(:168) `/ingest/environment`(:177) `/ingest/environment/status`(:196) `/chat`(:202) `/continuations`(:253) `/continuations/{id}/approve`(:260) `/deny`(:273) `/approvals/{id}/approve`(:286) `/deny`(:303) —— 共 13 个路由 |
| 测试覆盖 | **中**。15 个测试文件引用 `lykoi.surface`（`grep -rl "lykoi\.surface" tests \| wc -l` = 15），有专用 `test_surface_approvals.py`、`test_perception_ingest.py`、`test_p0_surface_errors.py`、`test_notifications_mark_read.py`；`app.py` 无同名专用测试，靠 chatloop/e2e 间接覆盖。鉴权有钉死用例 `tests/test_governance_invariants.py:214 test_unauthenticated_request_rejected`。 | 同左 |
| 接口稳定性 | **叶子节点，fan-in=0**（无任何 src 模块 import `lykoi.surface`）。但它是**唯一进程入口**（`lykoi-server.service:20 uvicorn lykoi.surface.app:app --workers 1`），改动波及面是"全部对话行为"。 | unit 文件；`grep -rn "lykoi.surface" src/lykoi` 仅命中自身 |
| 设计债 | **高，且是三大缺口的第一阻碍**。① `app.py:128 conversation = Conversation()` —— 进程级单例会话，`--workers 1` 是它成立的前提；② `app.py:129 followup_runner = FollowupRunner(conversation)` 绑死同一单例；③ `app.py:123 seed_persona()` 在 import 期执行副作用；④ 鉴权为**单一共享 bearer 密钥**（`require_token` :40，`require_perception_token` :54），无主体概念；⑤ `ChatRequest`(:135) 仅 `message` + `reply_to_notification_id`，**无 sender / user_id / chat_id**。 | 见左侧行号 |
| 白皮书对齐 | **需调整**。作为"治理骨架继承项"与蓝图 §1 一致；但对缺口 a（群成员身份）**结构性冲突**——请求体与鉴权层都没有承载主体身份的位置。 | `app.py:135-138`、`app.py:40-65` |

---

### 1.3 cognition

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **中高但职责混杂**。19 文件覆盖：对话主循环、LLM 客户端/路由、prompts、附件、跟进、调度、重启记录、autonomous 进程主循环，以及 **9 个 `self_state_*` 适配文件**（`self_state_context/injection/live_audit/live_runtime/runtime/shadow_audit/sources` 等，合计 855 行）。蓝图 §1 要求"改造 autonomous.py 的 wake 循环 → 五环节一拍"已完成（`autonomous.py:38-42` 导入 `mind.decide/integrator/reflow/snapshot/store`）。 | `autonomous.py:29-44` 导入块 |
| 测试覆盖 | **高（数量）**。40 个测试文件引用 `lykoi.cognition`（全库最高之一）。专用测试：`test_chatloop.py`、`test_chatloop_e2e.py`、`test_conversation_inner.py`、`test_followup.py`、`test_p0_context.py`、`test_p0_llm_client.py`、`test_scheduler_virtual.py`、`test_contemplate_route.py`、`test_inner_outer_pair.py`，以及 S3–S10 系列对 `self_state_*` 的专项。 | `grep -rl "lykoi\.cognition" tests \| wc -l` = 40 |
| 接口稳定性 | **中**。`conversation` 被 surface 直接持有；`self_state_context.CognitionSelfStateContext` 被 **`mind/decide.py:31` 反向 import** —— mind 依赖 cognition，是层级倒挂（下详）。 | `mind/decide.py:29,31` |
| 设计债 | **高**。① `conversation.py` 1,040 行单类 `Conversation`（:355），承载上下文窗口、摘要、工具循环、审批挂起/恢复、inner/outer 拆分、自我状态注入、权限证据记录 —— 至少 6 个关注点；② 模块级常量硬编码时区 `_BEIJING_TZ`(:51) 与 `MAX_TOOL_STEPS = 8`(:50)；③ `TOOL_TO_ACTION`(:92)/`TOOLS`(:105) 硬编码工具表，新增能力必须改这里；④ **9 个 self_state 适配文件是三层包装**（`sources → runtime/live_runtime → shadow_audit/live_audit`），只为把 `core` 的能力快照送进 prompt，其中 `self_state_shadow_audit.py` 仅 19 行、`self_state_live_audit.py` 仅 18 行——抽象层数多于实质逻辑；⑤ 依赖方向违规：`decide.py`（mind 包）import cognition。 | 见左侧行号 |
| 白皮书对齐 | **需调整**。五环节一拍与 §4 对齐；但 §1「新心智代码放 mind/，不与旧 cognition 混写」被 `mind/decide.py:29` 破坏。 | `docs/lykoi_v0_blueprint.md:15`（红线原文）vs `src/lykoi/mind/decide.py:29` |

---

### 1.4 core

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **形式上高、行为上零**。19 文件 11,782 行，实现了事件存储（`core_events`/`episodes`/`artifacts`/`commands`/`observations`/`outcomes`/`command_transitions`/`audit_events` 共 8 张表，`shadow.py:148-305`）、schema v2 注意力表（`shadow.py:548,561`）、能力契约/注册表/状态、自我状态、执行会话、权限证据/学习/投影/重放。但 `docs/core_v1_contract.md` 与 backlog 均标注其为 observation-only：`lykoi-core.service:2 Description=Lykoi Core v1 local runtime (observation-only M3-R0)`。 | 同左 |
| 测试覆盖 | **极高（数量），且测试是唯一消费者**。32 个测试文件引用 `lykoi.core`；`tests/` 下以 `test_core_v1_*` 开头的文件 **38 个**，覆盖 R1A/R1B/R1C/R2A/R2B/R2C-S0..S10/R2C-R1/R2/R3。这个比例本身是信号：`core/` 的行为出口只有测试。 | `ls tests \| grep -c "^test_core_v1"` 系列文件名见 §0 |
| 接口稳定性 | **表面 fan-in 高、实际全部条件化**。core 之外仅 6 处 import：`cognition/autonomous.py:36`、`cognition/permission_evidence_shadow.py:6`、`cognition/self_state_*`（4 处）、`kernel/dispatch.py`（91/122/162/314/442/456/501/541，**全部为函数体内惰性 import**）、`surface/app.py:21`、`surface/perception.py:17`。`dispatch.py:91-115 _shadow_attempt` 显式声明「shadow failure cannot steer dispatch」，`:106` 注释 "M2 is fail-open, guardian is not"。 | 见左侧行号 |
| 设计债 | **全库最高**。① `shadow.py` 4,685 行 —— 单文件承载 schema DDL、迁移、写入、artifact 配额、cgroup 校验、执行会话对账，是不可评审的单体；② 大量 `CHECK` 把未来能力**钉死为禁止态**（见 §3c）；③ 三条平行未完工线（attention / execution_session / permission_*）各自带独立开关、独立 DB、独立 sealed policy 文件，互相之间还要写「不能同时启用」的互斥断言（`runtime.py:1396-1399`）；④ 权限线为四层抽象：`permission_learning`(405) → `permission_projection`(490) → `permission_replay`(431) → `permission_evidence_shadow`(487)，**合计 1,813 行，行为消费者 0**（backlog CORE-NOW-02 结论原文："R2 与行为 consumer 均 absent"）。 | `docs/project_backlog.md` CORE-NOW-02 证据行 |
| 白皮书对齐 | **部分冲突**。事件溯源与不可变审计与宪法方向一致；但 `permission_learning.PermissionContext`(:108-118) 的 8 个特征（action_type/origin/initiator/data_class/effect/reversibility/authentication/destination）**没有任何主体维度**，与缺口 a 直接冲突（详见 §3a）。 | `core/permission_learning.py:108-118` |

---

### 1.5 mind

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **高**。蓝图 Phase 1–3 的表全部落地：`regulation_field`/`regulation_events`(migrations.py:22,29)、`concerns`(:40)、`narrative_versions`(:56)/`narrative_threads`(:66)、`experiences`(:75)、`integration_state`(:97)、`owner_edits`(:103)、`thoughts`(:171)，另有 v3 迁移的 `environment_ingest_receipts`(:336)/`environment_ingest_state`(:357)/`environment_core_event_outbox`(:380)/`environment_core_event_deliveries`(:404)。五环节齐备：`snapshot.py`/`decide.py`/`reflow.py`/`integrator.py`/`floor.py`。 | 同左 |
| 测试覆盖 | **最高**。52 个测试文件引用 `lykoi.mind`（全库第一）。专用：`test_mind_store.py`、`test_mind_migrations.py`、`test_mind_integrator_pipeline.py`、`test_mind_integrator_trigger.py`、`test_mind_regulation.py`、`test_mind_appendonly.py`、`test_mind_red_lines.py`、`test_mind_console.py`、`test_mind_beat.py`、`test_mind_thoughts_*.py`（7 个）。红线有钉死测试（`test_mind_red_lines.py`）。 | `grep -rl "lykoi\.mind" tests \| wc -l` = 52 |
| 接口稳定性 | **高 fan-in，改动波及面最大**。`mind.store` 被 `cognition/autonomous.py:42`、`cognition/conversation.py:44`、`surface/app.py:27`、`surface/perception.py:18` 四处 import；`mind.regulation` 被 mind 内 6 个模块 + `cognition/conversation.py:43` import。`mind/store.py` 1,369 行是事实上的中央数据网关。 | 见左侧行号 |
| 设计债 | **中高**。① `store.py` 1,369 行单模块承载全部表的读写；② `migrations.py` 499 行含 4 次 `CREATE TABLE *_new` 重建式迁移（:132、:271、:303），说明 schema 反复返工；③ `salience_shadow.py` 453 行 + 独立 SQLite（`LYKOI_SALIENCE_DB`），已被审计裁定 `do_not_activate_insufficient_discrimination`（`docs/project_backlog.md` CORE-NOW-01），仍留在 `store.py:765` 的写入路径上；④ `salience_shadow.py:115,135 global _constants_cache` —— 模块级可变全局；⑤ **`owner_edits` 写入 API 无生产调用者**（详见 §4）；⑥ 层级倒挂：`decide.py:29` import cognition。 | 见左侧行号 |
| 白皮书对齐 | **一致（v0 目标内）**。表结构与 `docs/lykoi_v0_blueprint.md` §3.1–3.5 逐字对应，append-only 触发器与"只能标 dimming/dormant 不许自动 released"（蓝图 :138）均已代码化。**对缺口 a 冲突**：`experiences`(migrations.py:75-83) 的 `source` CHECK 只有 6 个值，`concerns`、`narrative_*` 无任何主体列。 | `migrations.py:75-83` |

---

### 1.6 kernel

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **高，已达 v0 目标**。派发网关（`dispatch.py`）、三层审批（`approval.py:188-232 check()`：硬裁决 → 能力剖面 → live 规则只能收紧）、fail-closed 不可变审计（`dispatch.py:39-71`）、通知队列（`notifications.py`）、脱敏（`redaction.py`）、审计供给（`audit_provision.py`）。 | 同左 |
| 测试覆盖 | **高且是纪律型覆盖**。31 个测试文件引用 `lykoi.kernel`。关键不变量有 AST 级钉死测试：`tests/test_governance_invariants.py:41 test_only_dispatch_imports_resources`、`:80 test_send_notification_only_reachable_through_dispatch_handlers`、`:97 test_unrestricted_shell_never_auto_allow`、`:121 test_approval_binds_exact_params`、`:133 test_approval_consumed_once`、`:227 test_scheduler_only_notifies_via_dispatch`。另有 `test_gate1_noop.py`/`test_gate2_aging.py`/`test_gate3_l2.py`/`test_gate5_l1_scan.py`、`test_pending_hygiene.py`、`test_audit_closure.py`、`test_audit_provision.py`。 | 同左 |
| 接口稳定性 | **最高**。`dispatch` 是全库唯一 → resources 的路径，由 AST 测试钉死。`approval` 被 `dispatch.py:21`、`conversation.py` import；`notifications` 被 3 处 import。任何签名改动波及全部外部动作。 | `test_governance_invariants.py:41-50` |
| 设计债 | **低-中**。① `_RESOURCES`(dispatch.py:227) 与 `KNOWN_ACTIONS`(:236 附近) 为硬编码白名单——这是**有意的设计**（:238 注释「Adding an action means adding it here — a conscious [choice]」），不是债，但它是缺口 b 的正面阻碍；② `_AUDIT_DEGRADED`(:44) 为模块级可变字典（进程内全局状态），多进程下各自独立；③ `approval` 的 pending 队列是**单个 JSON 文件**（`LYKOI_PENDING_ACTIONS`），无主体分区；④ `consume_pending(..., actor: str = "owner")`(:323) 与 `permission_evidence.py:164 actor: str = "owner"`/`:181 if self.actor != "owner"` —— **"owner" 是唯一合法 actor，硬编码**。 | 见左侧行号 |
| 白皮书对齐 | **一致**。蓝图 §1「直接继承 kernel/：这是宪法的'脑干'实现」。缺口 b 需在此加挂载点而非重写。 | `docs/lykoi_v0_blueprint.md:25` |

---

### 1.7 shared

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **高**。12 文件覆盖：日志（fan-in 25，最高）、时钟/虚拟时钟（242 行，支持 regime/speed/anchor 四个环境变量）、原子 JSON 写、跨进程文件锁（蓝图 P0-2 要求项，:63）、交互锁、live 守卫、token 估算、DSML、continuations、chat 出站、proactive 节流。 | `grep` fan-in 统计见下 |
| 测试覆盖 | **高**。33 个测试文件引用 `lykoi.shared`。专用：`test_clock.py`、`test_dsml.py`、`test_p0_filelock.py`、`test_p0_live_guard.py`、`test_p5_proactive.py`。 | 同左 |
| 接口稳定性 | **最高 fan-in**：`shared.log.log_event` 被 25 处 import、`shared.clock` 13 处、`shared.jsonio.write_json_atomic` 8 处、`shared.live_guard` 7 处、`shared.filelock` 5 处。任何签名改动全库波及。 | `grep -rhn "from lykoi.shared" src/lykoi \| sort \| uniq -c` |
| 设计债 | **中**。① `clock.py:87 _params = _load_params()` + `:92 global _params` —— import 期加载 + 可变全局；② 全部台账为**单文件全局 JSON**，无主体分区：`LYKOI_NOTIFICATIONS`、`LYKOI_CHAT_OUTBOX`、`LYKOI_PENDING_ACTIONS`、`LYKOI_CONTINUATIONS`、`LYKOI_PROACTIVE_CHAT_LEDGER`；③ `proactive_chat.py:19 LEDGER_PATH` 单一路径 + `_today_count`(:37) 全局日配额——多用户下会互相扣配额。 | 见左侧行号 |
| 白皮书对齐 | **一致**。跨进程文件锁正是蓝图 P0-2 :63 的要求。对缺口 a 需扩展分区键。 | `docs/lykoi_v0_blueprint.md:63` |

---

### 1.8 memory

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **完整但已被 mind 部分取代**。4 文件 457 行：`store.py`（history / insights / autonomy_state / autonomy_runs / autonomy_notes / health_metrics 共 6 表，:46-124）、`persona.py`（人格投影）、`seed.py`（种子偏好）。 | 同左 |
| 测试覆盖 | **中**。14 个测试文件引用 `lykoi.memory`（全库最低）。专用：`test_persona.py`、`test_p5_memory_notification.py`、`test_p1_provenance.py`。`store.py` 无同名专用测试。 | `grep -rl "lykoi\.memory" tests \| wc -l` = 14 |
| 接口稳定性 | **中高**。`memory.store` 被 8 处 import（5 处直接 + 3 处 alias）。`history` 表是对话真相底账，被 `mind/store.py` 的经验写入引用行号。 | `store.py:130` 注释「returns its id so callers ... can reference the row」 |
| 设计债 | **中**。① `store.py:127 _init()` 在 import 期建表（副作用型导入）；② `persona.py:25 sections.append("Kevin 的偏好：...")` —— **人格投影 prompt 里硬编码 owner 姓名**；③ `seed.py:16 ("preference", "Kevin 用中文交流…")` 硬编码种子；④ `history` 表（:46-51）只有 `id/ts/event_type/content`，**无主体列**——这是缺口 a 最深的一层，因为对话回灌（`LYKOI_CONTEXT_BACKFILL_ROWS`）直接从这里取。 | 见左侧行号 |
| 白皮书对齐 | **一致（v0）/ 冲突（多主体）**。蓝图 §1 明确「`memory/store.py` 的 history append-only 触发器模式（新表沿用此模式）」为继承项，触发器 `history_no_update`/`history_no_delete`(:61-70) 在位。 | `docs/lykoi_v0_blueprint.md:30` |

---

### 1.9 resources

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **完整，恰好五叶子**。`terminal.exec`(:16)、`browser.*`、`research_browser.*`、`notify.owner`(:22)、`autonomy.queue_notification`(:18)/`initiate_chat`(:33)。与蓝图 §1 :28「五个动作叶子」与红线 6「不得给她超出既有五叶子之外的新外部能力」精确一致。 | 同左 |
| 测试覆盖 | **中高**。20 个测试文件引用 `lykoi.resources`。专用：`test_p3_research_browser.py`、`test_p2_capability.py`；隔离性有钉死用例 `test_governance_invariants.py:172 test_screenshot_path_not_caller_controlled`、`:187 test_audit_record_has_correlation_id`。 | 同左 |
| 接口稳定性 | **被唯一调用方约束**。只有 `kernel/dispatch.py:16-20` import，且由 AST 测试钉死独占。改动只需同步 `_RESOURCES`/`KNOWN_ACTIONS`。 | `test_governance_invariants.py:41` |
| 设计债 | **低**。① `research_browser.py` 363 行是最大文件，含物理隔离说明（:3-7「each ... a research read cannot act as Kevin」）——设计良好；② `notify.py:14`/`autonomy.py:14` 用「module-style import on purpose」再导出 `notifications`，是为让 AST 测试可见，属自觉设计；③ 硬编码 Chrome 端点 `LYKOI_CDP_URL` / `LYKOI_DESKTOP_URL` 已环境化。 | 见左侧行号 |
| 白皮书对齐 | **一致**。这是全库对齐度最高的包。 | `docs/lykoi_v0_blueprint.md:28,360` |

---

### 1.10 guardian

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **高**。4 个 Python 文件 615 行：`startup_verify.py`(413，完整性闸)、`policy_core.py`(80，不可变能力剖面)、`watchdog.py`(78)、`path_guard.py`(24)、`audit_sink.py`(20)，加 `manifest.sha256` 与 `watchdog.service`。三个 unit 全部有 `ExecStartPre=…/guardian/startup_verify.py`（core:18 / server:17 / autonomy:18）。 | 同左 |
| 测试覆盖 | **中高**。31 个测试文件引用 guardian 相关符号（`grep -rl "guardian\|policy_core\|startup_verify\|path_guard\|audit_sink" tests \| wc -l` = 31）。专用：`test_p0_integrity.py`、`test_audit_closure.py`、`test_audit_provision.py`、`test_governance_invariants.py:109 test_guardian_and_protected_files_not_writable`。 | 同左 |
| 接口稳定性 | **高但耦合方式脆弱**。`kernel/approval.py` 把 guardian 目录塞进 `sys.path`，`dispatch.py:28-32` 再 `import audit_sink`，并对失败降级（`_audit_sink = None`）。这是**路径耦合而非包耦合**。 | `dispatch.py:24-32` 注释原文 |
| 设计债 | **中**。① `guardian/startup_verify.py`(413) 与 `scripts/startup_verify.py`(413) **行数完全相同**，高度疑似重复副本 —— 两份完整性校验器意味着可能校验漂移。**待核实**：是否逐字节相同（本次未做 diff，属只读范围内可做但未做的核对）；② sys.path 注入式导入难以静态分析；③ `manifest.sha256` 覆盖面需按蓝图 P0-2(:56-60) 扩展到 `approval_rules.json` schema 校验器与人格 TOML —— 本副本无法确认是否已覆盖。 | 同左 |
| 白皮书对齐 | **一致**。蓝图 §1 :26「guardian/：不可变核、启动完整性闸、看门狗」为直接继承项。 | `docs/lykoi_v0_blueprint.md:26` |

---

### 1.11 scripts

| 维度 | 判断 | 证据 |
| --- | --- | --- |
| 功能完整度 | **杂糅：运维工具 + 一次性实验 harness 混放**。运维类：`deploy.sh`、`offsite_backup.sh`、`p02_harden.sh`、`startup_verify.py`、`notify_push.py`、`chat.py`、`realtime_guard.py`。一次性实验类：`p4r_compressed_harness.py`(468)、`p4r14_state_closure_harness.py`(320)、`audit_salience_shadow_release.py`(375)、`core_v1_replay.py`(111)。 | 同左 |
| 测试覆盖 | **低-中**。有 `test_p4r_compressed_harness.py`、`test_p4r14_state_closure.py`、`test_salience_shadow_release_audit.py`、`test_notify_push.py`、`test_realtime_guard.py`、`test_deploy_label_gate.py`、`test_sqlite_busy_wait_deploy.py`。shell 脚本（`deploy.sh`/`offsite_backup.sh`/`p02_harden.sh`）**无对应测试文件**。 | `ls tests` |
| 接口稳定性 | **不适用（叶子）**，但 harness 反向 import 生产代码：`p4r_compressed_harness.py:123-128` import 6 个 mind 模块、`p4r14_state_closure_harness.py:57-59` import 3 个 —— 这些 harness 会随 mind 签名变动而腐坏。 | 见左侧行号 |
| 设计债 | **中高**。① 与 `guardian/startup_verify.py` 疑似重复（见 1.10）；② 一次性实验 harness（p4r 系列，合计 788 行）任务已完成仍留仓；③ `scripts/patches/wo-approval-hygiene-01.md` 表明有补丁式流程；④ 当前分支最近三次提交（`d22ff80`/`accda41`/`940b98f`）全部在改 `offsite_backup.sh`，说明该脚本仍在收敛中。 | `git log --oneline -5` |
| 白皮书对齐 | **不在目标架构内**（工具层）。 | — |

---

### 1.12 矩阵汇总（一屏视图）

| 模块 | 功能完整度 | 测试覆盖(引用测试文件数/专用测试) | 接口稳定性(fan-in) | 设计债 | 白皮书对齐 |
| --- | --- | --- | --- | --- | --- |
| surface | 高 | 15 / 有(4) | 0（唯一入口） | **高**（进程单例、单密钥、请求体无主体） | 需调整 |
| cognition | 中高 | 40 / 有(9+) | 中（被 surface 持有；被 mind 反向依赖） | **高**（1040 行单类、9 个 self_state 包装层、层级倒挂） | 需调整 |
| core | 形式高/行为零 | 32 / 有(38 个 core_v1_*) | 低（全部惰性+开关） | **最高**（4685 行单文件、1813 行零消费者权限线） | 部分冲突 |
| mind | 高 | **52** / 有(13) | **高**（中央数据网关） | 中高（1369 行 store、4 次重建迁移、全局缓存） | 一致（v0）/ 缺口 a 冲突 |
| kernel | 高 | 31 / 有(纪律型 AST 测试) | **最高**（唯一网关） | 低-中（硬编码白名单为有意设计；actor 固定 owner） | 一致 |
| shared | 高 | 33 / 有(5) | **最高**（log 25 / clock 13） | 中（import 期全局、单文件全局台账） | 一致 |
| memory | 完整（部分被取代） | **14（最低）** / 有(3) | 中高（8 处） | 中（history 无主体列、硬编码 Kevin） | 一致(v0)/冲突(多主体) |
| resources | 完整（五叶子） | 20 / 有(2) | 由 dispatch 独占 | **低** | **一致（最高）** |
| guardian | 高 | 31 / 有(4) | 高（sys.path 耦合） | 中（疑似重复副本、路径式导入） | 一致 |
| scripts | 杂糅 | 部分 / 有(7)，shell 无 | 叶子 | 中高（788 行一次性 harness 留仓） | 不适用 |

---

## 2. 三分类

### 2.1 可保留（5 个）

**① resources —— 可保留（最高置信）**
理由：功能边界与宪法红线 6「不得给她超出既有五叶子之外的新外部能力」精确一致（`docs/lykoi_v0_blueprint.md:360`）；调用方唯一且由 AST 测试钉死；隔离设计（`research_browser.py:3-7` 与 Kevin 的 Chrome 物理隔离）在缺口 b 的委托场景下**正是需要的隔离范式**，可直接复用为专业 Agent 的资源沙箱模板。改动量：仅需在 `_RESOURCES` 增项。

**② kernel —— 可保留（需加挂载点，非重构）**
理由：三层审批（`approval.py:188-232`）+ fail-closed 不可变审计（`dispatch.py:39-71`）+ 六条 AST 不变量测试（`test_governance_invariants.py`）构成完整治理骨架，蓝图 §1:25 定性为"脑干"。缺口 b 所需的 Delegation Gateway 是在 `DispatchContext`(:207) 上**加字段与加一层解析**，不是推翻。注意：`actor="owner"` 的硬编码（:323）需要扩展，但这是加参数而非重写。

**③ guardian —— 可保留**
理由：不可变核、启动闸、看门狗三件套齐备且被三个 unit 全部前置调用；`policy_core.capability_profile`(通过 `approval.py:93`) 提供 origin-scoped 的不可变 DENY，是唯一 LLM 无法绕过的层。**保留条件**：需先核实并消除 `guardian/startup_verify.py` 与 `scripts/startup_verify.py` 的双份问题。

**④ shared —— 可保留（需加分区键）**
理由：fan-in 最高（log 25 / clock 13）说明接口已被反复验证；跨进程文件锁、原子写、虚拟时钟均为基础设施型正确抽象。缺口 a 只要求给 5 个 JSON 台账加分区维度，属**加维度而非改结构**。

**⑤ memory —— 可保留（需加列）**
理由：append-only 触发器模式被蓝图 §1:30 明确指定为"新表沿用此模式"的范本，`history` 是对话真相底账。缺口 a 要求 `history` 加主体列，但触发器与 append-only 语义不变。硬编码的 `persona.py:25` / `seed.py:16` 是 28 行与 24 行的小文件，改动成本可忽略。

---

### 2.2 待重构（4 个）

**⑥ surface —— 待重构**
挡在哪（逐条）：
- **进程级会话单例**：`app.py:128 conversation = Conversation()`。任何多主体会话都要求会话按主体（或按 chat_id）实例化，当前是一个进程一个 `Conversation`。
- **单实例部署绑定**：`lykoi-server.service:20 --workers 1`。单例设计已被写进部署契约，横向扩展会直接破坏语义。
- **请求体无主体**：`app.py:135-138 ChatRequest` 只有 `message` + `reply_to_notification_id`。
- **鉴权无主体**：`require_token`(:40) 是单一共享密钥的常量时间比较，没有可映射到 principal 的结构；`require_perception_token`(:54) 同理。
- **import 期副作用**：`app.py:123 seed_persona()`、`:129 FollowupRunner(conversation)` 绑死单例生命周期。
不建议删除的理由：13 个路由 + 审批端点是治理面必需，重构目标是"会话工厂 + principal 中间件"，路由本身可保留。

**⑦ cognition —— 待重构**
挡在哪：
- **1,040 行单类**：`conversation.py:355 class Conversation` 承载 ≥6 个关注点，任何主体化改造都要穿过它。
- **层级倒挂**：`mind/decide.py:29 from lykoi.cognition import self_state_injection` 违反蓝图 §1:15「新心智代码放 mind/，不与旧 cognition 混写」和 §0:16 的依赖方向 `surface → cognition/mind → kernel → resources`。重构前必须先把 `self_state_context`/`self_state_injection` 下沉或上提。
- **9 个 self_state 适配层**（855 行）：`sources → runtime | live_runtime → shadow_audit | live_audit`，其中两个终端文件仅 19/18 行。这是 core 未完工线在 cognition 侧的投影，core 收缩后这批文件应随之收缩。
- **硬编码工具表**：`conversation.py:92 TOOL_TO_ACTION` / `:105 TOOLS`，缺口 b 的委托工具需要在此注册，当前无扩展点。

**⑧ mind —— 待重构（重构量最大但价值最高）**
挡在哪：
- **全表无主体列**：`migrations.py` 中 `concerns`(:40)、`narrative_versions`(:56)、`narrative_threads`(:66)、`experiences`(:75)、`thoughts`(:171) 无一有 user_id/subject 列。`experiences.source` 的 CHECK 白名单（:77-78）只有 6 个值，加"来自某群成员"必须改 CHECK + 迁移。
- **单例状态表**：`integration_state`(:97) 有 `CHECK (id = 1)`；`regulation_field`(:22) 以 `name` 为主键的四行全局调节场。这两个是**结构性单主体假设**——调节场若要按关系分主体，主键必须变复合键。
- **1,369 行中央 store**：`store.py` 是全部 mind 表的唯一读写口，任何加列都从这里穿过。
- **迁移史反复**：`migrations.py:132/271/303` 三处 `CREATE TABLE *_new` 重建，说明加列在本包内是高摩擦操作。
- **已裁定不激活的组件仍在写入路径**：`store.py:765-766` 调用 `salience_shadow.on_experience_recorded`，而该组件已被审计裁定 `do_not_activate_insufficient_discrimination`（backlog CORE-NOW-01）。
不删除的理由：52 个测试文件、蓝图 Phase 1–3 的全部语义都在这里，是资产。

**⑨ scripts —— 待重构（拆分）**
挡在哪：运维工具与一次性实验 harness 混放；`p4r_compressed_harness.py`(468) + `p4r14_state_closure_harness.py`(320) 合计 788 行反向 import 生产 mind 模块，会随重构持续腐坏。建议拆为 `scripts/ops/`（保留）与归档（见 §2.3）。

---

### 2.3 可删除 / 大幅收缩（1 个包 + 5 个具体单元）

**⑩ core 的 R2C 权限分支 —— 可删除或冻结归档**
理由（三条，均有证据）：
- **零行为消费者**，且这是项目自己记录的结论：`docs/project_backlog.md` CORE-NOW-02 证据行原文「最终复核 facts/recorded/failed=`3/3/0`，**R2 与行为 consumer 均 absent**」。
- **默认关闭且部署未开启**：`LYKOI_CORE_PERMISSION_EVIDENCE_SHADOW_ENABLED`、`LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED` 在三个 unit 文件中均不出现。
- **1,813 行四层抽象**：`permission_learning`(405) + `permission_projection`(490) + `permission_replay`(431) + `permission_evidence_shadow`(487)，且其核心数据结构 `PermissionContext`(:108-118) **不含主体维度**——即它是在缺口 a 未解决的前提下设计的权限学习模型，一旦引入 user_id，8 个特征全部要重定义。重构后重写比适配便宜。

**具体可删除单元（非整包）：**

| 单元 | 行数 | 删除理由 | 验证方式 |
| --- | ---: | --- | --- |
| `scripts/p4r_compressed_harness.py` + `.README.md` + `scripts/p4r14_state_closure_harness.py` | 788 | Phase 4 一次性观察 harness，任务已闭环（`docs/p5_*` 已进入 Phase 5） | 生产代码无 import，仅测试引用 |
| `src/lykoi/mind/salience_shadow.py` | 453 | 已被 owner 审计裁定 `do_not_activate_insufficient_discrimination`、uplift=0 | `docs/project_backlog.md` CORE-NOW-01 裁决行；唯一调用点 `mind/store.py:765` 可一并摘除 |
| `scripts/audit_salience_shadow_release.py` | 375 | 上条的配套审计器，随之失效 | 只服务 salience_shadow |
| `scripts/startup_verify.py` | 413 | 与 `guardian/startup_verify.py` 行数完全相同，疑似重复副本 | **待核实**：需先 diff 确认后再决定删哪一份 |
| `src/lykoi/mind/store.py:1335 owner_edits_log` / `:1364 owner_edits_list` | ~35 | 无生产调用者（详见 §4） | grep 见 §4 |

---

## 3. 重构阻碍点（按三大缺口逐条）

### 3.a 群成员身份解析与用户记忆（user_id 作用域）

**总判据（最强证据）**：
```
grep -rn "user_id" src/lykoi --include=*.py | wc -l   →  0
```
全库 85 个源文件、29,030 行中，`user_id` 出现 **0 次**。同时 `grep -ircE "kevin" src/lykoi` = **100 处**。这不是"少一个字段"，而是**主体身份从未被建模**。

**逐层阻碍清单：**

**A. 传输/鉴权层**
| 位置 | 阻碍 |
| --- | --- |
| `surface/app.py:135-138` | `ChatRequest` 只有 `message`、`reply_to_notification_id`。没有 sender/chat_id/group_id 的落点 |
| `surface/app.py:40-52` | `require_token` 是**单一共享 bearer**，验证通过后不返回任何 principal，只做 401 判定 |
| `surface/app.py:54-66` | `require_perception_token` 同构，第二个共享密钥 |
| `lykoi-server.service:20` | `--workers 1` 把单进程写进部署契约 |

**B. 会话层（最硬的阻碍）**
| 位置 | 阻碍 |
| --- | --- |
| `surface/app.py:128` | `conversation = Conversation()` —— **模块级进程单例**。所有 `/chat` 请求共享同一上下文窗口、同一工具循环状态、同一审批挂起态 |
| `surface/app.py:129` | `followup_runner = FollowupRunner(conversation)` 绑死该单例 |
| `surface/app.py:247` | `if pending and not conversation.is_awaiting_approval()` —— 审批挂起是**会话级单标志**，第二个主体触发审批会与第一个互相干扰 |
| `cognition/conversation.py:355` | `class Conversation` 1,040 行，内部 `_messages` 为单条消息序列 |
| `cognition/conversation.py:59-61` | `CONTEXT_WINDOW_TURNS`/`CONTEXT_BACKFILL_ROWS`/`CONTEXT_MAX_INPUT_TOKENS` 为**进程级全局预算**，非按主体分配 |

**C. 存储层（表结构无主体列）**
| 表 | 定义位置 | 阻碍 |
| --- | --- | --- |
| `history` | `memory/store.py:46-51` | 列仅 `id/ts/event_type/content`。**这是对话回灌的来源**，多主体下回灌会串台 |
| `insights` | `memory/store.py:54-60` | 列仅 `id/created/updated/category/content`。persona 投影直接读它 |
| `autonomy_state` | `memory/store.py:73-78` | `CHECK (id = 1)` 单行唤醒时钟 |
| `concerns` | `mind/migrations.py:40-54` | 无主体列；且 active 上限 12 是全局配额（蓝图 :140） |
| `experiences` | `mind/migrations.py:75-83` | 无主体列；`source` CHECK 白名单仅 6 值（`conversation/wake_action/action_result/silence/owner_event/system`），无"第三方成员事件" |
| `narrative_versions` / `narrative_threads` | `mind/migrations.py:56,66` | 自我叙事天然单主体（这是设计意图），但 `narrative_threads` 承载"对 Kevin 的承诺"（蓝图 :164），多主体下承诺必须归属到人 |
| `regulation_field` | `mind/migrations.py:22-27` | `name TEXT PRIMARY KEY` 四行全局。其中 `relational_tension`（蓝图 :110 定义为"沉默异常/主动联系未获回应"）**语义上必须按关系分主体**，当前主键结构不允许 |
| `integration_state` | `mind/migrations.py:97-101` | `CHECK (id = 1)` 单行 |
| `thoughts` | `mind/migrations.py:171` | 无主体列 |

**D. 台账层（单文件全局 JSON，无分区）**
`LYKOI_NOTIFICATIONS`（`kernel/notifications.py:80 _load()`）、`LYKOI_PENDING_ACTIONS`（`kernel/approval.py:238 _load_pending()`）、`LYKOI_CHAT_OUTBOX`（`shared/chat_outbox.py:27`）、`LYKOI_CONTINUATIONS`（`shared/continuations.py`）、`LYKOI_PROACTIVE_CHAT_LEDGER`（`shared/proactive_chat.py:19`）。
其中 `proactive_chat.py:37 _today_count` / `:42 _throttle_reason` 是**全局日配额**——多主体下一个人用完全部人都被节流。`kernel/notifications.py:32` 注释「Lykoi must be sparing about interrupting Kevin」，配额语义本身就是单主体的。

**E. 权限/审批层**
| 位置 | 阻碍 |
| --- | --- |
| `kernel/approval.py:323` | `consume_pending(..., actor: str = "owner")` |
| `cognition/conversation.py:954` | 唯一调用点写死 `actor="owner"` |
| `core/permission_evidence.py:164,181` | `actor: str = "owner"`；`if self.actor != "owner": raise` —— **非 owner 直接拒绝** |
| `core/permission_learning.py:108-118` | `PermissionContext` 8 个特征无主体维度 |
| `core/permission_learning.py:33` | `_ORIGINS = {"interactive","autonomous","scheduler","system"}` —— origin 是**运行时来源**，不是主体，无法承担 principal 语义 |
| `kernel/dispatch.py:216` | `origin: Literal["interactive","autonomous","scheduler","system"]` 同上 |

**F. 人格/种子层**
`memory/persona.py:25` 硬编码 `"Kevin 的偏好："`；`memory/seed.py:16` 硬编码种子偏好内容；`cognition/conversation.py:51 _BEIJING_TZ` 注释「她和 Kevin 都生活在北京时间」——时区是全局常量。

---

### 3.b 专业 Agent 委托与隔离（Delegation Gateway）

**结论：dispatch 层没有任何委托挂载点，但它的形状适合加。**

**当前 dispatch 有什么：**
- 单一入口 `dispatch()`（`kernel/dispatch.py:277`），AST 测试钉死独占（`test_governance_invariants.py:41`）
- 三层策略裁决 `_policy_decision`（:616 → `approval.check(action_type, origin)` :619）
- fail-closed 前置审计门（:39-49「the pre-dispatch audit is a GATE (fail closed)」）
- 相关性 ID / action_id / correlation_id 已贯穿（`:352 intent` / `:530 result`）

**缺什么（逐条）：**

| 缺口 | 证据 | 说明 |
| --- | --- | --- |
| **1. 委托主体维度** | `dispatch.py:207-217 DispatchContext` 只有 `origin` + `run_id` | 注释（:212-214）明确「every dispatch must declare its origin, so an action can never lose its provenance」——provenance 概念在，但粒度只到"哪个运行时边界"，没有"谁委托给谁"。委托链（owner → Lykoi → 专业 Agent）无处表达 |
| **2. 委托 origin 枚举位** | `dispatch.py:216`、`approval.py:33`(`_ORIGINS`)、`shadow.py:196`(`CHECK(origin IN ('interactive','autonomous','scheduler','system'))`) | 三处**独立**的 4 值枚举，加一个 `delegated` origin 需同时改三处 + 一次 DB 迁移 |
| **3. 动态资源注册** | `dispatch.py:227-233 _RESOURCES` 硬编码 5 项字典；`:236-238` 注释「Adding an action means adding it here — a conscious [choice]」；`:261-273 _resolve` 先查 `KNOWN_ACTIONS` 白名单再取 `_RESOURCES` | 这是**有意的安全设计**（防止 helper 被 getattr 提升为 action），但也意味着委托代理不能自带能力集。需要的是"密封的、可验证的能力清单注册机制"而非放开白名单 |
| **4. 子代理隔离域** | 无任何按代理分域的运行时边界 | `core/execution_session.py:28 EXECUTOR_INSTANCES` + `:74-91` 的 cgroup 绑定是**现成的隔离原语**（把一个 executor 绑到精确的 systemd cgroup），但它 default-off（`LYKOI_CORE_EXECUTION_SESSION_ENABLED` 不在 unit 中），且当前只映射 dispatch origin（`dispatch.py:136 _execution_executor_instance`），不是代理身份 |
| **5. 能力剖面按代理分级** | `approval.py:79-93 _capability(origin, action_type)`；`:87 if origin == "scheduler"` 走硬编码 floor；`:89 if origin != "autonomous"` 直接放行到 live 规则 | 能力剖面只按 origin 分，**只有 `autonomous` 与 `scheduler` 有不可变约束**。委托代理若映射到 `interactive`，将绕过 policy_core 的不可变 DENY —— 这是缺口 b 最危险的一处 |
| **6. 审批归属** | `approval.py:267-311 enqueue_pending(..., origin, run_id)`；`:302 "origin": origin` | pending 记录了 origin 与 run_id，但没有"这个审批该问谁"的字段 |
| **7. 工具注册** | `cognition/conversation.py:92 TOOL_TO_ACTION` / `:105 TOOLS` 静态列表 | LLM 可见的工具表是编译期常量，委托能力无法按会话注入 |

**可复用的正面资产（不必重建）：**
- `resources/research_browser.py:3-7` 的物理隔离范式（独立 Chrome、不共享 profile、「a research read cannot act as Kevin」）——这是专业 Agent 沙箱的直接模板
- `dispatch.py:39-71` 的 fail-closed 审计降级机制（`audit_degraded()` :47）——委托层可直接复用同一门
- `core/shadow.py:192-225 commands` 表已含 `origin`/`run_id`/`episode_id`/`legacy_action_id`，加 `delegate_id` 的结构空位存在

---

### 3.c 程序性学习与可靠性积累

**结论：有三处可复用的经验存储结构，但两处被显式钉死为"禁止评估"，一处已被裁定不激活。**

**① 有结构、但被 CHECK 钉死为不可用 —— `core/shadow.py` outcomes 表**
```
core/shadow.py:259  CREATE TABLE outcomes (
core/shadow.py:265      execution_status TEXT NOT NULL
                            CHECK(execution_status IN
                            ('adapter_succeeded','adapter_failed','timed_out','cancelled','unknown')),
core/shadow.py:268      evaluation_kind TEXT NOT NULL CHECK(evaluation_kind='unassessed_legacy'),
core/shadow.py:269      proposal_ref TEXT,
core/shadow.py:270      supersedes_outcome_id TEXT,
core/shadow.py:271      assessment_sha256 TEXT NOT NULL CHECK(length(assessment_sha256)=64),
core/shadow.py:272      assessment_json TEXT NOT NULL CHECK(json_valid(assessment_json)),
core/shadow.py:281      CHECK(proposal_ref IS NULL)
```
这是**为程序性学习预留的完整骨架**：结果状态、评估种类、评估内容 JSON + 其哈希、版本演进链（`supersedes_outcome_id`）、提议引用（`proposal_ref`）。但 `:268` 把 `evaluation_kind` 锁死为单值 `'unassessed_legacy'`，`:281` 把 `proposal_ref` 锁死为 NULL。**即：结构建好了，然后用 CHECK 约束禁止使用。** 解锁需要一次 schema 迁移（该表在 `_V1` 元组内，`shadow.py:145`）。

**② 有结构、已裁定不激活 —— `mind/salience_shadow.py` Beta 后验**
```
mind/salience_shadow.py:142  CREATE TABLE posterior (
                                 key TEXT PRIMARY KEY, alpha REAL, beta REAL, last_update_ts TEXT);
mind/salience_shadow.py:148  CREATE TABLE shadow_log (... score, boost, explore_flag, selected,
                                 skip_reason, load_value, load_tier, presented_today, presented_hour,
                                 outcome, outcome_ts, outcome_integration_id);
```
这是**教科书式的可靠性积累结构**：per-key Beta(α,β) 后验 + 带 explore 标志的决策日志 + 事后 outcome 回填 + append-only 触发器（:167-170）。唯一写入点 `mind/store.py:765-766 salience_shadow.on_experience_recorded(...)`。
但 owner 审计已裁决：`docs/project_backlog.md` CORE-NOW-01 原文「selected/unselected 实际整合率均为 100%，uplift=0；旧版本 `do_not_activate_insufficient_discrimination`」。
**判断：结构可复用（Beta 后验 + explore/exploit 日志的形状是对的），当前 key 定义与 reward 信号无甄别力。重构时保留 schema 设计、重定义 key 与 outcome 信号。**

**③ 有结构、无主体、无生产消费者 —— `core/permission_learning.py`**
```
core/permission_learning.py:108-118  PermissionContext（8 个分类特征，无 payload、无主体）
core/permission_learning.py:23-27    CONTEXT_CONTRACT / POLICY_CONTRACT / EVIDENCE_CONTRACT / ENGINE_VERSION
core/permission_learning.py:1-11     "deliberately a pure evaluator ... does not import kernel and cannot execute an action"
```
设计上是纯函数式证据累积器（"policy 决定需要多少 owner 证据才自动 allow"），形状适合可靠性积累。但：(1) 无主体维度；(2) 生产消费者为 0（backlog 原文「行为 consumer 均 absent」）；(3) 上层三个模块（projection/replay/evidence_shadow）合计 1,813 行才把它接到数据上。

**④ 现存但不构成程序性学习的结构（澄清，避免误判为资产）**
- `mind/experiences` 表（`migrations.py:75`）：只有 `salience`（写入时初评）+ `integrated` 标记，**没有"这个做法有效吗"的回路**。蓝图 §4.3(:254-261) 要求"回流必然写经验"，做到了记录，没做到评估。
- `memory/autonomy_runs`（`store.py:81-95`）：有 `status`（running/completed/failed/stale）与计数，是运行遥测，不是能力可靠性。
- `mind/thoughts`（`migrations.py:171`，API 在 `thoughts.py`）：有 `charge` 衰减（`:293 decay_all_open_thoughts`）与状态机（open/resolved/absorbed/abandoned/archived），是注意力经济结构，**不是技能可靠性结构**。
- `core/attention_decisions`（`shadow.py:561`）：有 `decision`(attend/defer/decline)、`policy_sha256`、`input_sha256`、`reconsider_after`——**是决策审计，不是结果回填**；无 outcome 列。

**汇总判断（缺口 c）**：可复用的经验存储结构**存在**，共 2 处形状正确（`outcomes` 的评估骨架、`posterior` 的 Beta 后验），但都不可直接投产：前者被 CHECK 禁用、后者被审计裁定无甄别力。第三处（`permission_learning`）形状可参考但需在解决缺口 a 后重新定义特征集。

---

## 4. 过度设计候选（为未实现能力预留、无生产调用者）

**验证方法说明（每条都用同一套三步交叉验证）：**
1. `grep -rn "<symbol>" src/lykoi scripts --include=*.py` 找全部引用；
2. 排除定义文件自身、`tests/`、`scripts/` 后看剩余调用点；
3. 若剩余调用点存在，检查其是否被 `os.environ.get(..., "0")` 型 default-off 开关包裹，并核对该开关是否出现在三个 systemd unit 文件中。

---

### 候选 1：`core/permission_projection.py`（490 行）—— 强候选

**验证**：
```
grep -rn "permission_projection" src/lykoi tests scripts --include=*.py
  → src/lykoi/core/permission_replay.py:23,76,89,95,274,292,297,309,334   （唯一 src 消费者）
  → tests/test_core_v1_m3_r2c_r3_projection_candidate.py:8,47
  → tests/test_core_v1_m3_r2c_r2_permission_replay.py:15,27,102,110,183,188,196
```
唯一 src 消费者是 `permission_replay`，而 replay 自身也无生产消费者（候选 2）。**净生产调用者 = 0。**
预留的能力：`ProjectedPermissionDecision`、`load_sealed_projection`(:410)、`canonical_json_bytes`(:108)、密封 policy 文件校验（`policies/permission_replay/r3_terminal_hard_ask_sentinel_v1.json` + `.sha256`）。

---

### 候选 2：`core/permission_replay.py`（431 行）—— 强候选

**验证**：
```
grep -rn "permission_replay" src/lykoi --include=*.py | grep -v "^src/lykoi/core/permission_replay.py"
  → src/lykoi/core/permission_evidence_shadow.py:394   （函数体内惰性 import）
  → src/lykoi/core/runtime.py:1392, 1661-1680
```
两处调用点全部条件化：
- `permission_evidence_shadow.py:395-399`：`if not permission_replay.replay_shadow_enabled(): raise ... "permission replay reader is not requested"`
- `runtime.py:1392 permission_replay_mode = permission_replay.replay_shadow_enabled()`，`:1661 if permission_replay_mode:`

开关 `LYKOI_CORE_PERMISSION_REPLAY_SHADOW_ENABLED` **不在任何 unit 文件中**。且 `runtime.py:1662-1664` 自述「a one-shot, read-only counterfactual gate ... never acquires a writer, socket operation, maintenance tick, or **behavior consumer**」。**净生产调用者 = 0，且代码自证无行为消费者。**

---

### 候选 3：`core/permission_evidence_shadow.py`（487 行）+ `cognition/permission_evidence_shadow.py`（54 行）—— 中强候选

**验证**：
```
grep -rn "permission_evidence_shadow" src/lykoi --include=*.py
  → src/lykoi/core/runtime.py:1639, 1667  （函数体内惰性 import，被 :1636 if permission_evidence_mode 包裹）
  → src/lykoi/cognition/conversation.py:959, 1008  （record_owner_decision，真实调用点）
```
`conversation.py:959/1008` 是**真实生产路径上的调用**（审批批准/拒绝时记录），这一条与前两条不同 —— 有写入者。但：
- 写入端受 `LYKOI_PERMISSION_EVIDENCE_SHADOW_CLIENT_ENABLED` 控制，不在 unit 中；
- backlog CORE-NOW-02 记录 R1 已激活并 closure（facts/recorded/failed=3/3/0），即**曾经真实写过 3 条**；
- 但同一条目原文「R2 与行为 consumer 均 absent」——**写入有，读出与使用无**。

**判定**：不是纯死代码，是"只写不读"的单向账本。487 行写入基础设施服务 3 条事实、零消费者。重构时应按缺口 a 重新定义 schema（当前 `permission_decision_facts` 表 `core/permission_evidence_shadow.py:35` 同样无主体列），而非保留。

---

### 候选 4：`core/attention_policy.py`(433) + `attention_candidate.py`(111) + `attention_decision.py`(163) —— 中候选

**验证**：
```
grep -rn "attention_candidate\|attention_decision\|attention_policy" src/lykoi scripts --include=*.py | grep -E "import|from"
  → src/lykoi/core/attention_decision.py:9   from lykoi.core import attention_candidate, attention_policy
  → src/lykoi/core/runtime.py:1387           from lykoi.core import attention_candidate, attention_decision  （函数体内）
```
唯一外部入口 `runtime.py:1387-1390`：
```
candidate_mode = attention_candidate.candidate_enabled()
decision_mode  = attention_decision.decision_enabled()
```
开关 `LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED` / `LYKOI_CORE_ATTENTION_DECISION_ENABLED` **不在任何 unit 文件中**。
另有 `runtime.py:1396-1399`：candidate 与 schema activation **不能同时启用**，`:1399` 起还要求 `LYKOI_CORE_EVENT_INGRESS_ENABLED == "1"` —— 三个开关的联立条件。
配套资产：`policies/attention/lykoi_environment_freshness_baseline_v1.json` + `.sha256`、`tests/fixtures/attention_policy_v1_cases.json`、DB 表 `attention_candidates`/`attention_decisions`（`shadow.py:548,561`）。
**净生产调用者 = 0（三重开关全部 default-off）。**

> 注意：这一组与 mind 的注意力机制（`mind/snapshot.py` Top-N 关切、`mind/thoughts.py` charge 排序）**功能重叠**。mind 侧是活的（`autonomous.py:41` 生产 import），core 侧是死的。重构时应二选一。

---

### 候选 5：`mind/store.py:1335 owner_edits_log` / `:1364 owner_edits_list` —— 确定候选（小体量）

**验证**：
```
grep -rn "owner_edits_log\|owner_edits_list" src tests scripts --include=*.py | grep -v "src/lykoi/mind/store.py"
  → tests/test_mind_store.py:176,177,180   （仅测试）
```
**src 中零调用者。** 交叉证据：`mind/console.py:126-127` 的 argparse 只注册了 `show_regulation`(:42)/`show_concerns`(:66)/`show_narrative`(:81)/`show_experiences`(:100) 四个只读子命令，parser 描述字面为 `"Lykoi owner console (read-only)"`。
即：蓝图 §7(:316-321) 要求的「修改操作必须走 console 的 edit 命令 → 自动快照 → 写 owner_edits 台账 → 一致性检查清单」**只实现了台账写入 API，没有实现调用它的 edit 命令**。表（`migrations.py:103`）+ API（35 行）+ 红线测试（`test_mind_red_lines.py`）都在，唯独没有生产者。

---

### 候选 6：`scripts/p4r_compressed_harness.py`(468) + `scripts/p4r14_state_closure_harness.py`(320) —— 确定候选

**验证**：
```
grep -rn "p4r_compressed_harness\|p4r14_state_closure" src/lykoi --include=*.py   → 无命中
```
生产代码零引用；仅 `tests/test_p4r_compressed_harness.py`、`tests/test_p4r14_state_closure.py` 引用。反向依赖 6 个 mind 模块（`p4r_compressed_harness.py:123-128`）与 3 个（`p4r14_state_closure_harness.py:57-59`），会随 mind 重构持续腐坏。属 Phase 4 观察期一次性 harness，`docs/` 已进入 Phase 5（`docs/phase5_prereg_v1.md`、`docs/p5_salience_shadow_release_audit_20260801.md`）。

---

### 候选汇总表

| # | 单元 | 行数 | 生产调用者 | 验证依据 | 建议 |
| --- | --- | ---: | --- | --- | --- |
| 1 | `core/permission_projection.py` | 490 | **0** | 唯一 src 消费者是同为零消费者的 replay | 删除或冻结归档 |
| 2 | `core/permission_replay.py` | 431 | **0** | 两处调用点均被 default-off 开关守卫；`runtime.py:1664` 自述「never acquires a behavior consumer」 | 删除或冻结归档 |
| 3 | `core/permission_evidence_shadow.py` + cognition 侧 | 541 | 写 1 / 读 **0** | backlog CORE-NOW-02「R2 与行为 consumer 均 absent」 | 重写（需按缺口 a 重定义 schema） |
| 4 | `core/attention_{policy,candidate,decision}.py` | 707 | **0** | 三重开关（candidate/decision/event_ingress）均不在 unit 中；与 mind 注意力机制功能重叠 | 二选一，建议保 mind 侧 |
| 5 | `mind/store.py` owner_edits API | ~35 | **0** | console 为 read-only（`console.py:127`），edit 命令未实现 | 保留表，补齐 console edit（蓝图 §7 未完工项）或一并移除 |
| 6 | `scripts/p4r*` harness | 788 | **0** | 生产代码零引用；Phase 4 已闭环 | 归档出仓 |
| — | `mind/salience_shadow.py`（§2.3 已列） | 453 | 写 1 / 用 **0** | owner 裁决 `do_not_activate_insufficient_discrimination`，uplift=0 | 保留 schema 设计思路，移除实现 |

**候选合计**：约 **3,445 行**（占全库 11.9%）为「为未实现能力预留、无生产消费者」的结构。若含 §2.3 的 core R2C 分支整体（1,813 行，与候选 1–3 部分重叠）与 `shadow.py` 中对应的未启用表定义，实际负债面更大。

---

## 5. 待核实清单（不猜测）

1. 白皮书 31.3 原文与其结论章三大缺口的精确措辞 —— 本工作副本 `docs/` 下 151 个文件中 `grep -rn "31\.3"` 无命中，本报告依 WO 正文定义作业。
2. 线上三个 systemd 服务的**实际** Environment（是否有 root-owned drop-in / EnvironmentFile 注入本报告判定为 default-off 的 9 个开关）。仓内 unit 文件是唯一可见证据。
3. `guardian/startup_verify.py` 与 `scripts/startup_verify.py` 是否逐字节相同（两者均 413 行）。只读 diff 可做但本次未做，因结论会直接影响"删哪一份"。
4. `manifest.sha256` 的实际覆盖面是否已按蓝图 P0-2（`lykoi_v0_blueprint.md:56-60`）扩展到 `approval_rules.json` schema 校验器与人格 TOML。
5. `core/shadow.py` 中 8 张 v1 表 + 2 张 v2 表在生产 `core_facts.db` 中的实际行数（判断"从未写入"还是"写过后停用"）。本报告依开关状态推断，未查库。
6. `permission_evidence` R1 的 3 条已记录事实的实际内容与后续处置（backlog 仅记录计数）。
