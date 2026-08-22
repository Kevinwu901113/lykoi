All eleven criteria are complete, committed, and the tree is clean. Here is the report.

---

# WO-CB-01 · C-B 心脏第一单 · 完成报告

**分支** `wo/cb-heart`,基 `32238013` → 尖 `8dad2770`,11 个 commit,工作树干净。
**改动后全量 = 2224 passed / 3 failed / 6 skipped**,对账基线 `2169/3/6` + 新增 55,**新增失败 0**。

---

## 判据① 侦查(引用代码行)

### ①a `snapshot.assemble()` 四处写的调用方与测试触达面

四处写(`mind/snapshot.py`,步 0 之后已具名为 `maintain()`):`mind_store.mark_dimming_dormant` → `mind_floor.maintain` → `_apply_lazy_overdue_penalty` → `mind_thoughts.decay_all_open_thoughts`(§5.5 §3 出口③)。

调用方全景:
- **生产侧仅一处** —— `cognition/autonomous.py` 的 `wake()`(步 0 之后是 `maintain()` + `read(moment)`,`autonomous.py:193-195`);
- **隐蔽的第二处** —— `AutonomySupervisor._build_snapshot()`(测试钩子,经 `_perceive` 间接触发,即 C-A ⑦ **H4**);
- **harness** —— `scripts/p4r_compressed_harness.py:298`;
- **测试触达面** —— `test_mind_beat.py`(5 处)、`test_mind_thoughts_outlets.py`(3 处)、`test_mind_thoughts_inner.py:187`。

全部走 `assemble()` 的兼容外观,**零改动**;H4 已零语义代价销账(`_perceive` 改走 `read()`)。

### ①b `salience_shadow.db` schema / 写入时机 / 索引 / 锁形态

- **schema**(`mind/salience_shadow.py:148`):`shadow_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts, experience_id, source, key, score, boost, explore_flag, selected NOT NULL, skip_reason, load_value, load_tier, presented_today, presented_hour, outcome, outcome_ts, outcome_integration_id)`。
- **索引**:`idx_shadow_experience`(UNIQUE,`experience_id`)、`idx_shadow_pending`(`outcome IS NULL` 部分索引)。三条触发器保证 append-only / 决策列不可变 / outcome 写一次。
- **写入时机**:每条经验摄入时一行(`INSERT OR IGNORE`,`:331`);预算台账从表自身推导,无独立可变账本。
- **心跳件的查询口径**:`SELECT COALESCE(MAX(id),?), COALESCE(SUM(selected),0) FROM shadow_log WHERE id > ?` —— `id` 是 `AUTOINCREMENT` 即 rowid 别名,所以这是**尾部范围扫描**,只碰游标之后新写的那几行,**不是全表 COUNT**;每转代价与表的历史大小无关,也不依赖任何索引。
- **锁形态论证**:sidecar 是 **WAL**(`salience_shadow.py:204` `PRAGMA journal_mode = WAL`),因此**读不阻塞写** —— 心跳件每 5 秒一次的只读扫描不会让摄入钩子的写事务排队。连接为 `file:...?mode=ro` URI + `PRAGMA query_only=1` 双锁,`busy_timeout` 2s 封顶。

### ①c `run_forever` 全部分支与 `log_event` 落点

分支:① `stop.is_set()` 退出 → ② 首启 `next_wake_at is None` 播种 `MIN_REST_MIN` → ③ 廉价 tick 闸(`CHEAP_TICK_INTERVAL_S`=600s,虚拟时钟)→ ④ **心跳影子观测(本单新增)** → ⑤ `_due(...) and _beat_floor_open()` → `wake()` → ⑥ `status=="completed"` 时 `_maybe_integrate()` + `_maybe_focus()` → ⑦ `asyncio.wait_for(stop.wait(), TICK_SECONDS=5.0)`。

`log_event` 落点:`autonomy_loop_start` / `cheap_tick_failed` / **`heartbeat_shadow`**(新)/ **`heartbeat_shadow_salience`**(新)/ **`heartbeat_shadow_failed`**(新)/ **`autonomy_next_wake_unparseable`**(新,判据⑤)/ `autonomy_rest` / `autonomy_wake` / `autonomy_wake_failed` / `autonomy_integrate(_failed)` / `autonomy_focus_failed` / `autonomy_rule_suggestion(_failed)` / `autonomy_lock_busy` / `autonomy_loop_stop`。

