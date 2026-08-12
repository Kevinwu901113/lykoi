# WO-U0 · 传输层加固(想/说统一 U 系列第一单,设计 §4)

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**先 `git checkout -b wo/u0 wo/fix-approval-ux`**(尖 `ed262b80` = 活体 main 内容)。
铁律:一切命令**前台串行**,禁止后台(&)、禁止 sleep 等待、禁止"稍后继续"收尾;
每完成一条判据就 git commit;测试 `timeout 1800` 包裹;stdout 即报告本体。
设计基准:`~/lykoi-work-l1` 同级治理仓无副本时以本单为准;背景:2026-08-12
实测 chat_reply 已记账但 sendMessage ConnectError 丢件(turn 540),她无从得知;
getUpdates 连续 20+ 分钟每 35s 一条 RemoteProtocolError 刷事件流。

## 前置侦查(先做,报告里写明)

1. 读 `resources/telegram_transport.py` / `telegram_device.py` / `messenger.py`,
   画清 sendMessage 的全部调用方(chat 回复代发、messenger.send 动作、S3/L5 问答)。
2. 查 `/home/lykoi/state/chat_outbox`(或代码里的 outbox 机制)是否已有
   持久出站队列——**有就复用,不要新造**。

## 判据(重试语义是本单的灵魂,取舍写进代码注释)

① **sendMessage 失败重试**(transport 层,惠及所有调用方):
   - 失败分两类:**确定未发出**(ConnectError/代理拒连——请求没到 Telegram)
     → 直接重试;**歧义**(ReadTimeout/RemoteProtocolError 半途死——Telegram
     可能已处理)→ 也重试,但事件里标 `ambiguous=true`。
   - 取舍钉死在注释里:**丢话之害 > 偶发重复之害**(8-12 冤案是丢话造成的);
     重复消息可被 Kevin 一眼识别,丢话不能。
   - 退避 2/5/15/30s,至多 4 次,总窗 ≤60s(对话时延可容);每次重试落
     `telegram_send_retry` 事件(attempt/error_type/ambiguous)。
② **送达终局不静默**:重试耗尽 → 持久化"未送达"记录(复用①侦查到的 outbox;
   没有就建一张小表/文件,记 context_id/text 摘要/最后错误/ts)+
   `telegram_send_undelivered` 事件。**任何出站消息的结局必须可查:
   送达(有 message_id)或未送达(有记录),没有第三种。**
③ **回执贯通**:成功路径 message_id 必须传回调用方(S3/L5 归属已依赖它,
   验证不回归);chat 回复代发路径补记 `chat_reply_delivered`(message_id)/
   落到②的未送达——把"chat_reply 事件 ≠ 送达"这笔糊涂账修平。
④ **getUpdates 降噪**:同类错误连击只记首条+每第 10 条(带 streak 计数),
   恢复时一条 `telegram_poll_recovered`(streak/持续秒数);**不改重连节奏**
   (长轮询的响应性不动)。
⑤ 行为不变全邻接(前台串行,先 `ls tests/ | grep -iE "telegram|messenger"`
   列清单再跑):telegram/messenger 全部命中文件 + test_p2_s3_approval_wiring.py
   + test_l5_suggestions.py + test_p0_integrity.py(重签后)。对照 14 条已知基线。
⑥ manifest 重签(resources/ 在覆盖内,条数应保持 107,哈希更新),commit。
⑦ 报告:侦查结论、①的分类与取舍自证、②③④逐条测试行号、清单原样、manifest 前后。

## forbidden

不动 conversation.py / mind/ / kernel 的问答机语义(那是 U1+ 的事);
不改长轮询节奏;不新增依赖;不 push。
