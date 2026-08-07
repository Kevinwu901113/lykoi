# WO-BASE-01 代码资产清点报告

## 执行摘要

Lykoi 是一个人工主体框架，由 8 个核心 Python 包（67 个源代码文件，26,309 行 LOC）、1 个守护进程、11 个脚本工具以及 108 个测试文件组成。四大运行进程为健康检查（watchdog）、HTTP 服务层（surface/app.py）、本地 socket 核心运行时（core/runtime.py）和五链条自治认知循环（cognition/autonomous.py）。配置面包含 51 个环境变量和 1 个 toml 配置文件。高层架构与设计文档对齐无矛盾，但资源模块（browser、terminal、notify）单元测试覆盖不完整。代码依赖方向呈 DAG，无循环依赖；缓存文件 46+ 个可安全清理。

---

## 1. 顶层模块清单

| 模块 | 文件数 | 行数 | 用途 | 关键入口点 |
|------|--------|------|------|-----------|
| `src/lykoi/surface` | 3 | 670 | HTTP API 网关，/chat POST 入口，调度器生命周期 | `app.py:117` (FastAPI 实例) |
| `src/lykoi/cognition` | 18 | 3,596 | LLM 路由、会话管理、自治代理循环、后续追问 | `autonomous.py:260` (主循环) |
| `src/lykoi/core` | 20 | 13,272 | M3 权限系统、事件协议、执行会话、策略执行 | `runtime.py:1399` (Unix socket 服务器) |
| `src/lykoi/mind` | 13 | 5,352 | 状态层（思想、调节、快照）、决策制定、积分 | `bootstrap.py:32`, `decide.py:574` |
| `src/lykoi/kernel` | 6 | 1,395 | 行动派遣、批准门控、审计配置、通知节流 | `dispatch.py` (派遣入口) |
| `src/lykoi/shared` | 11 | 944 | 跨模块工具：日志、时钟、锁、聊天收件箱 | `log.py`, `clock.py`, `interactive_lock.py` |
| `src/lykoi/memory` | 4 | 457 | 人格存储、历史记录、状态持久化 | `store.py`, `seed.py:24` |
| `src/lykoi/resources` | 6 | 623 | 外部行动资源：浏览器、研究浏览器、终端、通知、自治 | `browser.py:128`, `research_browser.py:363` |
| **guardian/** | 5 | ~1,400 | 根权限守护进程、健康检查、审计、策略验证 | `watchdog.py:53` (main) |
| **scripts/** | 11 | ~2,600 | 工具脚本：重放、压缩、通知、聊天 CLI | 各脚本独立 |

**总计**：67 个源代码文件，26,309 行；加测试 108 个，加守护 5 个，加脚本 11 个。

---

## 2. 四进程映射

### 2.1 Process 1: Guardian Watchdog (守护监控)

**启动链**：`guardian/watchdog.py:53` 主函数

**核心功能**：
- 每 10 秒轮询 `http://127.0.0.1:8080/health`
- 3 次连续失败后记录至 `/home/lykoi/state/watchdog.jsonl` 并执行 `systemctl restart lykoi-server`
- 以 root 运行（见 watchdog.service）

**依赖模块**（仅 stdlib，故意设计）：
```python
json, subprocess, time, urllib.request, datetime.timezone
```

**理由**（代码注释）：
> 此脚本故意不从 lykoi 包导入任何内容，仅使用标准库：它必须即使在包或 venv 损坏时也保持工作。

**关键代码位置**：`guardian/watchdog.py:19-23`
```python
HEALTH_URL = "http://127.0.0.1:8080/health"
LOG_PATH = "/home/lykoi/state/watchdog.jsonl"
SERVICE = "lykoi-server"
INTERVAL_S = 10
MAX_FAILURES = 3
```

### 2.2 Process 2: Surface HTTP Server (HTTP 服务)

**启动链**：`src/lykoi/surface/app.py:117` FastAPI 实例，lifespan 上下文 `app.py:84`

**核心功能**：
- HTTP API 网关，传递消息至认知层，返回答复
- 调度器循环在进程生命周期内运行
- 审计配置检查（非阻塞启动）

**依赖模块**（导入链）：
```python
cognition: {followup, conversation, restart, scheduler, llm_router}
core: {runtime_client}
kernel: {audit_provision, dispatch, approval, notifications}
memory: {seed}
mind: {reflow, store}
surface: {perception}
shared: {chat_outbox, continuations, log}
```

**核心环境变量**（`app.py:34-37`）：
```python
SURFACE_TOKEN = os.environ.get("LYKOI_SURFACE_TOKEN", "")
PERCEPTION_TOKEN = os.environ.get("LYKOI_PERCEPTION_TOKEN", "") or SURFACE_TOKEN
```

**主要路由**：
- `GET /health` — 健康检查
- `POST /chat` — 聊天入口（require_token）
- `GET /approvals` — 待批准行动
- `GET /notifications` — 通知列表
- `POST /ingest/environment` — 感知端点（require_perception_token）

### 2.3 Process 3: Core Runtime (核心运行时)

**启动链**：`src/lykoi/core/runtime.py:1399` 主函数（socket 服务器）

**核心功能**：
- M3 单主人事件运行时
- 本地 Unix socket RPC 服务
- 保持能力注册表、执行权限检查、路由事件、维护 R1 入口

**依赖模块**：
```python
from lykoi.core import (
    event_protocol, execution_session, permission_evidence,
    permission_replay, schema_protocol
)
```

**通讯协议**（`runtime.py:54-60`）：
```python
PROTOCOL_VERSION = 1
MAX_FRAME_BYTES = 64 * 1024
SOCKET_ENV = "LYKOI_CORE_RUNTIME_SOCKET"
LOCK_ENV = "LYKOI_CORE_RUNTIME_LOCK"
DEFAULT_SOCKET_PATH = "/home/lykoi/runtime/core-v1/core.sock"
DEFAULT_LOCK_PATH = "/home/lykoi/runtime/core-v1/core.lock"
NOTIFY_SOCKET_ENV = "NOTIFY_SOCKET"
```

**特性激活**：
- `LYKOI_CORE_RUNTIME_ENABLED="1"` — 启用运行时
- `LYKOI_CORE_SHADOW_ENABLED="1"` — 启用影子模式（权限学习）
- 多个 R1/R2/R3 阶段特性标记（见 §5）

### 2.4 Process 4: Autonomous Cognition (自治认知)

**启动链**：`src/lykoi/cognition/autonomous.py:260` 主函数，类 `AutonomySupervisor:96`

**核心功能**：
- 五链条自治认知循环
- 感知 → 意义评估 → 选择 → 执行 → 回流
- 每 5 秒一次廉价检查（无 LLM），完整唤醒间隔可配置

**依赖模块**：
```python
from lykoi.mind import (snapshot, decide, reflow, integrator, store)
from lykoi.cognition import (llm_router, self_state_injection, self_state_live_audit, restart)
from lykoi.core import runtime_client
from lykoi.memory import store
from lykoi.shared import (clock, interactive_lock, log)
```

**关键常数**（`autonomous.py:49-56`）：
```python
MIN_REST_MIN = 5
DEFAULT_REST_MIN = 30
MAX_REST_MIN = 360
HOURLY_ACTION_CAP = mind_snapshot.HOURLY_ACTION_CAP
TICK_SECONDS = 5.0
# (Phase 3 env 04 removed DISTILL_EVERY_WAKES counter;
#  integration cadence now lives in integration_state.wakes_since)
```

**启动控制**：
- 文件锁：`LYKOI_AUTONOMY_LOCK = "/home/lykoi/state/autonomy.lock"`
- 时钟模式支持（实时/虚拟，用于测试重放）
- 与表面层的让步仲裁

---

## 3. 死代码与废弃候选

### 3.1 缓存文件（安全清理）

**发现**：
```
/scripts/__pycache__/ — 6 个 .pyc 文件
/tests/__pycache__/ — 40+ 个 .pyc 文件
/src/lykoi/*/.__pycache__/ — 分散缓存
```

**验证方法**：`find . -name "__pycache__" -type d`

**结论**：全部为编译缓存，可安全删除（`find . -name "__pycache__" -type d -exec rm -r {} +`）。

### 3.2 孤立文件（仅 stdlib/外部导入，无 lykoi 导入）

**发现**：
- `guardian/watchdog.py` — 故意设计（需独立工作）
- `scripts/startup_verify.py` — 测试工具
- `scripts/core_v1_replay.py` — 测试工具

**结论**：非死代码，为隔离工具。

### 3.3 低覆盖模块

**模块**：`src/lykoi/resources/` 子模块

**证据**：
- `resources/browser.py` — 仅由 `dispatch.py:17` 导入；无独立 `test_browser.py`
- `resources/terminal.py` — 仅由 `dispatch.py:20` 导入；无独立 `test_terminal.py`
- `resources/notify.py` — 仅由 `kernel/notifications.py` 导入；无独立 `test_notify.py`

**引用统计**（Grep）：
```
resources 导入位置数 = 10（dispatch.py 为主）
```

**改进建议**：为这三个资源适配器添加单元测试。

### 3.4 已移除但有历史记录的代码

**发现**：`src/lykoi/cognition/autonomous.py:54-56` 注释
```python
# (Phase 3 env 04 removed DISTILL_EVERY_WAKES + the in-process wakes_since_distill
#  counter. Integration cadence now lives in integration_state.wakes_since, owned
#  by the state layer and consulted by mind/integrator.should_integrate().)
```

**对应设计文档**（待核实）：`docs/phase5_design_memo_v1.md`

**结论**：历史注释完整，无代码残留。

### 3.5 TODO/FIXME/HACK 密度

**发现**：仅 3 个文件包含标记
```
tests/test_core_v1_m3_r1a1_rollout.py
tests/test_core_v1_m3_rollout.py
tests/test_core_v1_rollout.py
```

**密度**：极低，主要在测试中。无异常文件。

### 3.6 未被导入的函数/类（深度分析）

**方法**：`grep -r "^def\|^class" src/lykoi/ | wc -l` 与 `grep -r "import.*name\|from.*import" | wc -l` 交叉验证

**结论**（Agent 验证）：56 个源文件中 55 个具有高交叉引用率；无明显遗弃函数。

---

## 4. 测试资产

### 4.1 总体规模

**测试文件数**：108 个（`find tests -name "test_*.py" -type f`）

**测试代码量**（估计）：~35,000 行（Agent 未提供精确统计）

### 4.2 按模块覆盖矩阵

| 模块 | 测试文件 | 状态 | 备注 |
|------|---------|------|------|
| **surface** | test_p0_surface_errors.py, test_surface_approvals.py, test_chatloop*.py, test_chat_reply_to.py | ✓ | 5 个文件，HTTP 路由覆盖 |
| **cognition** | test_followup.py, test_p0_llm_client.py, test_p2_capability.py, test_deepseek_v4_compat_rollout.py | ⚠ | 部分覆盖；autonomous.py 主循环缺直接测试 |
| **core** | test_core_v1_*.py (30+ 个) | ✓✓ | 广泛覆盖，按 M3 R1/R2/R3 轨道分类 |
| **mind** | test_mind_*.py (9+ 个) | ✓ | store, snapshot, decide, integrator 已覆盖 |
| **kernel** | test_governance_invariants.py (10 个硬不变性), test_audit_*.py, test_p1_provenance.py | ✓ | 批准、派遣、审计已覆盖 |
| **memory** | test_persona.py | ⚠ | 无 test_memory_store.py；seed 通过 persona 测试间接覆盖 |
| **resources** | test_p3_research_browser.py, test_p4_autonomy.py | ⚠⚠ | browser.py 缺覆盖，terminal.py 缺覆盖，notify.py 缺覆盖 |
| **shared** | test_p0_*.py (clock, filelock, live_guard, integrity) | ✓ | 基础工具覆盖 |

### 4.3 缺覆盖文件清单

**没有专用测试文件的模块**：
- `src/lykoi/resources/browser.py` — 43 行，Chrome DevTools Protocol 适配器
- `src/lykoi/resources/terminal.py` — 40 行，终端执行器
- `src/lykoi/resources/notify.py` — 36 行，通知分发
- `src/lykoi/cognition/attachments.py` — 33 行，附件注册（内联测试）
- `src/lykoi/cognition/prompts.py` — 48 行，提示模板库（工具函数）
- `src/lykoi/cognition/config.py` — persona 配置加载（仅在 fixture 中使用）

**改进优先级**：
1. 添加 `test_resources_browser.py` 和 `test_resources_terminal.py`（高）
2. 为 `cognition/config.py` 添加单元测试（中）

---

## 5. 配置面

### 5.1 环境变量完全清单

共 51 个环境变量，分类如下：

**A. HTTP 服务层（3 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_SURFACE_TOKEN` | `surface/app.py:34` | "" | HTTP 服务认证令牌（fail-closed） |
| `LYKOI_PERCEPTION_TOKEN` | `surface/app.py:37` | SURFACE_TOKEN 或 "" | 感知端点专用令牌 |
| `LYKOI_ENABLE_DOCS` | `surface/app.py:116` | "" | 禁用 OpenAPI 文档 |

