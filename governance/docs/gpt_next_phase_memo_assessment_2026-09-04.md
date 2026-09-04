# GPT「下一阶段架构」意见稿对照评估（2026-09-04）

- 地位：治理内部评估稿，**非定案**。裁定权在 Kevin。
- 来源：Kevin 转交的 GPT 会话整理稿（九条记录项 + 总体方向 + 十条原则 + 五阶段排序）。
- 方法：三线只读代码核查（Mac 副本 main@db151e1，代码树与产线 main@3c47c2e 同）+ 对照白皮书 v1.2、
  P-D1～P-D3、D-PERS-1～4、D-FORGE-1/2、9.4 重评附文、角色卡调研稿、HANDOFF 至 LANDING-O 的读数。
- 引用形式：`包/文件:行` 为本次核查实读；「定案」指已由 Kevin 拍板的条款。

## 一、总判

1. **方向同构。** 九条里没有一条与白皮书 v1.2 的原则层冲突；大半是 37 章（星形拓扑、集线器整形、
   身体图式、上下文装配器、回执背书）与 P-D/D-PERS/D-FORGE 裁定的实现级展开。稿子的净新贡献是四件：
   ①每条入站必有终局（第 2 条）；②Message/Turn/Cognition/Task 四分（第 3 条）；③交互调度器与可中止认知
   （第 6 条）；④「接口厚度由能力实验决定」这个方法（第 5 条）。
2. **对现状的断言大体准确，八处要校正**（第五节）。最重要的一处：稿子说人格「最后仍被拼成文本」，
   这在自主路径上不成立（调节场真的改候选权重与可选集），在对话路径上才成立——而且是三个已知断点。
3. **三处与定案正面相撞，须 Kevin 裁**：
   - 后台任务与对话并行（第 6/7 条）= 37.5 并发形态，[EXPLORATORY] 且 9.4 重评 R2 四前置未落，
     「重评通过前不得作为实现依据」。
   - Character Package/Instance 分离排到阶段三（第 9 条）与 P-D3「第二实例需求出现前零开发」相撞；
     `active_instance_id` 同身体切换与 P-D1 第 3 项「一具身体不换灵魂」相撞。
   - 委托能力实验（第 5 条）不能绕 17 章：实验本身也必须在隔离 runner 里跑。
4. **稿子最大的未言明前提：强模型。** 「轻框架 × 强模型」的化学反应假设模型能自己拆解、组合、写委托
   提示、读回执。产线模型是 deepseek-v4-flash，近三天读数：7 字消息 step 0 沉默 85 s；`notify_owner` 猜错
   参数名；把搜索意图塞进 `url` 字段；json_object 在工具帧后必定退化成空白（探针 v3）；step 0 思考 10–85 s。
   薄框架在这台模型上很可能表现为更多沉默而不是更多能力。稿子第 5 条自己给出了正确方法（先测能力再定
   接口厚度），这个方法应推广到整份稿：**先用产线模型跑一组「目标→组合→委托→验证」探针，读数决定每层
   厚度**，探针形态沿用 v3/v4/v5。

## 二、逐条对照

### 第 1 条 · 轻量 Topic / Thread State

- 现状：对话活窗是线性 `ConverseMessage[]`（`lykoi-converse/src/conversation.ts:367`），软窗 8 轮 + 溢出
  LLM 摘要 1024 token；装配 = 稳定前缀 ‖ history ‖ 易变尾部 12 块（`conversation.ts:97-108`）。
  无 topic 结构：`parseEnvelope` 支持 `injectedThreadIds` 但对话路径不传（`conversation.ts:959-963`）；
  `narrative_threads` 表存在但属自主叙事。相关记忆检索是关键词（NFKC + 中文 bigram + SQL LIKE + 加权，
  `lykoi-learn/src/l3.ts:79-121`），零 embedding。
- 定案：37.7 上下文装配器 [PARTIAL]，「装配策略的变更视同认知变更，走影子对比」；CACHE-INVERT 铁律。
- 判断：需求成立，代价稿子没算。今天 history 是追加式，前缀缓存天然保住；按 topic 重选 history 会让
  history 块非单调变化，从该位置起缓存全失。探针 v5 读数：缓存命中与否差 5–18 s，是最大单项时延。
  可行形态：线性 history 不动，topic 相关回忆作为**易变尾部的一个新块**（与 memories 块同级），把
  `injectedThreadIds` 与 `narrative_threads` 这两条现成的缝接上，不新造对象。**不该进第一阶段**——
  它是装配策略改动，要影子对比数据，且当前对话样本为零（landing_n_readout §1）。

