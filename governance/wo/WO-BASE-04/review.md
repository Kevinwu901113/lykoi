# WO-BASE-04 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07
- **执行 Agent**：服务器 claude 账户，模型 opus[1m]（第三次尝试成功；前两次代理连接中断）
- **结论**：**验收通过**，但**核心前提被推翻，第 2、3 节结论需按本记录修正**

## 一、报告最重要的"待核实"已由主治理 Agent 解决——结论反转

报告第 0 节写道：仓内三个 systemd unit 的 `Environment=` 行只有 PYTHONPATH 等 4 项，9 个 M3 特性开关**均未出现**，因此判定 `core/` 包（11,782 行，占全库 40.6%）为 default-off、**零生产消费者**，并据此把 core 的部分内容归入"可删除或大幅收缩"。它诚实标注了限制："真实线上可能通过 root-owned drop-in 注入，本副本无法观测。"

**主治理 Agent 用窄口 sudo 查了线上 drop-in（`systemctl cat`），结论相反：这些开关在生产环境几乎全部为 1。**

| 服务 | 线上实际启用的开关（drop-in 注入） |
| --- | --- |
| lykoi-core | `SHADOW_ENABLED=1`、`EVENT_INGRESS_ENABLED=1`、`ATTENTION_CANDIDATE_ENABLED=1`、`ATTENTION_DECISION_ENABLED=1`、`EXECUTION_SESSION_ENABLED=1`、`PERMISSION_EVIDENCE_SHADOW_ENABLED=1`，另有注意力策略路径 + **SHA256 锁定** |
| lykoi-server | `CORE_RUNTIME_ENABLED=1`、`EVENT_INGRESS_ENABLED=1`、`EXECUTION_SESSION_CLIENT_ENABLED=1`、`PERMISSION_EVIDENCE_SHADOW_CLIENT_ENABLED=1` |
| lykoi-autonomy | `CORE_RUNTIME_ENABLED=1`、`EXECUTION_SESSION_CLIENT_ENABLED=1` |

**修正**：`core/` 不是死代码，是**已激活的生产路径**（M3 R1a→R1b→R1c→R2 逐级 drop-in 叠加，与 `/usr/local/sbin` 那 17 个 apply 控制器的分阶段部署史一一对应）。三分类中任何"可删除"的判断**不适用于 core**。它的真实定位是：**运行中、但主要以 shadow/观测模式运行**的未完工线。

**方法论教训（重要，写进工单模板）**：治理工作副本 = 代码事实源，但 **≠ 部署事实源**。任何"是否启用"的判断都必须用 `systemctl cat` 查 drop-in，不能只看仓内 unit 文件。执行 Agent 无 sudo，这类核实只能由主治理 Agent 补。

## 二、经复核成立的结论

1. **`user_id` 全库出现 0 次**（`grep -rn "user_id" src/lykoi` → 0）。白皮书的群成员身份不是"加个字段"，是数据模型与鉴权模型的单主体假设——与白皮书 5.6 [PLANNED] 的判断一致，但严重程度比文档描述的更深。
2. **Delegation Gateway 无挂载点**：`kernel/dispatch.py:227` 的 `_RESOURCES` 是 5 项硬编码字典；`DispatchContext`（:207）只有 `origin` + `run_id`，没有委托主体、子代理身份、隔离域的位置。这是白皮书 17 章落地时第一个要改的结构。
3. **程序性学习被显式钉死**：`core/shadow.py:263` `evaluation_kind CHECK(evaluation_kind='unassessed_legacy')`、`:281 CHECK(proposal_ref IS NULL)`——结构预留了，但用数据库约束禁止填入真实评估。这是"有骨架无血肉"的确证。
4. **单例阻碍点**：`surface/app.py:128` 进程级 `conversation = Conversation()`；shared 层的 notifications / chat_outbox / proactive_chat / pending_actions 全是单文件全局台账。多用户化必须先拆这些。
5. **`core/shadow.py` 单文件 4,685 行**（全库 16%），最大单点债务——这条与"core 是活的"并不矛盾：活着且臃肿。
6. 三分类中"可保留 5（kernel/guardian/resources/shared/memory）、待重构 4（surface/cognition/mind/scripts）"经抽查成立。

## 三、注记

1. 报告称白皮书 31.3 原文不在工作副本内——属实，白皮书正本在 Kevin 的 Mac 与 `lykoi@~/白皮书v1.1.md`，治理工作副本没有。**后续工单应把白皮书随工单一起投放**，否则执行 Agent 只能依工单转述判断对齐。
2. 注意力策略文件有 `SHA256` 锁定（`LYKOI_CORE_ATTENTION_POLICY_SHA256`），且策略正本在 `/var/lib/lykoi-attention-policy/`——这是此前资产清点未覆盖的一个**新资产位置**，应补入身份连续性/配置资产清单（当前不在备份内）。
3. `/etc/lykoi-core-v1-m2/{server,autonomy}.env`（root 0444）是另一处配置资产，同样不在备份内。
4. 前两次执行失败均为代理长连接中断（"Connection closed mid-response"），非模型或工单问题；第三次成功。若再遇到，拆小工单。
