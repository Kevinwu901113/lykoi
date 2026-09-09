# Runtime Slimdown 首批迁移注释存档

基线：`cd5bfad`。以下原文从源码迁出，仅保存历史实施依据；其中“逐字”“不得合并”等迁移限定不自动成为现行产品契约。去留决策见[分类清单](../wo/WO-RUNTIME-SLIMDOWN-01/inventory.md)。

## `packages/lykoi-snapshot/src/index.ts:1`

```ts
/**
 * lykoi-snapshot — 感知快照 maintain/read 劈分版（M2 波次 2 交付①）。
 *
 * 规格正本：治理仓库 WO-M2-SPEC-MIND §2（SA-33..44）+ §7 相关条目；
 * 移植自活体 `mind/snapshot.py` + `mind/floor.py`（HEAD 4463ae8）。
 *
 * 一拍从这里开始：醒来看到的一切都来自状态层，所以快照必然每次不同 ——
 * 这就是打破土拨鼠日的机制。注意力预算：Top-6 关切、5 条线、3 条经验、
 * Top-3 念头 —— 她看不到全部，只看到发光的（SA-38）。
 *
 * 三分（SA-33）：
 *   maintain —— 感知期维护，**写**的那一半；仲裁器的活，一个心跳恰好一次；
 *   read     —— 纯读装配，**零写**；同一时刻的两次 read 逐字段相同，
 *               一份结果可以安全分发给 N 个并行分支（DA-10 的唯一前提）；
 *   assemble —— 兼容外观 = maintain 后 read，时刻解析一次两半共用（SA-36）。
 *
 * 时钟纪律（沿 W1 C-23）：now 一律必传（Date）；本包不读 Date.now()。
 * 写走 lykoi-memory/rw；本包自身不开连接。
 * 审计纪律：logEvent 是接口位（W3 心脏/编排接 audit sink），事件名与字段是契约。
 */
```

## `packages/lykoi-snapshot/src/index.ts:64`

```ts
/**
 * 呈现给她的治理预算（执行点在别处：小时顶在 supervisor 拍前检查、日顶在
 * kernel.notifications —— snapshot.py:55-57）。G-6 的折算见 environment()。
 */
```

## `packages/lykoi-snapshot/src/index.ts:80`

```ts
/**
 * 状态层依赖（结构化子集 —— lykoi-memory/rw 的 ReadWriteMemory 直接满足）。
 * read() 只触其中的纯读方法；maintain() 才触写方法（SA-33 的劈分在依赖面留痕）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:118`

```ts
/** restart 事件（cognition/restart.py 的 content 字段面；W5 才有生产者）。 */
```

## `packages/lykoi-snapshot/src/index.ts:124`

```ts
/**
 * 尚未迁入新体的外部读数（kernel/approval、kernel/notifications、
 * shared/proactive_chat、cognition/restart）——接口位，W3/W5 接线。
 * 语义契约在各自 Python 源：
 *  - approvalPendingCount        = kernel.approval.pending_count()
 *  - notificationsRemainingToday = snapshot.py:163-178 _notifications_remaining_today
 *    （从权威队列现算 max(0, AUTONOMOUS_DAILY_CAP=2 - 今日 autonomous 已发)；
 *    "the throttle itself stays in the kernel; this is a view, not an enforcement
 *    point" —— SA-42）
 *  - proactiveRemainingToday     = shared/proactive_chat.remaining_today
 *    （日 1 条、冷却 6h，比通知更紧）
 *  - unprocessedRestartEvent     = cognition/restart.unprocessed_restart_event
 *    （SA-165：history ts 严格大于她上次醒来才算未处理）。W5 已接真源
 *    （./restart.ts 的 unprocessedRestartEvent 读 history event_type='restart'；
 *    wake 插件面接线）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:145`

```ts
/** 审计接口位（W3 接 sink）；事件名与字段是契约（SA-44 拆分只上日志）。 */
```

## `packages/lykoi-snapshot/src/index.ts:227`

```ts
/** 九项快照（键序即她看到的顺序，SA-37；`刚刚醒来` 是条件键）。 */
```

## `packages/lykoi-snapshot/src/index.ts:247`

```ts
/**
 * SA-39：`_clip`（snapshot.py:81-82 逐字）—— 省略号追加在裁剪长度**之外**；
 * 长度与切片按码点（Python len/切片语义）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:258`