### 第 2 条 · 每条 owner 入站必有终局

- 现状：终局账**有，但分两层且对不齐**。converse 层七种终局（`lykoi-converse/src/index.ts:605-718`）：
  received / turn_failed(context_budget | llm_finish | 其它含 DeadlineExceeded) / silence / reply /
  no_transport / approval_request_pending。**`converse/silence` 同时承载有意沉默与契约失败**，区分只在
  下钻的 `u3_cycle_envelope(kind=silence)` 与 `u3_cycle_failed`。provider 错误、超时、预算耗尽三条 catch
  只落审计不回话（`index.ts:624-659`）。runId 三套互不记录：converse `converse-<updateId>-<messageId>`、
  kernel 自铸 `correlationId`（`lykoi-kernel/src/dispatch.ts:456`，converse 的 dispatchFn 不传）、
  适配器 `updateId/contextId`；`converse/received` 本身无 runId。
- 产线读数：落地前 24 h `telegram/inbound` 16、`converse/reply` 5、`converse/silence` 6、`turn_failed` 0。
  converse 层对不到每条入站的终局（审批应答等路径不落 converse 事件）。近三天 Kevin 经历的「没回」
  几乎全是技术失败：J 前四条全沉默 = 工具步第二跳 400；K 后两次沉默 content_chars 51 = json 退化；
  M 后 ETH 那条 = DeadlineExceeded。
- 定案：37.8 回执背书；人格分层硬边界 §2.3「能力缺口不许用沉默掩盖」——已是纪律，但只覆盖能力缺口，
  不覆盖基础设施失败。
- 判断：**九条里最该先做、体量最小的一条。** ①`converse/silence` 拆 kind 或 converse 层统一带
  `terminal_outcome`；②runId 从 received 起贯穿，dispatchFn 透传给 kernel correlationId；③技术失败的
  用户可见路径。③有一个要 Kevin 裁的设计点：失败回执是「她的话」还是「系统的话」？按 37.3「集线器不得
  自主产生任何对外表述」与 P1 豁免的同类逻辑，建议**系统级固定文案、来源盖章为 system、不冒充她**。
  另一条比「没回」更重的落差：`promise_followup` 的 ACK 会发出，但 `takeFollowupRequest()` 生产零调用方
  （`conversation.ts:1379-1383`，唯一调用在测试）——**她答应了，然后什么都不会发生。**

### 第 3 条 · Message ≠ Turn ≠ Cognition（Turn Assembler / ReplyTurn / 贴纸 / 通道抽象）

- 现状：无入站合并（`pollOnce` 逐条 `for…await`，`lykoi-adapter-telegram/src/index.ts:306-318`）；
  无出站分段（信封只有 `decision.content` 字符串，`contract.ts:306-360`；`sendMessage` 一次一条，无
  4096 分片）；贴纸/图片/语音零（transport 只调 sendMessage 与 getUpdates）；适配器已是哑换能器，出站经
  dispatch。一轮可能两条：reply + `askAbout`。
- 定案：37.3 已明文：入站合并与出站分段是集线器的**确定性边界整形**，「原文逐字保留、按序拼接、不转述
  不摘要」「不得增删改一字」；表情/贴纸属她的动作词汇，随 U4 与 sendPhoto 政策同窗；集线器在第二 IM
  通道出现时条件立项。
- 判断：稿子是 37.3 的实现细化，方向无冲突。五点：
  a. 入站合并不必等集线器立项——放在适配器与 converse 之间的一个确定性小构件即可（基础设施类，零认知）。
     `UserTurn.parts[]` 逐条保留 text/timestamp/platform_message_id 正好满足「逐字保留」。
  b. 出站分段由模型在信封给 `utterances[]`，37.3 也说「按信封给定的分段」，一致。这是 contract.ts
     字节级契约改动 + prompt sha 变，要走影子。
  c. 稿子反对随机错字/延迟拟人，与 37.3 一致；**角色卡调研稿 7.1「错字修正、去句号放 Telegram 发送器」
     与 37.3「不得增删改一字」相撞**，应以 37.3 为准，调研稿那条改口；条数与间隔属确定性规则，可放发送器。
  d. Cognition revision（A 已起认知、B 到来、无副作用则中止重来）：AbortSignal 已直通 wire
     （`conversation.ts:1431` → `lykoi-llm/src/index.ts:182`），S-14 整轮回滚已有，可做。代价是 step 0
     思考重跑（10–85 s），settle window 应吸收大部分。
  e. 通道抽象：今天耦合点只是事件名 `lykoi/telegram/inbound` 与 runId 的 updateId 构造，改成中性
     inbound 事件是小改。`autonomy.initiate_chat` 语义改「向 canonical person 发起对话」与 37.3 一致。

