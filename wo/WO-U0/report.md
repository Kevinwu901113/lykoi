# WO-U0 · 传输层加固 — 完成报告

分支 `wo/u0`(自 `ed262b80`),3 个 commit,未 push。

## 前置侦查结论

**1. sendMessage 的全部调用方** —— 全部收束到同一个函数,所以①②做在传输层就等于全都惠及:

```
telegram_device._send_reply (chat 回复代发, device.py:138)  ─┐
kernel/approval_conversation._send (S3 审批问答, :112)       ─┤
kernel/suggestion_conversation._send (L5 建议问答, :72)      ─┼→ dispatch("messenger.send")
(任何 cognition 侧的 messenger.send 动作)                    ─┘        ↓
                                              messenger.send (messenger.py:185)
                                                             ↓
                                    _TRANSPORT.send_message  →  TelegramTransport.send_message
                                                             ↓
                                              TelegramTransport._post("sendMessage")  ← ①的落点
```
`fetch_updates`(messenger.read)与 `poll_updates`(device 长轮询)是另外两条,不走 sendMessage。

**2. 是否已有持久出站队列 —— 没有,不能复用。** `shared/chat_outbox.py`(`/home/lykoi/state/chat_outbox.json`)是「她的主动发言 → CLI/Mac 客户端」的**非破坏性广播日志**,消费者是 `GET /chat/outbox` 的 cursor(`scripts/chat.py:96`),与 Telegram 投递无关:往里 append 不会让任何东西被发出去,也不记录"发没发出去"。因此按 WO 的备选路径新建了最小的一张表 —— 但**不新增文件**(manifest 须保持 107 条),落在 `telegram_transport.py` 内:`UNDELIVERED_PATH`(默认 `/home/lykoi/state/telegram_undelivered.json`,有界 200 条)+ `record_undelivered()` / `undelivered()`。本单**不做自动重投**(那是 U1+),只保证结局可查。

## 判据逐条

### ① sendMessage 失败重试 — 分类与取舍(`telegram_transport.py:52-70`)
分类**唯一的用途是记录,不是决定要不要重试**:
- **确定未发出** = `ConnectError / ConnectTimeout / ProxyError`(TCP/代理这层就没连上,请求根本没到 Telegram)→ 重发绝无重复之虞,`ambiguous=false`。
- **歧义** = 其余 `httpx.HTTPError`(`ReadTimeout` / `RemoteProtocolError` 半途死:请求出去了、回应没读回来,Telegram 可能已投递)→ **也重试**,`ambiguous=true`。

取舍钉死在源码注释里(:56-63):**丢话之害 > 偶发重复之害**。8-12 那批冤案全部是丢话造成的(她说了、他没看到、于是"她不回我");一条重复消息 Kevin 一眼可识别并忽略,一条丢掉的话没有任何人能事后发现。所以宁可把一次确定失败误标成歧义,也不可反过来。

退避 `SEND_RETRY_BACKOFF_S = (2, 5, 15, 30)`,至多 4 次重试,总睡眠 52s ≤ 60s 总窗。每次落 `telegram_send_retry`(`method/attempt/error_type/ambiguous/backoff_s`,:270)。`retry_backoff` 只传给 sendMessage —— getUpdates 一律不重试(§forbidden)。

测试:`test_telegram_transport.py:405`(ConnectError 重试 2 次后送达、`ambiguous=[False,False]`)、`:423`(RemoteProtocolError 重试且 `ambiguous=True`)、`:441`(生产退避常量 = 4 次 / ≤60s)、`:451`(恰好 1 首发 + 4 重试 = 5 次 HTTP,不多不少)。

### ② 送达终局不静默
重试耗尽 / 429 耗尽 / 400 api_error → `record_undelivered()`:落盘(`context_id` / `text_summary` 前 200 字 / `chars` / `error` / `ambiguous` / `attempts` / `source` / `ts`)**并**发 `telegram_send_undelivered`,两件事在同一个函数里,不存在半截状态。正文不进事件流(事件只有字数)。返回值带 `undelivered_recorded=True` 作回执,让上层不重复记账。

> 一条出站消息只有两种结局 —— 有 `message_id`(送达),或在未送达表里。没有第三种。

