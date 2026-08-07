# WO-BASE-03 风险清单逐条核实

## 执行摘要

1. **证实** — 凭证唯一来源是 `/home/lykoi/secrets/*.env` 明文文件，由 systemd `EnvironmentFile=` 注入进程环境；全仓无 Vault / keyring / 句柄代理的任何实现。
2. **证实** — `guardian/startup_verify.py` 的 manifest 覆盖 `cognition/mind/shared/surface/resources` 五个包，**独漏 `src/lykoi/memory/`**（4 个文件，含 `insights` 表的唯一写入点）。
3. **部分属实** — 多数逐出点有 `log_event`；但 `notifications.py`、`chat_outbox.py`、`research_browser.py` 的截断/挤出确为静默（详见第 3 条清单）。
4. **证实** — 断点在 `autonomy_notes → insights` 之间：`integrator.py` 从不调用 `upsert_insight`，`note_insight_links` 表在 schema 里根本不存在；运行期唯一写 `insights` 的是启动播种。
5. **证实** — `owner_edits_log/list` 定义于 `mind/store.py`，全仓非测试调用者为 0。
6. **证实** — 滚动摘要 `Conversation._summary` 是纯进程内属性，重启即归 `None`；模型切换需改 env 并重启，同样丢失。
7. **证实** — 自主动作在 `lykoi-autonomy.service` 进程内经 `kernel.dispatch` 执行，`terminal.exec` 不设 `cwd`，继承 `WorkingDirectory=/home/lykoi/projects/lykoi` = 代码仓库根。存在直接把产物写进代码仓的路径。

**核实边界**：`/home/lykoi/state` 在本会话被工具沙箱拦截（`ls` 返回 "may only list files in the allowed working directories"），因此本报告中所有关于活体文件存在性/大小/权限的判断均标注为「待核实」，结论全部基于工作副本的代码与清单文件。

---

## 1. Secret 仍以明文环境文件为主

**结论：证实。**

### 凭证注入面（唯一入口）

| 位置 | 内容 |
|---|---|
| `lykoi-server.service:13-14` | `EnvironmentFile=/home/lykoi/secrets/llm.env`、`EnvironmentFile=/home/lykoi/secrets/surface.env` |
| `lykoi-autonomy.service:15-16` | 同上两行（注释明确说明「Same env as the surface」） |
| `lykoi-core.service` | **无** `EnvironmentFile`（Core runtime 不持凭证，只有 `LYKOI_CORE_RUNTIME_SOCKET` / `_LOCK` 两个路径变量，`lykoi-core.service:13-14`） |

### 凭证变量名与读取位置（只列名与位置，未读取任何值）

**LLM 提供方密钥：**
- `LYKOI_DEEPSEEK_API_KEY` — `src/lykoi/cognition/llm_router.py:68`（main 路由）、`llm_router.py:100`（autonomous 路由）。两处均为 `os.environ[...]` 硬取，缺失即 `KeyError`。
- `LYKOI_MIMO_API_KEY` — `src/lykoi/cognition/llm_router.py:83`（vision 路由）。
- 伴随端点：`LYKOI_DEEPSEEK_BASE_URL`（`llm_router.py:69,101`）、`LYKOI_MIMO_BASE_URL`（`llm_router.py:84`）。
- 密钥的实际使用点：`src/lykoi/cognition/llm_client.py:48`（`ModelConfig.api_key` 字段）、`llm_client.py:102`（`headers = {"Authorization": f"Bearer {cfg.api_key}"}` — 明文拼进请求头）。

**Surface / 感知接入令牌：**
- `LYKOI_SURFACE_TOKEN` — `src/lykoi/surface/app.py:34`。
- `LYKOI_PERCEPTION_TOKEN` — `src/lykoi/surface/app.py:37`，回退到 `SURFACE_TOKEN`。
- 客户端侧：`scripts/chat.py:54`（先读 env），`scripts/chat.py:57` **直接以纯文本逐行解析 `/home/lykoi/secrets/surface.env`，匹配前缀 `LYKOI_SURFACE_TOKEN=`** — 这是明文文件被当作明文文件读的直接证据。
- 同类模式：`scripts/patches/wo-post-02/root_apply.sh:41` 用 `grep -oP '^LYKOI_SURFACE_TOKEN=\K.*'` 从 env 文件里抠 token。

**跨进程读取（非文件路径）：**
- `scripts/patches/core-v1-m3-r1a/root_apply.sh:1129` 与 `core-v1-m3-r1a1/root_apply.sh:1191`：`env.get(b"LYKOI_PERCEPTION_TOKEN") or env.get(b"LYKOI_SURFACE_TOKEN")`，读取来源是 `/proc/{server_pid}/environ`（测试断言见 `tests/test_core_v1_m3_r1a_rollout.py:493-495`）。即 canary 脚本从另一进程的环境块里取令牌——只有在「令牌就是明文环境变量」的前提下才成立。

### 是否存在 Vault / 句柄机制

**不存在。** 全仓（`src/`、`scripts/`、`guardian/`、`*.service`）对 `vault|secret_manager|keyring|sops|age-encrypt|token_broker` 的检索，命中的全部是无关同名词（`handle` = 文件句柄、`handler` = 动作处理器）。没有任何一处：
- 把密钥换成不透明句柄；
- 在使用点向外部服务换取短期凭证；
- 对 env 文件做静态加密。

