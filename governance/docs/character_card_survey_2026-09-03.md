# 角色卡调研与 Lykoi 借法（2026-09-03）

- 地位：治理内部调研稿，供 Kevin 判断；不是设计定案，不改任何裁定。
- 范围：公开角色卡规范、社区公认写法、实卡样本、持久 Agent 身份文件；
  全部一手来源，末尾列链接。未核实的内容不写进"做法"。
- 2026-09-03 定调（Kevin）：**Lykoi 只是框架名，不是任何一个角色**。谁都能部署 Lykoi，
  再导入或自己培养角色。本稿里"现体 / 她 / 内核 TOML"指 Kevin 自己那个实例的人格内核
  （fixture `lykoi_base.toml`），不是框架；fixture 把 `name = "Lykoi"` 当角色名是待改项。
  由此本稿的任务是两件：框架侧支持导入 CCv2/v3 卡或从零培养；为 Kevin 的实例挑一张
  现成好卡作起点（第 7 节）。
- 上位约束：白皮书 v1.2 第 8 章；[人格分层设计稿 v1](persona_layering_design_v1_2026-09-01.md)
  硬边界 §2；[人格种子备忘](persona_module_and_seed_memo_2026-08-18.md) P-D1～P-D3。

## 0. HDSI 怎么做的（YesWeAreBot/HDSI-AthenaBrain）

Kevin 给的出处：GitHub 组织 YesWeAreBot，仓库 HDSI-AthenaBrain，即 Koishi 插件
`koishi-plugin-hds-interlude`（HDS Interlude，"幕间系统"）v0.1.3，跑在 QQ/OneBot 上。
本次读的是 main@0c9c9b5（2026-08-27）：README、CONFIGURATION_GUIDE、command.md、
docs/ARCHITECTURE / ALTER_SYSTEM / AGENCY_WINDOW、src/types.ts、narrator.ts 的提示词装配、
index.ts 默认值、continuity.ts、relationship.ts。同组织的 athena-harness 自述为
"数字生命运行时内核"，组合基座 Cordis ^4.0.0-rc.8 + AI SDK v7，与 Lykoi 身体同源；
HDSI 是其三种 Cortex 形态里 Narrative / Interlude 形态的独立前身。

设计稿 §2.4 写的"HDSI 式离线补写生平"确有其事（0.1 第三条）；GPT 方案转述的
"情绪惯性"也确有其事，但实现是 Alter System（0.4），与转述的"原因/强度/衰减"不同。

### 0.1 定位

- 不是角色卡，是生活剧本引擎。每个机器人账号一部 Canonical Story，多个用户各有
  participant 记录、关系和投递目标。主模型每回合写一段主角生活的 prose（`script`），
  再决定 `seen` 与 `reply.mode none|immediate|delayed`。固定系统提示原话：用户消息
  "是进入主角生活的一个事件……不取代主角的世界作为场景中心"。
- 角色资料不靠提示词文件，全在 Console 配置 `storyDefaults`：characterName、
  characterProfile、perspective、userProfile、relationship、world、supportingCast、
  location、style、timezone。官方示例的 characterProfile 是一段 100 字左右的自然语言
  （年龄、处境、作息、性格、线上聊天习惯、心态），没有示例对话，没有 PList。
- 四个固定阶段：user-message、conversation-follow-up、intent-due、advance。advance
  是无外部事件时的自动推进，主模型"补写从故事游标到现在已经发生的生活"。

### 0.2 人格分层（按实现，不按转述）

| 层 | 存储 | 谁能改 | 进提示词的方式 |
|---|---|---|---|
| Canon（`setting.character.profile` 等） | 配置 | 只有显式改配置 | 每回合 `setting` 原样进 payload |
| Perspective（`setting.perspective`） | 配置 | 同上 | 截 1,200 字；系统提示："独立于 Canon 的外壳人格层，当作既定个人事实，只在自然相关时影响选择；不是主题、道德审查、逐项清单" |
| Overlay（`state.settingOverlay.character/perspective/world`，参与者 `relationshipOverlay`） | 状态 | 只经 StatePatchProposal 由宿主转正 | "稳定 overlay 是反复证据后的现状，与旧基线明显冲突时优先" |
| 近期关系笔记、continuity.salient | 状态 | 压缩模型 | "描述当前倾向或临时效应，影响行为但不改写人格" |
| active-consequence | intent 表 | 主模型自建自结 | "具体、临时，不是永久人格标签" |
| Alter emotionalOffset | 状态 | 侧端模型 | 一段带方向/强度/权重的氛围参考 |