```ts
/**
 * 近 days 天内全部 conversation history 时间戳，**oldest first**（有界读；
 * history 表是"我和 Kevin 什么时候真的说过话"的唯一事实源）。
 * 解析失败的行跳过（snapshot.py:87-101）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:283`

```ts
/**
 * 相邻对话间隔的中位数（小时）；历史不足以了解 owner 节律时（< MIN_GAP_SAMPLES+1
 * 个样本）返回 DEFAULT_TYPICAL_GAP_H（snapshot.py:104-113 逐字）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:296`

```ts
/**
 * 过去 days 天里有多少天在此刻 ±window_h 的时段内发生过对话 ——
 * "他这个时段通常在吗"，纯时间比较（snapshot.py:116-129 逐字）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:363`

```ts
/**
 * 悬置超龄 → coherence 懒读惩罚（蓝图 §3.3 + §5.5 §3 出口 ②；SA-44）。
 *
 * 两个来源共点一道门：悬置超 30 天的线 AND open 'question' 念头超 48h。
 * 共用**同一条** regulation 因（suspension_overdue）与**同一个** 24h 间隔闸
 * （裁决 7：总压力钳，不按来源分管道），coherence 不被双重扣费。
 * 拆分（线 vs 念头计数）只上日志供 Phase 4 复盘 —— regulation_events 行保持简单。
 */
```

## `packages/lykoi-snapshot/src/index.ts:452`

```ts
/**
 * Top-N open 念头按 charge（§5.5 §3 出口 ①）。注意力有界：她看到最强的几条，
 * 不是长尾。少于 Top-N 合法 —— 空列表是正确渲染，不是警告或错误（SA-38）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:469`

```ts
/**
 * 上一个**已完结**的拍 —— 决策与结局（回流闭环的可见性，SA-43）。
 * 本拍自己（status=='running' 的开行）被跳过；不可解析的旧 decision 原样展示，
 * 绝不编造。
 */
```

## `packages/lykoi-snapshot/src/index.ts:499`

```ts
/**
 * 把 restart 事件渲染成第二人称一句话，或空串（cognition/restart.py:239-246 逐字）。
 * notes 用**无分隔符** join（每条 note 自带全角句号）；外层方括号是"这是材料
 * 不是对话"的标记；空 event → 空串。生产者（record/unprocessed）归 W5。
 */
```

## `packages/lykoi-snapshot/src/index.ts:514`

```ts
/**
 * 感知期维护 —— 写的那一半（WO-CB-01 步 0；SA-34 四写顺序逐字）。
 *
 * 四件确定性、零 LLM 的写：dim/dormant 标记 → 关切地板 → 超龄悬置惩罚 →
 * 念头衰减。第 4 项可能当场把一条念头 lapse 成 abandoned + 一条 thought_lapse
 * 经验，所以它必须发生在读之前 —— 经验块要看得见（SA-35）。
 * 地板站位（floor.py 顶注）：AFTER aging（老化流失被覆盖）、BEFORE 整合读
 * 关切集（吸收目标始终存在）。
 *
 * 这是**仲裁器的活**，一个心跳恰好一次（SA-49）。从装配里抽出来具名，是为了
 * 让"取一份快照分发给 N 个分支推演"成为可能：今天取快照本身就是一次状态变更
 * （C-A §5.2 / ⑤ C12），那条路因此走不通。
 *
 * 返回它实际用的 moment，好让调用方把同一个时刻传给 read() —— 两半分家取时
 * 就不是纯重构了（维护写的时间戳会与快照里的 now 错开）（SA-36）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:539`

```ts
/**
 * 纯读装配 —— 读的那一半（WO-CB-01 步 0；SA-33/37）。
 *
 * 九项里的 3-9 项，一个字节都不往状态层写。同一时刻的两次 read 逐字段相同，
 * 所以一份结果可以安全地分发给 N 个并行分支（步 4 推演切分的前提；
 * 零写断言 + 对照组见测试，G-9 立 M2）。
 */
```

## `packages/lykoi-snapshot/src/index.ts:568`

```ts
/**
 * 兼容外观（SA-33/36）："maintain 后 read"，行为与拆分前逐字节一致 ——
 * 时刻在调用方解析**一次**，两半共用同一个 moment（两半各自再取时钟就会让
 * 维护写的时间戳与快照里的 now 分家，那不是纯重构）。
 */
```

## `packages/lykoi-snapshot/src/num.ts:1`