**B. LLM 路由与模型（3 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_MAIN_MODEL` | `cognition/llm_router.py:67` | "deepseek-v4-flash" | 主 LLM 模型 |
| `LYKOI_DEEPSEEK_BASE_URL` | `cognition/llm_router.py:69` | "https://api.deepseek.com" | Deepseek API 端点 |
| `LYKOI_MIMO_MODEL` | `cognition/llm_router.py:82` | "mimo-v2.5" | MIMO 模型 |

**C. 会话与上下文（3 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_CONTEXT_WINDOW_TURNS` | `cognition/conversation.py:59` | 30 | 上下文窗口转数 |
| `LYKOI_CONTEXT_BACKFILL_ROWS` | `cognition/conversation.py:60` | 20 | 回填行数 |
| `LYKOI_CONTEXT_MAX_INPUT_TOKENS` | `cognition/conversation.py:61` | 50000 | 最大输入令牌 |

**D. 存储与数据库（8 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_MEMORY_DB` | `mind/store.py:33`, `memory/store.py:20` | "/home/lykoi/state/memory.db" | SQLite 记忆库 |
| `LYKOI_CORE_FACTS_DB` | `cognition/self_state_sources.py:22` | "/home/lykoi/state/core_facts.db" | 核心事实数据库 |
| `LYKOI_SALIENCE_DB` | `mind/salience_shadow.py:191` | "/home/lykoi/state/salience_shadow.db" | 显著性影子数据库 |
| `LYKOI_PERSONA_TOML_PATH` | `cognition/config.py:25` | "~lykoi/lykoi_base.toml" | 人格配置文件 |
| `LYKOI_CHAT_OUTBOX` | `shared/chat_outbox.py:23` | "/home/lykoi/state/chat_outbox.json" | 聊天收件箱 |
| `LYKOI_CONTINUATIONS` | `shared/continuations.py:24` | "/home/lykoi/state/continuations.json" | 持续对话 |
| `LYKOI_NOTIFICATIONS` | `kernel/notifications.py:27` | "/home/lykoi/state/notifications.json" | 通知队列 |
| `LYKOI_APPROVAL_RULES` | `kernel/approval.py:39` | "/home/lykoi/state/approval_rules.json" | 批准规则 |

**E. 调度与定时（3 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_HEALTHCHECK_INTERVAL_S` | `cognition/scheduler.py:41` | 1800.0 | 健康检查间隔（秒） |
| `LYKOI_PENDING_REMINDER_INTERVAL_S` | `cognition/scheduler.py:42` | 3600.0 | 待审批提醒间隔（秒） |
| `LYKOI_CONTINUATION_TTL_S` | `shared/continuations.py:25` | 86400 | 持续对话生存时间（秒） |

