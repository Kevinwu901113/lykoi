# WO-U0 复核 · 2026-08-12 深夜 · PASS(含 1 个复核者补丁)

**有效提交:`wo/u0` @ `4d800e4f`**(基 `wo/fix-approval-ux` @ ed262b80 = 活体 main)。
执行 Agent 一轮过(28 分钟,opus)。

## 审读要点(src 全量)

- **①重试语义**:只挂 sendMessage(`retry_backoff` 参数,getUpdates 一律不传——
  长轮询节奏未动);分类(确定未发/歧义)只决定 `ambiguous` 标记不决定重试;
  取舍"丢话之害>偶发重复之害"钉在源码注释,保守方向=宁标歧义;退避 2/5/15/30s
  共 52s≤60s 窗。✅
- **②终局记账**:唯一必经点(transport.send_message)收口,重试耗尽/429 耗尽/
  400 全部落 `telegram_undelivered.json`(file_lock+原子写+有界 200+损坏当空);
  记录与事件同函数,无半截状态;`undelivered_recorded` 防上层重复记账。✅
- **③回执贯通**:message_id 原样返回(S3/L5 归属未回归);chat 代发路径两端补齐
  (`chat_reply_delivered` / 未送达补记);**排队等批≠未送达**边界正确。✅
- **④降噪**:同类连击首条+每 10 条+`telegram_poll_recovered`(streak/时长);
  换错误类型另起连击;offset/timeout 参数有 forbidden 守卫测试。✅
- 安全纪律未破:错误只记类名,不落含 token 的 URL;`trust_env=False` 未动。✅
- 侦查结论正确:chat_outbox 是广播日志非投递队列,不复用是对的;
  账本放 transport 内部避免 manifest 增条,巧。✅

## 测试与全量

新增 308 行测试(transport 21 条 + device 新增段)。邻接 118 全绿。
全量串行 60 分钟:**18 failed / 1801 passed** = 14 基线 + **4 条新增同根因**——
gate5 实时读扫描门(教训 32 的制度化)在四个套件红:新代码两处 `time.monotonic()`
未打 `# realtime-allow:` 标记。执行 Agent 清单未含此全局门(工单模板税,见遗留)。

## 复核者补丁(4d800e4f)

两处连击计时补 `# realtime-allow: log-only streak duration`(仓内先例同款,
runtime.py 的 socket deadline 形制)+ manifest 哈希同步。补后 gate5/confab/
integration_telemetry/transport 四套 3+15+7+21 全绿。manifest 独立重算 107/107。

## 遗留(不阻塞)

- **工单模板追加一条**:`tests/test_gate5_l1_scan.py` 是全局不变量门(便宜,<1s),
  进每张单的必跑清单;凡新代码读时钟,先想 shared/clock,确需裸读必须打标记。
- 未送达账本当前无自动重投(设计内,U1+ 接);无消费者(owner console/她的感知
  都在 U1 的"回灌经验"里接)。
