# Lykoi 基线审查与资产清点 · 总汇报告

- **日期**：2026-08-07
- **依据**：《Lykoi 技术白皮书 v1.1》第 31 章（Baseline Review and Asset Inventory）
- **基线**：`~/projects/lykoi` main@8a613a1e（已核实运行代码与审计基线一致）
- **执行方式**：主治理 Agent（Mac）直接清点 + 服务器执行 Agent 五张工单（WO-BASE-01/02/03/04/05），全部经主治理 Agent 复核
- **产物位置**：本仓库 `wo/`（工单原文、报告、复核记录）、`reports/`
- **状态**：**阶段 0 完成**。白皮书 31.3 要求的产物除"数据迁移风险"外均已具备（见 §7）

---

## 1. 结论摘要

Lykoi 不是概念项目，是一个**已在生产运行、治理层扎实、认知闭环成立、但学习链路断裂**的系统。

三句话概括：

1. **治理骨架是真的。** Guardian 完整性门、Dispatch 权限决策、审批队列、审计、root 属主的防篡改开关、启动时完整性校验——这些不是文档承诺，是运行中的代码，且设计意图清晰（watchdog 刻意只用标准库，"即使包或 venv 损坏也要能工作"）。
2. **学习链路是断的，而且系统自己知道。** 自主循环把观察写进 `autonomy_notes`，代码注释写明"晋升由 integrator 定期治理"，但那段代码不存在，血缘表也不存在。这条断链已被基线代码编码为诊断信号 `CV1-LRN-001`（severity high）。白皮书说人格成长是 [PARTIAL]，物理原因就在这里。
3. **今晚之前，她的身份连续性资产处于单点风险。** 基础人格文件不在任何备份内；核心事实库、事件流、审计正本、权限证据同样不在；每日备份因锁冲突静默失败（7/28、8/1、8/6 三天全丢）；异地备份连续失败于一个不存在的目标。**已修复并验证**（§4）。

---

## 2. 资产清点结果

### 2.1 代码资产（WO-BASE-01）
8 个包 + guardian + scripts，85 个源文件，29,030 行；109 个测试文件；51+ 环境变量；125 个 markdown 文档，无顶层 ARCHITECTURE.md。依赖无环。无确认的死代码（模块级）。

### 2.2 运行资产
9 个 lykoi-* systemd 服务（core / server / autonomy / watchdog / chrome / xvfb / fluxbox / vnc / novnc）；四进程主体 + Guardian watchdog；全部端口绑 loopback（8080 surface、9222 CDP、5900 VNC、6080 noVNC）；cron 两项（notify_push 每分钟、offsite_backup 每日 04:17）；部署体系为 staged-apply——`/usr/local/sbin` 下 17 个 root 属主 apply 控制器（M2→R3a，7/13–8/2）+ `lykoi-admin`。宿主是 Proxmox VM（persona 配置 `embodiment = "lapwing-home VM (vmid 110)"`）。模型栈 deepseek-v4-flash（主）+ mimo-v2.5（视觉）。

### 2.3 数据资产（WO-BASE-05）
4 个 SQLite + 3 个 append-only JSONL + 11 个 JSON/锁/游标 + 2 个目录，分布在 `/home/lykoi/state`、`/home/lykoi/runtime`、`/var/log/lykoi-audit` **三个根**。`memory.db` 一个文件承载 20 张表，13 类身份资产中 8 类落在它身上。

**复核补充的资产位置**（清点时未覆盖，现补入）：`/var/lib/lykoi-attention-policy/`（注意力策略，带 SHA256 锁定）、`/etc/lykoi-core-v1-m2/{server,autonomy}.env`（root 0444）。

### 2.4 遗迹资产
`~/quarantine`（7/13–8/1 R1C/R2A/R2B/R2C 部署战役全套：bundle 10+、root_apply 脚本 8、执行日志、Untitled-1..5 等）、`~/staging-core-v1-m3-r1a1`、`~` 根下散装 bundle 与脚本。**建议保留至阶段 2 决策完成**（它们是部署史的唯一记录），之后归档压缩。

### 2.5 Mac 侧资产
core-v1-repo @ `codex/core-v1-m3-event-ingress`（8/2，**比服务器 main 新，未部署**）、percept-02-mac-repo @ `codex/mac-memory-fuse-20260729`、server-integration-repo；三仓库工作区干净。旧 maceye 采集器在 `~/Desktop/lykoi-mac-eye`，launchd 未加载（休眠），去留待定。

---

## 3. 风险清单（全部经代码级验证）

### 3.1 安全（三条实锤，详见 `reports/security-gaps-verified_2026-08-07.md`）