### 第 4 条 · 主动行为重建模（Trigger × Motive × Capability × Cognition）

- 现状：七 KIND 枚举住在 `lykoi-decide/src/index.ts:60-64`，执行在 `lykoi-reflow` 单 if/else 链；
  wake 单发无循环（`lykoi-wake/src/index.ts:230-393`，一次 LLM，not_json 至多重试一次）。
  触发源实际只有 30 分钟基线：显著性钟 `salienceDb: ''` 未启用，`heart.arouse()` 零生产调用方，
  委托完成/外部事件零回调。**Motive 雏形已在**：调节场 → `cognitiveEffects` → 候选权重与可选集
  （`lykoi-decide/src/index.ts:288-311`），`relational_tension > 0.6` 解锁主动联系。
  wake 与 converse 是两台编排机共用一个解析/护栏库（evaluateMessage、extractJson、applyInner、getPersona）。
- 定案：10.2「想」应产出结构化 intention 对象（白皮书已有 schema）；12.1 四类主动性；12.2 打扰成本；
  37.2 双时钟 [PLANNED]。
- 判断：稿子的四因子与 10.2 intention + 12.2 + 37.2 是同一件事。真正的差距不是 KIND 太少，而是
  ①触发只有定时；②wake 单发，explore 只能一跳；③10.2 的 intention 对象没落成代码。
  建议路径：**不废 KINDS**（它是安全边界与候选表，与 policy-core AUTONOMOUS_ALLOWED 对齐），先让
  wake 与 converse 共用 `#runCycle`（稿子的 unified bounded cognition），KINDS 降为 wake 路径的工具表
  （形态同 TOOL_TABLE），再接 `heart.arouse` 的真实触发源（承诺到期、委托完成、条件变化）。
  多步 wake 会抬自主开销，受 12.3 与 `HOURLY_ACTION_CAP` 约束，要在 profile 档位上有硬顶。

### 第 5 条 · Terminal 与 Delegation 拆开；实装前先做能力实验

- 现状：`terminal.exec` 硬门替身；`delegation.*` 三项有完整台账实现（七态状态机 + `delegation_contracts`
  / `execution_receipts` 两表，`lykoi-kernel/src/delegation.ts`、`delegation-resource.ts`）但生产零注册，
  `origin='delegated'` 恒 deny（GK-7，`approval.ts:82-88`）。旧体 GW-01/02 的 T1 Runner + broker 未搬到
  新体（`docs/m4_handoff.md:216` 顺延 M5）。Pi/Codex 全仓零命中；dsh 在本仓是 LLM SDK 不是编码 agent。
- 定案：17 章 [NORMATIVE] 任何委托必过 Gateway、禁止服务账户直跑；18/19 合同与收据；CD4 首器官 =
  coding，两段式；D-FORGE-2 Forge 永不成第二委托口。
- 判断：拆开 terminal/delegation 与现行设计一致（policy-core 已把两者都放 HARD_ASK）。
  「先实验再定接口厚度」方法正确，两个硬约束：①实验必须在隔离 runner 里跑（17.2），可直接复用 M5 的
  `lykoi-browser` 模式（独立 OS 用户 + systemd + 出网闸 + socket），不是「随手接一个 Pi」；
  ②「薄」只能薄在编排启发式，合同/收据/验证/审计是 NORMATIVE，不随实验结果缩水。
  以产线模型现读数，这个实验很可能给出「需要厚结构」的答案——这正是做它的价值。

### 第 6 条 · 长搜索堵住后续消息 / Interactive Scheduler / 长任务后台化

