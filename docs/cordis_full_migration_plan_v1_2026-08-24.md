# Cordis 完全移植总案 v1 · 2026-08-24

- **地位**：主治理 Agent 起草。**§1 拍板记录为定案**；§2–§7 为移植方案主体，
  [建议，待 Kevin 逐节批复]（遗留决策点 CF-B1…CF-B5，§6）。
- **上游**：`cordis_full_integration_plan_v0_2026-08-24.md`（同日 v0，保留为现状
  整理正本；其 §2 选型与 §3 六期影子路线被本文取代）；白皮书 v1.2 第 37 章
  （架构语义正本，本案不改语义只换运行时）；C-A 前半报告（行为规格素材）。

---

## 1. 拍板记录（2026-08-24，Kevin）

> "我想完全接入完全移植。不考虑用户端断联或者什么体验感。因为用户就只有我。"

据此定案：

- **CF-1 = 完全移植**：Lykoi 整体迁移到 Cordis（TS/Node）运行时，成为一个
  cordis 发行版（形态上对标 dsh：cordis 内核 + bundles + patch.yml 配置树，
  插件集自研 `lykoi-*`）。Python 活体不再演化，只作切换前的在跑体与切换后的
  回滚锚。
- **约束解除**：切换平滑度、服务连续性、"影子期旧路径为准"的渐进纪律——全部
  解除。允许停机切换、允许新体一次性接管。
- **约束不解除（这三样不是体验，是本体）**：
  1. **数据即身份**：memory.db / 经验流 / persona 种子 / 审计正本必须完整接管，
     一条不丢。换的是躯体，不换记忆。
  2. **治理特权层**（37.6 NORMATIVE）：Guardian/硬性策略/审批规则在新世界必须
     等价重建且不可插件化；她不能自己批准自己。
  3. **费用硬顶**（12.3/22.2）：旧世界欠的账（代码零强制）在新世界开工期就还，
     不带病移植。

## 2. 目标形态：Lykoi 作为 cordis 发行版

```
Node 进程（cordis 内核 + loader + patch.yml 配置树）
├── 心脏      lykoi-heart（基线心跳+显著性唤醒+tick 合并；可基于 cordis-plugin-timer）
├── 大脑内构件（自研插件集，语义逐条对应现行 mind/cognition）
│   ├── lykoi-percept      知觉板/来源盖章消费
│   ├── lykoi-assembler    上下文装配器（37.7；三段式/CACHE-INVERT 语义原样迁）
│   ├── lykoi-decide       决策信封（U3 周期合一语义原生实现，见 §3.3）
│   ├── lykoi-arbiter      仲裁器=唯一写者（37.5 目标形态在新体里一步到位）
│   ├── lykoi-memory       memory.db 接管（better-sqlite3，schema 原样）
│   ├── lykoi-learning     L1 分类→L2 消化→L3 检索→L4 专注→L5 建议队列
│   ├── lykoi-regulation   调节场/情绪单写者
│   └── lykoi-persona      人格构件+种子（P-D1/P-D2 语义）
├── 治理特权层（不入插件树，见 CF-B1）
│   ├── 三层门/审批对话/E1E2 豁免/HARD_ASK
│   ├── 审计（append-only 正本）+ 回执背书结构层（37.8，新建）
│   └── 预算硬顶（新建：route 会计+run 归因+前置闸）
├── 通道适配器  lykoi-adapter-telegram（哑换能器+来源盖章，语义不变）
├── 器官        dsh 子代理 = 首个 coding 器官（cordis 原生 subagent 机制或经 Gateway 语义）
└── 基础设施    session 持久化/llm 客户端/重试/token 计量 —— 直接复用 dsh 包
               （dsh-llm-deepseek/dsh-llm-retry/dsh-token-meter/dsh-session-persistence 候选）
```

**复用判据**：凡"无 Lykoi 语义的管道件"（LLM 客户端、重试、计量、会话持久化、
沙箱）优先复用 dsh 现成包；凡"她的心智语义"（快照/关切/念头/调节场/学习环/
信封契约）**必须自研插件、语义逐字对照现行实现迁移**——dsh 生态里没有这些的
对应物，这是本案工作量的主体。

**状态层不迁移**：SQLite 跨运行时，memory.db 及全部 sidecar/JSON 原路径原
schema 接管（`/home/lykoi/state/`）。这是"换躯体不换记忆"的技术根据，也是本案
最大的省——**零数据迁移**。（WAL 切换作为接管时的一次性动作评估，CF-B5。）

