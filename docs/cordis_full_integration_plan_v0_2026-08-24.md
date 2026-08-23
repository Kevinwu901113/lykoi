# Cordis 完全接入 · 现状整理与方案产出路线 v0 · 2026-08-24

- **地位**：主治理 Agent 起草，**[建议，未拍板]**。§1 为事实整理（2026-08-24 实测核验），
  §2–§5 为方案建议，升格须 Kevin 逐条批复（决策点 CF-1…CF-6，§4）。
- **指令来源**：Kevin 2026-08-24："不理这些了。新开方案，我们要完全接入 cordis。
  先整理当前 lykoi 框架/代码/情况。结合 cordis 的方案要怎么出。"
- **与旧案的关系**：`cordis_integration_plan_2026-08-18.md`（"演化非移植、不整体
  Cordis 化"）的**总方针被本指令覆盖**；其 §1 对账表、§6 不变量、CD4（首器官=coding）
  由本文继承并更新。白皮书 v1.2 第 37 章仍是原则层正本——本案就是把 37 章从
  [PARTIAL]/[PLANNED] 做成 [IMPLEMENTED] 的工程总案。

---

## 1. 现状整理（活体 = `4463ae8` = tag `cordis-night-20260822`，2026-08-24 实测）

### 1.1 基座事实

**进程布局**：9 个 systemd 服务在跑（core / server / autonomy / watchdog / telegram +
xvfb / fluxbox / vnc / novnc），另有 `lykoi-runner.service` / `lykoi-broker.service`
单元文件已入库但**系统安装未做**（gw02_merge_checklist，前提=代理箱 ACL）。

**代码布局**（src/lykoi，10 包，约 3.9 万行 Python；tests 154 文件）：

| 包 | 行数 | 角色 | Cordis 视角的归类（37.3 五分类） |
|---|---|---|---|
| core | 13,282 | Core v1 事实/注意力/权限流水线（大部影子态） | 大脑内构件（候选）+ 基础设施 |
| mind | 8,999 | 心智：快照/决策/回流/关切/念头/整合/专注/显著性 | 大脑内构件（主体） |
| cognition | 5,863 | 编排：自主循环/对话/心跳影子/LLM 路由/自感知 | 大脑内构件 + 心脏（影子） |
| kernel | 4,510 | dispatch/审批/三层门/豁免/审计/委托数据面 | **治理面特权层（37.6，永不插件化）** |
| resources | 2,497 | messenger/browser/terminal/telegram 设备 | 通道适配器 + 反射/工具面 |
| shared | 1,148 | clock/锁/出箱/脱敏/日志 | 基础设施 |
| runner | 1,023 | T1 Runner（七态工单状态机，verified 永不自写） | 器官执行壳（已建未装） |
| surface | 705 | FastAPI 入口 + 感知 ingest | 基础设施 |
| broker | 591 | secret handle broker（三口已补） | 基础设施 |
| memory | 457 | persona/长期记忆存取 | 大脑内构件 |

**安全底座**（本案必须完整保留的东西）：guardian manifest 113 条 root 属主 +
`startup_verify` 启动门；kernel/core 目录 root 封存（教训 37/④）；三层门审批
（免询/对话/硬门）+ E1/E2 豁免 + HARD_ASK 加固；备份 13 项 + 异地拉取 + DR 演练
通过；治理平面账户隔离与工单纪律。

**状态层**：memory.db（**rollback journal，无 WAL**）+ 4 个 sidecar db
（salience_shadow=WAL / core_facts / permission_evidence_shadow / percept_buffer=孤儿）
+ 11 个 JSON/JSONL。写者矩阵与租约清单见 C-A 报告 §3/§5（L1–L10、C1–C12）。

### 1.2 Cordis 八决议对账（8-18 表更新到今天）