固定一句：A single mood, reply, or unusual event does not change canon or stable overlay。
不同于 Lykoi 的 Canon 封印，HDSI 的 Canon 是普通配置项，改完用 `interlude.overlay.clear
<character|perspective|relationship|world|all>` 清对应 overlay（y/n 确认），不动剧本与记忆。

### 0.3 演化门槛（证据化，全是数字）

- 压缩模型只能提议 statePatch：target、path、proposedValue、evidence、confidence、
  impact minor|major、sourceEntryIds。同一 target/path/proposedValue 再次观察到时
  "保持相同以便宿主累积证据"。
- 宿主转正默认值（index.ts）：confidence ≥ 0.82（major ≥ 0.95）、≥ 3 个不同剧本回合、
  跨 ≥ 2 个日历日（major 不受此限）、同路径 72 小时冷却；`autoApplyStatePatches` 与
  `allowMajorStateChanges` 可关。提案生命周期 proposed → applied → compacted，另有
  rejected / cleared。
- 已应用的 patch 定期合并成 OverlaySnapshot（tier 名 weekly/monthly，实际窗口 5 天 / 10 天，
  含 summary、majorEvents、sourcePatchIds，status active|superseded），原 patch 不删只标
  compacted，live overlay 重建后进主模型。
- 参与者级 ParticipantState 另有 openThreads、relationshipNotes、relationshipOverlay；
  RelationshipMoment 是带 expiresAt 的短期关系态（characterPosition、
  communicationPosture、openNeed、alreadyExpressed、intensity），
  userSignal 必须带 evidenceIds 与 basis observed-expression|character-inference|shared-event。

### 0.4 Alter System（它的"情绪惯性"）

- 主模型每回合返回整数 `alter` −5..+5，只打本轮新事件带来的净氛围变化（正=更严肃收敛，
  负=更轻松活跃），明文禁止把已注入的 emotionalOffset 当作重复打分依据。
- 累计值达到动态阈值（base 10，按最近一小时回合密度降到 7）时，侧端模型读最近十段
  script 写一段 `description`；方向由累计值定，强度 = min(|累计|/阈值, 2)。
- 权重：同向 +0.05×|alter|，反向 −0.15×|alter|，限 0..1；低于 0.2 清除。注入主模型的
  只有 {direction, description, intensity, weight}，累计值与历史被剥掉"避免自我强化"。
- 侧端描述"不得包含姓名、引用或私聊细节"；分析不阻塞可见回复，失败不伪造。

### 0.5 Agency Window 与主动联系

- 状态只有三个枚举：activityLoad free|occupied|overloaded、privacy private|shared|public、
  deviceAccess available|limited|unavailable，加有效期与来源条目；不描述情绪，不读 Alter。
- 主动联系链：先写主角生活 → 生活产生联系理由（origin life-event|promise|
  practical-update|relationship-follow-up）→ 查日程/隐私/设备/willingness/最小间隔 →
  send-now | recheck-later | let-go。原话："用户长时间沉默本身不能成为联系理由。"
- recheck-later 只存 motive 与约束，"不保存预写消息"，到期重读当前生活再裁决。
- 容量矩阵：设备不可用、日程过载、私人内容且环境不私密 → 不立即发；普通忙碌只允许
  承诺或实际安排突破；承诺可绕过最小间隔。

### 0.6 其他值得记的机制

- ContinuitySnapshot {current, next, recent, salient} 低频刷新，带 ageMinutes；
  系统提示明说"可能过期，当最后已知状态，不当当前时钟"。时间以 `interval.nowLocal`
  为准，旧剧本里的"夜晚"不算数。
- `<sep/>` 分段回复，首段即发、后段模拟输入；首条回复提交前新消息可作废整轮，
  提交后取消未发段并作为 interruptedOutgoingDrafts 送入下轮，"绝不视为已说出口"。
- 反重复：Dice 系数比对上一段 script（≥ 0.82）与最近 12 轮回复（≥ 0.86），命中只要求
  改写一次，不本地过滤。
- 禁止伪造外部事件："never invent an incoming message, a phone vibration, a notification"。
- 版本血统写在 CHANGELOG：sceneTrace、sceneState、storyHook、logicalTurn、
  relationshipMoment 已回滚（ARCHITECTURE 明说不属于当前架构，代码残留）。

### 0.7 对 Lykoi：能借的与不能借的

能借（都在设计稿硬边界之内）：