```ts
/**
 * 数值口径工具（W2）：Python 舍入与 statistics.median 的忠实对应物。
 *
 * 快照里的每个 round(...) 都是她看见的字节的一部分（SA-38/39 的数值面），
 * 所以不能用 JS 的 toFixed/Math.round 近似 —— 两者在精确平局（tie）上的
 * 行为与 Python round() 不同（Python = 对精确二进制值做十进制 round-half-even，
 * CPython double_round via _Py_dg_dtoa）。
 */
```

## `packages/lykoi-snapshot/src/num.ts:10`

```ts
/**
 * Python 3 `round(value, ndigits)` 的对应物：把 double 的**精确**十进制展开
 * 在 ndigits 位处舍入，恰在半点时取偶（banker's rounding），再正确解析回 double。
 *
 * 精确域说明：|value| ≥ 2^-48 时 `toFixed(100)` 即精确展开（double 的小数位数
 * ≤ 100）；更小的值在本包的用途（ndigits ≤ 3）下结果恒为 ±0，不受影响。
 * golden 对拍见 test/num.test.ts（值由 CPython 逐位生成）。
 */
```

## `packages/lykoi-snapshot/src/num.ts:55`

```ts
/** Python `statistics.median` 对应物：升序后奇数取中位、偶数取中间两数均值。 */
```

## `packages/lykoi-snapshot/src/num.ts:66`

```ts
/** Python `f"{x:+.2f}"` 的对应物（CAUSES 插值链的渲染面，SA-13）。 */
```

## `packages/lykoi-snapshot/src/num.ts:72`

```ts
/** Python `len(str)` / 切片按码点（CJK 之外含增补面字符时与 UTF-16 单元不同）。 */
```

## `packages/lykoi-regulation/src/index.ts:1`

```ts
/**
 * lykoi-regulation — 调节场纯函数（M2 波次 1 交付②）。
 *
 * 规格正本：治理仓库 WO-M2-SPEC-MIND §4（SA-73..SA-82）。
 * 移植自活体 `mind/regulation.py`（HEAD 4463ae8）。
 *
 * SA-73（模块纪律，regulation.py:3-4 逐字）：PURE module —— no sqlite, no I/O,
 * no clock reads。持久化独占归 lykoi-memory 写层（mind/store.py 的对应物）。
 * 本文件 import 面为零、不读 Date.now()、不碰进程环境。
 *
 * 建构规则（regulation.py:7-8 逐字）：每个变量必须有 (a) 更新规则 (b) 衰减规则
 * (c) 对认知的因果出口。三者缺一就不许建 —— 没有因果出口的状态是装饰，
 * 宪法明令禁止。可执行判据 = registryProblems()（SA-81）。
 */
```

## `packages/lykoi-regulation/src/index.ts:29`

```ts
/** 蓝图原文（SPEC-MIND §4.1 表，逐字）。 */
```

## `packages/lykoi-regulation/src/index.ts:33`

```ts
/** SA-76：四变量四元组（regulation.py:111-136 逐字）。 */
```

## `packages/lykoi-regulation/src/index.ts:63`

```ts
/**
 * SA-74：15 条 CAUSES 的变量与 delta 逐字（regulation.py:27-47，SPEC-MIND §4.2 表）。
 * SA-75：delta 只从这张表查 —— "so a call site cannot invent its own magnitude"
 * （regulation.py:24-25 逐字）。lykoi-memory 写层的 applyRegulationCause 只收 cause
 * 名，接口上不存在 delta 参数；这是移植时最不可妥协的一张表。
 */
```

## `packages/lykoi-regulation/src/index.ts:89`

```ts
/** SA-77：DECAY_RATE_PER_HOUR 四值逐字（regulation.py:53-58）。 */
```

## `packages/lykoi-regulation/src/index.ts:97`

```ts
/** clamp01（regulation.py:139-140 逐字）：min(1.0, max(0.0, value))。 */
```

## `packages/lykoi-regulation/src/index.ts:102`

```ts
/** apply_delta_value（regulation.py:156-158 逐字）：clamp01(value + delta)。 */
```

## `packages/lykoi-regulation/src/index.ts:107`

```ts
/**
 * SA-77 decay_value（regulation.py:143-153 逐字）—— 懒衰减，读时从 updated_at 起算：
 *   hours_elapsed <= 0 → clamp01(value)（不外推未来）；
 *   regress    → clamp01(baseline + (value - baseline) * exp(-rate * hours))；
 *   accumulate → clamp01(value + rate * hours)（只升不降）。
 */
```

