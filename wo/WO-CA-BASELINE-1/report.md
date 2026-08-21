验查完毕。工作树保持干净(`git status --porcelain` 空,tip `7b00ae5e`),全程零写入、零 commit。

---

# WO-CA-BASELINE-1 · C-A 认知核基线审查 · 前半(调度侧/自主循环)

## 0. 前置声明:参考材料缺失

**[事实]** 工单指定的三份同目录参考材料在本工作区**查不到**:

```
find /home/claude/lykoi-work-ca -iname "*whitepaper*" -o -iname "*cordis*" -o -iname "*exploration*"
→ 无匹配
ls /home/claude/lykoi-work-ca  → docs/ guardian/ policies/ reports/ scripts/ src/ tests/ + 5 个 .service
```
`/home/claude/` 上层目录被会话权限挡住(`ls in '/home/claude' was blocked`),未 sudo、未绕行。

**后果与本报告的处理方式**:凡涉及"白皮书 9.4/10.3/12.3/22.2/31 章原文怎么写"、"Cordis 双时钟的确切定义"、"§1 对账表列了哪些行"的地方,我**不复述、不臆测**,只写代码侧的事实,并把对照点写成"待与文本核对的开口"。工单里由 Kevin 直接给出的语义(显式心脏调度件、调度侧显著性唤醒、tick 积压合并、快照并行推演+串行仲裁、议程项租约)我按字面理解使用,并在每处标明这是按工单字面、非按原文。

术语一处提醒(贯穿全报告):代码里 **`origin` 是三个互不相干的命名空间**——kernel dispatch 的 `origin`(interactive/autonomous/scheduler/system)、notification 记录的 `origin`、mind 关切的 `origin`(seed/grown/relationship/floor/emergent/owner_directed/derived)。④ 里会逐个分清。

---

## ① 自主循环全景

### 1.1 进程壳

**[事实]** 自主侧是独立进程 `lykoi-autonomy`(`lykoi-autonomy.service:20` → `python -m lykoi.cognition.autonomous`),`Restart=always`/`RestartSec=5`,与 surface 共享 `llm.env`+`surface.env`,启动前跑 `guardian/startup_verify.py`。

`autonomous.main()`(`cognition/autonomous.py:296-327`)的顺序:
1. `interactive_lock.singleton_lock(LYKOI_AUTONOMY_LOCK)`(:298-302)——flock 单例,拿不到就 `return 1`;
2. `runtime_client.start_registration("lykoi-autonomy")`(:305);
3. `record_deploy_event(unit=...)`(:306);
4. `store.autonomy_mark_stale()`(:307)——上次崩溃留下的 `running` 行标 stale;
5. 装 SIGTERM/SIGINT → `stop.set()`(:311-315);
6. `run_forever(stop)`。

### 1.2 定时形态(周期常量 / 抖动 / 退避)

**[事实]** 常量表:

| 量 | 值 | 位置 |
|---|---|---|
| 循环空转 tick | `TICK_SECONDS = 5.0` | `autonomous.py:55` |
| 廉价 tick 间隔 | `CHEAP_TICK_INTERVAL_S = 600.0` | `mind/reflow.py:46` |
| 休息下限/默认/上限 | `MIN_REST_MIN=5` / `DEFAULT_REST_MIN=30` / `MAX_REST_MIN=360` | `autonomous.py:51-53` |
| 小时行动上限 | `HOURLY_ACTION_CAP = 20` | `mind/snapshot.py:57`(autonomous.py:54 转引) |
| 层1 整合节律 | `INTEGRATION_EVERY_WAKES = 24` | `mind/integrator.py:50` |
| 层2 专注节律 | `FOCUS_EVERY_WAKES = 24×1` | `mind/focus.py:59-63`(派生自层1) |
| 聊天让路窗口 | `LYKOI_INTERACTIVE_WINDOW_S`,默认 120s | `shared/interactive_lock.py:27` |

**[事实] 没有抖动**。全树 grep 无 jitter/random 参与调度。下一拍时刻 = `clamp_rest(decision.next_wake_after_minutes)`(`autonomous.py:61-67, 106-107`),即**由模型自己在 5–360 分钟里挑,代码只夹逼**;模型给非 int → `DEFAULT_REST_MIN=30`。

**[事实] 退避只有一种,且是常量**:`wake()` 抛异常 → `next_wake = _compute_rest(DEFAULT_REST_MIN)`(:166),不指数、不累积。小时预算耗尽也是同一个 30 分钟(:138)。

**[事实]** `_due()`(:205-211):`next_wake_at` 为 None **或解析失败** → 立即到期。首次开机 `run_forever` 先写一个 `MIN_REST_MIN`(5 分钟)的 next_wake(:215-216)。

**[事实] 虚拟时钟**:所有时间读经 `shared/clock.now()`,三档 regime(PRODUCTION / COMPRESSED_LIVE 速率 N / COMPRESSED_DETERMINISTIC 步进)。**[事实]** `clock.py:19` 的模块文档写"stepped 的 virtual_now 由 autonomy supervisor 独家写",但 `advance_to`/`step` 在 `src/` 里**零调用**,唯一调用方是 `scripts/p4r_compressed_harness.py:244/351/360/368`。**[推断]** 即在 COMPRESSED_DETERMINISTIC 下,长驻的 `run_forever` 会永远读到同一个 virtual_now 而不推进——该 regime 今天只服务于离线 harness,不是可用的生产形态。文档与代码在此处不一致,**如实记录**。

### 1.3 每周期做什么(文字版时序)

```
run_forever(stop)                                    [autonomous.py:213-245]
│  log_event("autonomy_loop_start")
│  if get_autonomy_next_wake() is None: set(+5min)
└─ while not stop.is_set():                           ← 每 5s 一转
   │
   ├─(A) 廉价 tick 闸:now - last_cheap_tick >= 600s ?     [:221]
   │     └─ mind_reflow.cheap_tick()                     [reflow.py:341-384]
   │        ├─ 未决主动联系 > 24h 未回 → apply_regulation_cause("contact_unanswered")
   │        │                            + record_experience("silence", 0.6)
   │        └─ 沉默异常(>=12h 且 > 2×中位间隔 且 该时段通常活跃,每个沉默期只落一次)
   │              → record_experience("silence") + apply_regulation_cause("owner_silence_anomaly")
   │        ※ 零 LLM,纯时间比较;异常被吞 → log_event("cheap_tick_failed")
   │
   ├─(B) _due(get_autonomy_next_wake()) ?                 [:227]
   │  └─ await wake()                                     [:134-202]
   │     ├─ should_yield_to_chat() → interactive_lock.is_active()   [:100-101]
   │     │     真 → return {"status":"yielded"}   ★不写 next_wake、不 bump 计数
   │     ├─ hourly_cap_reached() → autonomy_actions_last_hour() >= 20 [:103-104]
   │     │     真 → next_wake=+30min, set_autonomy_next_wake, log("autonomy_rest")
   │     │            return {"status":"rested"}   ★同样不 bump 计数
   │     ├─ run_id = uuid4().hex; store.autonomy_start_run(run_id)   [:143-144]
   │     ├─ 【感知】_perceive()                                       [:110-126]
   │     │    ├─ mind_snapshot.assemble()          ★内含四处写(见 ③)
   │     │    ├─ mind_decide.build_candidates(snap)  确定性候选表
   │     │    └─ 抽出本拍注意力域:念头 ids / 关切 ids / 叙事线 ids
   │     ├─ 【意义评估+选择】_autonomous_complete(messages)           [:74-95]
   │     │    ├─ self_state_shadow_audit.evaluate_and_log_shadow(consumer="autonomous")
   │     │    ├─ self_state_live_audit.evaluate_and_log_live_injection(...)
   │     │    │     非 None → 在末条 user 消息前插一条 self-state system 消息
   │     │    └─ llm_router.complete(AUTONOMOUS_COGNITION, messages)   ★本拍唯一必发的 LLM 调用
   │     ├─ mind_decide.evaluate_message(...)                        [decide.py:529-620]
   │     │    严格解析 + 确定性护栏(见 1.4)
   │     ├─ 【执行+回流】mind_reflow.execute_and_reflow(decision, run_id, counts)
   │     │    ├─ _light_grounded_concerns(...)  二次活体校验后 light_concern
   │     │    ├─ record_experience("wake_action", ...)  (必落)
   │     │    ├─ 按 kind 分支:rest / record_note / tend_inner / explore /
   │     │    │   contemplate / initiate_chat / queue_notification
   │     │    │   ——后三类里只有 explore/initiate_chat/queue_notification 走 kernel.dispatch
   │     │    │     (origin="autonomous"),其余全是内部副作用
   │     │    └─ record_experience("action_result", ...)  (必落,失败/落空也落)
   │     ├─ mind_decide.apply_inner(decision.inner, source="wake", ...)  ★在执行之后
   │     ├─ next_wake = clamp(decision.next_wake_after_minutes)
   │     ├─ store.autonomy_finish_run(run_id, status, decision_json, counts...)
   │     ├─ store.set_autonomy_next_wake(next_wake, last_wake_at=now)
   │     ├─ mind_store.bump_wakes_since()        ★层1/层2 两个计数器都在这里 +1
   │     └─ log_event("autonomy_wake", ...)
   │
   ├─(C) if result["status"] == "completed":              [:233]
   │     ├─ await _maybe_integrate()      层1 · 整合(她的睡眠)   [:247-265]
   │     │    ├─ should_integrate():pending>0 且 (wakes_since>=24 或 load 触发 early)
   │     │    └─ run_integration() → 1 次 AUTONOMOUS_COGNITION 调用(temp 0.2, max 4096)
   │     └─ await _maybe_focus()          层2 · 专注思考              [:267-293]
   │          ├─ maybe_run_focus_cycle():focus_wakes_since >= 24
   │          │    └─ 至多 1 次 AUTONOMOUS_COGNITION 调用(temp 0.2, max 2048);
   │          │       召回为空 / 无可选关切 → 零调用
   │          └─ 周期真跑了才 suggestion_conversation.maybe_ask_owner(cycle_id)
   │               → 可能再 1 次 MAIN 路由调用 + 一次 messenger 主动开口
   │
   └─(D) await wait_for(stop.wait(), timeout=5.0)  → 下一转
```