- **转正门槛数字化。** Lykoi 影子闸转正与关系 overlay（D-PERS-2）目前没有明写
  "几个回合、几个日期、冷却多久"。HDSI 的 0.82 / ≥3 回合 / ≥2 日 / 72h 是可核实的
  运行过的默认值，可作起点。
- **提案与转正分离，原提案不删。** proposed → applied → compacted 与
  OverlaySnapshot active|superseded，同 3.8 条 USER.md 纪律，可与 S4 合并。
- **Perspective 作为独立层的措辞。** "既定个人事实，只在自然相关时影响，不是清单"
  这句对 Lykoi 的 personality.traits 注入同样适用，胜过"你必须表现出以下特质"。
- **一句话定 Canon 边界。** "单次情绪、单条回复、单个异常事件不改 Canon 与稳定 overlay"
  可直接进 Lykoi 的装配器固定句。
- **主动联系的理由与容量分开。** origin 枚举 + send-now/recheck-later/let-go +
  "沉默不是理由" + "不预写消息"，与白皮书"沉默是动作"和自主唤醒一致，比现在的
  唤醒判据更具体。
- **seen / reply none 的显式结构。** 看见但不回是合法输出，与 Lykoi "沉默是动作" 同构。

不能借（与硬边界冲突）：

- **advance 补写生活。** 正是 §2.4 拒绝的离线补写生平；Lykoi 独处时做的是真实的事
  （看帖、发展兴趣），不是叙事。
- **Canon 可改配置 + overlay.clear。** Lykoi Canon 封印 root:root 444，只走 P-D2。
- **Alter 的文本 emotionalOffset。** 它是给叙事模型的氛围参考，Lykoi 调节场是四变量
  数值宪法；ZifaMem 实测情绪文本块对部分模型有害（第 4 节）。可借的只有它的
  防自我强化做法：注入物不含累计值与历史。
- **supportingCast / world / style。** 虚构配角与世界，白皮书 8.2 排除。

## 1. 调研对象

| 类别 | 对象 | 性质 |
|---|---|---|
| 规范 | Character Card V2 / V3（kwaroran） | 社区事实标准，SillyTavern / RisuAI / Chub 通用 |
| 规范 | SillyTavern 官方 Character Design 文档 | 前端作者的字段解释与 token 预算警告 |
| 规范 | Character.AI Character Book | 平台官方：Definition 上限 32,000 字符，重要内容放最前 |
| 写法 | Trappu《PList + Ali:Chat》（PygmalionAI Wiki） | 社区公认最有效的两种写法及其组合 |
| 写法 | AliCat《Ali:Chat Style v1.5》 | 示例对话法原作者 |
| 写法 | World Info Encyclopedia | 世界书/lorebook 写法 |
| 实卡 | SillyTavern 默认卡 Seraphina | ST 官方角色卡评选 roleplay 组获奖，从 PNG tEXt 块解出原 JSON |
| 中文社区 | vocus《AI 同人角色卡創作 基礎人設篇》 | 四层结构、性格建立在矛盾上、OOC 禁区 |
| 中文社区 | 类脑 Discord（linux.do 入门指北引用） | 最大中文角色卡社区，本稿未取其卡 |
| Agent 身份文件 | OpenClaw SOUL.md / IDENTITY.md / USER.md 模板原文 | 持久个人 Agent 的身份分文件做法 |
| Agent 身份文件 | SoulSpec v0.5 | SOUL.md 的打包规范，含 examples.good / examples.bad |
| Agent 身份文件 | Letta persona / human block | 记忆块式人格，Agent 自编辑 |
| Agent 身份文件 | OpenPersona（persona.json + state.json） | 中文开源，四层五系统三门禁；仅见文章，未读代码 |
| 论文 | ZifaMem（arXiv 2607.17564） | AI 陪伴的结构化记忆与情绪连续性实测 |

## 2. 角色卡字段（CCv3 全表）

| 字段 | 用途 | 备注 |
|---|---|---|
| name / nickname | 名字；nickname 替换 `{{char}}` | 名字自带先验（Trappu "name bias"） |
| description | 主体：背景、外貌、性格；永驻上下文 | 好卡把 PList 与示例对话都放这里 |
| personality | 性格摘要 | 实卡常留空，并入 description |
| scenario | 当前情境与关系 | 角色扮演专用 |
| first_mes / alternate_greetings / group_only_greetings | 开场白 | ST 文档：模型最容易从开场白学到风格与长度 |
| mes_example | 示例对话，`<START>` 分块，`{{user}}:` / `{{char}}:` | 上下文满时先被挤出 |
| system_prompt / post_history_instructions | 覆盖系统提示；历史之后的指令 | 后者近似 Author's Note depth 0 |
| character_book | 内嵌 lorebook：keys / content / constant / selective / insertion_order / @@decorator | 关键词触发注入 |
| creator_notes（+multilingual） | 给使用者看的说明 | 规范要求"非常显眼" |
| tags / creator / character_version / source | 元数据 | tags 不进 prompt |
| creation_date / modification_date | Unix 秒 | 规范：用户不可编辑 |
| assets | 头像、背景、表情图 | |
| extensions | 应用私有数据 | |

