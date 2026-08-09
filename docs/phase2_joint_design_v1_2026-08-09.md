# 阶段 2 联合设计 v1（冻结） · 数据模型 × Delegation Gateway × S4 Secret

- **日期**: 2026-08-09（v0 草案与 v1 冻结同日；Kevin 口头批复"按你推荐的来"）
- **作者**: 主治理 Agent；**Kevin 已批准，v1 为实施基准**
- **地位**: 兑现白皮书 36 章列出的"数据模型设计 / 权限与信任边界设计 / Delegation Gateway
  设计"三份产物。三者合一的理由：user_id、语境作用域、感知数据类、程序性经验要动同一批表
  （白皮书阶段 2 备忘），而凭证句柄本身是 Gateway 合同的字段——拆开做每一份都会返工。
- **版本约定**: v1 = 冻结版。§6 已由开放问题改为决议记录；后续变更需新版本号+Kevin 批准。

---

## 1. 设计输入（基线事实，全部实测于 2026-08-09，活体 HEAD `94be1f2e`）

| 事实 | 现状 | 出处 |
|---|---|---|
| `user_id` | **全库 0 次出现**；单一共享 Token 表示所有者 | 白皮书 5.6；memory.db 20 表实查 |
| 委托挂载点 | `DispatchContext` 只有 `origin`(4 值枚举) + `run_id`，无委托主体/子代理身份/隔离域 | kernel/dispatch.py:207 |
| 学习链路 | `autonomy_notes`（append-only，触发器强制）→ `insights` 无晋升代码、无血缘表；CV1-LRN-001 (high) | memory.db schema；基线审查 |
| 程序性学习 | 未实现；shadow.py 用 `CHECK(evaluation_kind='unassessed_legacy')` 与 `CHECK(proposal_ref IS NULL)` 显式钉死评估/提案链路 | 白皮书 14.4；core/shadow.py |
| Secret | 明文 env 文件（llm/surface/backup.env），同 uid 读 `/proc/<pid>/environ` 即得 | 白皮书 23.2；S4 审查 |
| 感知 | Mac 端滤网+暂停闸+本地 mock 上行已通；服务器侧接入/保留区/提炼管线未实现 | 白皮书 7.5 |
| Gateway 活原型 | 治理平面工单机制：独立 OS 用户(claude) + 隔离工作副本 + order.md 合同 + 复核 + governance-ops 审计，已运行两周、四单以上 | 协作方案 v1 |
| 隔离技术储备 | LXD 容器在本服务器验证可用（从零重建演练）；独立用户边界经系统强制验证 | WO-DRILL-CLEANVM-01 |

---

## 2. 数据模型设计

### 2.1 身份（白皮书 5.5）

新增两张表，**owner 与主用户是行、不是特例代码路径**：

```sql
CREATE TABLE users (
    id            TEXT PRIMARY KEY,          -- user_xxxx
    display_name  TEXT NOT NULL,
    role          TEXT NOT NULL CHECK(role IN ('owner_primary','group_member','agent')),
    created_at    TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived'))
);
CREATE TABLE identity_bindings (
    id          INTEGER PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id),
    channel     TEXT NOT NULL,               -- mac_app | web | im_platform | cli | api_token
    channel_key TEXT NOT NULL,               -- 渠道内标识（token 指纹/平台账号 id）
    verified_by TEXT NOT NULL,               -- owner_manual | token | platform_oauth
    created_at  TEXT NOT NULL,
    UNIQUE(channel, channel_key)
);
```

防错映射（5.5 的四条）落为硬规则：`role='owner_primary'` 的行**唯一**（部分唯一索引）；
任何绑定变更是硬性策略动作（22.2），只有 owner 通道可写；`agent` 角色供 §3 的子代理
在审计里留身份，**永远不能**绑定到 owner/主用户已用的 channel_key。

现有共享 Token 迁移为 `user_001`(Kevin, owner_primary) 的一条 binding——行为不变，身份有了落点。

### 2.2 语境作用域（白皮书 6.4/6.6）

```sql
CREATE TABLE contexts (
    id        TEXT PRIMARY KEY,              -- ctx_direct_user_001 / ctx_group_xxx
    kind      TEXT NOT NULL CHECK(kind IN ('direct','group','system')),
    title     TEXT,
    created_at TEXT NOT NULL
);
CREATE TABLE context_members (
    context_id TEXT NOT NULL REFERENCES contexts(id),
    user_id    TEXT NOT NULL REFERENCES users(id),
    joined_at  TEXT NOT NULL,
    PRIMARY KEY(context_id, user_id)
);
```