**[事实] 三处静默的语义分叉,值得单独钉住**:

1. `yielded` 与 `rested`(hourly_cap)**都不调用 `bump_wakes_since()`**——只有 `wake()` 走到成功(:187)或异常(:171)路径才 +1。**[推断]** 于是"层1/层2 每 24 拍一次"计的是**真正发起过一次 LLM 决策的拍**,不是墙钟拍。聊天密集期或行动预算打满的日子,整合与专注会跟着一起延后。这是设计选择还是副作用,代码里没有断言,**注释也没有交代**。
2. `_maybe_integrate`/`_maybe_focus` 只在 `status == "completed"` 时跑(:233),但失败拍已经 `bump_wakes_since()` 了(:171)。**[推断]** 于是一晚上如果最后一拍恰好失败,层1/层2 就顺延到下一拍——不丢计数,只丢那一次机会。无害,但是隐式的。
3. `yielded` 不改 `next_wake_at`(:136)。**[推断]** 聊天活跃期内,循环每 5s 重新判一次 `_due` 为真 → 重新 `should_yield_to_chat` 为真 → 立即返回。这是**廉价的**(一次 `os.path.exists` + 小 JSON 读),但意味着聊天窗口一结束,积压的那一拍**立刻**触发,没有缓冲。

### 1.4 `evaluate_message` / `apply_inner` 的自主侧消费

**[事实]** `evaluate_message`(`mind/decide.py:529-620`)是**两个情境共用的解析器**,自主侧走全默认参数:

- `kinds = KINDS`(7 种:explore/record_note/queue_notification/initiate_chat/tend_inner/rest/contemplate,`decide.py:36`);
- `content_required = ("record_note","queue_notification","initiate_chat","tend_inner")`(:42)——contemplate 刻意不在内;
- `safe_kind = "rest"`(:48);
- `envelope_fields = ()` → 自主侧 `Decision.envelope` 恒为 `{}`,被 `as_dict` 的丢弃表滤掉(:112-120),持久化字节不变。

护栏(**不可参数化**,注释在 :551-562 明说这是纪律不是词汇):
- 非 JSON / 未知 kind / 缺必填 content → **raise ValueError** → 这一拍记 `failed`;
- reason 未**逐字**引用 meaning_assessment 任一 item/meaning(>=4 字,`grounded_entries` :362-372)→ `_demote` 到 rest,落 `decision_ungrounded`;
- kind 不在本拍候选表 → 同样 demote;
- `safe_kind` 自身**永不 demote**(:613-614);
- 三个快照注意力域闸(念头/关切/叙事线)全部 **fail-closed**:空集合 = 丢弃全部 id(`_sanitize_assessment` :333-359、`_gated_int` :379-388、`_sanitize_inner` :450-459)。

`apply_inner`(:464-526)自主侧调用点在 `autonomous.py:161-163`,`source="wake"`:
- **位置刻意在 `execute_and_reflow` 之后**(:158-160 注释):畸形 inner 不能影响决策执行;
- 函数**永不抛**,失败落 `rejected_create`/`rejected_resolve`;
- resolve 有**两道闸**:parse 层(`_sanitize_inner` 按注入集过滤)+ store 层(`thoughts.resolve_thought(injected_ids=...)`);
- 事件名由 `source` 派生(:516-525):`wake_inner_applied` / `conversation_inner_applied`。

### 1.5 缺口清单(对照工单字面的 Cordis 双时钟)

> 提醒:白皮书 10.3 原文与 Cordis 双时钟定义**我没读到**(§0)。以下三条按工单给出的字面语义写,原文核对留给治理侧。

| # | 目标形态(工单字面) | 今天的现状雏形(代码行) | 差多远 |
|---|---|---|---|
| **缺口1** | **显式心脏调度件** ——一个可被独立观测/替换/计量的调度实体 | **没有实体**。调度是 `run_forever` 里的一段内联 while(:218-244),状态就两样东西:`autonomy_state.next_wake_at`(memory.db 单行,`memory/store.py:73-79`)+ 进程内局部变量 `last_cheap_tick`(:217)。"下一拍何时"由上一拍的 LLM 输出决定,没有第三方能查询/注入/抢占。**最接近的现成骨架是 `cognition/scheduler.py`**——它已经有 `ScheduledTask(name, interval_seconds, run, run_immediately)` 数据类(:49-54)和 `TASKS` 注册表(:140-143),但那是 surface 进程里的、只允许 `notify.owner` 的运维调度器,**与自主循环完全不通** | 中等偏大:需要把"何时醒"从 LLM 输出里抽出来,变成调度件的状态。今天 `clamp_rest` 是唯一的确定性夹逼(:61-67),它就是未来调度件唯一已存在的策略面 |
| **缺口2** | **调度侧显著性唤醒**(事件显著性直接驱动一次周期) | **完全没有**。全树无任何"消息/事件 → 唤醒自主循环"的通路(见 ②)。**唯二相关的雏形**:(a) `mind/salience_shadow.py` 已经在为每条经验模拟"会不会呈现(selected)"并落独立 sidecar(`salience_shadow.db`),挂钩点在 `mind/store.py:776-777`,**只记不影响任何行为**;(b) Core 侧 `attention_candidate`/`attention_decision` 有一整条 attend/decline 判定流水线(`core/shadow.py:2824+`),但它的产物 `attention_decisions` 表**今天零消费者**(prereg 的验收条件里明写 `consumer absent`,`docs/core_v1_m3_r1c_decision_activation_prereg_v1.md:112`) | 大:两条显著性流水线都已建成且都是影子,**但它们各自的输出都还没有一个"能被唤醒的东西"去接**。缺的正是缺口1 那个调度件 |
| **缺口3** | **tick 积压合并** | **没有 tick 队列,所以也没有"合并"这件事**。调度状态是单一时间戳 `next_wake_at`,错过的拍**隐式坍缩**:停机 6 小时后重启,`_due` 为真,只醒一次,没有任何地方记录"漏了 N 拍"。最接近的补偿是 `cognition/restart.py:157-206` 的重启事件——它把停机时长(`_systemd_downtime`)写进 history,并在快照里以「刚刚醒来」呈现(`snapshot.py:349-351`),**但那是给她看的叙事,不是调度账** | 小到中:坍缩语义今天是"免费"的(时间戳模型天然如此),真正缺的是**可观测性**——没有任何计数说明这次醒来代表了几个应有周期。若换成队列模型,反倒要显式实现合并策略 |

**[建议]**(素材,非拍板):缺口1 是另外两个的前提。缺口2 的两条影子流水线(salience_shadow / attention_decision)在"谁来接"这件事上是重复投资,C-B 设计时需要明确二选一或分层,否则会出现两套显著性口径。

---

## ② 唤醒路径清点

### 2.1 今天能触发"一次认知周期"的全部路径

先厘清一件容易混的事:**"一次认知周期"在今天有两种,分属两个进程,互不唤醒。**

| # | 路径 | 进程 | 入口代码行 | 触发条件 | 节流 |
|---|---|---|---|---|---|
| **P1** | 自主拍(wake) | lykoi-autonomy | `autonomous.py:227-228` | `clock.now() >= next_wake_at` | 5s 轮询粒度;`interactive_lock` 让路;`HOURLY_ACTION_CAP=20`;`clamp_rest[5,360]` |
| **P2** | 廉价 tick | lykoi-autonomy | `autonomous.py:221-226` | 距上次 >= 600s | 进程内变量,重启即清零 |
| **P3** | 层1 整合 | lykoi-autonomy | `autonomous.py:234` | P1 completed **且** `pending>0` **且** (`wakes_since>=24` 或 load 触发 early) | `INTEGRATION_EVERY_WAKES=24`;`INTEGRATION_CAPACITY_K=30` 条/次 |
| **P4** | 层2 专注 | lykoi-autonomy | `autonomous.py:240` | P1 completed **且** `focus_wakes_since>=24` | `FOCUS_EVERY_WAKES=24`;`finally` 里**无条件**清零计数(`focus.py:385-390`) |
| **P5** | 规则建议问询 | lykoi-autonomy | `autonomous.py:287` | **仅当 P4 真跑了周期** | "每周期至多问 1 条"由节律保证(:277-278);外加 messenger 日1条/冷却6h |
| **P6** | 对话周期 | lykoi-server / lykoi-telegram | `conversation.py:1619`(主)、`:1199` | Kevin 发来消息 | 无频率节流(人类速率即节流);`ContextBudgetError` 是上下文长度闸,不是频率闸 |
| **P7** | 对话影子周期 | 同 P6 | `conversation_cycle.py:558` | 与 P6 同拍,env 开关 | 见 C-A 后半;**每轮对话多一次 LLM 调用** |
| **P8** | 运维调度器 | lykoi-server | `scheduler.py:155-164` | health 每 1800s(启动即跑一次)、pending_reminder 每 3600s | 固定间隔;1s tick 粒度;能力面只有 `notify.owner` |
| **P9** | Core 维护 tick | lykoi-core | `runtime.py:1258-1264` | 每 `maintenance_interval_seconds` | decision/candidate/execution 三种模式各 2.0s;三者同时开时取 `min` |
| **P10** | 运行时注册刷新 | 三服务 | `runtime_client.py:39` | 每 30s | — |
| **P11** | Telegram 长轮询 | lykoi-telegram | `telegram_device.run_forever` | 长轮询 + outbox 游标 | 传输层退避 |