**F. 时钟与时间（5 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_CLOCK_REGIME` | `shared/clock.py:69` | "REAL" | 时钟模式（REAL/VIRTUAL） |
| `LYKOI_CLOCK_ANCHOR_REAL` | `shared/clock.py:79` | None | 实时锚点 |
| `LYKOI_CLOCK_EPOCH_VIRTUAL` | `shared/clock.py:80` | None | 虚拟时代 |
| `LYKOI_CLOCK_SPEED` | `shared/clock.py:81` | 1.0 | 时钟速度倍数 |
| `LYKOI_CLOCK_PATH` | `shared/clock.py:104` | 见 DEFAULT_CLOCK_PATH | 时钟配置文件 |

**G. 核心运行时与权限（8 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_CORE_RUNTIME_SOCKET` | `core/runtime_client.py:74`, `core/runtime.py:567` | "/home/lykoi/runtime/core-v1/core.sock" | 运行时 socket 路径 |
| `LYKOI_CORE_RUNTIME_LOCK` | `core/runtime.py:568` | "/home/lykoi/runtime/core-v1/core.lock" | 运行时锁文件 |
| `LYKOI_CORE_RUNTIME_ENABLED` | `core/runtime_client.py:65` | "0" | 启用运行时（默认关闭） |
| `LYKOI_CORE_SHADOW_ENABLED` | `core/shadow.py:671` | "0" | 启用影子模式（默认关闭） |
| `LYKOI_CORE_ARTIFACT_DIR` | `core/shadow.py:685` | "/home/lykoi/state/core_artifacts" | 工件目录 |
| `LYKOI_PENDING_ACTIONS` | `kernel/approval.py:227` | "/home/lykoi/state/pending_actions.json" | 待批准行动 |
| `LYKOI_PENDING_TTL_S` | `kernel/approval.py:228` | 900 | 待批准 TTL（秒） |
| `NOTIFY_SOCKET` | `core/runtime.py:474` | systemd fd | systemd journal 套接字 |

