# WO-U3-FIX 执行报告 · 影子信封解析失败修复

分支 `wo/u3fix`,尖 `1b8ef063`,基座 `a923c44e`(活体 HEAD,未改写)。五个 commit,每判据一个。

```
1b8ef063 [WO-U3-FIX] 判据⑥: manifest 重签 (110 -> 110, 三条改哈希) + 新增 env 全集
52b741f4 [WO-U3-FIX] 判据④: 零扰动 —— U3 判据⑧ 四条口径逐条复验
188f5c9e [WO-U3-FIX] 判据③: 契约强化 —— 直接点破会话惯性, 给她想说的话一个去处
094b9598 [WO-U3-FIX] 判据②: JSON 强制模式接线 —— response_format 透传 + 影子路启用
45d6ef76 [WO-U3-FIX] 判据①: 影子失败可观测 —— 一个 ValueError 拆成六个有名字的原因
a923c44e [WO-U3] 判据⑩: manifest 重签 (108 -> 110) + conftest 默认表(教训 36)
```

```
 guardian/manifest.sha256                  |   6 +-
 src/lykoi/cognition/conversation_cycle.py | 175 +++++++++++++++-
 src/lykoi/cognition/llm_client.py         |  17 +-
 src/lykoi/cognition/llm_router.py         |  46 ++++-
 tests/conftest.py                         |   8 +
 tests/test_u3_conversation_cycle.py       |   4 +
 tests/test_u3fix_contract_hardening.py    | 113 +++++++++++
 tests/test_u3fix_failure_observability.py | 323 ++++++++++++++++++++++++++++++
 tests/test_u3fix_json_mode.py             | 243 ++++++++++++++++++++++
 tests/test_u3fix_zero_disturbance.py      | 226 +++++++++++++++++++++
 10 files changed, 1152 insertions(+), 9 deletions(-)
```

kernel 零改动(工单预期成立,没有任何一处非动不可)。`src/lykoi/core/` 零改动。`guardian/` 只动了 `manifest.sha256` —— 见下文判据⑥ 的口径说明。

---

## 判据①:失败可观测

`u3_shadow_failed` 从两栏变四栏,`error_type` / `elapsed_ms` **原样保留**(加栏不换栏,下游已有读法不动):

```json
{
  "event": "u3_shadow_failed",
  "error_type": "ValueError",
  "elapsed_ms": 4180,
  "reason": "not_json",
  "detail": "first_char:cjk"
}
```

### 字段样例(**构造的,非真实对话**)

```
  她直接开口说话                    reason=not_json            detail=first_char:cjk
  英文开场白                        reason=not_json            detail=first_char:ascii_alpha
  空 content (json mode 边角)       reason=not_json            detail=first_char:empty
  代码块围栏                        reason=not_json            detail=first_char:fence
  截断的 JSON                       reason=not_json            detail=first_char:brace
  合法 JSON 但不是对象              reason=no_decision_object  detail=top_level:not_object
  没有 decision 键                  reason=no_decision_object  detail=decision:missing
  decision 类型不对                 reason=no_decision_object  detail=decision:type:str
  kind 近失手                       reason=unknown_kind        detail=kind:respond
  kind 大小写错                     reason=unknown_kind        detail=kind:REPLY
  自主表的 kind 漏过来              reason=unknown_kind        detail=kind:rest
  kind 是一整句话                   reason=unknown_kind        detail=kind:unrecognized:len21
  reply 缺 content                  reason=missing_content     detail=kind:reply:content:missing
  promise_followup 空白 content     reason=missing_content     detail=kind:promise_followup:content:blank
  超时 (wait_for)                   reason=other               detail=timeout
  提供方挂了                        reason=other               detail=none
```

### 做法:结构复验,不是异常文本匹配

`classify_failure(exc, message)`(`conversation_cycle.py:383`)拿到那份响应,按 `evaluate_message` 的原顺序把四道关重走一遍,第一道过不去的就是原因。不去匹配 ValueError 的消息串,两个理由:那三条消息是 `mind/decide.py` 的实现细节(`:330` `:566` `:574` `:582`),谁改一个字这里就**静默失准**;而且它们本来就带着模型文本 —— `_extract_json` 的消息里有响应前 200 字,正是不该进日志的东西。