### 2.2 相互关系

**[事实] P1 与 P6 是单向抑制,不是互相唤醒。**
- 对话进来 → `conversation.py:649` 和 `:720` 各调一次 `interactive_lock.mark_active()`(收到时 + 完成时),写 `interactive_activity.json` 的 `active_until = now + 120s`;
- 自主侧 `should_yield_to_chat()` 读该文件(`interactive_lock.py:38-48`),真就让路;
- **反向没有任何通路**:一条消息**不会**把 `next_wake_at` 提前,也不会往自主循环投递任何东西。`set_autonomy_next_wake` 的全部调用者是 `autonomous.py:139/170/186/216`——**四处全在自主进程内**。

**[推断]** 所以工单 ② 问的"消息即时唤醒":**今天不存在**。消息触发的是 P6(对话进程里自己的一次完整认知),对自主循环的唯一影响是**压制它 120 秒**。两条认知路径经 `mind/reflow` 汇流到同一条经验流(`conversation_turn_reflow`,`reflow.py:294-322`),但那是**事后回流**,不是唤醒。

**[事实]** 两条路径共用 `evaluate_message`/`apply_inner`(WO-U3 ① 的参数化,`decide.py:551-562`),但对话侧的 `apply_inner` 调用在 `conversation.py:610`,`source="conversation"`;影子路径 `conversation_cycle` **刻意不调** `apply_inner`(:24 注释:避免污染旧路径的注入集)。

### 2.3 唤醒风暴的结构风险

**风险 A — `CORE_ATTENTION_DECISION_CYCLE` 每 2s 空转刷屏(工单点名的已知遗留)**

**[事实] 确切来源,三行**:

1. `core/attention_decision.py:17` — `DECISION_TICK_SECONDS = 2.0`;
2. `core/runtime.py:1495-1496` — decision_mode 下 `maintenance_tick = run_decision_worker`,`maintenance_interval_seconds = DECISION_TICK_SECONDS`;
3. `core/runtime.py:1488-1492` — **无条件** `print("CORE_ATTENTION_DECISION_CYCLE " + json.dumps(receipt.to_dict(), ...), flush=True)`。

**[事实] 对照组证明这是疏漏而非设计**:同一文件里另外两个 maintenance tick **都有条件闸**——
- candidate backfill:`if receipt.remaining == 0:` 才打印 COMPLETE,且 `candidate_backfill_done` 之后直接 return(`runtime.py:1513-1516, 1546-1554`);
- execution reconciliation:`if receipt.checked or receipt.marked_unknown:` 才打印(`runtime.py:1622-1627`)。

**[事实] 代价不止一行日志**。每 2s 一次 `run_attention_decision_cycle` 会:重新 `load_active_policy()` 并逐字节+SHA 比对(`runtime.py:1452-1459`)、`_connect_with_migration_target(synchronous="FULL")` 开新连接(`shadow.py:2865-2871`)、跑一次 `core_events LEFT JOIN attention_candidates` 的全量缺口计数(:2873-2881)、再跑一次 `attention_candidates JOIN core_events ORDER BY CASE...`(:2882-2889),**无论有没有 eligible candidate**。`DECISION_CYCLE_DEADLINE_MS = 50` 是单周期上限,不是空转豁免。

**[事实] 生效条件**:`decision_enabled()` 读 `LYKOI_CORE_ATTENTION_DECISION_ENABLED`,必须**恰好等于 "1"**,否则抛错(`attention_decision.py:29-37`);且要求 candidate 模式同开(`runtime.py:1403-1406`)。仓库里的 `lykoi-core.service` **不含**这些 env——它们由 drop-in 装:`/etc/systemd/system/lykoi-core.service.d/core-v1-m3-r1c-decision.conf`(`docs/core_v1_m3_r1c_decision_activation_prereg_v1.md:93-99`)。**[事实] 活体是否已装该 drop-in,我在本工作区查不到证据**(不碰运行中服务是本单 forbidden)。

**[建议] 去害,按侵入性从小到大**:

1. **最小、且与既有风格一致**:给 `run_decision_worker` 的 print 加与另两个 tick 同款的条件闸——仅当本周期"有变化"时打印(receipt 里已有可判定字段:selected/committed 计数)。改动面 = `runtime.py:1488-1492` 一处,**但会动 print 契约**,而 `tests/test_core_v1_runtime.py:1325` 正在断言这行,需同步改测试。
2. **零变化时降本**:在开 SQLite 连接**之前**加一个廉价前置判据(如 `state.cursor_queue_no` 未变且无新 candidate),空转直接 return。**注意**:这会改变"每周期重新校验 policy 哈希"这条安全属性的触发频率(`runtime.py:1450-1459` 的注释明写这是防 root 静默换字节),**不能顺手一起跳过**。
3. **纯运维**:journal 侧 RateLimit,不动代码。治标,且会连同真实事件一起吞。

**[建议]** 三选一是治理侧的事。我的判断是 1 最干净、影响面最可枚举;2 有安全语义副作用,不该在"降噪"这个由头下顺带做。

**风险 B — `_due` 的 fail-open**

**[事实]** `_due()`(`autonomous.py:205-211`)在 `next_wake_at` 无法 `fromisoformat` 时返回 True。**[推断]** 若 `autonomy_state.next_wake_at` 因任何原因写成脏值,循环会**每 5 秒发起一次完整的 wake()**——每次一发 LLM 调用。唯二的刹车是 `HOURLY_ACTION_CAP=20`,但那个 cap 数的是**行动**(`autonomy_actions_last_hour`),`rest`/`contemplate`/`record_note`/`tend_inner` 都不计入 `counts["action"]`(`reflow.py` 只在 explore/initiate_chat/queue_notification 三处 `counts["action"] += 1`)。**一连串 rest 决定可以无限期地每 5 秒烧一次 LLM 调用而永远不撞 cap。** 这是本报告发现的**最实在的唤醒风暴结构风险**。

触发它需要一个脏时间戳。**[事实]** `set_autonomy_next_wake` 的四个调用点都传 `_compute_rest()` 或 `_now()` 的 isoformat 输出,正常路径写不出脏值;`autonomy_state.next_wake_at` 声明为 `TEXT NOT NULL`,无 CHECK 约束(`memory/store.py:73-79`)。所以这是**低概率、高放大**的路径:需要外部改库、迁移事故或时钟 regime 切换配合。

**[建议]** 两个都便宜:(a) `_due` 解析失败时改为 fail-closed + 落一条 telemetry(而不是静默立即醒);(b) 在 wake 循环里加一条"最小拍间隔"地板(比如复用 `MIN_REST_MIN`),使**任何**路径都不可能让两拍间隔小于 5 分钟。(b) 顺带也覆盖了未来心跳件误配的情形。

**风险 C — 三个 2.0s tick 叠加**

**[事实]** `DECISION_TICK_SECONDS`、`BACKFILL_INTERVAL_SECONDS`、`RECONCILIATION_TICK_SECONDS` 全是 2.0(`attention_decision.py:17`、`attention_candidate.py:23`、`execution_session.py:33`),且 execution 模式会把间隔取 `min`(`runtime.py:1631-1634`),同时把前一个 tick 串在自己前面执行(`runtime.py:1587-1589`)。**[推断]** 三模式全开时,单个 2s 窗口里要串行跑完 backfill + decision + reconciliation 三段 SQLite 工作。今天有 `TimeoutError`/`sqlite_busy` 的重试分支兜底(各自 print RETRY 并 return),不至于崩,但**这是本报告注意到的、未来加心跳件时最容易踩到的邻居**——心脏若也用 memory.db 之外的 sidecar,还好;若共用,需要先量这三条 tick 的实际占用。

**风险 D — 无风暴的地方,记一笔**

**[事实]** P8(scheduler)1s tick 但只做时间戳比较,任务本身 30min/1h,且能力面被 `SCHEDULER_ALLOWED` 钉死在 `notify.owner`(`scheduler.py:6-10`)。P2 廉价 tick 600s 且零 LLM。这两条没有风暴风险。

---

## ③ 状态写通道清点(9.4 符合性)

> 提醒:白皮书 9.4 原文我没读到(§0)。本节给**代码事实矩阵**,"符合性"结论留治理侧。