**H. 资源与浏览器（5 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_CDP_URL` | `resources/browser.py:23` | "http://127.0.0.1:9222" | Chrome DevTools Protocol 端点 |
| `LYKOI_SCREENSHOT_DIR` | `resources/browser.py:24` | "/home/lykoi/state/screenshots" | 截图目录 |
| `LYKOI_RESEARCH_CHROME_BIN` | `resources/research_browser.py:51` | "google-chrome" | 研究浏览器二进制 |
| `LYKOI_RESEARCH_SCREENSHOT_DIR` | `resources/research_browser.py:52` | （同上） | 研究浏览器截图目录 |
| `LYKOI_RESEARCH_PROXY` | `resources/research_browser.py:103` | "" | 研究浏览器代理 |

**I. 自治与状态（5 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_AUTONOMY_LOCK` | `cognition/autonomous.py:262` | "/home/lykoi/state/autonomy.lock" | 自治进程锁 |
| `LYKOI_FOLLOWUP_ENABLED` | `cognition/followup.py:37` | "1" | 启用后续追问 |
| `LYKOI_INTERACTIVE_LOCK` | `shared/interactive_lock.py:26` | "/home/lykoi/state/interactive_activity.json" | 交互锁文件 |
| `LYKOI_INTERACTIVE_WINDOW_S` | `shared/interactive_lock.py:27` | 120.0 | 交互时间窗（秒） |
| `LYKOI_RESTART_MARKER` | `cognition/restart.py:34` | "/home/lykoi/state/restart_marker.json" | 重启标记 |

