# 已排未做清单 · 2026-08-13(只盘点,不开新路线)

口径:只收录**此前已在设计文档/工单/决议里排过**的事项。不含任何新构想。
状态以 2026-08-13 活体与仓库实测为准。

## A. 停在半路的(有单/有决议,已开工但没走完)

| # | 事项 | 出处 | 现状 |
|---|---|---|---|
| A1 | **U2 心智入场**(L3 检索 + 活跃关切 + 器官清单进对话上下文;转录窗按 D2 缩短) | 想/说统一设计 §4 | 未开工。D1–D5 五个决策点里 D2/D5 仍待你确认 |
| A2 | **U3 周期合一**(对话轮由 decide 驱动,conversation.py 退役,影子双跑 3 天) | 同上 | 未开工,序于 U2 |
| A3 | **U4 清理**(promise_followup→周期接力;sendPhoto 政策;假口供更正机制) | 同上 | 未开工 |
| A4 | **WO-CACHE-INVERT**(易变块后置,内容集合不变只动顺序) | 缓存计划 §3 | 未开工。基线已就位(main 48% / autonomous 30%,见 usage_baseline_2026-08-13),设计上与 U2 同刀 |
| A5 | **人格设计备忘**(insight 运行时写入链补全 + acquired 刷新时机 + 8 章版本化;倾向"整合边界刷新") | 缓存计划 §5 / 白皮书 8.5 [PLANNED] | 未开工。**它是 L4 洞见的下游出口**——她第一晚那条 insight 至今无人消费 |
| A6 | **WO-REWIRE-PROACTIVE**(接嘴) | 今日 | **在跑**(20:11 起) |

## B. 阶段 2 联合设计里没走完的步(§5 六步表)

| 步 | 内容 | 现状 |
|---|---|---|
| 1 数据模型 | migration + 血缘表 | ✅ 已完成(v11–v14) |
| 2 学习链路 | integrator 晋升作业(autonomy_notes→insights 带血缘) | ⚠️ **部分**:L4 走的是经验→insight 的血缘链,`autonomy_notes` 这条原料线仍未接 |
| 3 **Gateway 最小闭环** | contracts/receipts 表 + `delegation.*` 资源 + T1 Runner + broker handle | ❌ **未做**。只有 broker(P2-03A)落了;活体 resources/ 无 delegation。首个真实委托任务(lykoi-ui 小修)从未发生 |
| 4 shadow.db 解钉 | evaluation_kind 出现非 legacy 值、来源=收据 | ❌ 未做(`core/shadow.py` 仍 `CHECK(evaluation_kind='unassessed_legacy')`),依赖第 3 步 |
| 5 感知服务器侧 | percept_buffer + ingest + 保留期作业 | ❌ **代码是孤儿**(2026-08-13 实测):`mind/percept_buffer.py` 在 src 里**零调用者**,活体 `state/percept_buffer.db` 无 `percept_events` 表(从未初始化);真正在用的是旧路 `surface/perception.py` ingest v0.2 → `mind_store.record_environment_event`。协定 v0.3(activity_summary)与保留期作业均未做。上游又断(C1),整条感知线实际停摆 |
| 6 群聊语境 | 读路径 + 三级脱敏 + 引用审计 | ❌ 未做(活体无 group_chat 代码);白皮书 5.4/12 的 [PLANNED] 同源 |

## C. 断了没人管的(已建成但当前不工作)

> **2026-08-13 Kevin 决定:Mac app 要大重做,眼睛(感知线)先不做。**
> 受此冻结的条目:C1 全部、B 表第 5 步(感知服务器侧,含 v0.3 协定与 percept_buffer
> 孤儿模块)、F5 里三条 Mac 项(speech_locales 清理、M1A 措辞订正、TCC/token/退出
> 三件前置)、以及 D1 的 M1b —— **M1b 是"退役旧会面 UI",而大重做会连同它一起
> 重新决定,故 M1b 的门虽已过,不再单独执行,并入重做时处置**;其中"两个月对话
> 记录(chat_history.jsonl 203 条)必须留档不能删"这条数据纪律**随之带入重做**,
> 不因暂缓而失效。
> 不受冻结的:她"不知道自己瞎了"这件事本身(巩固平面 §7 身体自感知 / 器官清单),
> 那是服务器侧的事,归 U2。

- **C1 · Mac 感知全线静默**〔暂缓,待 Mac app 重做〕:`~/lykoi/perception/config.json` 的 endpoint 仍是
  `http://127.0.0.1:8799/ingest/environment`(本地 mock),而 8799 无人监听;
  launchd 里**没有** perception 服务(只有 backup-pull),M1A 的安装套件建好了
  但从未 load。→ **WO-MAC-UPLINK-01 的工单还躺在仓里没派**(只有 order.md),
  服务器 v0.3 协定与 WO-MAC-PERC-03 也都是空目录。
  **实测断点(2026-08-13 读数):最后一条 `source='environment'` 经验止于
  2026-08-05T09:21Z,近 7 天 0 条,历史累计 1180 条。**她的眼睛已经黑了 8 天,
  而且断点早于 8-09 具身转向 —— 不是改造弄断的,是改造之前就断了、改造之后
  没人发现。这正是巩固平面 §7"身体自感知"缺位的实证:她自己不知道瞎了,
  也没有任何一条路径会告诉她或告诉 Kevin。