**既有记忆类表不改列、加影子索引表**（迁移原则见 §2.6）：

```sql
CREATE TABLE memory_scopes (
    table_name      TEXT NOT NULL,           -- experiences / insights / thoughts / ...
    row_id          INTEGER NOT NULL,
    subject_user_id TEXT REFERENCES users(id),      -- 记忆"关于谁"
    origin_context  TEXT REFERENCES contexts(id),   -- 在哪个语境产生
    visibility      TEXT NOT NULL DEFAULT 'private'
        CHECK(visibility IN ('private','public','context')),
    sensitivity     TEXT NOT NULL DEFAULT 'content'
        CHECK(sensitivity IN ('content','state','existence')),  -- 三级脱敏的静态标注
    PRIMARY KEY(table_name, row_id)
);
```

存量数据回填：全部 `subject_user_id='user_001'`、`origin_context='ctx_direct_user_001'`、
`visibility='private'`、`sensitivity='content'`（往严校准，符合 6.4"拿不准往严"）。
群聊检索路径按 6.4 规则查此表过滤；**引用 ②③ 级必须写审计**（复用 guardian audit sink，
新事件类型 `memory_cross_context_ref`）。

### 2.3 感知数据类（白皮书 7.2/7.3）

短期保留区独立成库 `percept_buffer.db`（**不进 memory.db**——保留期治理是整库轮转，
和长期记忆的生命周期完全不同）：

```sql
CREATE TABLE percept_events (
    id          INTEGER PRIMARY KEY,
    ts          TEXT NOT NULL,
    device      TEXT NOT NULL,               -- mac_percept_02
    kind        TEXT NOT NULL,               -- app_focus | input_summary | ...
    payload     TEXT NOT NULL,               -- 已过采集端滤网的脱敏事件
    expires_at  TEXT NOT NULL                -- 默认 ts+7d；上调=硬性策略动作
);
```

提炼产物写入长期记忆时：`memory_scopes.sensitivity='content'`（7.4 默认）、
来源标注 `source='perception'` + 时间范围。到期删除由独立小作业执行（机械、不过模型）。
服务器侧 ingest 接口沿用 Mac 端已验证的事件协议，先接本地 mock 同款 schema。

### 2.4 程序性经验（白皮书 14.4/6.7）

```sql
CREATE TABLE procedures (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    body          TEXT NOT NULL,             -- 步骤/方法，自然语言+结构化混合
    domain        TEXT NOT NULL,             -- research / ops / writing / ...
    reliability   REAL NOT NULL DEFAULT 0.0, -- 由执行收据回填，不许自报
    runs_total    INTEGER NOT NULL DEFAULT 0,
    runs_ok       INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL,
    superseded_by TEXT REFERENCES procedures(id)
);
```

`reliability` 只能由 §3 的执行收据验证平面更新（单写者原则，9.4）。
专业 Agent 能力记录（6.7 末项）同表 `domain='agent_capability'` 起步，不另开表。

### 2.5 学习链路修复（P1，CV1-LRN-001）

1. 血缘表：
   ```sql
   CREATE TABLE note_insight_links (
       note_id    INTEGER NOT NULL REFERENCES autonomy_notes(id),
       insight_id INTEGER NOT NULL REFERENCES insights(id),
       linked_at  TEXT NOT NULL,
       PRIMARY KEY(note_id, insight_id)
   );
   ```
2. 晋升作业：integrator 巩固周期内新增 `promote_notes()`——读近期
   `autonomy_notes(kind='observation'|'reflection')`，聚类后 upsert 进 `insights`
   并写血缘。upsert 走 SEC-01 后已入 manifest 的 `upsert_insight` 唯一写入点。
3. 解钉：shadow.py 两处 CHECK 属**表结构约束**，SQLite 需重建表迁移：
   `evaluation_kind` 放开为 `('unassessed_legacy','auto_assessed','verified')`，
   `proposal_ref` 允许非 NULL 并加外键。此库是 shadow（观察侧写），迁移风险低，
   但**必须与 §3 执行收据设计同批**——evaluation 的语义由收据定义。

### 2.6 迁移原则与风险（补 31.3 缺失的"数据迁移风险"产物）

- **一次设计、一次迁移**：上述全部 DDL 做成单个带版本号的 migration（`mind_schema` 表
  已有版本机制可挂）。新表+影子表方案**不改任何现有表、不动 append-only 触发器**，
  迁移可逆（drop 新表即回滚）。
