# WO-REWIRE-PROACTIVE 复核 · 2026-08-13 · PASS

**有效提交:`wo/rewire-proactive` @ `9703e977`**(基 `wo/u1` @ 70ac7394)。
执行 Agent 一轮过(21 分钟,opus),4 commit / +811 行。

## 审读要点(src 全量逐行)

- **①消费循环**:长在 `telegram_device.run_forever` 的长轮询**间隙**,自成一个
  `try` —— 出站侧任何异常(账本损坏 / 游标不可写)都不触发长轮询退避、也不让它
  少转一圈("嘴哑了不许把耳朵也带聋")。`OUTBOX_BATCH_LIMIT=20` 防积压霸占。✅
- **②游标**:设备自持(`telegram_outbox.cursor`,file_lock+原子写)。初值 =
  接上那一刻的 max id;**损坏也走同一支**(按首启)——与入站游标"损坏当 0"方向
  相反,理由钉在注释:入站重放至多多回一次刚才的话,出站从 0 重放会把 42 条陈货
  连同过期死链一次性灌给 Kevin。重启走已持久化那一支,期间攒的话不吞。✅
- **③投递**:走既有 `transport.send_message`,零新发送逻辑 → U0 重试 / 未送达
  账本 / U1 经验回灌**自动继承**(有一例跑真 `TelegramTransport` 打本地 fake
  server 验证这条继承是真的,不是口头继承)。游标推进在结局落定之后。
  没有 owner 绑定时**扣住不推游标**而非丢弃。✅
- **④kind 过滤**:只投 `proactive`/`followup`;`approval_request` 记
  `chat_outbox_skipped` 后跳过并推进(S3 已在同一 chat 自问自答,再投一遍就是
  同一个问题问两次)。跳过留痕而非静默丢弃。✅
- **⑤回执改诚实**:旧许诺句"Kevin 打开对话就会看到"在 `reflow.py` 整个文件绝迹
  (连解释性注释都不再原样引用它,避免下次 grep 误判);`autonomy.py` 顶部注释
  同步说明消费者已换、`queued=True` 只等于"已交给投递"。✅
- 安全纪律未破:autonomy 进程零 Telegram API 访问(有专测);长轮询节奏常数
  一字未改(有 forbidden 守卫测试);未送达账本这条循环**从不消费**(有专测)。✅

## 接受的口径偏离(复核裁定)

工单②写"投递路径",实现选了 `transport.send_message` 而非
`dispatch(messenger.send)`。**接受**,理由成立且写进了源码注释:
- 打扰预算已在上游 `proactive_chat` 账本收过一次(日 1/冷却 6h),再过一次
  messenger 的 proactive 频控 = 同一件事收两遍税,会让她"说了却被自己挡下"
  而 Kevin 什么也没收到;
- `messenger.send` 默认策略是 ask —— 为一条本就说给 Kevin 的话去问 Kevin 批不批。
内容本身来自完整审计过的回合(chat_outbox 文件头),这条是它的**投递线**,
不是新的对外副作用通道。U0/U1 的机制全在 `send_message` 之下,继承不受影响。

## 测试与全量

新增 `tests/test_rewire_proactive.py` 20 例(含 §forbidden 三条的正向断言:
不重发、不动长轮询常数、autonomy 无 Telegram)。邻接 116 全绿
(rewire 20 + device + transport + u1 14 + messenger + gate5 + mind_beat)。
权威全量串行 52 分钟:**14 failed / 1839 passed / 6 skipped** = 已知基线逐条
一致,**零新增**。

## manifest

107→107;106 条独立重算全对(guardian 五条按 guardian 相对路径核),第 107 条
`/home/lykoi/state/approval_rules.json` 仅 live 可读,B 步统一重签覆盖。
执行 Agent 的手工逐行同步经复核重算确认无误。

## 遗留(不阻塞)

- `transport.send_message` 是同步调用,重试最长 52 秒,期间长轮询等在后面;
  网络烂而不死时一批积压最坏能让她的耳朵停十几分钟。真断网时耳朵本来也聋,
  故不阻塞;U3 周期合一时出站若改走异步,这条自然消失。
- 报告落点偏差:执行 Agent 沙箱只许在 `~/lykoi-work-l1` 内建文件,报告写到了
  `reports/WO-REWIRE-PROACTIVE/report.md`(随分支进仓)。内容完整,不返工。