### 3.1 持久 state 全景

**[事实]** 五个 SQLite 文件 + 十一个 JSON/JSONL:

| 文件 | 默认路径 | 拥有模块 | journal 模式 |
|---|---|---|---|
| `memory.db` | `/home/lykoi/state/memory.db` | `memory/store.py` + `mind/store.py`(同一文件、两个模块) | **默认 rollback journal**(全树无 `journal_mode=WAL`) |
| `salience_shadow.db` | 同目录 | `mind/salience_shadow.py` | **WAL**(`:204`) |
| `percept_buffer.db` | 同目录 | `mind/percept_buffer.py` | 默认;**零生产写者**(见 ⑦) |
| `core_facts.db` | 同目录 | `core/shadow.py:690` | 独立 epoch 锁机制 |
| `permission_evidence_shadow.db` | 同目录 | `core/permission_evidence_shadow.py` | 独立 |
| `events.jsonl` | 同目录 | `shared/log.py:21` | 追加,每次 open/write/close |
| `approval_rules.json` / `standing_grants.json` / `pending_actions.json` | 同目录 | `kernel/approval.py:40,238,593` | `file_lock` + `write_json_atomic` |
| `notifications.json` | 同目录 | `kernel/notifications.py:27` | 同上 |
| `chat_outbox.json` / `undelivered` | 同目录 | `shared/chat_outbox.py:26,136` | 同上 |
| `proactive_chat.json` | 同目录 | `shared/proactive_chat.py:19` | 同上 |
| `messenger_outbound.json` / `messenger_inbound.json` | 同目录 | `resources/messenger.py:131,226` | 同上 |
| `telegram_cursor.json` / outbox cursor | 同目录 | `resources/telegram_device.py:58,70` | 同上 |
| `interactive_activity.json` | 同目录 | `shared/interactive_lock.py:26` | `write_json_atomic`,**无 file_lock** |
| `clock.json` | 同目录 | `shared/clock.py:36` | `write_json_atomic`;stepped 模式下无生产写者 |

**[事实]** 事务纪律:`mind/store._connect()` 设 `isolation_level=None`(显式事务)、`foreign_keys=ON`、`busy_timeout=10000`,写全部经 `_tx()` 的 `BEGIN IMMEDIATE`(`mind/store.py:163-197`);`memory/store._connect()` 用 `busy_timeout=30000`(:33-39),注释明说是为了让 autonomy 的短读**等待** perception ingest 的有界写而不是崩掉。

**[事实] 无 WAL 的后果**:rollback journal 下,写者持锁期间读者被阻塞(靠 busy_timeout 等)。今天的写事务都很短,可接受;**这是 ⑤ 并发形态最需要先动的一块地基**。

### 3.2 表 × 写者矩阵(memory.db)

写者列:**A**=lykoi-autonomy,**S**=lykoi-server(uvicorn),**T**=lykoi-telegram,**C**=CLI/脚本。