| # | 缺口 | 严重度 | 证据要点 |
| --- | --- | --- | --- |
| S1 | **事件日志不脱敏** | 高 | `shared/log.py` 的 `log_event()` 原样落盘；`redact` 全库仅 3 处调用，全在 `kernel/dispatch.py`——只保护返回给认知层的观测，不保护磁盘 |
| S2 | **持久浏览器无 SSRF 防护** | 高 | `resources/browser.py` navigate 直传 CDP；对照 `research_browser.py` 有完整防护（仅 http/https、要求解析结果全为公网、堵住 `::ffff:127.0.0.1` 映射）。两者防护等级悬殊，且 Chrome 与核心同用户运行 |
| S3 | **截图路径未校验** | 中 | `LYKOI_SCREENSHOT_DIR` 未走路径闸门，是"Protected Paths 声明未强制"的实例 |
| S4 | **Secret 明文** | 高 | 无 vault/句柄机制；密钥经 `EnvironmentFile` 注入进程环境，同 uid 进程读 `/proc/<pid>/environ` 即得全部密钥——**他们自己的 canary 脚本就是这么读的**；轮换需改文件 + 重启两个 unit |
| S5 | **完整性清单漏 `src/lykoi/memory/`** | 中 | `guardian/startup_verify.py` 的 manifest 覆盖 5 个包，独漏 memory——而那 4 个文件含 `insights` 表唯一写入点 |

### 3.2 连续性

| # | 问题 | 状态 |
| --- | --- | --- |
| C1 | 备份锁冲突静默失败、零字节残骸、异地目标不存在 | **已修复**（WO-FIX-BACKUP-01） |
| C2 | 备份只覆盖 2 个文件，persona/核心事实/事件流/审计正本全在外 | **已修复**（WO-FIX-BACKUP-02，待合并生效） |
| C3 | 无恢复演练、无恢复脚本 | **未解决**，建议阶段 1 补 |
| C4 | 滚动摘要是纯进程内属性，重启即丢 | 未解决 |
| C5 | 部分有界队列静默逐出（notifications、chat_outbox、research_browser） | 未解决 |

### 3.3 人格连续性

| # | 问题 | 证据 |
| --- | --- | --- |
| P1 | **Insight 晋升链缺失** | `integrator.py` 从不调用 `upsert_insight`；`note_insight_links` 表在 schema 中不存在；运行期唯一写 insights 的是启动播种（SEEDS 仅 1 条）。系统自诊断信号 `CV1-LRN-001` |
| P2 | Owner Edit 记录零生产调用者 | `mind/store.py` 有定义，全仓非测试调用者为 0 |
| P3 | 自主动作 CWD = 代码仓库根 | `lykoi-autonomy.service` 的 `WorkingDirectory=/home/lykoi/projects/lykoi`，`terminal.exec` 不设 cwd。仓库根曾出现的 `P`（HTML 存档）与 `|`（cookie 罐）即此产物 |

### 3.4 扩展性

- **`user_id` 全库出现 0 次**——多用户/群成员不是加字段，是数据模型与鉴权模型的单主体假设。
- **Delegation Gateway 无挂载点**——`kernel/dispatch.py:227` 的 `_RESOURCES` 为 5 项硬编码字典；`DispatchContext` 只有 `origin` + `run_id`，无委托主体、子代理身份、隔离域。
- **程序性学习被显式钉死**——`core/shadow.py:263` `CHECK(evaluation_kind='unassessed_legacy')`、`:281 CHECK(proposal_ref IS NULL)`：结构预留，数据库约束禁止填入真实评估。
- 单例阻碍点：`surface/app.py:128` 进程级 `Conversation()`；shared 层四个全局单文件台账。
- `core/shadow.py` 单文件 4,685 行（全库 16%），最大单点债务。

---

## 4. 本轮已完成的修复

| 工单 | 内容 | 状态 |
| --- | --- | --- |
| WO-FIX-BACKUP-01 | sqlite busy timeout + 3 次重试、失败清残骸并记 FAILED、git/rsync 可达性预检、残骸清理扩展名覆盖 | 已验收，**待合并** |
| WO-FIX-BACKUP-02 | 备份覆盖 2 项 → **12 项**：新增 core_facts、permission_evidence、events.jsonl、审计正本（/var/log）、approval_rules、pending_actions、core_artifacts(tar.gz)、**persona TOML**、治理开关存在性快照 | 已验收（含一轮补正），**待合并** |
| Mac 拉取备份 | launchd `com.lykoi.backup-pull` 每 6 小时 + 登录时从服务器拉 `state/backups/`，落 `~/lykoi/backups/server-state`；rc=24 判成功 | **已生效**，首次 48MB 落地 |

