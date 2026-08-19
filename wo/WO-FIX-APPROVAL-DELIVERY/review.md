# WO-FIX-APPROVAL-DELIVERY v2 复核(2026-08-19 晚)

执行:opus 单次过 EXIT=0(16:19:33–19:11:31,2h52m),7 commit 尖 `7b00ae5e`,
3 源文件 +775 行新测试 + manifest(110→110 改 3 哈希),工作树干净。

## 结构审(全过)

- **改动面与 forbidden**:`git diff --name-only` 独立核=5 文件;kernel 全目录、
  `resources/messenger.py`、guardian 代码、core、mind 逐字节零 diff(治理侧
  自跑 diff 证实,非转述)。E2 盖章构造与 `_is_owner` 未触。
- **conversation.py**:类属性安全缺省(False/None=旧行为,忘接线不会变新行为);
  send() 逐轮设标记+清陈载荷;委托分支在 `_pending=action` 写入**之后**(消费
  者语义保持);载荷四字段无任何平台 id;`take_delegated_ask` 取走即清。
  报告"self._pending 全仓只写不读"断言独立 grep 证实(4 写 0 读)。
- **app.py**:字段缺省 False;载荷仅在"请求带标记且非 None"时入响应——无标记
  响应体连键都不多;新日志事件只带 action_type。
- **telegram_device.py**:`_generate_reply` 永不 raise(空 turn 兜底);
  `_normalize_turn` 保住 reply_fn 注入缝的向后兼容;`_ask_about` 镜像既有
  :331 调用(同 request_approval/origin/reply_to 形态),载荷形状不对=记账不问;
  异常轮廓与既有一致(run_forever 全局 except+退避,治理侧读循环证实)。
  先说话后请示的顺序自然。id 不进认知:请求体逐字节断言用例钉住。
- **manifest**:治理侧独立重算 **109 match / 0 mismatch / 1 unreadable**
  (approval_rules.json owner 域),与执行方逐位一致。
- **测试设计亮点**:③选 `notify.owner` 当被问动作避免结局被打扰账本污染;
  ④钉"设备不编 id";⑤同回合断言 E2(回复)+E1(问句)两枚章。

## 数字对账

- 执行方:邻接 34 文件 585/1/6;全量三段 **2107/4/6**,4 failed = 基线 3
  (redaction×2 + claude 身份 p0)+ 1 时序抖动(单文件复跑绿),期望 2108=
  基线 2077+新增 31,补回抖动恰好对齐,新增失败零。
- 治理侧独立复跑:三段串行 setsid 脱管(20:26 起)——**结果见下方补记**。

## 侦查记录(采纳,入总账 C5)

`scripts/startup_verify.py` 同字节副本从 scripts/ 跑 --write-manifest 会换
覆盖名单(110→115)。执行方误踩已还原未入提交。

## 结论

结构审 PASS;最终 PASS 以独立复跑数字对账为准(补记待填)。合并包 14 已备
`wo/WO-FIX-APPROVAL-DELIVERY-MERGE/package.md`(bundle 816fd0f1,thin 基
1b8ef063,两承重单元=server+telegram,五服务惯例全重启)。