- **C2 · 备份:本体健康,只有异地腿死**(2026-08-13 实测更正)。服务器日备份
  `offsite_backup.sh`(cron 04:17)正常出产物,最新 `20260812T201701Z`;
  daily.log 末行 `offsite skipped: rsync target unreachable` —— **异地腿自 8-07
  起持续 skip**(D2 待你定目标)。Mac 拉取腿今天两次 rc=255 是断网 DNS 失败,
  下次醒着自愈;我先前"产物停更两天"的判断源于 Mac 侧副本陈旧,**已作废**。
- **C3 · salience 影子期:两条门槛都远远超标,没人去申请放行**(2026-08-13 实测)。
  起点 2026-07-10,已跑 **34 天**(门槛 ≥14);selected 721、success 675,
  **吸收率 93.6%**(门槛 ≥5%)。按 prereg §4 启动顺序,现在该走第 ⑤ 步
  (Codex 放行门审计)→ ⑥ live。
  附带观察(不阻塞):93.6% 意味着"被选中的经验几乎总能被 nightly 吸收",
  奖励信号几乎恒正 —— bandit 学不到区分度。放行门审计时应一并看这个数是
  说明策略已足够好,还是说明 reward 锚太松。

## D. 挂着的门与待你拍板项(非工程)

- **D1 · M1b 门**(退役 Mac 会面 UI,约 2700 行):判据=Telegram 通道稳 ≥3 天
  (8-11 起算,已满)+ 对话审批走通 ≥1 次(8-12 已走通)。**门已过,活没开**。
  注意 M1b 含"两个月对话记录必须留档不能删"的数据迁移条款。
- **D2 · 异地 rsync 目标**:等你定(WO-FIX-BACKUP-04 候选,自 8-07 挂)。
- **D3 · 想/说设计的 D2/D5**:短近窗保留几轮、器官清单的登记处边界——U2 的前置。
- **D4 · 巩固平面 §7 的"身体自感知"**:她两段失语期(7/25–26、7/29–31)无人告警;
  设计里说她应能自己说"我这边出问题了"。这正是你今天点的第 1 点(社交工具认知)
  的同源需求,已排未做。
- **D5 · 巩固平面 §6 的道 C**(事后判断级)与第 5 项(显著性放行重估):道 B(L4)、
  道 D(L5)已上线,这两条还没排期。
- **D6 · scripts/patches/root_apply.sh 权限 0775→755**:小尾巴,需 root 侧动手。

## F0 · 已销账(2026-08-13 当日,治理侧直接补,不新开工单)

| 条目 | 出处 | 落点 |
|---|---|---|
| 权限位 0o755/0o775 噪音(11 用例) | WO-P2-01 复核 §五 | 合并包 9 · `wo/leftovers-02`;**已知基线失败 14 → 3** |
| S3 criterion 7 标题错位 | WO-S3 复核 §四 | 同上 |
| 灾难手册三处(bundle 无 HEAD / chattr / persona 0440 + flags 实况) | WO-DRILL-CLEANVM-01 差距 #1/#3/#4 | 同上 |
| 备份脚本吞 sqlite3 stderr | WO-FIX-BACKUP-01 §注记 1 | 同上(实测失败路径已给真实原因) |
| `root_apply.sh` 0775→755、`events.jsonl` 权限核实 | WO-FIX-APPROVAL-UX / WO-FIX-SEC-01 §5 | 合并包 8 第 E 步(root 一行) |
| 白皮书随工单投放、gate5 进必跑清单 | WO-BASE-04 §三 / WO-U0 遗留 1 | HANDOFF 教训 34 |
| "长连接中断则拆小工单" | WO-BASE-04 §三注记 4 | HANDOFF 教训 35:已由派发棘轮取代,条目关闭 |
| BASE-01 五项"待核实" | WO-BASE-01 §修正注记 3 | 全部核完,见 `wo/WO-BASE-01/verification_2026-08-13.md`;产出 1 个真缺陷(shadow fail-open)+ 2 处文档失真,均在合并包 10 |
| **合并包 8 当晚事故**:陈货被投给 Kevin | 本日实测 | 根因=测试卫生(conftest 缺游标默认值 + device 夹具没 patch);合并包 10 修 + 回归守卫。活体游标已是 42,不再复发 |
| 同类隔离缺口另两条 | 本日审计(101 个 `LYKOI_*`、28 处 state 路径常量) | `PROACTIVE_CHAT_LEDGER`(她的开口预算账本)与 `TELEGRAM_CURSOR`(入站游标)也缺默认值,已补;守卫改为静态扫描并通过变异测试 |
| JSONL 快照半截末行 | WO-FIX-BACKUP-02 §四注记 1 | 合并包 10:落地后剪半截行并记日志(此前只当"已知限制"写进手册)|
| `attachments.resolve()` 非字符串分支零覆盖 | BASE-01 核查 | 合并包 10:补进 `test_governance_invariants` |
| 环境变量清单"51 是下限" | WO-BASE-01 §修正注记 2 | 已重算:**101 个 `LYKOI_*`**,其中 28 处默认指向 `/home/lykoi/state`(全部已受守卫覆盖)|