### ①d events.jsonl 当前日志速率量级 → 影子的有界方案

实测(`log_rate.json`,第 1 波):**3 拍 22 条 = 7.33 条/拍**(`autonomy_wake` 3 / `mind_experience` 6 / `mind_regulation` 9 / `wake_inner_applied` 3 / `mind_concern_created` 1)。注:该测量把 `_autonomous_complete` 整个替掉了,活体每拍再多一条 `llm_call`。

若心跳件每 5 秒一转都落一条 = **17280 条/日**,必然刷屏。**采用的有界方案**:只在 `would_wake` 为真的那一转落一条。地板保证同一 series 两次真值至少隔 `MIN_REST_MIN`=5min → **日频硬上限 1440/5 = 288/series**;基线 30 分钟下**期望 ~48 条/日/series,两条 series 合计 ~96 条/日**。sidecar 可用性只在**状态翻转**时落一条,不随 tick 刷屏。

### ①e `llm_router.complete` 调用点全景 + 归因最小改法

src/ 下共 **8 个调用点**:

| 调用点 | 归因 | 理由 |
|---|---|---|
| `autonomous.py:96`(决策) | ✅ `autonomous_wake` + `run_id` | 自主侧 |
| `mind/integrator.py:507` | ✅ `autonomous_integrate` | 自主侧 |
| `mind/focus.py:269` | ✅ `autonomous_focus` | 自主侧 |
| `conversation.py:1199` / `:1619` | ❌ | U3S 领地,forbidden |
| `conversation_cycle.py:558` | ❌ | 同上 |
| `kernel/suggestion_conversation.py` | ❌ | **在 `kernel/` 下 —— 不是"拿不准",是规则禁止** |
| `kernel/approval_interpreter.py` | ❌ | 同上 |

**最小改法**:`complete()` / `chat_completion()` 各加两个 keyword-only 可选参数 `origin` / `run_id`,只进 `llm_call` 事件、**不进 payload**。**不带归因的调用方逐字节不变**的机制:两参缺省时事件里**根本不出现**这两个键(不是出现成 `null`),带归因时新键**一律追加在末尾**,既有键的顺序与取值一个没动。

---

## 每判据自证

| 判据 | commit | 自证 |
|---|---|---|
| ② 步 0 劈快照 | `4ed6b397` | `maintain`/`read`/`assemble` 三分。**等价性:基 vs 改动后,GREEN/RED 两场景 harness 结果 + 四表逐行 sha256 逐字节相同**(`GREEN 808693af…` / `RED 5ea6ab58…`)。调用方零改动。H4 零语义代价做掉。6 passed |
| ③ 推演零写入 | `98108dbb` | **先红后绿**:基上 `1 failed, 1 passed`(`0a6bfbea… ≠ 7511ce2d…`);步 0 后 `2 passed`。对照组在红绿两侧都绿 → 播种确实咬住写路径 |
| ④ 骨架补测 | `5c2dc80d` | run_forever 四条(stop/廉价 tick 虚拟钟闸+异常不杀循环/integrate·focus 只挂 completed(四态 parametrize)/`_due` 假不发起)+ `_due` 四输入。基础设施零新增。12 passed |
| ⑤ R-CA-1 | `75c2dea7` + `f97822d9` | `_due` 脏值 fail-closed + `autonomy_next_wake_unparseable` + 自愈 `now+DEFAULT_REST_MIN`(幂等);地板 `_beat_floor_open()` 复用 `MIN_REST_MIN`。负例:真 wake + 恒 rest 桩 → 恰好 1 次 LLM 调用且 `autonomy_actions_last_hour()==0`(cap 确实没救场)。RED/GREEN 同构桩臂:地板关 ≥3 拍 / 地板开 =1 拍。10 passed |
| ⑥ 心跳影子件 | `132bc0c5` | 零 LLM(**AST 扫描**,不扫原文)/ 零表写(观察一整天量后逻辑摘要不变)/ 不读发言权(构造 `next_wake_at` 1min 后 vs `last_wake_at` 40min 前的分叉,读错结论就相反)。接线 3-5 行、包 try/except、**wake() 一个字节没动**。9 passed |
| ⑦ 显著性输入 | `2ff262e8` | 规则:新增 `selected=1` 行数 ≥ 3 → 提前醒,仍受地板约束。sidecar 双锁只读(真 INSERT 抛错)。两套 series 可分离,`baseline_only` **完全不碰 sidecar**。fail-quiet + 翻转才落遥测。17 passed |
| ⑧ llm_call 归因 | `8a44c2ab` + `f97822d9` | 见 ①e。对话侧零 diff 是**可执行断言**(扫 src/ 全树,断言三个 `ORIGIN_*` 常量引用面恰好 4 个文件)。8 passed |
| ⑨ 零扰动 | `494b2466` | `git diff 32238013..HEAD -- decide.py conversation*.py telegram* kernel/ core/ guardian/` **输出为空**;全树改动面恰好 14 文件;系统级等价哈希覆盖全改动集;地板/自愈各自的不越界自证 |
| ⑩ 全量 + manifest + conftest | `d96798da` + `8dad2770` | 见下 |
| ⑪ 报告 | 本文 | — |