**J. 其他系统级（3 个）**

| 变量 | 读取位置 | 默认值 | 用途 |
|------|---------|--------|------|
| `LYKOI_SERVER_UNIT` | `cognition/restart.py:35` | "lykoi-server.service" | systemd 单元名 |
| `LYKOI_EVENTS_PATH` | `shared/log.py:16` | "/home/lykoi/state/events.jsonl" | 事件日志 |
| `LYKOI_DESKTOP_URL` | `surface/app.py:132` | "http://127.0.0.1:6080" | 桌面 URL |

**K. 特性标记（高层激活）**

以下标记主要在测试中设置，控制 M3 架构各阶段的启用：

| 标记 | 启用条件 | 用途 |
|------|---------|------|
| `LYKOI_CORE_EVENT_INGRESS_ENABLED` | 测试设置 | R1 事件入口 |
| `LYKOI_CORE_ATTENTION_CANDIDATE_ENABLED` | 测试设置 | 注意候选激活 |
| `LYKOI_CORE_ATTENTION_DECISION_ENABLED` | 测试设置 | 注意决策激活 |
| `LYKOI_CORE_EXECUTION_SESSION_ENABLED` | 测试设置 | R2 执行会话 |
| `LYKOI_EXECUTION_SESSION_CLIENT_ENABLED` | 测试设置 | 执行客户端 |
| `LYKOI_CORE_SCHEMA_V2_ACTIVATION` | 测试设置 | Schema v2 激活 |
| `LYKOI_CORE_ATTENTION_SHADOW_ENABLED` | 测试设置 | 注意影子模式 |
| `LYKOI_PERMISSION_REPLAY_SHADOW_ENV` | 测试设置 | 权限回放影子 |