- 风险清单：①回填 memory_scopes 时行数大（experiences/thoughts 全量）——用批量事务，
  迁移窗口停 autonomy（interactive 不受影响）；②shadow.db 重建表是唯一有损风险点——
  先 `.backup` 后迁移，13 项备份体系已覆盖该库；③迁移脚本本身入 manifest 覆盖目录之外
  （scripts/），但**执行必须走工单+Kevin 授权**（动生产数据，非代码）。

---

## 3. Delegation Gateway 设计

### 3.1 原则：从跑通的机制泛化，不从纸上发明

治理平面工单机制与白皮书 17.1 七件套逐项对应，且每一项都已被真实使用过：

| 17.1 要求 | 工单机制的已验证对应物 | Gateway 化后的形态 |
|---|---|---|
| Task Contract | order.md（goal/scope/forbidden/success_criteria/required_evidence） | `delegation_contracts` 表 + 18 章 YAML schema |
| Permission Grant | claude 账户权限位 + 窄口 sudo | 合同的 filesystem/network allow-deny 编译成沙箱 profile |
| Budget | 无（人工把控） | timeout/max_tokens/depth 字段，Runner 强制 |
| Sandbox Profile | 独立 OS 用户 + 隔离工作副本 | 阶梯：OS 用户（已验证）→ LXD 容器（演练已验证），见 3.3 |
| Secret Handles | 无（占位 secrets 演练验证了服务不依赖真值启动） | §4 凭证句柄 |
| Audit Session | governance-ops.jsonl | guardian audit sink 新事件类 `delegation_*`，session id 全程携带 |
| Success Criteria | 复核流程（diff+测试+功能验证+反向核对） | 执行收据（19 章）+ 验证平面自动化其中可自动的部分 |

### 3.2 挂载点：DispatchContext → DelegationContext

`dispatch.py` 不重构，扩展而非替换（32.1 允许重构，但这里加法就够）：

```python
@dataclass
class DispatchContext:
    origin: Literal["interactive", "autonomous", "scheduler", "system", "delegated"]  # +1 值
    run_id: str | None = None
    delegation: DelegationRef | None = None   # origin=="delegated" 时必填

@dataclass(frozen=True)
class DelegationRef:
    contract_id: str          # → delegation_contracts.id
    agent_user_id: str        # → users(role='agent')，审计里的身份
    isolation_domain: str     # os_user:lykoi-agent-N | lxd:agent-N
    depth: int                # ≤ 合同 max_delegation_depth
```

新资源 `delegation.*`（`delegation.dispatch` / `delegation.status` / `delegation.collect`）
走现有 dispatch 管线——**自动继承**审批门（approval）、immutable audit 门（fail closed）、
shadow 侧写。17.2 的禁止清单由 Runner 出生环境保证（见 3.3），不靠子代理自觉。

```sql
CREATE TABLE delegation_contracts (
    id           TEXT PRIMARY KEY,
    requester    TEXT NOT NULL,               -- lykoi | governance
    contract_yaml TEXT NOT NULL,              -- 18 章全字段
    state        TEXT NOT NULL CHECK(state IN
        ('draft','dispatched','running','collected','verified','rejected','expired')),
    agent_user_id TEXT NOT NULL REFERENCES users(id),
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
CREATE TABLE execution_receipts (                -- 19.1
    id           TEXT PRIMARY KEY,
    contract_id  TEXT NOT NULL REFERENCES delegation_contracts(id),
    evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json)),
    verdict      TEXT CHECK(verdict IN ('accepted','rejected',NULL)),  -- 验证平面写
    verified_at  TEXT,
    created_at   TEXT NOT NULL
);
```

收据的 `verdict` 是 §2.4 `procedures.reliability` 与 §2.5 shadow `evaluation_kind`
的唯一合法数据源——三处闭环，这正是三设计必须同批的原因。

### 3.3 隔离域阶梯（17.3：不限定唯一方案，但边界等价）

- **T1 · 独立 OS 用户**（首个 Runner 用这个，机制=今天的 claude 账户复制）：
  `lykoi-agent-1` 用户，无 lykoi 组、家目录工作副本、无 sudo；secrets/state/core.sock
  是系统级拒绝（已实测两周）。网络经代理白名单（合同 network.allow 编译成代理规则）。
- **T2 · LXD 容器**（重活/不可信度高的任务）：从零重建演练验证了容器栈可用；
  非特权容器 + proxy device 白名单出网 + 只读挂载工作副本。
- 首个 Runtime 建议 **Claude Code 无头模式**（17.1 列名单里我们唯一已大量实操的）。

### 3.4 不做的事（防镀金）

不做 Agent Marketplace、动态代码生成 Agent（21.3 本就 [PLANNED] 靠后）、
多级委托深度>2；`max_child_agents` 首版=0（子代理不得再委托），把 20 章可靠性
积累先跑起来再放开。