复验用的 `_extract_json` 是**同一个函数**(只读调用),所以归因器与解析器不会出现两处真相。代价是归因跟着解析器的真实行为走而不是跟着直觉走,这恰恰是对的:响应 `"42"` 是**合法 JSON**、只是不是对象,所以归 `no_decision_object` 而不是 `not_json`;一段话里夹着一个 JSON 对象会被 `_extract_json` 捞出来,捞出来之后照结构归因。两条边界各有用例。

### detail 的隐私口径(沿 U3 影子事件同一纪律,且更严)

detail 只能是模板的组合。她的回复原文、对话内容、工具参数、URL —— 一个字都不进。守卫用例三条:整段回复进响应时事件里只有一个 `first_char:cjk` 且字段集恰好是四个;把一段散文塞进 `kind`,断言事件里找不到它的任何片段;八种样例的 detail 长度上界 48、单行、无换行。

**与工单口径的一处偏离(严格加强,请追认):** 工单写"unknown_kind 记 kind 值截 ≤20 字"。这里做的是不截断、只做二选一 —— 整值 ≤20 字原样记(近失手 `REPLY` / `回复` / `reply ` 正是要看的东西,它们都短),超过 20 字只记长度 `kind:unrecognized:lenN`。理由:截断会把**一句话的前 20 字**落进 `events.jsonl`,一个把回复正文塞进 `kind` 的模型就这样泄了内容;这个写法保证任何时候都不会,同时"≤20 字"这条上界也严格成立。

### `pulse_invalid`:工单列了它,但当前代码不可达 —— 停下写清楚

侦查结论:今天**没有任何路径**会因为脉冲而失败。`sanitize_pulse`(`conversation_cycle.py:233`)与 `sanitize_tool`(`:206`)都声明"永不抛",形状不对的脉冲被静静丢掉,周期照常成立。所以归因器里那一支的触发条件是"四道结构关全过、却仍然抛了 ValueError,且脉冲字段形状不对",在当前代码下不可达。

我没有为了凑满枚举去改护栏的松紧(判据③ 明令不放宽任何护栏)。两条用例把这件事说全:一条证明坏脉冲今天**不是失败**(record 不为 None,落成功事件,`pulse == []`),一条用 monkeypatch 让消毒器抛出来,证明那一支确实接得上,是给未来会抛的消毒器留的位置。**如果 owner 的本意是"坏脉冲应当算失败",那是一次护栏变更,不在本单口径内,需要另行下单。**

### 两本账不许混

护栏 demote **不走失败分支**。它是一次成功的周期,落在 `u3_shadow_envelope` 里带 `demoted` / `demote_why` / `original_kind`。首夜那"1 个合法信封"正是被 demote 掉的那一个 —— 混了账,34+1 就会变成 35 条契约失败,修复方向直接被带偏。两条用例分别从成功侧和失败侧钉住。

### 失败分支是终点

`classify_failure` 自己套了一层 try,任何内部异常降级成 `(other, classifier_error)`。用例把 `_first_char_class` 换成会除零的函数,断言降级而不是抛出。

---

## 判据②:JSON 强制模式接线

工单的侦查发现属实并已复核:`llm_client` / `llm_router` 在本单之前**没有任何 response_format 支持**,整棵树 grep 零命中。首夜那 34 连败发生在一条从未启用过 json mode 的路上。

### 形态

```
ModelConfig.response_format: dict | None = None      # llm_client.py:58   路由级默认
chat_completion(..., response_format=None)           # llm_client.py:98   调用级覆盖
llm_router.complete(..., response_format=None)       # llm_router.py:188  原样转发
```

payload 写法与既有的 `max_tokens` / `temperature` / `thinking` 一致,加在最后,只有 `effective_format is not None` 时才写键(`llm_client.py:128-130`)。选 `dict` 而不是 bool,是因为这是 OpenAI 兼容协议里的一个**对象**(`json_object` / `json_schema` / `text`);传输层不该知道"json mode"是什么意思,它只负责把路由配好的那个对象原样转发 —— 与 `llm_client` 模块头"新 provider 只是一个新 ModelConfig,不是一个新 client"的既有口径同源。

### 「不传时逐字节等于今天」的自证

不是靠读代码,是三条用例打在**线上的字节**上(MockTransport 抓真实请求体):

