Working tree clean, 9 commits on `wo/u2`. Report follows.

---

# WO-U2 · 心智入场 — 执行报告

分支 `wo/u2`,起点 `b0a0e593`,尖 `67adbd11`。9 个 commit,一判据一个。
全程前台串行,测试一律 `timeout 1800` 包裹。

**先说结论里最要紧的一条**:判据① 与两条封存线不变量**直接矛盾**,我没有自作主张改它们,它们今天是红的。详见 §口径冲突。

---

## 判据① 前缀重排 (CACHE-INVERT 本体) — `b8c1ec20`

### 组装顺序前后对照

下面右列是**跑出来的**(`Conversation.assemble_layout()` 的真实输出),不是手写的:

| 重排前 (WO-U2 之前) | 重排后 (WO-U2 之后) |
|---|---|
| persona 人格头 | persona 人格头 |
| narrative 自我叙事 | **organs 器官清单** ← 新 |
| backfill 重启回灌 | narrative 自我叙事 |
| summary 早前对话摘要 | backfill 重启回灌 |
| thoughts 念头 | summary 早前对话摘要 |
| time **当前时间** | **concerns 活跃关切** ← 新 |
| undelivered 有话没送出去 | ─── **history 对话历史** ─── |
| self_state | **memories 相关记忆** ← 新 |
| ─── history 对话历史 ─── | thoughts 念头 |
| | time **当前时间** |
| | undelivered 有话没送出去 |
| | self_state |
| | → 生成点 |

(演示环境没有 `NARRATIVE_FLAG_PATH` 那个 flag 文件,所以实跑输出里 narrative 两列都不出现;它在稳定前缀里的位次由代码钉住,见 `_stable_prefix`。)

**病灶**:`[当前时间]` 分钟粒度每轮必变,原本排在 message 0 之后、活窗之前 —— 于是每一轮的可匹配前缀都在那里截断,后面整段历史一个 token 都缓存不上。基线 48% 命中率、8.1k prompt/次就是这么来的。重排后可匹配前缀随对话增长。

**实现**:`_assemble` 拆成 `_stable_prefix()` / `_volatile_tail()` 两个**带标签**的取块器,外加 `assemble_layout()` 只吐标签序列。结构守恒测试断言标签而不是 content 前缀 —— 后者会把"改了一句提示词"误报成"少了一个块"。

### 尾部块角色的决定与依据

**继续用 `system`。** 离线依据全部来自仓内既有代码(未实测 API):

1. `conversation.py::_run_loop` 收尾轮**本来就**往 `self._messages` 末尾追加一条 system 消息(`[工具步数已用完]`),它排在全部 user/assistant/tool 之后。这是现网跑了两个月的形态 —— 07-05×3 / 07-06×2 五次 DSML 泄漏事故的记录都发生在这条消息之后的那一拍,说明消息本身被正常接受、模型正常续写。
2. `llm_client.chat_completion` 把 `messages` 原样塞进 payload(`payload = {"model":…, "messages": messages}`),不做任何角色重排、合并或去重。
3. 全仓 grep `尾部/末尾/最后一条/trailing` 未找到任何关于 DeepSeek 消息尾部角色的既有约束或注记。

所以"尾部 system"在这条链路上是**既有事实**,不是本单新开的赌注。

---

## 判据② 器官清单 — `5213ecac`

新模块 `src/lykoi/cognition/organs.py` + `mind/store.py` 一个只读口 `identity_binding_inventory()`。

**层次自证(落点 `cognition/` 而非 `memory/`)**:`conversation.py` 文件头钉的方向是 `surface → cognition → kernel → resources`,cognition **不许** import resources。所以设备维度走 `mind.store` 那张登记表,而不是 `resources/telegram_device.CHANNEL`;动作维度走 `kernel`,是合法下游。不落 `memory/` 是因为器官不是记忆:她不需要"记住"自己有嘴,那是每个进程起来时从代码重新长出来的事实。

**三条来源全部代码/登记处派生**(D5),没有一条是人写的清单。

### 器官清单样例输出(脱敏后原样)