---

## 4. S4 Secret 联合边界

### 4.1 目标切分（诚实版）

- **S4a（本设计范围，Gateway 出生即达成）**：任何子代理**从第一天起**拿不到明文密钥——
  Runner 环境不继承 env、不挂 secrets 目录，合同里只有 handle 名。
- **S4b（后续，工程量大）**：Lykoi 核心进程自身的密钥从 env 文件收进 broker。
  不阻塞阶段 2：核心进程是可信边界内的单体，风险等级低于"子代理泄露"。

### 4.2 凭证句柄与 broker（23.1）

```yaml
# /home/lykoi/secrets/handles.yaml（root:lykoi 0640，broker 读）
handles:
  llm.deepseek.chat:            # 句柄名=作用域
    kind: http_proxy            # broker 反代 api.deepseek.com，注入真实 key
    allowed_paths: ["/chat/completions"]
  github.lykoi_web.read:
    kind: scoped_token          # broker 用主 token 换短期细粒度 token 发放
```

**broker = 独立 systemd 服务、独立用户 `lykoi-broker`**（root:lykoi 之外的第三方，
secrets 只对它可读）。两种出借方式：
- `http_proxy` 型：子代理拿到的是 `http://127.0.0.1:<port>` 反代地址+一次性会话票据，
  真 key 永不出 broker 进程；票据与 contract_id 绑定、合同过期即失效；
- `scoped_token` 型：发放短期最小权限凭证（如 GitHub fine-grained token），出借记审计。

每次出借写 guardian audit sink（`secret_handle_grant`：handle、contract_id、有效期）。
23.1 的"使用审计/作用域/临时凭证"三项由此覆盖；"自动轮换"列 S4b。

### 4.3 验证方式（沿用演练纪律）

上线门：以子代理身份实测 ①`/proc` 读不到任何 key；②直连 api.deepseek.com 被网络
白名单拒绝；③经 handle 反代调用成功且审计有记录；④合同过期后票据失效。四条全过才算 S4a 达成。

---

## 5. 实施顺序（阶段 2 内，每步一道验收门）

| # | 步骤 | 验收门 | 依赖 |
|---|---|---|---|
| 1 | 数据模型 migration（§2.1–2.4 新表 + 回填；§2.5 血缘表） | 迁移可逆演练 + 回填抽查 + P0 全绿 | 本设计 v1 冻结 |
| 2 | 学习链路：integrator 晋升作业 | autonomy_notes→insights 有血缘的晋升在活体发生≥1 次 | 1 |
| 3 | Gateway 最小闭环：contracts/receipts 表 + delegation.* 资源 + T1 Runner + broker(http_proxy 型 LLM handle) | 一单真实委托全程走通 + §4.3 四条 + 审计链完整 | 1 |
| 4 | shadow.db 解钉迁移 + 收据回填 reliability | evaluation_kind 出现非 legacy 值且来源=收据 | 3 |
| 5 | 感知服务器侧：percept_buffer + ingest + 保留期作业 | Mac 真实事件入库、7 天轮转实测（可加速时钟） | 1（可与 3 并行） |
| 6 | 群聊语境读路径 + 三级脱敏过滤 + 引用审计 | 脱敏规则单测 + ②③级引用审计抽查 | 1 |

每步照旧：工单（含 manifest 纪律条款）→ 实现 → 我复核（含功能性验证）→ Kevin 授权合并。
触及 `cognition/mind/memory/shared/surface/resources` 或 guardian 的步骤（2/3/4/6 必然触及）
**必须**同步 manifest 重签 + `pytest tests/test_p0_integrity.py`。

## 6. 决议记录（Kevin 2026-08-09 批复"按你推荐的来"）

1. **memory_scopes 用影子表**起步（零风险可逆），阶段 3 大重构时再考虑合并进主表。
2. **percept 保留区放服务器**（核心边界内，备份体系已覆盖 state 目录模式）。
3. **broker 第一个 handle = `llm.deepseek.chat`**（http_proxy 型反代）。
4. **首个真实委托任务 = lykoi-ui 低风险小修**（不碰核心仓库）。
5. **迁移窗口批准**：停 autonomy 约 10–30 分钟，interactive 不停；具体时刻执行前再约。

同批决议（承接阶段 1 尾项）：**从零重建演练以容器结果认定过门**（真 VM 复跑保留为
可选加固项，材料常备）；`rehearsal` 容器暂保留（静默无害，供 Gateway T2 隔离域参照），
去留随时可改。
