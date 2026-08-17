# WO-U2 · 心智入场(想/说统一 U 系列第三单;含 CACHE-INVERT 同刀落地)

你是执行 Agent,在 `~/lykoi-work-l1` 工作。
**分支 `wo/u2` 已由治理侧建好(尖 `b0a0e593` = 活体 main),直接 `git checkout wo/u2`,不要自己建分支。**
铁律:一切命令**前台串行**执行,禁止后台(&)、禁止 sleep 等待、禁止"稍后继续"式收尾;
每判据一 commit(提交注释 `[WO-U2]` 前缀);测试一律 `timeout 1800` 包裹;
**stdout 即报告本体,不要把报告写成文件**;禁止用摘要代替明细,宁长勿略。
侦查发现与工单冲突时,停下写清楚,不要自作主张改口径。
白皮书在 `~/wo/WO-U2/whitepaper_v1.1.md`——**§8(人格分层可区分性)与 §26.2
(最小上下文/发送内容可见性)是硬边界**,涉及人格头/上下文块的判断以它为准。

## 背景(已核实的事实,可直接引用)

- `cognition/conversation.py` `_assemble`(:559 起)现行顺序:人格头(内核+纪律
  +acquired,:375-383 经 `memory/persona.py::build_persona_prompt`)→ 自我叙事
  (:585)→ 早前对话摘要(:591)→ **[念头](:602)→ [当前时间](:611,分钟粒度
  每轮必变)→ self-state(:617-624)** → 对话历史。易变块卡在历史之前,前缀缓存
  从时间块起全 miss。usage 基线(2026-08-13):main 路由命中率 **48%**,
  prompt/次 8.1k,completion/次 104。**目标:重排后 main 命中率 ≥70%,
  completion/次不显著变化。**
- `mind/relevance.py::retrieve_for_concern(concern, *, limit, since, until)`
  (:59):纯函数零 LLM,只认 dict 形状 `{title, description, subject_user_id}`
  不认来源,检索域=全部 experiences,按相关性降序。这就是 L3 检索入口,禁止另造。
- `mind/focus.py`:insights 走影子期门(`status='shadow'` → 存续 S 周期未
  contested 转 `active`);**`store.promoted_focus_insights()` 是给下游消费者
  预留的读口,至今零调用者**——本单接上它。
- `mind/integrator.py::run_integration`(:536)是 nightly 消化入口。
- 窗口:`CONTEXT_WINDOW_TURNS = 30`(conversation.py:59,env
  `LYKOI_CONTEXT_WINDOW_TURNS` 可覆盖)。
- Kevin 已拍板的决策(D1-D5,2026-08-17):时延 <15s;短近窗 8 轮;v1 不加
  小模型预检索;影子双跑适用 U3 非本单;器官清单 = identity_bindings + 设备
  注册 + 动作能力表,secrets 永不进。

## 判据

① **前缀重排(CACHE-INVERT 本体)**:`_assemble` 重排为
   〔稳定前缀:人格头 → 器官清单(判据②新增)→ 自我叙事 → 早前对话摘要〕→
   〔对话历史〕→〔易变尾部:相关记忆(判据③新增)→ 念头 → 当前时间 →
   self-state〕→ 生成点。**除本单新增块外,内容集合不变、只动顺序**
   (§26.2 自动无损)。尾部块继续用 system 角色还是其他形态,先查 DeepSeek
   对 messages 尾部 system 消息的处理惯例(离线依据:仓内既有代码/注释/文档,
   不要求实测 API),在报告里写明依据再定。
② **器官清单块(D5 定界)**:新建生成模块(落点与层次边界你定并自证,倾向
   `cognition/` 或 `memory/`;若落六目录内记得判据⑩),从 identity_bindings
   (`kernel/scope.py`、`mind/store.py`)+ 设备注册(`resources/telegram_device.py`
   等)+ 动作能力表(`kernel/approval.py::_capability` 邻域)**代码派生**一段
   只读文本块〔器官清单(只读)〕:她有哪些身份绑定、哪些设备/通道、哪些动作
   能力。**secrets/token/密钥路径永不进清单**(键名都不出现)。清单内容静态
   (每进程构建一次),放稳定前缀。器官的"时效/健康"(如感知通道最后事件
   时刻)**不进静态清单**;若你能从既有登记处/账本廉价读到,并入 self-state
   易变块;做不到就在报告写明留给 U3,不算失败。
