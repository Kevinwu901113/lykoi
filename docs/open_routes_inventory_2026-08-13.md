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
| 5 感知服务器侧 | percept_buffer + ingest + 保留期作业 | ✅ 代码在(`mind/percept_buffer.py`、ingest 端点带 token 门)——但见 C1,**上游断着** |
| 6 群聊语境 | 读路径 + 三级脱敏 + 引用审计 | ❌ 未做(活体无 group_chat 代码);白皮书 5.4/12 的 [PLANNED] 同源 |

## C. 断了没人管的(已建成但当前不工作)

- **C1 · Mac 感知全线静默**:`~/lykoi/perception/config.json` 的 endpoint 仍是
  `http://127.0.0.1:8799/ingest/environment`(本地 mock),而 8799 无人监听;
  launchd 里**没有** perception 服务(只有 backup-pull),M1A 的安装套件建好了
  但从未 load。→ **WO-MAC-UPLINK-01 的工单还躺在仓里没派**(只有 order.md),
  服务器 v0.3 协定与 WO-MAC-PERC-03 也都是空目录。
  她的"眼睛"从 8 月 9 日改造后就没睁开过。
- **C2 · 服务器日备份两天没产物**:最新归档 `20260811T201701Z`,8-12、8-13 空缺;
  且 daily.log 末行是 `offsite skipped: rsync target unreachable`(异地腿自 8-07 死)。
  Mac 拉取腿今天两次 FAILED(rc=255)是今天断网所致,可自愈;但**产物本身停更**要查。
- **C3 · salience 影子期**:放行条件 ≥14 天 + 全局吸收率 ≥5%(phase5 prereg §4)。
  计时起点与当前吸收率需读 sidecar 才知道,**没人在看这个钟**。

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

## E. 已完成、不必再挂账(核对用)

学习层 v2 全链(L1–L5)、对话审批环(S1A/S1B/S2/S3 + FIX-UX)、U0 传输加固、
U1 送达回灌、OBS-LLM usage 四数、备份 13 项 + 恢复演练、SEC 系列、P2-03A broker、
M1a(Mac 独立感知服务套件,**建成未启用**——见 C1)。
