# WO-FIX-APPROVAL-DELIVERY · 对话轮审批问句送达修复 · v1(已签发)

**拍板记录(2026-08-19)**:Kevin 批准 DP1(对话轮内审批问句=应答语义,不计
打扰预算;自主情境问句仍计——与 P1 附文 E2 边界"initiate 不入豁免"同构)与
DP2(独立小单先修 + WO-U3S 加判据防修复随转录机退役蒸发)。原话"决策点我都
同意";合并包 13 的 2 条追认项按同句并记追认(治理侧推定,如误可撤)。
P1 附文修订同日入档(`docs/policy_core_approval_exemption_proposal_2026-08-18.md`
§6)。**派发前置:合并包 13 已落地(基 `1b8ef063`)。**

---

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**分支 `wo/approval-delivery` 已由治理侧建好(尖 `1b8ef063` = 合并包 13 后活体
HEAD),直接 checkout。**
铁律:前台串行、禁后台、每判据一 commit(`[WO-FIX-APPROVAL-DELIVERY]` 前缀)、
测试 `timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与工单冲突
时停下写清楚。

## 背景(治理侧 2026-08-19 实测,证据在 audit 正本,可直接引用)

- 8-19 01:40 CST 对话内 `terminal.exec` 请求(接雨水题)触发 6 次审批问句,
  **6 次全部 `approval_question` `stage=undelivered` `reason=daily_cap`
  `outcome=deny_by_default`**(17:40:19Z–17:41:54Z);owner 其间的"批准/同意"
  因 pending 未入队而落进闲聊分支被吞。
- 根因链(逐层核实):
  1. `cognition/conversation.py:1332` `_ask_for_approval` 调
     `approval_conversation.request_approval(...)` **未传 `reply_to`**
     (对照:`resources/telegram_device.py:245` 的调用点传了);
  2. 问句作为无 `reply_to` 的 `messenger.send` 落入 `resources/messenger.py`
     打扰纪律(`PROACTIVE_DAILY_CAP = 1`/UTC 日 + 6h 冷却,`reply_to` 豁免);
  3. 当日名额耗尽后全天问句必然 throttle;
  4. `request_approval` 原子性设计:发送失败=拒绝且不入队(设计正确,被上游
     饿死后表现为"她问不出、他批不上")。
- 修复语义已由 P1 附文 §6 定为政策:**对话轮内发起的审批问句=应答语义**,
  实现即线程 `reply_to`,复用 messenger 既有豁免;不新开豁免通道。

## 判据

① **接线**:`_ask_for_approval` 把**当轮入站消息 id** 作为 `reply_to` 传给
   `request_approval`(该形参已存在,kernel 预期零改动)。入站 id 的可达路径
   自行侦查并在报告引用代码行(conversation 对象/当轮元数据里应有;若确实
   不可达,停下写清楚,不许造 id、不许用出站消息 id 顶替)。
② **复现场景端到端**:测试构造"当日名额已耗"状态(ledger 预置今日时间戳)+
   对话内动作命中审批门 → 断言:问句送达(mock transport 收到)、**零**
   `messenger_proactive_throttled` 事件、`approval_question` `delivered=true`、
   pending 入队、随后 owner 肯定答复可绑定并放行该动作。
③ **预算边界回归**:无 `reply_to` 的 send(她自发/主动路径)仍计预算——现有
   测试保持全绿,并**新钉一条**负向断言(名额已耗时自主情境问句仍被拒),
   防止未来把豁免做宽。
④ **零扰动**:`resources/messenger.py` 与 `kernel/approval_conversation.py`
   **逐字节不动**;U3 影子机制、切换键、`mind/decide.py` 不碰;修复仅存在于
   ask 调用点(+测试)。
⑤ **全邻接前台串行**:conversation 口径套件 + approval 套件(S3/FIX-UX 全部)
   + telegram 套件 + `tests/test_p0_integrity.py`(重签后)。全量基线:
   **2077/3/6**(2026-08-19 复核权威值,3 failed = redaction×2 + claude 身份
   p0 假失败);新增失败零容忍、逐条解释。
⑥ **manifest 重签**(现 110,前后条数写明;conversation.py 在六目录内)。
⑦ **报告(stdout 本体)**:接线点与入站 id 来源的代码行引用;②的测试输出
   原文;部署核对(哪个进程加载 conversation.py=lykoi-server,预期无新 env、
   单元文件不动);每判据自证。

## forbidden

不动 `resources/messenger.py`(预算常量与判定逻辑=Kevin 定的打扰纪律,本单
零 diff);kernel 预期零改动(若侦查发现必须动,停下写清楚);不碰 guardian/
与 src/lykoi/core/;不碰 U3 影子与切换键;她的对话原文不入任何日志字段;
approval_rules 永无写路径;secrets 不入块与日志;新增 state 路径常量必须同
提交补 conftest 默认值(教训 36,预期本单无);凡与本单口径冲突的侦查发现,
停下写清楚。
