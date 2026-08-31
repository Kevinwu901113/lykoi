# WO-FIX-APPROVAL-DELIVERY · 对话轮审批问句送达修复 · v2(已签发,设备层问句形态)

**版本记录**:v1(reply_to 在认知侧接线)于 2026-08-19 16:12 被执行方合规停工
——侦查证实入站 message_id 在 conversation 层**结构性不可达**,且这是 WO-U3/
P1 E2 分层的刻意设计("认知侧碰不到它"),停工报告存档
`stopwork_v1.md`(三条路径逐条冲突,判断全部成立)。v2 为治理侧在既有拍板
(DP1/DP2,Kevin 2026-08-19)语义内的实现重设计:**问句移到设备层去发**——
`approval_conversation` 模块文档自明"由拥有对话的调用方来问,今天=Telegram
设备",设备层调用点(telegram_device.py:245)本就带 reply_to。id 永不进认知
侧,E2 分层原封不动,P1 附文 §6"复用 reply_to 既有豁免"仍然为真,messenger
与 kernel 仍零 diff。Kevin 已知会。

---

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**分支 `wo/approval-delivery` 已建好(尖 `1b8ef063` = 活体 HEAD),直接
checkout。**
铁律:前台串行、禁后台、每判据一 commit(`[WO-FIX-APPROVAL-DELIVERY]` 前缀)、
测试 `timeout 1800` 包裹、**stdout 即报告本体**、宁长勿略;侦查发现与工单冲突
时停下写清楚。

## 背景(治理侧实测 + v1 停工侦查,全部可直接引用)

- 缺陷:对话轮内审批问句由 `conversation.py:1332` `_ask_for_approval` 直发,
  无 `reply_to` → 被 `resources/messenger.py` 打扰纪律计费(cap 1/UTC 日)→
  名额耗尽后全天问句 `undelivered→deny_by_default` 不入队 → owner 批复无处
  绑定被闲聊分支吞。8-19 01:40 CST 接雨水题 6 连拒实锤(audit)。
- v1 停工确认的结构事实(`stopwork_v1.md` 有代码行):入站 `message_id` 只在
  设备层(`telegram_device._handle_message`:345,:404 已算 `reply_to`);
  `/chat` 请求体(`app.py` ChatRequest)只有 `message`+`reply_to_notification_id`;
  `_generate_reply`(:176)只回纯文本;`messenger.py` inbound 存档模块私有。
- 既有正确形态:`telegram_device.py:245` 在她的**回复本身**需要审批时,已经
  以当轮入站 id 为 `reply_to` 调 `request_approval`——v2 就是把**工具动作**
  的问句也接到这个形态上。

## 判据

① **设备层问句接线**:当 turn 结果携带待批动作时,`telegram_device` 在
   `_handle_message` 一侧以当轮入站 `message_id` 为 `reply_to` 调
   `approval_conversation.request_approval`(镜像 :245 既有调用形态,
   `origin="interactive"`,action_id/correlation_id 透传)。认知侧交出的只有
   动作载荷(action_type/params/action_id/correlation_id)——**入站 id 一个
   字节不进认知侧**。turn 若同时有非空回复文本,先发回复再发问句(顺序
   自然:先说话,后请示)。
② **/chat 协议扩展(选择加入,向后兼容)**:请求体新增能力标记(字段名你定,
   如 `delegate_approval_ask: bool = False`);标记为真时 `_ask_for_approval`
   **不再自行** `request_approval`,而把待批动作作为结构化字段随 /chat 响应
   返回(`reply` 字段语义不变;deferred tool_result 填充等既有收尾逻辑保持)。
   **标记缺省/为假时行为逐字节同今天**(Mac app 等旧调用方零感知——旧路径
   保留,不删)。`conversation._pending`/`._pending_id` 的全部消费者摸清并
   保持语义(报告逐个列举;dedup 依赖 `request_approval` 机器侧
   already-outstanding 检查,确认其在设备层调用下仍然成立)。
③ **复现场景端到端**:测试构造"当日名额已耗"(ledger 预置今日时间戳)+
   对话内动作命中审批门 → 断言:问句送达(mock transport 收到)、**零**
   `messenger_proactive_throttled`、`approval_question` `delivered=true`、
   pending 入队、随后 owner 肯定答复可绑定并放行该动作。
④ **预算边界回归**:无 `reply_to` 的 send 仍计预算——现有测试全绿,并新钉
   一条负向断言:自主情境问句在名额已耗时仍被拒(防豁免做宽)。
⑤ **零扰动**:`resources/messenger.py` 与 `kernel/approval_conversation.py`
   **逐字节不动**;`_send_reply` 的 E2 盖章构造与 `_is_owner` 身份门不动;
   U3 影子机制、切换键、`mind/decide.py` 不碰;无标记 /chat 行为逐字节不变
   (以既有测试 + 新增对照断言自证)。
⑥ **全邻接前台串行**:conversation 24 文件口径 + approval 套件(S3/FIX-UX
   全部)+ telegram 套件 + surface/app 邻接 + `tests/test_p0_integrity.py`
   (重签后)。全量基线:**2077/3/6**(2026-08-19 复核权威值,3 failed =
   redaction×2 + claude 身份 p0 假失败);新增失败零容忍、逐条解释。
⑦ **manifest 重签**(现 110,前后条数写明)。
⑧ **报告(stdout 本体)**:接线点与协议字段的代码行引用;`_pending` 消费者
   清单;③④的测试输出原文;部署核对——**/chat 在 lykoi-server、设备在
   lykoi-telegram,两个进程都载新代码,合并包须两单元皆重启**(核对各单元
   EnvironmentFile,预期无新 env);每判据自证。

## forbidden

`resources/messenger.py` 与 kernel 全目录零 diff(若侦查发现必须动,停下写
清楚);不动 E2 盖章逻辑与身份门;不碰 guardian/ 与 src/lykoi/core/;不碰
U3 影子与切换键;不删无标记旧路径(回滚与旧调用方保障);她的对话原文不入
任何日志字段;approval_rules 永无写路径;secrets 不入块与日志;新增 state
路径常量必须同提交补 conftest 默认值(教训 36,预期本单无);凡与本单口径
冲突的侦查发现,停下写清楚。