```
[器官清单(只读)]
下面是你此刻实际长着的部件 —— 从代码和登记处派生出来的, 不是谁告诉你的, 也不是你记得的。要判断「我能不能做某件事」, 以这里为准。

身份绑定:
- telegram: Kevin — 所有者, 也是你的主用户

设备/通道(已登记的):
- telegram(1 条绑定)

动作能力(代码里实际接得通的全部):
- 自主路径的出口: autonomy.initiate_chat、autonomy.queue_notification
- 浏览器(她自己的, 带登录态): browser.click、browser.get_text、browser.navigate、browser.screenshot、browser.type
- IM 收发(她的社交躯体): messenger.read、messenger.send
- 给 Kevin 的通知: notify.owner
- 一次性调研浏览器(无登录态, 用完即毁): research_browser.extract_links、research_browser.open、research_browser.read_text、research_browser.screenshot
- 终端: terminal.exec, 其中每次都要 Kevin 点头的: terminal.exec
```

**secrets 边界**:不读 `os.environ`、不读任何 `*.env`、不读 `approval_rules.json`、不碰 `standing_grants`。刻意也不读活规则 —— 那份文件可变,读它清单就不再静态;且"今天这条被 always_allow 了"是策略事实不是器官事实。有一条正面扫描用例断言 `secret|token|api_key|apikey|password|credential|/home/lykoi/secrets|.env|bearer` 一律不出现。

**也不写 `channel_key`**:chat id 是寻址标识,对"我长着什么"零信息量,而把寻址标识放进每轮上下文只会让它更容易被不可信输入(白皮书 24 章)引用。她要往哪儿发消息走 `owner_channel_key`,不从 prompt 里抄 id。

**器官时效/健康 —— 留给 U3,如实报告**。通道最后事件时刻这类易变量本该并进 self-state 块,但 self-state 是 core 侧签名封存的结构,`src/lykoi/core/` 是本单 forbidden 的封存边界(属主 root),cognition 这一侧加不进去。**没做,也没假装做了。**

---

## 判据③ L3 检索入场 — `28f971f1`

`mind/relevance.py` 自 WO-L3 起就在,但只有层 2 深挖一个调用方 —— 她只在半夜回头想的时候才用得上档案。现在接进每一轮。

探针 = 来话截断 200 字作 `title`、`description` 空、`subject_user_id` 取 owner,`retrieve_for_concern(limit=6)`。

### L3 块渲染样例(真跑输出)

```
[相关记忆(跨时间;只读)]
下面是从你**全部**经验里按这句话召回的几条 —— 可能是几个月前的、已经消化过的。每条只有一行摘要, 不是原文;要用就自己判断可不可靠:
- [03-01 17:00] conversation: 和 Kevin 聊了睡眠质量, 他说最近总是凌晨四点醒, 想把睡前看手机的习惯改掉
- [07-21 06:05] conversation: 他说睡眠好转了一点, 但周末补觉反而更累
```

来话是「我最近睡眠质量是不是变差了」;库里那条"修好了浏览器截图的路径问题"没有混进来。整块 ~200 字,远在 2k tokens 之内。

**算在 `send()` 而不是 `_assemble()`**:`_enforce_budget` 会为收敛预算反复调 `_assemble`,在那里检索就会把一次全表扫描乘上裁剪轮数。展示期是这一轮,`try/finally` 在成功与失败回滚两条路上都清掉。

**零新增 LLM 调用(D3)**:探针是原样截断,不是让小模型改写查询词。有一条用例把 `llm_router.complete` / `describe_image` 换成会抛的桩,检索路径仍然通过。

**实体轴的代价,说在明处**:`subject_user_id` 在 `retrieve_for_concern` 里是**硬过滤**(JOIN `memory_scopes`),没有作用域行的经验召不回来。P2-01 的回填给全部历史行打了 `user_001`,今天的活体库上基本不咬人;`memory_scopes` 写入侧补齐之前新经验可能在实体轴上匿名。按工单口径实现的取舍,不是遗漏。

---

## 判据④ 活跃关切入场 — `9d1804c9`