实跑验证：单次备份约 4.3 MB，7 份滚动稳态约 30 MB；persona 2761 B 内容校验通过；审计正本 1500 行入备份；治理开关如期只记清单不 sudo。

**待 Kevin 执行的合并**：

    ssh lapw1ng.com 'cd ~/projects/lykoi && git checkout main && git merge --no-ff task/wo-fix-backup-01 task/wo-fix-backup-02 -m "[WO-FIX-BACKUP-01/02] merge: backup hardening + coverage expansion"'

---

## 5. 模块三分类（WO-BASE-04，经复核修正）

- **可保留**：kernel、guardian、resources、shared、memory
- **待重构**：surface、cognition、mind、scripts
- **不适用"可删除"**：`core/`。执行 Agent 依仓内 unit 文件判定其为 default-off 死代码（占全库 40.6%），**复核用 `systemctl cat` 查线上 drop-in 后推翻**：M3 开关几乎全开（core 上 6 个、server 上 4 个、autonomy 上 2 个）。core 是**运行中、以 shadow/观测模式为主的未完工线**，臃肿但活着。

> **方法论教训（已写入工单模板）**：治理工作副本是代码事实源，**不是部署事实源**。"是否启用"必须查 drop-in；执行 Agent 无 sudo，此类核实由主治理 Agent 补。

---

## 6. 阶段 1/2 建议

**阶段 1（高风险修复，建议顺序）**

1. C3 恢复演练 + 恢复脚本——备份已修好，但"能恢复"尚未验证过一次。这是唯一还没闭环的连续性风险。
2. S1 日志脱敏（改动小、收益直接）。
3. S2 持久浏览器 SSRF——现成方案：把 `research_browser._guard` 提为共享模块复用。
4. S5 完整性清单补 memory 包。
5. S4 Secret 收紧（工程量最大，可与阶段 2 的架构设计一并规划）。
6. P3 自主动作 CWD 隔离到工作区（小改动，止住污染代码仓库）。

**阶段 2（专项设计，白皮书 36 章留白的兑现）**

- 数据模型设计：`user_id` 与语境作用域、感知数据类、程序性经验结构一次性进 Schema——三者都要动同一批表，分开做会返工。
- Delegation Gateway 设计：从 `DispatchContext` 扩展入手；**我们的工单机制已是 Gateway 的活原型**（任务合同 = order.md、验证平面 = 复核、审计 = governance-ops.jsonl、隔离 = claude 账户 + 独立工作副本），设计可从跑通的机制泛化而非纸上发明。
- P1 学习链路：`autonomy_notes → insights` 晋升 + 血缘表，并解开 `shadow.py` 的两个 CHECK 约束。这是"人格可成长"从 [PARTIAL] 变 [IMPLEMENTED] 的关键路径。

---

## 7. 白皮书 31.3 产物对照

| 要求产物 | 状态 |
| --- | --- |
| 资产清单 | ✅ §2 + WO-BASE-01/05 |
| 当前架构图 | ✅ WO-BASE-02（组件图） |
| 数据流图 | ✅ WO-BASE-02（4 条） |
| 信任边界图 | ✅ WO-BASE-02 |
| 模块成熟度矩阵 | ✅ WO-BASE-04 |
| 安全风险清单 | ✅ §3.1 |
| 可保留/待重构/可删除清单 | ✅ §5 |
| 身份连续性资产清单 | ✅ WO-BASE-05（含 6 类不可再生资产） |
| 恢复与回滚基线 | ⚠️ 备份已修复，**恢复演练未做**（阶段 1 第 1 项） |
| 代码/活数据/部署版本一致性报告 | ✅ 运行代码 = main@8a613a1e = 审计基线；部署开关实况已核（§5） |
| **数据迁移风险** | ❌ **未产出**——依赖 §6 阶段 2 的数据模型设计，届时补 |

---

## 8. 遗留待办

| 项 | 责任方 |
| --- | --- |
| 合并两张备份工单分支 | Kevin |
| 恢复演练（阶段 1 第 1 项） | 待排 |
| 仓库根杂散文件 `P`、`|` 清理 + 自主 CWD 隔离 | 待排（同一个根因） |
| GitHub 部署密钥（治理账户 → GitHub，免 bundle 中转） | Kevin |
| Mac 侧 `sqlite3` 权限规则（本地备份 schema 检查被分类器拦） | Kevin |
| 白皮书随工单投放（执行 Agent 当前看不到正本） | 主治理 Agent，下一单起 |
| quarantine / staging / 散装 bundle 归档 | 阶段 2 决策后 |