### ⑩ 详细

**全量 2224/3/6**,collect 2233 = 2178 + 55。skipped 6 逐字不变。**新增失败 0**。

3 条失败全部是**基线既有**,且都在基 `32238013` 的干净 worktree 上**现场复现过**(不是凭基线数字推断):

1-2. `test_core_v1_shadow.py` 两条 —— `AttributeError: lykoi.kernel.redaction 没有 _SECRETS`。**不是教训 38 的形态**(不是 TimeoutError 连锁),仍按要求单独串行复跑定性:串行下依然是这两条同一个错(`2 failed, 50 passed in 36.45s`),与并发无关;base worktree 复跑同样 `2 failed, 50 passed`。`kernel/` 本单零 diff。
3. `test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources` —— `PermissionError: /home/lykoi/state/approval_rules.json`(owner 域 EACCES)。用例只跳过"不存在"的受保护源,没跳过"存在但读不到"的。失败点在 `read_bytes()`,**发生在任何哈希比对之前,与 manifest 内容无关**;base worktree 同一个错。

**manifest 112 → 113**(基准取 `git show 32238013:guardian/manifest.sha256 | wc -l` = **112** ✓,不凭记忆):改哈希 **6** 条(恰好是本单改动的全部受保护源)+ 新增 **1** 条 `cognition/heartbeat.py`(按清单惯例:cognition/mind 下模块全覆盖,新模块不入册就是在受保护面上开洞)。其余 106 条逐字节一致。

**conftest(教训 36)**:本单新增 env 仅 `LYKOI_HEARTBEAT_BASELINE_MIN`,已补默认值 `"30"`。`LYKOI_SALIENCE_DB` 是既有条目。无新增 state 路径常量。

### 本单自己引入的两条红(已销账)

- **`判据⑧` 破坏了测试替身位**(严重):给 `_autonomous_complete` 加形参,而树里既有**五处**桩全是 `async def fake_complete(messages)` 单参形态(`test_p4_autonomy` ×2、`test_mind_thoughts_inner` ×2、`test_p5_memory_notification` ×1)→ 全线 TypeError。改用 **ContextVar**:签名一个字节不动,归因照样绑到正确那一拍。
- **风暴用例自身时序依赖**:写死 3 秒窗口,在 CPU 争用下连一拍(实测 6s+)都装不下。改成**等条件成立**;证明地板的后半段与吞吐无关(虚拟钟钉死 → 地板不可能开是确定性的)。

### 分块形态说明(不是回归)

新增 6 个测试文件使 TOTAL 138→144、PER 23→24,**六块边界整体右移** → **不能**与第 1-2 波存档的 `chunk_{1,2,3}.log` 逐块比对,只有总数可比。右移后 chunk 4 超 1800s 墙(exit 124),按铁律切成三份;其中 4.1 八个文件仍超墙(**纯慢,零失败**),再逐文件跑完 8 个各自独立 `timeout 1800`、前台串行 → 198 passed / 0 failed(合计 ~1386s + 8 次解释器启动)。覆盖面无遗漏。

---

## 影子读数使用说明(治理侧步 3 立项证据的查询口径)

心跳影子与活体 wake **按日对齐**对比:

