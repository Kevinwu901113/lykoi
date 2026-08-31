# WO-REWIRE-PROACTIVE · 工单: 把她的主动嘴接到真躯体上

你是执行 Agent,在 `~/lykoi-work-l1` 工作。基分支 **`wo/u1`**(尖 `70ac7394`),
新建分支 `wo/rewire-proactive`。**前台串行执行,禁止后台(&)、禁止 sleep 等待、
禁止"稍后继续"式收尾。** 每完成一条判据 commit 一次(棘轮)。

## 背景(为什么)

她的自主路径有两个外向动作。`initiate_chat` / `promise_followup` 的产出至今
落进 `shared/chat_outbox`——那是 2026-08-09 具身转向前旧躯体(Mac/CLI 客户端
轮询)的广播日志。转向后 Telegram 是她唯一的社交躯体,而 **telegram 设备从不读
chat_outbox**:她若主动开口,消息死在信箱里,reflow 还告诉她"Kevin 打开对话就
会看到"(结构性假回执)。本单把消费端接上,并把回执改诚实。

已核事实(复核者侦查,不必重查):8 月 2–4 日有 3 条 `kind=proactive` 死信;
autonomy 进程无 im.env、其 messenger 为 NullTransport——**嘴只能在 telegram
进程里**,单进程单写者纪律不许破(避免双进程抢 Bot API)。

## 判据

① **消费循环**:telegram 设备进程内,长轮询循环的间隙消费 `chat_outbox`
   (复用其 cursor 语义,设备自持游标,持久化在
   `/home/lykoi/state/telegram_outbox.cursor`,file_lock+原子写,损坏当
   "从当前 max id 起"处理——宁跳过不重复灌陈货)。
   - 只投递 `kind in {"proactive", "followup"}`;`approval_request` 是旧
     surface 续跑遗物(S3 已接管审批),跳过并记 `chat_outbox_skipped` 事件。
   - **游标初值 = 部署时刻账本里的 max id**(migration/首启逻辑):42 条陈货
     一条不发,里面有过期死链。
② **投递路径**:经既有 transport(`send_message` 带 `retry_backoff`),自动
   继承 U0 重试+未送达账本+U1 经验回灌——**不新写发送逻辑**。目标 chat 为
   owner 绑定(设备已知)。游标推进在**结局落定之后**(有 message_id 或已入
   未送达账本)——U0 取舍同款:丢话之害>偶发重复之害;进程在发送与推进之间
   崩溃可能重复投递,注释与测试把这个取舍钉死。
③ **回执改诚实**:`mind/reflow.py` 的 initiate_chat 成功文案改为不许诺送达
   (例:"已交给投递;送达与否之后会回到你的经验里"),删除"Kevin 打开对话
   就会看到"。`resources/autonomy.py` 顶部注释同步(消费者已不是 CLI/Mac)。
④ **测试**(新文件 `tests/test_rewire_proactive.py`):游标初值跳过陈货;
   kind 过滤(approval_request 只记不发);投递走 transport 且失败落账本
   (从而 U1 经验回灌自动覆盖);结局落定后才推进游标;账本/游标文件损坏不
   坏轮询循环;reflow 文案断言(不含旧许诺句)。
⑤ **邻接清单(先列后跑,报告里原样贴)**:telegram_transport / telegram_device /
   messenger / **gate5_l1_scan** / p0_integrity / mind_beat / u1_undelivered_feedback
   + 你判断受影响的 reflow/autonomy 邻接。改动前先跑基线,改动后逐条对比,
   新失败零容忍。凡新代码读时钟:先想 shared/clock,确需裸读必须打
   `# realtime-allow: <理由>` 尾注。
⑥ **manifest 重签**:`python3 guardian/startup_verify.py --write-manifest`,
   条数预期 107→107(不新建受保护文件;测试文件不在 manifest)。
⑦ **报告** `~/wo/WO-REWIRE-PROACTIVE/report.md`:每条判据的实现取舍、清单
   与逐条对比结果、manifest 前后条数。

## forbidden

- 不做自动重发(重说是她的认知决定——消费循环只投递"从未出过站的",不碰
  未送达账本);
- 不动 kernel 问答机(S3/L5)、不动长轮询节奏(`poll_updates`/退避/
  `POLL_TIMEOUT_S`);
- 不给 autonomy 进程任何 Telegram API 访问;
- 陈货(游标初值之前的 42 条)永不投递。