- `test_a_route_without_response_format_ships_no_such_key` —— 把 main 形态的 ModelConfig 发一次,断言 payload **逐键等于**一个写死的字面量。不是只看 `response_format` 在不在,后者挡不住"顺手改了 max_tokens"这类事。
- `test_the_response_format_key_is_the_only_difference` —— 同一份配置带与不带各发一次,pop 掉那个键之后两个 payload 逐字节相同。
- `test_no_other_route_gained_a_response_format` —— main / vision / autonomous_cognition 三条路 `cfg.response_format is None`。

四个 builder 里只有 `_conversation_shadow_config` 多了一行(`llm_router.py:162`),另外三个一个字节没动。

### 开关

`LYKOI_U3_SHADOW_JSON_MODE`,生产默认**开**(`llm_router.py:79`)。留 kill switch 是因为 json mode 会改变提供方的采样行为 —— 万一它把信封**质量**压坏(能解析了但决定变差),关掉就回到今天的形态,不必回滚代码。读在调用点,改 env + 重启生效。九条 parametrize 覆盖取值口径,一条钉住关掉时影子路的模型/凭据/上界/thinking 全不动。

`_bool_env` 在 `llm_router` 里**抄**了一份 `conversation_cycle._env_flag` 的取值口径而不是 import:`conversation_cycle` 导入的是 `llm_router`,反向 import 会闭合一个循环。

### DeepSeek 两个已知边角,都测了

- **prompt 须含 "json" 字样** —— 契约本来就写着"只输出一个 JSON 对象"。`test_the_envelope_contract_contains_the_word_json` 保证以后改契约措辞的人不会顺手把那个词删掉,从而以 400 的形态把整条影子路一次打死(那种死法在判据① 的账上会落成 `other`,最难查的那一类)。
- **偶发空 content** —— 按 `not_json` 落账,**不特判、不重试**。三条用例覆盖 `content=""` / `content=None` / 连 content 键都没有,全落成 `reason=not_json, detail=first_char:empty`;另有一条断言只调了一次 `complete`。判据① 的 `first_char:empty` 这一栏因此不是摆设:它正是把"提供方给了个空壳"与"她开口说话了"分开的那一格。

端到端一条:`run_shadow → complete → chat_completion → MockTransport`,断言真实请求体里有 `response_format` 且 messages 含 "json"。中间任何一环把参数掉在地上,这条就红。

---

## 判据③:契约强化

`ENVELOPE_SYSTEM_PROMPT` 末尾追加(契约总长 1960 字符):

```
最后一件事,它压过上面这段对话给你的所有惯性:
**这一轮不要以对话的口吻直接回答。**上面是一段正在进行的对话,你会很自然地
想接着说下去 —— 这一次不要。你想对他说的那句话,原原本本放进
decision.content 字段里;它照样会送到他那里,一个字都不少。
所以你这次的输出从 `{` 开始、到 `}` 结束,中间没有任何一句对他说的话、没有
开场白、没有"好的"、没有代码块围栏、没有解释你为什么这么填。
只有那一个 JSON 对象。
```

三点用意:**点名那个惯性本身**(契约开头已经说过一遍"只输出 JSON",34 连败说明再说一遍没用);**给那句话一个去处并说明它不会丢**(如果她的惯性里有一份"不回等于晾着他"的压力 —— 那正是人格里该有的 —— 单说"不要回话"是在跟这份压力对撞);**反着列出失败形态**(开场白 / "好的" / 代码块围栏 / 解释,正是 `_first_char_class` 里 `ascii_alpha` / `cjk` / `fence` 三格对应的样子,由一条用例把两边钉在一起)。

**不放宽任何护栏。** 契约变宽和护栏变松是两件事,本单只做前者。一条用例四面都验:四张表原样;不引用评估条目的非 silence 决定仍降级成 silence 且 `demote_why == "reason_not_grounded"`;没注入过的念头 id 仍被丢掉;`reply` 缺 content 仍抛 ValueError,不是补个空串放行。另有两条守追加没挤掉既有内容(回执背书三条硬约束原样在;`{causes}` 占位符仍被替换)。

---

## 判据④:零扰动