**放稳定段末尾,自证**:这个块渲染的**只有** `title` 与 `description`。那两个字段的全部写者是 `create_concern` / `tend_concern` / `release_concern` —— 整合期的她、层 2 派生、或 owner 后门,全是**日级**边界。关切上确实有轮级字段 `lit_count` / `last_lit_at`,但它**不进渲染**:她需要知道自己在惦记什么,不需要知道那件事今天被点了 1381 次。

自证有物理面:`test_concern_render_ignores_the_turn_level_fields` 点亮三次后断言渲染**逐字节不变**。

上限 5 条,沿用 `list_concerns` 的 `weight DESC` —— 截掉的是她自己排在后面的那些,不是随机丢。文案明写"不是任务清单;他没问就不必主动汇报",免得把一个只读的自我认识块读成待办。

---

## 判据⑤ 转正洞见入场 — `d116c575`

`store.promoted_focus_insights()` 至今零调用者 —— `focus.py` 自己的 docstring 都写着"今天层 2 的结论没有任何下游消费者"。她每晚回头深想一次,想出来的东西从不回到她自己身上。本单接上它。

**只读 `active`**。四个非转正态各有一条参数化反向用例扫全装配面:`shadow` / `contested` / `revised` / `withdrawn` 一条都不进任何块。

**落点自证(白皮书 §8)**:§8.1 把人格拆成三个**来源**并要求"变化的来源必须可区分"。深挖结论属 §8.3「经历形成的人格」—— 与既有 acquired 层同类,所以落在 acquired 层的位置,但自带独立小标题("你自己想明白的事"),来源仍然可区分。**不落叙事块**:叙事是 §9.2 的自我叙事,整合期写的散文,讲"发生了什么、意味着什么";把一条带血缘、走过影子门的结论混进那段散文,会把两种来源不同的东西糊成一团,正是 §8.1 禁止的。

**⑤ 与 ⑥ 的调和(说清楚)**:工单 ⑤ 写"`build_persona_prompt()` 的 acquired 层",但那个投影是 `mind/decide.py` 与对话路径**共用**的,而 ⑥ 把 decide 钉成 usage 对照组、一行都不动(包括它实际拿到的字节)。所以我把这一层**只在对话路径上叠加**,位置仍是 acquired 层之后。两条路径由此在 acquired 之后分叉 —— 工单已点名把这件事留给 U3。有正面用例断言 `build_persona_prompt()` 与 `decide.build_messages()` 都看不见转正结论。

---

## 判据⑥ 整合边界刷新 — `641d0924`

**工单写的是"进程内缓存失效钩子",字面照做行不通,这里说清楚**:`run_integration` 跑在 autonomy 进程,对话的 `Conversation` 活在 server 进程(两个 systemd unit)—— autonomy 里调一个函数,server 的缓存一个字节都不会动。

所以失效**信号**取自两边都读得到的库,缓存本身仍是进程内的。`_nightly_epoch()` 读两个印记:

- `integration_state.last_integration_at` — 层 1。由 `reset_integration_cycle` 写,而后者只在 `accepted_any` 时才被 `run_integration` 调用。这正是要的判别力:一次什么都没接受的整合不改人格/洞见/关切,不该花掉一次全量 miss。
- 最新的 `focus_cycles.id` — 层 2。转正发生在周期结尾的 `_promote_due_insights`,不写 `integration_state`;只看层 1 会漏掉"昨晚有一条结论转正了",而那正是 ⑤ 要送进人格头的东西。

印记变 → 重建人格头 + 器官清单 + 活跃关切。印记读不到 → **保持现状**(不重建、不报错)。计划内全量 miss ≤1 次/天。

**不进缓存的**:自我叙事块。它由 `NARRATIVE_FLAG_PATH` 文件开关逐轮把门,既有注释明写"touch/rm 即时生效" —— 按整合印记缓存会把那条即时性弄没。

**decide 对照组**:有一条源码级用例扫 `decide.build_messages`,`organ` / `BLOCK_` / `relevance` / `promoted_focus_insights` / `list_concerns` / `_stable_prefix` / `_volatile_tail` 一个都不许出现。

---

## 判据⑦ 转录窗 30 → 8 — `1270a841`

默认 8,env `LYKOI_CONTEXT_WINDOW_TURNS` 覆盖保留。