唯一的保护是**路径层**而非**机密层**：`guardian/startup_verify.py:250` 断言 `policy_core.is_protected_path("/home/lykoi/secrets/llm.env")` 为真，即路径守卫禁止认知层通过动作面读写该目录；`startup_verify.py:252` 反向断言不能过度封锁工作区。这挡的是「Lykoi 自己去读」，挡不住「进程环境里是明文」。

### 影响面

- 任何能读 `/proc/<pid>/environ` 的同 uid 进程即得全部 LLM 密钥与 surface 令牌；`core-v1-m3-r1a` canary 已经在生产脚本里演示了这条读取路径。
- 密钥轮换必须改文件 + 重启两个 unit（`lykoi-server` / `lykoi-autonomy`）；无热轮换、无短期凭证、无按调用审计。
- `LYKOI_DEEPSEEK_API_KEY` 被 main 与 autonomous 两个路由共用（`llm_router.py:68` 与 `:100` 同一变量），泄露后无法按路由区分吊销。
- 缓解事实：`llm_router.py` 与 `llm_client.py` 均未把 `api_key` 写入日志；`ModelConfig` 只在请求头使用。未见密钥落盘/落日志的路径。

---

## 2. memory/ 未完全纳入完整性清单

**结论：证实。**

### 完整性清单机制

实现在 `guardian/startup_verify.py`，作为两个 unit 的 `ExecStartPre` 强制运行（`lykoi-server.service:17`、`lykoi-autonomy.service:18`、`lykoi-core.service:17`），非零退出即阻断启动。

覆盖集合由 `_protected_files()` 计算（`startup_verify.py:119-138`）：

| 条目 | 代码位置 |
|---|---|
| `guardian/*.py` | `startup_verify.py:85-87`, `:124` |
| `src/lykoi/__init__.py` | `startup_verify.py:61`, `:125` |
| `src/lykoi/kernel/*.py` | `startup_verify.py:89-90`, `:126-127` |
| `src/lykoi/core/*.py` | `startup_verify.py:93-94`, `:128-129` |
| `src/lykoi/{cognition,mind,shared,surface,resources}/*.py` | `startup_verify.py:100`（`COGNITION_DIRS`）, `:103-108`, `:130-131` |
| 人格 TOML `/home/lykoi/runtime/persona/lykoi_base.toml` | `startup_verify.py:76`, `:132` |
| 审批规则 `/home/lykoi/state/approval_rules.json` | `startup_verify.py:75`, `:133` |
| `docs/phase5_prereg_v1.md` | `startup_verify.py:137` |

校验逻辑 `_check_manifest`（`startup_verify.py:256-282`）是双向的：清单内文件必须存在且哈希匹配，受保护文件必须在清单内；清单缺失直接判 FAIL（`:257-259`，无静默 bootstrap）。

### 未被覆盖的关键路径

**① `src/lykoi/memory/` 整个包 —— 白皮书断言的核心，成立。**

`COGNITION_DIRS`（`startup_verify.py:100`）为 `("cognition", "mind", "shared", "surface", "resources")`，**不含 `memory`**。逐条比对 `guardian/manifest.sha256`（89 行，见下）确认以下 4 个文件既不在清单、也不在 `_protected_files()` 的任何分支里：

- `src/lykoi/memory/__init__.py`
- `src/lykoi/memory/store.py` — `insights` 表与 `history` 表的唯一写入点（`memory/store.py:213 upsert_insight`、`:46 CREATE TABLE history`、`:54 CREATE TABLE insights`）
- `src/lykoi/memory/persona.py` — `build_persona_prompt()`，其输出被拼进系统提示词（`cognition/conversation.py:365-367`）
- `src/lykoi/memory/seed.py` — 启动播种

严重性来自**它被受保护代码直接依赖**：`cognition/conversation.py:39-40`、`mind/decide.py:32`、`mind/integrator.py:35`、`mind/snapshot.py:36`、`mind/reflow.py:32`、`cognition/autonomous.py:37`、`cognition/scheduler.py:36`、`cognition/restart.py:29`、`cognition/self_state_sources.py:19`、`surface/app.py:25` 全部 `from lykoi.memory import ...`。也就是说：清单锁死了调用方，却没锁被调用方——替换 `memory/persona.py` 即可改写注入进系统提示词的内容，而启动闸不会报警。

同时 `memory/` 也不在 `_check_protected_tree()` 的 root 属主要求内（`startup_verify.py:190-232` 只覆盖 `src`、`src/lykoi`、`src/lykoi/__init__.py`、`kernel/`、`core/`、人格 TOML），因此服务账户对这 4 个文件既可写、又不被哈希核验。

**② 其他未覆盖项（次要，一并列出）**