本单动的三个生产文件里有两个(`llm_router` / `llm_client`)是**所有路由共用**的,所以"零扰动"这次有新的攻击面:`response_format` 加在 `ModelConfig` 上,而 main 与 autonomous_cognition 都用 `ModelConfig`。U3 判据⑧ 四条口径逐条复验(12 条用例,`tests/test_u3fix_zero_disturbance.py`):

| 口径 | 复验 |
| --- | --- |
| 自主路径解析器/护栏 | `_extract_json` 是只读复用;KINDS / CONTENT_REQUIRED_KINDS / SAFE_KIND 三张表逐条比对;`Decision.envelope` 在自主路径仍恒为 `{}` 并被 `as_dict` 过滤 |
| main / autonomous 路由配置 | `response_format is None`,且 `thinking` / `max_tokens` 既有默认值(disabled / 4096 / 2048)逐个比对 —— 光验新字段不够,要验"我加字段时没顺手碰别的";`_CONFIGS` 仍是四条路 |
| 零副作用 / 零写路径 | 禁调表(与 U3 判据⑧ 同一张、同一 AST 写法)照旧为空;归因器纯函数(跑两遍恒等);归因器不改被复验的 message |
| 失败静默 | 仍只调一次 complete;仍不抛;`error_type`/`elapsed_ms` 保留且字段集恰好四个;`u3_shadow_envelope` 的 23 个字段**一栏都没动**且没混进 reason/detail(三天影子数据的口径不能中途变形,否则前后两段不可比) |

活体面的四条(main payload 逐字节相同 / 回复相同 / 影子不调 `_assemble` / send 不等影子)由既有的 `test_u3_shadow_zero_disturbance` 原样守着 —— 那个文件本单**一个字没改**,24 条全过,这本身就是零扰动的一部分自证。

---

## 判据⑤:测试

**全量**(基线 1982 / 3 / 6,2026-08-18 复核权威值):

```
3 failed, 2077 passed, 6 skipped in 3383.74s (0:56:23)

FAILED tests/test_core_v1_shadow.py::test_secret_params_are_rejected_before_shadow_and_result_is_redacted
FAILED tests/test_core_v1_shadow.py::test_redacted_dictionary_key_collisions_preserve_every_value
FAILED tests/test_p0_integrity.py::test_committed_manifest_matches_available_protected_sources
```

失败三条**逐条对上基线**:redaction ×2 + claude 身份的 p0 假失败(PermissionError 读不到 owner 域 `/home/lykoi/state/approval_rules.json`)。**新增失败 0。** 通过数 1982 → 2077,`+95` = 本单新增用例数,一条不多一条不少。skipped 6 → 6。

**⑤ 点名的邻接集**(39 文件:conversation 23 文件口径 + `llm_router`/`llm_client` 邻接 + decide/autonomous 套件 + telegram 套件 + `test_gate5_l1_scan` + `test_p0_integrity` + 本单四个新文件),改动前后各跑一遍:

```
改动前   1 failed, 543 passed, 5 skipped in 1026.62s
改动后   1 failed, 638 passed, 5 skipped in  933.92s     (+95, 同一条已知失败)
```

新增用例分布:`failure_observability` 49 / `json_mode` 27 / `contract_hardening` 7 / `zero_disturbance` 12 = 95。

**一处执行口径要说明:** 铁律要求前台串行。测试**是**串行的 —— 三次运行彼此不重叠,期间没有并行任何别的工作。但工具的前台通道有 600 秒硬上限,而这三次分别是 17 / 16 / 56 分钟,超时后被工具自身移出前台通道。这是工具约束,不是我选择了后台调度;每次都是发起后阻塞等待其结束才继续。

---

## 判据⑥:manifest 重签

**110 → 110**,条数不变 —— 本单没有新增受保护源,三个改动文件本来就都在表里:

```
src/lykoi/cognition/conversation_cycle.py   45a4e6d8… -> 96216e71…
src/lykoi/cognition/llm_client.py           6570f0db… -> 9fdf7cff…
src/lykoi/cognition/llm_router.py           1d6466f6… -> 63f80b78…
```

新增 0,删除 0,顺序未动(重写脚本里两条 assert:条数恒为 110、键序逐条相同)。