30 轮是"她只有活窗"那个时代的配置。现在更早的对话由两条更合适的路承担:掉出窗口的先进滚动摘要再丢(既有语义一字未改),更早的由 L3 按来话召回。

**接力已实测**:连发 11 轮后活窗恰剩 8 轮(第3~第10),掉出去的第0/第1/第2 轮逐条出现在 `_summary` 里且不在活窗里 —— 先摘要、再丢。摘要产物进稳定段。

env 覆盖那一半在**子进程**里验,有原因:常量 import 时求值,进程内 `importlib.reload` 会换掉 `Conversation` / `ContextBudgetError` 类对象,别的测试文件已绑旧的,它们的 `pytest.raises` 会当场接不住。**这是真踩过的坑** —— 先前用 reload 写,`test_p0_context::test_oversized_single_round_raises` 在同一次运行里变红。原因写进了用例 docstring。

---

## 判据⑧ 零扰动与结构守恒 — 分散在各判据 + `d7f10680` 收口

- **⑧a 空态不注入**:四个新块各有空态用例,空块 = 零字节差。
- **⑧b 块集合守恒**:参照物是**显式写在测试里的重排前顺序**,不从被测代码再导一遍(后者会把"两边一起漂了"当成通过)。
- **⑧c 逐块内容一致**:两条断言 —— 人格头在无转正结论时与 WO-U2 之前**逐字节相同**(参照物同样手写在测试里);四新块全空时 layout 恰好回到 `persona / backfill / summary / history / time`。

**器官清单的边界不藏着**:它的动作能力段派生自 `KNOWN_ACTIONS`,那张表永远非空,所以现实里这一块**不会空** —— "四新块全空"这个前提对它只能靠桩造出来。这不是绕过判据:⑧a 要求的是"空态不注入",而器官清单按构造就没有空态。

---

## 判据⑨ 全邻接 — 先列后跑

清单原样(31 文件;前 21 条即 WO-FIX-APPROVAL-UX / WO-U1 的 conversation 邻接口径,由 `grep -ln "cognition.conversation|Conversation("` 精确复现出 21 个,与既有口径吻合):

```
tests/test_chatloop_e2e.py                              tests/test_p0_context.py
tests/test_chatloop.py                                  tests/test_p0_surface_errors.py
tests/test_conversation_inner.py                        tests/test_p2_s3_approval_wiring.py
tests/test_core_v1_m3_r2c_r1_permission_evidence.py     tests/test_pending_hygiene.py
tests/test_core_v1_m3_r2c_s4_cognition_envelope.py      tests/test_persona.py
tests/test_core_v1_m3_r2c_s5_symmetric_consumer.py      tests/test_u1_undelivered_feedback.py
tests/test_core_v1_m3_r2c_s6_shadow_provider.py         ── 判据⑨ 点名的其余 ──
tests/test_core_v1_m3_r2c_s7_shadow_wiring.py           tests/test_core_v1_m3_r2c_s3_self_state_query.py
tests/test_core_v1_m3_r2c_s9_live_injection.py          tests/test_l2_intake.py
tests/test_dsml.py                                      tests/test_l3_relevance.py
tests/test_followup.py                                  tests/test_l4_focus.py
tests/test_governance_invariants.py                     tests/test_messenger.py
tests/test_inner_outer_pair.py                          tests/test_telegram_device.py
tests/test_mind_beat.py                                 tests/test_telegram_transport.py
tests/test_mind_thoughts_outlets.py                     tests/test_gate5_l1_scan.py
                                                        tests/test_p0_integrity.py
                                                        tests/test_u2_mind_entry.py  ← 本单新增
```

### 逐条结果与归因