| Cordis 决议 | 今天的活体现状 | 剩余缺口 |
|---|---|---|
| 星形拓扑 | 适配器侧 ✅（说全走 dispatch，Telegram 哑化+来源盖章）；器官侧代码全部就位（Gateway 数据面+管线面+T1 Runner+broker，GW-01/02 已入库） | runner/broker 系统安装；首个真器官从未跑过 |
| 双时钟 + tick 合并 | **心跳影子已上岗**（CB-01：heartbeat.py 零 LLM/零表写/有界日志，与旧定时并行只置位）；显著性只读接入（salience_shadow，D-CB-2 定案）；R-CA-1 唤醒风暴双护栏已修 | 步 3 切换（心跳成为唯一 `_due` 来源）未做；**两进程（自主/对话）无互唤通路**仍在；节律锚迁墙钟（D-CB-3）未做 |
| 并行推演 + 串行拍板 | 步 4 前置切分已落（推演/回流边界 + "推演零写入"断言测试）；9.4 重评附文已起草（R1–R4） | R2 四前置余二：memory.db 切 WAL 评估、**12.3/22.2 费用硬顶（代码零强制）**；仲裁器/租约未实现 |
| **插件五分类 / 插件机制** | **❌ 无插件机制**——分类语义只存在于文档与器官清单登记处 | **这是"完全接入"的核心缺口**：无注册机制、无作用域裁剪、无可逆副作用、无热插拔 |
| 副作用分级 × 三层门 | ✅ 全环走通（S 线），审批递归豁免（P1/E1/E2）已入活体 | — |
| 身体图式 | 器官清单（U2，代码派生只读、纯函数出入口）雏形在 | 注册式物化视图、卸载即消失语义未有 |
| 信任边界 / 来源盖章 | ✅ 来源标签+身份绑定+环境祈使句降格（MVP 双防线验证过） | 结构层强拦未建制（今提示词层为主） |
| 自进化走廊 | L5 建议队列 ✅（她无写审批规则路径） | fork 隔离试运行、热载入未有（依赖插件机制） |
| 工单状态机（她侧） | T1 Runner 七态版已入库（collected/rejected 映射，verified 永不自写=9.4 落法） | 未系统安装、未接首个委托 |
| 回执背书（37.8） | 提示词层约束+影子探针在（U3 判据③） | **结构层校验器未建**；U3 首夜实锤对话轮 tool_call 派发链/审计面断裂 |

### 1.3 关键负债与未了（本案必须吸收或显式搁置的账）

1. **U3 首夜两缺陷**（08-24 01:07 止损，代码未回滚，信封回影子态）：
   ①DeepSeek json 模式空回复（json_object 挡不住，无重试即沉默）；②对话轮
   tool_call 零 kernel/audit 痕迹。**对话路径 Cordis 化会重建此地——建议折入本案
   而非单独修**（CF-2）。
2. **对话路径从未经基线审查**：C-A 后半（conversation.py 1,623 行 +
   conversation_cycle.py 614 行 + telegram 设备）当时按"U4 后再审"留白。
   完全接入前这是 31 章硬前置的**未完成部分**。
3. **费用硬顶零强制**：12.3/22.2 在代码里没有任何 token/金额累计闸（C-A §4.6）。
   插件化+并行推演+器官委托三件都放大费用敞口，**本案的第一块地基**。
4. 双显著性流水线二选一已定（salience_shadow），Core 侧 attention_decisions
   零消费者——Core 13k 行的去留/归类是本案绕不开的盘点对象。
5. 死代码/孤儿：percept_buffer（等感知重建）、cognition/permission_evidence_shadow、
   owner_edits_log、clock.step（C-A §7.1）。
6. 旧账两串：追认 5 条 + 决断 5 项 + 9.4 附文批复——多数会被本案的拍板自然吸收，
   在 §4 逐条给了归宿（CF-6）。

### 1.4 参考物可得性（2026-08-24 实测）

- **dsh 是 npm 公开发行包**：`@deepseek-ai/dsh`，本机 Codex harbor-job 遗迹里可见
  完整包清单（约 180 个插件包）：`@deepseek-ai/cordis` 内核 + loader/hmr/group/
  include/timer 官方插件 + dsh-agent/subagent/session/compaction/llm/tool/sandbox/
  workflow 全生态。**TypeScript/Node 体系**（Node 24，pnpm workspace，配置=
  bundles + cordis.patch.yml 覆盖层）。Cordis 内核源自 Koishi 生态（论文
  《A Programming Paradigm for Spatiotemporal Composability》）。
- **Mac 上无完整本地检出**（harbor 遗迹的 node_modules 是指向容器内 /root 的死链）；
  取用一条命令可得（`npm i -g @deepseek-ai/dsh`）。