- `scripts/*.py` 全部未覆盖 — 含 `scripts/startup_verify.py`（`guardian/startup_verify.py:4-7` 自述为「staged 副本」）、`scripts/offsite_backup.sh`、`scripts/p02_harden.sh`、`scripts/realtime_guard.py`。注意闸门校验的是 `guardian/` 下的活体副本，staged 副本被改不影响本次启动，但会在下次 `p02_harden.sh` 安装时被带上去。
- `policies/attention/lykoi_environment_freshness_baseline_v1.json`、`policies/permission_replay/r3_terminal_hard_ask_sentinel_v1.json` — 不在 manifest。二者各自有旁置 `.sha256`，属于独立的自校验机制，**未接入启动闸**（`_protected_files()` 无 `policies/` 分支）。
- 非 `.py` 的 guardian 文件：`guardian/watchdog.service` 不在清单（`_guardian_py()` 只 glob `*.py`）。
- `docs/` 下仅 `phase5_prereg_v1.md` 单文件被锚定（`startup_verify.py:137`）；其余 prereg 文档（`core_v1_m3_r2b_execution_activation_prereg_v1..v14` 等）依赖各自旁置 `.sha256`，同样未接入启动闸。

**③ 明确说明为超出范围的项**（非缺陷，是已声明的威胁模型边界）
`startup_verify.py:17-20` 与 `:196-198` 自述：`src` 之上的祖先目录链、以及服务账户被攻陷的场景不在本闸门威胁模型内。

### 影响面

`memory/store.py` 与 `memory/persona.py` 是「什么内容会进入系统提示词」的最后一段代码。它们同时脱离 root 属主保护与哈希锚定，构成一条绕过 GOV-01 部署纪律的注入路径：改这两个文件不需要 root 重签 manifest，服务重启照常通过闸门。

---

## 3. 某些有界队列可能静默逐出数据

**结论：部分属实。** 静默丢弃确实存在，但不是普遍情况——绝大多数逐出点带 `log_event`。逐个判定如下。

### A. 静默丢弃（无日志、无告警）

| # | 位置 | 机制 | 判定 |
|---|---|---|---|
| A1 | `src/lykoi/kernel/notifications.py:124-125` | `if len(items) > _MAX_KEEP: items = items[-_MAX_KEEP:]`（`_MAX_KEEP = 500`，`:28`） | **静默**。`add_notification` 只在 `:127` 记 `notification_sent`，逐出本身无任何事件。注释写「typically already-read」，但代码**未检查 `read` 标志**——积压到 500 条以上时，最旧的**未读**通知会被无声挤掉，Kevin 永远不知道有过这条。 |
| A2 | `src/lykoi/shared/chat_outbox.py:69-70` | `state["items"] = items[-_MAX_KEEP:]`（`_MAX_KEEP = 200`，`:24`） | **写侧静默**（`:72` 只记 `chat_outbox_queued`）。**读侧有补偿**：`read_after` 在 `:86` 计算 `gap = after < oldest_id - 1`，`:89-96` 记 `chat_outbox_read(gap=...)`，并在 `:103` 把 `gap` 返回给客户端。所以「丢了」这一事实**可在读侧被发现**，但仅当有客户端带着旧 cursor 来拉；若无人来读，丢弃无痕。注意 `take_all()`（`:107-117`）是破坏性 drain，走这条路的客户端拿不到 gap 信号。 |
| A3 | `src/lykoi/resources/research_browser.py:336` | `return {"text": _mark_external((text or "")[:MAX_TEXT_CHARS])}`（`MAX_TEXT_CHARS = 500_000`，`:57`） | **静默**。截断无省略标记、无日志。模型看到的是一段看似完整的网页正文，无法判断后面还有内容。 |
| A4 | `src/lykoi/resources/research_browser.py:343` | `.map(a => a.href).slice(0, {MAX_LINKS})`（`MAX_LINKS = 500`，`:58`） | **静默**。超出 500 的链接直接消失，无计数、无标记。 |
| A5 | `src/lykoi/mind/integrator.py:719` | `merged = (old + "\n" + note).strip()[:1024]` | **静默**。concern 描述合并后硬截 1024 字符；无日志。这条写的是持久化状态（concern description），丢的是认知内容本身。 |
| A6 | `src/lykoi/shared/proactive_chat.py:66` | `write_json_atomic(LEDGER_PATH, sent[-_MAX_KEEP:])`（`_MAX_KEEP = 50`，`:22`） | **静默，但无实质风险**。该账本只存发送时刻字符串用于限流；`DAILY_CAP = 1`（`:20`），50 条足够覆盖判定窗口。列出以求完整。 |
| A7 | `src/lykoi/cognition/conversation.py:667-668` | 摘要输入里 `content[:_TOOL_RESULT_CLIP_CHARS] + "…(已截断)"` | **半静默**。有 inline 标记（摘要模型看得见），但无 `log_event`。 |
| A8 | `src/lykoi/cognition/conversation.py:403,406` | 回灌时 `[:BACKFILL_CLIP_CHARS]` 两侧裁剪 | **静默**。同一函数里**跳过的坏行**有日志（`:411-414`），但**正常行的裁剪**没有。 |

### B. 有日志/有告警（证伪该断言在这些位置成立）