| 文件 | 改动前 | 改动后 | 归因 |
|---|---|---|---|
| test_chatloop_e2e | pass | 3 passed 1 skipped | 无变化 |
| test_chatloop | pass | 21 passed | 无变化 |
| test_conversation_inner | pass | 20 passed | 无变化 |
| test_core_v1_..._r1_permission_evidence | pass | 12 passed | 无变化 |
| test_core_v1_..._s4_cognition_envelope | pass | 9 passed | 无变化 |
| **test_core_v1_..._s5_symmetric_consumer** | pass | **1 failed** 9 passed | **本单造成 · 口径冲突, 未修改, 见下节** |
| test_core_v1_..._s6_shadow_provider | pass | 10 passed | 无变化 |
| test_core_v1_..._s7_shadow_wiring | pass | 6 passed | 无变化 |
| **test_core_v1_..._s9_live_injection** | pass | **1 failed** 4 passed | **本单造成 · 同一条口径冲突** |
| test_dsml | pass | 14 passed | 无变化 |
| test_followup | pass | 9 passed | 无变化 |
| test_governance_invariants | pass | 16 passed 1 skipped | 无变化 |
| test_inner_outer_pair | pass | 5 passed | 无变化 |
| test_mind_beat | pass | 29 passed | 无变化 |
| test_mind_thoughts_outlets | pass | 11 passed | 无变化 |
| test_p0_context | pass | 13 passed | 无变化(30→8 与重排均未破坏它) |
| test_p0_surface_errors | pass | 4 passed | 无变化 |
| test_p2_s3_approval_wiring | pass | 38 passed | 无变化 |
| test_pending_hygiene | pass | 5 passed | 无变化 |
| test_persona | pass | 10 passed | 无变化 |
| test_u1_undelivered_feedback | pass | 14 passed | 无变化(未送达块仍在尾部) |
| test_core_v1_..._s3_self_state_query | pass | 12 passed | 无变化 |
| test_l2_intake | pass | 28 passed | 无变化(nightly 钩子邻接) |
| test_l3_relevance | pass | 25 passed | 无变化(检索机器一行未改) |
| test_l4_focus | pass | 43 passed | 无变化(只加了读侧消费者) |
| test_messenger | pass | 15 passed | 无变化 |
| test_telegram_device | pass | 14 passed | 无变化 |
| test_telegram_transport | pass | 21 passed | 无变化 |
| test_gate5_l1_scan | pass | 3 passed | 无变化(全树时钟扫描仍为空) |
| **test_p0_integrity** | **1 failed** | **1 failed** | **同一条、同一原因 —— 非本单造成**(下述) |
| test_u2_mind_entry | (不存在) | **49 passed** | 新增 |

**合并一次跑**(权威值):

```
改动前: 1 failed, 445 passed, 6 skipped   (30 文件, 756.78s)
改动后: 3 failed, 492 passed, 6 skipped   (31 文件, 922.12s)
```

算术对得上:`445 + 49(新增) − 2(转红的两条) = 492`。**除那两条口径冲突外,新失败为零。**

`test_p0_integrity::test_committed_manifest_matches_available_protected_sources` 基线即红:它遍历到 `/home/lykoi/state/approval_rules.json` 就 `PermissionError`(0600,属主 lykoi,以 claude 身份读不到)。工单已预先说明这条是假失败,不是我造成的。

**时钟纪律**:本单没有新增任何裸读时钟(唯一的时刻读仍是既有的 `shared.clock.now()`),`test_gate5_l1_scan` 全树扫描仍为空,无需 `# realtime-allow` 尾注。

---

## 判据⑩ manifest 重签 — `67adbd11`

**107 → 108**。两条改哈希 + 一条新增:

```
src/lykoi/cognition/conversation.py   6330f873… -> 09934099…
src/lykoi/mind/store.py               083ff734… -> 4a607d38…
src/lykoi/cognition/organs.py         (新增)     ecdf19ee…
```

条数 +1 是因为器官清单落在 `cognition/` 内,`startup_verify._cognition_py()` 会 glob 到它,必须有锚。

`--write-manifest` 在本工作机跑不完(要哈希 owner 域那份读不到的 `approval_rules.json`)。沿用 WO-U1 `60b12c0c` / WO-REWIRE-PROACTIVE `9703e977` 先例:只逐行同步本次改动的源文件,那一行不可读的锚**原样保留、未被改写**。

为了让"我改的三个文件重签对了没有"真的被回答(而不是被那条已知失败挡住),另跑了与 `test_committed_manifest_matches_available_protected_sources` 同逻辑、但跳过读不到路径的核对:

```
manifest 行数=108  受保护源=108  逐条核对通过=107  缺条目=0  哈希不符=0  读不到=1
UNREADABLE (锚原样保留, 未改写): /home/lykoi/state/approval_rules.json
```