```bash
# 1) 活体实际醒了几次/日
jq -r 'select(.event=="autonomy_wake") | .ts[:10]' events.jsonl | sort | uniq -c

# 2) 影子说"该醒"几次/日 —— 必须按 series 分组,两条读数是分离的
jq -r 'select(.event=="heartbeat_shadow") | "\(.ts[:10]) \(.series)"' events.jsonl \
  | sort | uniq -c

# 3) 显著性到底额外叫醒了几次(定时+显著性 减去 纯定时)
jq -r 'select(.event=="heartbeat_shadow" and .series=="baseline_plus_salience"
              and .reason=="salience") | .ts[:10]' events.jsonl | sort | uniq -c

# 4) sidecar 可用性翻转(只在翻转时落,不随 tick 刷屏)
jq -c 'select(.event=="heartbeat_shadow_salience")' events.jsonl

# 5) 费用归因(判据⑧):按 origin 分栏,而不是只按 route
jq -r 'select(.event=="llm_call") | "\(.ts[:10]) \(.origin // "unattributed") \(.route)"' \
  events.jsonl | sort | uniq -c
# 单拍归因:某一次 wake 花了几次调用
jq -c 'select(.event=="llm_call" and .run_id=="<run_id>")' events.jsonl
```

**读数口径要点**:`heartbeat_shadow` **只在 `would_wake=true` 时落**,所以条数即"影子认为该醒的次数",不需要过滤。`reason` 区分 `baseline`/`salience`;两条 `series` 各自推进自己的影子时钟,所以"显著性额外触发了几拍、提前了多久"可直接按 series 分组读,**不必从混合序列反推**。预期日频 ~48/series(基线 30min),硬上限 288/series。

---

## 步 3 / 步 4 交接清单

**步 3(切换单)要动的点**:

1. `_due` 换 `heartbeat.due()` —— 心跳件当前是纯影子、**进程内无持久状态**(刻意的:否则切换时分不清"心跳件的账"和"活体的账")。切换时需决定它是否要持久化自己的拍钟。
2. **DECIDE prompt 字段退役**:`decision.next_wake_after_minutes` 的 prompt 契约与现有消费(`wake()` 末 `self._compute_rest(decision.next_wake_after_minutes)`)。D-CB-1 已拍板发言权收回,本单**零改动**。
3. **`clamp_rest` 归属迁移**:目前在 `autonomous.py`,切换后节律归心跳件,夹逼也应随之迁走。注意心跳件当前**刻意不 import autonomous**(会成环),两边 `MIN/MAX_REST_MIN` 同值由一条断言盯着。
4. **D-CB-3 墙钟迁移面**(本单**零实现**,仅记录):层1/层2 节律锚从 wake 计数迁到墙钟 —— `integration_state.wakes_since`(`mind/integrator.should_integrate`)与层 2 自己的计数器。属步 3 前的**独立单**。
5. **费用前置闸挂点**:判据⑧ 的 `origin`/`run_id` 已经把自主侧三栏分开,前置闸可挂在 `llm_router.complete` 的归因入口。**缺口**:`kernel/suggestion_conversation.py` 由 autonomous 驱动却**未带归因**(forbidden 禁止碰 `kernel/`)—— 切换单若要完整费用画像,**需要一张 kernel 侧的授权**。
6. 判据⑤ 的地板在切换后应复核:若心跳件成为唯一排程源,地板是保留为独立第二道刹车,还是并入心跳件。

**步 4(推演切分)要动的点**:

1. 守门员断言已就位(`test_cb_deliberation_zero_write.py`)—— 切分前它必须一直是绿的。
2. `snapshot.read()` 已是纯读、同时刻两次逐字段相同 → **一份结果可安全分发给 N 个分支**。`maintain()` 是仲裁器的活,一拍恰好一次,已站在 `wake()` 的仲裁位。
3. 尚未做:分支推演的**并发写通道**设计(`evaluate_message` 已证零写,但 `execute_and_reflow` / `apply_inner` 仍是写路径,切分时要决定它们如何串行回收)。

---

## 与工单的两处偏差(据实交代)

1. **`eq_before.json` 未被引用为"前"侧**。它出自第 1 波 00:29 的**旧版哈希器**,与现行 `eq_hash.py`(03:16 版,表集合与摘要口径都不同)**不可比**——直接比会得出"步 0 破坏了等价性"的错误结论。改为在 stash 到干净树后**现算** `eq_before_v2_authoritative.json`,并用两次独立跑(`eq_A`/`eq_B` 逐字节相同)证明哈希器自决定性。这是对工单"直接引用 eq_before.json"的偏离,理由如上。
2. **`test_core_v1_shadow` 的失败不是教训 38 的形态**。工单预期它是 TimeoutError 连锁;实际是 `AttributeError`(用例与 `kernel/redaction.py` 脱节)。仍按要求做了单独串行复跑,并在 base worktree 上复现,确认与并发无关、与本单无关。