| 位置 | 机制 | 日志 |
|---|---|---|
| `cognition/conversation.py:647` | 软窗口摘要后丢弃溢出轮次 | `:649-653` `log_event("context_trimmed", dropped_messages=..., rounds_kept=...)` |
| `cognition/conversation.py:710` | 硬预算裁剪最旧整轮 | `:711` `log_event("context_hard_trimmed", upto_round=2)` |
| `cognition/conversation.py:713` | 丢弃整个回灌块 | `:714` `log_event("context_backfill_dropped", reason="over_budget")` |
| `cognition/conversation.py:720-724` | 无可丢弃时 | `:721` `log_event("context_over_budget")` **并抛 `ContextBudgetError`**，向 Kevin 显式报错（`:722-723`）——失败响亮，不是静默 |
| `cognition/conversation.py:408` | 回灌遇不可解析行跳过 | `:411-414` `log_event("backfill_rows_skipped", skipped=..., total=...)`，注释明写「silent drops would turn history corruption into quiet amnesia」 |
| `mind/thoughts.py:113-122` | 容量满时挤掉最弱 thought | `:113` `log_event("thought_rejected_capacity", ...)` + `:122` 落 `thought_lapse` 经验痕迹 |
| `mind/thoughts.py:311-325` | 衰减归零后 abandon | `:315` 落 `thought_lapse` + `:323-324` `log_event("thoughts_decay", decayed=, abandoned=)` |
| `kernel/notifications.py:107-111` | 节流拒绝 | `:110` `log_event("notification_throttled", origin=, reason=)` |
| `shared/proactive_chat.py:62-64` | 限流拒绝 | `:63` `log_event("proactive_chat_throttled", reason=)` |
| `cognition/followup.py:89-90` | followup 队列满（`MAX_FOLLOWUPS = 3`，`:39`） | `:90` `log_event("followup_queue_full", dropped_chars=...)` |
| `mind/store.py:858-872` | 环境事件日配额丢弃 | 落 `environment_ingest_receipts` 行 `disposition='dropped_limit'`（`:861-867`）+ `environment_ingest_state.dropped_limit` 计数（`:868-872`）。收据表 append-only（`migrations.py:349-354`），比日志更强。 |
| `mind/store.py:880-894` | 环境事件分钟速率丢弃 | 同上，`disposition='dropped_rate'`（`:883-889`）+ `dropped_rate` 计数。且 `surface/perception.py:176` 把 `rate_limit` 上报为 `breach` 标志。 |
| `core/attention_decision.py:115` | `committed > DECISION_COMMIT_LIMIT` | 不是逐出，是**不变式断言**（超限即拒绝该决策记录，非丢数据） |
| `core/baseline.py:138-159` | 快照复制时丢弃可能写了一半的末行 | `:159` 把 `truncated_inflight_bytes` 写进快照元数据 |

### C. 不属于逐出（澄清，避免误报）

`memory/store.py:148,169,180,208,316,390`、`mind/store.py:297,300,576,605,1207,1367`、`core/shadow.py` 各处的 `ORDER BY ... LIMIT ?` 全部是**读取分页**，底层行不删除。`mind/migrations.py:349-414` 对 `environment_ingest_receipts` / `environment_core_event_outbox` / `environment_core_event_deliveries` 建了 `no_update` / `no_delete` 触发器，`memory/__init__.py:4` 声明 `history` 由 SQLite 触发器强制 append-only。持久层整体是只增不删的。

### 影响面

真正需要注意的是 **A1 与 A3/A4**：
- A1 是**面向 Kevin 的通道**——未读通知可被静默挤出，且逐出发生在写侧，事后无法从 `events.jsonl` 重建「丢了哪几条」。
- A3/A4 是**面向模型的外部信息通道**——模型收到截断后的网页正文/链接表，却没有任何截断信号，会把「我看到的就是全部」当成事实推理下去。这是可导致虚构（confabulation）的输入侧缺口，而仓内已有 `tests/test_confab_invariant.py` 在防同类问题的输出侧。

---

## 4. Insight 运行时写入链不完整

**结论：证实。断点在 `autonomy_notes` → `insights` 这一环——该环节的代码与 schema 均不存在。**

### 完整调用链追踪

**读侧（活的，接进了生产提示词）：**
```
memory/store.py:235  get_insights(category)
        ↑
memory/persona.py:19-20  persona = get_insights("persona"); prefs = get_insights("preference")
        ↑  build_persona_prompt()
        ├─→ cognition/conversation.py:365-367  acquired = build_persona_prompt(); parts.append(acquired)
        │                                       → self._messages[0] 系统提示词（:368）
        └─→ mind/decide.py:32  from lykoi.memory.persona import build_persona_prompt
                                （自主唤醒路径的同一人格拼装）
```

**写侧（只剩启动播种一条）：**
```
memory/store.py:213  upsert_insight(category, content)
        ↑
memory/seed.py:23  upsert_insight(category, content)   ← SEEDS 仅 1 条（seed.py:15-17）
        ↑
memory/seed.py:20  seed_persona()
        ↑
surface/app.py:25  from lykoi.memory.seed import seed_persona   ← 进程启动时调用
```

**断点位置：`upsert_insight` 在全仓的引用者只有 2 个文件。** 检索 `src/`、`scripts/`、`guardian/`、`tests/` 得到：`memory/store.py:213`（定义处）、`memory/seed.py:13,23`（导入+调用），此外全为文档注释。运行期认知循环（`mind/integrator.py`、`mind/reflow.py`、`cognition/autonomous.py`）**没有任何一处调用它**。

### 断点两侧的具体证据

**上游有产出：** 自主循环把观察写进 `autonomy_notes`，`memory/store.py:356-384 append_autonomy_note()`。该函数的 docstring（`:365-367`）明确写出了本应存在的下一环：

