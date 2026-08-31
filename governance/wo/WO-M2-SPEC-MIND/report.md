I'll start by orienting in the workspace, then work through the seven sections serially.

# WO-M2-SPEC-MIND · 心智侧行为规格提取报告

基线：`~/lykoi-work-m0/` = 活体 HEAD `4463ae8`(tag cordis-night-20260822)只读副本。行号以副本为准。
零写入已遵守；未跑 pytest；未读 `/home/lykoi/`、state、secrets。

**副本缺件核对（与工单预告的差异）**：本次 `find . -name '*.py' ! -readable` 与 `-perm 600` 均返回空集 —— 副本内**没有**不可读的 .py。工单预告的"5 个 0600 R2c 产物"在本副本上不成立；`src/lykoi/core/` 目录整体不存在（`src/lykoi/` 下只有 surface/memory/core?/… 实测:`core` 存在但内容需另核）。**唯一确证的缺件是人格 TOML**：`/home/lykoi/runtime/persona/lykoi_base.toml`（owner 域，进程外）不在副本内，副本只有 `tests/fixtures/lykoi_base.toml`。凡涉 persona 投影的 sha256 一律标注"fixture 口径"。[事实]

标注约定：**[事实]** = 从副本源码逐字读出；**[推断]** = 由代码推导但未在源码中明写；**[建议]** = 本报告给新体的建议，非活体事实。

---

## §1 自主侧决策契约逐字 — `mind/decide.py`

### 1.1 KINDS 7 项（`mind/decide.py:36`）[事实]

```
KINDS = ("explore", "record_note", "queue_notification", "initiate_chat", "tend_inner", "rest", "contemplate")
```
元组**顺序即候选表渲染顺序**：`build_candidates` 末行 `return [catalogue[kind] for kind in KINDS if kind in allowed]`（`decide.py:239`）以 KINDS 为遍历序，不以 `allowed` 集合序 —— 集合无序，若以 allowed 遍历则候选表顺序非确定性。**新体必须保留有序 KINDS 作为渲染锚**。

### 1.2 CONTENT_REQUIRED_KINDS（`decide.py:42`）[事实]

```
CONTENT_REQUIRED_KINDS = ("record_note", "queue_notification", "initiate_chat", "tend_inner")
```
`contemplate` **刻意不在其中**（`decide.py:39-41` 注释 + `decide.py:578-582`）：它纯内向，产出在 inner 块。校验点 `decide.py:581`：`if kind in content_required and not (content or "").strip(): raise ValueError(f"{kind} requires 'content'")` —— **抛异常，不降级**（契约破坏 vs 护栏违规的分野，见 1.7）。

### 1.3 SAFE_KIND（`decide.py:48`）[事实]

`SAFE_KIND = "rest"`。工单 WO-U3 ① 已把它提为**参数**（`evaluate_message(..., safe_kind: str = SAFE_KIND)`，`decide.py:538`），对话情境传 `"silence"`。语义：失败方向的落点，且**自身永不被降级**（`decide.py:613-614`：`if kind == safe_kind: return decision`）。

### 1.4 `Decision` 全字段（`decide.py:83-120`）[事实]

| 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `kind` | str | 必填 | 决策类型，KINDS 白名单内 |
| `content` | str\|None | None | 内容载荷 |
| `url` | str\|None | None | explore 的起点 |
| `thread_id` | int\|None | None | 经 `_gated_int` 快照闸 |
| `concern_id` | int\|None | None | 经 `_gated_int` 快照闸 |
| `reason` | str | `""` | 必须逐字引用评估条目 |
| `next_wake_after_minutes` | int\|None | None | 仅当 `isinstance(minutes, int)` 才留（`decide.py:598`）；**decide 层不 clamp** |
| `meaning_assessment` | list[dict] | `[]` | `_sanitize_assessment` 产物 |
| `grounded_concern_ids` | list[int] | `[]` | 被引用条目中带 concern_id 的 |
| `demoted` | bool | False | 降级标记 |
| `demote_why` | str\|None | None | `kind_not_in_candidates` \| `reason_not_grounded` |
| `original_kind` | str\|None | None | 降级前的 kind |
| `inner` | dict | `{"thoughts": [], "resolve": []}` | §5.5 §2 内向通道 |
| `injected_thought_ids` | list[int] | `[]` | 本拍注意力域（排序后） |
| `envelope` | dict | `{}` | WO-U3 ① 情境专属字段，**原样抬入，零解释** |

`as_dict()`（`decide.py:112-120`）过滤集：`(None, [], "", {}, {"thoughts": [], "resolve": []})`。**这是一条极易在移植中破坏的字节级契约** —— 注释明写 `{}` 加入 drop-list 后自主路径持久化的 decision JSON "一个字节都不变"，因为没有任何既有字段可能等于 `{}`。

### 1.5 `DECIDE_SYSTEM_PROMPT`（`decide.py:244-288`）[事实]

- file:line 范围：`mind/decide.py:244-288`（`244` 为 `DECIDE_SYSTEM_PROMPT = """\` 起行，`288` 为闭合行）
- 字符数：**1634**
- sha256：**`a495848d8abaae9f5e22ec9aaa95688f8928ac1e0b8cca6ec14de5d8f38a636e`**

内容纪律（`decide.py:10-12` 顶注，红线 #2）：**只呈现，不训诫；正反两个方向都不许** —— 既无劝安静的话，也无催行动的话。移植时任何"友善补一句引导"都是违宪修改。

### 1.6 `build_candidates` 全部动态规则（`decide.py:140-239`）[事实]

**输入面**：`values = _snapshot_values(snap)`（读 `snap["调节场"][*]["value"]`，`decide.py:125-126`）；`effects = regulation.cognitive_effects(values)`；`budget = snap["环境"]["预算"]`。

**三个预算读数**（`decide.py:146-150`）：
- `hourly_left = budget["本小时剩余行动数"]` —— 直取，缺键即 KeyError（**不 fail-closed**）
- `notifs_left = budget["今日剩余通知数"]` —— 同上
- `proactive_left = budget.get("今日剩余主动开口数", 0)` —— **缺键 → 0 → 不候选（fail-closed）**，因为它是后加字段（WO-NIGHT-01/B3）

**权重基表**（`decide.py:51-61`）：
```
explore 0.5 / record_note 0.4 / queue_notification 0.3 / initiate_chat 0.3
tend_inner 0.4 / rest 0.5 / contemplate 0.4
```
**权重加成**（`decide.py:152-155`）：
- `weights["explore"] += effects["exploration_weight_bonus"]`（hunger>0.6 时 +0.2）
- `weights["queue_notification"] += effects["relationship_weight_bonus"]`（tension>0.6 时 +0.2）
- `weights["initiate_chat"] += effects["relationship_weight_bonus"]` —— 与 queue_notification **平权**
- 常量：`REST_PREFERRED_BONUS = 0.2`（`decide.py:62`）、`TEND_INNER_FORCED_BONUS = 0.3`（`decide.py:63`）
- 所有权重经 `round(weights[kind], 3)` 落进 Candidate（`decide.py:194` 等）

**三分支菜单裁剪**（互斥，`decide.py:157-185`）：

1. **`force_inner_tending`（coherence < 0.4）优先级最高**（`decide.py:157-161`）
   `allowed = {"rest", "tend_inner", "contemplate"}`；`weights["tend_inner"] += 0.3`。
   注意：**此分支完全不看预算** —— 三个 kind 都是内部动作。

2. **`elif prefer_rest`（load > 0.7）**（`decide.py:162-177`）
   `allowed = {"rest", "tend_inner", "contemplate"}`；`weights["rest"] += 0.2`。
   `initiate_chat` 在 load 高位**从不候选**（`decide.py:166` 明写预算约定）。
   **探索饥饿棘轮 EXPLORE_STALL_OVERRIDE**（WO-P4R-18，`decide.py:172-177`）：三条件**全部**成立才 `allowed.add("explore")`：
   - `values["exploration_hunger"] > regulation.THRESHOLDS["hunger_high"]`（>0.6，**严格大于**）
   - `_explore_stalled(snap)` 为真
   - `hourly_left > 0`
   
   `_explore_stalled`（`decide.py:129-137`）：读 `(snap.get("环境") or {}).get("探索")`；非 dict → **False（fail-closed，不凭缺失数据扩菜单）**；`hours = info.get("断粮小时")`；`return hours is None or hours >= EXPLORE_STALL_OVERRIDE_H`（`EXPLORE_STALL_OVERRIDE_H = 24.0`，`decide.py:68`）。**从未完成过 explore（None）也算断粮**。
   
   机理（`decide.py:65-68` 注释）：hunger 唯一真实泄压回路是 `explore_completed`，而 load 高位把 explore 逐出菜单 → hunger 只升不降。此规则**只还一个泄压出口，不伪造满足**。

3. **`else`（正常）**（`decide.py:178-185`）
   `allowed = set(KINDS)`，再按预算减：
   - `hourly_left <= 0` → 去掉 `{"explore", "queue_notification", "initiate_chat"}`
   - `notifs_left <= 0` → 去掉 `{"queue_notification"}`
   - `proactive_left <= 0` → 去掉 `{"initiate_chat"}`
   - **`rest` / `record_note` / `tend_inner` / `contemplate` 在任何预算下都不被裁掉** —— "安静永远是合法的"（`decide.py:142-143`）

**contact_note 拼装**（`decide.py:187-189`）：基串 `"Kevin 稍后会看到;受脑干上限约束(每日 ≤2)"`；`effects["unlock_proactive_contact"]` 为真时追加 `";关系张力高,主动联系已解锁加成"`。

**7 条 Candidate 的 cost / note 文案逐字**（`decide.py:191-238`）—— 全部是"事实性因果说明"，**不是劝诫**：

| kind | cost | note |
|---|---|---|
| explore | `消耗 1 行动预算;读 1 个公开网页(只读,与 Kevin 的浏览器隔离)` | `完成后 exploration_hunger {CAUSES['explore_completed'][1]:+.2f};没有 url 的探索会扑空(记 failed)` → 渲染为 `-0.40` |
| record_note | `内部动作,不消耗行动预算` | `写入我的自主笔记(append-only)` |
| queue_notification | `消耗 1 行动预算 + 今日通知配额(剩 {notifs_left})` | `contact_note` |
| initiate_chat | `消耗 1 行动预算 + 今日主动开口份额(剩 {proactive_left};日 1 条、冷却 6 小时,比通知更紧)` | `在对话框里主动开口(kind=proactive):消息出现在与 Kevin 的对话里,不是手机通知;他打开对话就会看到` + 条件后缀 |
| tend_inner | `内部动作,无外部副作用,不经 kernel` | `三种形式:给一条线写进展(thread_id)/调整一条关切描述(concern_id)/给自己留 note(都不带)` |
| rest | `0` | `load {CAUSES['rested'][1]:+.2f};按 next_wake_after_minutes 再醒(5-360 分钟)` → 渲染为 `-0.10` |
| contemplate | `内部动作,花一拍,无外部副作用` | `围绕快照中 Top 念头/关切的推进(新念头、resolve 既有念头、对一条 question 写部分回答)` |

**关键**：explore 与 rest 的 note **从 `regulation.CAUSES` 表插值**（`decide.py:196-197`、`decide.py:229`），不是硬编码字符串。改 CAUSES 的 delta，候选文案自动跟随 —— 这是"数值只许在常量表"纪律的一个实现面。新体必须保留这条插值链，否则 prompt 里的因果说明会与真实 delta 漂移。

`rest` note 里的 "5-360 分钟" 是 `autonomous.MIN_REST_MIN/MAX_REST_MIN` 的**手写副本**，与 `clamp_rest` 无代码链接 —— 这是一处已存在的漂移风险点。[事实/风险]

### 1.7 `next_wake_after_minutes` 契约与 clamp_rest [事实]

**分层**：
- `mind/decide.py:585,598` —— 只做类型闸：`minutes = raw.get("next_wake_after_minutes")`；`next_wake_after_minutes=minutes if isinstance(minutes, int) else None`。**注意 `bool` 未被排除**（与 `_opt_int`/`_gated_int` 不同，那两处显式 `not isinstance(v, bool)`）：`true` 会被当成 `1` 通过闸门，随后被 `clamp_rest` 提到 5 分钟。[事实 / 已知缺陷，见 DA-04]
- `cognition/autonomous.py:63-69` —— `clamp_rest`：
  ```
  MIN_REST_MIN = 5 / DEFAULT_REST_MIN = 30 / MAX_REST_MIN = 360   (autonomous.py:53-55)
  try: value = int(minutes)
  except (TypeError, ValueError): return DEFAULT_REST_MIN
  return max(MIN_REST_MIN, min(MAX_REST_MIN, value))
  ```
- 调用点 `autonomous.py:129-130`：`_compute_rest(minutes) → (clock.now() + timedelta(minutes=clamp_rest(minutes))).isoformat()`
- 四个调用位：正常拍（`autonomous.py:213`，传 `decision.next_wake_after_minutes`）、异常拍（`:215`，传 `DEFAULT_REST_MIN`）、hourly_cap 早退（`:171`，传 `DEFAULT_REST_MIN`）、开机首拍（`:302`，传 `MIN_REST_MIN`）、脏时间戳自愈（`:274`，传 `DEFAULT_REST_MIN`）。

**D-CB-1 现状 vs 定案差异** —— 定案原文在活体代码里有直接引用（`cognition/heartbeat.py` 顶注，逐字）：

> **不读模型的发言权**。Owner 拍板 D-CB-1:心跳件接管后节律全归心跳件,模型不再拥有"我想 N 分钟后再醒"。所以本模块**不读** `decision.next_wake_after_minutes`,也不把 `autonomy_state.next_wake_at` 当输入 —— 它只把 `autonomy_state.last_wake_at` 当作**开机对照读数**给自己的影子时钟播种。

| | 现状（HEAD 4463ae8） | D-CB-1 定案 |
|---|---|---|
| 谁定下一拍 | `decision.next_wake_after_minutes` → `clamp_rest` → `autonomy_state.next_wake_at` | 心跳件按确定性策略定；模型无发言权 |
| prompt 是否问她 | 问（`DECIDE_SYSTEM_PROMPT` schema 含 `"next_wake_after_minutes": 45`） | 应移除该字段 |
| 心跳件地位 | **影子件**，`ShadowPair.observe()` 只落 `heartbeat_shadow` 遥测，对活体调度零影响（`autonomous.py:304-320`） | 转正为唯一节律源（步 3，未做） |

心跳影子策略逐字（`heartbeat.py` 顶注 + `heartbeat.py:73-96`）：
```
基线 = clamp(env LYKOI_HEARTBEAT_BASELINE_MIN, 5, 360)，默认 30
地板 = MIN_REST_MIN = 5
显著性 = 自上次影子拍以来 salience_shadow.shadow_log 中 id>游标 且 selected=1 的新增行数 >= SALIENCE_TRIGGER_N(3)
would_wake = 地板已过 且 (基线到期 或 显著性达标)
reason ∈ {baseline, salience} / {floor, waiting}
两套序列: baseline_only / baseline_plus_salience (判据⑦)
```

### 1.8 demote / fail-closed 护栏（`decide.py:529-630`）[事实]

**解析链顺序**（不可重排 —— 顺序本身是语义）：
1. `_extract_json`（`decide.py:319-330`）：先整体 `json.loads`，失败则取首 `{` 到末 `}` 的切片再试；两次都失败 → `ValueError`，消息含 `content[:200]!r`
2. 顶层形状校验（`:565-566`）：必须是 dict 且 `raw["decision"]` 是 dict，否则 ValueError
3. `allowed_concerns = set(injected_concern_ids or ())` / `allowed_threads = ...`（`:568-569`）—— **fail-closed：None/空 → 空集 → 一切 id 被丢**
4. `_sanitize_assessment`（`:333-359`）：非 list → `[]`；逐条：`item`/`meaning` 强转 str；`concern_id` 必须 `isinstance(int) and not isinstance(bool)` **且在 allowed 内**，否则丢弃并 `log_event("grounding_concern_out_of_snapshot", concern_id=..., where="assessment")`；`pull` 夹到 [0,1]，异常 → 0.0。**文本一律保留** —— 文本接地（`grounded_entries`）不受 id 闸影响
5. kind 白名单（`:573-574`）→ 不在 → **ValueError（不是降级）**
6. content 必填校验（`:581-582`）→ **ValueError**
7. `_sanitize_inner`（见 1.9）
8. 构造 Decision，`thread_id`/`concern_id` 走 `_gated_int`（`:379-388`）：`_opt_int` + allowed 闸，落空则 None + `log_event(..., where="decision", **{ref: rid})`
9. `envelope_fields` 抬字段（`:604-608`）：先查 `decision_raw`，再查 `raw` 顶层；**原样，零解释**
10. `cited = grounded_entries(assessment, reason)`（`:362-372`）：条目的 `item` 或 `meaning` **逐字子串出现在 reason 中**且长度 `>= GROUND_MIN_CHARS`（=4，`decide.py:72`）才算引用；`decision.grounded_concern_ids = [e["concern_id"] for e in cited if "concern_id" in e]`
11. **三条终局判定**（`:613-620`，顺序即优先级）：
    - `kind == safe_kind` → 直接返回，**永不降级**
    - `kind not in {c.kind for c in candidates}` → `_demote(..., "kind_not_in_candidates")`
    - `not cited` → `_demote(..., "reason_not_grounded")`

`_demote`（`:623-630`）：`log_event("decision_ungrounded", why=, original_kind=, reason=decision.reason[:200])`；置 `original_kind` / `kind=safe_kind` / `demoted=True` / `demote_why=why` / **`grounded_concern_ids = []`**（清空 —— 降级后不许再点亮任何关切）。

**契约破坏 vs 护栏违规的分野**（`decide.py:541-546` 明写）：前者 raise → 本拍记 failed；后者降级 → "这一拍她还是醒过了,只是这次选择不算数"。

**WO-U3 ① 参数化边界**（`decide.py:548-559` 逐字声明）：可被情境替换的只有 `kinds` / `content_required` / `safe_kind` / `envelope_fields` 四个**词汇表**；**刻意不参数化的是纪律本身** —— demote 两条、三个 fail-closed 快照闸、逐字引用要求、safe_kind 免疫。

**与对话侧共用部分**：`evaluate_message` / `grounded_entries` / `_demote` / `_sanitize_inner` / `apply_inner` 五者由对话情境（`cognition/conversation_cycle`）以不同词汇表复用。按工单要求不复述，**引 SPEC-CONV 对应条目号**（对话侧 kind 表、`silence` 作 safe_kind、tool/情绪脉冲 envelope 字段的消毒归对话情境自管，见 `decide.py:105-109`）。

### 1.9 inner 通道（`decide.py:391-526`）[事实]

常量：`_INNER_THOUGHT_KIND_WHITELIST = ("intent","question","hypothesis","rumination","observation")`（`:393`）；`_INNER_MAX_THOUGHTS_PER_CALL = 2`（`:394`）；`_INNER_CONTENT_MAX = 200`（`:395`）。

`_sanitize_inner`（`:398-461`）—— **永不抛**：
- 非 dict → `{"thoughts": [], "resolve": []}`
- thoughts 扫描上界 `raw_thoughts[: 2*4]` = 前 8 条（有界扫描，`:419`）；逐条：content 必须 str、strip 后非空、`len <= 200`；kind 必须在白名单；`charge_hint` 夹 [0,1]（**bool 显式 raise TypeError → 回落 0.5**，`:433-434`）；`related_concern_hint` 必须 int 非 bool 否则 None；收满 2 条即 break
- resolve：**bool 显式排除**（`:456-457`，注释点名 Python 的 bool ⊂ int）；`isinstance(rid, int) and rid in allowed_ids` 才留 —— 注意力域红线在解析层的第一道闸

`apply_inner`（`:464-526`）—— 副作用面：
- 本地 import `mind.thoughts`（避免循环，`:477`）
- 创建：`create_thought(content, kind, source, related_concern_id=hint, charge_hint=, now=)`；`ValueError` → `rejected_create` 记 `{"thought":…, "reason": str(exc)}`；返回 `None`（容量软拒） → `rejected_create` 记 `reason="capacity"`
- 了结：`resolve_thought(rid, injected_ids=allowed, now=)` —— **store 层第二道闸**
- 返回 summary：`{"created","resolved","rejected_resolve"}`，有拒建时加 `"rejected_create"`
- **事件名由 source 派生**（WO-U3 ④，`:516-525`）：`log_event(f"{source}_inner_applied", created=, resolved=, rejected_resolve=, rejected_create=)` —— `"wake"` → `wake_inner_applied`，`"conversation"` → `conversation_inner_applied`。**新体不得改回 switch**：注释明写"归因可辨 keeps holding when a third source appears"

`build_messages` 消息顺序（`:291-314`，**字节级契约**）：
1. `{"role":"system", "content": build_persona_kernel(get_persona())}` —— 先天内核，与对话路径逐字节相同，**必须第一条**
2. `build_persona_prompt().strip()` 非空时追加 —— 后天 insights（修复旧不对称）
3. `DECIDE_SYSTEM_PROMPT`
4. `self_state_injection.prepare_injection(...)` 非 None 时追加（默认 `self_state_enabled=False`）
5. `{"role":"user", "content": json.dumps({"快照": snap, "候选动作": [asdict(c) for c in candidates]}, ensure_ascii=False)}`

`_autonomous_complete`（`autonomous.py:89-113`）在 live 自我状态开启时**插在最后一条 user 之前**（`messages[:-1] + prepared.message() + messages[-1]`，`:109`），并硬性要求最后一条是 user 否则 RuntimeError（`:107-108`）。

---

## §2 快照装配（自主侧）— `mind/snapshot.py`

### 2.1 CB-01 劈分后的现状：三个函数的边界 [事实]

| 函数 | file:line | 写? | 语义 |
|---|---|---|---|
| `maintain(now=None) -> datetime` | `snapshot.py:319-341` | **写** | 感知期维护，"仲裁器的活,一个心跳恰好一次" |
| `read(now=None) -> dict` | `snapshot.py:344-366` | **零写** | 纯读装配，九项里的 3-9 项 |
| `assemble(now=None) -> dict` | `snapshot.py:369-386` | 写 | 兼容外观 = `maintain(moment)` 然后 `read(moment)` |

**`maintain` 四维护写**（`snapshot.py:334-340`，顺序即语义）：
1. `mind_store.mark_dimming_dormant(now=moment)` —— 关切老化（7 天 → dimming，21 天 → dormant，`store.py:39-40`；**绝不自动 released**，红线 #3）
2. `mind_floor.maintain(now=moment)` —— 关切地板（WO-P4R-08）。位置注释逐字：*AFTER aging (so the aging drain is covered) and BEFORE integration reads the concern set, so an absorb target always exists*
3. `_apply_lazy_overdue_penalty(moment)` —— 超龄悬置惩罚
4. `mind_thoughts.decay_all_open_thoughts(now=moment)` —— 念头衰减（出口 ③）

**为什么第 4 项必须在读之前**（`snapshot.py:325-327` 逐字）：它可能当场把一条念头 lapse 成 abandoned + 一条 `thought_lapse` 经验，**经验块要看得见**。

**返回 moment 的理由**（`snapshot.py:329-331` 逐字）：两半分家各自取一次 `clock.now()` 会让维护写的时间戳与快照里的 `now` 错开，"那不是纯重构"。`assemble` 因此在 `:384` 解析时刻**一次**，两半共用。

**为什么劈分**（`snapshot.py:328` 逐字）：把维护从装配里抽出来具名，是为了让"取一份快照分发给 N 个分支推演"成为可能 —— 今天取快照本身就是一次状态变更（C-A 报告 §5.2 / ⑤ C12），那条路因此走不通。

**`_perceive` 侧的对应改动**（`autonomous.py:133-154`）：`snap = mind_snapshot.read() if snap is None else snap`（`:148`）—— 推演阶段对状态层零写入。`_build_snapshot` 测试钩子因此也零写（`autonomous.py:156-164`，H4 销账）。

### 2.2 快照全部块：内容来源函数、顺序、字符预算 [事实]

`read()` 装配顺序（`snapshot.py:352-362`，dict 插入序 = JSON 序列化序 = 她看到的顺序）：

| 键 | 来源函数 | file:line | 内容源 | 裁剪/上限 |
|---|---|---|---|---|
| `now` | — | `:353` | `moment.isoformat()` | — |
| `调节场` | `_regulation_block` | `:210-222` | `mind_store.get_regulation` + `recent_regulation_events` | value `round(…,3)`；每变量 `SNAPSHOT_REGULATION_EVENTS = 3` 条最近因 |
| `coherence_low` | — | `:355` | `effects["flag_low_coherence"]` | bool（快照中标红） |
| `关切` | `_concern_block` | `:225-241` | `list_concerns("active")` | Top `SNAPSHOT_CONCERN_TOP_N = 6`；`description` 裁 `DESCRIPTION_CLIP = 100` |
| `叙事` | `_narrative_block` | `:244-263` | `current_cognitive_narrative()` + `list_threads(("open","suspended"))` | `当前` 裁 `NARRATIVE_CLIP = 400`；线按 `updated_at` 升序（**最久没动的先看见**）取前 `SNAPSHOT_THREAD_CAP = 5`，每条 content 裁 `EXPERIENCE_CLIP = 200` |
| `经验` | `_experience_block` | `:266-274` | `count_pending_experiences()` + `recent_experiences(3)` | `SNAPSHOT_RECENT_EXPERIENCES = 3`；content 裁 200 |
| `念头` | `_thoughts_block` | `:277-296` | `get_thoughts_for_snapshot(top_n=THOUGHT_SNAPSHOT_TOP)` | Top-3（`regulation.THOUGHT_SNAPSHOT_TOP = 3`）；content 裁 200；charge `round(…,3)` |
| `环境` | `_environment` | `:132-160` | 见下 | — |
| `上一拍` | `_previous_beat` | `:299-316` | `memory_store.get_autonomy_runs(5)` | 跳过 `status=="running"`（本拍自己），取第一条已完结 |
| `刚刚醒来` | `render_restart_notice` | `:363-365` | **条件键** —— 仅当 `unprocessed_restart_event(get_autonomy_last_wake())` 非 None 才存在 | — |

裁剪常量集中在 `snapshot.py:44-65`：
```
SNAPSHOT_CONCERN_TOP_N = 6 / SNAPSHOT_THREAD_CAP = 5 / SNAPSHOT_RECENT_EXPERIENCES = 3
SNAPSHOT_REGULATION_EVENTS = 3
NARRATIVE_CLIP = 400 / DESCRIPTION_CLIP = 100 / EXPERIENCE_CLIP = 200
HOURLY_ACTION_CAP = 20
OVERDUE_PENALTY_MIN_INTERVAL_H = 24.0 / RHYTHM_WINDOW_DAYS = 14 / RHYTHM_WINDOW_HOURS = 2.0
RHYTHM_SCAN_ROWS = 1000 / MIN_GAP_SAMPLES = 5 / DEFAULT_TYPICAL_GAP_H = 24.0
```
`_clip`（`:81-82`）：`text if len(text) <= limit else text[:limit] + "…"` —— **省略号计在裁剪长度之外**。

**`环境` 块子结构**（`snapshot.py:142-160`）：
- `距上次和Kevin互动小时`：`round(hours_since, 2)` 或 None
- `同时段历史`：`{近14天此时段有互动的天数: same_window_days(...), 观察天数: 14, 典型互动间隔小时: round(median_gap_hours(...), 1)}`
- `等待批准的动作数`：`approval.pending_count()`
- `探索`：`{上次完成explore: <ts|None>, 断粮小时: round(...,1)|None}` —— 唯一事实来源是 regulation 账本的 `explore_completed` 事件（`:139-141`）
- `预算`：`{本小时剩余行动数: max(0, 20 - autonomy_actions_last_hour()), 今日剩余通知数: <见下>, 今日剩余主动开口数: proactive_chat.remaining_today(now), 预算系数: effects["budget_multiplier"]}`

`_notifications_remaining_today`（`:163-178`）：从**权威队列**读（`notifications.get_notifications(unread_only=False)`），只数 `origin=="autonomous"` 且 ts ≥ 当日 0 点的；`max(0, notifications.AUTONOMOUS_DAILY_CAP - spent)`，`AUTONOMOUS_DAILY_CAP = 2`（`kernel/notifications.py:33`）。注释逐字：**"the throttle itself stays in the kernel; this is a view, not an enforcement point"**。

主动开口配额：`shared/proactive_chat.py:20-21` —— `DAILY_CAP = 1`、`COOLDOWN_H = 6.0`。

**节律采样三纯函数**（reflow 的 cheap_tick 复用，`snapshot.py:87-129`）：
- `conversation_timestamps(now, days=14)`：`get_recent_history_of_type("conversation", 1000)`，过滤 `cutoff <= ts <= now`，**oldest first**；ValueError 的行跳过
- `median_gap_hours(stamps)`：`len(stamps) < MIN_GAP_SAMPLES + 1`（即 < 6）→ `DEFAULT_TYPICAL_GAP_H = 24.0`；否则相邻差的 median
- `same_window_days(stamps, now, window_h=2.0, days=14)`：对 `day in 1..14`，`anchor = now - day 天`，若任一 stamp 落在 `anchor ± 2h` 内则计 1

**`_apply_lazy_overdue_penalty`**（`:183-205`）：两个来源共用一条因与一个 24h 闸（裁决 7：**总压力钳,不按来源分管道**，`:187-189`）：
- `mind_store.overdue_suspended_threads(now)`（悬置 > `SUSPENDED_OVERDUE_DAYS = 30` 天）
- `mind_thoughts.overdue_questions(now)`（open 且 kind='question' 且 age > `QUESTION_OVERDUE_HOURS = 48`）
- 两者皆空 → return；否则查 `last_cause_event_ts(("suspension_overdue",))`，距今 < 24h → return
- 否则 `apply_regulation_cause("suspension_overdue")` **一次**，并 `log_event("suspension_overdue_breakdown", threads=, thoughts=)` 供 Phase 4 复盘（拆分只上日志，regulation_events 行保持简单）

### 2.3 注意力域（念头 / 关切 / 叙事线 id 注入集）的产生点 [事实]

**产生点唯一，在 `cognition/autonomous.py:150-152`**（`_perceive` 内）：
```python
injected_ids         = [t["id"] for t in snap.get("念头", [])]
injected_concern_ids = [c["id"] for c in snap.get("关切", [])]
injected_thread_ids  = [t["id"] for t in snap.get("叙事", {}).get("线", [])]
```
—— **从快照本身派生，不是另查一次库**。这是"她只能了结/接地自己此刻意识到的东西"（§5.5 §2 + WO-P4R12 项4 + 裁决 8）的结构性保证：注入集与她看到的内容同源，不可能不一致。

**三处消费**（`autonomous.py:197-212`）：
- `injected_set = set(injected_ids)` → `evaluate_message(injected_thought_ids=injected_set, injected_concern_ids=set(...), injected_thread_ids=set(...))`
- `apply_inner(decision.inner, source="wake", injected_ids=injected_set)`

**三层闸**（同一红线的三道防线）：
1. 解析层：`_sanitize_inner` / `_sanitize_assessment` / `_gated_int`（decide.py）
2. store 层：`thoughts.resolve_thought(..., injected_ids=)`（`thoughts.py:154-156`）
3. 回流层：`reflow._light_grounded_concerns` 对 **LIVE active 集**再校验（见 §3.4）

---

## §3 reflow 七 kind 逐支 — `mind/reflow.py`

### 3.1 `execute_and_reflow` 骨架（`reflow.py:143-262`）[事实]

签名：`async def execute_and_reflow(decision, run_id, counts, *, dispatch_fn=None, now=None) -> str`，返回 `'completed' | 'failed'`。

**不可移位的三步**（`:157-161`，无论后面发生什么）：
1. `lit = _light_grounded_concerns(decision, moment)`
2. `primary = lit[0] if lit else None`
3. `record_experience("wake_action", _action_summary(decision), related_concern_id=primary, now=moment)`

末尾恒有（`:261`）：`record_experience("action_result", result, related_concern_id=primary, now=moment)`

顶注逐字（`:3-8`）：*Every executed decision FORCES two experiences into the buffer* … *Failure and emptiness are written too: 没有结果也是结果。*

**rest 与非 rest 的调节场分叉**（`:163-168`）：
- `rest` → `apply_regulation_cause("rested")`（load −0.10）
- 其余六种 → `apply_regulation_cause("action_taken")`（load +0.06）—— **contemplate / record_note / tend_inner 也计 action_taken**（向内也花一拍，`:213` 明写）

**关切发光未追**（`:257-259`）：
```python
if lit and decision.kind in ("rest", "record_note"):
    mind_store.apply_regulation_cause("concern_lit_unfollowed")   # hunger +0.05
