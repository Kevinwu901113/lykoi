# WO-U1 复核 · 2026-08-13 · PASS

**有效提交:`wo/u1` @ `70ac7394`**(基 `wo/u0` @ 4d800e4f)。
执行 Agent 一轮过(86 分钟,opus,断网期间在服务器上不受影响跑完)。

## 审读要点(src 全量逐行)

- **①经验回灌**:接在 `record_undelivered` 唯一必经点上(U0 结局二分法保证
  覆盖全部三条路);`source="conversation"` 的选择依据是对 classify() 判据表
  的逐项排除(environment 被 _sync_pending 排除在未整合计数外、action_result
  靠长度例外不稳、system/silence 落档案=她读不到),论证成立;salience 0.6
  与 SILENCE_SALIENCE 同档有依据;写入经 reflow 唯一写入点(顺带抬 load),
  函数级 import 防加载拖栈,写失败吞而有账(`telegram_undelivered_experience_failed`)。✅
- **②上下文块**:存储面搬 `shared/chat_outbox`(层次:cognition 禁 import
  resources,shared 两侧都够得着;两表同住互不读写;单写者入口不变;manifest
  守住 107)。展示期语义正确:标记在 `_completion` 拿到模型回应**之后**
  (预算收敛循环反复装配不误标;LLM 抛出不标,留到下轮);块在时间锚后,
  稳定前缀不动。✅
- **③零扰动**:空账本/全展示两种情况 `_assemble` 与整段拿掉逐字节相同,
  且不建文件、不回写;断言用冻结时钟做的真字节比对,非形式测试。✅
- **层次断言**:`test_cognition_still_does_not_import_resources` 钉住方向禁令;
  reflow 无 resources import,函数级反向引用无环。✅
- **conftest 防线**:`LYKOI_TELEGRAM_UNDELIVERED` 进测试默认——U1 起漏 patch
  的爆炸半径是真 mind DB,这条默认值是对的。✅

## 接受的口径偏差(复核裁定)

工单原文"该 context 最近 ≤3 条";实现不按 chat id 过滤(单例 Conversation
跨 /chat 与 Telegram 同一个 Kevin,过滤需把传输层寻址穿进 cognition——正是
本单要避免的耦合)。`unsurfaced_undelivered(context_id=...)` 参数保留给未来
第二对话者。**接受**:单 owner 现实下语义等价,层次代价不值。

## 测试与全量

新增 14 条全绿(50s)。权威全量串行 57 分钟(.venv 解释器):
**14 failed / 1819 passed / 6 skipped** —— 逐条 = 已知基线(11 rollout 控制器
环境 + 2 shadow + 1 p0 approval_rules 权限),**零新增**。
(执行 Agent 报告里的 6+1 失败集合是它用错解释器跑出的环境噪声,其自身
改动前后对比逐条一致的方法论仍然成立,不影响判定。)

## manifest

107→107;106 条独立重算全对(guardian 五条按 guardian 相对路径核),第 107 条
`/home/lykoi/state/approval_rules.json` 仅 live 可读,B 步统一重签覆盖。

## 遗留(不阻塞)

- 展示条目在同轮工具循环第二次装配时消失(已标 surfaced)——模型第一次调用
  已读过,语义无损;U3 周期合一后此细节自然消亡。
- 接嘴单(WO-REWIRE-PROACTIVE)已起草,基 `wo/u1`,本单合并后派。