`--write-manifest` 在本工作机上依旧跑不完(要哈希 owner 域 0600 的 `approval_rules.json`,claude 身份读不到就 PermissionError 中止,与那条基线失败同源)。沿 `a923c44e` / WO-U2 `67adbd11` 的先例:只逐行同步本次改动的三个源文件,那一行读不到的锚原样保留。另跑一遍与 `test_committed_manifest_matches_available_protected_sources` 同逻辑、但跳过读不到路径的核对:

```
受保护源 110 个 | 逐条核对通过 109 | 缺条目 0 | 哈希不符 0 | 读不到 1
manifest 条数 110 | 多余条目 0
读不到(原样保留): /home/lykoi/state/approval_rules.json (PermissionError)
```

**forbidden 与判据⑥ 的表面冲突:** forbidden 写"不碰 guardian/",判据⑥ 要求 manifest 重签,而 manifest 就在 `guardian/` 下。沿 `a923c44e` 与 WO-U2 `67adbd11` 的先例读作:forbidden 指 guardian 的**代码与策略核**,`manifest.sha256` 是那套代码的输出物,由判据⑥ 明文授权。`guardian/*.py` 与 `src/lykoi/core/` 一个字节没动。

### 新增 env 全集

**落在 state 目录的路径常量:零。** 影子的唯一出口仍是既有的 `events.jsonl`;判据① 加的是那条事件的两个字段,不是一本新账。静态守卫 `test_no_state_path_constant_points_at_the_live_state_dir` 不受影响。

**新增 env 键 1 个:**

```
LYKOI_U3_SHADOW_JSON_MODE   影子路 JSON 强制模式   生产默认 开
```

conftest 默认表补 `"1"`(教训 36 口径)。取值与 `LYKOI_U3_SHADOW_ENABLED=0` 相反,理由写在表里:它的作用面只有 `conversation_shadow` 一条路的 payload,另外三个 builder 根本不读它,所以它不像 SHADOW_ENABLED 那样会顺带驱动别人的用例;列进表是为了让"生产默认值改了"不会悄悄改掉测试里的请求形状。生产默认值另由 `test_shadow_json_mode_defaults_open_but_is_killable` 钉住(先 delenv 才看得到真默认)。

WO-U3 的 7 个 env 键取值与默认**全部照旧**。本单之后影子相关 env 全集 8 个。

---

## 判据⑦:插桩点、部署核对、根因推断

### 插桩点与部署核对

**哪个进程:只有 `lykoi-server`(uvicorn)。**

`Conversation` 在整棵树里只有一个构造点 —— `src/lykoi/surface/app.py:139`。影子挂在 `Conversation.send` 的收尾(`conversation.py:710-722`,fire-and-forget 进 `_SHADOW_TASKS`),它读的快照由 `_completion` 在本轮第一次装配时留下(`conversation.py:1560-1561`)。`lykoi-telegram` 是 HTTP 客户端,自己不构造 Conversation;`lykoi-autonomy` 走 `lykoi.cognition.autonomous`,完全另一条路。所以本单三个判据的插桩全部生效于 `lykoi-server` 一个进程,重启面只有它。

**要不要新 env 进 unit:不要 —— 与工单预期一致。**

`lykoi-server.service` 只有两条 `Environment=`(PYTHONUNBUFFERED / PYTHONPATH)和两条 `EnvironmentFile=`(`llm.env` / `surface.env`),**没有任何 `LYKOI_U3_*`**。WO-U3 的 `LYKOI_U3_SHADOW_ENABLED` 就是靠代码默认值开着的,同一先例:`LYKOI_U3_SHADOW_JSON_MODE` 默认开,部署时 unit 与 env 文件都不必动。真要关掉它,才需要往 `llm.env` 加一行 —— 那是 kill switch 的用法,不是常规部署的一步。

`ExecStartPre=startup_verify.py` 会在启动时核 manifest,所以判据⑥ 的重签是这次部署的**必要条件**:不重签,`lykoi-server` 起不来。

### 我基于代码对 34 连败根因的推断

先说清楚这是**推断**,靠的是代码结构和对照组,不是首夜的分项数据 —— 分项数据正是判据① 交付的东西,今天还不存在。

**对照组落在同一个解析器上,所以解析器不是变量。** 自主路径 `autonomous_cognition` 用的是同一个 `evaluate_message`(`decide.py:529`)和同一个 `_extract_json`(`decide.py:319`),常年正常。这一点很硬:它把"契约写得不够清楚""解析器太严"这两条都排除掉了 —— 同一份严格程度在另一个情境里天天通过。