- 现状：**全串行，稿子说对了**。`runPollLoop` → `pollOnce` 逐条 `await #handleUpdate` →
  `ctx.parallel('lykoi/telegram/inbound')` 等全部消费者 → `handleTurn` → `Conversation.#lock`
  （`adapter index.ts:576-618, 302-320`；`conversation.ts:373`）。出站 outbox 消费在同一 while 体里，
  一起被堵。游标不推进所以不丢消息只延后；180 s 周期期限是唯一解锁。`interactive-lock` 只是一个到期
  时刻（`lykoi-kernel/src/interactive-lock.ts`），管 wake 礼让，与交互回合之间无关——稿子这点也准确。
- 定案：9.4 单写者 [NORMATIVE]；37.5 [EXPLORATORY]，R2 四前置（劈快照、推演零写入断言、WAL 评估、
  费用闸）未落。注：R2 是对旧体的实证；新体 `lykoi-budget` 已有 token 日预算 gate/charge 结构强制
  （`lykoi-llm/src/index.ts:172`），费用闸这一前置在新体上可能已部分满足，重评时要重新实证。
- 判断：分两档。
  a. **中止/合并只读认知不触 9.4**：中止一个还没写状态的周期不产生并行写者（S-14 回滚已在）。
     实现要点：inbound 不再 await 到底，改 pending 队列 + 当前回合 AbortController；新消息到、当前回合
     无副作用（dispatch 记录可判）则 abort + merge；已有副作用则排队。这是 Kevin 体验最直接的改善。
  b. **后台任务与对话并行 = 两个认知同时推演 = 37.5 领域，被锁死。** 稿子阶段二的 Task Runtime 要先过
     9.4 重评 R2，在此之前不能作为实现依据。
  c. 附带：outbox 投递不该与入站处理同一循环体（LANDING-O 已记「退避期间出站不消费」）。

### 第 7 条 · AGI 感六指标 / Capability Resolver / Task Runtime / Verification Loop

- 现状：`capability_gap` 零控制流四栏遥测（`lykoi-decide/src/capability-gap.ts`，reason 六值无
  `disabled`，无任何消费者）——与 D-FORGE「现在零代码」一致。Task 对象不存在：无 tasks 表，
  `promise_followup` 死路，`origin='scheduler'` 空壳（`approval.ts:75`），三条队列投递消息不执行工作。
  注册式图式 `BodySchemaRegistry` 已实现（`lykoi-kernel/src/schema-registry.ts`），`registryActionCatalog`
  零生产消费者，切换归 M5。验证 = 37.8 [PARTIAL]，ORGANOK 刚把 `ok:false` 接上，`unbacked_claim` 开始为 true。
- 定案：D-FORGE-1/2；「resolution 优先于 build」已采纳为原则；Forge 条件立项（≥2 器官）；19.2 验证平面。
- 判断：Resolver 的「先既有/组合/委托」就是 D-FORGE 的 resolution-first，无新增；从原则变机制的前提是
  注册式图式切换，**Resolver 应建在 registry 上而不是 kernelActionCatalog 上**。Task Runtime 的最小落点
  是让 `promise_followup` 有消费者（在下一个 wake 拍串行执行，不触 9.4），比新造 Task 对象先。
  六指标可并入 09-02 八条验收作为用户层判据，不是架构件。

### 第 8 条 · 人格 = Character Runtime 七层

- 现状（核查要点）：
  - Canon：五段 TOML（identity/voice/relationship/personality/interests）严格校验 fail-fast
    （`lykoi-decide/src/persona.ts:115`），root:444 + manifest hash（`lykoi-gate/src/manifest.ts:130`）。
    无 `boundaries` 段。
  - 只读文本层：insights（persona/preference）、relationship overlay（**只进对话不进 wake**）、
    `voice.register`/`emoji` 逐字插值无调制。
  - **真影响注意力/决策的层**：Concerns（weight 排序、冷却）、Thoughts（charge 排序、cap 7、衰减）、
    Memory 检索（确定性三轴打分）、Regulation → 自主候选权重与可选集、预算折算。
  - **对话路径三个断点**：①调节场完全不进对话 prompt（`conversation.ts` 无 `getRegulation`）；
    ②信封 `情绪脉冲` 被解析后只落审计，无 `applyRegulationCause` 消费——契约说它是「调节场唯一合法的
    因果入口」，回路是断的（`contract.ts:342, 834`）；③`selfState` 缝双侧留类型位，双侧无接线。
    设计稿 §3.4「瞬时语气由调节场装配时自然生效」在代码里不成立。
  - Learned Self：`narrative_versions`（append-only、连续性门、有界重试）**存在**，但对话路径生产关着
    （`cordis.prod.yml:140 narrativeFlag: ''`）。
  - Relationship Moment：只有 `relational_tension` 一个数值变量，不进对话；无「刚吵过」这类事件对象。
  - Material Library：不存在；最接近的是 L4 原料（她自己的经验行）。