宏：`{{char}}` `{{user}}` `{{random:}}` `{{pick:}}` `{{roll:}}` `{{//}}` `{{hidden_key:}}` `{{comment:}}`。

## 3. 人家做得好的地方（可迁移）

每条注明来源；"→"后是与 Lykoi 现体的对应。

1. **示例对话强于形容词。** Ali:Chat 原则：用对话与动作表达特质，不用标签。
   ST 文档：模型从开场白学风格与长度，胜过任何其他字段。Seraphina 实卡印证：
   description 只有一个 PList 词表加两段访谈式示例对话，personality / scenario /
   mes_example 三个字段全部为空。
   → 现体内核 TOML 五段（identity / voice / relationship / personality / interests）
   没有任何她口吻的语料；`voice.register` 是描述句。

2. **性格写成行为，不写形容词。** ST 社区："她用幽默挡开夸奖，先问对方近况再说自己"
   优于 "kind"。vocus：价值观必须绑具体行为（"朋友性命优先于任务"）。OpenClaw
   指南："Be helpful" 无效，"Bias toward giving me the answer, not teaching me how
   to find it" 有效。vocus：立体感建立在矛盾特质上，避免贴标签。
   → 现体 `personality.traits` 五条已是行为句，方向对；`voice.register` 也是。

3. **OOC 禁区与破格条件。** vocus：写角色绝不做的事，并说明合理的破格条件与代价。
   OpenClaw SOUL.md 有独立 Boundaries 段。SoulSpec 要求 examples.bad（反例校准），
   理由是"坏例子防常见失败模式"。
   → 现体没有"她绝不…"段；纪律散在治理侧，不在人格面。

4. **语料限量并标注用途。** vocus：3–5 句代表性台词即可，标注"仅供风格参考，严禁
   逐字照搬"。Ali:Chat 警告 leaking：用户输入贴近示例时模型会逐字复读；动词不重复
   （"smiling"用一次）。Trappu：一条写好的 150 token 示例足够，两条保证有效，
   多了反而难保一致。

5. **不替对方说话。** Trappu：示例对话里若角色描述了用户的动作，模型就学会替用户
   说话。SOUL.md 模板："You're not the user's voice — be careful in group chats."
   → 对应白皮书 6.4 群聊脱敏与单主用户模型，写进人格面比只放治理规则更贴近生成。

6. **上下文位置决定强度。** Trappu：越靠底越强，description 顶部会随对话变弱；
   PList 放 Author's Note 深度 4 最有效；指令放深度 0。
   → 与 CACHE-INVERT 铁律方向相反：角色卡界把重要内容沉底是为了影响力，
   Lykoi 稳定内容靠前是为了缓存。两者不冲突：Canon 在前缀，调节场与思绪在底部，
   底部本来就承担"深度 4 注记"的角色。要做的只是确认底部块里有拉回人格的锚
   （Trappu 的经验：底部一小段词表能把顶部示例"拉"回相关）。

7. **内在 / 外显 / 对方三分文件。** OpenClaw：SOUL.md（内在人格与边界）、
   IDENTITY.md（名字、形象、vibe，用户所见）、USER.md（对方）。Letta：persona 块
   与 human 块分离，Agent 自编辑，靠块的 description 决定怎么读写。
   → 与 Canon / relationship overlay / 用户记忆分层一致，已落地（D-PERS-2）。

8. **USER.md 的条目纪律。** 每条以 Always / Never / Prefer 开头；带
   `observed: 日期 | status: active|superseded`；偏好变化时把旧条标 superseded 并
   原地改写，不追加矛盾条目。
   → 可直接借给 relationship overlay 条目与慢变层衰减（D-PERS-3）。

9. **元数据与版本。** CCv3 有 creator / character_version / creation_date /
   modification_date / source，后三者用户不可编辑。SOUL.md 模板："If you change
   this file, tell the user — it's your soul, and they should know."
   → 对应白皮书 8.4 所有者修改留痕、8.5 人格版本、P-D2 出生证 hash。