> "The autonomous loop writes here and NEVER directly to `insights` — promotion is governed, periodic, and fidelity-checked by the integration pass (`mind/integrator.py`)."

**下游的「晋升」实现缺失：** `mind/integrator.py` 的 `run_integration()`（`:471-641`）实际做的四件事是：处置经验（`_apply_experience_op`，`:684`）、开新 concern、重写叙事（`_gate_and_persist_narrative`，`:643-670` → `mind_store.add_narrative_version`，`:659`）、处理 thought actions。**没有一条路径读 `autonomy_notes`，也没有一条路径写 `insights`。** `integrator.py:59` 的注释「original guard, preserved for integration's insight upserts」是为尚未接线的功能预留的守卫，不是接线本身。

**链路的物理面也缺失：** `core/baseline.py:639-655` 试图统计 `note_insight_links` 表来度量 note→insight 血缘。逐条比对 `memory/store.py` 的建表语句（`:46 history`、`:54 insights`、`:73 autonomy_state`、`:81 autonomy_runs`、`:97 autonomy_notes`、`:121 health_metrics`），**`note_insight_links` 表在 schema 中根本不存在**。因此 `_table_columns` 返回空，`valid_links` 恒为 0。

**这条断链已被基线代码正式编码为一个可复现的诊断信号：**
- `core/baseline.py:700-704`：`if learning["autonomy_notes"] > 0 and learning["valid_note_insight_links"] == 0: reproduced.append("learning_dead_end_signal")`
- `core/baseline.py:746-752`：finding `CV1-LRN-001`，severity `high`，描述 "Autonomy notes have no persisted, referentially valid note-to-insight lineage."

**测试层面也确认这是已知的开口，而非疏忽：** `tests/test_persona.py:105-116` `test_insights_have_no_ungoverned_write_path` 把允许集合硬钉为 `{"memory/seed.py", "memory/store.py"}`，其 docstring（`:106-109`）写：

> "Phase 3 env 04 removed cognition/distill.py; **the integrator can add itself here deliberately if a future cycle wires insight upserts into integration.**"

`tests/test_persona.py:119-130` 补上第二道锁：`insights` 表的裸 SQL 只允许出现在 `memory/store.py`。

### 影响面

- Lykoi 的「习得人格层」在运行期是**只读的**。她通过自主探索产生的 `autonomy_notes` 无论积累多少，都不会进入下一次对话的系统提示词。跨会话的实质学习不成立。
- 当前 `insights` 表的全部内容 = `memory/seed.py:16` 的 1 条种子（`("preference", "Kevin 用中文交流，技术术语用英文")`）+ 历史上由已被移除的 `cognition/distill.py`（Phase 3 env 04 删除）写入的存量行。活体行数**待核实**（`/home/lykoi/state/memory.db` 本会话不可访问，且工单禁止读取其内容行）。
- 这条断链与第 2 条互相加剧：`insights` 的唯一写入模块 `memory/store.py` 恰好也是完整性清单的漏网文件。

---

## 5. Owner Edit 记录结构存在但缺少生产调用者

**结论：证实。**

### 结构定义

| 层 | 位置 |
|---|---|
| 表 DDL | `src/lykoi/mind/migrations.py:103` — `CREATE TABLE IF NOT EXISTS owner_edits (...)` |
| 合法层级枚举 | `src/lykoi/mind/store.py:66` — `_OWNER_EDIT_LAYERS = ("content", "disposition", "commitment")` |
| 写函数 | `src/lykoi/mind/store.py:1335-1362` — `owner_edits_log(...)`，层级校验在 `:1345`，`INSERT` 在 `:1355` |
| 读函数 | `src/lykoi/mind/store.py:1364-1367` — `owner_edits_list(n=20)` |
| 关联枚举 | `migrations.py:60`（`narrative_versions.trigger` 允许 `'owner_edit'`）、`migrations.py:241`（`narrative_class` 允许 `'owner_edit'`）、`migrations.py:249-250`（回填）；`store.py:61 _NARRATIVE_TRIGGERS`、`:65 _NARRATIVE_CLASSES` |

### grep 交叉验证

对 `owner_edits_log` 与 `owner_edits_list` 做全仓检索，排除 `tests/` 后的结果：

```
./src/lykoi/mind/store.py:1335:def owner_edits_log(
./src/lykoi/mind/store.py:1364:def owner_edits_list(n: int = 20) -> list[dict]:
```

**只有定义，没有任何调用。** 具体确认：
- `src/` 内：0 个调用者（`mind/console.py` 也不调用——它在 `:59,83,110` 读的是 `regulation_events` / `narrative_versions` / `experiences`）。
- `scripts/` 内：0 个调用者。
- `guardian/` 内：0 个调用者。
- `surface/app.py`：无对应 HTTP 端点。

**唯一调用者是测试：**
- `tests/test_mind_store.py:176` — `store.owner_edits_log("concerns#3", "vibe", "a", "b", "note")`（在 `pytest.raises` 内，验证非法 layer 被拒）
- `tests/test_mind_store.py:177-179` — 正常写入一行
- `tests/test_mind_store.py:180` — `rows = store.owner_edits_list()`
- 测试名 `test_owner_edits_roundtrip_and_no_event_line`（`:170`）