| 表 | 写函数(单一入口) | 调用方模块:行 | 进程 | 单写者? |
|---|---|---|---|---|
| `history` | `memory/store.append_history` :133 | `conversation.py:689`;`restart.py:197` | **S,T,A** | ✗ 多进程 |
| `insights` | `memory/store.upsert_insight` :213 | `memory/seed.py:23`;`mind/focus.py:560` | **A**,C(seed) | ✓ 运行期单写者(A) |
| `health_metrics` | `memory/store.append_health_metric` | `scheduler.py:121` | **S** | ✓ |
| `autonomy_state` | `set_autonomy_next_wake` :321 | `autonomous.py:139/170/186/216` | **A** | ✓ **严格单写者** |
| `autonomy_runs` | `autonomy_start_run`:250 / `autonomy_finish_run`:260 / `autonomy_mark_stale`:292 | `autonomous.py:144/167/177/307` | **A** | ✓ **严格单写者** |
| `autonomy_notes`(append-only,触发器禁 UPDATE/DELETE :109-115) | `append_autonomy_note` | `reflow.py:137, 171` | **A** | ✓ |
| `experiences` | `mind/store.record_experience`:738 / `insert_experience_in_tx`:1281 / `mark_experiences_integrated`:1244 | `reflow.py:71`(唯一 Phase-2 写入点);`thoughts.py:56`(念头速朽);`integrator.py:689` | **A,S,T** | ✗ 三进程 |
| `regulation_field` + `regulation_events` | `apply_regulation_cause`:249 | reflow ×7、integrator ×5、snapshot:200 | **A,S,T** | ✗ 三进程 |
| `concerns` | `create_concern`:322 / `light_concern`:363 / `mark_dimming_dormant`:395 / `release_concern`:425 / `tend_concern_description`:467 | `reflow.py:107,134`;`integrator.py:612,620,779,797`;`focus.py:623,681`;`floor.py:118`;`snapshot.py:331`;`mind/seed.py:30` | **A**(+C) | ✓ 运行期单写者(A) |
| `narrative_versions` / `narrative_threads` | `add_narrative_version`:516 / `create_thread`:615 / `update_thread`:635 / `append_thread_progress`:672 | `integrator.py:736,790,814,827,834`;`reflow.py:131` | **A** | ✓ |
| `thoughts` | `mind/thoughts.py` 全部 | `decide.apply_inner`(:483,504);`snapshot.assemble → decay_all_open_thoughts` | **A,S,T** | ✗ 三进程(对话侧 apply_inner 在 S/T) |
| `integration_state` | `bump_wakes_since`:1517 / `reset_integration_cycle`:1544 | `autonomous.py:171,187`;`integrator.py:715` | **A** | ✓ **严格单写者** |
| `learning_layer_state` | `reset_focus_cycle`:1723 等 | `focus.py:387` | **A** | ✓ |
| `focus_cycles` | `open_focus_cycle`:1746 / `finalize_focus_cycle`:1767 | `focus.py:369,395` | **A** | ✓ |
| `focus_insight_state` / `focus_insight_history` | `record_focus_insight`:2074 / `set_focus_insight_status`:2126 | `focus.py:532,540,562,598,739` | **A** | ✓ |
| `concern_focus_state` | `update_concern_focus_state`:1884 | `focus.py:644,712` | **A** | ✓ |
| `product_lineage` | `record_lineage`:1946 | `focus.py:576,631`;`suggestions.py:114` | **A** | ✓ |
| `rule_suggestions` | `enqueue_rule_suggestion`:2249 / `mark_rule_suggestion_asked`:2434 / `resolve_rule_suggestion`:2468 | `suggestions.py:105`(A);`suggestion_conversation.py:196,234`(A);`:382,395`(**T**) | **A,T** | ✗ 两进程 |
| `environment_ingest_state` / `_receipts` / `environment_core_event_outbox` / `_deliveries` | `record_environment_event`:787 / `mark_environment_core_events_delivered`:1089 | `surface/perception.py:162` | **S** | ✓ |
| `owner_edits`(**不落 events.jsonl**,`store.py:10-14` 明写这是红线 #4 的构造性保证) | `owner_edits_log`:1564 | 无生产调用方 | — | — |
| `users`/`contexts`/`context_members`/`identity_bindings`/`memory_scopes`/`procedures`/`experience_class`/`note_insight_links`/`mind_schema` | 迁移/查表为主 | `migrations.py` | — | — |

### 3.3 逐条核:已知的受治理写者白名单

**[事实] `mind/focus.py`(层2)——安全边界在模块文档 :14-25 明写,代码逐条核实通过**:
- 声明只读的四个领域:叙事、情绪调节、审批/权限、messenger;
- 核实:focus.py 的 import 表(:41-52)**不含** `regulation`(只经 integrator 间接引常量)、不含 messenger、不含 kernel.approval;
- 核实:**全文零 `apply_regulation_cause`**(grep 确认,唯一出现在 :17 的注释里);
- 核实:唯一的对外出口是 `mind/suggestions` 的入队,往外问的那一半在 `kernel/suggestion_conversation`,由 `autonomous.py:287` 的编排层驱动——**模块自己不碰 messenger,属实**;
- 一个**边界内但值得记的越界感**:`focus.py:560` 调 `memory_store.upsert_insight` 写 `insights` 表。`mind/store.py:2018` 的注释明确交代了这是有意的("表由 memory/store 拥有,本模块不越界写它"),且刻意用了新类别 `FOCUS_INSIGHT_CATEGORY="focus"`,而 `memory/persona.py` 只投影 persona/preference 两类 → **影子期不进任何下游有结构性保证,不只是约定**(:88-92)。核实通过。

**[事实] `mind/reflow.record_experience`——"Phase-2 唯一的经验写入点"这条纪律基本成立,但有两个合法旁路**:
- 旁路1:`mind/thoughts.py:56` 直接用 `insert_experience_in_tx`(念头速朽落痕),因为它在 memory.db 的事务中途,**不能**再开一个;`salience_shadow.py:43` 的注释明确认领了这个例外(该路径不挂显著性钩子);
- 旁路2:`integrator.py:689` 的 `mark_experiences_integrated` 是 UPDATE 不是 INSERT,不冲突;
- **反例检验**:`resources/telegram_transport.py:178` 在传输层写经验时,**绕道回来**调 `mind_reflow.record_experience` 而不是直接碰 store,注释(:165-172)明确点名这是守单写者纪律。纪律被遵守,且被写下来了。

**[事实] `clock.json` 单写者**:`clock.py:19` 声明 autonomy supervisor 独家写。**代码里没有任何生产写者**(§1.2)。声明与现状不符,但方向是"更严",不是破。

**[事实] `interactive_activity.json` 是唯一不带 `file_lock` 的跨进程 JSON**(`interactive_lock.py:30-36` 只用 `write_json_atomic`)。**[推断]** 可接受:它是单字段、写者只有对话进程、读者只做时间比较,`os.replace` 的原子性足够,读到旧值的最坏后果是自主侧多让路/少让路一拍。**但如果 C-B 让心脏也参与写这个文件,就必须补锁。**

### 3.4 单写者原则的总账

**[事实] 严格单写者(单进程 + 单函数入口)**:`autonomy_state`、`autonomy_runs`、`autonomy_notes`、`integration_state`、`learning_layer_state`、`focus_*`、`concern_focus_state`、`product_lineage`、`narrative_*`、`concerns`、`health_metrics`、`environment_*`。

**[事实] 今天就是多进程写者(靠 `BEGIN IMMEDIATE` + busy_timeout 在 DB 层串行,不靠进程纪律)**:
1. `history` — S/T(对话)+ A(重启事件);
2. `experiences` — A(拍)+ S/T(对话回流、投递失败回灌);
3. `regulation_field` / `regulation_events` — 同上;
4. `thoughts` — A(wake 的 apply_inner)+ S/T(对话的 apply_inner);
5. `rule_suggestions` — A(入队/问询/过期)+ T(Kevin 的回答落账)。

**[推断]** 这五张表是"经验层是共享的"这个设计的直接后果,不是疏漏——`reflow.py:23` 明写"对话路径在这里汇入同一条流"。它们的正确性今天完全依赖:(a) 每个写操作都是一次 `BEGIN IMMEDIATE` 的短事务;(b) 读-改-写不跨事务。**我抽查了 `apply_regulation_cause`(:249)与 `light_concern`(:363),两者的读-改-写都在同一个 `_tx` 内,成立。**

---

## ④ 费用画像(口径,不读数)

### 4.1 计量的产生点:**唯一一处**

**[事实]** 全树只有一个地方产生费用记录:`cognition/llm_client.py:152-161`,在 `chat_completion` 收到 200 且解析成功之后:

```python
usage = body.get("usage") or {}
log_event("llm_call",
    route=cfg.route, model=cfg.model, message_count=len(messages),
    prompt_tokens=..., completion_tokens=...,
    cache_hit_tokens=usage.get("prompt_cache_hit_tokens"),
    cache_miss_tokens=usage.get("prompt_cache_miss_tokens"))
```

**[事实] 落点是 `events.jsonl`,不是任何表**。`log_event`(`shared/log.py:24-33`)每次 open-append-close,经 `redact_obj` 脱敏。**没有任何聚合、没有任何汇总表、没有任何脚本读它**(grep `llm_call` 在 `scripts/` 与 `docs/*.md` 下零命中)。

**[事实] 三个漏计口子**:
1. **重试不计**:`llm_retry`(:139-145, :166-172)是独立事件,不带 usage;一次 429 重试打三遍,只有成功那遍进 `llm_call`。上游 provider 对失败的计费(如有)完全不在账内;
2. **失败不计**:`llm_error`(:176, :189-195)不带 token;
3. **`message_count` 不是 token**:prompt 大小只能靠 provider 回的 `prompt_tokens`,若 provider 不回 usage,四个字段全是 `None` 而事件照落。

### 4.2 route 标签全集

**[事实]** 四个,定义在 `cognition/llm_router.py:23-30`:

| route | 常量 | 模型来源 | max_tokens | thinking | 使用点 |
|---|---|---|---|---|---|
| `main` | `MAIN` :23 | `LYKOI_MAIN_MODEL`,默认 `deepseek-v4-flash` | 4096 | 默认 `disabled` | `conversation.py:1200,1619`;`suggestion_conversation.py:305`;`approval_interpreter.py:361` |
| `vision` | `VISION` :24 | `LYKOI_MIMO_MODEL`,默认 `mimo-v2.5` | 8192 | — | `conversation.py:1435`(`describe_image`) |
| `autonomous_cognition` | `AUTONOMOUS_COGNITION` :25 | `LYKOI_AUTONOMOUS_MODEL` → 回落 MAIN | **2048** | 继承 MAIN | `autonomous.py:95`;`integrator.py:508`;`focus.py:270` |
| `conversation_shadow` | `CONVERSATION_SHADOW` :30 | `LYKOI_SHADOW_MODEL` → 回落 MAIN | 4096 | 继承 MAIN | `conversation_cycle.py:559` |

**[事实]** `conversation_shadow` 的注释(:26-29)明确声明**不许复用 main 标签**:main 是 WO-U2 的实验组、autonomous_cognition 是对照组,影子混进任何一边都会污染对比。这是本代码库里**唯一一处把 route 标签当作会计科目来治理**的地方——是费用口径已有的先例。

**[事实]** `conversation_shadow` 是唯一带 `response_format={"type":"json_object"}` 的路由(`llm_router.py:76,162`,默认开,kill switch `LYKOI_U3_SHADOW_JSON_MODE`)。

### 4.3 origin 标签全集(三个命名空间,不要混)

**[事实]**
1. **dispatch origin**(`kernel/dispatch.py:224`,`Literal`,**无默认值,每次 dispatch 必须声明**):`interactive` | `autonomous` | `scheduler` | `system`。它决定能力面(`dispatch.py:145`:autonomous 与 scheduler 映射到各自的 executor claim)。**与费用无关**——它管的是权限,不是钱。
2. **notification origin**(`kernel/notifications.py`):`autonomous` 是受 `AUTONOMOUS_DAILY_CAP` 治理的那一档(`reflow.py:273` 按它筛未决呼唤)。
3. **concern origin**(`mind/store.py:51-52`):`seed`/`grown`/`relationship`/`floor`/`emergent`/`owner_directed`/`derived`。与费用无关。

**[事实] `llm_call` 事件本身不带任何 origin 字段**。**[推断]** 于是今天**无法从 events.jsonl 把一次 LLM 花费归因到一次 dispatch / 一次 wake / 一次 run_id**——只能按 route + 时间戳粗对。这是费用画像今天最大的口径缺陷。

### 4.4 四数字段语义

**[事实]** 全部直取 provider 的 `usage` 对象,**代码不做任何加工或换算**:
- `prompt_tokens` — 本次请求输入侧计费 token 总数;
- `completion_tokens` — 输出侧;
- `cache_hit_tokens` ← `prompt_cache_hit_tokens` — DeepSeek 扩展字段,输入里命中前缀缓存的部分(通常计价更低);
- `cache_miss_tokens` ← `prompt_cache_miss_tokens` — 未命中部分。

**[推断]** 恒等式 `cache_hit + cache_miss == prompt_tokens` 是 provider 侧的约定,**代码不校验**。非 DeepSeek 路由(vision/MiMo)这两个字段会是 `None`。**没有任何单价表、没有任何金额换算**——本仓库里"费用"永远是 token 计数,不是钱。

### 4.5 心脏引入更高唤醒频率时,费用敞口在哪几个调用点

**[事实] 按"每多一拍"计的边际成本**:

| 调用点 | 每拍次数 | route | max_tokens | prompt 侧规模驱动因素 |
|---|---|---|---|---|
| `autonomous.py:95` `_autonomous_complete` | **1,必发** | autonomous_cognition | 2048 | 快照全量(`snapshot.assemble`)+ persona kernel + acquired insights + DECIDE_SYSTEM_PROMPT + 候选表 |
| `integrator.py:508` | 1/24 拍(且需 pending>0) | autonomous_cognition | 4096 | 至多 `INTEGRATION_CAPACITY_K=30` 条经验 + 关切 + 叙事 + 念头流 |
| `focus.py:270` | 1/24 拍(召回非空时) | autonomous_cognition | 2048 | `RETRIEVAL_LIMIT=20` 条 × `MATERIAL_CONTENT_CHARS=600` + `EXISTING_INSIGHT_LIMIT=20` |
| `suggestion_conversation.py:305` | ≤1/焦点周期 | **main** | 4096 | 小 |

**[推断] 敞口结论**:唤醒频率翻 N 倍,**主敞口是 `autonomous.py:95` 线性翻 N 倍**;层1/层2 因为闸读的是 wake 计数(不是墙钟),**也会跟着翻 N 倍**——`INTEGRATION_EVERY_WAKES`/`FOCUS_EVERY_WAKES` 是"每 24 拍",不是"每 24 小时"。**这是最容易被忽略的一条**:把心跳从 30 分钟改到 5 分钟,不只是决策调用 ×6,整合与深挖也 ×6,而后两者的 prompt 是三者中最大的。

**[事实] 三个非 LLM 但随频率线性增长的次要敞口**(不烧钱,烧 IO/锁):
- `snapshot.assemble()` 每拍四处写(见 ⑤);
- `_autonomous_complete` 每拍两次 self-state 审计(`autonomous.py:78-85`),各自读 self-state 源并算多个 SHA;
- 每拍必落 2 条 experience(wake_action + action_result),每条又触发 `experience_recorded` 的调节场写 + salience_shadow sidecar 写。**心跳频率 × 2 就是经验流的注入速率**,而层1 的消化能力是 30 条/周期——**频率提高会直接把 `experience_backlog` 推上去**(阈值 `BACKLOG_PRESSURE_THRESHOLD = 3×30 = 90`,`integrator.py:57`)。这条比费用更值得 C-B 提前算。

### 4.6 12.3 / 22.2 预算硬策略"今天在代码里的实际执行机制"

> 提醒:12.3/22.2 原文我没读到(§0)。以下是代码侧**全部**的强制点。

**[事实] 最重要的一条:代码库里没有任何"钱/token 预算"的强制机制。** grep `budget|cost|预算|费用|quota|spend`(排除 `max_tokens` 等)的结果里,**没有一处**是按 token 或金额拒绝调用的。`ContextBudgetError`(`surface/app.py:18,243`)是上下文长度闸;`shadow.py` 的 `ARTIFACT_QUOTA_BYTES` 是磁盘配额;其余全是"打扰预算"。**唯一与 token 有关的硬约束是每路由的 `max_tokens` 上限**(`llm_client.py:114-116`:"no call is unbounded"),那是**单次输出封顶**,不是累计预算。

**[事实] 实际存在的硬策略,五条,全是"行动/打扰"口径**:

| 策略 | 数值 | 强制点(代码行) | 强制形态 |
|---|---|---|---|
| 自主小时行动上限 | 20 | `autonomous.py:103-104` + `memory/store.autonomy_actions_last_hour:301` | 前置闸,撞上直接 rest 30 分钟;同时经 `snapshot.py:155` 诚实呈现给她 |
| 通知日上限 / 冷却 | 2/日,2h | `kernel/notifications.py:33-34, 57-60` | 内核 throttle;被拦下**返回成功但 `queued=False`**,她体验为结果而非异常(`reflow.py:250-252`) |
| 主动开口日上限 / 冷却 | 1/日,6h | `shared/proactive_chat.py:20-21, 55-68` | `file_lock` 内**原子检查+占用**,重启不清零;快照读 `remaining_today()` |
| messenger 打扰预算 | 1/日,6h | `resources/messenger.py:127-128, 153-160` | 独立账本;回复 Kevin(`reply_to` 非空)不计 |
| 环境摄入 | 200/日,60/分钟 | `mind/store.py:37-38` | ingest 侧硬顶 |

**[事实]** 这些上限**模型绝对绕不过**:`build_candidates`(`decide.py:140-239`)在预算耗尽时**把对应 kind 从候选表里删掉**(:180-185),而 `evaluate_message` 又把"选了不在候选表里的 kind"降级为 rest(:615-617),内核 throttle 是第三道。三层。

**[建议]**(素材)若 12.3/22.2 要求的是**费用**硬策略,那么今天的实现与之的距离是:**从零开始**。已有的可复用件是 (a) `proactive_chat.try_send()` 那个"file_lock 内原子检查+占用+有界账本"的形态——它是本仓库里最干净的配额原语;(b) route 标签作为会计科目的先例(§4.2)。缺的是:`llm_call` 事件带 run_id/origin 归因、一张按 route 的滚动累计账、以及一个在 `llm_router.complete` 之前的前置闸。

---

## ⑤ 9.4 尾注重评素材

> 本节按工单字面的目标形态(**快照并行推演 + 仲裁器唯一写者 + 议程项租约**)组织。**结论留治理侧与 Kevin**;这里只给清单、边界与冲突点。

### 5.1 需要租约覆盖的议程项类型清单

判据:一个议程项需要租约,当且仅当**两个并行推演分支同时认领它会产生不可合并的结果**。逐类过:

| # | 议程项类型 | 现状标识/位置 | 需要租约? | 理由(代码依据) |
|---|---|---|---|---|
| L1 | **一拍决策本身**(run) | `autonomy_runs.id`(uuid4,`autonomous.py:143`) | **需要** | 已有单例锁(flock)在进程级保证,但那是"只有一个推演者";并行推演下需要降级为 run 级租约。已有 `autonomy_mark_stale()`(:307)是崩溃回收的雏形——**它今天的语义正是一个没有到期时间的租约**:进程重启时把所有 `running` 行标 stale |
| L2 | **关切**(concern) | `concerns.id` | **需要** | 三个写路径可同时认领同一条:`light_concern`(reflow/focus/integrator)、`tend_concern_description`、`release_concern`。特别是 `release_concern` 与 `light_concern` 并发 = 语义冲突(一边释放一边发光) |
| L3 | **念头**(thought) | `thoughts.id` | **需要** | `resolve_thought` 是幂等消费型操作,两个分支同时 resolve 同一 id 会各自认为自己了结了它。今天靠"注意力域"(只能 resolve 本拍快照里见过的 id)间接收窄,但**并行分支吃的是同一份快照,注意力域完全重合** ——这条闸在并发下**失效** |
| L4 | **叙事线**(thread) | `narrative_threads.id` | **需要** | `update_thread(status=...)` 是状态机迁移,并发写后写者胜 |
| L5 | **待消化经验批次** | `experiences.integrated` + `mark_experiences_integrated(ids, integration_id)` :1244 | **需要** | 层1 的取料是"原料池 ∩ 未消化 ∩ 水位线之上";两次并行整合会重复消化同一批 |
| L6 | **焦点周期 / 深挖关切** | `focus_cycles.id` + `concern_focus_state` | **需要** | `open_focus_cycle` 已经先落行拿序号(:369),是租约的天然锚点;反刍计数(streak/cooldown)是读-改-写 |
| L7 | **规则建议**(rule_suggestion) | `rule_suggestions` + `mark_rule_suggestion_asked` :2434 | **已经有了** | `mark_rule_suggestion_asked` 的返回值叫 `claimed`(`suggestion_conversation.py:196`)——**这就是一个租约认领**,今天已经在跨进程用(A 问 / T 答)。它是本仓库**唯一现成的议程项租约实现**,C-B 应该照它抄 |
| L8 | **打扰配额**(通知/主动开口) | JSON 账本 | **不需要租约,已有更强的** | `proactive_chat.try_send()` 在 `file_lock` 内做原子检查+占用(:55-68),`notifications` 同法。这是"配额"不是"议程项",两个分支同时想说话,**第二个应当被拒**,而不是排队 |
| L9 | **调节场**(regulation_field) | 4 个变量单行 | **不需要租约,但需要合并策略** | 它不是议程项,是累加量。`apply_regulation_cause` 按名查表取 delta(`conversation_cycle.py:245` 注释:"幅度不由调用方给"),所以两个分支各自 +delta 在数学上可合并。**但"哪些 cause 该在被否决的分支上仍然生效"是语义问题,不是并发问题** |
| L10 | **心跳/下一拍时刻** | `autonomy_state.next_wake_at` 单行 | **不需要租约** | 单行、仲裁器唯一写者即可 |

### 5.2 快照一致性边界

**这是本节最要紧的发现。**

**[事实] `mind/snapshot.assemble()` 不是只读函数。** 它在读任何块之前先做四件**写**(`snapshot.py:328-336`):

```python
mind_store.mark_dimming_dormant(now=moment)      # 写 concerns.status
mind_floor.maintain(now=moment)                  # 可能 create_concern  (floor.py:118)
_apply_lazy_overdue_penalty(moment)              # 写 regulation_events + regulation_field (:200)
mind_thoughts.decay_all_open_thoughts(now=moment)# 写 thoughts,可能 insert experiences (thought_lapse)
```

注释(:322-327)明确交代这是有意的:"感知期维护先做,好让各块看到 tick 后的状态"。

**[推断] 对并行推演的直接后果**:"取一份快照,分发给 N 个分支并行推演"这句话在今天的代码里**做不到**,因为取快照这个动作本身就是一次状态变更。**必须先把 `assemble()` 劈成两半**:

- **`maintain()`** — 老化/地板/超龄/衰减,是**仲裁器的活**,每个心跳恰好做一次;
- **`read()`** — 纯读,可以被 N 个分支共享同一份结果。

这是 C-B 在快照层的**第一个必做改动**,而且它是**纯重构**(不改语义、不改顺序),可以独立于任何并发形态先做、先测。

**[事实] 哪些读路径可以吃旧快照 / 哪些不行**——逐块过 `assemble()` 的产物(:337-348):

| 快照块 | 数据源 | 可吃旧快照? | 依据 |
|---|---|---|---|
| `调节场` | `regulation_field`(懒衰减,`get_regulation` :206-209 注释"读不写") | **可以** | 连续量,分支间小幅漂移不改变候选表结构(阈值判定除外,见下) |
| `coherence_low` / `effects` | `regulation.cognitive_effects(values)` | **不可以(临界时)** | 它决定**候选表的形状**(`decide.py:157-185`:`force_inner_tending` / `prefer_rest` 直接删 kind)。值恰好跨阈值时,两个分支会拿到不同的合法动作集 |
| `关切` | `concerns` | **不可以** | 见 5.1 L2;且 `_light_grounded_concerns`(`reflow.py:96-107`)已经**在存储期做了一次二次活体校验**——注释明说这是"比照 apply_inner→resolve_thought"的第二道闸。**这个模式就是快照陈旧性的正确解药,C-B 应当推广到全部议程项类型** |
| `叙事` | `narrative_versions`/`threads` | 可以读、**不可以据此写** | 同上 |
| `经验` | `experiences` 近期若干 | **可以** | 只读展示 |
| `念头` | `thoughts` open 集 | **不可以** | 注意力域(`injected_thought_ids`)直接决定 resolve 合法性;见 5.1 L3 |
| `环境.预算` | 三个配额的**剩余数** | **绝对不可以** | `snapshot.py:155`(小时行动)、:178(通知)、`build_candidates` :150(主动开口)。**这三个数就是并发下最经典的 TOCTOU**:N 个分支各自看到"还剩 1",各自选了 initiate_chat。**今天的兜底是有效的**——`proactive_chat.try_send()` 的原子占用会让第 2..N 个拿到 `daily_cap`,而 `reflow.py:232-233` 把它翻译成"被脑干拦下"的经验。所以**并发不会破预算,只会浪费 LLM 调用并产生 N-1 条"被拦下"的经验**。这条要写进重评素材:破的不是安全,是**经验流的真实性**(她会经历 N-1 次并不真实的"我想说话但被拦下了") |
| `上一拍` | `autonomy_runs` 最近非 running 行 | **可以** | 只读 |
| `刚刚醒来` | 重启事件 | **可以** | 只读 |

### 5.3 与 ③ 矩阵的冲突点(全列)

按"引入快照并行推演 + 串行仲裁器唯一写者"这一形态,逐表标注**哪条通道会破单写者**:

| # | 表 | 今天的写者 | 并发形态下的破法 | 严重度 |
|---|---|---|---|---|
| **C1** | `experiences` | A + S + T | 推演分支若各自 `record_experience`,则被否决分支的经验也进了她的历史。**必须**把经验写入移出推演分支、只由仲裁器落 | **高**——直接污染唯一的真实性来源 |
| **C2** | `regulation_field`/`_events` | A + S + T | `record_experience` **内部就带一次** `apply_regulation_cause("experience_recorded")`(`reflow.py:74`)。C1 不解决,C2 自动破。另:`action_taken`/`rested` 在 `execute_and_reflow` 里(:165-168),同样在分支侧 | **高**——且是隐式耦合,容易漏 |
| **C3** | `thoughts` | A + S + T | `apply_inner` 在分支里跑就会创建/了结念头。**今天位置就在 `wake()` 里**(`autonomous.py:161`),必须挪到仲裁后 | **高** |
| **C4** | `concerns` | A(运行期单写者) | `_light_grounded_concerns` 在 `execute_and_reflow` 开头(`reflow.py:157`),分支侧。**但它已经有活体二次校验**(:96-107)——是全库里唯一自带陈旧快照防护的写路径 | 中——有现成解药 |
| **C5** | `autonomy_runs` | A 严格单写者 | `autonomy_start_run` 在 `wake()` 开头(:144),N 个分支 = N 行 running。**要么改成"一拍一行、分支只是行内字段",要么接受多行并用租约回收** | 中——语义决策,不是技术难点 |
| **C6** | `integration_state.wakes_since` | A 严格单写者 | `bump_wakes_since` 今天在 `wake()` 尾部(:171/187)。仲裁后调用即可 | 低 |
| **C7** | `rule_suggestions` | A + T | **今天就已经是跨进程双写者**,且**已经用租约解决了**(`mark_rule_suggestion_asked` 返回 `claimed`)。并发推演不会让它更糟 | 低——且是正面样本 |
| **C8** | `history` | A + S + T | 与自主推演无关(只有重启事件走 A) | 无 |
| **C9** | `insights` | A(focus) | 层2 深挖若并行,`upsert_insight` 按 `(category, content)` 去重(`mind/store.py:2084` 注释),**天然幂等** | 低 |
| **C10** | `salience_shadow.db` | 随 `record_experience` 走(`mind/store.py:776-777`) | 跟随 C1;好在它是独立 WAL 文件,不会加剧 memory.db 的锁竞争 | 低 |
| **C11** | **memory.db 的 journal 模式** | — | **rollback journal + 无 WAL**:N 个分支若各自开连接读,与仲裁器的 `BEGIN IMMEDIATE` 会互相阻塞(靠 10s/30s busy_timeout 硬等)。**并发形态落地前应先评估切 WAL** | **高——地基项** |
| **C12** | `snapshot.assemble()` 的四处写 | A | 见 5.2:取快照本身是写。**这是最先要解的** | **最高——前置项** |

**[推断] 冲突点的分布规律**:C1/C2/C3 是同一件事的三个面——**"推演"和"回流"在今天是一个函数**(`execute_and_reflow` 从头到尾又执行又写)。要做并行推演,唯一的结构性改动是**在 `evaluate_message` 之后、`execute_and_reflow` 之前切一刀**:前半段(感知+评估+选择)可并行,后半段(执行+回流)只由仲裁器跑一次。今天这一刀的位置在 `autonomous.py:155-156` 两行之间——**代码已经天然分好了,只是没有边界**。

---

## ⑥ C-B 演化路径建议(最小步序)

> 影子形态优先。每步给改动面预估与判据素材。**这些是建议,不是拍板。**

### 步 0(前置,可独立做)— 劈开 `snapshot.assemble()`

**做什么**:把 `snapshot.py:328-336` 的四行维护抽成 `snapshot.maintain(now)`,`assemble()` 改为 `maintain(); return read()`。调用方一行不改。

**为什么排第 0**:⑤ 的 C12 是所有并发形态的前置;而且它是**纯重构**,零行为变化,可以在心跳件还没影子的时候就先做掉。

**改动面**:`mind/snapshot.py` 一处;`tests/` 中直接调 `assemble` 的用例不受影响。**预估 < 50 行。**

**判据素材**:改动前后跑一次同 seed 的 `scripts/p4r_compressed_harness.py`,断言 concerns/thoughts/regulation_events 的最终状态逐字节相同。

### 步 1 — 心跳件与旧定时**并行**,只置位不消费

**做什么**:新增一个调度件(位置建议 `cognition/heartbeat.py`,与 `scheduler.py` 同构:复用 `ScheduledTask` 的形态),在 `run_forever` 里与现有 `_due()` 判定**并排跑**:

- 心跳件按自己的策略算"本拍该不该醒",结果**只 `log_event("heartbeat_shadow", would_wake=..., reason=..., next_at=...)`**;
- 实际是否 wake 仍**完全由 `_due(get_autonomy_next_wake())` 决定**;
- 心跳件**不读 LLM、不写任何表**(它可以读 `autonomy_state`,只读)。

**改动面**:新文件 ~150 行;`autonomous.py:227` 附近插 3-5 行。**不动 `wake()` 一个字节。**

**判据素材**(这一步的产物就是 C-B 的立项证据):
- 唤醒次数:`heartbeat_shadow.would_wake=true` 的计数 vs 实际 `autonomy_wake` 事件数,按日对齐;
- 时延:两者判定时刻的差值分布;
- **费用:零**——影子不发调用,所以这一步的费用敞口精确为 0。这是"影子优先"在这里的全部价值。

### 步 2 — 心跳件接入显著性输入(仍不消费)

**做什么**:让心跳件读 `mind/salience_shadow.db` 或 Core 的 `attention_decisions`(⑤/② 里那两条已建成的影子流水线,**二选一**),把"显著性提示"计入 `would_wake` 判定,仍只落日志。

**为什么单列一步**:② 缺口2 指出这两条流水线**今天零消费者**。这一步是给它们第一个消费者,同时**强制回答"C-B 用哪一条"这个悬而未决的问题**。

**改动面**:心跳件内 ~50 行 + 一条读路径。**注意**:若选 Core 侧,需要跨进程读 `core_facts.db`,而那个库有自己的 epoch 锁机制(`core/shadow.py`),**这条路的成本明显更高**;若选 salience_shadow,它就在 memory.db 旁边、同进程可读。**[建议] 先用 salience_shadow 走通形态,Core 侧留给 C 线后续。**

**判据素材**:两套 `would_wake` 序列(纯定时 vs 定时+显著性)的差异事件数;显著性额外触发的那些拍,事后人工判定"值不值得醒"。

### 步 3 — 切换:心跳件成为唯一的 `_due` 来源

**做什么**:`autonomous.py:227` 的 `if self._due(...)` 换成 `if heartbeat.due()`;旧路径降级为影子(反向影子:旧逻辑继续算、只落日志),观察一个周期后删除。

**改动面**:`autonomous.py` 一处;`_due` 与 `_compute_rest` 的归属迁移。**预估 < 100 行。**

**判据素材**:切换前后 7 天的 `llm_call{route=autonomous_cognition}` 计数、`autonomy_wake` 计数、decision.kind 分布、`experience_backlog` 水位。**④ 里那条"层1/层2 闸读的是 wake 计数不是墙钟"必须在这一步显式复核**——频率一变,整合与深挖的实际节律就变了。

### 步 4(独立于 1-3,可并行推进)— 并行推演的前置切分

**做什么**:在 `wake()` 里把 `_perceive → complete → evaluate_message` 与 `execute_and_reflow → apply_inner` 之间划一条显式边界(⑤ 末尾:今天这一刀在 `autonomous.py:155-156` 之间已经天然存在)。先**不并行**,只是把后半段收进一个 `arbitrate_and_commit(decision, ...)` 函数,并断言前半段不写任何表。

**改动面**:`autonomous.py` 重排 ~40 行;**新增一个"前半段零写入"的断言测试**(这个测试本身就是 ⑤ 的 C1/C2/C3 的守门员)。

**判据素材**:该断言测试通过 = 并行推演在写通道层面是安全的。**这是 9.4 重评最直接的一块可交付证据。**

**[建议] 步序上的一个提醒**:步 1-3 与步 4 是**正交的**——前者改"何时醒",后者改"一拍内部怎么算"。工单要的心脏调度件是前者;9.4 的并行推演是后者。**不要把它们捆成一个工单**,否则任何一边的回滚都会拖累另一边。

---

## ⑦ 风险与重构资产清点

### 7.1 死代码 / 孤儿模块

| 项 | 位置 | 状态 | 依据 |
|---|---|---|---|
| **`mind/percept_buffer.py`**(工单点名) | 100 行 | **完全孤儿**:全树唯一的非测试引用是 `tests/conftest.py:35` 的 env 兜底。生产代码零 import。`percept_buffer.db` 有完整的 schema/迁移/可逆降级机器,但**没有任何写者、没有任何读者** | grep `percept_buffer`:仅 `tests/test_percept_buffer.py`(9 用例)+ conftest。模块文档 :10-12 自认:"Server-side ingest/retention jobs are later steps(阶段2 步骤5,out of this module's scope);this WO only lands the table" |
| **`cognition/permission_evidence_shadow.py`** | 54 行 | **孤儿**:唯一引用是 `tests/test_core_v1_m3_r2c_r1_permission_evidence.py:13`(as `producer_adapter`)。生产侧的对应件在 `core/permission_evidence_shadow.py`,**是另一个文件** | grep 确认 |
| **`integrator.INSIGHT_CATEGORIES`** | `integrator.py:65` | **死常量**:全树(含 tests)零引用。整合期今天**不写 insights**(`memory_store.` 在 integrator 里零调用) | grep 确认 |
| **`mind/store.owner_edits_log`** :1564 | — | **无生产调用方**(`owner_edits_list` 同)。红线 #4 的台账机制建好了、没接入 | grep 确认 |
| **`clock.advance_to` / `clock.step`** | `clock.py:215,231` | **生产零调用**,仅 harness 用。见 §1.2 的文档-代码不一致 | grep 确认 |

**[建议]** 这五项里,`percept_buffer` 和 `permission_evidence_shadow` 是"建好了等接线"的**资产**,不是垃圾——删它们会丢掉已经通过测试的迁移机器。`INSIGHT_CATEGORIES` 是纯垃圾,可以直接删。`owner_edits_log` / `clock.step` 属于"声明了但没走完最后一公里",**动它们之前需要先确认那条路线是否还要走**——这是治理侧的事。

### 7.2 耦合热点(动调度侧之前必须知道的)

**H1 — `autonomous.py` 是编排层,依赖面最宽。**
**[事实]** 它 import 了 10 个包/模块:`llm_router`、三个 self_state、`restart`、`runtime_client`、`suggestion_conversation`、`memory.store`、五个 mind 模块、`clock`/`interactive_lock`/`log`。**[推断]** 任何调度侧改动都会碰到它,而它没有接口层——全是直接函数调用。**这是重构成本的主要来源,也是"影子形态优先"最能省钱的地方**:影子件只需要新增 import,不需要改现有调用。

**H2 — `reflow.execute_and_reflow` 一函数同时干四件事。**
**[事实]** `reflow.py:143-262`:发光关切 + 写 wake_action 经验 + 按 kind 分七支执行 + 写 action_result 经验 + 调节场写回。**[推断]** ⑤ 的 C1/C2/C4 全部落在这一个函数里。步 4 的切分实际上就是给它划边界。

**H3 — 层1/层2 的节律派生耦合。**
**[事实]** `focus.py:59-63`:`FOCUS_EVERY_WAKES = integrator.INTEGRATION_EVERY_WAKES × FOCUS_EVERY_INTEGRATIONS`,注释明写这是**有意的**派生(共用一条节律,层1 改了层 2 必须跟着改)。**[推断]** 心跳件若引入新的时间口径,这条派生链需要重新审视:今天它绑的是"wake 计数",不是时间。

**H4 — `snapshot.assemble` 的读写混合。**见 ⑤ C12。**[推断]** 它同时被"感知"和"维护"两个职责占用,而 `_build_snapshot()`(`autonomous.py:128-131`)是测试专用的钩子——**测试每调一次也会触发一次真实维护写**。这是本报告注意到的一个隐蔽的测试污染面(在 tmp DB 上无害,但形态上是错的)。

**H5 — `_due` 与 `next_wake_at` 的双向依赖。**
**[事实]** "下一拍何时"由模型输出决定(`decision.next_wake_after_minutes`),写进 DB,再由 `_due` 读回。**[推断]** 心跳件要接管这条链,必须回答一个语义问题:**模型还该不该有"我想 45 分钟后再醒"的发言权?** 今天它有,而且这是 `DECIDE_SYSTEM_PROMPT`(`decide.py:266`)的一个契约字段。**[建议] 这个问题应该在 C-B 设计阶段就明确,而不是在实现阶段被动碰到**——它同时影响 prompt 契约、`clamp_rest`、以及 `rest` 候选项的成本说明文案(`decide.py:229`)。

### 7.3 动它之前必须先补的测试

**[事实] 现状盘点**:

| 目标 | 现有覆盖 | 缺口 |
|---|---|---|
| `AutonomySupervisor.wake()` | `tests/test_p4_autonomy.py` 11 用例(单例锁、跨进程 marker、stale 回收、小时 cap 读持久化、next_wake 跨重启、busy 等待、clamp、让路、记录+调度、通知路由) | 覆盖良好 |
| **`AutonomySupervisor.run_forever()`** | **零**。grep `run_forever` 在 tests/ 下的 10 处命中**全部是 telegram_device 的 run_forever**,无一是 autonomous 的 | **最大缺口**——整个循环骨架(廉价 tick 闸、`_due` 判定、integrate/focus 的串接、stop 事件)没有一个用例 |
| `scheduler.run_scheduler` | `tests/test_scheduler_virtual.py` **1 用例**(run_immediately 在虚拟时钟下触发) | 薄。间隔判定、任务失败不杀循环、`_notify_owner` 的 refused 路径均无覆盖 |
| 层1 触发闸 | `test_mind_integrator_trigger.py` 8 用例 | 良好 |
| 层2 | `test_l4_focus.py` **43 用例** | 最厚的一块 |
| 快照 | `test_mind_thoughts_snapshot.py` 等 | 未逐一核 |

**[建议] 动调度侧之前的补测清单,按优先级**:

1. **`run_forever` 的骨架测试**(阻塞级)。至少四条:(a) `stop` 置位后循环干净退出;(b) 廉价 tick 的 600s 闸真的按虚拟时钟生效、且 `cheap_tick` 抛异常不杀循环;(c) `wake()` 返回 `completed` 时 integrate/focus 各被调一次、返回 `failed`/`yielded`/`rested` 时都不被调;(d) `_due` 为假时不发起 wake。用 `test_scheduler_virtual.py` 已经验证过的虚拟时钟 + `asyncio.create_task` 模式即可,**不需要新基础设施**。
2. **`_due` 的边界测试**(高)。None / 脏字符串 / 未来 / 过去四种输入。**这条直接对应风险 B**——今天脏值 fail-open 的行为没有任何测试钉住,意味着改成 fail-closed 也不会有测试拦你,反之亦然。
3. **"推演阶段零写入"的断言测试**(高,步 4 的守门员)。形态:在内存 DB 上快照全表的 `sha256`,跑 `_perceive() + evaluate_message()`,断言全表哈希不变。**注意:今天这个测试会失败**——因为 `_perceive` 里的 `assemble()` 会写(⑤ C12)。所以它必须在步 0 之后才立得住,而**它失败这件事本身就是步 0 必要性的证据**。
4. **预算 TOCTOU 的并发测试**(中)。两个并发的 `initiate_chat` dispatch,断言恰好一个 `queued=True`、另一个是 `daily_cap`。今天 `proactive_chat.try_send` 的原子性只有单线程测试。
5. **`snapshot.maintain` / `read` 分离后的等价性测试**(中,步 0 的判据)。见 ⑥ 步 0。

---

## 附:本单未覆盖 / 明确留白

- **对话路径**(`conversation.py` 1623 行、`conversation_cycle.py` 614 行、telegram):按 forbidden 未审。本报告只在 ②(唤醒关系)、③(写者矩阵里的 S/T 列)、④(route 使用点)三处**必要地**引用了它们的入口行,未进入其内部逻辑。
- **活体数据**:未读 memory.db、events.jsonl、任何 state 文件(0600 或不在工作区)。所有费用与频率的陈述都是**口径**,一个读数都没有。
- **白皮书 / Cordis 计划 / 认知架构探索三份材料**:见 §0,查不到,未读,未复述。凡与它们的对照点,我都写成了"待核对的开口"而不是结论。
- **9.4 重评的结论**:按工单,不给。⑤ 是素材与冲突点全列,拍板归治理侧与 Kevin。

**工作树状态确认**:`git status --porcelain` 空,HEAD 仍为 `7b00ae5e`,零文件新增。