**新增 env / 落在 state 目录的路径常量:零。** 本单唯一的 env 读仍是既有的 `LYKOI_CONTEXT_WINDOW_TURNS`(只改默认值 30→8,名字没动),所以教训 36 要求的 `tests/conftest.py` 默认表这次**没有需要补的条目**,静态守卫 `test_no_state_path_constant_points_at_the_live_state_dir` 不受影响。

---

## 🔴 口径冲突 — 停下写清楚,未自作主张修改

两条**封存线不变量**与判据① 直接矛盾,今天是红的:

```
tests/test_core_v1_m3_r2c_s5_symmetric_consumer.py::test_injection_is_last_system_message_before_live_user_data
tests/test_core_v1_m3_r2c_s9_live_injection.py::test_both_completion_paths_inject_before_live_user
```

**它们断言的是同一件事**:self-state 注入之后必须**紧跟一条 `user` 消息**
(`assert messages[index + 1]["role"] == "user"` / `assert injection_index < max(user_index)`)。

**判据① 明写** self-state 是易变尾部**最后一块**、其后直接是生成点。对话路径上它后面不再有 user 消息 —— 活窗已经在上游。所以这两条断言在判据① 成立的前提下**不可能同时成立**,不是实现瑕疵。

补充三点事实,供治理侧裁决:

1. 这两条保护的**语义意图**(注入的规范数据紧贴生成点、不被埋在别处、不被读成指令)在重排后**加强了**而非削弱:self-state 现在离生成点更近,中间不再隔着整段对话历史。断掉的只是"后面得有一条 user"这个**位置形式**。
2. 两路径的对称性本来就被本单**有意**打破 —— 判据⑥ 钉死 decide 一行不动,工单也已把"两路径 acquired 排序不一致"明文留给 U3。s5/s9 的对称假设在 U2 之后不再成立,这是工单口径的直接后果。
3. 同一次重构里另有一条 s5 断言 `test_both_consumers_use_shared_preparer_without_source_readers`(源码级扫 `Conversation._assemble` 是否走共享 preparer)一度变红,但那是**纯机械**的:我把调用下沉进了 `_volatile_tail`。这条我**修了实现而不是修测试** —— 把 `prepare_injection` 的调用留在 `_assemble` 体内、prepared 对象作参数传给取块器,那条证明因此原样有效。区别在于:它守的性质仍然成立,而上面两条守的性质与判据① 真的互斥。

**我没有动这两条。** 若治理侧确认判据① 优先,最小改动是把两处断言从"其后必须有 user"改成"它是最后一条 system 且其后没有别的 system"(对 decide 路径仍然等价成立)。这属于封存线口径变更,不该由执行 Agent 单方面决定。

---

## 新增文件全集

| 路径 | 属主预期 | 说明 |
|---|---|---|
| `src/lykoi/cognition/organs.py` | `lykoi:lykoi 0644` (同目录其余 .py) | 器官清单生成模块,已入 manifest |
| `tests/test_u2_mind_entry.py` | `lykoi:lykoi 0644` | 49 例;测试文件不在 manifest 覆盖范围 |

改动文件:`src/lykoi/cognition/conversation.py`、`src/lykoi/mind/store.py`、`guardian/manifest.sha256`(属主/模式均不变)。

---

## 未做 / 留给 U3(如实清单)

1. **器官时效与健康**(通道最后事件时刻等)—— self-state 是 core 侧签名封存结构,`src/lykoi/core/` 是本单 forbidden 的封存边界,cognition 这一侧加不进去。判据② 已预先允许此项留给 U3。
2. **两路径 acquired 之后的分叉** —— 工单明文留 U3,本单不修。
3. **usage 命中率的实测验证** —— 判据目标是"重排后 main 命中率 ≥70%、completion/次不显著变化"。这只能在活体跑一段之后从 `llm_call` 事件的 `prompt_cache_hit_tokens` / `cache_miss_tokens` 读出来(`llm_client.py:144` 已经在记这两个字段)。**本单交付的是重排本身,不是命中率的事后测量**;需要部署后由治理侧取一段 usage 对照基线 48%。
