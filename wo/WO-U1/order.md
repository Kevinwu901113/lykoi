# WO-U1 · 送达结局回灌(想/说统一 U 系列第二单,设计 §4 收窄口径)

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**先 `git checkout -b wo/u1 wo/u0`**(尖 `4d800e4f`)。
铁律:前台串行、禁后台、禁等待;每判据一 commit;测试 `timeout 1800` 包裹;
stdout 即报告。侦查发现与工单冲突时,停下写清楚,不要自作主张改口径。

## 背景与收窄说明

U0 已让"未送达"有账(`telegram_transport.record_undelivered` + 账本 JSON)。
原设计的 U1(说走 dispatch)侦查后发现已成立——chat 回复本就经
`dispatch("messenger.send")` 出站。故 U1 收窄为一件事:**让她感知到自己的话
没送出去**,分两半:落成经验(长期,进学习环)+ 进下一轮上下文(即时,
她自然会重说)。8-12 冤案的最后一环:有账,但她读不到,等于没有。

## 判据

① **未送达 → 经验**:出站消息终局为未送达时,落一条 experience
   (内容形如「我想对 Kevin 说的话没能送出去(网络故障):『<摘要≤200字>』」,
   来源标签你先读 `experience_class.classify()` 与 experiences.source 的既有
   词汇再定,**必须落进 working 池**(她该消化这件事),salience 取中档)。
   写入路径遵守单写者纪律(谁是 experiences 的合法写者就经谁)。
② **未送达 → 下一轮上下文**:`conversation._assemble` 增补一个系统块
   [有话没送出去],列该 context 最近 ≤3 条未送达(时刻+摘要);数据源为 U0
   账本;**层次边界你来定并自证**(cognition 直接 import resources 若嫌脏,
   可经一个薄 seam,但不要为此新建受保护文件——manifest 条数尽量守 107)。
   展示期:该条目进过一次上下文后标记 surfaced(账本加一个字段),
   之后不再重复注入——她看到一次就够了,重说与否是她的事。
③ **零扰动**:账本空/无本 context 条目时,_assemble 逐字节与今天一致
   (前缀缓存不能因此天天失效——空时不加块)。
④ 每判据配测试;①要断言经验真的进 working 池(跑 classify());②要断言
   surfaced 只注入一次;③要断言空账本时 assembled 消息序列与基线相同。
⑤ 全邻接前台串行:test_telegram_device/transport、test_messenger、
   conversation 邻接(先列后跑,同 WO-FIX-APPROVAL-UX 口径 21 文件)、
   test_l1_experience_class、test_l2_intake、**test_gate5_l1_scan**(全局门,
   永远进清单)、test_p0_integrity(重签后)。对照 14 条已知基线。
⑥ manifest 重签(条数写明),commit。
⑦ 报告:①的来源标签选择依据、②的层次边界自证、清单原样、manifest 前后。

## forbidden

不做自动重发(重说是她的认知决定,不是传输层的机械行为);不动 kernel 问答机;
不动长轮询;凡读时钟先想 shared/clock,裸读必打 realtime-allow 标记。