## `packages/lykoi-regulation/src/index.ts:127`

```ts
/** 念头 charge 线性衰减速率（regulation.py，SPEC-MIND §4.3）。 */
```

## `packages/lykoi-regulation/src/index.ts:130`

```ts
/**
 * SA-78 decay_charge（regulation.py:161-177 逐字）—— 与 decayValue 是两个函数，
 * 签名与不变量真不相同（"signatures and invariants are genuinely different, so this
 * is its own function"），新体不得合并：
 *   beats <= 0 → no-op 而非返还 —— "attention can only be paid forward, never refunded"；
 *   否则 max(0.0, charge - THOUGHT_CHARGE_DECAY * beats)。
 */
```

## `packages/lykoi-regulation/src/index.ts:144`

```ts
/** SA-175：open 念头容量软上限（超出且 charge 不严格大于最低者 → 拒建）。 */
```

## `packages/lykoi-regulation/src/index.ts:146`

```ts
/** SA-177：charge 跌破此值 → abandoned + thought_lapse（regulation.py:84 一带）。 */
```

## `packages/lykoi-regulation/src/index.ts:148`

```ts
/**
 * SA-177：thought_lapse 经验的 salience（regulation.py:86 逐字：
 * `THOUGHT_LAPSE_SALIENCE = 0.2  # 速朽落痕经验的 salience`）——
 * 常量名与 Python 同名（W1 TODO#2 对拍销账）。
 */
```

## `packages/lykoi-regulation/src/index.ts:154`

```ts
/** 快照念头块 Top-N（SPEC-MIND §2.2：regulation.THOUGHT_SNAPSHOT_TOP = 3）。 */
```

## `packages/lykoi-regulation/src/index.ts:156`

```ts
/**
 * SA-44：question 类念头 open 超时（小时）→ 悬决压力（出口 ②，regulation.py:85 逐字）。
 * W2 快照的 _apply_lazy_overdue_penalty 消费（与 thread 30 天超龄共用 suspension_overdue 因）。
 */
```

## `packages/lykoi-regulation/src/index.ts:164`

```ts
/** SA-79：THRESHOLDS 五值逐字（regulation.py:61-69）。 */
```

## `packages/lykoi-regulation/src/index.ts:180`

```ts
/** 八个效果键（SA-80；key 逐字，消费方按字符串取）。 */
```

## `packages/lykoi-regulation/src/index.ts:192`

```ts
/**
 * SA-79/80 cognitive_effects（regulation.py:180-204 逐字）。
 * 比较符号是契约：coherence 严格 **<** 0.4，其余三个严格 **>**（恰等于阈值不触发）。
 * P4-01（regulation.py:64-65 逐字）：early-integration trigger isolated above the
 * shared high-load band; prefer_rest / budget_multiplier stay on load_high=0.7 ——
 * 所以 load ∈ (0.7, 0.9] 只被推向休息，不触发提前整合；> 0.9 才两者兼有。
 */
```

## `packages/lykoi-regulation/src/index.ts:219`

```ts
/**
 * 测试注入面（SA-81 标【等价】：本移植把被检对象参数化，缺省即真注册表；
 * Python 版直接读模块全局，语义相同）。
 */
```

## `packages/lykoi-regulation/src/index.ts:229`

```ts
/**
 * SA-81 registry_problems（regulation.py:219-266 全套移植）——
 * "没有因果出口的状态是装饰"这条宪法的可执行判据。空列表 == 注册表遵守蓝图。
 *
 * 对每个变量检查（§4.6）：baseline ∈ [0,1]；decay_kind 合法；有 decay rate 且 > 0；
 * accumulate 变量必须有显式泄压因（delta < 0 的 cause）；有升因；有降因；
 * 有 outlet_effects；每个声明的 outlet key 确实由 cognitive_effects 产出。
 * 功能性证明（:247-258）：把变量推到 0.0 / 1.0 两个极值，其声明的效果必须相对
 * neutral（全体取各自 baseline）至少动一个，否则报 "outlet never fires (因果出口不通)"。
 * 反向检查（:259-265）：effect_keys - claimed → "effect {key!r} claimed by no variable"；
 * 每条 cause 的目标变量必须存在、delta 非零。
 */
```

## `packages/lykoi-regulation/src/index.ts:323`

```ts
/** Python `{key!r}` 的输出形态（单引号包裹）—— 消息片段是契约（§4.6 逐字）。 */
```