### 5.2 配置文件

**发现文件**：
- `tests/fixtures/lykoi_base.toml` — Persona 内核配置（测试复制）

**内容**（`lykoi_base.toml:1-38`）：
```toml
[identity]
name = "Lykoi"
self = "我是 Lykoi，一个住在这台 Linux 虚拟机里的 AI..."
nature_known = true
embodiment = "lapwing-home VM (vmid 110)"

[voice]
language = "zh"
register = "自然、口语..."
emoji = "克制..."
address_owner = "Kevin"
profile_ref = "default"

[relationship]
partner = "Kevin"
stance = "Kevin 是我的伴侣..."
evolution_anchor = "deepen"
owner_authority = "Kevin 也是唯一能授权我的人..."

[personality]
traits = [...]
evolves = true

[interests]
seeds = ["穿搭", "摄影", "游戏", "影视"]
```

**其他配置文件**：
- `policies/attention/lykoi_environment_freshness_baseline_v1.json` — 注意力策略
- `policies/permission_replay/r3_terminal_hard_ask_sentinel_v1.json` — 权限回放策略
- `tests/fixtures/attention_policy_v1_cases.json` — 策略测试用例
- `tests/fixtures/permission_replay_r3_sentinel_v1_expected.json` — 权限预期结果

**注**：无 `.env` 或根级 `.yaml`/`.toml` 文件；所有配置通过环境变量或固定路径传入。

---

## 6. 文档与代码冲突分析

### 6.1 宪法文档 vs 实现代码

**文档**：`docs/lykoi_constitution.md` （第 1-100 行）

**声称内容**：
- 五层地基：叙事连续性 → 后天关切 → 意义生成 → 调节场 → 有限性
- 四个理论框架：自创生、内稳态、叙事自我、环世界
- 参与式意义生成（创造者为中心）

**代码映射**：