10. **名字偏置。** Trappu：名字本身携带先验（姓氏、称号）。
    → Lykoi 是猫种名，模型先验带"猫"味；`identity.self` 目前未处理这一点，
    是否要明说由 Kevin 定。

11. **Lorebook 的取舍。** 关键词触发、constant / conditional、深度、递归、预算 25%。
    → 现体 L1–L4 记忆与装配器覆盖同一职能且更强，不需要卡式 lorebook。

## 4. 要躲开的（角色卡目的与 Lykoi 相反之处）

- **虚构生平撑人格。** Seraphina 全靠"森林守护者、治愈你的伤"叙事。白皮书 8.2
  "初始人格不是虚构经历"；设计稿硬边界 §2.4 拒绝离线补写生平。
- **"永远这样"的守人设约束。** 卡的目标是让扮演模型不脱离人设；Lykoi 的慢变层要能长。
- **scenario / first_mes。** 她没有开场白，在真实时间线里。
- **运行时换卡。** P-D3 已否决。
- **情绪文本块注入。** ZifaMem 实测：注入 emotion block 对 Claude 略有帮助、对 Gemini
  显著有害（−0.346）；结构化记忆存在时差异消失；其二阶"情绪惯性"模型未通过机械验证
  （L∞ 误差 0.335）。"情绪线索（多轮）胜过快照"（+0.395）。
  → 调节场四变量宪法（更新 + 衰减 + 因果出口）方向正确；不要再加"情绪块"文本。
  HDSI 的 Alter System 正是这种文本块（0.4），它用于叙事模型的氛围参考，
  不是 Lykoi 的情绪状态；只借其"注入物不含累计值与历史"的防自我强化做法。
- **形容词堆砌。** Seraphina 的 PList 是 22 个形容词（"graceful" 出现两次），
  当年是获奖写法，但与本稿第 3.2 条社区共识相反；不照抄。

## 5. 现体对照

| 内核 TOML 字段 | 角色卡对应 | 状态 |
|---|---|---|
| identity.self / embodiment | description 首句 | 有 |
| voice.register / language / emoji / address_owner | personality 中的说话方式 | 有，描述句 |
| relationship.stance / owner_authority | scenario 的关系部分 | 有 |
| personality.traits | PList persona | 有，行为句 |
| interests.seeds | PList likes | 有 |
| （无） | mes_example / Ali:Chat 语料 | 缺 |
| （无） | Boundaries / OOC 禁区 / examples.bad | 缺 |
| （无） | creator_notes / character_version / dates | 缺（出生证 hash 与 8.5 revision 承担一部分） |

装配：`buildPersonaKernel` 九段拼装是字节级契约（fixture chars=401、sha256 锚），
增字段必须同步测试锚；改 Canon 只走 P-D2 路径。

## 6. 建议（待 Kevin 判断，不是定案）

- **S1 语料段。** 内核 TOML 增 `[voice]` 下 3–5 条她口吻的短句（含对 Kevin 的口吻），
  访谈式而非可套用对白，注明"风格参考，不逐字"。进 Canon（稳定，吃缓存）。
  风险：leaking；缓解见第 3.4 条。
- **S2 边界段。** 增 `[boundaries]`：她绝不做的事（不替 Kevin 说话；能力缺口不用
  沉默掩盖；群聊三级脱敏），以及破格条件（仅 Kevin 授权）。这些已是纪律，写进人格面
  是让生成侧看得见。
- **S3 保持行为化写法。** traits 与 register 不退回形容词。
- **S4 overlay 条目纪律。** relationship overlay 与转正洞见采用 observed 日期 +
  active / superseded，不追加矛盾条目；与 D-PERS-3 衰减对齐。
- **S5 可读快照。** 从 TOML 导出 CCv3 兼容 JSON（含 creator_notes、character_version、
  creation_date）作为 Kevin 阅读用快照，可用现成编辑器打开；不作运行时格式，
  不引入 scenario / first_mes。
- **S6 不采纳。** lorebook、情绪文本块、虚构往事、运行时换卡、HDSI 式 advance 补写生活。
- **S7 转正门槛数字化。** 影子闸转正与关系 overlay 明写置信度、最少回合数、最少跨日数、
  同路径冷却，起点取 HDSI 默认值（0.82 / 3 / 2 / 72h），提案不删只标状态（0.7）。
- **S8 装配器固定句。** 加两句：Canon 边界句（单次情绪/回复/异常事件不改 Canon 与
  稳定 overlay）；特质注入句（既定个人事实，自然相关时才影响，不是清单）。

