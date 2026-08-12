# WO-FIX-APPROVAL-UX · 对话审批四处补漏(2026-08-12 首次真人走通暴露)

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**先 `git checkout -b wo/fix-approval-ux wo/l5`**(尖 `71a72720` = 活体 main 内容)。
铁律:一切命令**前台串行**,禁止后台(&)、禁止 sleep 等待、禁止"稍后继续"收尾;
每完成一条判据就 git commit;测试命令一律 `timeout 1800` 包裹;stdout 即报告本体。

## 背景(今天下午的真实事故,按审计流复原)

Kevin 批准她跑 `terminal.exec` 的全过程:①老式 POST 横幅在 Telegram 刷了 4 次
(conversation.py:350,Mac 时代遗物);②"批准/同意"被前置过滤打成
no_match_chitchat;③判读器 LLM 在 telegram 进程 KeyError(部署缺环境文件,
已热修 drop-in),字面"执行"也一律 clarify;④最终执行成功后**她一声不吭**——
granted/execute_once 是 handle_owner_answer 四个出口里唯一不回话的分支,
observation 被丢弃,Kevin 要再发消息才能触发下一轮把结果带出来。

## 四条修复(= 判据①–④)

① **执行结果主动回报**(kernel/approval_conversation.py):
   `granted`/`execute_once` 执行后立即 `_send` 结果,**引用 Kevin 的批准消息**
   (`_reply_ref(message_id)`,S1A 豁免打扰预算)。成功=一句确认+输出正文
   (observation.data 里的 stdout/结果,截断 1500 字符并注明);失败=一句
   "跑了但出错"+error。出站仍走既有 dispatch messenger.send(脱敏/审计照常),
   发送失败不影响已完成的执行,落 telemetry。audit 事件补 replied 字段真值。
② **老横幅退役**(cognition/conversation.py:350 附近):
   对话轮的动作撞审批门时,不再输出带 POST 端点的横幅;改为调用 S3 的
   `approval_conversation.ask`(若该 pending 已有未决问询则**沉默**——
   不重复播报,今天 4 连横幅的病灶)。ask 失败(预算/传输)时回一句不带
   端点的简短说明("这事需要你点头,我稍后再问")。surface 的 POST 端点
   本身保留(owner console 兜底),只拆聊天里的横幅。
③ **确定性快通道**(kernel/approval_interpreter.py):
   在 LLM 判读**之前**,对 owner 应答做字面匹配:恰为「执行」→ execute_once,
   恰为「不要」→ deny(允许首尾空白/标点)。仅在**恰有一条**未决问询时生效
   (多条时字面词歧义,照走 LLM);她的 clarify 话术本来就承诺了这两个词,
   承诺的应答方式不得依赖 LLM 可用性。
④ **前置过滤词表**(同文件 no_match_chitchat 判定):
   "批准/同意/好/可以/行/不行/别/算了/拒绝"等自然应答必须能进判读器,
   不得被打成闲聊。保守方向不变:进了判读器之后拿不准仍是 unclear。

## 硬约束

- 判读失败方向永远是"不批准"(clarify/unclear),快通道只放行两个字面词。
- 不改 approval.py 的 consume/grant 语义,不碰 guardian,不动 L5 建议队列。
- 每条修复各配测试;②要有"同一 pending 不重复播报"与"横幅文本不再出现"
  的断言;①要有"成功回报引用了批准消息"与"发送失败不影响执行结果"的断言。

## 判据⑤–⑦(收尾三件套)

⑤ 全邻接运行清单前台串行全绿(下列),对照 14 条已知基线:
```
timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p2_s3_approval_wiring.py
timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p2_s2_approval_interpreter.py
timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_l5_suggestions.py
timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_conversation.py tests/test_cognition_conversation.py 2>/dev/null || true  # 以 grep -rl "def _compose_reply\|conversation" tests/ 实际命中为准,先列清单再跑
timeout 1800 .venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p0_integrity.py
```
   (conversation 邻接的测试文件名先 `ls tests/ | grep -i conv` 确认,漏跑=白干。)
⑥ manifest 重签(cognition/conversation.py、kernel/approval_conversation.py、
   kernel/approval_interpreter.py 哈希更新,条数应保持 107),commit。
⑦ 报告:四条修复逐条自证(改动点+测试行号)、清单结果原样贴、manifest 前后。
