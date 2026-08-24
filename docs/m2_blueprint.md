# M2 心智移植蓝图 · 2026-08-24

M2 目标（总案 §4）：mind/cognition 心智构件逐插件迁入新体，语义保真；对话路径重建吸收
U3 缺陷。规格正本：治理仓库 `wo/WO-M2-SPEC-MIND/report.md`（SA-01..177 + DA-01..11）
+ `wo/WO-M0-SPEC-CONV/report.md`（S-01..86 + D-01..08）+ STATE-CONTRACT（C/R 系列）。
构建纪律沿用 m1_blueprint.md 纪律节，另加：**报告全文必须一次性输出**。

## 治理定案（预授权批复，构建 Agent 照此执行，不再各自判断）

| # | 事项 | 定案 |
|---|---|---|
| G-1 | DA-01 else 兜底 | 新体 `queue_notification` 用显式分支；未知 kind → 落审计 + 按 failed 处理，**永不默默变成通知** |
| G-2 | DA-02 / D-CB-1 | 按定案迁：`next_wake_after_minutes` 从 prompt 与 Decision 整体移除（sha256 相应重算并记录差异）；节律全归 lykoi-heart；DA-04 随之消失 |
| G-3 | DA-09 / D-CB-2 | 治理记录补正原文：**显著性源 = salience_shadow；Core attention_decisions 明确不接**（Kevin 2026-08-21 拍板）。heart 的 arouse 接 salience_shadow.db 读侧（M1 已留接口位） |
| G-4 | DA-03 / D-CB-3 | 层1/层2 触发锚迁**墙钟**（integrator 24h / focus 随派生），**但 L4 影子期结算保持周期序号**（SA-130 例外条款，逐字理由见报告） |
| G-5 | DA-05 | **维持现状**（仅 rest/record_note 记 `concern_lit_unfollowed`）。理由入注释：contemplate/tend_inner 确实推进了内部状态，不属"点亮未追"；此为治理按预授权定案，列 Kevin 追认清单 |
| G-6 | DA-06 | **接通**：新体行动预算判定用 `floor(HOURLY_ACTION_CAP × budget_multiplier)`，兑现 outlet_doc 声明；列追认清单 |
| G-7 | DA-07 | 修复不对称：器官块注入自主侧 messages（比照 acquired 写法，非空才注入） |
| G-8 | DA-08 / R-CA-1 | 双护栏语义并入 lykoi-heart（fail-closed+自愈 / 拍间隔地板=MIN_REST 5 分钟） |
| G-9 | DA-10 | 并行推演不入 M2（归期 5）；但"推演零写入"断言（SA-47/48 含对照组）M2 起就立 |
| G-10 | SPEC-CONV D-01..08 | 全部按修正版实现（D-01 有界重试+元数据、D-02 工具白名单入契约+枚举、D-03 demote 可观测、D-04 横幅不破坏沉默、D-06 已在 M1 落、D-07 投递线回 dispatch 带 E3 豁免类、D-08 事件流只记长度/哈希不记正文） |

## 验证方法（贯穿全部波次）

1. **prompt 对拍**：逐字迁的 prompt/模板与 SPEC 报告 sha256 逐一比对（G-2 触及的除外，重算并在报告记新旧值）。
2. **golden 对拍**：固定快照 JSON + 固定 LLM 回复 → 断言 decision dict 与 Python 版语义等价（demote/护栏/inner 各失败路径逐条红测）。
3. **写集对拍**：状态写走 lykoi-memory 写层，逻辑摘要（学 test_cb_deliberation_zero_write 的全库逐表 sha）断言每条路径的写集恰如规格。
4. **数据纪律**：golden devstate（`~/Documents/lykoi/lykoi-cordis-devstate/memory.db`）**永远只读**；写测试先把它复制进 os.tmpdir 再以 rw 打开；她的行内容零输出。

## 波次划分

**W1 · 状态写层与调节场**：lykoi-memory 增写层（rw 模式显式开启；C-01/02 事务纪律
BEGIN IMMEDIATE；append-only 触发器契约红测=试 UPDATE/DELETE 必被库拒；C-22 写侧沿用
各自旧格式）+ `lykoi-regulation`（纯函数：15 CAUSES 逐字/decay 双算法/八 effects/
registry_problems 移植）+ thoughts 写操作（容量软拒 SA-175/单向状态机/衰减 SA-177）。

**W2 · 快照与决策**：`lykoi-snapshot`（maintain/read 劈分版，SA-33..44）+
`lykoi-decide`（统一契约：kinds 参数化四词汇表 SA-23、demote/fail-closed 护栏、
inner 通道、build_candidates 全动态规则 SA-05..14 含 G-6、G-2 移除发言权、G-7 器官注入；
DECIDE_SYSTEM_PROMPT 逐字迁+按 G-2 重算 sha）。

**W3 · 回流与心脏转正**：`lykoi-reflow`（七 kind 逐支 SA-52..66 含 G-1/G-5、
cheap tick SA-67..72）+ heart 转正（G-2/G-8、G-3 接 salience_shadow 读侧、
tick 合并消费=错过 N 拍一次醒）+ wake 编排（六阶段顺序 SA-169..172）。

**W4 · 学习环**：L1 classify（SA-83..88）→ L2 integrator（SA-89..108 含叙事双门+
有界重试）→ L3 relevance（SA-109..116 逐字打分）→ L4 focus（SA-117..140 全套门）→
L5 suggestions（SA-141..153 铁律）。持 G-4 墙钟锚 + SA-130 例外。

**W5 · 身份与对话收口**：persona/organs/restart/种子（SA-154..168）+ converse
升级为真装配器+信封（SPEC-CONV S-23..S-53 + G-10 全部修正版）+ 端到端 golden 全链。

每波：治理复核（抽查 SA/S 条目对拍）→ commit 入库 → 下一波。W1–W2 可并行推进的部分
由治理侧裁量，缺省串行。

| G-11 | rest 候选 note 引用已移除的 next_wake 字段且含"5-360"手写副本漂移点（W2 新增 TODO#1） | 新文案：`load {CAUSES['rested'][1]:+.2f};下一拍由心脏节律决定`——随 G-2 同因，消灭死引用与漂移点；W3 落地，旧新文案入报告 |

## 追认清单（M2 收口版——**Kevin 2026-08-24 已批准全部七条**）

1. G-5（unfollowed 维持现状，治理理由=contemplate/tend_inner 推进内部状态）
2. G-6（budget_multiplier 接通）
3. G-11（rest note 改文案 `load -0.10;下一拍由心脏节律决定`，消灭死引用+漂移点）
4. G-2 prompt sha 变更：DECIDE 1634→1601（`a495848d…` → `d54726e3…`）
5. **ENVELOPE raw sha 变更（W5/G-10 出生修正恰两处：D-02① 工具白名单入契约 +
   D-03 降级后果一句）**：1677 `9d4f169e…` → 1748 `88587c8e…`；反向恢复测试钉
   "其余逐字"（恢复两处后 sha == 旧值）
6. 包改名 lykoi-converse-min → lykoi-converse（W5，蓝图授权+理由入报告）
7. G-4 墙钟锚落法读法：只迁触发锚（L2/L4），SA-127/121/148 周期算术保留、
   SA-130 影子期结算保周期序号（W4 报告 §G-4 节）

呈报同批：M2 收口遗留总账（W5 报告 §七，14 项全部归 M3）。
