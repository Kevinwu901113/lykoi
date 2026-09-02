# 人格分层设计稿 v1（2026-09-01）

- 依据：GPT 二号方案（HDSI 启发的分层人格）对照评估（同日在聊，未单独
  存文，本稿即其归档）+ Kevin 2026-09-01 对 D-PERS-1..4 的裁决"同意"
  （采治理侧建议方向）。
- 地位：治理内部设计正本。工单从本稿摘 goal/scope，不另写设计。

## 0. 四裁定记录（D-PERS-1..4，Kevin 2026-09-01 拍板）

| 裁定 | 内容 | 落地形态 |
|---|---|---|
| D-PERS-1 | 记忆来源类型成一等机制，**认知主线第二单**（第一单=U2 capability_gap） | WO-MEM-SOURCE-01（§4） |
| D-PERS-2 | relationship overlay 立项（人格≠对每个对话者同一张脸） | 排 D-PERS-1 之后 |
| D-PERS-3 | 慢变层（转正洞见）补衰减，对齐调节场宪法三件套 | 排 D-PERS-1 之后 |
| D-PERS-4 | 音色/表达议题**并入人格设计**，不单开线 | 本稿 §3.4 |

## 1. 分层模型 ↔ 现体映射（骨架大半已有，这是评估的主结论）

| 层 | GPT 方案 | 现体对应物 | 差距 |
|---|---|---|---|
| Canon（不可由对话改写） | 稳定身份/价值观 | persona TOML `/home/lykoi/runtime/persona/lykoi_base.toml`，root:root 444 封存，P-D2 出生证 | 无——已比方案更硬（文件系统级封存） |
| 慢变（Perspective/Personality/Relationship） | 缓慢演化的观点与关系 | promotedFocusInsights（rw.ts:2071，S-34 只读 active）——**单通道、无衰减** | ①无 relationship 维度（D-PERS-2）②无衰减（D-PERS-3） |
| 中期（narrative/concern/goal/focus） | 当前关注 | concerns 表 + L4 focus | 基本齐备，不动 |
| 短期（affect + 当下想法） | 情绪与瞬时状态 | 调节场四变量（懒衰减落账，宪法：更新+衰减+因果出口三缺一不许建）+ thoughts（ThoughtKind 五档） | 情绪"原因"已随 RegulationCauseResult.cause 落账，方案要求已满足 |

**装配位置铁律（CACHE-INVERT）**：层的时间尺度决定其在 prompt 装配里的
位置——越稳定越靠前（缓存命中），越易变越靠后。Canon 最前、慢变次之、
中期再次、短期最后。任何新层入装配必须遵守，否则缓存经济学被打穿。

## 2. 硬边界（评估中确认，任何后续单的上位约束）

1. **P-D2**：Canon 是出生证，运行期只读。演化走"新版本 TOML + Kevin
   root 换文件 + hash 重签"的治理路径，永不走她可写的面。
2. **P-D3**：不许出现运行期人格卡切换后门。relationship overlay 是
   **叠加层**（她对不同人的相处方式），不是"换一张人格"。
3. **人格不越治理**：能力缺口必须显式说"我没有这个能力"，不许用人格化
   沉默掩盖——U2 的 capability_gap 事件恰好使这条**可审计**（她每次
   想要而没有，账上都有一笔；若外显行为是沉默而账上无 gap，即违规）。
4. **拒绝 HDSI 式离线补写生平**：Lykoi 是真实主体，经历只能来自真实
   运行。不存在"为丰满人格而生成的往事"。这是与参照系统的根本分界。

## 3. 设计定案

### 3.1 来源类型：第二轴，不是改写第一轴（本稿最重要的结构裁定）

现体 `experiences.source` 是 **CHECK 枚举**（STATE-CONTRACT §1.2 逐字，
rw.ts:83）：`conversation|wake_action|action_result|silence|owner_event|
system|thought_lapse|environment`。这回答的是**渠道**（从哪来）。

GPT 方案的 `observed|executed|user_reported|inferred|imagined|simulated`
回答的是**认识论地位**（该多信、能否当事实引用）。两轴正交：同是
`conversation` 渠道，Kevin 说的话是 `user_reported`，她自己读到的是
`observed`；同是 `thought_lapse`，可以是 `inferred` 也可以是 `imagined`。