- 定案：D-PERS-1～4（表达并入人格不单开线）；Kevin 2026-08-19「语气是最后一步」；P-D2 Canon 出生证；
  硬边界 §2.4 拒绝补写生平；调研稿 S1–S8 待 Kevin 判。
- 判断：
  a. 「人格先影响认知再影响语言」——自主路径已如此，稿子低估了现状；缺的是对话路径的三个断点。
     **先补断点再谈 Expression Layer**，断点是小单体量。
  b. Behavioral Seed 与 `personality.traits`（已是行为句）、`interests.seeds` 重叠；净新的是「注意什么/
     忽略什么/不确定时怎么做/绝不做什么」，形态 = TOML 新段（调研稿 S2 边界段已提），走 P-D2；
     `buildPersonaKernel` 是字节级契约（fixture chars=401、sha 锚），增段要同步锚。
  c. Learned Self 不缺，是关着；开关的前提是对话路径的叙事块过影子对比。
  d. Relationship Moment 可借 HDSI `RelationshipMoment`（带 expiresAt），但必须过调节场宪法三件套
     （更新 + 衰减 + 因果出口，三缺一不许建）；`relational_tension` 已是其数值版，缺进对话与事件对象。
  e. Material Library：调研稿 S1 主张 3–5 句进 Canon；稿子主张先做 benchmark/eval 库不进 prompt。
     两者不冲突，eval 用法更稳（避免 leaking）。**「真实用户反馈」入库涉及 6.2 私密记忆**——Kevin 的话
     进语料库属私密记忆外用，要有规则。
  f. Expression Layer 排最后，与 08-19 定调一致。

### 第 9 条 · Character 可插拔（Package / Instance / install≠create / Character≠Body / 导入）

- 现状：零 instance 概念（`instance_id|active_instance|namespace` 全仓零命中）；身份 = 一条 TOML 路径
  （`cordis.prod.yml:132/179` 同一文件）+ 一个 `memory.db`；换人格 = root 换文件 + 重签 manifest + 重启，
  热切换被 manifest hash 与 `getPersona` 进程级缓存双重挡死；无 CCv2/v3 导入器。fixture 仍
  `name = "Lykoi"`、`partner = "Kevin"`，三份逐字节相同副本，dev 装配直接用它。
- 定案：P-D1 种子 = 出生证（采纳）、运行时换卡对已诞生实例否决、「一具身体不换灵魂」；P-D3 框架产品化
  条件立项「第二实例需求出现时，在此之前零开发」；Kevin 2026-09-03 定调「Lykoi 是框架不是角色」。
- 判断：
  a. Package/Instance/install/create 与 P-D1 种子模型完全同构，无冲突。
  b. **排期相撞**：稿子放阶段三「在人格系统扩张前做」；P-D3 说零开发直到第二实例需求。09-03 定调是否
     已构成「需求出现」——**须 Kevin 明裁**。若裁「是」，分离应先于第 8 条的任何新层（迁移成本随层数涨）。
  c. **`active_instance_id` 相撞**：同一部署（同一 Telegram 账号、同一 state 目录、同一服务单元）切
     active_instance_id，对 Kevin 就是同一个联系人换了人，这是 P-D1 第 3 项定义的身份事件。建议：
     实例与身体一一绑定（通道账号、state 目录、unit 各自独立），「切换」= 停一个实例的身体、起另一个
     实例的身体，不做同身体热切。
  d. Character≠Body 与 37.4 一致。导入器形态（外部格式 → Importer → Lykoi Package，去 scenario /
     first_mes / 生平）与调研稿一致，走 P-D2。
  e. 零成本可先做：fixture 与 `identity.self` 里把「Lykoi」当角色名的地方改掉（记忆已标待改）。

## 三、稿子十条「宪法级原则」对照