测试:`:466`(耗尽 → 记录+事件,`attempts=5`、`ambiguous=True`、正文不入事件)、`:494`(400 也进表,不算"发过了")、`:509`(账本损坏当空处理,不升级成崩溃)。

### ③ 回执贯通
成功路径 `message_id` 原样返回(S3/L5 归属依赖它,`test_p2_s3_approval_wiring` / `test_l5_suggestions` 全绿未回归)。chat 回复代发路径(`telegram_device.py:143-166`)现在补齐两端:成功 → `chat_reply_delivered`(`message_id/context_id/chars`,:152);未送达 → transport 已记过账就不重记,transport 根本没跑到(频控挡下、dispatch 被策略拒)则由这层补记 `source="chat_reply"`。等审批那条腿**不**算未送达(它还有下文)。这样 surface 的 `chat_reply` 只再表示"她生成了这句话",送达与否另有交代。

测试:`test_telegram_device.py:286`(送达记 `message_id`,未送达表为空)、`:304`(失败恰好一条记录、不误记送达)、`:321`(频控 → 由代发层补记)、`:342`(策略 deny → 同样不静默)。

### ④ getUpdates 降噪
`_note_poll_error` / `_note_poll_ok`(:204/:223):同类错误连击只记首条 + 每第 10 条(都带 `streak`);HTTP 层一通就发一条 `telegram_poll_recovered`(`error_type/streak/duration_s`);换一种错误另起一段连击。**只动日志**:`POLL_TIMEOUT_S`、offset 语义、device 的退避全部未动。20 分钟 × 35s ≈ 35 条 → 4 条日志。

测试:`:524`(21 条错误 → 日志 `streak == [1,10,20]`,且长轮询不重试)、`:539`(恢复事件唯一,带 streak/时长)、`:557`(换错误类型另起连击)、`:573`(offset/timeout 请求参数原样 —— §forbidden 守卫)。

### ⑤ 行为不变全邻接(前台串行)
```
$ ls tests/ | grep -iE "telegram|messenger"
test_messenger.py
test_telegram_device.py
test_telegram_transport.py
```
```
$ timeout 1800 python3 -m pytest tests/test_messenger.py tests/test_telegram_device.py \
    tests/test_telegram_transport.py tests/test_p2_s3_approval_wiring.py tests/test_l5_suggestions.py -q
118 passed in 536.41s (0:08:56)
```
重签后 `tests/test_p0_integrity.py`:**20 passed, 4 skipped, 1 failed** —— 失败的 `test_committed_manifest_matches_available_protected_sources` 是**环境性既有失败**,不是回归:在基线 `ed262b80` 上 checkout 全量跑,得到**逐字相同**的 `PermissionError: '/home/lykoi/state/approval_rules.json'`(本用户读不到 lykoi 的 state 目录)。我另外手工跑了该测试的等价校验、只跳过那个不可读文件:**106 个受保护源哈希全部匹配,0 个 mismatch**。

WO 提到的"14 条已知基线"在仓内(`reports/`、`docs/`)找不到对应文件,故按上述方式自证:邻接集 118 项全绿 + 完整性失败与基线逐字一致。

### ⑥ manifest 重签
107 → **107 条(条数不变)**,只重算本单动过的两个受保护源:
```
src/lykoi/resources/telegram_device.py     ded75c3b… -> 1a05faae…
src/lykoi/resources/telegram_transport.py  5266bfd8… -> 61f2fd00…
```
(6 个本用户不可读的条目原样保留摘要,与上次重签 `e2609878` 同形制。)

## commit

```
dd1306ce [WO-U0] manifest 重签: 两条改动源文件哈希同步 (107 -> 107)
c63496d7 [WO-U0] 判据③: 回执贯通 — chat_reply_delivered(message_id) / 落未送达, 结局二选一
7223115d [WO-U0] 判据①②④: sendMessage 重试(丢话之害>重复之害) + 未送达账本 + getUpdates 降噪
```

`conversation.py` / `mind/` / kernel 问答机语义、长轮询节奏、依赖清单均未改动;未 push。

一处需要点名的取舍:测试里用 autouse fixture 把退避睡眠归零(`SEND_RETRY_BACKOFF_S = (0,0,0,0)`),**重试次数保持生产的 4 次**,生产的 2/5/15/30 由 `:441` 直接断言源码常量 —— 否则邻接集要多付 52s×N 的墙钟。