## 7. 候选卡（给 Kevin 挑，2026-09-03）

全部从 chub.ai 公开 API 取回原文（scratchpad `cards-en/`、`cards-cn/`、`cards-cn2/` 的 `*_raw.json`），
逐字呈现在候选页（https://claude.ai/code/artifact/65a92f95-914b-43e9-a8fc-f29ff493efe3 ）；下表只列结论。

### 7.1 第二轮：中文、像人、单个事件多条消息

要求来自 Kevin 当日下午。chub 上没有"女性、日常、SFW、自带多条消息规则"的现成卡；多条消息规则写得最好的
两张是男性角色，且都是类脑 / 旅程社区"手机聊天"lorebook 模板的实例
（格式 `[和X的聊天]` + `[对方消息|头像|内容|时间]` + `[我方消息|内容|时间]` + `<bqb>` 表情包单独成条；
cardmarket.lucymm.net 上的 季淮 用同一模板，作旁证）。结论是拆层借用，不整卡导入。

| 卡 | 性别 / 设定 | 星 / 对话 | 多条消息规则（原文位置） | 可借的层 |
|---|---|---|---|---|
| 方亦楷（WOSHINIDIE，2025-03） | 男，2016 年高二，小天才电话手表 | 91 / 9 | lorebook"回复"：平时 1-7 条，禁止条数固定，首条不固定语气词/表情包；"线上人设"：容易打错字则紧跟一条修正、会单发"？""。。。。""！！！"、一般不带句号 | 这两条 lorebook 整段 |
| 陆觉明（hidden_craft_5750，2025-05） | 男，lnk 主播，微信名"小明" | 30 / 1 | "回复"同上；"线上人设（小明）"：平时 5-10 条，激动 15 条左右，最多不超过 20 | "回复""不许油腻不许ooc""对user态度"；语音/视频通话、朋友圈、动态 12 条媒介入口可映射到 Telegram |
| 林晓晚（stupid_game_71591，2026-04） | 女，十年闺蜜，灵异恐怖 | 29 / 8 | mes_example 直接是微信多气泡（每条"晚晚："前缀，"（停一下）""（过了一会儿）"标停顿）；system_prompt：每条回复 150-250 字、微信口语化 | 只借格式层与"沉默/敷衍触发""多媒介交互模拟"两条 lorebook；设定层（角色已死）不要 |
| 叶瑾夜（enchanting_manager_2240，2025-02） | 女，16 岁，上海高一 | 27 / 1 | 无：每回合先输出日期时间星期，再一条约 50 字 | 只借节律句：真实地点天气、到点会饿半夜会困、回复慢会抱怨、语音 50% 概率 |

实现侧参照：The-Veridis-Lion/ST_Character_Wechat（main@282880b，2026-05-21）
`src/adapters/channel/weixin/index.js`，拆条在出口做：按换行切、相邻两段都短于 20 字则合并、
每条气泡延迟按字数算（最小 1.2 s）加抖动、去句尾句号、至少 2 条。对 Lykoi 的含义：条数、间隔、
错字修正、标点单发放在 Telegram 发送器，人格层仍按 7.2 的 Kit Delaney 或自行培养。

未取到全文：类脑 Discord、DZMM、AI风月、Rubii 上的女性日常聊天卡（doki.love 索引到
"万能微信聊天"、裴芥、江诗琪、禾禾）只有摘要，需账号；chub 中文"聊天 / 微信 / 消息 / 手机"
搜索前 40 条中女性角色多为 NSFW 或模拟器，已剔除。

### 7.2 第一轮：英文候选

| 卡 | 语言 | 星 / 对话 | 非空字段 | 结论 |
|---|---|---|---|---|
| Kit Delaney（AccidentalAngel，2026-05） | en | 29 / 82 | description、personality、scenario、first_mes、mes_example、system_prompt、PHI、3 备选开场、2 条 lorebook | 首选。mes_example 是短信体；关心=计划与跟进、一次只给一件事、记得你说过的话回头问；PHI 禁止她拥有不存在的权限；无浪漫线 |
| Wren（同作者） | en | 10 / 49 | 同上（3 条 lorebook） | 关心写法最好（"不问你好不好，先烧水"），但叙事体，要改成消息体 |
| 荣格（litinan，2023-10） | zh | 317 / 110 | personality、first_mes、mes_example、system_prompt、PHI | 中文侧唯一取到完整原文且有章法的：语录当台词、明确"不能表白只能暗示"的边界；姐弟+医患设定与衣着清单要大改 |
| Gwen Petra Talis | en | 153 / 160 | description、personality、scenario、first_mes、mes_example | 唯一自认 AI 的卡，只借"我是 AI 且不演戏"这一层 |
| Alice（Anonymous，2023-09） | en | 3185 / 4824 | personality、scenario、first_mes | chub 陪伴类最热门；PList + 形容词，与 3.2 条相反，仅作热度参照 |
| Constance Blackwood | en | 697 / 1206 | description(HTML)、personality、first_mes、PHI | 心理医生卡，对照用 |