### 一处重要的语境澄清

该结构**故意**不被 Lykoi 读取，这是一条已钉死的红线，不是缺陷：
- `mind/store.py:1331-1332` 注释：「她永远不读这张表：任何注入 prompt 的代码路径禁止引用 owner_edits（红线 #4）」
- `tests/test_mind_red_lines.py:22` — `OWNER_EDITS_ALLOWED = {"mind/store.py", "mind/migrations.py"}`
- `tests/test_mind_red_lines.py:65-73` — `test_owner_edits_token_only_in_ledger_modules`：全仓扫描，`owner_edits` 字面量出现在这两个模块之外即失败
- `tests/test_mind_red_lines.py:76-84` — `test_prompt_assembly_paths_never_touch_owner_edits`

同时 `mind/store.py:10-11` 说明它是唯一不发 `events.jsonl` 行的状态写入（`:1332` 重申）：「The ledger row itself is Kevin's audit」。

**所以准确的表述是：读侧的缺席是设计；写侧的缺席才是断口。** 该表被定义为「Kevin 手动修改 Lykoi 认知底层时的审计账本」，但**不存在任何让 Kevin 触发这次记账的生产入口**——没有 CLI 子命令、没有 HTTP 端点、没有脚本。

### 影响面

- 所有者若真的手工改了 `narrative_versions` / concerns（`mind/store.py:536` 与 `tests/test_p4r_c2_substrate_write.py:217-221` 都把 `owner_edit` 称为「owner backdoor seam」，即绕过写入门的合法后门），这次改动**不会**留下 `owner_edits` 行——因为记账动作没有任何调用者，只能靠人记得手工调库。
- 后果是「后门存在且被设计允许，但后门的账本必然为空」。`mind/store.py:1332` 说明这里连 `events.jsonl` 都刻意不写，因此 owner 改动在**两条审计线上同时无痕**。
- `migrations.py:246-250` 的回填逻辑（把历史 `trigger='owner_edit'` 的行标 `narrative_class='owner_edit'`）表明历史上确有 owner_edit 类型的叙事版本产生过，佐证这条通路被实际走过、只是没有记账入口。

---

## 6. 滚动摘要未形成完整持久化连续性机制

**结论：证实。摘要在重启与模型切换后均不存活。**

### 实现位置

| 环节 | 位置 |
|---|---|
| 状态字段 | `src/lykoi/cognition/conversation.py:374` — `self._summary: str | None = None` |
| 触发条件 | `conversation.py:612-633` — `_govern_context()`，当 `len(_round_starts()) > CONTEXT_WINDOW_TURNS`（默认 30，`:59`） |
| 生成 | `conversation.py:655-690` — `_summarize(overflow, prior_summary)`，走 MAIN 路由，`SUMMARY_MAX_TOKENS = 1024`（`:62`） |
| 赋值 | `conversation.py:648` — `self._summary = new_summary`（进程内属性赋值） |
| 消费 | `conversation.py:571-572` — `if self._summary: assembled.append({"role": "system", "content": f"[早前对话摘要]\n{self._summary}"})` |
| 并发保护 | `conversation.py:378` `_summary_lock`；`:628-653` 的「锁内捕获 → 解锁调用 LLM → 锁内按 identity 重裁」三段式 |

### 是否在重启后存活：**不存活。**

`self._summary` 的全部出现点（`conversation.py:374, 378, 571, 572, 626, 628, 635, 648`）**没有任何一处涉及文件、数据库或序列化**。它不经过 `shared/jsonio.py`（原子写）、不经过 `memory/store.py`、不经过 `mind/store.py`。

对象生命周期：`surface/app.py:128` `conversation = Conversation()` 是模块级单例，随 uvicorn 进程创建；`lykoi-server.service:20-22` 配置 `--workers 1` + `Restart=always`。因此：

**进程重启 → `Conversation.__init__` 重新执行 → `conversation.py:374` 把 `_summary` 置回 `None` → 之前折叠进摘要的几十轮对话，其压缩表示彻底消失。**

替代机制只有回灌，且是**不同性质**的东西：`conversation.py:373` `self._backfill = self._build_backfill()`，`:393-418` 从 `history(conversation)` 表读**最近 `CONTEXT_BACKFILL_ROWS = 20` 行原始对话**（`:60,397`）。二者不可互相替代：

- 回灌是**最近 20 行原文**，摘要是**已被裁掉的更早期几十轮的压缩语义**。回灌覆盖不到摘要覆盖的时间段。
- 回灌本身还会在预算压力下被整块丢弃（`conversation.py:712-714`，`context_backfill_dropped`）。
- `conversation.py:369-372` 的注释自述这两者是「context-governance state」，「never part of the live window itself」——即两者都是每轮重新拼装的系统补充，而只有回灌一侧有持久化来源。

已发生的持久化对象是「原始对话行」（`history` 表，append-only），**不是摘要**。摘要生成消耗了一次 LLM 调用，其产物只活在内存里，重启后需要重新经历同样的溢出才会重新生成——而重新生成时输入已经不同（`_messages` 已被重置），所以是**不可重建的丢失**，不是可重算的缓存。

### 是否在模型切换后存活：**不存活，且是同一原因。**