- **Python 侧参考实现** = `experiments/cordis-brain-mvp/`（冻结）：极简内核
  （服务容器/作用域裁剪/emit-waterfall/可逆副作用）+ 七幕验证 + LLM 实测三观察，
  收官缺陷清单 A/B 两类在案。

---

## 2. "完全接入"的形态选型（CF-1，本案第一决策点）

"完全接入 Cordis"有三种可组合的落法，差别在**运行时**而不在架构语义——37 章的
架构语义三者相同。

### 形态 A · Python 自研 Cordis 等价内核（机制自研，运行时不变）

在 src/lykoi 内新建插件内核（ctx/作用域/服务容器/事件/可逆副作用/注册表/loader，
MVP kernel.py 的生产化，约 1–2k 行），然后把 cognition/mind/resources 逐批迁成
插件树；kernel(治理面) 与 guardian 留在插件体系**外**作为特权层。

- 优点：3.9 万行资产与 154 个测试文件全部保值；guardian manifest/root 封存/
  startup_verify 安全体系**原样覆盖新内核**（还是 .py 文件）；数据主权（26.2）
  不新增暴露面；影子对比在同进程内做，成本最低。
- 代价：HMR/loader 要自己写（可分期：先注册+作用域，热插拔后置）；
  "接入的是 Cordis 架构，不是 Cordis 本体"。

### 形态 B · 真 Cordis（TS）作大脑宿主（本体接入，双运行时）

新起 Node 进程跑 `@deepseek-ai/cordis`（或裁剪的 dsh profile），Lykoi 认知构件
写成 TS 插件；Python 侧退为特权服务（kernel dispatch/审批/mind store/guardian）
经 socket/HTTP 供调用。

- 优点：loader/HMR/插件树/patch 配置全部现成且经 dsh 生产验证；dsh 生态
  （session/compaction/llm-retry/token-meter/subagent）可直接复用为大脑内构件。
- 代价（逐条都是硬的）：①**安全底座失覆盖**——manifest/startup_verify 对
  node_modules（数百 MB 三方代码）无既有工具，22.2 硬性策略需要整套新机制；
  ②心智语义（经验流/关切/调节场/学习环 L1–L5）在 dsh 无对应物，**反正都要自写
  插件**，省下的只是内核层；③IPC 成为新故障面（U3 首夜的教训恰是"边界上的
  送达失败最伤"）；④3.9 万行 Python 中 mind/cognition 约 1.5 万行要重写或桥接；
  ⑤服务器多一个运行时的运维/备份/DR 面。

### 形态 C · dsh 整机作首个器官（与 A 或 B 正交，建议无论如何都做）

**dsh 本身就是一个现成的 coding agent**。CD4 已定首器官=coding；T1 Runner 的
sandbox 里跑 `dsh` headless profile，工单进、回执出，经 Gateway/broker 全程受治理。
这是"真 dsh 进入 Lykoi 体系"的最低风险位置——**在器官位，不在心脏位**。

### 建议（[建议，未拍板]）

**A + C**：大脑用 Python 内核完全实现 Cordis 机制（分期：注册/作用域/可逆副作用
先行，HMR 后置），dsh 真机以首个器官身份接入。理由：安全底座与数据主权是 Lykoi
区别于"又一个 agent 框架"的立身之本，形态 B 为换内核把这两样置于新建攻击面上，
且心智层重写量并不因此减少。**若 Kevin 的"完全接入"就是要 Cordis 本体做大脑**，
则选 B，§3 的路线同样适用，但步骤 1 要加"Node 底座安全审查"一节（22.2 如何盖住
node_modules、备份/DR 扩展、IPC 契约）。

---

## 3. 方案怎么出（产出路线，四步）

白皮书 31 章（基线审查前置）+ 32 章（大规模重构原则）对本案是硬程序。路线：

### 步骤 1 · 补齐基线审查（1–2 张只读单，opus）

- **C-A 后半**：对话路径全审（conversation/conversation_cycle/telegram 设备/
  approval_conversation 消费面），产物含 U3 两缺陷的结构定位——这份报告就是
  对话路径插件化的迁移地图。
- **Core 13k 行处置审查**：影子流水线逐条判"进插件树/留基础设施/退役"，
  给 37.3 归类表。（形态 B 另加 Node 底座安全审查。）
- 已有可复用：C-A 前半（调度侧全景+写者矩阵+租约清单+费用口径）、9.4 附文、
  GW-02 §7 交接节、器官清单。**不重审已审过的**。

