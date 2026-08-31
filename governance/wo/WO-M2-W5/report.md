# WO-M2-W5 · 身份与对话收口 · 执行报告（治理侧存档）——**M2 五波全落**

- 执行：Mac 本地 Agent（首派开工即撞 session limit 零遗产，重置后原单重派单次过）；
  产物 commit：lykoi-cordis `7d44f15`（基 24a9dd0）+ 蓝图追认清单收口版 `6a8959e`
- 复核：独立复跑双口径——devstate 注入 **433/433 全绿**、未注入 **422 pass + 11 skip
  零 fail**（执行方自报 421 系差一算术小误，无实质）+ tsc 净；golden devstate mtime
  全等 1787510320；包改名 converse-min→converse 树面干净；**ENVELOPE sha 双向钉抽查**
  =反向恢复测试真实存在（恢复 D-02①/D-03 两处后 sha 必须==活体旧值 `9d4f169e…`，
  钉死"其余逐字"）；D-01 只对 not_json 重试（conversation.ts:807）；persona 头唯一消费
  promotedFocusInsights() 带反 listFocusInsights 注释；种子幂等含 released（SA-166 强
  形态）；conversationTurnReflow 摘要模板+80 码点裁剪与 reflow.py:294-310 逐字全等；
  cordis.yml converse 默认 disabled（启用=治理侧动作，需可写 state 副本+persona TOML）
  ——**PASS**

## 交付

1. **lykoi-converse（converse-min 演进改名，理由=包名是插件树公开身份）**：真装配器
   三段十二块（S-23..S-33：稳定前缀失效印记跨进程/persona 头五层/转正结论=
   promotedFocusInsights 唯一消费口 shadow-contested 红测不进/L3 每轮探针零 LLM/
   软窗摘要锁外跑/硬预算三层/DSML 读侧卫生/undelivered 只读不标）+ 信封周期
   （S-35..S-47：词汇表/护栏零重写全继承/两消毒器/六归因/隐私口径/回执背书探针真值表）
   + 回合骨架（S-12..S-21：双锁/整轮回滚/finally 清召回/恰一 history）。**切换语义归宿：
   新体生而信封**，S-48..51/53 结构性成立（无开关因为无第二条路）；S-52 json 钮独立保留。
2. **G-10 八条全落 = U3 两缺陷出生规格消灭**：D-01 有界重试一次仅 not_json+失败事件带
   attempts/finish_reason/completion_tokens/other_message_keys 等全非内容元数据（缺陷①
   ="thinking 吃掉 content"那张脸直接可读）；D-02 工具白名单三面夹死（契约列名+运行时
   cycle_unknown_tool 大声+类型枚举，缺陷②断点 1）；D-03 u3_cycle_tool_demoted 独立
   事件（断点 2）；D-04 空 reply 不加横幅；D-05 surfaced 移周期成立后（重试轮装配一致）；
   D-06 M1 已落核对成立；D-07 Exemption 类+E3 豁免类立好（投递线本体归 M3）；D-08 事件
   流零正文（inner_outer_pair 改形=长度/哈希，e2e 三路逐事件断言）。
3. **persona/organs/restart/种子**（SA-154..168）：TOML 装载面（严格子集解析器零新依赖，
   fixture 装载→内核 sha 1f5960b7 全等；装载失败姿态逐字）；种子=出生证（released 永不
   重种红测；seedConcerns 不挂启动=owner 显式步骤）；restart 三句模板+四档 downtime+
   严格大于未处理判定，对话/自主两侧消费接线（第一拍浮出第二拍消化红测）；organs 登记
   处读面（channel_key 返回形状物理不存在+缓存 invalidate 零读+两侧同源 G-7 收口）。
4. **conversationTurnReflow**（W3#2 销）：逐字迁+contact_answered 唯一写入点只接不改+
   对话轮/自主拍写集对拍分立。
5. **端到端 golden 全链**：全插件栈三路（成功/失败/沉默）事件序红测+全链隐私断言；
   npm start 冒烟通过。

## sha 对拍与追认

模板 sha 17 条旧=新（SYSTEM/SUMMARIZE/CYCLE_CLOSING/_PULSE_CAUSES/装配块 13 条/persona
内核）；**唯一变更=ENVELOPE raw 1677 `9d4f169e…`→1748 `88587c8e…`**（G-10 出生修正恰
两处，反向恢复钉其余逐字）——入追认清单第 5 条。ASK_FALLBACK 未迁（归 M3 审批器官）。
**追认清单 M2 收口版已入蓝图**（lykoi-cordis@6a8959e，七条+遗留总账指针）。

## TODO 销账与遗留

认领四条：W3#2 销、W4#2 销、W2#2 部分销（restart 接权威源；approval/notifs/proactive
留 M3）、W4#3 判定=archive_search 归 console 留 M3（refsrc 零调用者实证）。
**M2 收口遗留总账 14 项全数归 M3**（kernel dispatch 真身/审批器官 S-54..68/建议问答侧/
出站器官+D-07 投递线/LLM adapter 面 vision+response_format+超时容纳重试/interactive_lock/
self-state/restart 生产采集器/快照三读数/生产配置入 cordis.yml/kernel notifications/
S-08 路由消费位/tool_calls wire 原生映射/活体 persona TOML sha 重算 DA-11）。

## 偏离蓝图

零。适配七处注释留痕（TOML 子集解析器/restart 线索入参化/生而信封说明/classifyFailure
等价档/包改名授权内/limits 测试面/对话轮写集含 W4 既有同事务层叠）。

## M2 状态

**五波全落**：W1 `9b1591b`（126）→ W2 `0d267b2`（222）→ W3 `5ae64f5`（282）→
W4 `24a9dd0`（358）→ W5 `7d44f15`（433）。心智移植主体（1.5 万行语义保真重写）完成，
全部 prompt sha 对拍闭合（两处授权变更入追认）。**下一步：追认七条呈 Kevin → M3 治理
移植（特权层等价重建，遗留总账 14 项为输入）。**