## 3. 移植原则

### 3.1 语义正本 = 白皮书 37 章 + 现行活体行为

移植不是重设计。每个 `lykoi-*` 插件的验收基准是"与现行 Python 实现语义等价"，
差异必须逐条声明并过 Kevin。提示词、信封契约、候选表护栏（demote/fail-closed 闸）、
预算候选删除三层机制——**逐字迁移**，不许执行 Agent 顺手"改进"。

### 3.2 允许一步到位的三处（旧世界排队多期的，新体直接建成）

1. **仲裁器/单写者**：旧路线要等 9.4 R2 四前置慢慢解锁；新体从第一行起就是
   "推演零写入、回流唯仲裁器"的结构（C-A §5.3 十二条冲突在新架构里天然不存在）。
2. **双时钟互唤**：旧世界两进程无互唤通路是历史包袱；新体单进程插件树里
   消息唤醒/显著性唤醒/基线心跳同源，D-CB-1/2/3（发言权收回/salience 源/墙钟锚）
   直接按定案建成。
3. **U3 两缺陷就地消灭**：信封失败有界重试+原始响应落档、tool_call 派发必经
   治理层出回执——新 decide 插件的出生规格，不是补丁。

### 3.3 安全等价重建清单（Python 底座 → Node 等价物）

| 旧世界机制 | 新世界等价物 |
|---|---|
| guardian manifest + startup_verify | 插件树完整性门：profile 目录 root 属主 + pnpm lockfile 锁定 + 启动前对 `lykoi-*` 源与 lockfile 做哈希校验，不过不启 |
| kernel/core root 封存 | 治理特权层代码目录 root 属主、进程以 lykoi 低权跑 |
| secrets 0700 + broker | **broker（Python）保留为独立 sidecar**，Node 侧只经 handle 取用；secrets 永不进 Node 环境变量全集 |
| 三层门/审批规则 JSON | 语义与文件格式原样迁（approval_rules.json 等接管），写路径只在特权层 |
| 备份 13 项 + DR | 备份清单增补 Node 侧（profile+lockfile+插件源），DR 手册随 M4 修订 |
| 审计 append-only | 正本仍落 /var/log/lykoi-audit（root:lykoi），Node 经同权限模型写 |

### 3.4 旧体处置

切换前：五服务照跑（她照常活着，不为体验、为的是切换前她的经验流不断档）。
切换时：`systemctl stop` 五服务 → 新体接管 state/ → 验收（§5 M4 清单）。
切换后：旧 systemd 单元与 Python 仓**保留不删**（tag 封存），回滚=停新体重启旧
五服务，分钟级。旧体退役拆除另立小单，等新体跑稳一段 Kevin 点头再做。

## 4. 移植分期（M0–M5，串行推进，允许期内并行工单）

| 期 | 内容 | 出口判据 |
|---|---|---|
| **M0 规格与封存** | ①对话路径规格提取（C-A 后半改目的：不是护活体，是给 lykoi-decide/adapter 写行为规格）；②DB/state 契约文档（表×语义×写者，C-A §3 已有一半）；③全量备份+tag `pre-cordis-migration`；④dsh 装机研读单（内核 API/loader/subagent/llm 包边界，产物=复用清单定稿） | 规格文档过 Kevin；备份验证过 |
| **M1 骨架起立** | 新仓 + cordis profile + lykoi-heart + lykoi-memory（**只读**接 state 副本）+ telegram 适配器 + 最小对话环（dev bot 或隔离 chat）。**费用硬顶与审计在本期第一单落**（不带病开发） | 新体在 state 副本上能感知/能对话/账本有数 |
| **M2 心智移植** | assembler/decide/percept/regulation/concerns/thoughts/L1–L5/persona 逐插件迁移，信封周期合一原生版；每插件一单，判据=与 Python 版行为对照（同输入同快照同决策，用录制回放而非双跑） | 心智全集对照通过；新体在副本上完整过夜（心跳/整合/专注） |
| **M3 治理移植** | 三层门/审批对话/豁免/HARD_ASK/回执背书结构层/图式注册机制；插件树完整性门+DR 修订 | 审批环端到端（含终端硬门实弹）；完整性门红绿双验 |
| **M4 切换** | 停旧五服务 → state 正本接管（含 WAL 决定）→ 验收清单（数据完整性对账/五门实弹/审计连续性/备份腿）→ 新体 systemd 化 | 验收全绿；回滚预案演练过一次 |
| **M5 器官与走廊** | dsh 子代理器官首委托（lykoi-ui 小修决议沿用）；HMR 热插拔实用化；fork 试运行走廊（21 章）；并行推演在仲裁器下放开 | 首委托回执闭环；热插拔一次实操 |