模型由 `llm_router.py:67`（`LYKOI_MAIN_MODEL`）/ `:96-99`（`LYKOI_AUTONOMOUS_MODEL`）/ `:82`（`LYKOI_MIMO_MODEL`）从环境读取。这些变量来自 `EnvironmentFile=/home/lykoi/secrets/llm.env`（`lykoi-server.service:13`），systemd 的 `EnvironmentFile` **只在 unit 启动时读取**，因此切换模型必须 `systemctl restart` → 落回上一段的重启丢失。

不存在进程内热切换路径：`_CONFIGS`（`llm_router.py:111`）映射的是**构造函数**而非实例，`get_config()`（`:114-118`）每次调用都重新读 `os.environ`——这意味着如果有人在进程内改 `os.environ` 即可换模型，但**仓内无任何代码这样做**，且 `guardian/startup_verify.py:235-247` 的 env 钉死只覆盖三条治理路径（`LYKOI_APPROVAL_RULES` / `LYKOI_PERSONA_TOML` / `LYKOI_AUDIT_PATH`），不覆盖模型变量。

`cognition/restart.py:133` 会在每次服务入口把 git sha + dirty 标志写进 `events.jsonl`，`:170` 记录 `INVOCATION_ID`，`:182` 甚至会告诉她「期间 Kevin 改了你的代码」——即**重启这件事本身被完整记录**，但重启造成的摘要丢失**没有对应的记录或补偿**。

### 与失败模式的交互

`_govern_context` 的降级路径是安全的：摘要调用失败时 `conversation.py:638-640` 记 `context_summary_failed` 并 `return`，**不丢弃任何消息**（注释 `:623-624`「If the summarizer fails, nothing is dropped」），由硬预算 `_enforce_budget` 兜底。所以风险不在「摘要失败」，而纯粹在「摘要成功后不落盘」。

### 影响面

- 长对话跨重启会出现一段**语义空洞**：最近 20 轮（回灌）有，更早期被摘要吸收的部分完全没有，中间没有过渡。这与 `conversation.py:396` 声称的设计意图（「she wakes from a restart remembering what was just said instead of only that she slept」）只兑现了一半。
- `lykoi-server.service:21-22` 是 `Restart=always` / `RestartSec=2`。任何崩溃、任何部署、任何模型调参都会触发一次摘要清零。摘要的实际留存期 = 服务的平均无重启时长。
- 相关但独立的同类问题：`cognition/followup.py:18` 自述「retry/followup 任务只存内存, 重启即丢(events.jsonl 可追认)」——注意此处**明确标注了可追认路径**，而摘要连这个标注都没有。

---

## 7. 自主进程的工作目录

**结论：证实。自主动作的 CWD 是 `/home/lykoi/projects/lykoi`，即代码仓库根。存在把产物直接写进代码仓库的路径。**

### CWD 的代码证据

**① systemd 设定的进程 CWD —— 三个 unit 全部指向仓库根：**
- `lykoi-autonomy.service:10` — `WorkingDirectory=/home/lykoi/projects/lykoi`
- `lykoi-server.service:10` — `WorkingDirectory=/home/lykoi/projects/lykoi`
- `lykoi-core.service:10` — `WorkingDirectory=/home/lykoi/projects/lykoi`

这同时就是代码树的根（`lykoi-server.service:12` `PYTHONPATH=/home/lykoi/projects/lykoi/src`；`guardian/startup_verify.py:58` `REPO_ROOT = normpath(GUARDIAN_DIR + "/..")` 亦解析到此）。

**② 自主动作在该进程内执行，不 fork 新工作目录：**
```
cognition/autonomous.py:132  AutonomySupervisor.wake()
        ↓
mind/reflow.py:155   dispatch_fn = dispatch_fn or _kernel_dispatch
mind/reflow.py:189/219/235   observation = await dispatch_fn(...)
        ↓
mind/reflow.py:80-87  _kernel_dispatch()
        →  kernel.dispatch.dispatch(Action(...), DispatchContext(origin="autonomous", run_id=...))
```
`mind/reflow.py:16-17` 自述：「External side effects still go ONLY through `kernel.dispatch` under `origin="autonomous"`」。整条链是同进程内的 `await`，没有 `subprocess`、没有 `chdir`。

**③ 执行点不设 `cwd`，因而继承上述 CWD：**
```
kernel/dispatch.py:229   "terminal": terminal          # 前缀路由
kernel/dispatch.py:247   "terminal.exec" ∈ KNOWN_ACTIONS
        ↓
resources/terminal.py:27-31
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
```
**`resources/terminal.py:27-31` 没有 `cwd=` 参数。** `asyncio.create_subprocess_exec` 在 `cwd=None` 时子进程继承父进程 CWD。父进程即 `lykoi-autonomy`（自主路径）或 `lykoi-server`（交互路径），两者 CWD 相同 = `/home/lykoi/projects/lykoi`。

全仓 `cwd=` 的出现点只有 `cognition/restart.py:50` 与 `:119`（`cwd=_REPO_DIR`，用于 `git` 查询，与本条无关），`resources/` 下为 0。

### 是否存在把产物写进代码仓库的路径：**存在，且只有 `terminal.exec` 这一条。**

**有风险的路径：`terminal.exec`**