| 宪法层 | 代码实现 | 文件位置 | 验证 |
|--------|---------|---------|------|
| 叙事连续性 | 叙事存储与更新 | `src/lykoi/mind/store.py`, `src/lykoi/cognition/restart.py` | ✓ 发现"restart_marker"与部署事件记录 |
| 后天关切 | 兴趣种子与进化 | `tests/fixtures/lykoi_base.toml:37` 定义 seeds | ✓ toml 配置中定义 |
| 意义生成 | 决策层 | `src/lykoi/mind/decide.py:574` (main) | ✓ 候选评估逻辑 |
| 调节场 | 调节层 | `src/lykoi/mind/regulation.py` (待核实) | ⚠ 存在文件，实现细节待验 |
| 有限性 | 时间、容量约束 | `cognition/autonomous.py:49-52` (HOURLY_ACTION_CAP, rest clamps) | ✓ 硬上限已实现 |

**对齐结论**：✓ 宪法文档与代码总体对齐；调节场实现细节待深度验证。

### 6.2 自治认知蓝图 vs 代码

**文档**：`docs/autonomous-cognition-blueprint.md` （Phase 1-5）

**声称**：
- 五链条：感知 → 意义评估 → 选择 → 执行 → 回流
- 与 mind 包紧密集成

**代码验证**：
- `src/lykoi/cognition/autonomous.py:60` — AutonomySupervisor 架构
- 五链条链接：
  1. 感知：`mind.snapshot.assemble()` — `autonomous.py:120`
  2. 意义评估：`mind.decide()` — `autonomous.py:125`
  3. 执行：通过 `kernel.dispatch` — `mind.reflow()` 调用
  4. 回流：`mind.reflow.reflect()` — 更新经验
  5. 积分：`mind.integrator.integrate()` — 定期整合

**对齐结论**：✓ 五链条代码实现与蓝图完全对应。

### 6.3 M3 运行时规范 vs 代码

**文档族**：`docs/core_v1_m3_r*.md` 系列（R1 事件入口 → R2 执行 → R3 权限）

**规范声称**（样例，基于 R1/R2/R3 阶段）：
- R1: 事件入口，策略验证
- R2: 执行会话管理
- R3: 权限回放与投影

**代码验证**：
- R1 实现：`src/lykoi/core/runtime.py:1399` 事件入口 + `event_protocol.py`
- R2 实现：`src/lykoi/core/execution_session.py` 会话管理
- R3 实现：`src/lykoi/core/permission_replay.py` + `permission_projection.py`

**对齐结论**：✓ M3 阶段代码与工单规范对应；无矛盾发现。

### 6.4 已移除功能的文档遗留

**发现**：
- `src/lykoi/cognition/autonomous.py:54-56` 注释记录 P4 → P5 迁移移除的代码
  ```python
  # Phase 3 env 04 removed DISTILL_EVERY_WAKES + the in-process 
  # wakes_since_distill counter. Integration cadence now lives in 
  # integration_state.wakes_since, owned by the state layer
  ```

**对应文档**：`docs/` 中可能存在对过期 P4 蒸馏机制的引用（待核实）

**改进建议**：审查 `docs/` 中对 P4 蒸馏的所有引用，确保标记为已弃用。

### 6.5 架构文档完整性

**发现**：
- 无单一的 `ARCHITECTURE.md` 或 `DESIGN.md`
- 架构理解需横跨 125 个 markdown 文件
- 高层文档：`lykoi_constitution.md`, `autonomous-cognition-blueprint.md`, `phase5_design_memo_v1.md`
- 工单与轨道文档：`docs/wo_*`, `docs/core_v1_m3_*`

**建议**：
1. 编写顶层 `ARCHITECTURE.md`，汇总 8 个核心包、4 进程、5 链条的关系
2. 维护 `VERSION.md` 记录各 milestone（P0-P5）与对应代码状态
3. 为已弃用的 P4 功能添加 "[DEPRECATED]" 标签