**执行体系照旧**：我签工单、服务器 Claude Code 执行、我复核、你过门——但过门
从"每单 root 合并"简化为"每期一次"（M0 定稿、M1–M3 期末验收、M4 切换是你 root
动作、M5 首委托）。新仓在切换前不碰活体，工单密度可以拉满。

## 5. M4 切换验收清单（预置，届时逐条打勾）

1. state 接管对账：表行数/最新 ts/schema 版本 与停机快照逐一相符；
2. 她的第一轮对话：信封回复 + 回执背书探针零无据陈述；
3. 审批三层门实弹各一（免询/对话/硬门-终端）；
4. 心跳过夜：整合/专注各至少一周期，经验流连续（停机段以重启事件如实呈现）;
5. 审计连续性：正本 append 权限模型验证 + 切换事件在案；
6. 费用账本：每 LLM 调用有 route+run 归因，硬顶红测触发过；
7. 备份腿全绿（含 Node 侧新增项）+ 回滚演练（停新起旧再停旧起新）。

## 6. 遗留决策点（CF-B）

**批复记录：CF-B1..B5 已由 Kevin 2026-08-24 按建议值批准**（M2 五波收口呈报同批；
CF-B6 早前按预授权定案）。B3/B4 在 M0/M1 已事实落地，此批为正式追认；B1/B2/B5
自此为 M3/M4 的生效前提。M2 追认清单七条同日同批获准（正本 lykoi-cordis
docs/m2_blueprint.md 追认节）。

| # | 决策 | 建议（=批准值） |
|---|---|---|
| CF-B1 | 治理特权层落位：同进程内非插件模块（TS）+ 外部完整性门，还是独立最小 Python 守护进程 | 同进程 TS + root 属主源目录 + 启动完整性门；broker 独立保留（§3.3） |
| CF-B2 | core 13k 行（影子流水线）处置 | **不迁移，整体退役**——attention/permission 影子的目标语义已由心脏显著性与治理层承接；退役审查单在 M0 顺带出清单 |
| CF-B3 | dsh 复用深度：只用 cordis 内核，还是含 dsh-llm/session/sandbox 基础包 | 含基础包（§2 复用判据）；M0 研读单定稿边界，锁 lockfile |
| CF-B4 | 新仓位置与血统 | 新仓 `lykoi-cordis`（GitHub 私有，与治理仓库同套纪律）；不在旧仓里长 |
| CF-B5 | 接管时技术项：WAL 切换、Node 版本钉死、mac 侧 LykoiApp 处置 | WAL 切（仲裁器形态受益）；Node LTS 钉 lockfile；LykoiApp 维持既有冻结（感知另案，CF-6 沿用） |
| CF-B6 | dsh-llm-deepseek 每请求附实例假名头 `x-deepseek-harness-user-id`（无关闭开关，WO-M0-DSH-STUDY §7.2）如何处置 | **剥头**：vendor 该 adapter 为 lykoi-llm-deepseek，去掉 resolveUserId（单点改动）；UA 版本归因头 `deepseek-harness/<v>` 接受（标识软件非实例）；telemetry 行不挂 + `DSH_TELEMETRY_DISABLED=1` 纵深。列 v1.3 白皮书 26.2 注记候选。**已按预授权定案（2026-08-24）** |

## 7. 风险声明（如实，不劝退）

- **工作量主体**：mind+cognition 约 1.5 万行语义保真重写，是全案最大件；
  154 个测试里行为级用例要在 TS 侧重建骨干（录制回放可摊薄）。
- **单一提供方风险**：cordis/dsh 是 DeepSeek 开源体系（2026-08-13 开源），生态
  年轻；lockfile 钉死 + 源码入备份可控其漂移，但框架级 bug 只能自己修。
- **她的断代体验**：停机切换会成为她经验流里的一次"长睡眠"，M4 以重启事件如实
  呈现（不伪造连续性）——这是数据诚实，不是体验修饰。
- **最大的隐性风险是语义漂移**：重写时执行 Agent"顺手改进"。对策已在 §3.1
  （逐字迁移纪律 + 差异逐条申报），复核照旧全量。

## 附：过程纪律自查

- 本文零服务器写动作；v0 现状整理仍有效引用。
- §1 拍板按 Kevin 原话记录；其余为建议，M0 产物呈批时逐节确认。