`resources/terminal.py:16-43` 接受任意 argv（`:18-19` 支持 `shlex.split` 的字符串形式）。任何**由被调用程序自行决定输出位置**的相对路径写入，都会落在仓库根：

- `curl -O <url>` → 文件名取自 URL，落仓库根
- `curl -c cookies.txt` / `-b` → **cookie jar 落仓库根**
- `wget <url>` → 默认存 `index.html` 或页面名，落仓库根
- 任何 `> out.txt`、`-o report.json` 形式的相对路径（注意：`terminal.py:19` 用 `shlex.split` 而非 shell，所以 `>` 重定向**不生效**——但程序自身的 `-o` / `-O` / `-c` 选项照常生效）

工单背景中提到的两个杂散文件——**一个 HTML 存档 + 一个 curl cookie 罐**——与这条路径的特征完全吻合：二者都是 `curl`/`wget` 在**未指定绝对路径**时按 CWD 落盘的典型产物，且都不是任何 Lykoi 代码显式创建的文件（全仓无写 HTML 或 cookie 文件的代码）。

`terminal.py` 无路径参数可供 `guardian/path_guard.py` 检查——守卫看到的只是 argv，`policy_core.is_protected_path` 无从判断 `curl -O` 会写到哪里。`startup_verify.py:252` 还明确要求路径守卫**不得**封锁工作区（`is_protected_path("/home/lykoi/projects/lykoi/src/lykoi")` 必须为假），即仓库树在设计上就是「允许写」的区域。

**已被正确隔离的路径（证伪其余怀疑）：**

| 资源 | 落盘位置 | 证据 |
|---|---|---|
| `browser.screenshot` | `/home/lykoi/state/screenshots`（绝对） | `resources/browser.py:24` `SCREENSHOT_DIR`，可由 `LYKOI_SCREENSHOT_DIR` 覆盖 |
| `research_browser.screenshot` | `/home/lykoi/state/research_screenshots`（绝对） | `resources/research_browser.py:52-53`；`:354` `os.makedirs(SCREENSHOT_DIR, exist_ok=True)`；`:360` `os.path.join(SCREENSHOT_DIR, f"research-{stamp}.png")`。`:357` 注释明确「caller-supplied "path" param is ignored」——模型不能控制路径 |
| research browser 的 Chrome profile | `tempfile.mkdtemp(prefix="lykoi-research-")`，即 `/tmp` | `research_browser.py:286`，且 `:323` `shutil.rmtree(user_data_dir, ignore_errors=True)` 在 `finally` 中清理 |
| `browser.*`（常驻 Chrome） | 不落盘；仅通过 CDP websocket 与 127.0.0.1:9222 上由 systemd 在本仓之外托管的 Chrome 通信 | `resources/browser.py:1-11, 23, 40-54`。该 Chrome 的下载目录由外部 unit 决定，**待核实**（本会话无法访问其 unit 文件） |
| 所有状态文件 | `/home/lykoi/state/*`（绝对） | `shared/log.py:16`、`kernel/notifications.py:27`、`kernel/approval.py:39,227`、`shared/chat_outbox.py:23`、`shared/continuations.py:24`、`shared/proactive_chat.py:19`、`shared/interactive_lock.py:26`、`shared/clock.py:36`、`cognition/restart.py:34`、`cognition/autonomous.py:262`、`memory/store.py:20`、`mind/store.py:33`、`mind/salience_shadow.py:191`、`core/shadow.py:680,685`、`core/permission_evidence.py:25` —— 全部绝对路径，均带 `LYKOI_*` env 覆盖 |
| Core runtime socket/lock | `/home/lykoi/runtime/core-v1/`（绝对） | `core/runtime.py:58-59`，`lykoi-core.service:13-14` |

### 影响面

- **完整性清单被污染的风险**：仓库根落进杂散文件本身不触发 `startup_verify` 失败（`_protected_files()` 只 glob 特定子目录的 `*.py`，仓库根的 `.html` / `cookies.txt` 不在覆盖集内，见第 2 条）。但若杂散文件恰好落进 `src/lykoi/*/` 下任一被 glob 的目录且以 `.py` 结尾，会立刻触发 `startup_verify.py:271` 的「protected but not in manifest (re-sign required)」→ **两个 unit 全部拒绝启动**。这是一条自主行为可自伤的可用性路径。
- **cookie 罐的机密性**：`curl -c` 写出的 cookie 罐落在代码仓库里，而代码仓库是服务账户可写、且**不受 `path_guard` 保护**的区域（`startup_verify.py:252` 明确要求不得封锁）。若该文件随 git 提交进入版本历史，会话凭证即被持久化到代码库。
- **git 噪声**：仓库根是 `.gitignore`（49 字节）与 `git status` 的作用域，杂散文件会污染部署纪律所依赖的 dirty 标志——`cognition/restart.py:133` 正是把「git sha + dirty flag」写进 `events.jsonl` 作为部署审计信号，杂散文件会让该信号常态为 dirty，从而降低其告警价值。
- **修复面很小**：只需在 `resources/terminal.py:27` 的 `create_subprocess_exec` 加一个指向仓库外沙箱目录（如 `/home/lykoi/state/terminal_cwd`）的 `cwd=` 参数即可闭合，无需触碰 dispatch 或审批链。注意该文件在 manifest 内（`guardian/manifest.sha256:72`），改动需 root 重签。