中文侧事实：类脑 Discord 进不去；linux.do 被 Cloudflare 挡；DZMM / AI风月 / Rubii 等
Telegram bot 与付费 App 只给摘要；GitHub"类脑整理"合集（hobbyL/39AI、
leigegehaha/sillytavernassets）与 chub 中文卡以 NSFW / NTR 为主（chub 中文"女友"搜索
前 40 条只有 1 张不是）。要看类脑名卡需 Kevin 用自己账号下 PNG。

导入任何一张都要去掉 scenario / first_mes / 虚构生平（白皮书 8.2），只保留行为句、
边界句与语料，再走 P-D2 封印。

### 7.3 第三轮：公开免费的酒馆卡来源

要求来自 Kevin 当日晚。前两轮的 chub 卡本身就是酒馆卡（chara_card_v2/v3 PNG/JSON，SillyTavern 直接导入）。
本轮逐一实测公开免费来源，取回的 PNG 与解出的 JSON 在 scratchpad `st/png/`，foreverse 仓库克隆在 `st/fv/`。

| 来源 | 规模 | 免费拿全文 | 中文 SFW 日常聊天卡 | 实测 |
|---|---|---|---|---|
| chub.ai | 公开 API | 能 | 少 | 见 7.1 / 7.2 |
| foreverse-app/character-card-skills（GitHub，main@dab0da4，2026-07-26） | 12 中文 + 6 英文原创卡，CC BY 4.0 | 能（v3 PNG + v2 JSON + card.md） | 唐团团 1 张 | 12 张 PNG 全部解出 ccv3 |
| cardmarket.lucymm.net | 约 10027 张 | 能看单卡页与 PNG | SFW 文件夹 3 张英文 | 浏览器被拒、curl 被重定向，站内搜索参数未找到 |
| cards.sillytavern.one（SillyTavern Pro） | 自称 33k-40k 张 | 不能 | 未知 | 接口返回 LOGIN_REQUIRED |
| leigegehaha/sillytavernassets | 3283 张 PNG | 能下 | NSFW 为主 | 抽取 11 张，first_mes 全被替换为 deepseektavern.com 广告（署"——作者 磊哥哥网络获取"），不可用 |
| hobbyL/39AI | 59 张 PNG，CC BY-NC-ND | 能下 | NSFW / RPG | 无日常聊天卡 |
| doki.love / 类脑 Discord / DZMM / AI风月 / Rubii | — | 不能 | 有索引 | 需账号 |

唐团团（foreverse，标签 BG/都市/单人/甜妹/元气/邻家/日常/治愈，仓库评分器 89.9）是本轮唯一
"女性、日常、SFW、中文、可下载、未被动过"的卡。像人的规则在 system_prompt：每轮 60-150 字、碎句多语气词多、
旁白只写可观察物理事实、认知边界（只能从他买的面包猜，猜错就认）、被冒犯会真生气、阴天点到即收禁卖惨、
禁用词表、元气不等于恋爱脑。无多条消息规则（线下叙事卡）。

同仓库把"多条消息"写成明文的位置（行号对 main@dab0da4）：
`skills/character-card-author/genres/genre-f-wanglian-dianjing.md` 第 21 行（IM 符号体系与符号情绪辞典入世界书）、
第 85 行（线上系统：消息碎片化连发、错字不改追加更正、撤回高频）、第 218 行（每条完整句+句号是邮件不是微信，
「等下」「打完这把」「马上」三条连发才是真人）、第 257 行（线上台词按 IM 碎片化写，typing 三点气泡 + 分条节奏播放）；
`SKILL.md` 第 106-107 行（碎句律、挤牙膏律）、第 295 行（时间感知：把消息间隔当情绪数据）；
`examples/card-yuchi.md` 第 22-26、128-129、136 行（线上语言指纹、$线上聊天 每次至少 4 条）；
`examples/card-luchengfeng.md` 第 4 行 system_prompt【符号辞典】【输出节奏】与第 137-138 行 lorebook 符号情绪辞典
（秒回=日常；隔 10 分钟以上且无标点=训练中或情绪不佳；句号结尾=认真；「。」单发=生气）。