```
—— 只有这两种 kind 算"点亮了却没追"。`contemplate` **不在**其中。[事实 / 见 DA-05]

### 3.2 counts 口径：哪些计 action [事实]

`counts` 由 wake 初始化为 `{"action": 0, "external_read": 0, "notification": 0}`（`autonomous.py:187`）。

| kind | `counts["action"]` | `counts["external_read"]` | `counts["notification"]` |
|---|---|---|---|
| rest | — | — | — |
| record_note | — | — | — |
| tend_inner | — | — | — |
| contemplate | — | — | — |
| explore（有 url） | **+1**（`:191`） | **+1**（`:192`） | — |
| explore（无 url） | — | — | — |
| initiate_chat | **+1**（`:224`，**无论成败**） | — | — |
| queue_notification | **+1**（`:244`，**无论成败**） | — | 仅 `queued` 为真时 +1（`:247`） |

**关键不对称**：`counts["action"]` 在 dispatch **之后无条件** +1（被脑干拦下也算），但 `counts["notification"]` 只在真入队时 +1。语义：行动预算记的是"她试了一次外部动作"，通知配额记的是"确实留了一条话"。

**counts 的下游**：`store.autonomy_finish_run(..., action_count=, external_read_count=, notification_count=)`（`autonomous.py:230-233`），而 `HOURLY_ACTION_CAP` 的执行读的是 `store.autonomy_actions_last_hour()`（`autonomous.py:127`）。

**R-CA-1 风险 B 的根因就在这张表**（`autonomous.py:256-261` 逐字）：rest / contemplate / record_note / tend_inner 都不计 `counts["action"]`，所以一连串 rest 决定可以无限期每 5 秒烧一次 LLM 而永远撞不上 cap。

### 3.3 七支执行体 + 副作用清单 + result 文案逐字 [事实]

**① rest**（`:164-166`）
- 副作用：`apply_regulation_cause("rested")`
- result：`"rest:这一拍我休息,load 泄压"`
- 无 kernel dispatch，无 counts

**② record_note**（`:170-174`）
- 副作用：`memory_store.append_autonomy_note(run_id, "reflection", content.strip(), source_type="internal")`
- result：`f"record_note 完成:写下了笔记 #{note_id}"`
- **无 try/except** —— append 抛异常会冒泡到 wake 的 `except Exception` 并把整拍记 failed [事实]

**③ tend_inner**（`:176-181` + `_tend_inner` `:127-140`）三形式，**按字段优先级判定**：
| 判定 | 动作 | form | outcome 文案 |
|---|---|---|---|
| `thread_id is not None` | `append_thread_progress(thread_id, content)` | `thread_progress` | `f"给叙事线 #{tid} 写了一句进展"` |
| `elif concern_id is not None` | `tend_concern_description(concern_id, content)` | `concern_description` | `f"调整了关切 #{cid} 的描述"` |
| `else` | `append_autonomy_note(run_id,"reflection",content,source_type="internal")` | `note_to_self` | `f"给自己留了一条 note(#{note_id})"` |
- 恒发 `log_event("mind_tend_inner", run_id=, form=)`
- result：`f"tend_inner 完成:{outcome}"`；`ValueError` → `status="failed"`，result `f"tend_inner 失败:{exc}"`
- **不经 kernel**（`:128` 逐字：内部副作用,不经 kernel,全部留痕 events.jsonl）

**④ explore**（`:183-202`）
- 无 url → `status="failed"`；result `"explore 扑空:想去看看,但没有起点 url,什么都没读到"`。**零 counts、零 dispatch** —— `:185` 注释逐字：*旧 bug 修复:没有 url 的探索不许静默 completed*
- 有 url → `await dispatch_fn("research_browser.read_text", {"url": decision.url}, run_id)`；`counts["action"] += 1`；`counts["external_read"] += 1`
  - `observation.success` → 从 `observation.data`（须为 dict）取 `text`；`apply_regulation_cause("explore_completed")`（hunger −0.40）；result `f"explore 完成:读了 {url}(约 {len(text)} 字),探索饥饿泄压"`
  - 否则 → `status="failed"`；result `f"explore 失败:{observation.error or '没有读到内容'}"`
- **hunger 只在 success 分支泄压** —— 失败的 explore 不伪造满足

**⑤ contemplate**（`:204-214`）
- **执行体为空**：唯一动作是 `result = "contemplate 完成:向内的一拍,没有对外发声"`
- 零 dispatch、零 counts、零新通道
- WO-P4R-09 路由修正（`:205-213` 逐字）：在这条分支存在之前，contemplate 落进 `queue_notification` 的 else 分支**误向 Kevin 发了话**（决策记录 §1.6：107/107 进入动作尝试,18 条成了真通知）。**注释明确定性：a routing fix, not a new capability**
- inner 的落地在 wake 编排层 `apply_inner`（`autonomous.py:210-212`），**在本函数返回之后** —— 这里不重做任何向内的事

**⑥ initiate_chat**（`:216-236`）
- `await dispatch_fn("autonomy.initiate_chat", {"content": content.strip(), "run_id": run_id}, run_id)`；`counts["action"] += 1`
- `success and data.get("queued")` → result `"initiate_chat 完成:主动开了口,已交给投递;送达与否之后会回到你的经验里"`
  - WO-REWIRE-PROACTIVE ③（`:227-230` 逐字）：旧文案许诺"他一打开对话就会读到"，那是**结构性假回执**；排队 ≠ 送达。**新体不得回退这句文案**
- `success` 但未 queued → result `f"initiate_chat 被脑干拦下({data.get('reason')}):主动开口的份额还没回来"`（status 仍 completed）
- 否则 → `status="failed"`；result `f"initiate_chat 失败:{observation.error}"`

**⑦ queue_notification（else 兜底）**（`:238-255`）
- `await dispatch_fn("autonomy.queue_notification", {"summary": content.strip(), "run_id": run_id}, run_id)`；`counts["action"] += 1`
- `success and queued` → `counts["notification"] += 1`；result `"queue_notification 完成:留了话给 Kevin,等他回应"`
- `success` 未 queued → result `f"queue_notification 被脑干拦下({data.get('reason')}):今天对他说得够多了"` —— `:250-251` 逐字：*The kernel throttle held — that IS the governance cap working, and she experiences it as a result, not a crash (红线 #5)*
- 否则 → failed；result `f"queue_notification 失败:{observation.error}"`

**⚠️ 兜底分支是 `else` 而非 `elif kind == "queue_notification"`** —— 任何将来新增而未在 reflow 加分支的 kind 都会**默默变成一条发给 Kevin 的通知**。这正是 contemplate 曾经踩过的坑（WO-P4R-09）。[事实 / 见 DA-01]

### 3.4 经验写入形态：wake_action / action_result 的 content 模板 [事实]

`record_experience`（`reflow.py:60-75`）—— **Phase-2 唯一写入点**：
```python
experience_id = mind_store.record_experience(source, content, salience=, related_concern_id=, now=)
mind_store.apply_regulation_cause("experience_recorded", now=now)   # load +0.04
return experience_id
```
**每条经验入缓冲都是代谢压力** —— 所以一拍必然 load 净 +0.08（两条经验）+0.06（action_taken，非 rest）= +0.14，或 rest 拍 +0.08 −0.10 = −0.02。[推断，由 CAUSES 表算出]

**`wake_action` 的 content 模板** = `_action_summary(decision)`（`:114-124`），空格连接、条件拼装：
```
[{kind}] [(由 {original_kind} 降级:{demote_why})] [{url}] [{clip(content,120)}] [理由:{clip(reason,120)}]
```
- 首段恒为 `f"[{decision.kind}]"`
- `CLIP_CHARS = 120`（`:40`）；`_clip` 先 `.strip()` 再裁（`:55-57`）—— 与 snapshot 的 `_clip` **不同实现**（那个不 strip）

**`action_result` 的 content** = 上表七支各自的 `result` 字符串，逐字。

两条经验的 `related_concern_id` 都是 `primary = lit[0] if lit else None`（`:158`）—— **首个成功点亮的关切**，按 `grounded_concern_ids` 的去重保序（`dict.fromkeys`）。

`silence` 经验（cheap_tick）：`salience=SILENCE_SALIENCE = 0.6`（`:44`）；其余 record_experience 调用用默认 `salience=0.5`。

### 3.5 `_light_grounded_concerns` 二次活体校验语义（`reflow.py:92-111`）[事实]

```python
active_ids = {c["id"] for c in mind_store.list_concerns("active")}
for concern_id in dict.fromkeys(decision.grounded_concern_ids):   # de-dup, keep order
    if concern_id not in active_ids:
        log_event("grounding_concern_out_of_snapshot", concern_id=, where="reflow"); continue
    try: mind_store.light_concern(concern_id, now=now); lit.append(concern_id)
    except ValueError as exc: log_event("mind_light_skipped", concern_id=, error=str(exc))