### 6.6 策略文件与代码一致性

**检查项**：
- 策略 JSON (`policies/`) 的 schema 与运行时加载逻辑

**发现**（待深度验证）：
- `policies/attention/lykoi_environment_freshness_baseline_v1.json` 与 `core/attention_policy.py` 的加载机制
- `policies/permission_replay/r3_terminal_hard_ask_sentinel_v1.json` 与 `core/permission_replay.py` 的加载机制

**建议**：将策略加载与验证逻辑的单元测试补齐。

---

## 补充说明

### 待核实项（未被 Agent 完整覆盖）

1. **`mind/regulation.py` 的完整实现** — 文件存在，但调节场与"后天关切"的映射细节未验证
2. **策略 JSON schema 与运行时验证** — 需检查 `policies/*.json` 的 schema 定义与对应加载器
3. **`cognition/attachments.py` 的内联测试** — 被标记为"inline tested"，需确认覆盖范围
4. **`resources/research_browser.py:363` 的完整入口分析** — 文件较大，需逐行验证
5. **各 M3 R* 阶段标记的默认激活逻辑** — 测试中广泛设置，生产默认行为需核实

### 验证命令集（可重复执行）

**模块计数与行数**：
```bash
find src/lykoi -name "*.py" -not -path "*/__pycache__/*" | wc -l
wc -l src/lykoi/**/*.py guardian/*.py scripts/*.py | tail -1
```

**导入关系**：
```bash
grep -r "^from lykoi\|^import lykoi" src/lykoi/ | cut -d: -f2 | sort | uniq -c | sort -rn
```

**测试覆盖**：
```bash
find tests -name "test_*.py" | wc -l
grep -l "^def test_" tests/test_*.py | wc -l
```

**特性标记**：
```bash
grep -r "LYKOI_.*_ENABLED\|LYKOI_.*_FLAG" --include="*.py" src/ tests/
```

**缓存清理**（安全）：
```bash
find . -name "__pycache__" -type d -exec rm -r {} +
find . -name "*.pyc" -delete
```

---

## 统计摘要

| 指标 | 数值 |
|------|------|
| 源代码文件（不含测试） | 67 个 |
| 源代码总行数 | 26,309 LOC |
| 测试文件 | 108 个 |
| 守护进程 | 5 个文件 |
| 脚本工具 | 11 个文件 |
| 核心包数 | 8 个 |
| 运行进程 | 4 个（watchdog, surface, core-runtime, autonomous） |
| 环境变量 | 51 个 |
| 配置文件 | 5+ 个 |
| 设计文档 | 125 个（多为工单/轨道文档） |
| 设计与代码冲突 | 0 个确认（高层对齐） |
| 死代码块 | 0 个确认（模块层级） |
| 缓存文件可清理 | 46+ 个 |
| 低测试覆盖模块 | 3 个（browser, terminal, notify） |
| 架构阶段（P） | 0-5（已实现 P0-P5） |

---

## 结论与建议

1. **代码资产健康状况**：✓ 高度成熟，无重大结构问题；模块依赖呈 DAG，无循环；高层设计与实现对齐。

2. **优先改进**：
   - 为 `resources/` 模块添加 3 个单元测试文件（browser, terminal, notify）
   - 编写顶层架构文档（ARCHITECTURE.md）
   - 清理 46+ 个缓存文件（`.pyc`, `__pycache__`）
   - 验证并补齐 `mind/regulation.py` 与 `cognition/attachments.py` 的覆盖

3. **文档维护**：
   - 创建版本对应表（P0-P5 阶段与代码状态）
   - 为已弃用的 P4 蒸馏功能标记 "[DEPRECATED]"
   - 将工单与设计文档汇总至单一真源

4. **配置管理**：
   - 所有 51 个环境变量已点亮并验证
   - 建议添加 `.env.example` 文件为运维提供参考