对 Lykoi：人格层借唐团团的 personality 语言指纹与 system_prompt 的认知边界 / 输出节奏 / 负面规则；
消息层用 7.1 的条数规则加陆沉锋式符号辞典，放 Telegram 发送器；导入去掉生平 / scenario / first_mes / 好感度分级
（白皮书 8.2），走 P-D2。

> 2026-09-04 改口（主治理 Agent，依 Kevin 裁定 R-A～R-D 批次）：上句"放 Telegram 发送器"与白皮书 37.3（集线器与传输不得增删改一字）相撞。改为：发送器只按通道上限拆包，逐字；条数节奏、符号辞典、"打错字紧跟一条修正"这类规则属信封产生侧，形态是 `utterances[]`（WO-UTTER-01 / A4），由模型在信封里直接产出多条，不由发送器加工。7.1 表中"可借的层"照旧，落点从发送器改为信封契约。

## 来源

- HDSI-AthenaBrain（HDS Interlude，main@0c9c9b5，2026-08-27）：https://github.com/YesWeAreBot/HDSI-AthenaBrain ；docs/ARCHITECTURE.md、docs/ALTER_SYSTEM.md、docs/AGENCY_WINDOW.md、CONFIGURATION_GUIDE.md、command.md、src/index.ts、src/narrator.ts、src/types.ts
- athena-harness（Cordis v4 数字生命内核）：https://github.com/YesWeAreBot/athena-harness
- CCv3 规范：https://github.com/kwaroran/character-card-spec-v3/blob/main/SPEC_V3.md
- SillyTavern Character Design：https://docs.sillytavern.app/usage/core-concepts/characterdesign/
- Character.AI Definition：https://book.character.ai/character-guide/character-attributes/definition.md
- Trappu 写作指南：https://wikia.schneedc.com/bot-creation/trappu/creation ；导论：https://wikia.schneedc.com/bot-creation/trappu/introduction
- Ali:Chat v1.5：https://rentry.org/alichat
- World Info Encyclopedia：https://rentry.co/world-info-encyclopedia
- Seraphina 默认卡：https://raw.githubusercontent.com/SillyTavern/SillyTavern/release/default/content/default_Seraphina.png
- vocus 教学：https://vocus.cc/article/6986d0a5fd8978000178a1a7
- linux.do 入门指北（类脑社区指引）：https://linux.do/t/topic/223253
- OpenClaw 模板：https://raw.githubusercontent.com/openclaw/openclaw/main/docs/reference/templates/SOUL.md（IDENTITY.md、USER.md 同目录）
- 中文候选卡（chub.ai，2026-09-03 取回）：方亦楷 https://chub.ai/characters/WOSHINIDIE/fang-yi-kai-2896f991e4f3 ；陆觉明 https://chub.ai/characters/hidden_craft_5750/lu-jue-ming-34585c6c6d43 ；林晓晚 https://chub.ai/characters/stupid_game_71591/lin-xiaowan-27788ce229d8 ；叶瑾夜 https://chub.ai/characters/enchanting_manager_2240/xie-jin-ye-5bf3b97efba5
- 同模板旁证 季淮：https://cardmarket.lucymm.net/card/yvMdb7Zaiqky
- ST_Character_Wechat（拆气泡实现）：https://github.com/The-Veridis-Lion/ST_Character_Wechat
- foreverse-app/character-card-skills（酒馆卡 + 写卡 skill，CC BY 4.0）：https://github.com/foreverse-app/character-card-skills ；唐团团 cards/zh/tangtuantuan/
- SillyTavern Pro 卡库（需登录）：https://cards.sillytavern.one
- Card Quest Market：https://cardmarket.lucymm.net
- 类脑镜像（已篡改，仅记录）：https://github.com/leigegehaha/sillytavernassets ；https://github.com/hobbyL/39AI
- OpenClaw 身份架构解读：https://www.mmntm.net/articles/openclaw-identity-architecture ；SOUL.md 写法：https://learnopenclaw.com/core-concepts/soul-md
- SoulSpec v0.5：https://github.com/clawsouls/soulspec/blob/main/soul-spec-v0.5.md
- Letta memory blocks：https://docs.letta.com/guides/agents/memory-blocks
- OpenPersona 介绍：https://blog.csdn.net/weixin_42554162/article/details/160775789
- ZifaMem：https://arxiv.org/html/2607.17564v1
