# WO-FIX-APPROVAL-DELIVERY · 审批问句被打扰预算饿死 · 草案(待 Kevin 拍板签发)

状态:**草案**,2026-08-19 治理侧读数发现,证据齐,待两个决策点拍板后签发。
建议执行模型:sonnet(改动面小、判据机械)。建议时机:合并包 13 落地之后,
独立小包,不与 U3 观察期材料混装。

## 0 · 事故读数(2026-08-19 凌晨,证据全在 audit 正本)

8-19 01:40 CST,Kevin 在对话里让她"用 python 解出"接雨水题。她 6 次发起
`terminal.exec` 审批(写 `/tmp/trap.py` ×3 + 运行 ×2 + echo 备注 ×1,行为
全部正当),**6 次全部 `deny_by_default`,stage=undelivered,reason=daily_cap**
(audit `approval_question` 事件,17:40:19Z–17:41:54Z)。Kevin 其间给过
"批准/同意",但 pending 队列里什么都没有(问句发送失败→按 S3 原子性设计
拒绝且不入队),回答落进闲聊分支被吞。她重试到放弃,最后把代码直接贴进
聊天(17:42:13Z)——行为诚实,但任务没执行成,且她对 Kevin 解释为
"被验收队列拦着"(无回执的机制猜测,P2 家族旁证)。

## 1 · 根因(已逐层核实,非推测)

1. `cognition/conversation.py:1332` `_ask_for_approval` 调
   `approval_conversation.request_approval(...)` 时**没传 `reply_to`**
   (对照:`resources/telegram_device.py:245` 的调用点传了)。
2. 问句作为 `messenger.send` 落到 `resources/messenger.py`,没有 `reply_to`
   即计入**打扰纪律**(`PROACTIVE_DAILY_CAP = 1`/UTC 日,冷却 6h)。
3. 当日唯一名额已耗(ledger `state/messenger_outbound.json` mtime 8-18
   14:53 CST 后再未写入),此后**全天所有审批问句必然 daily_cap**。
4. `approval_conversation.request_approval` 的原子性设计:发送失败 = 动作
   拒绝(deny-by-default)、不入队、发 undelivered 回执——设计本身正确,
   被上游饿死后表现为"她问不出、他批不上"。

一句话:**审批问句被当成了'主动打扰'计费,而它在对话轮里分明是应答。**

## 2 · 待 Kevin 拍板的两个决策点

- **DP1 政策口径**:E1(审批机制自身通信)与打扰预算的关系。建议:
  **对话轮内发起的审批问句 = 应答语义,不计打扰预算**(实现即线程
  `reply_to`);**自主情境发起的审批问句仍计预算**(她凭空提需求确实是
  打扰,与 P1 附文 E2 边界"initiate 不入豁免"同构)。此口径作为一条
  修订并入 `docs/policy_core_approval_exemption_proposal_2026-08-18.md`
  (P1 附文)E1 节,与 U3 切换单同窗生效或先行热修,见 DP2。
- **DP2 时机**:A) 单独小单现在修(活体 conversation.py 还是生产路径,
  下次再遇工具型请求且名额已耗必复发);B) 并入 U3 切换单(U3S 的
  apply 腿接审批时一并接对);建议 **A+B**:现在修 conversation.py
  (一行级)+ 在 WO-U3S order 里加一条判据"周期路径的审批问句必须带
  reply_to / 不计打扰预算",防止转录机退役时修复跟着蒸发。

## 3 · goal / scope / forbidden / success_criteria / required_evidence

- **goal**:对话轮内的审批问句可靠送达,不再被打扰预算吞;Kevin 的
  批复能绑定到 pending。
- **scope**:`cognition/conversation.py`(_ask_for_approval 线程入站消息
  id 至 request_approval 的 reply_to)+ 对应测试;若 DP1 批,P1 附文
  加一节修订(纸面,不改 policy 代码);manifest 同步重签。
- **forbidden**:不动 `resources/messenger.py` 的预算常量(cap 1/冷却 6h
  是 Kevin 定的打扰纪律,本单不放宽);不动 kernel/approval_conversation
  的原子性设计;不碰 U3 影子与切换键;不动 guardian。
- **success_criteria**:①带 reply_to 的问句不再触发 `messenger_proactive_throttled`;
  ②复现场景(名额已耗 + 对话内 terminal.exec 请求)问句送达、"同意"
  可绑定执行;③自主情境问句仍受预算约束(有测试钉住);④全量
  pytest 无新增失败,p0 绿。
- **required_evidence**:pytest 全量数字、复现场景的 events/audit 回执
  (approval_question delivered=true)、manifest 重算数。

## 4 · 旁注(不入本单)

- 她"被验收队列拦着"的无据解释:P2 回执背书判据(U3 门④)已覆盖此
  家族,影子期继续观测,不另立单。
- `notify.owner` 在 17:14Z 被用作对话应答("在,什么事?")一次:老通道
  仍在被模型选用,归 U4 转录机清理时一并核。
