# WO-U3S · 周期合一切换单(信封转正,转录机让位)

> **状态:草案(2026-08-19)。签发前置:证据门七条全绿(D4 修订版,读数命令见
> `wo/WO-U3-MERGE/readout.md`)+ Kevin 批准。签发时填:分支尖、影子期实测数据
> (时延分布/背书统计,用于判据校准)。**

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
铁律同 WO-U3(前台串行/每判据一 commit `[WO-U3S]`/stdout 即报告/冲突停下)。
白皮书 v1.2 在 `~/wo/WO-U3S/whitepaper_v1.2.md`(37.8 回执背书、37.3 已是正文)。

## 背景(签发时刷新)

- 影子双跑自 2026-08-19 00:17 活体运行;`LYKOI_U3_SWITCH_ENABLED` 默认关且
  **生产代码零读者**(`test_no_module_reads_the_switch_to_release_a_side_effect`
  静态钉着——本单第一件事就是让它按设计变红,然后被继任者取代)。
- E2 盖章点在 `telegram_device._send_reply`(出站漏斗,切换后不变)。
- 影子路由 `conversation_shadow`;主路由 `main` = U2 实验组。

## 判据

① **切换读者(唯一一个)**:`LYKOI_U3_SWITCH_ENABLED=1` 时,inbound 轮的回复
   由信封周期驱动:`decision.kind=reply` → 文本经既有 `_send_reply` 出站(E2
   章不变);`silence` → 不发送、落账;`tool_call` → 走既有有界工具循环(此时
   **真执行**,分级照旧);`promise_followup` → 既有语义。旧转录机路径在开关
   开启时不再生成回复,但**代码原样保留**(回滚 = 关开关重启,秒级)。
② **usage 连续性反转**:切换开启后对话主调用记 `route=main`(实验组身份延续,
   与 U2 读数可比);`conversation_shadow` 路由随切换**停用**(不再双跑,成本
   回到一轮一调用);断言:开关开启时零 shadow 调用、零 shadow 事件。
③ **inner 转正**:信封 `inner` 经 `apply_inner(source="conversation")` 真落库
   (事件名 `conversation_inner_applied` 与旧路径连续);`THOUGHT_OPEN_CAP`
   交互配测试;旧路径的 `extract_inner_from_reply`/`_apply_conversation_inner`
   在开关开启路径零调用(退役随 U4 清理,本单不删)。
④ **零扰动(开关关闭态)**:`LYKOI_U3_SWITCH_ENABLED=0`(默认)时,全部行为
   与合并包 12 后现状逐字节一致(含影子照跑)——沿用 U3 判据⑧的四条口径。
⑤ **红测试交接**:`test_no_module_reads_the_switch_to_release_a_side_effect`
   按设计变红 → 由继任者取代:断言全 src **恰好一个**读者且在判据①的文档化
   位置;开关语义(默认关、env 覆盖)另测。
⑥ **P1/P2 在主路径承重**:E1/E2 全套测试在开关开启态复跑通过;回执背书提示词
   约束在主调用生效;P2 探针继续运行(改挂主路径,字段不变,供切换后对照)。
⑦ 全邻接前台串行 + manifest 重签(现 110,若触六目录/kernel 同步)+ conftest
   默认表(开关在测试默认关不变)+ 报告部署核对信息(进程/单元/env,预期:
   仅需在 lykoi-server 的 drop-in 加 `LYKOI_U3_SWITCH_ENABLED=1`——部署时机
   由合并包定,代码合并与开关开启是两个独立动作)。

## forbidden

不删旧转录机路径(回滚保障,清理归 U4);不动 kernel 问答机与传输层;不动
decide 自主情境;approval_rules 永无写路径;secrets 不入块与日志;不碰
guardian/ 与 src/lykoi/core/(合并包 A 步 root 执行,教训④升级版);影子期
实测若与本单判据冲突,停下写清楚。