③ **L3 检索入场**:每轮以来话构造探针
   `{title: 消息文本(截断 ≤200 字), description: "", subject_user_id: 对话者
   user_id}` 调 `retrieve_for_concern(limit=6)`,结果渲染为〔相关记忆(跨时间;
   只读)〕块进易变尾部;每条渲染限一行摘要(时刻+来源+≤80 字),整块增量
   概算 ≤2k tokens。**命中为空不加块**。禁止为此新增任何 LLM 调用(D3)。
④ **活跃关切入场**:从 concerns 既有读口取活跃关切渲染〔活跃关切(只读)〕块,
   上限 5 条(标题+一行描述)。放稳定段还是易变尾部,依它的实际变化频率定并
   在报告自证(日级→稳定段末尾,轮级→尾部)。
⑤ **转正洞见入场(L4 下游第一个消费者)**:`build_persona_prompt()` 的 acquired
   层(或叙事块——落点依 §8 人格分层自证,二选一写明理由)纳入
   `store.promoted_focus_insights()` 的产出。**只消费 active/promoted;
   shadow/contested/revised/withdrawn 永不入上下文**(影子门语义,配反向测试)。
⑥ **整合边界刷新**:nightly `run_integration` 成功完成后,失效并重建**对话路径**
   的稳定前缀(人格头/器官清单/洞见的进程内缓存失效钩子)——计划内全量 miss
   ≤1 次/天,换人格新鲜度。**decide 路径(`mind/decide.py`)的上下文组装一行
   都不动**——它是 usage 对照组;两路径 acquired 排序不一致这事留 U3,本单不修。
⑦ **转录窗按 D2**:`CONTEXT_WINDOW_TURNS` 默认 30 → **8**(env 覆盖保留);
   确认软窗摘要机制在 8 轮下正常接力(掉出窗口的轮次先进摘要再丢,已有语义,
   补 8 轮口径的测试);更早的对话由摘要+L3 检索承担。
⑧ **零扰动与结构守恒**:a) 器官清单/L3/关切/洞见四个新块各自空态时不注入
   (空块=零字节差);b) 一条结构测试断言重排后 `_assemble` 的**块集合**与
   重排前一致(仅顺序不同、新增块除外),防内容漂移;c) 四新块全空 + 同输入时,
   除顺序外逐块内容与今天一致(同 WO-U1 判据③口径)。
⑨ **每判据配测试;全邻接前台串行**:conversation 邻接**先列后跑**(同
   WO-FIX-APPROVAL-UX / WO-U1 的 21 文件口径,列表原样进报告)+
   `test_l3_relevance*` + L4 focus 读侧套件 + `test_l2_intake`(nightly 钩子
   邻接)+ persona / self_state 套件 + `test_telegram_device` /
   `test_telegram_transport` + `test_messenger` + **`tests/test_gate5_l1_scan.py`
   (全局门,永远进清单;凡新代码读时钟先想 `shared/clock`,确需裸读必打
   `# realtime-allow: <理由>` 尾注)** + `tests/test_p0_integrity.py`(重签后)。
   已知基线:活体全量 3 failed / 1852 passed(2026-08-13 权威值);以 claude
   身份另有 `approval_rules.json` 0600 假失败,不是你造成的,报告里逐条归因即可。
⑩ **manifest 重签**:改动/新增落在 `cognition/mind/memory/shared/surface/
   resources` 六目录内的每个 .py 都要同步 `guardian/manifest.sha256`(改哈希+
   新增条目),重签前后条数写明(现 107)。**新增任何"落在 state 目录的路径
   常量",同一提交必须补 `tests/conftest.py` 默认表**(教训 36,静态守卫
   `test_no_state_path_constant_points_at_the_live_state_dir` 必须绿)。
⑪ **报告(stdout 本体)**,必须包含:每判据实现说明+自证;组装顺序前后对照
   (两列清单);尾部角色决定的依据;器官清单样例输出(脱敏后原样);L3 块
   渲染样例;全邻接清单原样+每条结果逐条归因;manifest 前后条数;新增
   env/路径常量全集;新增文件全集(路径+属主预期)。

## forbidden

不动 `mind/decide.py` 的上下文组装(对照组);不动 kernel 问答机(S3/L5 的
reply_to 先行拦截);不动传输层与长轮询(U0 领地);不新增 LLM 调用;
shadow/contested 洞见不入任何上下文;secrets/token 不入任何新块;
approval_rules 相关永无写路径;不改 `CONTEXT_BACKFILL_ROWS` 语义(治理回填
不是活窗);不做自动重发;不碰 `guardian/` 与 `src/lykoi/core/`(封存边界,
属主是 root 你也写不了);凡与本单口径冲突的侦查发现,停下写清楚。