| 稿子原则 | 白皮书 / 定案对应 | 状态 |
|---|---|---|
| One mind, many hands | 37.1 星形拓扑；37.3 第二张嘴禁令 | 已 [NORMATIVE] |
| Goal-oriented natural language | 10.1；38 章 | 精神一致 |
| Capability ≠ Permission | 22 章；37.6；L5 铁律 | 已 [NORMATIVE] |
| Thinking freedom, execution governance | 37.6 | 已 [NORMATIVE] |
| Message ≠ Turn ≠ Cognition ≠ Task | 37.3 入站合并/出站分段（前两段） | Task 无对应，v1.3 候选 |
| Conversation ≠ Task execution | 37.5 | 锁定，先过 9.4 重评 |
| Semantic silence ≠ failure | 人格分层硬边界 §2.3 | 范围窄，扩到基础设施失败 = v1.3 候选 |
| Character ≠ Runtime ≠ Body | P-D1 / P-D3；37.4 | 定案在，措辞待改 |
| Personality before language | D-PERS-4；37.7 | 自主路径成立，对话路径三断点 |
| Package ≠ Instance | P-D1 种子 | 定案在，排期待裁 |

## 四、对五阶段排序的修正意见

稿子的排序骨架合理（先交互运行时，再任务与委托，再框架/实例分离，再人格深化，最后 Forge）。修正：

1. **全程前置：产线模型能力基线探针**（第一节第 4 点）。
2. 阶段一保留 ①终局保证 ②Turn Assembler ④ReplyTurn/utterances ⑤通道中性化；③只做「只读认知可中止 +
   pending 队列」，不做后台并行。**提进阶段一**：`promise_followup` 接消费者；对话路径接调节场与
   `情绪脉冲` 回路（三断点）。**移出阶段一**：Topic/Thread（装配策略改动，要影子数据与缓存代价评估）。
3. 阶段二 Task Runtime 前置 9.4 重评 R2 在新体上重做实证；Resolver 建在注册式图式上（M5 切换后）。
4. 阶段三 Package/Instance 需 Kevin 先裁 P-D3 条件是否已触发；`active_instance_id` 改为实例—身体绑定。
5. 阶段四、五不变。

## 五、稿子里要校正的事实

| 稿子说法 | 核查结果 |
|---|---|
| Wake 有 7 个固定 KINDS | 枚举在 `lykoi-decide`，wake/converse/reflow 三处消费；wake 只是消费者 |
| 明确接通的手只有 Browser 与 Telegram | 18 项动作 8 项接真身：browser 3（navigate/get_text/research_read_text）+ Telegram 侧 5；`browser.click/type/screenshot` 未接 |
| Kernel 预留 terminal.exec / delegation.* | 准确，且 delegation 有台账级实现，缺执行器与传输面 |
| LLM deadline 路径已有 AbortSignal 基础 | 准确，且直通 wire |
| interactive-lock 管交互 vs Wake | 准确 |
| JSON parse failed → silence | 用户侧准确；审计层分得开（`u3_cycle_failed` vs `u3_cycle_envelope kind=silence`） |
| 人格最后仍被拼成文本 | 对话路径成立；自主路径上调节场/关切/念头是真控制流 |
| Learned Self 缺 | `narrative_versions` 存在，对话路径生产关着 |
| capability_gap 只是 telemetry | 准确；reason 无 `disabled` 值，`missing` 是 `wanted` 归一值 |
| 副作用只读/可逆/可补偿/不可逆四级（探索稿旧说法） | 代码只有 `reversible: boolean`，四级只在探索文档 |

## 六、本次核查附带发现（不属稿子，候选小单）

1. `情绪脉冲` 回路断：契约要求模型报调节因，解析后零消费者（`contract.ts:342, 834`）。
2. `promise_followup` 生产无消费者（`conversation.ts:1379-1383`），ACK 已发、事不做。
3. `converse/received` 无 runId；converse runId 与 kernel correlationId 无关联字段。
4. relationship overlay 只进对话不进 wake（`wake` 装配无 `RELATIONSHIP_OVERLAY_HEADER` 段）。
5. 角色卡调研稿 7.1「错字修正放发送器」与 37.3「不得增删改一字」相撞，待改口。
6. 设计稿 §3.4「瞬时语气由调节场装配时自然生效」与代码不符。