## F. 工单复核里的「遗留」条目(全 45 单 32 份 review 通扫,2026-08-13)

**仍未认领 33 条 → 本日销掉 13 条,现存 20 条**(已被后续单吸收的 22 条、明确裁定不修的 3 条不列)。
按性价比排序,同类合并:

**F1 · 横跨全线的噪音源** 〔已销账,见 F0〕
- 权限位 `0o755` vs 磁盘 `0o775`:10 个 rollout 用例硬断言,自 `WO-P2-01/review.md`
  提出后**每一张单的全量都中招**(L1/L4/OBS-LLM/U0/U1 逐单复现),每次复核都要
  重新归因一次,还污染 gate5 类真信号。具体动作 = 工作克隆里 `chmod 755`
  (claude 无权,需权限侧)+ 让测试对两种模式宽容。

**F2 · 安全/部署缺口(4 条)**
- **SSRF 残余是孤儿项**:`WO-FIX-SEC-03` 自陈三项残余(新 popup/worker target 不
  覆盖、代理侧 DNS 无法由 URL guard 证明、CDP 重连窗口),原本承接的
  `WO-DESIGN-SEC-03` 被你取消后**没有指定新承接方**。
- **S4a 上线门四条活体验证从未做**(`/proc/<pid>/environ` 读不到 key、直连
  api.deepseek.com 被拒、经 handle 反代成功且有审计、合同过期票据失效)——
  当前只完成代码与单测层面。
- **broker 从未部署**:独立用户 `lykoi-broker`、service 单元(草稿 User 占位)、
  票据持久化(现内存,重启即失效)。
- `events.jsonl` 文件权限现状**至今未核实**(SEC-01 的待办 checkbox 未勾)。

**F3 · 备份/DR(剩 5 条,4 条已销账见 F0)**
- 备份失败告警**未接通知队列**(只落日志),RESTORE-01 复核重提过一次;
- `events.jsonl` 无轮转、单调增长(BASE-05 独立证实);
- 跨账户交付仍走 `/tmp` bundle(GitHub 部署密钥装上可改走 GitHub);
- 恢复演练**未纳入例行**(建议每月 cron + 每次大重构前);
- 真 VM 复跑过门待你定(演练跑在 LXD 容器,共享生产内核);
- 演练容器 `rehearsal` 与意外装上的 LXD snap 去留待你定。

**F4 · 学习层/认知(8 条)**
- `memory_scopes` **只有读侧没有写侧**(回填全 user_001、`create_concern` 不写
  作用域)→ §7.2 防自恋硬规则今天选择力弱;
- `standing_grant` 种类**无入队来源**(她还没有"这类事你总是批准"的观察机器);
- 建议问询与主动开口**共享每日 1 条预算**("想问"挤占"想说"),是否分池待数据;
- L2 观察期触发条件(K=30 重标)、层 2 两本账口径差(advanced vs no_progress)
  两个观察项**没人在读数**;
- v8 语义整备单未开(冻结点被两次止血);
- U1 展示条目同轮二次装配消失(U3 后自然消亡);未送达账本无自动重投(接嘴单
  已在 forbidden 里明确排除,属设计内)。

**F5 · 审批/流程/Mac(剩 5 条,其余销账或随 Mac 冻结)**
- 字面快通道只覆盖「执行」「不要」,「批准/同意」仍依赖 LLM——**扩不扩大字面集
  是你的行为决策**;
- Mac:`speech_locales` 应从 standalone schema 移除(一行,让"音频硬边界"字面为真)、
  M1A 报告措辞订正、**启用感知服务的三件前置**(TCC 两处打勾 / 服务器发 percept
  token + 写 Keychain / 首次 load 前确认 app 已退出)——正是 C1 断链的直接原因。

## E. 已完成、不必再挂账(核对用)

学习层 v2 全链(L1–L5)、对话审批环(S1A/S1B/S2/S3 + FIX-UX)、U0 传输加固、
U1 送达回灌、OBS-LLM usage 四数、备份 13 项 + 恢复演练、SEC 系列、P2-03A broker、
M1a(Mac 独立感知服务套件,**建成未启用**——见 C1)。