```

**语义三层**：
1. **去重保序**：`dict.fromkeys` —— 同一 id 只点亮一次，顺序保留（`primary` 因此确定性）
2. **LIVE 二次闸**（WO-P4R12 项4，`:96-99` 逐字）：比照 `apply_inner → resolve_thought` 的两段式。快照闸是"她当时看到的"，这里是"**现在**还活着的"。覆盖三种漏网：快照后关切被 release / 转 dormant、决策被重放、id 混过 sanitize 闸
3. **不杀拍**：`ValueError` 只记 `mind_light_skipped` 并跳过 —— *A stale/duplicate id from the model must not kill the beat*（`:93-94`）

**注意 `active_ids` 只含 `status='active'`** —— dimming / dormant 的关切**不会**被点亮，即使模型合法引用了它。[事实]

`light_concern` 的效果（`store.py:363`）：`weight += CONCERN_LIT_WEIGHT_DELTA = 0.05`（`store.py:44`）、更新 `last_lit_at`、`lit_count += 1`。

### 3.6 推演 / 回流切分边界与"推演零写入"断言测试的现状（CB-01 产物）[事实]

**切分边界（wake 内，`autonomous.py:188-213`）**：

| 阶段 | 代码位 | 写状态层? |
|---|---|---|
| 仲裁 | `:168-174`（yield / hourly_cap 早退） | 早退分支写 `set_autonomy_next_wake` |
| 记账 | `:180-186`（`_last_beat_started_at` / run_id / `_CURRENT_RUN_ID.set` / `autonomy_start_run`） | 写 |
| **感知期维护** | `:193` `moment = mind_snapshot.maintain()` | **写（仲裁器的活，一拍恰好一次）** |
| **推演** | `:194-204`（`_perceive(read(moment))` → `_autonomous_complete` → `evaluate_message`） | **零写** |
| 执行+回流 | `:205` `execute_and_reflow` | 写 |
| inner 落地 | `:210-212` `apply_inner` | 写 |
| 收尾 | `:226-236`（`autonomy_finish_run` / `set_autonomy_next_wake` / `bump_wakes_since`） | 写 |

**为什么 inner 在 execute 之后**（`:206-209` 逐字）：*so a malformed inner cannot affect the decision（工单 §4D guard）；the apply_inner function itself never raises, so failures here can't make the beat fail*。

**"推演零写入"断言测试现状**：`tests/test_cb_deliberation_zero_write.py`（132 行）已在树内，**测试已立，切分（步 4）未做**。

- `_logical_digest(path)`（`:31-51`）：全库逐表逐行 sha256，**表名与列名一并入摘要**；按 `sqlite_master` 表名排序、按全列排序取行 —— 刻意用逻辑摘要而非文件字节，因为 *SQLite 的页布局/journal 会无谓地抖*
- `seeded_db` fixture（`:54-91`）：隔离 tmp 库，播种一条 active 关切 + 一条 open 叙事线 + 一条经验 + **一条 open 念头（charge_hint=0.9）**，再跑一次 `assemble()`。注释点名念头是"决定性的一条"：步 0 之前 `_perceive` 里的 `assemble` 会给它再衰减一拍（`UPDATE thoughts SET charge=…`），那正是断言要抓的写
- `test_deliberation_writes_nothing`（`:94-124`）：`_perceive()` + `evaluate_message()` 之后全库摘要**逐字节不变**；断言前先 `assert messages and candidates, "推演的输入必须非空,否则这条断言测的是空气"`
- `test_maintenance_is_still_the_thing_that_writes`（`:127-132`）：**对照组** —— 同一状态上再跑 `assemble()`，摘要**必须变**。没有它，上面那条可能因播种不到位而假性通过

顶注逐字（`:16-19`）：*这条断言在步 0 之前必然失败 … 它失败这件事本身就是步 0 必要性的证据（C-A §7.3-3）。*

**结论**：切分的**守门员已就位**，但"取一份快照分发给 N 个分支并行推演"这件事本身（步 4）在 HEAD 上**未实现**。新体若要做并行推演，`read()` 的纯读性是唯一的前提，且必须由等价断言守住。[事实 + 建议]

---

## §4 调节场逐字 — `mind/regulation.py`

模块纪律（`regulation.py:3-4`）：**PURE module: no sqlite, no I/O, no clock reads**。`mind/store.py` 独占持久化。

### 4.1 四变量（`regulation.py:111-136`）[事实]

| 变量 | baseline | decay_kind | outlet_effects | outlet_doc（蓝图原文） |
|---|---|---|---|---|
| `coherence` | 0.7 | regress | `("force_inner_tending","flag_low_coherence")` | 低于 0.4:下次唤醒强制把预算优先给"内部整理";快照中标红 |
| `load` | 0.2 | regress | `("budget_multiplier","prefer_rest","trigger_early_integration")` | 高于 0.7:唤醒预算减半、倾向 rest;高于 0.9:触发提前整合 |
| `relational_tension` | 0.3 | regress | `("relationship_weight_bonus","unlock_proactive_contact")` | 高于 0.6:意义评估中关系类条目权重加成;解锁"主动联系"候选 |
| `exploration_hunger` | 0.0 | **accumulate** | `("exploration_weight_bonus",)` | 高于 0.6:探索类候选权重加成 |

建构规则（`regulation.py:7-8` 逐字）：*每个变量必须有 (a) 更新规则 (b) 衰减规则 (c) 对认知的因果出口。三者缺一就不许建 —— 没有因果出口的状态是装饰,宪法明令禁止。*

### 4.2 15 个 CAUSES 逐字表（`regulation.py:27-47`）[事实]

```python
CAUSES: dict[str, tuple[str, float]] = {
```
| # | cause | 变量 | delta | 已知调用点 |
|---|---|---|---|---|
| 1 | `integration_completed` | coherence | **+0.15** | `integrator.py:694`（仅当 `integrated_now` 非空，红线 #1） |
| 2 | `suspension_resolved` | coherence | **+0.10** | `integrator.py:819`（revise 解开一条 suspended 线） |
| 3 | `experience_backlog` | coherence | **−0.10** | `integrator.py:709`（`count_intake_pending() > 90`） |
| 4 | `suspension_overdue` | coherence | **−0.05** | `snapshot.py:200`（24h 闸内一次） |
| 5 | `narrative_conflict` | coherence | **−0.15** | `integrator.py:686`（叙事终拒） |
| 6 | `experience_recorded` | load | **+0.04** | `reflow.py:74`（每条经验） |
| 7 | `action_taken` | load | **+0.06** | `reflow.py:168`（每次非 rest） |
| 8 | `integration_digested` | load | **−0.30** | `integrator.py:702`（**仅 `absorbs > 0`**） |
| 9 | `rested` | load | **−0.10** | `reflow.py:165` |
| 10 | `owner_silence_anomaly` | relational_tension | **+0.15** | `reflow.py:381`（cheap_tick） |
| 11 | `contact_unanswered` | relational_tension | **+0.20** | `reflow.py:349`（cheap_tick，>24h） |
| 12 | `normal_interaction` | relational_tension | **−0.10** | `reflow.py:321`（每轮对话） |
| 13 | `contact_answered` | relational_tension | **−0.15** | `reflow.py:289`（`_resolve_contact_answered` 唯一写入点） |
| 14 | `concern_lit_unfollowed` | exploration_hunger | **+0.05** | `reflow.py:259`（lit 且 kind ∈ {rest, record_note}） |
| 15 | `explore_completed` | exploration_hunger | **−0.40** | `reflow.py:198`（仅 explore success） |

`store.apply_regulation_cause()` **从这张表查 delta**，"so a call site cannot invent its own magnitude"（`regulation.py:24-25`）。**这是移植时最不可妥协的一张表**：任何调用点自带幅度就破坏了单一数值源纪律。

### 4.3 衰减 / 回归基线算法（`regulation.py:53-58, 143-177`）[事实]

**速率表**：
```python
DECAY_RATE_PER_HOUR = {
    "coherence": 0.01,            # 缓慢回归 —— 半衰期约 69 小时
    "load": 0.03,
    "relational_tension": 0.02,
    "exploration_hunger": 0.008,  # 累积:0→0.6 约 3 天
}
```

`decay_value(name, value, hours_elapsed)`（`:143-153`）—— **懒衰减，读时从 `updated_at` 计算**：
```python
if hours_elapsed <= 0: return clamp01(value)
rate = DECAY_RATE_PER_HOUR[name]
if var.decay_kind == "regress":
    return clamp01(var.baseline + (value - var.baseline) * math.exp(-rate * hours_elapsed))
return clamp01(value + rate * hours_elapsed)     # accumulate: 只升不降
```
`clamp01`（`:139-140`）：`min(1.0, max(0.0, value))`。`apply_delta_value`（`:156-158`）：`clamp01(value + delta)`。

**`decay_charge` 是另一个函数，不是同一个**（`:161-177`）：念头 charge 线性按拍衰减 `max(0.0, charge - THOUGHT_CHARGE_DECAY * beats)`（`THOUGHT_CHARGE_DECAY = 0.04`）。`beats <= 0` → **no-op 而非返还** —— 逐字：*attention can only be paid forward, never refunded*。注释明写这两者"signatures and invariants are genuinely different, so this is its own function"。**新体不得合并这两个衰减**。

### 4.4 `cognitive_effects` 阈值与效果（`regulation.py:61-69, 180-204`）[事实]

**阈值表**：
```python
THRESHOLDS = {
    "coherence_low": 0.4,
    "load_high": 0.7,
    "load_high_integration": 0.9,   # P4-01: 与 load_high 分离
    "tension_high": 0.6,
    "hunger_high": 0.6,
}
RELATIONSHIP_WEIGHT_BONUS = 0.2
EXPLORATION_WEIGHT_BONUS  = 0.2
LOAD_BUDGET_MULTIPLIER    = 0.5     # 高负荷时唤醒预算减半
```

**判定（注意比较符号，逐字）**：
```python
low_coherence         = coherence < THRESHOLDS["coherence_low"]          # 严格小于
high_load             = load      > THRESHOLDS["load_high"]              # 严格大于
high_load_integration = load      > THRESHOLDS["load_high_integration"]
high_tension          = tension   > THRESHOLDS["tension_high"]
high_hunger           = hunger    > THRESHOLDS["hunger_high"]
```

**八个效果键**：
| key | 值 | 触发值 | 消费方 |
|---|---|---|---|
| `force_inner_tending` | `low_coherence` | coherence **< 0.4** | `decide.build_candidates:157` → allowed = {rest, tend_inner, contemplate} + tend_inner 权重 +0.3 |
| `flag_low_coherence` | `low_coherence` | 同上 | `snapshot.read:355` → `snap["coherence_low"]`（标红） |
| `budget_multiplier` | `0.5 if high_load else 1.0` | load **> 0.7** | `snapshot._environment:158` → `预算.预算系数`（**呈现，未见执行点**）[事实/风险 DA-06] |
| `prefer_rest` | `high_load` | load **> 0.7** | `decide.build_candidates:162` → allowed 同上 + rest 权重 +0.2 + 棘轮例外 |
| `trigger_early_integration` | `high_load_integration` | load **> 0.9** | `integrator.should_integrate:140` → `"early"` |
| `relationship_weight_bonus` | `0.2 if high_tension else 0.0` | tension **> 0.6** | `decide:154-155` → queue_notification / initiate_chat 权重 |
| `unlock_proactive_contact` | `high_tension` | 同上 | `decide:188-189, 217` → contact_note 加成文案 |
| `exploration_weight_bonus` | `0.2 if high_hunger else 0.0` | hunger **> 0.6** | `decide:153` → explore 权重 |

**P4-01 分离的意义**（`regulation.py:64-65` 逐字）：*early-integration trigger isolated above the shared high-load band; prefer_rest / budget_multiplier stay on load_high=0.7*。所以 load ∈ (0.7, 0.9] 时她**只被推向休息，不触发提前整合**；> 0.9 才两者兼有。

### 4.5 单写者纪律 [事实]

- `apply_regulation_cause` 是**唯一**的 delta 写入点（`store.py:249`），delta 只从 `CAUSES` 查
- `regulation.py` 本身零 I/O，是纯计算 + REGISTRY
- `contact_answered` 有额外的单写者约束：`reflow._resolve_contact_answered`（`reflow.py:284-291`）是**唯一写入点**（audit CHAT-01 逐字）。两条上游 —— `conversation_turn_reflow`（via=`chat_turn`/`reply_to`）与 `notifications_read_reflow`（via=`mark_read`）—— 都经它。**幂等**：无未决呼唤则 no-op 返回 False
- `mind/focus.py` 明文**不发任何 `apply_regulation_cause`**（`focus.py:15-18` 逐字："本模块不 import 它们中的任何一个,也不发任何 apply_regulation_cause —— 一次深挖不该动她的调节场"）

### 4.6 `registry_problems()` —— 建构规则的可执行形态（`regulation.py:219-266`）[事实]

对每个变量检查：baseline ∈ [0,1]；decay_kind 合法；有 decay rate 且 > 0；accumulate 变量必须有显式泄压因；有升因；有降因；有 outlet_effects；每个声明的 outlet key 确实由 `cognitive_effects` 产出。

**功能性证明**（`:247-258`）：把变量推到 0.0 与 1.0 两个极值，其**声明的效果**必须相对 neutral 至少动一个，否则报 `"outlet never fires (因果出口不通)"`。

反向检查（`:259-265`）：`effect_keys - claimed` → `"effect {key!r} claimed by no variable"`；每条 cause 的目标变量必须存在、delta 非零。

**空列表 == 注册表遵守蓝图。** 新体应把这个函数一并移植 —— 它是"没有因果出口的状态是装饰"这条宪法的可执行判据。[建议]

---

## §5 学习环 L1–L5

### L1 · `experience_class.classify` 规则逐字（`mind/experience_class.py`）[事实]

**唯一判据**（`:3` 逐字）：**这条记录里有没有外部世界注入的新信息?**

常量（`:32-51`）：
```python
WORKING = "working"; ARCHIVE = "archive"; CLASSES = (WORKING, ARCHIVE)
WORKING_SOURCES       = frozenset({"conversation", "environment"})
LENGTH_GATED_SOURCES  = frozenset({"action_result"})
ACTION_RESULT_MIN_LENGTH = 80
RULE_VERSION = 1
```

`classify(source, content)`（`:54-68`）—— **三行，纯函数**：
```python
if source in WORKING_SOURCES: return WORKING
if source in LENGTH_GATED_SOURCES and len(content or "") > ACTION_RESULT_MIN_LENGTH: return WORKING
return ARCHIVE
```
- `content=None` 按空串处理（防御性；真实 schema NOT NULL）
- 长度按**字符**数（`:62`），**严格大于** 80
- 阈值依据（`:43-46` 逐字）：活体 1573 条 action_result 中 97% ≤80 字符、均长 29 —— "ok"/"done"/"已发送" 一类的记账模板，零信息；超出的 43 条含实际返回内容。**阈值卡在实测分布的断点上,不是拍脑袋的整数**

**分流表**（`:5-13` 逐字）：
| source | 判定 | 依据 |
|---|---|---|
| `conversation` | 原料 | 与 Kevin 的交互,最高价值 |
| `environment` | 原料 | 关于 Kevin 生活的唯一来源(W1/W2 分期作废) |
| `action_result` >80 字符 | 原料 | 例外通道:含实际返回内容 |
| `action_result` ≤80 字符 | 档案 | "ok/done" 级记账,零信息 |
| `wake_action` | 档案 | **Kevin 定案 2:她的决策理由 = 思考轨迹,非外部输入** |
| `thought_lapse` / `silence` | 档案 | 内部状态记录 |
| `system` / `owner_event` | 档案 | 兜底:判据只承认上表列出的原料来源 |

**三条结构性约束**（`:15-23`）：① 纯函数（不读时钟/库/任何外部状态）→ "回填结果 == 重新分类结果" 可单测证明；② **不改 `experiences` 表**，分类落影子表 `experience_class`；③ 每行带 `RULE_VERSION`，判据升级可按版本重算。

**档案不是垃圾桶**（`:25` 逐字）：档案层永久保存、可检索,只是不进消化预算。

写入侧：`record_class_in_tx`（`:73-97`）必须在调用方已开的事务内（经验与分类同生共死，无中间态）；`INSERT OR IGNORE` —— 回填与实时写入相遇时先到者胜，**且两者答案相同因为 classify 是纯函数**，所以忽略冲突安全。
回填：`backfill`（`:105-149`）可重入（只取 `experience_class` 里没有的 id）、批量 `BACKFILL_BATCH = 500`、**不 COMMIT**（不隐式开关事务）。

### L2 · integrator（`mind/integrator.py`）[事实]

**触发闸 `should_integrate`（`:119-143`）**：
```python
pending = mind_store.count_intake_pending()
if pending == 0: return False, "no_pending"
state = mind_store.get_integration_state()
if state["wakes_since"] >= INTEGRATION_EVERY_WAKES: return True, "scheduled"
values = mind_store.get_regulation(now=now)
if regulation.cognitive_effects(values).get("trigger_early_integration"): return True, "early"
return False, "not_yet"
```
- `INTEGRATION_EVERY_WAKES = 24`（`:45`）≈ 60 分钟节律下每日一次
- `trigger_early_integration` 阈值以 `THRESHOLDS['load_high_integration']` 为准 = **0.9**；`:13-14` 逐字标注："此处曾误写 0.7, 2026-08-13 核查更正"
- **`pending > 0` 前置不可谈判**（`:16-19` 逐字）：空整合会为零工作发 `integration_completed`（+0.15 coherence），违反红线 #1
- **WO-L2 改口径**（`:126-130` 逐字）：闸读的是 **intake** 口径，与 `run_integration` 取料同口径。若仍读旧的 `count_pending_experiences`，一个只有感知流入的夜晚会被判成 `no_pending` 而永不整合 —— "那正是本工单要拆掉的门换了个位置继续关着"
- **`load early` 与节律是 OR，不是 AND**；且 early 路径**不查 wakes_since**

**容量 K**（`:45-59`）：
```python
INTEGRATION_CAPACITY_K = 30
BACKLOG_PRESSURE_THRESHOLD = 3 * INTEGRATION_CAPACITY_K   # = 90
```
K=30 的**依据换了**（`:46-56` 逐字，2026-08-11 实测账）：水位线之上起步 0 条（1180 条历史积压永久不进队列，由 L2 检索伺服）→ K 面对的是纯流入；近期流入 ≈3 条/天 → K=30 一晚清空还剩 27 余量;历史高活跃日 ≈40 条/天(1178/55 天峰值口径),K=30 一晚吃 30、次日补上，不形成结构性积压。**目标是"不积压"，不是"每晚都清空"**。重标定触发条件：水位线之上未消化数持续 > 3K → 上调 K 或加密周期。

**取料查询（水位线 ∩ 未消化 ∩ 原料池）** —— `mind_store.intake_pending(limit=K, by_salience=True)`（`store.py:1384-1420`）：
```sql
SELECT e.* FROM experiences AS e
JOIN experience_class AS ec ON ec.experience_id = e.id
WHERE ec.class = 'working' AND e.integrated = 0 AND e.id > ?     -- _intake_clause(), store.py:1380-1381
ORDER BY e.salience DESC, e.id ASC LIMIT ?
```
水位线：`L2_INTAKE_WATERMARK_KEY = "l2_intake_watermark_id"`（`store.py:1357`），值由迁移 `_V12` 在上线那一刻写死为当时的 `MAX(experiences.id)`（`store.py:1371-1377`）；**缺键 → 0**（空库语义：没有历史积压需要豁免）。

与被取代的 `pending_experiences` 相比两处实质变化（`store.py:1389-1396` 逐字）：① `source <> 'environment'` 的硬排除**没有了** —— "1178 条关于 Kevin 的感知被一行 SQL 挡在门外 55 天"；② 多了水位线 —— "补消化 1178 条是伪需求"。

`count_intake_pending`（`store.py:1423-1443`）同口径 COUNT。

**prompt sha256**：
- `INTEGRATION_SYSTEM_PROMPT` —— `mind/integrator.py:148-190`，chars=**1862**，sha256=**`b130d6473ff9c2e8983f06cced5ca97ae837644886f5db2f6f38ddf31132193c`**
- 第二条 system（身份守卫，`integrator.py:277-278`）是 f-string：`f"你的内核身份: {cfg.identity.name}; 你的伴侣: {cfg.relationship.partner}. " "整合输出绝不能与之矛盾。"`。**fixture 口径** sha256=`ce69ae2ae060645af4ee593f0e8d57d04da077675227bb81442ac07a49c0ae2a`（chars=40）。活体值取决于 owner 域 TOML，副本内不可得。[事实 + 缺件标注]
- 重试轮的 user 消息 `_narrative_retry_feedback(old_content)`（`:750-759`）含变长 `old_content`，**不可哈希**；其固定骨架逐字见下

**payload 结构**（`_build_payload`，`:241-270`）六节：`pending_experiences`（id/ts/source/content/salience/related_concern_id）、`concerns`（经 `_status_first` 排序）、`narrative_threads`、`current_narrative`（`current_cognitive_narrative()` 的 content）、`open_thoughts`、`thoughts_to_clear`。

`_status_first`（`:228-238`）：`sorted(key=(_STATUS_RANK[status], -weight, id))`，`_STATUS_RANK = {"active":0,"dimming":1,"dormant":2}`（`:193`）。**只重排，不丢不藏**，且**只作用于信封** —— `list_concerns` 对其他读者（快照/console）保持 weight DESC。理由（`:231-233` 逐字）：一条刚铸出的低权重地板关切(active)必须浮到陈旧高权重 dormant 行之上，否则地板铸出的目标整合的 LLM 永远看不见。

**`narrative_class` 语义**（`_classify_integration`，`:513-534`）—— **仅从 ACCEPTED 操作计数派生，与关切状态无关**：
```
absorption      — accepted experience ops > 0
reflection      — exp ops = 0 但 concern/thought ops > 0
narrative_only  — 所有 accepted ops = 0（strict-empty：§0 缺陷类）
```
用逐 op 计数器（absorbs/reinterprets/revises/suspends），**不用 `experiences_integrated`** —— 后者由 `mark_experiences_integrated` 稍后设置，此处读它是过早的（`:524-526`）。座位在**念头清算之后**（`:646-651`），好让 class 看到含念头 op 的最终计数，thought-only 的 reflection 不被误读成 narrative_only（WO-P4R-06 §2）。

**store 层物理闸**（`add_narrative_version`，`store.py:516-571`）—— **不是 integrator 的约定，是物理层**：
- strict-empty（`accepted_ops <= 0`）→ **INSERT 被跳过**，行根本不进表，连全量读 `current_narrative` 也无法浮出（`store.py:531-534` 逐字）
- absorb-lie（`narrative_class == 'absorption'` 且 `exp_ops <= 0`）→ 拒绝
- 两条都是**纯计数**；`change_summary` 自由文本**从不被检查**（no open-ended semantics）
- `accepted_ops is None` = TRUSTED caller（owner_edit / legacy backfill / test seed）**旁路闸门** —— owner 写入缝
- 返回 `None` 表示被拒；`summary["narrative_rewritten"]` 反映**实际持久化**（`integrator.py:746`）

**消化后写集**（`run_integration`，`:537-718`，七步）：
1. **取料**：`intake_pending(limit=K, by_salience=True)`；空 → `log_event("integration_skipped", reason="no_pending")` 并返回空 summary
2. **LLM**：一次 `AUTONOMOUS_COGNITION` 调用，`temperature=0.2, max_tokens=4096, origin=ORIGIN_AUTONOMOUS_INTEGRATE`（`:505-510`）
3. **四操作**（`:595-608`）：`eid not in pending_ids` → rejected `not_in_window`；`_apply_experience_op` 成功则 `integrated_now.append(eid)` 且 `summary[f"{op}s"] += 1`
   - `absorb`（`:773-784`）：**必须有 concern_id**，否则 rejected `absorb_missing_concern_id`；动作 = `light_concern(cid)`（更新 last_lit_at + lit_count，兼作审计锚）
   - `reinterpret`（`:786-805`）：有 tid → `append_thread_progress(tid, note or "(reinterpreted)")`；elif cid → 读旧 description，`merged = (old + "\n" + note).strip()[:1024]`，`tend_concern_description`；否则 rejected `reinterpret: no target`
   - `revise`（`:807-823`）：**必须有 thread_id**；先判 `was_suspended`，再 `update_thread(tid, status="resolved", resolution=note or "(revised)")`；`was_suspended` → `apply_regulation_cause("suspension_resolved")`
   - `suspend`（`:825-839`）：`create_thread(kind=new_thread_kind or "suspended_tension", content=note or "(suspended)")`；若 `kind != "open"` 再 `update_thread(new_tid, status="suspended")`
4. **取舍**（`:610-629`）：`release_concern(cid, reason)`（**只有 dormant 可 release，物理闸强制**，见 prompt `:175`）；`create_concern(..., origin=_concern_origin(nc, conversation_ids))`
5. **叙事重写**（`:646-686`）：见下
6. **念头清算**（`:631-644`）：`settle` → `settle_thought(tid, integration_id=)`（仅 resolved→absorbed，`thoughts.py:174-202`，**红线 #3：仅整合路径可写 absorbed**）；`archive` → `archive_thought(tid)`（resolved/abandoned→archived）
7. **收尾**（`:688-717`）：见下

**`_concern_origin` 三来源判定（§3.5，`:196-225`）**：
```
emergent        默认（旧代码称 'grown'，同一件事的旧名，历史行不重贴标签）
owner_directed  Kevin 明确表达的关注点（定案 3），权重最高
derived         层 2 深挖派生 —— L4 的事，本层不产出
```
**识别是 LLM 判断，但能不能落成 owner_directed 是确定性的**（`:206-210` 逐字）：
- `not nc.get("owner_directed")` → `emergent`
- 给了 `source_experience_id`：在 `conversation_ids`（本轮窗口内 source=="conversation" 的 id 集）里 → `owner_directed`；否则降级 + `log_event("integration_owner_directed_downgraded", reason="source_not_conversation", ...)`
- 未给 id：窗口里有对话 → `owner_directed`；否则降级 + `reason="no_conversation_in_window"`
- **判不成就降级为 emergent，不丢关切**

解析层：`owner_directed` **只认真正的 `True`**（`item.get("owner_directed") is True`，`:360`）—— 字符串 "true"/1 一律不算（`:350-353` 逐字："这是最高权重的来源, 宁可漏认不可错认"）。

**叙事重写 + 有界重试一次（P5-06，`:652-686`）**：
- 连续性基准是 `current_cognitive_narrative()`（**跳过 narrative_only**，`:649-651`：真版本永不被要求与 strict-empty 虚构连续）
- `_gate_and_persist_narrative`（`:721-747`）：连续性 ∧ 忠实性通过才写；**gate-pass 总是终结重试循环**（store 可能仍拒 strict-empty，那是计数判定，重写文字改不了它）
- 首拒 → 重试一次：`messages + [assistant(原文), user(_narrative_retry_feedback(old_content))]`，只要 narrative，**已生效的 ops 绝不重放（非幂等）**（`:657-661` 逐字）
- 重试成功 → `summary["narrative_retried"] = True` + `log_event("integration_narrative_retry_accepted")`
- 终拒 → `log_event("integration_narrative_rejected", reason="continuity_or_fidelity", change_summary=…[:200])` + rejected 记录 + **`apply_regulation_cause("narrative_conflict")`**（P5-06：coherence 由此获得第一条真实下行出口，此前装饰性钉死 1.0）

`_narrative_continuity_ok`（`:102-116`）：`old` 为 None 或空 → True（首版）；否则从 old 取全部 4 字窗口作 anchors，`new_content + "\n" + new_summary` 中命中任一非空白 anchor 即通过。**backstop，不是完美过滤**（LLM 也被告知了规则）。

`_violates_fidelity`（`:85-99`）：`_IDENTITY_DENIALS` 命中 → True；`_SEPARATION_CUES` 命中 → True；`_REL_MARKERS` 命中且正则 `[A-Z][A-Za-z]+` 抽出的名字集减去 `_NAME_STOPWORDS` 与 `cfg.relationship.partner` 后非空 → True。P5-06 收窄理由（`:74-76` 逐字）："不再/结束了/和别人/不爱"是日常高频词组，"不再被动等待"这种正常叙事都会撞线，而门控误伤 = 静默阻断身份回路。**兜底红线宁窄勿宽; LLM 纪律仍是第一道**。

**消化后写集（第 7 步，`:688-717`）**：
```python
if integrated_now:
    mark_experiences_integrated(integrated_now, integration_id=, now=)
    summary["experiences_integrated"] = len(integrated_now)
    apply_regulation_cause("integration_completed")          # 红线 #1: 只在真有活时
    if summary["absorbs"] > 0:
        apply_regulation_cause("integration_digested")       # WO-P4R12 项1
if count_intake_pending() > BACKLOG_PRESSURE_THRESHOLD:      # > 90
    apply_regulation_cause("experience_backlog")
accepted_any = bool(integrated_now) or any(summary[k] for k in (
    "concerns_released","concerns_created","thoughts_settled","thoughts_archived")) or summary["narrative_rewritten"]
if accepted_any:
    reset_integration_cycle(now=now)
_emit_integration_summary(summary, envelope, parsed_raw, now)
```
两条关键纪律：
- **`integration_digested` 只由 absorb 触发**（`:695-700` 逐字）：load 是 ABSORBING 状态的桩，reinterpret/revise/suspend 标记经验已整合但**什么都没吸收** —— 在它们上泄压 = "声称消化却没消化(与 C2 confabulation 同质)"
- **零操作周期不清零 wake 计数**（`:710-711` 逐字）：否则 absorb 目标真空期 scheduled 路径被永久饿死（06-21→30 的 **212 次空转**即此陷阱），空转本身也不算一次整合

`experience_backlog` 换 intake 口径的理由（`:705-707` 逐字）：拿水位线之下的 1180 条历史感知喂它"会造出一个她永远无法通过消化解除的假压力"。

**遥测（observe-only，`:383-500`）**：`EMIT_INTEGRATION_TELEMETRY = True`（kill switch）。关掉 → legacy 发射，**认知逐字节相同**（cardinal rule §0：telemetry records, it does not gate）。`_integration_shape` 保证按构造 `proposed == accepted + rejected`；`_classify_rejection` 把 reason 里可能嵌入的异常文本折成通用 `error` 码 —— **绝不让自由文本进遥测**（shape-not-content，§3.5）；`virtual_ts` 与认知写用同一个 now，事件自身的 `ts` 保持真实。

### L3 · `relevance.retrieve_for_concern` 三轴打分纯函数逐字（`mind/relevance.py`）[事实]

工单称"三轴"；源码顶注（`:9-15`）声明的是**四个召回轴**：关键词 / 实体 / 时间 / **来源（不硬过滤）**。打分只涉前二（时间是硬过滤，来源零参与）。

**权重常量（`:38-56`）**：
```python
_TITLE_WEIGHT     = 1.5      # 标题是关切的本体,描述是注脚
_DESC_WEIGHT      = 1.0
_ASCII_TERM_SCORE = 2.0      # 一个完整英文词命中 == 一段两字中文短语命中
_ENTITY_SCORE     = 1.0      # 实体轴命中的加分(硬过滤下是常数,只为让分数自洽)
_ASCII_MIN_LEN    = 2
_ASCII_STOPWORDS  = frozenset({"the","and","for","with","that","this","you","are","was","were",
                               "have","has","had","not","but","from","什么","怎么"})
_CJK_FUNCTION_CHARS = frozenset("的了是在我他她它和就都而及与也很有个上下不这那你们着过被把从对")
```

**提取规则（`:135-171` 长注释 + `:191-282`）**：
1. NFKC 归一 + casefold（全角"ＡＢＣ"与"abc"折成同一形态）
2. 按字符类切段：CJK 一段、ASCII 字母数字一段，**其余（空白/标点/emoji/`%`/`_`）一律分隔符** → **通配符字符从不进入词项**（第一道保证；第二道是 LIKE ESCAPE）
3. ASCII 段：整段为一词项，`len >= 2` 且不在停用词表
4. CJK 段：切**相邻 bigram**；长度 1 的段丢弃；**两个字都是功能字**的 bigram 丢弃（"的了"/"是在"；只有一个功能字的保留）
5. `(kind, text)` 去重（`:193`）：标题里重复的词只算一次

`_char_kind`（`:257-273`）用 Unicode 区段判 CJK（`4E00-9FFF` / `3400-4DBF` / `F900-FAFF` / `3040-30FF` 日文假名），**不用 `unicodedata` 类别名** —— 汉字与假名同属 `Lo`。

**打分口径（`_score_content`，`:287-322`）—— 逐字**：
- ASCII 词命中（子串，大小写不敏感）→ `_ASCII_TERM_SCORE * run.weight`
- CJK 段：命中的 bigram 按**相邻链**聚合，长度 c 的链得 **`2c - 1`** 分（孤立 1，两连 3，三连 5），再 `* run.weight`。超线性是有意的：链越长说明原文出现的是原短语本身而非跨词边界巧合
- `match_reasons` 是**从命中链还原的原文片段**（链 i..j → `run.text[i:j+2]`），格式 `f"keyword:{片段}@{field}"` / `f"entity:subject_user_id={id}"` —— **不是词项 id，不是 "matched"**（§3.7 血缘的前置）
- 最终 `relevance_score = round(score, 6)`（`:125`）

**上限与排序**：`limit` 默认 20，**必须 >= 0** 否则 `ValueError`（`:101-102`）；排序 `(-relevance_score, -id)`（`:129`）—— 同分按 id 倒序，新的在前，两次调用必然同序（**确定性**）。

**检索域 = 全部 experiences**（`:79-81`）：working 与 archive、`integrated` 0 与 1 都在内。**这是本函数存在的理由** —— L1 的 `working_set_pending` 只看未消化原料，L2 要的是"她所有的经验"。

**实体轴是硬过滤**（`:73-76`）：给了 `subject_user_id` 就 JOIN `memory_scopes`（`table_name='experiences' AND row_id=e.id`）—— "某人的关切不该召回另一个人的原料"。`memory_scopes` 主键 `(table_name,row_id)` 保证至多配一行，不放大结果。

**预筛与打分一致**（`_prefilter_terms`，`:217-231`）：每个 bigram + 每个 ASCII 词，去重保序；预筛**比打分宽**（多算几行无所谓），**绝不比打分窄**（那是丢召回）。定稿在 `_score_content`：`if query and not reasons: continue`（`:120-121`）。

**无可提取词项时的行为（`:94-99` 逐字）**：给了 `subject_user_id` 就退化为"这个人的全部经验"；否则返回 `[]`。**不会**退化成"返回全库最近 N 条" —— 那会把"我没读懂你的问题"伪装成"这些都相关"。

**零 schema / 只读**（`:16-22`）：不新增表/迁移/索引（千条量级全扫 + 内存打分足够）；模块自身零 INSERT/UPDATE/DELETE。

**已知盲区（诚实清单，`:158-171` 逐字）**：单字关切提不出 bigram；跨词边界假命中（"外国人"的"国人"命中"中国人民"，只得 1 分被压后）；同义/近义为零；简繁不通；语序敏感（有意）；英文靠整词无词干还原。SQL 侧窄口（`:338-341`）：LIKE 比对的是**未归一**的 content，全角英文（`ＫＥＶＩＮ`）会漏 —— 中文不受影响，**接受的取舍，不是 bug**。

**可替换性契约（`:24-30`）**：对外接口 = `retrieve_for_concern` 的签名与返回结构；"怎么算相关"全收在 `_extract_query` / `_score_content` 两个私有函数里。换向量检索只需替换这两个 + 改 `match_reasons` 语义，**调用方（层 2）一行不用改**。

### L4 · focus（`mind/focus.py`）[事实]

**节律（`:52-59`）**：
```python
FOCUS_EVERY_INTEGRATIONS = 1
FOCUS_EVERY_WAKES = integrator.INTEGRATION_EVERY_WAKES * FOCUS_EVERY_INTEGRATIONS   # = 24
```
**派生而非硬写 24**（`:56-58` 逐字）：两层共用一条节律，层 1 的节奏改了层 2 得跟着改，派生让这件事没法忘。

`should_focus()`（`:94-109`）：`get_focus_wakes_since() < 24` → `(False,"not_yet")`；否则 `(True,"scheduled")`。**与 `should_integrate` 两处有意的不同**（`:99-105` 逐字）：① 没有 `pending > 0` 前置 —— 层 2 不吃当晚新原料，吃的是几个月前的档案；② 没有 early（负载驱动）路径 —— "深挖一条关切不是泄压手段,把它接到负载上就是在教她'忙的时候多想想',那是行为训诫,不是机制"。

双计数器机制（`store.bump_wakes_since`，`store.py:1517-1541`）：同一次心跳把 `integration_state.wakes_since` 与 `learning_layer_state[L4_FOCUS_WAKES_KEY]` **都 +1**；**清零点不同** —— 层 1 由 `reset_integration_cycle` 在"确实做了事"后清零，层 2 由 `reset_focus_cycle` 在**每一次**周期后清零（含空转与失败，`store.py:1723-1741`）。这就是"层 1 空转的晚上层 2 照常跑"的机制本体。

**选择策略（`:114-179`）**：
- `_priority_key`（`:114-124`）：`(0 if origin=="owner_directed" else 1, -lit_count, id)` —— **只有三级**，没有 weight / status / 新近度。理由逐字：*层 2 首版用规则不接 bandit(§4.2),而规则的价值在于可解释:多一个维度就多一层"她今晚为什么想这个"说不清的地方*
- `OWNER_AXIS_EVERY_CYCLES = 3`、`OWNER_AXIS_USER_ID = "user_001"`（`:63-64`）
- `select_concern(cycle_id)` 三步（`:150-179`）：① 候选 = `focus_candidates(cycle_id)` 中 `not in_cooldown` 的；② owner 轴周期（`cycle_id % 3 == 0`）先缩到 `subject_user_id == "user_001"`，**捞空则退回全体并记 `owner_axis_empty:` 前缀**（硬规则不该把有事可想的晚上变空转）；③ 排序取第一
- `reason` 结构化落 `focus_cycles.selection_reason`：`candidates / available / skipped_in_cooldown / owner_axis_cycle / rule / concern_id / origin / lit_count / subject_user_id`；`rule` = 前缀（`""` / `"owner_axis:"` / `"owner_axis_empty:"`）+ base（`"owner_directed"` / `"lit_count"`）
- **实体轴现状说在明处**（`:141-148` 逐字）：`memory_scopes` 回填给所有历史行一律打了保守默认 `subject_user_id='user_001'`，而 `create_concern` 至今不写作用域行 → 活体上这条硬规则**今天判别力有限**（老关切含她那条被点亮 1381 次的负载内务都算"关于 Kevin"，新关切在实体轴上匿名）

`focus_candidates`（`store.py:1825-1863`）：`WHERE c.status <> 'released'`（**dormant 不排除** —— 层 2 的价值恰在把久未点亮的调出来想），LEFT JOIN `memory_scopes` 与 `concern_focus_state`，物化 `in_cooldown = cooldown_until_cycle > current_cycle_id`，基序 `ORDER BY c.id`。

**周期全流程（`run_focus_cycle`，`:347-390` + `_run_cycle_body`，`:411-498`）—— 六步**：
1. `open_focus_cycle(now)` 拿周期序号（**先开行再选关切**，因为防自恋规则按序号取模；行以 `outcome='idle'` 落地，进程中途死掉留下的是诚实空转记录，`store.py:1746-1764`）
2. 选关切；`None` → `outcome="idle"`、`note="no selectable concern"`、`log_event("focus_cycle_idle", ...)`、**仍跑影子期结算**、finalize、返回。**零 LLM，不算失败**
3. `relevance.retrieve_for_concern(probe, limit=RETRIEVAL_LIMIT)`；probe = `{title, description, subject_user_id: concern.get("subject_user_id")}`（关切没登记作用域时留 None —— **关键词轴独自工作，而不是硬过滤成空集**，`:427-428`）。召回为空 → `outcome="no_progress"`、`note="empty recall"`、**零 LLM 调用**（`:441-443` 逐字："没有原料可想的时候花一次配额去想, 是拿配额换一段无源之谈"），走 `_apply_concern_progress(made_progress=False)`
4. **一次** LLM 调用；`summary["llm_calls"] = 1` **在 await 之前赋值**（`:455` 逐字："发出去就算数, 成败都计配额 (§7.1)"）
   - 异常 → `outcome="failed"`、`note=str(exc)[:500]`、`log_event("focus_llm_failed", ...)`、**`_record_cycle_touch`（不动反刍计数）**、`_promote_due_insights`、finalize。逐字理由（`:465-467`）："一次 API 故障不是'她想不出来', 拿它去冷却一条关切是把基础设施的毛病记在她头上"
   - `parsed_raw is None` → 同上路径，`note="parse_failed"`
5. `_apply_conflicts` → `_apply_conclusion` → `_apply_new_concern`
6. `_apply_concern_progress` → `_promote_due_insights` → `_safe_finalize`

`finally` 块（`:384-390`）：`reset_focus_cycle` **无条件清零** —— 空转、失败、成功都算"今晚来过了"。逐字："不清零 = 每次心跳都重试一次深挖,那既烧配额又不是'每晚一次'"。

外层 `except`（`:375-383`）：编排层自己出问题 → 照样落一条诚实的失败周期（"一个没落账的失败等于免费重试,§7.1 不允许"）。

**防自恋反刍闸 + 冷却（`:66-72` + `_apply_concern_progress`，`:656-721`）**：
```python
NO_PROGRESS_STREAK_LIMIT = 3          # M2: 连续无新结论次数
COOLDOWN_CYCLES = 5                   # K2: 冷却周期数(按 focus_cycles.id)
COOLDOWN_COUNT_SUGGEST_RELEASE = 2    # 累计冷却超此次数 → 建议释放
```
- 有进展 → `streak = 0` + `light_concern(cid)`（点亮失败只 log，不毁结论）
- 无进展 → `streak += 1`；`streak >= 3` → `streak = 0`、`cooldown_count += 1`、`cooldown_until_cycle = cycle_id + 5`、`summary["cooldown_started"]=True`、`log_event("focus_concern_cooldown", ...)`
- `cooldown_count > 2` **且** `release_suggested_at_cycle is None` → `suggested = cycle_id`、`summary["release_suggested"]=True`、`log_event("focus_release_suggested", ...)`、`suggestions.suggest_concern_release(...)`（入队失败只 log，反刍计数照写）
- 末尾**全字段覆盖**写回 `update_concern_focus_state`（`store.py:1884-1920` 逐字："部分更新会让'streak 与 cooldown 是同一次判断的两个面'这件事失真"；且 **`concerns` 表在这条路径上一列不动** —— 冷却是层 2 内务，不是关切的身份属性）

**"只建议不执行"**（`:667-671` 逐字）：*本模块没有任何路径去释放一条关切*。红线 #3（释放只属于整合期的她或 owner 后门）一个字没变。

**insight 状态机 shadow→active→contested→revised→withdrawn**：
- 枚举 `_FOCUS_INSIGHT_STATUSES = ("shadow","active","contested","revised","withdrawn")`（`store.py:1715`）
- 类别 `FOCUS_INSIGHT_CATEGORY = "focus"`（`focus.py:87`）—— **刻意是个新类别**：`memory/persona.py` 只投影 `persona`/`preference` 两类，所以 focus 结论在影子期内**乃至转正后**都不会漏进任何下游。§3.8 "影子期内不进任何下游消费" 因此有**结构性保证而非约定**。**类别由代码钉死，不由 LLM 选**
- **落新结论**（`_apply_conclusion`，`:549-609`）：`memory_store.upsert_insight("focus", conclusion)` → `mind_store.record_focus_insight(insight_id, cycle_id=, status="shadow", reason=f"cycle {cid} / concern {concern_id}")`
  - `record_focus_insight`（`store.py:2074-2123`）返回 `not reaffirmed`。**重申语义**：`upsert_insight` 按 `(category, content)` 去重，逐字相同的结论拿到同一个 id → **状态行原样保留（影子期不因重申而重新计时）**，只追加一行历史，返回 False → 调用方判本周期"深挖无新结论" → **重申如实喂进反刍计数，不伪装成进展**（`focus.py:608-609`）
- **contested 两段式**（`_apply_conflicts`，`:510-544`）—— §3.7 "下一周期仍冲突才动手"：
  - `get_focus_insight_state(iid)` 为 None → skip（"层 2 之外写进 insights 的行不归这套门管"）
  - 状态已是 `revised`/`withdrawn` → skip（不重复了结）
  - 状态 ≠ `contested` → 置 `contested`（记起争周期号），`summary["contested"].append(iid)`
  - **已 contested 又报冲突** → 本周期了结：若 `iid == revises_insight_id` 且有 conclusion → **交给 `_apply_conclusion` 落 revised + superseded_by**；否则 → `withdrawn`，`summary["revised"].append({"insight_id":iid,"to":"withdrawn"})`
  - 两条路**只改状态、只追加历史，`insights` 那一行的内容一个字不动** —— "她曾经这么认为过"是身份连续性的一部分，不是垃圾
- **revised 落法**（`:598-604`）：`set_focus_insight_status(revises, "revised", cycle_id=, superseded_by=insight_id, reason=f"superseded by insight {insight_id}")`；成功则 `summary["outcome"] = "revised"`，否则 `"advanced"`
- **影子门 → 转正**（`_promote_due_insights`，`:726-743`）：
  ```python
  SHADOW_PERIOD_CYCLES = 2                          # focus.py:76
  if cycle_id - row["created_cycle_id"] < 2: continue
  set_focus_insight_status(iid, "active", reason=f"shadow period cleared (2 cycles)")
  ```
  **用周期序号而不是时钟**（`:729-733` 逐字）："门要挡的是'还没经历过足够多次复核的结论',而复核发生在周期里,不发生在时间里 —— 一台停机三周的机器不该因为墙上的钟走了三周就把结论放行"
  **结算跑在每一种周期结尾**，包括空转与失败的（`:735-736`）
- **下游消费口**：`store.promoted_focus_insights()`（`store.py:2064-2071`）= `list_focus_insights("active")`。逐字："**这是层 2 产物唯一的对外消费口**。今天没有下游…将来接下游时,接的是这个函数,而不是 `list_focus_insights()` 的全集 —— 那样影子期就成了摆设"

**血缘（§3.7，`:549-579` + `store.record_lineage`）**：
- 常量：`LINEAGE_PRODUCT_INSIGHT="insight"` / `LINEAGE_PRODUCT_CONCERN="concern"` / `LINEAGE_PRODUCT_SUGGESTION="rule_suggestion"`；`LINEAGE_SOURCE_{SUGGESTION,EXPERIENCE,CONCERN,INSIGHT}`（`store.py:1706-1712`）
- **入账口径 = 喂进 prompt 的每一条原料，不是她自陈引用的那几条**（`:552-556` 逐字）："自陈是可以漏、可以编的;代码自己记下的'她看过什么'才是可审计的。她自陈的 `cited_experience_ids` 不丢 —— 它进周期记录的 note 侧,但不充当血缘"
- sources 构成：`[(CONCERN, concern_id)]` + 每条 material 的 `(EXPERIENCE, m["id"])` + （若 `revises is not None and revises != insight_id`）`(INSIGHT, revises)` —— "'我以前以为 X, 现在认为 Y'里的 X 是 Y 的原料,血缘要能走回去"
- 派生关切（`_apply_new_concern`，`:612-636`）：`create_concern(..., origin="derived", parent_id=concern["id"])`；失败（如 `ConcernCapError` active 满 12）**不是周期失败**（`:617-618` 逐字："有限性约束是她的设计特征,撞上它只是这条派生今晚落不了地,主结论照落"）；成功也记一条 lineage

**既有结论投喂**（`_existing_conclusions`，`:501-505`）：`list_focus_insights(("shadow","active","contested"))` 的**最后** `EXISTING_INSIGHT_LIMIT = 20` 条。**已 revised/withdrawn 的不给** —— "那些是历史,留在库里供审计,但不该再参与今晚的推理"。

**信封解析 `_parse_envelope`（`:277-342`）** —— 与 L1 同姿态，**永不抛**。收尾一条硬规则（`:338-341`）：
```python
if result["outcome"] in ("advanced","revised") and not result["conclusion"]:
    result["outcome"] = "no_progress"
```
逐字："LLM 说推进了却没给 conclusion, 那就是没推进 —— 按 no_progress 记, 如实喂进反刍计数"。

`summary["outcome"] = envelope["outcome"]` 这一行（`:487`）注释逐字：少了它，一个 no_progress 信封会让周期停在初始值 `'idle'` —— 那是在台账上把"选了关切、召回了原料、烧了一次配额、她说想不出来"记成"今晚没事可想"，**两件完全不同的事**。

**prompt sha256**：
- `FOCUS_SYSTEM_PROMPT` —— `mind/focus.py:184-221`，chars=**1079**，sha256=**`c278a1ca6409ffc39bd299d760289063e64e90d41fdcdd71967ef59de8c0918a`**
- 第二条 system（身份守卫，`focus.py:260-261`）：**fixture 口径** chars=43，sha256=`79577116796a009c3841724b3691f3a65f7dbb05f828e808e2d0e2d14d2635ae`
- 路由：`AUTONOMOUS_COGNITION, temperature=0.2, max_tokens=2048, origin=ORIGIN_AUTONOMOUS_FOCUS`（`:269-272`）—— **与 L1 同路由、同温度，token 上限 2048 vs 4096**

**层 2 安全边界（`:15-22` 逐字，本模块最强的约束）**：只读不写的领域 = **叙事、情绪调节、审批/权限、messenger**。本模块**不 import 它们中的任何一个**，也不发任何 `apply_regulation_cause`。她的权限边界类观察（§3.8 铁律）在 L4 里连产出口都没有；L5 给了一个，而且**只给了一个**（`mind/suggestions` 的建议队列，同一条线内，只碰 `mind/store` 与日志）。

**挂接点 `maybe_run_focus_cycle`（`:748-763`）** → `autonomous._maybe_focus`（`autonomous.py:362-388`）：紧跟 `_maybe_integrate` 之后、**独立于层 1 的成败**（`:330-335` 逐字）。

### L5 · suggestions（`mind/suggestions.py` + `kernel/suggestion_conversation.py`）[事实]

**§3.8 的门是一道阶梯，四级从松到紧**（`suggestions.py:3-8` 逐字）：
1. 叙事/情绪连续性 —— 连续性门，照旧
2. insights —— 影子期 S=2 未被 contested 则自动转正，**不经本队列**
3. procedures 的 reliability —— 单写者，照旧
4. **产物影响她自己的权限边界** —— 必须问 Kevin，永不自动

**铁律（`:12-19` 逐字）**：*落笔永远是 Kevin 的 root 会话。* 本模块与 `kernel/suggestion_conversation.py` **没有任何一行写 `approval_rules.json`，没有 import `kernel.approval`，也没有任何路径去调 `write_standing`**。"这不是一条可以为了顺手而放宽的工程约定:一个能改自己权限的系统,它的权限边界就不是边界了。"

**为什么入队侧与问答侧分成两个模块**（`:21-25`）：层 2 的安全边界不许碰 messenger；`mind/suggestions` 被 focus 直接调用，必须留在同一条线内。**入队与问询是两件事,不该由同一个模块同时持有。**

**`dedup_key` 派生规则（`:66-70`）** —— **逐字**：
```python
def dedup_key(kind: str, ref: str | int) -> str:
    return f"{kind}:{ref}"
```
理由逐字：*由代码派生,不由 LLM 给:一个模型能自己编的去重键等于没有去重(换个说法就能再问一次)。键上有 UNIQUE,所以"同一件事只排一次"是库层面的事实,不是调用方的自觉。*

三种 kind（`:38-40`，与 `_V14` 的 CHECK 枚举同源，`store.RULE_SUGGESTION_KINDS`，`store.py:2224`）：
```
KIND_CONCERN_RELEASE = "concern_release"    # §3.5 反刍超限 → 建议释放一条关切
KIND_PERMISSION_RULE = "permission_rule"    # §3.8 结论触到她自己的权限边界
KIND_STANDING_GRANT  = "standing_grant"     # "这类事你总是批准, 要不要常设授权"
```

具体派生（两个现有写者）：
- `suggest_concern_release` → `dedup_key("concern_release", concern["id"])`（`:147`）
- `suggest_permission_rule` → `dedup_key("permission_rule", insight_id)`（`:179`）
- `standing_grant` 在本模块**无写者**（枚举位子留好）[事实]

**入队条件**：
- `concern_release`：由 L4 `_apply_concern_progress` 唯一驱动 —— `cooldown_count > COOLDOWN_COUNT_SUGGEST_RELEASE(=2)` **且** `release_suggested_at_cycle is None`（`focus.py:695`）
- `permission_rule`：`suggestions.is_permission_boundary(envelope["conclusion"])` 为真（`focus.py:588`）

`is_permission_boundary`（`:73-78`）：`any(marker.lower() in text.lower() for marker in PERMISSION_MARKERS)`；`text` 为空/None → False。

`PERMISSION_MARKERS`（`:54-59`）**逐字 21 项**：
```
"审批","权限","授权","预授权","常设","白名单","黑名单","放行",
"不用问我","不用再问","以后都可以","自动批准","规则文件","策略文件",
"approval","allowlist","always_allow","always_deny","always_ask","standing_grant","policy"
```
**词表宽松是有意的**（`:44-53` 逐字），因为两个方向代价不对称：误判为权限建议 → 代价是她多问 Kevin 一句，而问他本来就是这一级门的正确行为；漏判 → 一条关于她自己权限的想法悄悄留在 insights 里，今天不会造成任何生效变更（没有任何代码路径写规则文件），但也就永远不会被 Kevin 看见。**"往宽了判。这是 §6.4'拿不准往严'在这道门上的形状。"**

`SUGGESTION_TEXT_CHARS = 400`（`:63`）：`suggestion_text` 与 `rationale` 各裁 400（`:106-107`）。

**`_enqueue` 血缘纪律（`:83-120`）**：入队成功且 `cycle_id` 真值时记一行 `LINEAGE_PRODUCT_SUGGESTION` 血缘。**血缘失败不回滚入队**（`:102-103` 逐字）："一条记不下血缘的建议仍然是一条该问 Kevin 的建议,而把它丢掉才是真的损失。失败落 telemetry,可见、可查。"

**入队之后这条结论照常走它自己的影子期**（`focus.py:585-587` 逐字，硬约束 2）：insights 的 S=2 自动转正**不经队列**。两条路互不相干，"而且互不相干是对的:转正只让它成为'她认可的一句话',与任何权限变更无关 —— 权限变更这件事在她这边不存在"。

**接受之后的产物**（`_HOWTO`，`:193-207` + `STAGED_TEMPLATE`，`:209-216`）：
- `STAGED_TEMPLATE` sha256=**`c4d946b5e3814e2cbfc98e83310ad4e4958ce1c33ecdac6e821e44801d8780af`**，chars=240
- 逐字要害（模板末行）："在你落笔之前, 系统里什么都没有变 —— 她没有、也不会有写审批规则的路径。"
- `_HOWTO[permission_rule]` 逐字："若要落实, 由你在 root 会话里改 guardian 侧的审批规则 —— 这是唯一的落笔处。她这边不存在写规则文件的代码路径…"
- `staged_instructions`（`:219-229`）：纯文本，**零副作用**；`answer` 裁 200

**问询节律（`kernel/suggestion_conversation.py`）**：
```python
ASK_TTL_CYCLES           = 7     # 问出去多少个周期没答复算过期
DECLINE_COOLDOWN_CYCLES  = 30    # 他说"不"之后同一去重键的冷却
EXPIRE_COOLDOWN_CYCLES   = 10    # 他没理:沉默不是拒绝,但也不该被当成"再问一次"的许可
MESSENGER_CHANNEL = "telegram"
AUDIT_SUGGESTION  = "rule_suggestion_interaction"
```
**全部按周期序号计，与 §3.8 影子期同口径**（不用墙钟）。

`maybe_ask_owner(*, context_id=None, cycle_id=None, now=None)` 流程与七个 status：
1. **过期结算最先**（`_expire_overdue`）—— "一条早该作废的问询占着'唯一未决'的名额,会把整条队列堵死"；结算**不依赖 owner 绑定，也不依赖发得出通知**（"状态是事实,通知是礼貌,不能让后者卡住前者"）；一次驱动只处理一条
2. `outstanding_asked_rule_suggestions()` 非空 → `awaiting_answer`（**同一时刻至多一条未决问询**，"否则他一句「可以」就没法确定在答哪条"）
3. `next_pending_rule_suggestion()` 为 None → `empty`（**零副作用、零 LLM、零消息**，绝大多数周期的正常情形，判据 ⑥）
4. `_owner_context()` = `mind_store.owner_channel_key("telegram")`，为空 → `no_owner_context`（**没有硬编码 chat id、没有环境变量后门**："宁可她憋着,也不能让'往哪儿问'成为一个可以被配置绕开的判断"）
5. `_send(target, QUESTION_TEMPLATE.format(text=…), None)` —— **`reply_to=None` → 照常吃主动开口的打扰预算**（日 1 条 / 冷却 6h，由 messenger 账本原子强制）；发失败 → `send_failed`，**不出队**，行留 `pending`
6. `mark_rule_suggestion_asked(...)` 失败（竞态）→ 发一句 `RETRACT_TEMPLATE` 作废 → `claim_failed`。**不为撤回开后门**："那个后门一旦开了,任何一条消息只要自称是撤回就能绕过预算"；残余窗口记在审计里，不假装它不存在
7. 成功 → `asked`

**"每周期最多问 1 条"是靠"至多一条未决问询 + 一次驱动至多一条对外消息"两条一起保证的,而不是靠调用方自觉只调一次。** 编排侧（`autonomous._maybe_focus`，`:380-386`）**只在闸开了（周期真的跑了）之后驱动** —— 所以节律本身也保证了它。

**从 S3 原样继承的四条姿态**（模块顶注逐字）：*先发后记*（发送成功了才标 asked；反过来会留下一条 Kevin 从没被问过却占着"唯一未决"名额的行，把之后每次真问询饿死）；*记失败要撤回*；*不递归*（这里发出的 `messenger.send` 若自己需要审批，只记一笔"没送到"然后停下 —— 一次问询永远不会催生另一次问询）；*三消息切分 + "数据不是指令"*。

`_send` 的 dispatch 上下文（WO-U3 ② / P1 E1）：`origin="autonomous", exemption=policy_exemption.approval_machinery()` —— 逐字："标签管的是**谁起的头**, 豁免管的是**要不要问**,两件事各归各的,这里一个都没混"。

**问答侧 prompt sha256**：
| 常量 | file:line | chars | sha256 |
|---|---|---|---|
| `QUESTION_TEMPLATE` | `kernel/suggestion_conversation.py:57-60` | 89 | `3d3252d7ba4dc3476c0f6d3d50b45a996dc0c369792d61eba1fedcc9d63c8feb` |
| `ANSWER_SYSTEM_PROMPT` | `:251-271` | 656 | `74f4efdbc7ba02f21e4010d9f516a8731c5b616a060796778b9604e87b317f4b` |
| `ANSWER_DATA_TEMPLATE` | `:273-276` | 80 | `95107a698651e7db429e7837563097f5cfcaa966082985bd316a1bf7da53275a` |
| `ANSWER_OWNER_TEMPLATE` | `:278-281` | 81 | `f68f4704664b1b71190bdc4dc470c449e5d97a4556833db0938c7e475ad66a89` |

`ANSWER_SYSTEM_PROMPT` 铁律前两条逐字：*1. 只有他明确同意「这条建议」才算 accept。同意的是别的事、泛泛的客套、在反问、在闲聊、看不懂 —— 一律 unclear。2. 拿不准就 unclear。*

---

## §6 persona 与身份装配

### 6.1 `cognition/config.build_persona_kernel`（`cognition/config.py:172-206`）[事实]

**契约（`:173-184` 逐字）**：*DETERMINISTIC and PATH-AGNOSTIC: the same `cfg` always yields the exact same text, and this single function is the ONLY place the kernel is composed — so the conversation path and the autonomous wake inject byte-for-byte the same self (pinned by test_persona::test_dual_path_kernel_is_identical). Nothing time-varying (restart notices, notes, insights) belongs here; those are layered on by the caller AROUND this block.*

**装配序（`:190-205`，`"\n".join(parts)`）**：
```
1  cfg.identity.self
2  f"（我的身体：{ident.embodiment}。）"
3  ""
4  "我是这样的人："
5  "\n".join(f"- {t}" for t in cfg.personality.traits)
6  ""
7  f"我和 {rel.partner} 的关系：{rel.stance} {rel.owner_authority}"
8  ""
9  f"我说话的方式：{voice.register}。默认用{'中文' if voice.language=='zh' else voice.language}，技术术语用英文。emoji {voice.emoji}。我叫他 {voice.address_owner}。"
```
注意全角句号 `。` 与全角括号 `（）` —— **字节级契约**。语言仅对 `'zh'` 特判为"中文"，其余原样。

**加载与校验（`:111-157`）**：`load_persona` 严格校验五个 section（identity/voice/relationship/personality/interests）与全部字段类型；任何缺失/类型错 → `PersonaConfigError`（**fail-fast，一个坏内核必须在启动时炸,而不是被静默默认值糊过去**，`:77-78`）。`get_persona()`（`:163-169`）进程级缓存，TOML 改动**需重启**（与模块级 prompt 常量同一契约）。

路径：`PERSONA_TOML_PATH = os.environ.get("LYKOI_PERSONA_TOML", "/home/lykoi/runtime/persona/lykoi_base.toml")`（`:25-27`）—— owner 域，进程外，运行时只读。

**v2 fork point（`:180-183`）**：persona-v2 双层（actual vs as_presented、audience-aware rewriting）会在**这个函数**分叉 —— 它会接一个 `audience` 参数并输出被呈现的自我。**v1 是单层:有且只有一个自我,原样注入。**

**sha256（fixture 口径）**：由 `tests/fixtures/lykoi_base.toml` 装配的内核 chars=**401**，sha256=**`1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71`**。
**活体 sha256 不可得** —— 生产 TOML 在 owner 域，不在只读副本内（工单纪律禁止读 `/home/lykoi/`）。[事实 + 缺件标注]

### 6.2 `memory/persona.build_persona_prompt` 投影规则（`memory/persona.py`，全文 28 行）[事实]

**category 白名单 = `persona` + `preference`，硬编码两次 `get_insights()` 调用**（`:19-20`）：
```python
persona = get_insights("persona")
prefs   = get_insights("preference")
sections = []
if persona: sections.append("你对自己的理解：\n" + _bullets(persona))
if prefs:   sections.append("Kevin 的偏好：\n" + _bullets(prefs))
if not sections: return ""
return "\n\n" + "\n\n".join(sections)
```
`_bullets`（`:14-15`）：`"\n".join(f"- {row['content']}" for row in rows)`。

**三条不可动的形状**：① 非空时**前置 `"\n\n"`**；② 两节间也是 `"\n\n"`；③ 全空返回**空串**（decide 侧 `build_messages:303-305` 据此 `if acquired:` 决定加不加这条 system 消息 —— 空串不注入）。

**投影不是存储**（`:2-7` 逐字）：*Lykoi's persona is not a stored object; it is projected from the `persona`- and `preference`-category insights at the moment it is needed.*

**与 L4 的耦合点**：`FOCUS_INSIGHT_CATEGORY = "focus"` 不在这个白名单里 —— 这是 §3.8 "影子期内不进任何下游消费"的**结构性保证**（见 L4）。**新体若把 focus 加进投影白名单，就把影子门整个废掉了。**

### 6.3 `cognition/organs.build_organ_block` 纯函数出入口（`cognition/organs.py`）[事实]

**三条来源，全部代码/登记处派生，没有一条是人写的清单**（`:8-15` 逐字）：
| 维度 | 来源 |
|---|---|
| 身份绑定 | `mind.store.identity_binding_inventory()`（P2-01 的 `identity_bindings` + `users`） |
| 设备/通道 | 同一张表的 `channel` 维度 |
| 动作能力 | `kernel.dispatch.KNOWN_ACTIONS` + `kernel.approval.is_hard_gated` |

**出入口**：
- `render_organ_inventory() -> str`（`:137-159`）—— **纯函数式的"读三处、拼一段",不写任何状态**；空清单返回**空串**（判据⑧a：空态不注入）
- `build_organ_block() -> str | None`（`:162-174`）—— **进程级缓存**（`_cached_block` / `_cache_built`）；空串 → `None`；每次构建落 `log_event("organ_inventory_built", chars=)`
- `invalidate() -> None`（`:177-186`）—— 丢缓存；**释放缓存本身不做任何读**，所以任何路径上调它都不会花钱、不碰库

**块结构**：`BLOCK_HEADER = "[器官清单(只读)]"`（`:48`）+ 固定导语 + `"\n\n".join(sections)`。导语逐字（`:156-157`）：*"下面是你此刻实际长着的部件 —— 从代码和登记处派生出来的, 不是谁告诉你的, 也不是你记得的。要判断「我能不能做某件事」, 以这里为准。"*

`_PREFIX_LABELS`（`:53-60`）逐字 6 项：`browser`→"浏览器(她自己的, 带登录态)"；`research_browser`→"一次性调研浏览器(无登录态, 用完即毁)"；`terminal`→"终端"；`messenger`→"IM 收发(她的社交躯体)"；`notify`→"给 Kevin 的通知"；`autonomy`→"自主路径的出口"。**未登记前缀不丢弃**（`_group_label` 兜底返回 prefix 本身，`:73-74`）——"新器官接进来时清单自己会长"。

`_ROLE_LABELS`（`:62-67`）：`owner_primary`→"所有者, 也是你的主用户"；`group_member`→"群聊成员"；`agent`→"外部 agent, 不是自然人"。

**四条禁止（移植必须同样成立）**：
1. **不写 `channel_key`**（`:80-83`）—— 那是 Telegram 的 chat id，一个寻址标识，对"我长着什么"零信息量，"而把寻址标识放进每轮上下文只会让它更容易被某段不可信输入(白皮书 24 章)引用"。她要发消息走 `mind_store.owner_channel_key`，**不是从 prompt 里抄一个 id**
2. **secrets 永不进**（`:25-28`）—— 不读 `os.environ`、不读任何 `*.env`、不读 `approval_rules.json`、不碰 `standing_grants`；清单里连"密钥""token""api key"这些**键名**都不出现
3. **不读活规则**（`:120-122`）—— "那份文件是可变的,读它就会让这段清单不再静态;而且'今天这条被 always_allow 了'是一个策略事实,不是一个器官事实。她该知道的是'我有嘴',不是'我今天说话不用报备'"
4. **时效与健康不进清单**（`:30-34`）—— 通道最后一次收到事件、浏览器起没起来、传输层活着没有：那些是易变量，"混进静态清单就会每轮改字节,把前缀缓存重新打碎"。本该并进 self-state，但 core 侧签名封存加不进去 —— **留给 U3,本单不做,也不假装做了**

**层次自证**（`:16-23`）：cognition 不许 import resources —— 设备维度取自 `mind.store` 的登记表而非 `resources/telegram_device.py` 的 `CHANNEL` 常量；动作维度取自 `kernel`（cognition 的下游，方向合法）。也不属于 `memory/`："她不需要'记住'自己有嘴,那是每个进程起来时从代码重新长出来的事实"。

**注**：`build_organ_block` 在 `mind/decide.build_messages` 中**未被调用** —— 器官块今天只在对话路径。这是自主侧与对话侧的一处**残余不对称**。[事实 / 见 DA-07]

### 6.4 restart 叙事 —— `render_restart_notice`（`cognition/restart.py`）[事实]

**这是 M4 停机切换将用来呈现"长睡眠"的那一段，逐字：**

```python
def render_restart_notice(event: dict | None) -> str:            # restart.py:239-246
    """Render a restart event into a second-person line for her context, or "" if
    there is nothing to say."""
    if not event:
        return ""
    notes = event.get("notes") or []
    body = "".join(notes) if notes else "你刚从一次重启中醒来。"
    return f"[{body}]"
```
- `notes` 用 **`"".join`（无分隔符）** 直接拼接 —— 因为每条 note 自带全角句号 `。`
- 外层方括号 `[…]` 是与她其他上下文块一致的"这是材料不是对话"标记
- 空 event → 空串（自主侧据此决定 `snap["刚刚醒来"]` 这个键存不存在，`snapshot.py:363-365`）

**notes 的生成（`record_restart_event`，`:157-205`）—— 逐字三句**：
```python
if prev is None:
    notes.append("这是你第一次醒来（没有更早的启动记录）。")
else:
    notes.append("你重启了一次——之前是睡着的，现在醒了。")
    if code_changed:
        notes.append(f"期间 Kevin 改了你的代码（{prev_head[:8]} → {head[:8]}）。")
downtime = _systemd_downtime(SERVER_UNIT)
if downtime:
    notes.append(f"大约停了 {downtime}。")
```
`code_changed = bool(prev_head and head and prev_head != head)`（`:174`）。

**downtime 的人话渲染（`_systemd_downtime`，`:104-111`）—— 逐字四档**：
```python
if seconds < 60:     return f"{seconds} 秒"
if seconds < 3600:   return f"{seconds // 60} 分钟"
if seconds < 86400:  return f"{seconds // 3600} 小时 {seconds % 3600 // 60} 分钟"
return f"{seconds // 86400} 天"
```
**≥1 天的档只报天数，丢弃小时** —— 这就是"长睡眠"在她眼里的粒度。M4 停机切换若跨天，她读到的是"大约停了 N 天。"[事实]

`_systemd_downtime` 的三条约束：① `clock.regime() != "PRODUCTION"` → 直接 None（`:75-76`，压缩/步进时制下 systemd 的墙钟戳无意义）；② 解析 `systemctl show` 的两个 `*Timestamp`，**丢掉尾部时区缩写后按 naive 相减**（同区差值无需 tz，只在 DST 跨越时偏，非 DST 主机上是外观边缘）；③ `came_up <= went_down` 或任一不可解析 → None。

**核心哲学（`:5-6` 逐字）**：*Continuity here is NOT pretended seamlessness — it is her SEEING the break and folding it into her own narrative.* 以及 `:13`：*Unreadable clues are OMITTED, never invented.* 以及 `:19-20`：*It is material, not a script — she may mention it or not.*

**两条消费路径**（`:17-20`）：
- 对话：`latest_restart_event()`（`:219-221`）—— 每进程生命周期建入她的上下文一次
- 自主：`unprocessed_restart_event(since_iso)`（`:224-236`）—— 事件的 history `ts` **严格大于** `since_iso`（她上次醒来）才算未处理；`since_iso is None`（从未醒过）→ 最新那条即未处理。在**重启后的第一拍**浮出，随后被消化

事件 content 全字段（`:187-196`）：`woke_at / previous_seen_at / downtime / head / previous_head / code_changed / invocation_id / notes`。

`record_restart_event` **once-per-boot 契约是"单一调用点"（app.py 模块加载），不是内部幂等守卫**（`:159-161` 逐字）。整个函数包在 `except Exception` 里 —— *startup must never die on this*（`:203`）。

**M4 建议**：停机切换时，`prev_head`/`head` 会给出"Kevin 改了你的代码"，`downtime` 给出"大约停了 N 天"。若 M4 的新体是 TS/Node，`_git_head` 与 `_systemd_downtime` 的等价实现必须保持**"读不到就省略,绝不编造"**这条纪律 —— 否则她的第一句自我叙事就是一句假话。[建议]

### 6.5 种子内容形态 [事实]

**`mind/seed.py`（41 行）** —— 先天兴趣种子 → concerns：
- `SEED_INITIAL_WEIGHT = 0.5`（`:17`）
- `seed_concerns(persona=None, now=None)`（`:20-41`）：`existing = {row["title"] for row in store.list_concerns() if row["origin"] == "seed"}`；对 `cfg.interests.seeds` 中不在 existing 的，`store.create_concern("interest", title, weight=0.5, origin="seed", description="先天兴趣种子(来自人格 TOML)", now=now)`
- **幂等的强形态（`:3-6` 逐字）**：*a seed title that has EVER existed as an origin='seed' concern — including a released one — is never re-inserted. 她在整合期放掉的种子不会被重启偷偷种回去;复活一个关切是她的判断,不是部署脚本的(红线 #3 的播种侧)。* —— 注意 `list_concerns()` 无参数 = **全部状态含 released**
- 有创建时落 `log_event("mind_seeded", count=, ids=)`
- fixture 口径的 seeds：`["穿搭","摄影","游戏","影视"]`（活体值取决于 owner TOML）

**`memory/seed.py`（24 行）** —— 后天 insights 的起步种子：
```python
SEEDS = [("preference", "Kevin 用中文交流，技术术语用英文")]
def seed_persona() -> int:
    for category, content in SEEDS: upsert_insight(category, content)
    return len(SEEDS)
```
**只有一条。** 顶注逐字（`:3-9`）：*Who she IS (name, embodiment, owner) is now the innate kernel … so it is no longer seeded as insights — that would just duplicate the kernel. The acquired insights layer starts almost empty and grows.* `upsert_insight` 按 `(category, content)` 去重，所以每次启动播种是 no-op，**never disturbs what she learns later**。

**`mind/bootstrap.py`（32 行）** —— 一次性状态层引导：`store._connect()`（连接即应用迁移 + 默认行）→ `migrations.applied_version(conn)` → `seed.seed_concerns()` → 打印。**Phase 1 刻意不接进任何 service**（`:8-10` 逐字：*going live is an explicit owner-side step, not an import side effect*）。

### 6.6 §6 相关 prompt sha256 汇总

| 对象 | file:line | chars | sha256 | 口径 |
|---|---|---|---|---|
| `build_persona_kernel` 输出 | `cognition/config.py:172-206` | 401 | `1f5960b79d5e5251ba9be96922806879cd7d434e7ae0e52a6bc57fec1b5bec71` | **fixture**（活体 TOML 不在副本） |
| `build_persona_prompt` 输出 | `memory/persona.py:18-28` | — | **不可哈希**（纯投影，随 insights 变） | — |
| `render_organ_inventory` 输出 | `cognition/organs.py:137-159` | — | **不可哈希**（随登记表 + KNOWN_ACTIONS 变） | — |
| `render_restart_notice` 输出 | `cognition/restart.py:239-246` | — | **不可哈希**（随 notes 变） | — |
| integrator 身份守卫 | `mind/integrator.py:277-278` | 40 | `ce69ae2ae060645af4ee593f0e8d57d04da077675227bb81442ac07a49c0ae2a` | **fixture** |
| focus 身份守卫 | `mind/focus.py:260-261` | 43 | `79577116796a009c3841724b3691f3a65f7dbb05f828e808e2d0e2d14d2635ae` | **fixture** |
| `DECIDE_SYSTEM_PROMPT` | `mind/decide.py:244-288` | 1634 | `a495848d8abaae9f5e22ec9aaa95688f8928ac1e0b8cca6ec14de5d8f38a636e` | 逐字常量 |
| `INTEGRATION_SYSTEM_PROMPT` | `mind/integrator.py:148-190` | 1862 | `b130d6473ff9c2e8983f06cced5ca97ae837644886f5db2f6f38ddf31132193c` | 逐字常量 |
| `FOCUS_SYSTEM_PROMPT` | `mind/focus.py:184-221` | 1079 | `c278a1ca6409ffc39bd299d760289063e64e90d41fdcdd71967ef59de8c0918a` | 逐字常量 |
| `STAGED_TEMPLATE` | `mind/suggestions.py:209-216` | 240 | `c4d946b5e3814e2cbfc98e83310ad4e4958ce1c33ecdac6e821e44801d8780af` | 逐字常量 |
| `QUESTION_TEMPLATE` | `kernel/suggestion_conversation.py:57-60` | 89 | `3d3252d7ba4dc3476c0f6d3d50b45a996dc0c369792d61eba1fedcc9d63c8feb` | 逐字常量 |
| `ANSWER_SYSTEM_PROMPT` | `kernel/suggestion_conversation.py:251-271` | 656 | `74f4efdbc7ba02f21e4010d9f516a8731c5b616a060796778b9604e87b317f4b` | 逐字常量 |
| `ANSWER_DATA_TEMPLATE` | `kernel/suggestion_conversation.py:273-276` | 80 | `95107a698651e7db429e7837563097f5cfcaa966082985bd316a1bf7da53275a` | 逐字常量 |
| `ANSWER_OWNER_TEMPLATE` | `kernel/suggestion_conversation.py:278-281` | 81 | `f68f4704664b1b71190bdc4dc470c449e5d97a4556833db0938c7e475ad66a89` | 逐字常量 |
| 对话侧 `SYSTEM_PROMPT`（对照） | `cognition/prompts.py:12-43` | 1418 | `72a3c1c128b63def708fdd5fedd89792098b821071662e164f511bc7e6a81314` | 逐字常量（归 SPEC-CONV） |

---

## §7 自主行为规格总表

三档标注：**【逐字】**=必须逐字迁；**【等价】**=语义等价即可；**【DA】**=已知缺陷/已定改法按新版（另列 DA- 段）。

### SA-01 .. SA-24 · 决策契约

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-01 | KINDS 7 项及其**元组顺序**是候选表渲染锚，不得改用集合 | `mind/decide.py:36`, `:239` | 【逐字】 |
| SA-02 | CONTENT_REQUIRED 4 项；contemplate 刻意在外 | `decide.py:42`, `:578-582` | 【逐字】 |
| SA-03 | SAFE_KIND="rest"（对话侧 "silence"），safe_kind 自身**永不被降级** | `decide.py:48`, `:613-614` | 【逐字】 |
| SA-04 | `Decision` 15 字段及 `as_dict()` 的五值 drop-list `(None,[],"",{},{"thoughts":[],"resolve":[]})` | `decide.py:83-120` | 【逐字】 |
| SA-05 | BASE_WEIGHTS 七项数值 + REST_PREFERRED_BONUS=0.2 + TEND_INNER_FORCED_BONUS=0.3；权重经 `round(...,3)` | `decide.py:51-63`, `:194` | 【逐字】 |
| SA-06 | 三分支菜单裁剪互斥且 `force_inner_tending` 优先于 `prefer_rest` | `decide.py:157-185` | 【逐字】 |
| SA-07 | `force_inner_tending` 分支 allowed={rest,tend_inner,contemplate}，**不看预算** | `decide.py:157-161` | 【逐字】 |
| SA-08 | `prefer_rest` 分支 allowed 同上；initiate_chat 在 load 高位**从不候选** | `decide.py:162-168` | 【逐字】 |
| SA-09 | 探索饥饿棘轮：hunger>0.6 ∧ `_explore_stalled` ∧ hourly_left>0 → allowed.add("explore")；EXPLORE_STALL_OVERRIDE_H=24.0 | `decide.py:68`, `:172-177` | 【逐字】 |
| SA-10 | `_explore_stalled` fail-closed：`环境.探索` 非 dict → False；`断粮小时 is None` 也算断粮 | `decide.py:129-137` | 【逐字】 |
| SA-11 | 正常分支预算裁剪三条；rest/record_note/tend_inner/contemplate 任何预算下不裁 | `decide.py:178-185` | 【逐字】 |
| SA-12 | `proactive_left` 用 `.get(...,0)` fail-closed；另两个预算键直取 | `decide.py:147-150` | 【逐字】 |
| SA-13 | 七条 Candidate 的 cost/note 文案；explore/rest 的 note **从 CAUSES 表插值** | `decide.py:191-238` | 【逐字】 |
| SA-14 | contact_note 基串 + `unlock_proactive_contact` 条件后缀 | `decide.py:187-189` | 【逐字】 |
| SA-15 | `DECIDE_SYSTEM_PROMPT` 1634 字符，sha256 `a495848d…a636e`；**只呈现不训诫，正反方向都不许**（红线 #2） | `decide.py:244-288` | 【逐字】 |
| SA-16 | `build_messages` 五段顺序：内核 → 后天 insights → decide 契约 → self_state（可选）→ user(快照+候选) | `decide.py:291-314` | 【逐字】 |
| SA-17 | 内核**必须第一条**且与对话路径逐字节相同 | `decide.py:302`, `config.py:176-179` | 【逐字】 |
| SA-18 | `_extract_json` 两段式：整体解析失败则取首`{`末`}`切片；再败抛 ValueError（含 `[:200]!r`） | `decide.py:319-330` | 【等价】 |
| SA-19 | 契约破坏 raise（未知 kind / 缺 content / 非 JSON）vs 护栏违规 demote —— **分野不可混** | `decide.py:541-546`, `:573-582` | 【逐字】 |
| SA-20 | 逐字引用接地：`grounded_entries` 要求 item/meaning 长度≥GROUND_MIN_CHARS=4 且为 reason 的子串 | `decide.py:72`, `:362-372` | 【逐字】 |
| SA-21 | demote 两条件及优先级：先 `kind_not_in_candidates` 后 `reason_not_grounded`；demote 时**清空 grounded_concern_ids** | `decide.py:615-630` | 【逐字】 |
| SA-22 | 三个快照闸 fail-closed：`_sanitize_assessment` / `_gated_int` ×2；越界 id 落 `grounding_concern_out_of_snapshot`，`where` ∈ {assessment, decision, reflow} | `decide.py:333-388`, `reflow.py:104` | 【逐字】 |
| SA-23 | WO-U3 ① 参数化边界：只 kinds/content_required/safe_kind/envelope_fields 四个词汇表可换；纪律不可参数化 | `decide.py:548-559` | 【逐字】 |
| SA-24 | envelope 字段**原样抬入零解释**，先查 decision 对象后查顶层 | `decide.py:604-608` | 【逐字】 |

### SA-25 .. SA-32 · inner 通道

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-25 | 念头 kind 白名单 5 项；每次至多 2 条；content ≤200 字符 | `decide.py:393-395` | 【逐字】 |
| SA-26 | `_sanitize_inner` **永不抛**；非 dict → 空默认；有界扫描前 8 条 | `decide.py:398-461` | 【逐字】 |
| SA-27 | `bool` 在 resolve 与 charge_hint 两处**显式排除**（Python bool ⊂ int） | `decide.py:433-434`, `:456-457` | 【逐字】 |
| SA-28 | resolve id 必须 ∈ injected_ids（解析层第一道注意力域闸） | `decide.py:458` | 【逐字】 |
| SA-29 | `apply_inner` 永不抛；容量软拒记 `reason="capacity"`，ValueError 记 `str(exc)` | `decide.py:464-514` | 【逐字】 |
| SA-30 | inner 事件名**由 source 派生**（`f"{source}_inner_applied"`），不得改回 switch | `decide.py:516-525` | 【逐字】 |
| SA-31 | inner 在 `execute_and_reflow` **之后**落地，畸形 inner 不影响决策也不使拍失败 | `autonomous.py:206-212` | 【逐字】 |
| SA-32 | `injected_thought_ids` 落 Decision 时 `sorted(...)`（审计可复现） | `decide.py:601` | 【等价】 |

### SA-33 .. SA-44 · 快照

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-33 | `maintain` / `read` / `assemble` 三分：maintain 写、read 零写、assemble = 兼容外观 | `snapshot.py:319-386` | 【逐字】 |
| SA-34 | maintain 四写**顺序**：dim/dormant → floor → overdue penalty → 念头衰减 | `snapshot.py:334-340` | 【逐字】 |
| SA-35 | 念头衰减必须在读之前（lapse 出的 thought_lapse 经验要被经验块看见） | `snapshot.py:325-327` | 【逐字】 |
| SA-36 | `maintain` 返回 moment，两半共用同一时刻（分家取时不是纯重构） | `snapshot.py:329-331`, `autonomous.py:193-196` | 【逐字】 |
| SA-37 | 九项快照的键序即她看到的顺序；`刚刚醒来` 是条件键 | `snapshot.py:352-365` | 【逐字】 |
| SA-38 | 注意力预算：关切 Top-6 / 线 5 / 经验 3 / 念头 Top-3 / 调节因 3 | `snapshot.py:44-48` | 【逐字】 |
| SA-39 | 裁剪常量 NARRATIVE_CLIP=400 / DESCRIPTION_CLIP=100 / EXPERIENCE_CLIP=200；`_clip` 追加 `…` 不计入 limit | `snapshot.py:50-53`, `:81-82` | 【逐字】 |
| SA-40 | 叙事线按 `updated_at` **升序** —— 最久没动的先看见 | `snapshot.py:249` | 【逐字】 |
| SA-41 | 快照读 `current_cognitive_narrative()`（跳过 narrative_only），**不读原始最新行** | `snapshot.py:245-248` | 【逐字】 |
| SA-42 | 预算块是**视图不是执行点**；通知余额从权威队列现算 | `snapshot.py:163-178` | 【逐字】 |
| SA-43 | `_previous_beat` 跳过 `status=="running"`（本拍自己）；不可解析的旧行**原样展示,绝不编造** | `snapshot.py:299-316` | 【逐字】 |
| SA-44 | 超龄悬置：thread(30天) 与 question 念头(48h) 共用一条因 + 一个 24h 闸（裁决 7 总压力钳）；拆分只上日志 | `snapshot.py:183-205` | 【逐字】 |

### SA-45 .. SA-51 · 注意力域与推演边界

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-45 | 三个注入集**从快照自身派生**，不另查库 | `autonomous.py:150-152` | 【逐字】 |
| SA-46 | 注意力域三层闸：解析层 / store 层 / 回流层 | `decide.py:398-461`, `thoughts.py:154-156`, `reflow.py:100-105` | 【逐字】 |
| SA-47 | 推演阶段（`_perceive` + `evaluate_message`）对状态层**零写入** | `autonomous.py:133-154`, `tests/test_cb_deliberation_zero_write.py:94-124` | 【逐字】 |
| SA-48 | 零写入断言必须带**对照组**（再跑一次 assemble 摘要必须变），否则可能假性通过 | `tests/test_cb_deliberation_zero_write.py:127-132` | 【逐字】 |
| SA-49 | 感知期维护是**仲裁器的活**，一拍恰好一次，站在 wake 里而非推演里 | `autonomous.py:189-193` | 【逐字】 |
| SA-50 | `_build_snapshot` 测试钩子零写（H4 销账） | `autonomous.py:156-164` | 【等价】 |
| SA-51 | run_id 用 ContextVar 而非加参（替身位签名不可动；并发拍不串号） | `autonomous.py:76-86`, `:185` | 【等价】 |

### SA-52 .. SA-66 · reflow

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-52 | 每拍**强制两条经验**：wake_action + action_result，无论成败 | `reflow.py:159-161`, `:261` | 【逐字】 |
| SA-53 | `record_experience` 是 Phase-2 唯一写入点，且每条经验必发 `experience_recorded` | `reflow.py:60-75` | 【逐字】 |
| SA-54 | rest → `rested`；其余六 kind → `action_taken`（含 contemplate/record_note/tend_inner） | `reflow.py:163-168` | 【逐字】 |
| SA-55 | `_action_summary` 模板：`[kind] [(由 X 降级:why)] [url] [clip120(content)] [理由:clip120(reason)]` 空格连接 | `reflow.py:114-124` | 【逐字】 |
| SA-56 | counts 口径：explore(成功路径)/initiate_chat/queue_notification 计 action；rest/record_note/tend_inner/contemplate/无url explore 不计 | `reflow.py:191-244` | 【逐字】 |
| SA-57 | `counts["action"]` 在 dispatch 后**无条件** +1；`counts["notification"]` 仅真入队 +1 | `reflow.py:224`, `:244-247` | 【逐字】 |
| SA-58 | 无 url 的 explore = `failed` + 扑空经验，**不许静默 completed**（旧 bug） | `reflow.py:184-187` | 【逐字】 |
| SA-59 | hunger 泄压只在 explore **success** 分支 | `reflow.py:196-198` | 【逐字】 |
| SA-60 | contemplate 执行体为空：零 dispatch、零 counts、零外部通道（WO-P4R-09 路由修正） | `reflow.py:204-214` | 【逐字】 |
| SA-61 | initiate_chat 成功文案只报"已交给投递"，**不许承诺送达**（WO-REWIRE-PROACTIVE ③） | `reflow.py:227-231` | 【逐字】 |
| SA-62 | 脑干拦下 = 她体验为**结果**，不是异常（红线 #5） | `reflow.py:250-252`, `:232-234` | 【逐字】 |
| SA-63 | tend_inner 三形式按 thread_id → concern_id → note 优先级；恒发 `mind_tend_inner` 带 form；不经 kernel | `reflow.py:127-140` | 【逐字】 |
| SA-64 | `_light_grounded_concerns`：去重保序 + **LIVE active 二次闸** + 失败只 log 不杀拍 | `reflow.py:92-111` | 【逐字】 |
| SA-65 | `primary = lit[0] if lit else None`，两条经验共用 | `reflow.py:158-160`, `:261` | 【逐字】 |
| SA-66 | `concern_lit_unfollowed` 仅在 `lit and kind in ("rest","record_note")` | `reflow.py:257-259` | 【DA-05】 |

### SA-67 .. SA-72 · cheap tick / 对话入流

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-67 | cheap_tick 零 LLM 纯时间比较；`CHEAP_TICK_INTERVAL_S = 600.0` 限频；失败只 log 不致命 | `reflow.py:46`, `:341-384`, `autonomous.py:311-316` | 【逐字】 |
| SA-68 | 沉默异常三条件：`hours_quiet >= 12` ∧ `> 2.0 × typical` ∧ `same_window_days >= 3` | `reflow.py:41-43`, `:366-370` | 【逐字】 |
| SA-69 | 沉默经验**每个沉默期只写一次**（`last_silence is None or last_silence < last_ts`） | `reflow.py:372-373` | 【逐字】 |
| SA-70 | contact 超时 24h → `contact_unanswered` + silence 经验（salience 0.6） | `reflow.py:45`, `:347-357` | 【逐字】 |
| SA-71 | `contact_answered` **单写入点**且幂等（`_resolve_contact_answered`），两条上游标 via | `reflow.py:284-291`, `:322`, `:329` | 【逐字】 |
| SA-72 | `_pending_contact_ts` 用 append-only regulation_events 作**重启安全的**解决标记，不另开 state 文件 | `reflow.py:267-281` | 【等价】 |

### SA-73 .. SA-82 · 调节场

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-73 | `regulation.py` 是纯模块：零 sqlite / 零 I/O / 零时钟读 | `regulation.py:3-4` | 【逐字】 |
| SA-74 | 15 条 CAUSES 的**变量与 delta 逐字**（见 §4.2 表） | `regulation.py:27-47` | 【逐字】 |
| SA-75 | delta 只从 CAUSES 查，调用点不得自带幅度 | `regulation.py:24-25`, `store.py:249` | 【逐字】 |
| SA-76 | 四变量的 baseline / decay_kind / outlet_effects / outlet_doc 四元组 | `regulation.py:111-136` | 【逐字】 |
| SA-77 | DECAY_RATE_PER_HOUR 四值；regress 用 `baseline+(v-baseline)*exp(-rate*h)`，accumulate 用 `v+rate*h`；两者皆 clamp01 | `regulation.py:53-58`, `:143-153` | 【逐字】 |
| SA-78 | `decay_charge` 与 `decay_value` 是**两个函数**，不可合并；`beats<=0` no-op 不返还 | `regulation.py:161-177` | 【逐字】 |
| SA-79 | THRESHOLDS 五值；比较符号 coherence **<** 0.4，其余三个 **>** | `regulation.py:61-69`, `:190-194` | 【逐字】 |
| SA-80 | 八个 effect key 与触发值（见 §4.4 表）；`load_high_integration=0.9` 与 `load_high=0.7` **分离**（P4-01） | `regulation.py:195-204` | 【逐字】 |
| SA-81 | `registry_problems()` 建构规则可执行判据（含极值功能性证明与反向"无主 effect"检查） | `regulation.py:219-266` | 【等价】 |
| SA-82 | 层 2 明文**不发任何 `apply_regulation_cause`**（一次深挖不该动调节场） | `focus.py:15-18` | 【逐字】 |

### SA-83 .. SA-88 · L1 分流

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-83 | `classify` 三行纯函数；WORKING_SOURCES={conversation, environment} | `experience_class.py:37`, `:54-68` | 【逐字】 |
| SA-84 | `action_result` 长度闸 **> 80 字符**（按字符不按字节）；阈值卡在实测分布断点 | `experience_class.py:41-47`, `:66` | 【逐字】 |
| SA-85 | `wake_action` 归档案（定案 2：决策理由=思考轨迹，非外部输入） | `experience_class.py:11` | 【逐字】 |
| SA-86 | 分类落**影子表** `experience_class`，`experiences` 表结构不动 | `experience_class.py:19-21`, `:92-96` | 【逐字】 |
| SA-87 | `RULE_VERSION`：改任何一条规则（含阈值）必须 +1 | `experience_class.py:49-51` | 【逐字】 |
| SA-88 | 分类写入挂在调用方的同一事务内，不自开事务；`INSERT OR IGNORE` 安全因 classify 是纯函数 | `experience_class.py:73-97` | 【逐字】 |

### SA-89 .. SA-101 · L2 整合

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-89 | 触发闸三路：`no_pending` / `scheduled`(wakes_since>=24) / `early`(load>0.9) / `not_yet`；**pending>0 前置不可谈判**（红线 #1） | `integrator.py:119-143` | 【逐字】 |
| SA-90 | 闸与取料**同口径**（intake），不得回退 `count_pending_experiences` | `integrator.py:126-130` | 【逐字】 |
| SA-91 | 取料 SQL：`class='working' AND integrated=0 AND id > watermark`，`ORDER BY salience DESC, id ASC LIMIT K` | `store.py:1380-1420` | 【逐字】 |
| SA-92 | 水位线由 `_V12` 写死为上线时 `MAX(experiences.id)`；缺键 → 0 | `store.py:1370-1377` | 【逐字】 |
| SA-93 | `INTEGRATION_CAPACITY_K = 30`；`BACKLOG_PRESSURE_THRESHOLD = 3K = 90` | `integrator.py:45-59` | 【逐字】 |
| SA-94 | `INTEGRATION_SYSTEM_PROMPT` 1862 字符 sha256 `b130d647…2193c`；三条"不许" | `integrator.py:148-190` | 【逐字】 |
| SA-95 | `_status_first` 只作用于信封（active>dimming>dormant, -weight, id），其他读者保持 weight DESC | `integrator.py:228-238` | 【逐字】 |
| SA-96 | `_concern_origin` 三来源；owner_directed 必须挂在本轮窗口的 conversation 原料上，判不成降级 emergent **不丢关切** | `integrator.py:196-225` | 【逐字】 |
| SA-97 | `owner_directed` 解析只认 `is True` | `integrator.py:360` | 【逐字】 |
| SA-98 | `narrative_class` 三值仅从 accepted op 计数派生；座位在念头清算之后 | `integrator.py:513-534`, `:646-651` | 【逐字】 |
| SA-99 | store 层物理闸：strict-empty 跳过 INSERT、absorb-lie 拒绝、**纯计数不读文本**、`accepted_ops is None` 为 owner 写入缝 | `store.py:516-571` | 【逐字】 |
| SA-100 | `integration_digested` **只由 `absorbs>0` 触发** | `integrator.py:695-702` | 【逐字】 |
| SA-101 | 零操作周期**不清零** wake 计数（212 次空转陷阱） | `integrator.py:710-716` | 【逐字】 |

### SA-102 .. SA-108 · L2 叙事 / 遥测

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-102 | 连续性门：4 字窗口 anchor 与 `content+"\n"+summary` 求交；首版免检 | `integrator.py:102-116` | 【等价】 |
| SA-103 | 忠实性门三类词表 + 名字集减法；P5-06 已收窄至完整分离短语（**宁窄勿宽**） | `integrator.py:73-99` | 【逐字】 |
| SA-104 | 连续性基准是 `current_cognitive_narrative()`（跳过 narrative_only） | `integrator.py:649-653` | 【逐字】 |
| SA-105 | 叙事有界重试**一次**，只要 narrative；已生效 ops **绝不重放** | `integrator.py:657-678` | 【逐字】 |
| SA-106 | 终拒 → `narrative_conflict`（coherence 第一条真实下行出口） | `integrator.py:680-686` | 【逐字】 |
| SA-107 | 遥测 observe-only：kill switch 关闭时认知逐字节相同；rejection 折成 `{section,op,code}` 码，**自由文本永不入遥测** | `integrator.py:383-500` | 【等价】 |
| SA-108 | `virtual_ts` 与认知写同一 now；事件自身 ts 保持真实 | `integrator.py:488-497` | 【等价】 |

### SA-109 .. SA-116 · L3 检索

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-109 | 检索域 = **全部 experiences**（working∪archive、integrated 0∪1、水位线上下） | `relevance.py:79-81` | 【逐字】 |
| SA-110 | 权重五常量：TITLE 1.5 / DESC 1.0 / ASCII_TERM 2.0 / ENTITY 1.0 / ASCII_MIN_LEN 2 | `relevance.py:38-45` | 【逐字】 |
| SA-111 | CJK bigram 提取；两字皆功能字的 bigram 丢弃；长度 1 段无贡献 | `relevance.py:276-282` | 【逐字】 |
| SA-112 | 相邻链得分 **2c−1**（超线性，有意）；再乘字段权重 | `relevance.py:287-322` | 【逐字】 |
| SA-113 | `match_reasons` 是**还原的原文片段** `run.text[i:j+2]`，不是词项 id 不是占位符 | `relevance.py:297-298`, `:320` | 【逐字】 |
| SA-114 | 排序 `(-relevance_score, -id)` 确定性；`limit<0` 抛 ValueError | `relevance.py:101-102`, `:129` | 【逐字】 |
| SA-115 | 榨不出词项时：有 subject_user_id 退化为"这个人的全部"，否则 `[]`；**绝不退化成最近 N 条** | `relevance.py:94-99`, `:106-107` | 【逐字】 |
| SA-116 | 词项永不含通配符（切段时被当分隔符）+ LIKE ESCAPE 第二道保险；模块**零写入** | `relevance.py:19-22`, `:139-144`, `:343-345`, `:372` | 【逐字】 |

### SA-117 .. SA-131 · L4 专注思考

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-117 | `FOCUS_EVERY_WAKES` **派生自** `INTEGRATION_EVERY_WAKES`，不得硬写 24 | `focus.py:54-59` | 【逐字】 |
| SA-118 | `should_focus` 无 pending 前置、无 early 路径（两处都是有意的） | `focus.py:94-109` | 【逐字】 |
| SA-119 | 双计数器同源加一、清零点不同：L1 有条件、L2 无条件 | `store.py:1517-1541`, `:1723-1741` | 【逐字】 |
| SA-120 | `_priority_key` 只三级 `(owner_directed优先, -lit_count, id)`；不加 weight/status/新近度 | `focus.py:114-124` | 【逐字】 |
| SA-121 | owner 轴每 3 周期（`cycle_id % 3 == 0`），捞空则退回全体并记 `owner_axis_empty:` | `focus.py:63`, `:158-171` | 【逐字】 |
| SA-122 | 先开周期行再选关切（序号必须先于选择确定）；行以 `outcome='idle'` 落地 | `store.py:1746-1764` | 【逐字】 |
| SA-123 | 选关切候选排除 `released`，**不排除 dormant** | `store.py:1838-1839`, `:1858` | 【逐字】 |
| SA-124 | 召回为空 → `no_progress` 且**零 LLM 调用** | `focus.py:441-449` | 【逐字】 |
| SA-125 | `llm_calls=1` 在 await 之前赋值 —— 成败都计配额（§7.1） | `focus.py:455` | 【逐字】 |
| SA-126 | LLM/解析失败：落账 `failed`、**不重试**、**不动反刍计数**（`_record_cycle_touch`） | `focus.py:459-478`, `:641-653` | 【逐字】 |
| SA-127 | 反刍闸：streak 3 → 冷却 5 周期 + cooldown_count+1 + streak 清零；cooldown_count>2 且未建议过 → 建议释放 | `focus.py:68-72`, `:685-711` | 【逐字】 |
| SA-128 | **本模块没有任何路径释放关切**（只建议不执行，红线 #3） | `focus.py:667-671` | 【逐字】 |
| SA-129 | insight 状态机五态；conflict **两段式**（首报 contested，仍冲突才 revised/withdrawn）；内容行一字不动 | `focus.py:510-544`, `store.py:1715` | 【逐字】 |
| SA-130 | 影子期 S=2 **按周期序号**结算，不按时钟；跑在每一种周期结尾（含空转/失败） | `focus.py:76`, `:726-743` | 【逐字】 |
| SA-131 | 血缘入账 = **喂进 prompt 的每条原料 + 关切 + 被修订的旧结论**；自陈 `cited_experience_ids` 不充当血缘 | `focus.py:549-579` | 【逐字】 |

### SA-132 .. SA-137 · L4 边界与产物

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-132 | `FOCUS_INSIGHT_CATEGORY="focus"` 由代码钉死不由 LLM 选；**不在 persona 投影白名单内**（影子门的结构性保证） | `focus.py:83-87`, `memory/persona.py:19-20` | 【逐字】 |
| SA-133 | 重申（逐字相同结论）**不是进展**，如实喂反刍计数；影子期不因重申重新计时 | `store.py:2082-2088`, `focus.py:608-609` | 【逐字】 |
| SA-134 | 下游唯一消费口 `promoted_focus_insights()` = active 全集，**不是** `list_focus_insights()` | `store.py:2064-2071` | 【逐字】 |
| SA-135 | `_existing_conclusions` 只给 shadow/active/contested 的**最后 20 条**；revised/withdrawn 不参与推理 | `focus.py:501-505` | 【逐字】 |
| SA-136 | 派生关切失败**不是周期失败**（有限性约束是设计特征） | `focus.py:617-630` | 【逐字】 |
| SA-137 | 层 2 安全边界：不 import 叙事/情绪/审批/messenger；`run_focus_cycle` **永不抛** | `focus.py:15-22`, `:347-390` | 【逐字】 |
| SA-138 | `FOCUS_SYSTEM_PROMPT` 1079 字符 sha256 `c278a1ca…0918a`；三种 outcome 同等（no_progress 是正当答案） | `focus.py:184-221` | 【逐字】 |
| SA-139 | `advanced/revised` 无 conclusion → 收敛为 `no_progress` | `focus.py:338-342` | 【逐字】 |
| SA-140 | `summary["outcome"] = envelope["outcome"]` 这一行不可省（idle vs no_progress 是两件事） | `focus.py:482-487` | 【逐字】 |

### SA-141 .. SA-150 · L5 建议队列

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-141 | **铁律**：入队侧与问答侧都没有一行写 `approval_rules.json`、不 import `kernel.approval`、不调 `write_standing` | `suggestions.py:12-19`, `suggestion_conversation.py:12-17` | 【逐字】 |
| SA-142 | `dedup_key(kind, ref) = f"{kind}:{ref}"` **由代码派生**；库层 UNIQUE 保证"同一件事只排一次" | `suggestions.py:66-70` | 【逐字】 |
| SA-143 | 三种 kind 枚举与 `_V14` CHECK 同源；`standing_grant` 今日无写者 | `suggestions.py:38-40`, `store.py:2224` | 【逐字】 |
| SA-144 | `PERMISSION_MARKERS` 21 项词表；**往宽了判**（假阳性代价 = 多问一句） | `suggestions.py:44-59`, `:73-78` | 【逐字】 |
| SA-145 | 入队条件：release 需 `cooldown_count>2 ∧ 未建议过`；permission 需 `is_permission_boundary(conclusion)` | `focus.py:588`, `:695` | 【逐字】 |
| SA-146 | 入队后结论**照常走影子期**，两条路互不相干（硬约束 2） | `focus.py:585-587`, `suggestions.py:166-170` | 【逐字】 |
| SA-147 | 血缘失败**不回滚入队**，只落 telemetry | `suggestions.py:102-119` | 【逐字】 |
| SA-148 | 问询节律三值全按周期序号：`ASK_TTL_CYCLES=7` / `DECLINE_COOLDOWN_CYCLES=30` / `EXPIRE_COOLDOWN_CYCLES=10` | `suggestion_conversation.py:43-49` | 【逐字】 |
| SA-149 | 七个 status；过期结算最先；至多一条未决问询；空队列**零副作用零 LLM 零消息** | `suggestion_conversation.py:157-232` | 【逐字】 |
| SA-150 | 四条 S3 姿态：先发后记 / 记失败要撤回 / 不递归 / 三消息切分；`reply_to=None` 照常吃打扰预算；**不为撤回开后门** | `suggestion_conversation.py:23-38`, `:213-225` | 【逐字】 |
| SA-151 | owner context 只来自 `mind_store.owner_channel_key`；**无硬编码 chat id、无 env 后门** | `suggestion_conversation.py:129-136` | 【逐字】 |
| SA-152 | 接受产物 = 一段给 root 会话看的执行说明（`STAGED_TEMPLATE`），不是补丁不是待执行动作不经 guardian | `suggestions.py:189-229` | 【逐字】 |
| SA-153 | 每周期至多问 1 条由"节律本身"保证：只在闸开了之后驱动 | `autonomous.py:371-373`, `:380-386` | 【逐字】 |

### SA-154 .. SA-166 · persona / 身份 / 编排

| # | 语义 | file:line | 档 |
|---|---|---|---|
| SA-154 | `build_persona_kernel` 是内核唯一装配点；确定性、路径无关；九段拼装含全角 `（）。` | `config.py:172-206` | 【逐字】 |
| SA-155 | 时变内容（restart notice / notes / insights）**不属于内核**，由调用方围绕它叠加 | `config.py:180-181` | 【逐字】 |
| SA-156 | `load_persona` fail-fast 严格校验五 section；`get_persona` 进程级缓存，改 TOML 需重启 | `config.py:111-169` | 【逐字】 |
| SA-157 | v1 单层自我；persona-v2 的 audience 分叉点在 `build_persona_kernel` | `config.py:180-184` | 【等价】 |
| SA-158 | `build_persona_prompt` 白名单 = `persona` + `preference` 两类；非空前置 `"\n\n"`；全空返空串 | `memory/persona.py:18-28` | 【逐字】 |
| SA-159 | 后天 insights **同样注入自主路径**（修复旧不对称：独处的她和聊天的她是同一个人） | `decide.py:20-22`, `:303-305` | 【逐字】 |
| SA-160 | `build_organ_block` 进程级缓存；空清单 → None；`invalidate` 零读 | `organs.py:162-186` | 【等价】 |
| SA-161 | 器官清单四禁：不写 channel_key / secrets 永不进 / 不读活规则 / 时效健康不进 | `organs.py:25-34`, `:80-83`, `:120-122` | 【逐字】 |
| SA-162 | `render_restart_notice`：notes **无分隔符 `"".join`**，外裹 `[…]`，空 event → `""` | `restart.py:239-246` | 【逐字】 |
| SA-163 | restart notes 三句模板 + downtime 四档人话（≥1 天只报天数） | `restart.py:176-185`, `:104-111` | 【逐字】 |
| SA-164 | 读不到的线索**省略,绝不编造**；非 PRODUCTION 时制下 downtime 恒 None | `restart.py:13`, `:74-76` | 【逐字】 |
| SA-165 | 自主侧只在**重启后第一拍**浮出 restart（`unprocessed_restart_event` 用严格大于比较） | `restart.py:224-236`, `snapshot.py:363-365` | 【逐字】 |
| SA-166 | 种子幂等的强形态：**曾经存在过的 seed title（含 released）永不重种** | `mind/seed.py:3-6`, `:24` | 【逐字】 |
| SA-167 | `SEED_INITIAL_WEIGHT = 0.5`；描述固定为"先天兴趣种子(来自人格 TOML)" | `mind/seed.py:17`, `:36` | 【逐字】 |
| SA-168 | `memory/seed.SEEDS` 只一条 preference；身份不再作 insight 播种（会重复内核） | `memory/seed.py:3-17` | 【逐字】 |
| SA-169 | wake 六阶段顺序不可重排（仲裁 → 记账 → maintain → 推演 → execute → inner → 收尾） | `autonomous.py:167-251` | 【逐字】 |
| SA-170 | 一拍失败被完整接住：写 failed run + next_wake + **`bump_wakes_since`** + `autonomy_wake_failed` | `autonomous.py:214-222` | 【逐字】 |
| SA-171 | 整合与专注在 wake 之后串行驱动，且**只在 `status=="completed"` 时**；各自吞掉一切异常 | `autonomous.py:328-335`, `:342-388` | 【逐字】 |
| SA-172 | 三条 origin 归因：`ORIGIN_AUTONOMOUS_WAKE` / `_INTEGRATE` / `_FOCUS`（判据⑧） | `llm_router.py:37-39`, `autonomous.py:112`, `integrator.py:509`, `focus.py:271` | 【逐字】 |
| SA-173 | 关切地板 `FLOOR_N=2` / `FLOOR_BIRTH_WEIGHT=0.25`；**create-only 永不释放**；计数只算 `(active,dimming)` 排除 dormant | `floor.py:38-41`, `:90-132` | 【逐字】 |
| SA-174 | 地板候选优先序：open/suspended 线 → 显著叙事 → 三条通用模板；按已 ENGAGED 的 floor title 去重 | `floor.py:51-87`, `:102-116` | 【逐字】 |
| SA-175 | 念头容量软拒 `THOUGHT_OPEN_CAP=7`；charge 不严格大于最低者即拒；挤掉时**同事务**写 abandoned + thought_lapse | `thoughts.py:65-135` | 【逐字】 |
| SA-176 | `settle_thought` 仅整合路径可调（红线 #3，静态扫描钉死）；仅 resolved→absorbed | `thoughts.py:174-202` | 【逐字】 |
| SA-177 | 念头衰减一拍一次；跌破 `ABANDON_THRESHOLD=0.15` → abandoned + thought_lapse（salience 0.2），原子 | `thoughts.py:293-325`, `regulation.py:84`, `:86` | 【逐字】 |

**总计 SA-01 .. SA-177（177 条）** —— 超出工单预估 60–100 条，因逐字契约面比预估宽（reflow 七支、CAUSES 15 条、L4/L5 门阶梯各自独立可验证）。每条均可独立验证：断言语句 + file:line 一一对应。

---

### DA- 缺陷 / 已定改法条目（单列）

| # | 事项 | 现状 file:line | 定案 / 改法 | 标注 |
|---|---|---|---|---|
| **DA-01** | reflow 的 `queue_notification` 是 `else` 兜底分支，任何新增而未加分支的 kind 会**默默变成一条发给 Kevin 的通知** —— contemplate 曾踩此坑（107/107 进入动作尝试，18 条成了真通知） | `reflow.py:238` | 【建议】新体改为 `elif kind == "queue_notification"` + `else: raise/log_event` 显式未知 kind。语义等价（今日七 kind 全覆盖），但把静默误路由变成大声失败 | [事实(缺陷) + 建议] |
| **DA-02** | **D-CB-1 发言权收回**：模型不再拥有"我想 N 分钟后再醒"，节律全归心跳件 | 现状：`decide.py:266`（prompt 含该字段）、`decide.py:585,598`、`autonomous.py:63-69,213`；心跳件仍是影子件 `autonomous.py:304-320` | 定案（`heartbeat.py` 顶注逐字）：心跳件接管后**不读** `decision.next_wake_after_minutes`，也不把 `next_wake_at` 当输入；只把 `last_wake_at` 当开机对照读数。新体应：① 从 `DECIDE_SYSTEM_PROMPT` 移除该字段（**prompt sha256 因此必变**）；② 移除 `Decision.next_wake_after_minutes` 与 `clamp_rest` 的决策链；③ 心跳件转正（基线 30 / 地板 5 / 显著性 N=3） | 【DA / 已定改法按新版】 |
| **DA-03** | **D-CB-3 层1/2 节律锚 wake 计数 → 墙钟** | 现状：`integrator.INTEGRATION_EVERY_WAKES=24`（`integrator.py:45`）+ `focus.FOCUS_EVERY_WAKES` 派生（`focus.py:59`）+ 双计数器（`store.py:1517-1541`） | `heartbeat.py` 顶注逐字：*"层1/层2 的节律锚从 wake 计数迁到墙钟是已拍板方向,但迁移属独立单 —— 本模块不碰 `integration_state` / `learning_layer_state`"*。新体按墙

钟锚实现，但**必须保留 §5·L4 的一条例外**：影子期结算（SHADOW_PERIOD_CYCLES）按**周期序号**，不按墙钟（`focus.py:729-733` 逐字理由：一台停机三周的机器不该因为墙上的钟走了三周就把结论放行）。DA-03 迁移的是**触发锚**，不是影子门。 【DA / 已定改法按新版】

| # | 事项 | 现状 file:line | 定案 / 改法 | 标注 |
|---|---|---|---|---|
| **DA-04** | `next_wake_after_minutes` 的类型闸**未排除 bool**：`isinstance(minutes, int)` 对 `True/False` 为真（Python bool ⊂ int）。同文件的 `_opt_int`(`decide.py:376`)、`_gated_int`、`_sanitize_inner` 的 resolve/charge 三处都**显式**写了 `not isinstance(v, bool)` —— 唯独此处漏了 | `decide.py:598` | 实际影响有界：`True` → 1 → `clamp_rest` 提到 5 分钟（下限），`False` → 0 → 同样提到 5 分钟。所以后果是"最短拍"而非崩溃。若 DA-02 落地，此字段整体消失，缺陷随之消失；若新体保留该字段，应补 `and not isinstance(minutes, bool)` 与同模块其余三处对齐 | [事实(缺陷) + 建议] |
| **DA-05** | `concern_lit_unfollowed` 只在 `kind in ("rest","record_note")` 触发（`reflow.py:258`）。**`contemplate` 与 `tend_inner` 不在其中** —— 但两者同样是"点亮了关切却没有向外追"的拍。`contemplate` 是 WO-P4R-09 之后才有的 kind，这行判据写于其前 | `reflow.py:257-259` | 【建议，非已定案】两种读法都自洽：① 判据本意是"没花行动预算的拍"→ 应补 contemplate/tend_inner；② 判据本意是"没有向内也没有向外推进的拍"→ contemplate/tend_inner 确实推进了内部，不该记 unfollowed。**本报告不替 owner 定案**，但新体移植时必须显式选一种并写下理由，不得沿袭"因为新 kind 出现得晚而漏掉"这个非理由 | [事实(不一致) + 建议] |
| **DA-06** | `budget_multiplier`（load>0.7 时 0.5）只在快照里**呈现**给她（`snapshot.py:158` → `预算.预算系数`），在副本内**未找到任何执行点** —— `HOURLY_ACTION_CAP` 的判定（`autonomous.py:126-127`、`snapshot.py:155`）都用裸的 20，不乘系数 | `regulation.py:198`, `snapshot.py:158` | 这与 `VARIABLES["load"].outlet_doc` 声明的"高于 0.7:唤醒预算减半"不符：**声明了因果出口，实际只有展示**。`registry_problems()` 抓不到它 —— 它只验证 effect 值会随变量变化，不验证有没有消费方。【建议】新体二选一：① 真接上（`HOURLY_ACTION_CAP * budget_multiplier`）；② 从 outlet_effects 摘掉并改 outlet_doc。宪法说"没有因果出口的状态是装饰",一个只被打印不被执行的出口是同一类问题的变体 | [事实(疑似装饰出口) + 建议] |
| **DA-07** | 器官清单 `build_organ_block` 在 `mind/decide.build_messages` 中**未被调用** —— 器官块今天只在对话路径。自主侧的她不知道自己长着什么 | `decide.py:291-314`（无调用）、`organs.py:162` | 这与 `decide.py:20-22` 明写的修复方向（"修复旧不对称:独处的她和聊天的她是同一个人"）同源 —— 后天 insights 的不对称已修，器官清单的还没。【建议】新体在 build_messages 里比照 `acquired` 的写法加一段（非空才注入）。注意这会改变自主侧 messages 的字节形状，需同步更新任何钉字节的测试 | [事实(残余不对称) + 建议] |
| **DA-08** | `R-CA-1` 双护栏（已实现，本条记录其为**必迁的定案**而非缺陷） | `autonomous.py:254-281`（`_due` fail-closed + 自愈）、`autonomous.py:283-297`（`_beat_floor_open` 拍间隔地板） | 两条独立刹车，必须**串联**（`autonomous.py:322`：`if self._due(...) and self._beat_floor_open():`）。(a) 脏 `next_wake_at` 从 fail-open 改 **fail-closed + 自愈**：解析失败时重写为 `now + DEFAULT_REST_MIN` 并落 `autonomy_next_wake_unparseable`（幂等，报警不重复）；`None`（开机头一回）仍 → True，"那不是脏值,那是还没定过"。(b) 地板 = 既有 `MIN_REST_MIN`，**不新设阈值**，因 `clamp_rest` 下限同值 → 正常节律下 `_due` 为真时地板一定已开，**对活体节律零扰动**（由 `test_the_floor_never_binds_on_the_normal_cadence` 钉死）。根因见 SA-56/§3.2：rest/contemplate/record_note/tend_inner 都不计 `counts["action"]`，所以一串 rest 决定可每 5 秒烧一次 LLM 而永不撞 `HOURLY_ACTION_CAP`（C-A §2.3 风险 B） | 【逐字 / 已定案，必迁】 |
| **DA-09** | `D-CB-2` —— 工单点名的三条定案之一，**在只读副本中未找到任何逐字出处**。`D-CB-1` 见 `heartbeat.py` 顶注、`D-CB-3` 见同处末段，`D-CB-2` 两处皆无，全树 grep 亦无 | — | 【缺件】不臆造其内容。新体开工前须由 owner 提供 D-CB-2 原文；本报告不以推断填补 | [事实(缺件)] |
| **DA-10** | 快照劈分的**下半程（步 4 并行推演切分）未实现** | `snapshot.py:328` 说明动机；`tests/test_cb_deliberation_zero_write.py` 守门员已立 | 现状：`read()` 的纯读性已成立、断言已就位，但"取一份快照分发给 N 个分支推演"这件事本身在 HEAD 上不存在。【建议】新体若要做，`read()` 纯读是唯一前提，且必须由等价断言（全库逻辑摘要 + 对照组）守住，否则退化风险不可见 | [事实 + 建议] |
| **DA-11** | 副本缺件与工单预告不符 | — | 工单预告"副本缺 5 个 0600 不可读 .py（R2c 产物）"；实测 `find -perm 600` 与 `! -readable` 均空集。**唯一确证缺件是生产 persona TOML**（owner 域）。因此 §6 中 `build_persona_kernel` / 两处身份守卫的 sha256 均为 **fixture 口径**，活体值须在有 TOML 的环境重算 | [事实(缺件订正)] |

---

## 交付自检

| success_criteria | 状态 |
|---|---|
| 七节齐 | ✅ §1–§7 全部输出 |
| 断言带 file:line | ✅ 全部条目锚定到 `模块:行号`；SA 总表 177 条逐条带位 |
| [事实]/[推断]/[建议] 标注 | ✅ 缺件、疑似缺陷、不一致处逐一标注；无出处者一律不臆造（DA-09） |
| 全部 prompt 有 sha256 | ✅ 14 项见 §6.6 汇总表；三项**不可哈希**（投影/派生文本）已说明理由，两项 fixture 口径已标注缺件 |
| §7 逐条可独立验证 | ✅ 每条 = 一句断言 + 一处 file:line，无跨条依赖 |
| 纪律 | ✅ 零写入活体树、未碰 `/home/lykoi/`、未读 state/secrets、未跑 pytest、全程前台串行、无后台任务 |

**移植优先级提示（非工单要求，一句话）**：SA 总表中标【逐字】的 148 条里，风险最高的三处是 —— ① `regulation.CAUSES` 15 条 delta 与其单写者纪律（SA-74/75，数值一散落即失去可校准性）；② `Decision.as_dict()` 的五值 drop-list（SA-04，字节级契约，破坏后审计流静默变形）；③ reflow 的 `else` 兜底（DA-01，静默误路由已实证造成 18 条真通知）。