### 步骤 2 · 总体设计书（本案正本，一份文档）

内容骨架：①插件内核规格（ctx/作用域裁剪/注册与可逆副作用/五分类查表的审批与
测试待遇/图式物化视图）；②**迁移地图**——1.1 表右列逐模块落到插件分类，标注
每模块"原样包裹 / 重构后迁 / 留特权层 / 退役"；③特权层边界条款（kernel+guardian
永不入树，插件对 dispatch 的唯一通路）；④分期序列与每期影子/切换判据；
⑤费用硬顶设计（前置闸+route 会计+run_id 归因，37.5 R2-4）；⑥白皮书 v1.3 批次
清单。设计书出来后 Kevin 逐节拍板，即为本案的"定案文档"。

### 步骤 3 · 决策点批复（§4 的 CF-1…CF-6，随设计书一次呈）

### 步骤 4 · 工单序列（每期一门，影子先行，可回滚）

初步分期（设计书里细化，此处只给形状）：

```
期0 地基     费用硬顶 + WAL 评估 + U3 两缺陷结构修（折入）    ← 全程护住费用与真实性
期1 内核     插件内核 + 注册表 + 身体图式物化视图（影子：图式 vs 器官清单对比）
期2 心脏     C-B 步 3 切换（心跳唯一来源）+ 互唤通路 + 节律迁墙钟（D-CB-3）
期3 大脑迁移 mind/cognition 构件分批入树（每批全邻接+影子对比；对话路径重建吸收 U3 缺陷）
期4 器官     runner/broker 系统安装 → dsh 首委托（lykoi-ui 小修决议沿用）→ 回执背书结构层
期5 并发     9.4 R2 四前置齐 → 仲裁器 + 租约（L1–L7 照 rule_suggestions 范式）→ 并行推演
期6 走廊     fork 试运行 + 热载入（自进化走廊收口；HMR 若形态 A 在此期落）
```

期与期之间 Kevin 过门；任何一期内部影子期旧路径为准（8.6）；每单 manifest 重签
+ 全邻接测试照旧。

---

## 4. 决策点清单（呈 Kevin）

| # | 决策 | 建议 |
|---|---|---|
| CF-1 | 运行时选型：A（Python 自研内核）/ B（真 Cordis TS 大脑）/ A+C / B+C | **A + C**（§2） |
| CF-2 | U3 两缺陷（json 空回复/tool_call 派发链）：单独修复单，还是折入期 0/期 3？ | 折入（对话路径反正重建；期 0 先落结构修止血，二次翻开关随期 3） |
| CF-3 | 旧账处置：追认 5 条 + 决断 5 项 + 9.4 附文 | 9.4 附文随设计书批（期 5 前提）；追认/决断中与 runner/broker/core_v1_shadow 相关各条并入步骤 1 审查结论一次处理 |
| CF-4 | 费用硬顶是否为期 0 硬前置（任何插件化/并发之前） | 是（C-A §4.6：现状为零；本案全程放大敞口） |
| CF-5 | 首器官实现体：dsh headless（形态 C）还是自研最小 coding agent | dsh headless（现成、回执链最成熟；sandbox+白名单+broker handle 全程受治理） |
| CF-6 | 感知重建（Mac 眼睛，8-13 冻结）是否入本案 | 不入；插件树给感知留"通道适配器"位即可，重建另案 |

## 5. 不变量（继承自 8-18 方案 §6 与白皮书，不因"完全"松动）

治理面特权层（Guardian/22.2/kernel dispatch）不可插件化、不可卸载；她不能自己
批准自己（审批规则永无她的写路径）；适配器永远哑（Telegram 不升器官）；影子期
旧路径为准，切换须 Kevin root 开关且秒级可回滚；每单 manifest 重签 + 全邻接测试；
并行推演受费用硬顶约束（期 0 先行）；敏感知觉只走本地模型（26.2，dsh 器官的
工单内容适用数据主权分级）。

## 附：过程纪律自查

- 本文全程只读探查（服务器 lykoi-gov 只读 + Mac 文档），零服务器写动作。
- §1 全部经 2026-08-24 实测或引自复核 PASS 的报告；§2–§5 为 [建议，未拍板]。
- 旧案（8-18）不删不改，本文头部声明覆盖关系，血统可追。
