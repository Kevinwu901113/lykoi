## 停工报告 · WO-FIX-APPROVAL-DELIVERY 判据①侦查结论:入站 id 不可达

**结论先行:工单判据①的前提("该形参已存在,kernel 预期零改动;入站 id 的可达
路径自行侦查")在当前代码里不成立——`conversation.py` 的 `_ask_for_approval`
**没有任何路径**能拿到"当轮入站消息 id"。这不是我没找到,是架构上刻意切断
的。按工单原句"若确实不可达,停下写清楚"与 forbidden 段"凡与本单口径冲突的
侦查发现,停下写清楚",我在判据①这一步停下,未动代码、未提交。

### 证据链(代码行引用)

1. **`_ask_for_approval` 现状**——`src/lykoi/cognition/conversation.py:1313-1348`。
   调用 `approval_conversation.request_approval(...)`(`:1332`)时,可用信息只有
   `action`、`data`(=`observation.data`,只含 `action_id`/`correlation_id`,与
   平台消息无关)、`context_id = _owner_context()`(`:1325`,只是 owner 的固定
   telegram chat key,不含消息 id)。`Conversation` 对象全字段扫了一遍
   (无 `self._inbound_*`/`self._message_id` 之类的状态),`send()` 方法签名
   (`:607-613`)也只接收 `message: str` 和 `reply_to_notification: dict | None`
   (这个是"自主呼唤"通知 id,不是普通对话的入站消息 id——语义完全不同,不能
   拿来顶替)。

2. **/chat 端点本身不携带消息 id**——`src/lykoi/surface/app.py:146-149`
   (`ChatRequest` 只有 `message` + `reply_to_notification_id`)、`:232`
   (`conversation.send(request.message, reply_to_notification=reply_to)`)。
   Telegram 入站消息的 `message_id` 从未进入这个请求体。

3. **Telegram 设备层显式声明"认知侧碰不到它"**——
   `src/lykoi/resources/telegram_device.py:176-201`(`_generate_reply`,通过
   `httpx.post(f"{SURFACE_URL}/chat", json={"message": text}, ...)` 只带
   纯文本调 `/chat`,不带 `message_id`)、`:206-209` 的既有注释原话:

   > "`context_id` 就是刚刚那条入站消息的 chat id, 由设备层从长轮询结果里
   > 取出, **认知侧碰不到它**。所以这里是唯一有资格盖 E2 章的地方"

   这是 WO-U3 判据②/P1 E2 就已经明确记录、**刻意**的分层决策,不是遗漏。

4. **唯一持有真实 `message_id` 的地方是 `messenger.py` 的私有 inbound
   存档**——`src/lykoi/resources/messenger.py:226-277`(`ingest_inbound`
   把 `raw.get("message_id")` 存成 `source_ref_id`,写入
   `INBOUND_PATH`/`_load_inbound`)。但:
   - 这两个都是模块私有(`_load_inbound` 下划线开头),**没有公开读取函数**;
   - 要用它,必须在 `messenger.py` 新增一个读接口——直接违反判据④"逐字节
     不动 `resources/messenger.py`";
   - 就算加了读接口,靠"读最近一条 inbound 记录"去猜"是不是这一轮"也是
     脆弱的时序耦合(依赖轮询单线程顺序,不是结构保证),不是工单要的
     "该形参已存在,零改动"式接线。

### 三条路径,条条冲突判据④/forbidden

| 方案 | 需要动哪 | 冲突点 |
|---|---|---|
| 在 `telegram_device.py`/`app.py` 里把 `message_id` 一路透传进 `conversation.send()` | conversation.py 的 `send()` 签名 + app.py + telegram_device.py | 判据④"修复仅存在于 ask 调用点(+测试)";且直接推翻 WO-U3/P1 E2 已定的分层决策,超出本单授权范围 |
| 在 `messenger.py` 加一个公开读接口, 从 `_ask_for_approval` 里查最近入站记录 | messenger.py | 判据④"逐字节不动 messenger.py"(零 diff) |
| 伪造一个 `reply_to` 值(比如用 context_id 或随便一个字符串) | 无需动别处 | 工单原句禁止:"不许造 id、不许用出站消息 id 顶替";而且会把假 id 传进
`_TRANSPORT.send_message(reply_to=...)`(`messenger.py:207`),真机上会拿一个
不存在的消息 id 去起 Telegram 回复线程,行为未知,不是"零风险接线" |

### 我没做的事

- 未修改任何文件,`git status` 干净。
- 未创建 commit。
- 未触碰 `messenger.py`/`approval_conversation.py`/`telegram_device.py`/
  `app.py`。

### 需要治理侧裁决的问题

判据①的"该形参已存在,kernel 预期零改动"这句话,隐含假设是"入站 id 在
conversation 层可达,只是没接线"。侦查结果是:**在当前 /chat 架构下它结构性
不可达**,根因是 WO-U3/P1 E2 那次刻意的分层("认知侧碰不到它")。要交付判据
①,需要以下之一,而这均超出本单当前授权:

1. 明确批准打开 `telegram_device.py`/`app.py` 的改动范围,把 `message_id`
   透传进 `conversation.send()`(这会触碰 P1 E2 已定的分层边界,需要重新过
   一次那条边界的审查);或
2. 明确批准在 `messenger.py` 新增一个只读接口暴露最近入站消息 id(打破判据④
   零 diff);或
3. 重新定义"对话轮内审批问句"的送达豁免机制——不走 `reply_to` 字段本身,
   而是走 messenger 侧一个新的、非 `reply_to` 的豁免判据(但这会另开一条豁免
   通道,与 forbidden 段"不新开豁免通道"矛盾,且 P1 附文 §6 明确写的是复用
   `reply_to` 既有豁免)。

判据②-⑦依赖判据①的接线结果,在①的分歧解决前一并搁置,未展开。