**定案**：
- 不动 CHECK 枚举（改它=STATE-CONTRACT 迁移级破坏+撞全部既有读者）。
- 新增 `epistemic` 第二轴列，六值：`observed|executed|user_reported|
  inferred|imagined|simulated`。
- 写入时默认由渠道推导（映射表进 STATE-CONTRACT）：`wake_action/
  action_result→executed`、`owner_event→user_reported`、`silence/
  environment/system→observed`、`thought_lapse→inferred`；`conversation`
  按消息方向劈（对方说的→user_reported，她自己产出→executed）。
  写入方可显式覆盖（如 contemplate 产物标 `imagined`）。
- **晋升铁律**：`imagined|simulated` 永不自动晋升为事实性自传记忆；
  引用它们的装配文本必须带标（"我曾设想过…"而非"我经历过…"）。
  这条要有测试钉死，不是文档约定。
- 存量回填：按渠道映射表批量回填默认值，**不做内容级猜测**（内容级
  重分类=变相编造，违 §2.4）。

### 3.2 relationship overlay（D-PERS-2，后续单）

- 形态：按对话者键控的叠加条目（当前实际只有 Kevin 一个键 + Telegram
  一个通道，结构先立、内容从一开始）。
- 内容：相处方式层面的洞见（"和 Kevin 讨论代码时可以非常技术化"），
  **不含**身份/价值观（那是 Canon 的），不含对话事实（那是 memory 的）。
- 生长路径：走既有 Experience→Learning→候选→验证 的转正通道，复用
  promotedFocusInsights 的机制骨架，加 relationship 维度键。
- 装配位置：慢变层段位（Canon 之后、中期之前）。

### 3.3 慢变层衰减（D-PERS-3，后续单）

转正洞见现状"只进不出"，长期必然膨胀+过时观点滞留。对齐调节场宪法：
**更新规则+衰减规则+因果出口，三缺一不许建**——慢变层当年建的时候缺
了衰减，这次补课：
- 衰减触发：长期未被装配引用/与新洞见冲突时降 status（active→dormant），
  不物理删除（她的历史不销毁，只退出装配）。
- 因果出口：降档必须落事件（带因），可审计可回放。
- 节律：随 L4 整合拍走，不另立时钟。

### 3.4 音色/表达（D-PERS-4，并入本设计，不单开线）

音色=人格的表达面，不是独立子系统。定位：
- 稳定表达倾向（"她本身比较直接"）→ Canon/personality 层的字段；
- 场景化表达（对谁、什么语境）→ relationship overlay 的内容之一；
- 瞬时语气 → 短期层（调节场）已覆盖，装配时自然生效。
- 音频硬边界不变（具身重设计 2026-08-09 定案），本议题只管文字表达。

## 4. WO-MEM-SOURCE-01 章程要点（认知主线第二单，待 Kevin 发派令）

- goal：epistemic 第二轴落地（列+默认映射+显式覆盖+晋升铁律测试+存量
  渠道级回填）。
- scope：lykoi-memory（列与写路径）、STATE-CONTRACT §1.2 增补、写入方
  各调用点补默认推导；红绿测试含"imagined 不得进事实性装配"对照组。
- forbidden：不动 CHECK 枚举既有八值；不做内容级重分类回填；不动
  kernel/gate；prompt sha 不变（装配带标属后续单，本单只立数据轴）。
- 复核要点：STATE-CONTRACT 逐字对照；映射表全渠道覆盖；存量回填
  可回放（迁移脚本入库）。

## 5. 顺序

D-PERS-1（数据轴，本周可派）→ D-PERS-3（衰减，机制补课）→
D-PERS-2（relationship overlay，依赖 1 的轴与 3 的通道骨架）→
装配带标与表达细化（随 overlay 单捎带）。M5 browser 单与本线并行不冲突。

> 改序（Kevin 2026-09-02 裁决）：D-PERS-1、D-PERS-3 已并入 main；**D-PERS-2 排在
> `WO-M5-ORGAN-BROWSER` 之后**（先让她能出门，再给她第二张脸）。其间先走
> `WO-FIX-LOOP-01`（认知回路四处小修）。