**差别在生成点前面那一段,而且是两个可分辨的差别:**

其一,**上下文性质**。自主路径由 `build_messages` 装配(`decide.py:302-314`):人格头 + 习得人格 + `DECIDE_SYSTEM_PROMPT` + 可选 self-state,最后一条是 **user 角色的快照 JSON**(`:313`)。模型看到的最后一样东西是一段结构化数据,于是接着输出结构化数据。对话情境走 `build_envelope_messages`(`conversation_cycle.py:209`):U2 三段带原样 + 契约追加在**末尾**,而三段带是 1500+ tokens 的自然对话历史,末尾紧挨着的是他刚说的那句话。模型在那个位置上最自然的动作就是接着说下去。这正是治理侧的会话惯性假设,我认为代码支持它。

其二,这里补一条工单没提、但我认为同等重要的:**契约是一条尾置的 `system` 消息**。自主路径的 `DECIDE_SYSTEM_PROMPT` 在**头部**(`decide.py:306`),对话情境的信封契约在**尾部**(`conversation_cycle.py:209`)。指令微调的训练分布里 system 几乎总在最前,一条跟在长对话之后的 system 消息是分布外的位置,注意力权重天然弱 —— 这会**放大**惯性效应,而不是与它竞争。尾置是 WO-U3 的刻意选择(理由写在 `build_envelope_messages` 的文档里:放中间会顶掉 U2 理顺的缓存边界),本单没有动它,因为动它的代价是 U2 的验收面。

**为什么我认为判据② 是这三个判据里最可能起作用的那个:** 判据③ 是在同一个弱位置上把话说得更重 —— 如果失效原因是位置而非措辞,它未必够。判据② 不依赖模型对哪条 system 消息的服从程度:`response_format: json_object` 是提供方在**解码层**的约束,与提示词在上下文里的位置无关。所以真正的止血在②,③ 是同向的第二层。

**这一切都要靠判据① 的读数证实,今天不要下结论。** 重新部署后该看的是:

- `not_json/first_char:cjk` 与 `first_char:ascii_alpha` 那两格塌下去 → 惯性假设成立,②(和/或③)管用;
- 那两格还在 → 惯性假设本身要重估;
- `first_char:brace` 涨起来 → 完全另一个病(以 `{` 开头却解析不出来,多半是 max_tokens 截断,影子路默认 4096,信封不该到得了);
- `unknown_kind` 那一堆涨起来 → 她开始输出 JSON 了但用错了词表,那是契约措辞问题,判据③ 的方向对但话没说对;
- `other/none` 涨起来 → 提供方拒了(最可能是 json mode 的 prompt-含-json 约束被破坏),那条路有专门的用例守着,但线上要靠这一格才看得见。

**本单交付的是能回答这个问题的仪表 + 一次针对性的施加,不是一个已经验证的修复。** 切换与否仍以三天影子数据为准。

---

## 需要 owner 追认的两条

1. **`pulse_invalid` 在当前代码下不可达。** 工单把它列进枚举,但今天没有任何路径会因为脉冲而失败(`sanitize_pulse` 永不抛,坏脉冲被静静丢掉)。我把它实现成"给未来会抛的消毒器留的位置"并测了两面,没有为了凑满枚举去改护栏。若本意是"坏脉冲应当算失败",那是一次护栏变更,需要另行下单。
2. **`unknown_kind` 的 detail 做了严格加强**:不截断,整值 ≤20 字才原样记,超过只记长度。比工单的"截 ≤20 字"更严,理由是截断会把一句话的前 20 字落进日志。

## forbidden 自查

不动 main/autonomous_cognition 的行为与默认值 ✓(三条用例逐键比对 payload 与配置);kernel 零改动 ✓;`guardian/` 除 manifest 外零改动、`src/lykoi/core/` 零改动 ✓;影子的零副作用性质未改 ✓(禁调表仍为空,`u3_shadow_envelope` 23 字段未动);她的回复原文/对话内容不入任何日志字段 ✓(三条隐私守卫用例);`approval_rules` 无写路径 ✓;secrets 不入块与日志 ✓(`other` 的 detail 只记粗粒度标签,不记 `str(exc)` —— httpx 异常文本里有 URL)。
