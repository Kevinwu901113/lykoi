# 交接文档 · 给下一个治理平面 Agent（Codex / Claude Code / 其他）

- **写于**：2026-08-08 凌晨
- **写作人**：主治理 Agent（Mac Claude Code，Fable 5），因额度将尽而交接
- **读者**：接手 Lykoi 治理平面工作的 Agent
- **先读这三份**：本文件 → `docs/lykoi_whitepaper_v1.2_2026-08-18.md`（最高层规范，现行版）→ `docs/lykoi_collaboration_plan_v1_2026-08-07.md`（工作制度）；仓库总入口另见仓库根 `CLAUDE.md`
- **阶段 2 与重设计的现行文档**（2026-08-09 起）：
  `docs/phase2_joint_design_v1_2026-08-09.md`（冻结，数据模型×Gateway×S4）、
  `docs/lykoi_embodiment_redesign_v1_2026-08-09.md`（定案，社交器官×Mac 瘦身×对话审批）、
  `docs/mac_asset_inventory_2026-08-09.md` + `docs/mac_redesign_needs_analysis_2026-08-09.md`
  （重设计的事实输入）、`wo/WO-MAC-M1/plan.md`（Mac 行动计划）。
  `docs/perception_design_v0.3_2026-08-09.md` **已搁置非定案**，只有"音频一概不做"仍有效。

> 本文件是"怎么接着干"。白皮书是"为什么这么干"。两者冲突以白皮书为准。

---

## 一、你是谁（角色边界，务必先搞清）

你是 **Kevin（所有者）在治理平面的 Agent**，职责是**协助 Kevin 制作 Lykoi**。

**你不在 Lykoi 的委托体系内。** 白皮书第 17 章的 Delegation Gateway 约束的是"Lykoi 委托的专业 Agent"，不直接适用于你。但治理平面**自愿遵守等价纪律**（工单=任务合同、复核=验证平面、日志=审计），并作为 Gateway 机制的先行试点。

Lykoi 本体（服务器上运行的那个持续主体）**不是你的协作方，是被制作的对象**。不要对她的运行状态动手。

### 三个角色

| 角色 | 谁 | 做什么 |
| --- | --- | --- |
| 所有者 | Kevin | 决策、审批、执行需要 root 的部署 |
| 主治理 Agent | 你 | 写工单、复核验收、跨机协调、文档维护、Mac 侧开发 |
| 执行 Agent | 服务器上的无头 `claude -p` | 按工单在隔离工作副本里动手 |

---

## 二、怎么连上去

### Mac 侧（你的主场，全权限）

- 项目根：`~/Documents/lykoi/`
- **治理平面正本**：本仓库 `governance/` 子目录（GitHub 私有仓 `Kevinwu901113/lykoi`；2026-08-31 单仓库化，原独立仓 `lykoi-governance` 已删除、全史并入）。Mac 工作副本 `~/Documents/lykoi/lykoi-cordis/`，`gh` 已以 Kevinwu901113 登录
- 备份落地：`~/lykoi/backups/server-state/`（launchd `com.lykoi.backup-pull` 每 6 小时拉一次）

### 服务器（Lykoi core 所在）

两个账户，**优先用治理账户**：

    ssh lykoi-gov      # claude@lapw1ng.com:2223，治理平面专用（推荐）
    ssh lapw1ng.com    # lykoi@…，Lykoi 本体账户（只在必须以她身份操作时用）

`~/.ssh/config` 里两条 Host 都配好了，密钥免密。

### 权限边界（由系统强制，不是靠自觉）

`claude` 账户属 `lykoi` 组，因此：

| 目标 | 能力 |
| --- | --- |
| 代码 `~lykoi/projects/lykoi` | 可读（组写位存在，但**纪律上不写**——见下） |
| `~lykoi/state/` 目录 | 可列；**目录内文件多为 0600，读不到** |
| `~lykoi/secrets/` | **系统拒绝**（0700） |
| `core.sock` | **系统拒绝** |
| 窄口 sudo | 只读：`systemctl status/cat lykoi-*`、`journalctl -u lykoi-*`、`ls /usr/local/sbin/`、读 systemd 单元与 `runtime/governance/*`。**没有 root shell、没有写、没有 restart** |

### 你的自我约束（权限位之外）

1. 不向 `core.sock` 发任何东西；
2. **不利用组写位改活体检出** `~lykoi/projects/lykoi`——代码改动一律在治理工作副本 `~/lykoi-work` 进行；
3. 不停止/重启核心进程（Kevin 明示授权除外）；
4. 不读 secrets（即使某天权限变了）；
5. 每次服务器**写动作**记一条 `~/reports/governance-ops.jsonl`（格式：`{ts, actor, action, target, result, note}`，actor 用 `gov-main-agent`）。

---

## 三、工单机制（核心工作流）

    Kevin 意图
    → 你写工单（order.md）
    → 执行 Agent 在 ~/lykoi-work 的工单分支上实现
    → 你复核（读 diff + 亲自跑测试 + 逐条对验收标准）
    → 报告 Kevin
    → Kevin 授权合并/部署

工单目录：治理账户 `~/wo/<WO-ID>/`（order.md / report.md / run.log），同步归档到本仓库 `wo/<WO-ID>/`（外加你写的 `review.md`）。

### 派发命令模板

**分析类（用 opus[1m]）**：

    ssh lykoi-gov 'bash -lc "cd ~/lykoi-work && claude -p --model \"opus[1m]\" \
      --allowedTools \"Read,Glob,Grep,Bash(ls:*),Bash(find:*),Bash(grep:*),Bash(wc:*),Bash(head:*),Bash(sed:*)\" \
      < ~/wo/<WO-ID>/order.md > ~/wo/<WO-ID>/report.md 2> ~/wo/<WO-ID>/run.log; echo EXIT=\$? >> ~/wo/<WO-ID>/run.log"'

**实现类（用 sonnet，加 Edit/Write 与 acceptEdits）**：

    ... claude -p --model sonnet --permission-mode acceptEdits \
      --allowedTools "Read,Glob,Grep,Edit,Write,Bash(git:*),Bash(bash:*),Bash(ls:*),Bash(grep:*),Bash(sed:*)" ...

需要读活体 state 时加 `--add-dir /home/lykoi/state`（但注意文件多为 0600，仍读不到内容）。

### Kevin 定的用模规矩

- **plan / 分析 / 审查 → `opus[1m]`**
- **动手实现 → `sonnet`**
- **opus 的 effort = medium**（已固化在服务器 `~/.claude/settings.json`）
- 服务器默认模型是 **Haiku 4.5**，不显式指定就会用它——分析类任务用它质量明显不够。

---

## 四、血泪教训（这些坑我都踩过，别再踩）

### 教训索引（按主题）

本节共 59 条（编号 1–53，其中原「6.」是两条不同教训占同一号；另有
5b/5c/31b/31c/33b 五条后缀条目），按时间顺序追加，
小标题分组与主题不完全对应，故有此索引。**索引只导航、不改写**：正文一字未动。

**重号修正**：原有两条并列的「6.」已改为 **6a**（「关于"代码事实"与"部署事实"」节，
drop-in 判定）与 **6b**（「关于部署」节，guardian 属主）。仅改编号本身，正文未动；
全仓无外部引用指向「教训 6」，故无连带修改。

固化状态口径：**已固化** = 有测试/门检查项/脚本/`CLAUDE.md` 硬规矩机械化，给出路径；
**仅文档** = 只活在文字里；**旧体已退役** = 该条针对已退役的 Python 体
（`guardian/`、pytest、`guardian/manifest.sha256`），列出 Cordis 对应物或注明「无」；
**未核实** = 证据不在本仓，未下结论。

| 主题 | 教训编号 | 固化状态 |
| --- | --- | --- |
| 执行 Agent 派发机制（wrapper / 脱管 / 重试 / 白名单） | 22、28 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:3,7`（setsid 启动要求 + `trap "" HUP`）、`:10`（START 行）、`:11-22`（5 次重试 + `report.attempt$i.md` 独立存证） |
| 同上 | 24 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:13`（`$HOME/.local/bin/claude` 绝对路径） |
| 同上 | 40 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:4,14`（`--add-dir ~/wo/$WO`） |
| 同上 | 41 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:5,21`（`EXIT=SESSION_LIMIT` 立即停手 + reset 提示） |
| 同上 | 13、35 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:11-22`（重试棘轮）+ `:19`（每 attempt 自动 commit）；条目关闭另记 `governance/docs/open_routes_inventory_2026-08-13.md:87` |
| 同上 | 33 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:15` 三条无通配前缀（`Bash(timeout:*)`、`Bash(.venv/bin/python:*)`、`Bash(.venv/bin/pytest:*)`）。注：后两条属旧 Python 体，Cordis 所需的 node/npm 前缀尚未入表 |
| 同上 | 25 | 旧体已退役（`.venv` / pip），Cordis 对应物：无（工作副本走 `npm ci`） |
| 同上 | 43、45、46 | 仅文档 |
| 工单正文与结束纪律 | 1、3 | 已固化：`CLAUDE.md:31-32`（报告一次性完整输出；自报完成不算完成，以复核为准） |
| 同上 | 29 | 已固化（wrapper 半边）：`governance/docs/bin-dispatch_2026-08-21.sh:19`；「工单正文写死每里程碑立刻 commit」半边仅文档 |
| 同上 | 30 | 已固化（机制半边）：`governance/docs/bin-dispatch_2026-08-21.sh:16` 硬读 `order.md`（续跑必须覆盖同名文件）；do-not-redo 表半边仅文档 |
| 同上 | 34 | ① 旧体已退役（`tests/test_gate5_l1_scan.py`），Cordis 对应物：无全仓扫描门（时钟原语见「测试时钟」行）；② 已固化（通道半边）：`governance/docs/bin-dispatch_2026-08-21.sh:14`，投放内容仍逐单手写 |
| 同上 | 2、23、33b、44 | 仅文档（本仓无工单模板文件，条款逐单复制；`bin-dispatch_2026-08-21.sh:20` 只认退出码与 "API Error"，认不出假完成） |
| 复核与采证纪律 | 4、31b、38、42、52 | 仅文档（纪律范例：`governance/wo/WO-M4-W2/runbook.md:6`） |
| 同上 | 27 | 旧体已退役（`tests/test_p0_integrity.py` 身份假失败），Cordis 对应物：无；同形说明见 `governance/wo/WO-STATE-CANON/report.md:77`（检查项①④⑦在开发机上本就红） |
| manifest 与完整性门 | 5、7 | 旧体已退役（`guardian/manifest.sha256` + pytest），Cordis 对应物：`packages/lykoi-gate/src/manifest.ts`、`packages/lykoi-gate/src/surface.ts`（钉面表）、`packages/lykoi-gate/src/verify.ts:398`（检查项⑤ `checkManifest`）、`packages/lykoi-gate/test/manifest.test.ts`；重签入口 `packages/lykoi-gate/src/cli.ts:24 --write-manifest` |
| 同上 | 26 | 旧体已退役（六目录锁），Cordis 对应物：钉面表 `packages/lykoi-gate/src/surface.ts`；「六目录锁同一时间只发一单」纪律本身仅文档 |
| 同上 | 37 | 旧体已退役（`startup_verify._check_perms`），Cordis 对应物：`packages/lykoi-gate/src/verify.ts:185 checkProtectedTree`（检查项②）+ `packages/lykoi-gate/test/gate-checks.test.ts` |
| 同上 | 50 | 已固化（代码侧半边）：`packages/lykoi-kernel/src/policy-core.ts`（`PROTECTED_PATHS` 收敛）、`packages/lykoi-gate/src/verify.ts:366 checkPathGuard`、`packages/lykoi-gate/test/gate-checks.test.ts:275`、`packages/lykoi-kernel/test/path-guard.test.ts:90`；「退役单先 grep 全仓绝对路径 + 搜 RETIRE 注释」半边仅文档 |
| 部署事实与属主/权限 | 6b、9、31、39 | 旧体已退役（guardian 属主域 / 合并包 B 步排除清单），Cordis 对应物：`packages/lykoi-gate/src/verify.ts:147 checkGateOwnership`（①）与 `:185 checkProtectedTree`（②） |
| 同上 | 8 | 旧体已退役，Cordis 对应物：`packages/lykoi-gate/src/verify.ts:578`（`checkAuditSink` 仍以 `accessSync(W_OK)` 判可写）——「权威判据是以服务账户身份跑」的依赖原样存在 |
| 同上 | 6a、10、51 | 仅文档（幂等粘贴稿范例：`governance/wo/WO-CORE-RETIRE/paste-retire.sh`） |
| GK-6 落点与 env 钉面 | 49 | 已固化：`packages/lykoi-gate/src/verify.ts:621 checkStateCanon`（检查项⑧，注册见 `:667 CHECKS`）+ `packages/lykoi-gate/test/state-canon.test.ts`；`CLAUDE.md:29-30` 硬规矩；env 钉面同族 `packages/lykoi-gate/src/verify.ts:291 checkEnvPins`（③）+ `packages/lykoi-gate/test/env-pins.test.ts` |
| 同上 | 36 | 旧体已退役（`tests/conftest.py` 默认表、`test_no_state_path_constant_points_at_the_live_state_dir`），Cordis 对应物：检查项⑧（守同一条「落点分叉」失败面） |
| 网络与代理 | 11、12 | 已固化：`governance/docs/bin-dispatch_2026-08-21.sh:8`（四个大小写代理变量显式 export） |
| 同上 | 14、15、16 | 仅文档 |
| 灾备重建（DR） | 19 | 已固化：`packages/lykoi-gate/src/verify.ts:556 checkAuditSink`（⑤ `appendOnlyProbe`，缺 append-only 属性即 FAIL） |
| 同上 | 18 | 旧体已退役（pyc 属主检查），Cordis 无 pyc 面；同类 shadow 面见 `packages/lykoi-gate/src/verify.ts:218 checkShadowSurface` |
| 同上 | 17、21 | 仅文档（17 已进运行稿：`governance/wo/WO-M4-W2/w3-runsheet-kevin.md:87`） |
| 同上 | 20 | 未核实（灾难手册正本不在本仓，无从对树） |
| 切换窗与粘贴稿 | 47 | 已固化（本条实例半边）：`packages/lykoi-wake/test/persona-toml.test.ts`（缺必填配置 → `ctx.get('wake') === undefined` 负例）；「翻位复核清单须含『起过一次该条目』」半边仅文档 |
| 同上 | 48 | 仅文档（形态已落两稿：`governance/wo/WAVE-OBS-PREP/paste-landing-b.sh:14,64-85`、`governance/wo/WO-CORE-RETIRE/paste-retire.sh:10`） |
| 测试时钟与定时炸弹 | 32 | 已固化：`CLAUDE.md:33-35` 硬规矩 + 注入原语 `packages/lykoi-wake/src/clock.ts` + `packages/lykoi-wake/test/clock.test.ts`；`// realtime-allow:` 尾注约定在用（如 `packages/lykoi-converse/src/deadline.ts:87`） |
| 同上 | 31c | 仅文档（新体无迁移链相对冻结点；dispatch 白名单半边已固化，见教训 33 行） |
| 观测与故障剥层 | 53 | 已固化（下游半边）：`packages/lykoi-llm/src/index.ts:94`（finish{error} 封口）+ `packages/lykoi-llm/test/llm.test.ts:134-161` + `packages/lykoi-converse/test/llm-finish.test.ts`（WO-LLM-FINISH-01 已关单）；route 名对齐钉在 `profile/cordis.prod.yml:106-110,153-155` 注释；「事件计数精确匹配 `"type":"X"`」纪律仅文档 |
| 治理平面自身纪律 | 5c | 已固化：`CLAUDE.md:32`（波次完成当日 commit+push）；无自动检查 |
| 同上 | 5b | 仅文档（`~/reports/governance-ops.jsonl` 在服务器，本仓无校验面） |

**重复 / 包含关系**（同一个坑的不同层，两条都保留，勿合并）：

- 22（`claude -p` 本身要脱管）→ 28（wrapper 自己也要脱管）→ 46（Mac 侧 ssh 管道同理）；
- 23（工单不能有"等待"步骤）→ 29（等待之外还会中途断线丢工作）→ 33b（把测试丢后台再等）
  → 44（把"进行中"当结束交卷）；四条是同一族 EXIT=0 假完成的四种形态；
- 5（manifest 漏更新）→ 7（guardian 裸文件名易漏）→ 26（并行工单必然冲突）→ 37（排除清单漏 `core/`）；
- 6b / 9（属主还原）→ 31（还原口径）→ 37（`core/` 同级封存）→ 39（A 步须 root）；
- 36（路径常量的落点分叉）→ 49（落点分叉的部署面版本，已由检查项⑧看住）；
- 31c（EXIT=0 假阳性的识别缺口）→ 33（白名单死规则导致的同形假阳性）→ 44（同族）。

索引生成日期 **2026-09-02**（依据当日树上的代码与脚本核实固化状态）。
**维护约定：新增一条教训时，同步在本表加一行**（写明主题、编号、固化状态；
未机械化就写「仅文档」，不确定写「未核实」，不要猜）；固化状态随后续工单变化时
一并更新路径。

### 关于执行 Agent

1. **工单必须写死"stdout 即报告本体，不要写文件"**，否则它只回一段聊天式摘要。这个失败模式出现过三次。
2. **必须写"禁止用摘要代替明细""宁长勿略"**，并明确列出必须包含的产物数量（例如"6 张 mermaid 图，一张都不能少"）。
3. **它自报完成不算完成。** 已抓到的真实缺陷：把可读的审计正本误判为不可读而降级、漏更新 manifest 里自己的哈希（会导致全线停机）、脚本不幂等、灾难场景下路径解析必失败。**每一条都是"报告说 OK"的情况下查出来的。**
4. **涉及权限的判断必须自己实测**——它对文件权限的推断出过错。
5. **⚠️ 最高频的致命缺陷：改了受 manifest 覆盖的文件却不更新 `guardian/manifest.sha256`。已发生两次**（SEC-01 漏更新 startup_verify.py 自身条目；SEC-02 新增 `resources/url_guard.py` 完全未登记）。两次都会导致三服务全部拒绝启动。
   **凡工单会动 `cognition/mind/memory/shared/surface/resources` 六个目录或 `guardian/` 下任何 .py，工单里必须显式写上"同步更新 manifest（改哈希 + 新增条目）"，复核时必须跑 `pytest tests/test_p0_integrity.py`。** 这一条建议直接写进工单模板。
   → 参见教训 7、26、37（同族）。旧体已退役，Cordis 对应物见本节索引「manifest 与完整性门」行。

### 关于治理平面自身的纪律（2026-08-09 新增，两条都因实际缺失而写）

5b. **每次服务器写动作 + 每次生产部署，必须记一条 `~/reports/governance-ops.jsonl`。** Codex 接手期间完成 4 次生产部署但全程零记录，审计链出现空洞，事后只能由继任者从 review 文档重建（已补录并标注 backfilled）。这条日志是治理平面自己的审计——我们要求 Lykoi 可审计，自己不能例外。

5c. **治理仓库的提交必须 `git push`。** 同期 8 个提交只落在本地工作副本，GitHub 上看不到——共享底座的全部意义（跨 Agent 交接、异地留存）在没推之前都不成立。收工前固定检查 `git log origin/main..HEAD` 应为空。

### 关于"代码事实"与"部署事实"

6a. **治理工作副本是代码事实源，不是部署事实源。** 执行 Agent 曾据仓内 systemd unit 文件判定 `core/` 包（占全库 40%）是 default-off 死代码、建议删除；我用 `sudo systemctl cat lykoi-*` 查线上 drop-in，发现 M3 开关**几乎全开**——它是运行中的生产路径。**任何"是否启用"的结论都必须查 drop-in。**

### 关于部署

6b. **`guardian/` 目录是 `dr-xr-xr-x root:root`，lykoi 完全不能写。** 触及 guardian 的改动**不能用普通 `git merge`**，必须 Kevin 以 root 执行。那 17 个 `/usr/local/sbin/lykoi-*-apply` 控制器就是为此存在的。
7. **改了 `guardian/` 下任何文件，必须同步更新它在 `guardian/manifest.sha256` 里的条目**——包括 `startup_verify.py` 自己。清单里 guardian 文件用**裸文件名**（相对 `guardian/` 解析），批量核对时极易漏。漏了会导致三个服务全部拒绝启动。
8. **`startup_verify.py` 用 `os.access` 判权限，以 root 运行会假阳性**报 `audit sink directory … writable by the service user`。权威判据是**以 lykoi 身份**运行（= systemd `ExecStartPre` 的真实身份）。
9. **部署后属主/权限位要还原**：guardian 两文件 root:root 444；`src/lykoi/shared/{log,redaction}.py` 是 root:root 644（服务账户不能改脱敏器）；`src/` 下有 41 个文件本就是 root 属主（core 包整个是），**绝不能 `chown -R`**。
10. Kevin 用的 `lykoi` 账户**不能免密 sudo**，他是另开 root 会话操作的。

### 关于环境

11. **无头调用必须带代理**：`http_proxy`/`https_proxy`（含大写）= `http://192.168.0.202:7890`。直连 Anthropic API 返回 **403**（CN 出口拦截）。
12. **`bash -lc` 不读 `.bashrc`**（只读 `.profile`）——代理已写进 claude 账户的 `.profile`，但派发命令里最好仍显式 export。
13. **网络会抖**（Kevin 家宽带故障期间用手机热点）。长任务常见 `Connection closed mid-response`，重发即可；WO-BASE-04 连试三次才成。ssh 断了就等一会重连（用 `until ssh … ; do sleep 15; done` 模式）。
14. **跨用户 git**：需 `git config --global --add safe.directory <path>`；`.git/packed-refs` 是 0600 组内读不到，**本地 clone 走不通，用 `git bundle` 经 `/tmp` 中转**（两个方向都用过）。
15. **macOS TCC**：launchd 跑 `~/Documents` 下的脚本会被拒（`Operation not permitted`, exit 126）。Mac 侧自动化一律放 `~/lykoi/`。
16. **rsync 退出码 24**（源文件传输中消失，服务器正在轮转备份）应判为成功。

### 关于从零重建（2026-08-09 演练实证，详见 wo/WO-DRILL-CLEANVM-01/）

17. **`git bundle` 不含 HEAD ref**：克隆必须 `git clone -b main`，否则得到空工作树、
    下游全崩。灾难手册没写这条，真实 DR 会踩。
18. **venv 安装后必须清全仓 `__pycache__`**：以 lykoi 生成的 pyc 会触发 startup_verify
    的 protected-pycache 属主检查，三服务拒启。缓存的规范态是"不存在"。
19. **审计正本 `/var/log/lykoi-audit/audit.jsonl` 带 `chattr +a`**：startup_verify 会验；
    重建时要设回去；复用旧机覆写前得先 `chattr -a`。非特权容器无 CAP_LINUX_IMMUTABLE。
20. **灾难手册两处与活体不符**：persona TOML 实为 root:lykoi **0440**（手册写 0640）；
    governance flags 实为 2 项（含 self_state_injection.on **0400**）。以活体实测为准。
21. **`/usr/sbin/lxc` 是 snap 垫片**，首次调用会静默触发 `snap install lxd`——
    2026-08-09 勘察时已意外装上（5.21.6，已记 governance-ops）。lxdbr0 DHCP 对容器
    不生效、NAT TCP 不通（疑宿主防火墙），容器出网用 LXD proxy device 最省事。
22. **服务器侧长任务必须 nohup 脱管**，别附着在 ssh 会话上（宽带断线会连坐杀掉
    lxc exec / claude -p）。
    → 参见教训 28（wrapper 层）、46（Mac 侧 ssh 管道层）。

### 关于无头执行 Agent（2026-08-09 新增，都是本轮实际踩的）

23. **工单里不能有"等待"步骤**。WO-P2-03A 两次在"等全量 pytest 跑完"处直接结束会话
    （报告只有一句"我在等"），代码写完了却**没提交**。要么把长测试拆成独立后续单，
    要么在工单里写死"跑测试用 `timeout N` 且必须先 commit 再等"。最终由复核方代提交。
    → 参见教训 29、33b、44（同族的后三层）。
24. **派发包装脚本要用 `claude` 的绝对路径**（`$HOME/.local/bin/claude`）。
    重试用的 wrapper 是非 login shell，读不到 `.profile` 里的 PATH，直接
    `command not found` 连败三次（rc=127）。
25. **执行 Agent 的工作副本要先建 venv**。`~/lykoi-work` 起初没有 `.venv`，Agent 想
    `pip install` 又没权限，只能中途求助。另：首次 `pip install` 出现过一次
    **包哈希不匹配**（重试后干净通过，判定为代理传输损坏），遇到别慌但要记录。
26. **并行 lane 的硬约束是 manifest**：凡动 `cognition/mind/memory/shared/surface/
    resources/kernel/core` 的工单都要重签 `guardian/manifest.sha256`，两个这类工单并行
    必然冲突且互相污染启动门。**六目录锁同一时间只发一单**；并行 lane 必须选在锁外
    （如 broker 的全新目录 `src/lykoi/broker/`，用 `git worktree` 隔离）。
27. **以 claude 身份跑 `pytest tests/test_p0_integrity.py` 会有一个假失败**
    （`PermissionError: /home/lykoi/state/approval_rules.json`，0600 读不到）。
    权威判据是以 lykoi 身份在活体跑（25 passed）。别把这个当真缺陷。
28. **`~/bin-dispatch.sh` 必须用 `setsid nohup ... </dev/null &` 启动**（2026-08-10）。
    WO-P2-S2 连挂四次：前三次是真网络错误（`API Error: Connection closed mid-response`），
    **第四次是 wrapper 自己被 SIGHUP 杀了**——它附着在我的 ssh 会话上，会话一结束
    整个进程组连坐，所以内置重试一次都没跑（`run.log` 是 0 字节，连 `retry attempt=1`
    都没写出来）。教训 22 说的是 `claude -p` 本身，这里是 **wrapper**，同一个坑的第二层。
    已加固：`trap "" HUP` + 启动即写 `START` 行 + 重试 5 次 + 每次 attempt 的报告单独存
    `report.attemptN.md`（否则重试会覆盖上一次的证据）。
    **诊断口诀：`run.log` 没 `START` = wrapper 没起来；有 `START` 无 `retry`/`EXIT`
    = wrapper 被杀；有 `retry` 无 `EXIT` = 还在跑。**
29. **长工单要在正文里写死"每个里程碑立刻 commit"**（2026-08-10）。教训 23 只治了
    "以等待结束会话"，没治"网络中途断线丢一整段工作"。S2 第一段写了 521 行零提交，
    全靠复核方手工救回。现在 wrapper 每次 attempt 后自动 `git commit`，工单里也要求
    分段提交——两道保险。
30. **续跑工单必须覆盖 `order.md`，且要写清"哪些已完成、不要重做"**（2026-08-10）。
    wrapper 硬读 `order.md` 这个文件名，我一开始把续跑单写成 `order2.md`，被完全忽略。
    续跑单开头要列出上一段的产物清单与提交号，否则 Agent 会重构已经写好的代码。

31. **合并后的属主还原口径是"照未触及的同目录文件对齐"，绝不是"非 guardian 一律
    chown lykoi"**（2026-08-11，我给 Kevin 的清单里犯的）。`src/lykoi/kernel/` 是
    `p02_harden.sh` 封印的目录：kernel 源必须 **root:root 644**，startup_verify 会验
    属主、p0 有 sealed-host 可写性测试。盲 chown 把 S2 带来的 4 个 kernel 文件翻给
    lykoi，三处门当场红。修复：单独 `chown root:root` 那几个文件。root 领地全名单：
    `guardian/`（444）、`kernel/*.py`（644）、`shared/{log,redaction}.py`（644）、
    `core/` 整包。broker/、mind/、resources/、tests/ 归 lykoi。

31b. **改"取料/入队"这类语义的工单，必跑清单不能手挑**（2026-08-11，WO-L2 复核揪出
    20 条漏网失败、两轮才修净）。integrator 邻接的**全部**套件（pipeline/trigger/
    telemetry/concern_floor/confab/p4r*/perception_ingest/数据模型迁移）都得进清单——
    漏的恰是没挑进去的。另两条复核采证纪律同案：①复核方全量 pytest **必须串行**，
    两个全量并发会互相污染 `test_core_v1_shadow`（epoch/artifact 竞争，2→6 假红）；
    ②保存**完整** short summary（`tail -25` 截掉过 41 条里的 17 条，多花了一整轮）。

31c. **链相对的迁移冻结（`MIGRATIONS[:-1]`）是定时漂移**（2026-08-11 第二次咬人）。
    测试要冻结历史 schema，冻结点必须写**绝对版本**（如 `[:10]`）——链每长一版，
    相对冻结就换一次含义；v11、v12 各咬过一口。同理：dispatch 白名单必须包含工单
    强制的命令前缀（`timeout` 缺席让 WO-S3 无头卡死一轮，已补）；wrapper 的
    `EXIT=0` 判据识别不了"权限求助式结束"，**复核必须查 diff 里有没有测试与
    manifest，不能只看退出码**。

33. **dispatch 白名单里的 Bash 前缀规则不吃路径中段的通配符**（2026-08-12，WO-L5
    首轮卡死）。`Bash(.venv/bin/*:*)` 是一条**从不匹配**的死规则——前缀按字面比对，
    `*` 不展开。此前 L4/OBS 能跑测试全靠工单强制 `timeout NNN` 包裹、蹭的是
    `Bash(timeout:*)`；L5 工单一漏写包裹要求，裸 `.venv/bin/python -m pytest`
    全数被拒，Agent 以"请求许可"收尾（EXIT=0 假阳性,教训 31c 形态）。
    已修：白名单改成 `Bash(.venv/bin/python:*)` 与 `Bash(.venv/bin/pytest:*)`
    两条**无通配前缀**;工单模板保留 `timeout` 包裹当第二道保险。
    **新增白名单条目后,用一条最小命令实测匹配,不要照猫画虎抄语法。**

33b. **执行 Agent 有"把测试丢后台再等"的倾向,工单要预防**(2026-08-12,OBS-LLM
    与 L5 各踩一次)。sonnet/opus 都会在慢环境里把 pytest 放后台、写一句"跑完我
    再继续"就交卷——会话一退后台即死,EXIT=0 假阳性。工单模板现在写死:
    **"一切命令前台串行执行,禁止后台(&)、禁止 sleep 等待、禁止'稍后继续'式收尾"**。

32. **两个时钟一混，测试就是定时炸弹**（2026-08-11，S2 交付里踩的）。
    `test_denials_are_advisory_and_expire` 用冻结时钟算"过期时刻"，但
    `record_denial` 落的是真实时钟——2026-08-10 21:00（北京）之前跑全绿，之后永久红。
    S 窗口复核和 L 窗口全量对照都在绿区跑的，谁都没看出来；Kevin 部署时才炸。
    **复核涉及时间语义的测试时，专门检查：断言里的每一个时间量，锚的是哪只钟。**
    修法是把过期锚在记录自身的时间戳上（`FIX-S2-TEST` `01a8099c`）。
    → 已固化：`CLAUDE.md` 测试时钟纪律 + 注入原语 `packages/lykoi-wake/src/clock.ts`
    （测试 `packages/lykoi-wake/test/clock.test.ts`）。

34. **工单模板的两条固定项**（2026-08-13 补,均为陈年遗留销账）。
    ① **`tests/test_gate5_l1_scan.py` 进每张单的必跑清单**——全局不变量门,<1s;
    凡新代码读时钟,先想 `shared/clock`,确需裸读必须打 `# realtime-allow: <理由>`
    尾注(U0 因此红过四套)。② **白皮书随工单一起投放**——WO-BASE-04 复核提出
    "执行 Agent 手上没有白皮书,只能依工单转述判断对齐",此后一直没落实;
    动到人格/记忆/自主性语义的单,把相关章节摘录进工单,或明确写"以
    `docs/lykoi_whitepaper_v1.2_2026-08-18.md` §X 为准"。

35. **"派发长连接中断"这条老账已由棘轮方案关闭**(2026-08-13 记)。
    WO-BASE-04 复核当时建议"再遇到就拆小工单";实际采用的是
    `bin-dispatch.sh` 的 5 次重试 + 每次 attempt 自动 commit(棘轮),
    此后三次中断都自愈。**不必再拆单**——条目就此销账,避免下一个 Agent
    照旧文再发明一次流程。

36. **新增"落在 state 目录的路径常量",同一提交必须补 `tests/conftest.py` 的
    默认表**(2026-08-13,代价是一次用户可见事故)。接嘴单加了
    `OUTBOX_CURSOR_PATH`,conftest 没跟上,`test_telegram_device.py` 里四个真跑
    `run_forever` 的用例其夹具也没 patch 它。**合并包的测试步是以 lykoi 身份
    在活体仓里跑的**——于是测试把游标(0)写进活体
    `/home/lykoi/state/telegram_outbox.cursor`,重启后设备从头扫账,把 8 月初的
    陈货投给了 Kevin(工单 §forbidden 明令禁止的那件事)。
    **复核清单新增一问:这单新增了哪些路径常量?每一个在 conftest 里有默认值吗?**
    回归守卫已落地:`test_no_state_path_constant_points_at_the_live_state_dir`。
    → 参见教训 49（Cordis 对应物：完整性门检查项⑧ `state_canon`）。

37. **合并包 B 步的属主排除清单必须含 `src/lykoi/core/`**(2026-08-13,合并包 10
    实际踩了)。`startup_verify._check_perms` 把 **kernel 与 core 同级**当作封存的
    导入边界:目录与目录下每个 `.py` 都要 root 属主、不可组/他人写(理由是可写的
    `.pyc` 会 shadow `.py`,是代码注入面)。此前六个包的 B 步只排除
    `^guardian/` 与 `^src/lykoi/kernel/`——因为没有一个包动过 `core/`,漏洞一直
    没暴露;销账批 3 改了 `core/shadow.py`,`chown lykoi:lykoi` 之后启动门当场
    FAIL(`not root-owned (uid 1000)`)。**八份合并包模板已统一补上第三条排除。**
    症状与修法:`startup_verify: FAIL: .../core/xxx.py: not root-owned` →
    `chown root:root` 该文件 + `chmod 644` + 清 `core/__pycache__` → 重跑门。

38. **Kevin 在活体做实弹验证时,治理侧不得在同一台机器上跑任何测试**
    (2026-08-13,我自己造了一次假警报)。`tests/test_core_v1_shadow.py` 对负载极
    敏感:`wait(timeout=1)` 的一秒窗口 + `_THREAD_LOCK_WAIT_SECONDS = 0.2` 的锁
    预算,一旦抢 CPU 就首条失败,随后 5–6 条连锁 `TimeoutError: Core writer epoch
    thread lock exceeded`(**连锁不是独立失败,别逐条归因**)。当晚我先跑全量、
    又在"证伪"时连跑两轮同文件,把 Kevin 的两次实弹都污染成 7/8 条失败;机器空闲
    后连跑两遍都是 **2 failed / 50 passed**(= `redaction._SECRETS` 老基线)。
    另记:该文件此前从未进过任何合并包的 C 步清单,**活体基线是今晚才第一次测出来的**
    ——涉及 core/shadow 的单,C 步要带上它。

39. **服务器 lykoi 账户上的 Claude remote 桥接会话是常驻风险源**(2026-08-18,
    合并包 12 落地事故)。桥接进程(`~lykoi/.claude/remote/...server --bridge`)
    23:13 上线,一分钟后把 U3 非 kernel 文件直接拷进活体检出——绕过合并协议、
    在 root-only 的 kernel 处折断,留下"重启即拒启"的半套(import 缺失模块 +
    manifest 哈希不符)。**排障顺序**:活体树出现来历不明改动时,先查
    `ps -u lykoi` 里有没有 `.claude/remote` 桥接、`w` 里有没有多余登录,再看
    audit(先排除她;本次她清白,当时在读甲子园新闻)。**处置**:kill 桥接 →
    残留隔离到 /tmp(先 diff 核内容)→ 树净 → 正门重走。**预防**:落包期间
    不开第二个连服务器的 Claude 会话;桥接路径去留请 Kevin 决断。
    另两条模板修正:①触及 `src/lykoi/kernel/` 的合并与 guardian 同类,**A 步
    必须 root 执行**(教训④升级,本次 lykoi 身份合并在封存路径上折返一次);
    ②B 步首段 `git diff | grep | xargs` 管道会吞 git 错误码(本次曾把"没合并"
    藏过去),重排为先显式验证 HEAD 已到目标再动属主。

40. **工单参考材料必须经 `--add-dir` 放行,stdin 只送 order 本体**(2026-08-21,
    WO-CA-BASELINE-1)。bin-dispatch 把 order.md 经 stdin 喂给执行方,但执行会话
    读不到 `~/wo/<WO>/`——投放在工单目录的白皮书/设计文档等参考材料对执行方
    **不存在**(CA 单执行方 `ls /home/claude` 被会话权限拦,只能把所有原文对照
    写成开口)。已修:bin-dispatch.sh 加 `--add-dir ~/wo/$WO`(备份
    `~/bin-dispatch.sh.bak-20260821`)。复核时若报告自称材料缺失,先查这条,
    别怪执行方。工单正文引用材料时写**绝对路径** `~/wo/<WO-ID>/<文件名>`。

41. **撞账号 session limit 时 wrapper 曾盲目重试 5 次烧额度**(2026-08-19,
    WO-GW-01 第 1 波:78 分钟实活后 21:55 撞限,4 次快速重试全部撞墙,
    FAILED_ALL_RETRIES;额度 reset 在 1:20am,重试毫无意义)。8-11 就有此教训
    候选,一直没实现,2026-08-21 已修:report 里 grep 到 "hit your session limit"
    即 `EXIT=SESSION_LIMIT` 停手并记 reset 提示。治理侧看到该 EXIT 类:等 reset
    后发**续跑单**(教训 30 do-not-redo 表),实活都在分支 commit + WIP 自动保存里,
    不会丢——GW-01 第 1 波判据②–⑥五个 commit 全部幸存即为证。

42. **粘贴稿/工单里的测试清单必须 `ls` 对树核实,不许凭记忆写文件名**
    (2026-08-21 init-node 粘贴稿:test_approval_conversation.py 是凭记忆编的
    假文件,Kevin root 现场撞上才改对;2026-08-22 WO-GW-02 签发又犯同款:
    合同状态写成 completed/failed,而活体七态 CHECK 里根本没有——执行方停工
    才纠正)。适用面不止测试名:**一切进入粘贴稿/工单判据的具体标识符
    (文件名/状态值/env 名/函数名)都必须对树或对活体 CHECK 核实。**

43. **判执行器死活必须看全量进程列表,禁止用截断/过滤后的 ps 下结论**
    (2026-08-21 深夜:`ps | head -8` 截断漏看仍在跑的 WO-U3S 第 1 波,误诊
    "进程组死亡"→误派第 2 波→同一工作树双执行器竞写近 3 小时,侥幸零冲突
    ——第 2 波的 manifest 重签与第 1 波逐字节相同才没炸)。正确姿势:
    `pgrep -f "bin-dispatch|claude -p"` + `ps -u claude -o pid,ppid,etime,cmd
    --no-headers` 全量看;run.log 无 EXIT 行 = **还在跑**,不是死了。

44. **EXIT=0 假完成的新变种:把"进行中"当结束交卷**(2026-08-22 WO-CB-01
    连续两波:第 1 波在基线 chunk 3 跑动中写"稍后接上"就退出;第 2 波变本加厉
    "已挂监听等块完成"——headless 会话退出即杀掉一切子进程,"监听"不存在)。
    工单必须写死**结束纪律**:最终输出只能是完成全部判据后的完整报告,任何
    长任务前台等完,禁后台禁监听禁"稍后接上"。复核侧:EXIT=0 + 树上零/少
    commit + 短报告 = 假完成,发续跑单。另注:**2 小时级的改动前基线复跑是
    假完成高发诱因**——若同 commit 已有权威基线数字,续跑单直接豁免引用之。

45. **fresh clone 的工作副本必须立即配 git 身份**(2026-08-22:lykoi-work-cb
    从本机克隆后无 local user.email,bin-dispatch 的 WIP 自动保存 commit 静默
    失败,撞限后改动只剩 staged 未提交)。建工作副本的标准动作加一条:
    `git config user.email gov@lykoi.local && git config user.name "Lykoi
    Governance Agent"`。

46. **Mac→服务器的长 ssh 管道会被网络抖动杀掉,长任务必须服务器侧 setsid
    脱管 + 短连接轮询取结果**(2026-08-18 复核断连两次;2026-08-22 复核复跑
    两条 ssh 管道先后 255 断死,结果全丢,第三次改脱管形态才拿到数字)。凡预计
    >10 分钟的远程命令:写成服务器端脚本 → `setsid nohup … &` → 输出落服务器
    文件 → 本地每几分钟一次新连接查完成标记。

### 关于切换窗与粘贴稿（2026-09-01 新增，M4 切换事故与后续实勘）

47. **切换分支翻位前，须核每个被翻条目「翻开即可启用」**（2026-09-01 00:54
    事故本体）。占位条目（缺必填配置的 wake / 名字不是插件的 learn）在
    disabled 态下零测试覆盖，唯一暴露点就是生产 loader——七位翻开两位炸，
    旧体已停新体起不来。后续新增器官位时，翻位 commit 的复核清单必须含
    「dev 装配或测试里起过一次该条目」。详 wo/WO-M4-FIX-WAKE/。

48. **粘贴稿断言一律显式 if/exit，禁 `[ … ] && echo OK` 形态**（2026-09-01
    落地稿实证）。`set -e` 对 AND-OR 列表有豁免：`[ 测试 ] && echo` 失败时
    **不中止**，断言静默滑过——当晚六位断言 grep 模式又恰好错（严格子串漏了
    heart 位注释「；R-01」变体），双错叠加零告警。软断言 = 没有断言。

49. **切换材料必须对 GK-6 canonical 表逐条验证「运行时实际落点」，不能只验
    文件存在**（2026-09-01 实勘，WO-STATE-CANON）。prod yml 声称逐字沿用
    `/home/lykoi/state` 活体身份文件，但源码缺省是仓库相对 `var/state/…`、
    unit 零 LYKOI_* env——调和物（var/state 符号链接）从未进部署材料，止损
    重启 40 分钟内服务进程就在仓库内 mkdir 真实目录分叉了一个游标。审批面
    诸文件靠懒加载才没跟着分叉。现已由门检查项⑧永久看住（缺失也算 FAIL）。
    → 已固化：`packages/lykoi-gate/src/verify.ts:621`（`checkStateCanon`）+
    `packages/lykoi-gate/test/state-canon.test.ts`。参见教训 36。

50. **ops 退役单签发前必须 grep 全仓被退役的绝对路径——代码里引用它的常量/
    探针要有代码侧配套单**（2026-09-01 退役三跑事故）。封存旧仓后，kernel
    禁区表 `PROTECTED_PATHS` 的旧 guardian base 解析失败，SK-74 fail-closed
    把「一条 base 消失」放大成「护栏对一切路径判在内」→ 门检查项④双 FAIL
    拦启动。机制是功臣（真放她起来，运行时她寸步难行）；缺的是退役单的代码侧
    另一半（WO-GUARD-RETIRE 补齐，含条目寿命纪律入注释与机制钉）。且旧体
    源码注释早已预告此步（「留到旧体退役之后（CORE-RETIRE 正本）」）——签
    退役类单时**搜一遍代码注释里的 RETIRE/退役字样**，前人埋的提醒别浪费。

51. **服务器实物层三连坑（退役稿三跑实录）**：① 手工安装的 systemd 单元常
    实住 `/etc/systemd/system/`（真文件），`systemctl mask` 撞真文件被拒——
    退役 = disable → 单元文件归档 → mask 占名；② 旧审计类文件可能带
    `chattr +a`，root 的 rename 也 EPERM——归档前 lsattr、摘属性、append-only
    移完补回；③ 重定向 `cmd > 存档文件` 在 cmd 失败时**先截断后失败**——
    幂等稿里存档一律先写临时文件成功后再落位。另：带引号的 glob 白名单条目
    （`'*.sqlite3'`）在 `[ -e "$f" ]` 里永不展开，要裸变量二层循环。

52. **执行方子 Agent 在场时，治理侧不动共享工作副本；动了须即刻知会**
    （2026-09-01，WO-CACHE-PERSONA 作业期间治理侧改了退役稿，执行方交卷时
    如实上报未误收——这次靠执行方显式路径 add 的纪律兜住，下次未必）。

53. **验证性事件计数一律精确匹配 `"type":"X"`，禁子串 grep；实证必须能
    区分成败**（2026-09-01，WO-INC-LLM-ROUTE 认知断流事故）。M4 夜「wake
    首拍实证」用 `grep -c autonomy_wake`，子串同时命中 `autonomy_wake_failed`
    ——她自切换起 18 拍全败、预算全零，靠 W1 首日读数组合异常才揭出。
    根因：yml `route: deepseek` 对不上 vendor 写死常量 `deepseek-official`
    （registerAdapter 仅此一条，配置面无改名位）→ dsh-llm NO_ADAPTER。
    配套教训：**空回复 ≠ 根因，要往下剥到失败位**——dsh-llm 把 dispatch
    抛错归一成 finish{error} 不外抛，lykoi-llm 不检查 finish 位返回空文本，
    wake 解码才炸，报错离根因隔两层。跟进项（观察周后）：lykoi-llm 应把
    finish{error} 外显（抛错或入结果），失败原因不许静默吞掉。
    → 跟进项已固化（WO-LLM-FINISH-01 关单）：`packages/lykoi-llm/src/index.ts:94` +
    `packages/lykoi-llm/test/llm.test.ts:134-161` +
    `packages/lykoi-converse/test/llm-finish.test.ts`。

---

## 五、当前进度

### 📍 状态快照（2026-09-02 刷新；比下方一切条目新，先读这里）

- **用户层完成度评估（2026-09-02 治理会话，基准=愿景八条验收，Kevin 拍板）**：
  真实交付 / 可恢复 = 达成(有限)；记忆 / 治理 = 部分；主动生活 / 器官可拔插 /
  子代理 = 未达；身份连续 = 未验证。愿景一期三诺（主动上网 / 主动联系 /
  委派可靠完成）**0/3**。Kevin 确认 09-01 Telegram 体验"不好，感觉没做完"，
  计为用户层硬失败。活体根因四条（清单撒谎 18→实 5、溯源门误杀 13/47 拍、
  wake 空回包整拍报废 6 拍、重启线索 CST 误解析）→ 开小单
  **`wo/WO-FIX-LOOP-01`**（sonnet 执行，分支 `wo/fix-loop-01`，零迁移零装配）。
  队列改序（Kevin 15:12 裁决"M5 提前到人格分层前"）**已被 15:22 的更晚指示
  取代**：D-PERS-2 当日以 `WO-PERS-OVERLAY-01` 并入并落地（下下条）。现行队列：
  **`WO-FIX-LOOP-01` 已裁合落地（LANDING-G，见下条）→ `WO-M5-ORGAN-BROWSER` 开工**。
  **WO-FIX-LOOP-01 复核 PASS（同日 18:30）**：sonnet 执行 6 提交 + 治理复核改口
  1 提交（D-1d gap `wanted` 记工具名；`grounded_concern_ids` 去重升序），rebase 到
  main@a794e7f 后尖 **a6e4432**，独立复跑 **929/918/0/11**，tsc 净，详见
  `wo/WO-FIX-LOOP-01/review.md`；**Kevin 同日"动手"裁合 → 合并 main@481e6d2 →
  LANDING-G 已落（20:25）**，见下条。遗留：执行方发现 GK-14 张力
  （信封 `dispatched` 自称先于 D-1d 闸——未接线 tool_call 会自称派发却无
  action_dispatch 行），触信封契约，另立小单。执行过程两次中断（429 速率限制、
  流停滞看门狗），均 SendMessage 续跑，worktree 提交未丢。
- **LANDING-G 已落（2026-09-02 20:25）**：WO-FIX-LOOP-01 合并 main@**481e6d2**，
  **产线现钉此提交**（记录 `wo/LANDING-G-20260902/record.md`：零迁移零装配，manifest
  重签 106，gate OK，停机约 3 秒；备份 `/root/backup-pre-fixloop-20260902T202458.tar.gz`；
  NRestarts 0）。首拍证据：`organ_inventory_built.chars` 703→309（清单 18→5 项）；重启
  线索无 `never_stopped`/`negative_interval` 噪声。**新发现**：落地脚本 `disable --now`
  使单元卸载、`InactiveEnterTimestamp` 丢失，downtime 结构性为 null——**H 稿起 service
  改用 `systemctl stop`**（保持 enabled），D-4 代码不动。次日读 `decision_ungrounded`
  日频、`autonomy_wake_retried`、`capability_gap{not_wired}` 的 `wanted` 分布（M5 输入）。
  现行队列：**`WO-M5-ORGAN-BROWSER` 已裁合落地（LANDING-H，2026-09-03 00:21，产线钉 main@482d644）**；10b 探针待补两条；GK-14 小单待立。
- **WO-M5-ORGAN-BROWSER 派工（2026-09-02，Kevin"开 M5 browser 的单"）**：spec 四决断
  Kevin 拍板——空白名单+逐域首次审批（kernel 既有 domain scope）；只读两项
  `browser.navigate/get_text` + 一次性 `research_browser.read_text`；独立 OS 用户
  `lykoi-browser` + systemd 单元 + playwright-core 驱动系统 Chrome 148 + 本地 socket；
  CDP screencast + 截图留 7 天。派工单 `wo/WO-M5-ORGAN-BROWSER/order.md`（D-1..D-10），
  opus 执行（安全面），分支 `wo/m5-organ-browser`，基线 main@17bfbb7 929/918/0/11。
  报备后果：`research_browser.*` 在 AUTONOMOUS_ALLOWED，独处上网不逐域问（policy-core
  另单）。落地 = LANDING-H（root 建用户/单元/配置 + npm ci + 重签；service 改 stop）。
- **WO-M5-ORGAN-BROWSER 复核 PASS（2026-09-02 深夜，经一轮修订）**：首轮 tip 1c249d6
  （6 提交，988/977/0/11）；复核发现 R-1 宿主 unit 把 Chrome 放进 lykoi 组（方向反了，
  可读 /home/lykoi 下组可读的备份与旧 cookie）→ 改 `ProtectHome=tmpfs` + BindPaths +
  只读 bind 代码树到 `/opt/lykoi-browser/tree`，大脑入 `lykoi-browser` 组；R-2 出域跳转
  只在导航后查 → 请求层门已做但**实证否定**（Chromium 上 route 不为 302 hop 回调，302 →
  私网的请求会发出）→ R-4 unit 加 cgroup eBPF 出网闸（IPAddressDeny 私网 13+9 段，
  Allow 127.0.0.53/127.0.0.1），**fail-open 须 LANDING-H 探针实证**；R-3 备份第 13 项改
  手工项（日备份以 lykoi 跑读不到 700 的 profile）。修订轮 tip **0006e75**（5 提交），
  独立复跑 995/984/0/11、tsc 净。服务器实核：NoNewPrivileges 下 Chrome 沙箱可用
  （AppArmor chrome profile 带 userns），无 setfacl，产线树全 other 可读。
  `wo/WO-M5-ORGAN-BROWSER/review.md`。
- **LANDING-H 已落（2026-09-03 00:21）**：Kevin 裁合（「动手」）→ main@**482d644** → v1 在 §6 因
  `init-state.ts` 盘上 755/索引 644 模式漂移 FATAL（G 时已有，stat 缓存掩盖）→ v2 修 npm Node 24 PATH +
  按钉点恢复模式 → 完成。manifest 113，gate OK，宿主 active（Allow 两环回、Deny 22 段、NNP、socket
  lykoi-browser:lykoi-browser 660、health alive），assembly up，`browser_organ_wired` 三动作，
  **deploy_event downtime "12 分钟"（G 修的线索首次非空）**，NRestarts 0，服务器 Chrome 148 smoke
  1/1。10b 302→私网得 `timeout`：IPAddressDeny 是 skb 丢包不是拒绝（§1 curl rc=28 同签名），
  与拦住一致但要补直连 httpbin 对照。记录 `wo/LANDING-H-20260903/record.md`。
- **LANDING-E 已落（2026-09-02 15:09）**：017 施加，mind_schema **17**，产线首次
  直接钉 main@89b04dd（记录 `wo/LANDING-E-20260902/record.md`）。
- **D-PERS-2 · `wo/WO-PERS-OVERLAY-01` 复核 PASS → Kevin 裁合 → LANDING-F 已落
  （2026-09-02 17:38）**：合并 main@**29ffab1**，产线现钉此提交（记录
  `wo/LANDING-F-20260902/record.md`：零迁移但 manifest 钉 src 须 root 重签，停机约
  5 秒；备份 `/root/backup-pre-overlay-20260902T173758.tar.gz`；manifest 106；
  NRestarts 0）。**教训：零迁移 ≠ 零停机。** 通道事实：治理账户可传 bundle 到服务器
  /tmp，传 root 执行脚本被分类器拦（脚本走聊天正文 + Kevin 落盘）。下面是签发与复核经过：
  Kevin 15:22 在另一会话点名"那现在做 D-PERS-2"，晚于上条 15:12 的改序裁决，故按
  更晚指示签发（章程头注记了时间线；两单并行、区段不重叠）。opus 执行，分支
  `wo/pers-overlay` 尖 69ee4fc（父 23c65a0）。内容：L4 从 `relationship_thread`
  关切得出的结论落 `insights.category=relationship`，键 = `memory_scopes('insights',
  id, subject)`（**TS 体第一个 memory_scopes 运行期写者**；KEY = 关切实体轴 ??
  owner，皆 null 退 focus + `relationship_overlay_unkeyed`）；读口两分
  `promotedRelationshipInsights(subject)` / `promotedFocusInsights()` 排除 relationship，
  `listFocusInsights` 不动（L4 状态机对 relationship 行一视同仁）；converse 人格块转正
  段后加 `RELATIONSHIP_OVERLAY_HEADER` 段，空态零字节。**零 schema 零迁移零 env**，
  落地 = 拉 main + 重启。测试 902/891/0/11（+22），devstate 注入 902/902/0/0，tsc 净；
  与 `wo/fix-loop-01` merge-tree 无冲突。执行方一次停工上报（D-2 值导入撞 learn
  import 面守卫，治理裁走 shared.ts 副本范式，章程同日修订 23c65a0）——**教训：签章程
  前先跑一遍 boundary 类静态守卫**。契约增补件 `WO-M0-STATE-CONTRACT/amendment_017-1`。
  对当前产线为空操作（无 relationship 行）；首月观察 `"type":"relationship_overlay_keyed"`。
- **审计修复单 `wo/AUDIT-FIX-2026-09-02`（Kevin 2026-09-02 口头授权"其余按建议修"，
  token 轮换明示不做）**，Kevin 同日裁决并入 main（merge c00165a），分支已删。内容：
  ① **main 即生产装配**：`profile/cordis.prod.yml` 六器官位在 main 上启用，
  `m4-switch` 翻位分支已删（本地+远端，Kevin 裁决）；其尖 56d7ead 留轻量标签
  `m4-switch-retired`（生产当前仍钉此提交；**下次落地起钉 main 提交**）。
  deploy.md §11 / CLOUD_HANDOFF 同步改口。
  ② **CI**：`.github/workflows/ci.yml`，push/PR 跑 `npm ci` + typecheck + 全量测试
  （Node 按 `.nvmrc`）。
  ③ **state 库生产创建入口**：`packages/lykoi-memory/src/init-state.ts`
  （schema 正本移至 `src/schema.ts`，与生产库逐对象比对后补齐夹具缺的 9 表 /
  1 索引 / 7 触发器；deploy.md 新增 §4c，§13 缺口 1-3 改为已有入口）。
  三处待治理决断：mind_schema 台账只落一行 16；owner id 写死 `user_001`；
  夹具表全集随之扩大。
  ④ 本文件第四节加**教训索引**（主题 / 编号 / 固化状态，逐条核实到路径）；
  重号「6.」改 6a/6b。`governance/README.md` 改回单仓库事实。
  ⑤ README「当前状态」改为可核日期陈述。
  测试基线：**859 / 848 过 / 11 跳过 / 0 失败**，typecheck 净。
- **未做（被 Mac 权限拦下，留 Kevin 手跑）**：把分叉副本归档——
  `mv ~/Documents/lykoi/docs ~/Documents/lykoi/archive/docs-pre-monorepo-2026-09-02`、
  `mv ~/Documents/lykoi/lykoi-governance ~/Documents/lykoi/archive/lykoi-governance-repo-2026-09-02`
  （已逐文件核实：旧治理仓所有差异均为 subtree 侧更新；docs/ 含 Mac 时代独有史料，只归档不删）。
- **索引单附带发现，未改**：(a) `governance/docs/bin-dispatch_2026-08-21.sh:15` 白名单
  只有 `.venv/bin/python|pytest` 前缀，无 `node`/`npm`——派 Cordis 实现单跑 `npm test`
  会被拒，服务器现行 `~/bin-dispatch.sh` 版本待核；(b) `packages/lykoi-gate/src/verify.ts:578`
  仍用 `accessSync(W_OK)` 判 audit sink 可写，以 root 跑会假阳性（教训 8 的 Cordis 同形）。
- 下方 09-01 快照其余部分仍有效。

### 旧快照存档（2026-09-01 刷新；已被上方 2026-09-02 快照部分取代）

- **M4 切换完成，新体上线**：`lykoi-cordis.service` = 现行身体，生产树钉
  detached `m4-switch`（六器官位翻开：llm-deepseek / memory / converse /
  wake / telegram-transport / telegram；learn 位退役 = D-FIX-2 定案）。
  切换窗当夜事故（占位条目被翻开 → loader 炸）当夜完全修法关单
  （wo/WO-M4-FIX-WAKE/，教训 47/48）。当夜的「首拍实证」后被证伪
  （子串 grep 计入了 failed，教训 53）——真首拍见下条 WO-INC-LLM-ROUTE。
- **WO-INC-LLM-ROUTE 已关（2026-09-01 午后，W1 Day 1 事故例外）**：W1 首日
  读数揭出**认知断流**——route 名对不上 vendor 常量，她自切换起 18 拍全败。
  修正 = route: deepseek-official / model: deepseek-v4-flash / budget 键随名，
  生产树钉更新为 **acb814f**（= main 1e82ad8 + 六翻位；5f706bd 作废），
  manifest 重签、八检查项全绿。**12:38:10 本地 = 她上线以来第一次成功的
  自主思考**（精确 autonomy_wake 0→1；同 runId 两笔 charge：阶段 4b 认知
  13907 tokens + SA-171 整合/专注 16705 tokens——SA-171 首次活体实证）。
  W1 醒拍/预算基线自修复落地重新起算；跟进项 = lykoi-llm finish{error}
  外显（教训 53）。
- **WAVE-OBS-PREP 已收官（2026-09-01 10:36 落地稿 B 全绿）**：四单全关——
  ① WO-STATE-CANON（var/state symlink 定案 + 门检查项⑧，教训 49）；
  ② WO-CACHE-PERSONA（getPersona 进程缓存 + path 守卫；产线两 personaToml
  同路径，两器官共享同一内核对象）；③ WO-GUARD-RETIRE（护栏旧体条目退役，
  事故驱动，教训 50，PROTECTED_PATHS 收敛两条 + 检查项④探针换防 canonical
  state）；④ WO-CORE-RETIRE（四跑收敛 v1→v4，教训 51：旧体 12 单元/
  browser-profile/控制器 19 件/旧仓/state 22 项全封存，crontab 整表退役，
  僵尸 notify_push 确死；两封存区可 mv 回滚）。生产树钉 **5f706bd**
  （= main f37aac8 + 六翻位），manifest 103 文件重签，**八检查项产线全绿**，
  12 插件起立，起立后 journal 零报错。已知缺口：offsite_backup 随旧
  crontab 停转，**新体无异地备份**——观察周后跟单。
- **观察周 W1 进行中（2026-09-01 起算）**：runbook =
  `governance/docs/observation_week_1_runbook_2026-09-01.md`（NRestarts
  基点 626，看增量）。观察期内不签新器官单。之后主线 = **认知线**
  （心脏—大脑—器官深化；Kevin 2026-09-01 授权治理侧选定；Mac 线缓行）。
  候选首单：U2 器官自感知（OrganInventoryCache 脚手架已在 converse/wake
  import 面）。
- 下方 08-31 快照仍有效的部分：单仓库化、CF-1 路线、M0–M3 全 PASS、
  云端对接、进度正本指引。其「M4 W3 卡点」「旧体现状五服务 active」
  两条已被本快照取代。

### 旧快照存档（2026-08-31 刷新；已被上方 2026-09-01 快照部分取代）

- **本仓库已是唯一仓库**（2026-08-31 单仓库化）：原独立治理仓 `lykoi-governance`
  与旧 Python 仓 `lykoi` 已从 GitHub 删除（完整 bundle 存 Mac
  `~/Documents/lykoi/archive/repo-bundles-2026-08-31/`），治理平面全史以 subtree
  并入现仓 `Kevinwu901113/lykoi` 的 `governance/` 子目录。本文件里所有指向独立
  治理仓的旧路径，一律按 `governance/` 前缀换算；工单目录 = `governance/wo/`。
- **路线已换轨（2026-08-24 Kevin 拍板 CF-1 = 完全移植）**：Lykoi 整体迁
  Cordis(TS/Node) 运行时（= 本仓库 `packages/` 插件树），旧体渐进改造队列
  （U3S-FIX、追认/决断清单等）全部让位。三样不解除：数据即身份（memory.db
  原样接管零迁移）、治理特权层等价重建、费用硬顶首单落地。总案
  `docs/cordis_full_migration_plan_v1_2026-08-24.md`。
- **移植进度：M0–M3 全落库复核 PASS**（M0 规格封存四单 → M1 骨架两波 →
  M2 心智五波 433/433 → M3 治理四波 754/754），报告全在 `wo/WO-M*/`。
  **M4 W1 构建波 + W2 部署材料已落**：W1 = undici 钉版代理、
  `profile/index.prod.ts` 双写死入口、GK-15 活规则退钉面，测试 797/0，
  切换分支 `m4-switch`；W2 = `wo/WO-M4-W2/`（runbook + paste-1/paste-2 +
  units + approval-briefing）。三决断项 Kevin 已按默认值批（GK-8 通知推送
  维持关 / E3 计税维持现状 / D-01 = 30s/1次/180s）。
- **当前卡点 = M4 W3 切换窗，只等 Kevin 三样**：①Mac 打 bundle+scp、
  BUNDLE_SHA 填进 paste-1；②sudoedit 填 telegram token；③定窗跑两稿 +
  E 步实弹四链。窗后 48h 观察 → CORE-RETIRE 收尾窗另呈批。
- **旧体现状**：服务器 Python 五服务仍 active，活体 HEAD `4463ae8` =
  tag `cordis-night-20260822`。U3 切换态 08-24 首夜 36 分钟止损回影子态
  （DeepSeek json 空回复 + 对话轮 tool_call 零审计两缺陷）——两缺陷已在
  新体出生规格里消灭（G-10 / D-01 / D-02）。
- **M5 已立项**：首器官 browser（`wo/WO-M5-ORGAN-BROWSER/charter.md`；
  旧 browser-profile 4.3GB 封存不迁移，她自己账号重新登录）。
- **云端对接（2026-08-31 起）**：仓库根 `CLAUDE.md` = 一切 Claude Code 会话
  入口；云端（claude.ai/code）会话必读本目录 `CLOUD_HANDOFF.md`——云端无
  SSH、无 Mac 记忆，定位 = 执行 Agent，一切交接走 git。
- **进度正本指引**：逐日流水仍在服务器 `~/reports/governance-ops.jsonl`
  （云端不可读）；仓库内最接地的状态源 = `wo/` 下日期最新的工单目录。

### 旧快照存档（2026-08-21 深夜二次校准；已被上方 2026-08-31 快照取代）

- **进度正本已迁移**：逐日进度看服务器 `~/reports/governance-ops.jsonl` 与主治理
  Agent 记忆，本节以下的历史条目停在 2026-08-10 前后，仅作背景。
- **活体 HEAD `32238013` = 初始化节点 `init-node-20260821`**（8-21 23:33 Kevin
  root 落地，治理侧哈希对帐核验）：包 14（审批送达 v2，问句=引用回复不吃打扰
  预算）+ 包 15（GW-01 Delegation Gateway 数据面+管线面，delegation 机器休眠
  零扰动）。回滚 tag `rollback-pre-init-node`(=1b8ef063)。
- **Owner 三裁决（8-21）**：撤销证据采样（gate-readout 定时器已退役）；**明示
  授权 U3 盲切**（红线解除）；节点砍到两包收口。**切换键此刻仍关**——WO-U3S
  （切换读者实现）执行中/待复核，落地=另一张小粘贴稿（ff+drop-in 翻转+
  HARD_ASK_TYPES 加固捎带）。
- C 线：WO-CA-BASELINE-1 复核 PASS（报告=C-B 设计正本输入，三个设计问题待
  Kevin：模型对下一拍发言权/显著性源二选一/层1-2节律锚）；GW-02（Runner+
  broker+S4a）待签发；GW-01 复核件里有 GW-02 交接清单。
- 待验：E 步实弹（让她跑终端任务→问句应引用回复）结果未回。
- 长期债：offsite rsync 死目标、S4a 四条+broker 未上线、R-CA-1/2 小单候选、
  遗留总账 `docs/open_routes_inventory_2026-08-13.md`。

### 已完成

| 项 | 状态 |
| --- | --- |
| 白皮书 v1.1 | 定稿，四大新定案（单主用户 / 群聊三级脱敏 / 感知数据独立类 / 单写者原则） |
| 治理协作方案 v1 | 定稿并实施 |
| **阶段 0 基线审查与资产清点** | **完成**，五单全验收，见 `reports/baseline-review-summary_2026-08-07.md`。白皮书 31.3 产物 11 项中 10 项齐备（缺"数据迁移风险"，依赖阶段 2 数据模型设计） |
| 备份加固（WO-FIX-BACKUP-01/02/03） | 已部署。覆盖从 2 项扩到 **13 项**；第 13 项是非密钥整机重建配置包，含 allowlist 内 25 个配置文件与 13 个 systemd drop-in，secrets 仍由 owner 带外重签 |
| Mac 异地备份 | launchd 每 6h 拉取，已生效；`20260809T032908Z` 正式备份服务器/Mac 13/13 逐文件 SHA-256 一致 |
| **首次恢复演练** | **通过**，见 `reports/restore-drill_2026-08-07.md`。应用代码能从备份重建人格提示词（226 字符）；Mac 副本 sha256 一致 |
| 恢复脚本 + 灾难恢复手册（WO-FIX-RESTORE-01） | 已部署 |
| **S1 事件日志脱敏 + S5 完整性清单补 memory 包** | **已部署生效**（合并 `7b567cec`） |
| **S2 持久浏览器 SSRF 防护** | **已部署生效**（合并 `cf314c36`）。活体实测 `browser.navigate()` 对 `127.0.0.1:8080` / `192.168.0.202:7890` / `file:///etc/passwd` 全部 `UrlBlocked` |
| **P3 自主动作 CWD 隔离** | **已部署生效**（合并 `cf4a6338`）。`terminal.exec` 默认工作目录为 `/home/lykoi/workspace/autonomy`；专项 + P0 共 34 passed，启动门与活体 `pwd` 复核通过 |
| **SEC-03 page-level CDP 请求拦截** | **已部署生效**（合并 `b5cf7553`）。同一 page target 的 redirect/click/form/JS/subresource 进入常驻 Fetch guard；health=`browser_request_guard:ready`；合并后专项 + P0 88 passed，四服务 active 且 `NRestarts=0` |
| **GUARD-01 root 权限假阳性修复** | **已部署生效**（合并 `35ef7c86`）。audit 父目录改读 `st_mode` 组/其他写位；合并后 57 passed，root 与 `lykoi` 双身份启动门均 OK，四服务 `NRestarts=0` |
| **BACKUP-03 非密钥整机恢复配置包** | **已部署并闭环**（合并 `74f5907c`）。正式 13/13 恢复演练 PASS；配置包 SHA-256=`8d214d1e...f7f0`，source HEAD 正确、无 secrets 路径；Mac 13/13 哈希一致 |
| **干净机器从零重建演练（WO-DRILL-CLEANVM-01）** | **通过**（2026-08-09，ALL GREEN 34/0）。privileged LXD 容器内凭 13 项备份+bundle+占位 secrets 重建到 9 服务 active + /health ok + 审计链 append-only。可复用脚本 `rebuild_from_zero.sh` 与 10 项差距清单在工单目录；真 VM 复跑可选待 Kevin 定 |

| **阶段 2 首批落地（P2-01 数据模型 + P2-03A broker）** | **已合并生效**（2026-08-09 深夜，Kevin 以 root 执行两次合并）。活体 `74f5907c`→`c308b792`→**`89d0247f`**。合并后我以 lykoi 身份验证：startup_verify OK、p0 25 passed、迁移+percept 22 passed、broker 10 passed、四服务 active 且 NRestarts=0、/health ok。**回滚 tag：`rollback-pre-p2-01`(94be1f2e)、`rollback-pre-p2-03a`(c308b792)** |

**⚠️ 两件尚未做的（合并 ≠ 生效）**：
1. **活体 memory.db 迁移未执行**——合并后实测仍为 `schema v9`、`users` 表不存在。
   执行迁移是独立动作，需停 autonomy 的 10–30 分钟窗口（设计 v1 §6 决议 5），与 Kevin 另约。
2. **broker 未部署**——`lykoi-broker` inactive，单元文件仍是草稿（User 占位），
   且 **S4a 上线门四条活体验证未做**（见 `wo/WO-P2-03A/review.md` §3）。

**活体当前 HEAD：`89d0247f`**（旧记录：`74f5907c`）。三服务 + watchdog 全部 active/running、`/health` 200 且 browser request guard=`ready`、四服务 `NRestarts=0`、工作树 `## main`（2026-08-09 BACKUP-03 收工时独立复核；本单未重启服务）。

### 🔀 双窗口并行中（2026-08-10）

Kevin 同时开了两个窗口，分工：

| 窗口 | 负责 | 工作副本 |
|---|---|---|
| A（原窗口） | **S2 审批解释器**（分支 `wo/p2-s2`，触及 `kernel/`） | `~/lykoi-work` |
| B（新窗口） | **L1 档案/原料分离**（分支 `wo/l1`，触及 `mind/`/`memory/`） | `~/lykoi-work-l1`（独立 worktree） |

**两者都在 manifest 覆盖的六目录内**——按教训 26 本该串行。并行的前提与解法写在
**`wo/WO-L1/handoff.md` 第二节**（独立 worktree + 合并时重跑 `--write-manifest` +
在该文件末尾记录谁先合并）。**新窗口开工前必须读它。**

L1 的完整材料（前因证据链 / 内容 / 后果 / 可直接派发的工单正文 / 验收要点）
在 `wo/WO-L1/briefing.md`。

### ⚡ 新窗口接手：立刻要知道的五件事（2026-08-09 深夜写）

1. ✅ **WO-P2-01 已完成并复核通过**（2026-08-09 深夜结束，`EXIT=0`）。提交 `c308b792`
   在分支 `wo/p2-01`，复核报告 `wo/WO-P2-01/review.md`——**结论：通过，建议 ff-merge**。
   **真实备份副本迁移验证全绿**（我在 Mac 上对 `memory.20260809T032908Z.db` 实跑）：
   v9→v10、7 张表、回填 6860 行**逐表精确**、默认值全为 private/content、幂等、
   `downgrade_v10` 可回 v9 且表清单一致、owner_primary 唯一约束生效、
   integrity ok / 0 FK 违规。它报告的 14 个全量失败经我核对确为既有环境伪影。
   **两件待办**：①请 Kevin 授权合并 `wo/p2-01` 与 `wo/p2-03a` 两分支；
   ②**活体迁移执行是独立动作**，需停 autonomy 的 10–30 分钟窗口，与代码合并分开进行。

   （下面是它运行期间的查法，保留备用：WO-P2-01 = 阶段 2 数据模型 migration。）
   查状态：
   ```
   ssh lykoi-gov 'grep "^EXIT=" ~/wo/WO-P2-01/run.log | tail -1; wc -l < ~/wo/WO-P2-01/report.md; pgrep -cf "claude -p"'
   ```
   出现 `EXIT=` 行即结束（`EXIT=FAILED_ALL_RETRIES` 表示三次重试全败）。产出在
   `~/lykoi-work`（分支 `wo/p2-01`），**已知它写了** `migrations.py`、`percept_buffer.py`、
   `tests/test_p2_data_model_migration.py` 并更新了 `guardian/manifest.sha256`。
   **它有不提交就退场的毛病（见教训 23），先 `git status` 看工作树再判断成败。**

   **我（上一窗口）已做的部分复核，可直接采信**：
   - 专项测试 `tests/test_p2_data_model_migration.py` **16 passed**（我亲跑，非采信自述；
     耗时 580s 是因与它的全量测试抢磁盘 I/O）。
   - 设计 v1 §2 要求的 **7 张表全部就位**：users / identity_bindings / contexts /
     context_members / memory_scopes / procedures / note_insight_links；
     另 `percept_buffer.py` 建独立库（percept_events + percept_schema 版本表）。
   - `role='owner_primary'` 的**部分唯一索引已实现**（§2.1 防错映射要求）。
   - 回填逻辑在 `_backfill_memory_scopes()`，默认值符合"拿不准往严"
     （user_001 / ctx_direct_user_001 / private / content）。
   - **逆迁移都有**：`downgrade_v10()` 与 percept 的 `downgrade_v1()`。
   - **manifest 已登记 percept_buffer**（它记得 manifest 纪律，难得）。
   - ⚠️ **未完成的复核**：它的全量 pytest 跑到 19% 时已出现 **2 个失败**（当时仍在跑，
     `~/lykoi-work/full_final.log`）。**必须查清这 2 个失败是它引入的还是既有的**——
     它改过 `tests/conftest.py` 与 `tests/test_core_v1_event_outbox.py`，有嫌疑。
     另需补：幂等性与逆迁移的实跑验证、以真实备份副本（Mac `~/lykoi/backups/`）
     测一次回填规模。
2. **broker 已提交未合并**：`wo/p2-03a` 分支 `49cdd029`（8 文件 699 行，
   `src/lykoi/broker/` 独立 worktree `~/lykoi-work-broker`）。专项测试 10/10 已复核，
   六目录零改动。**待与 P2-01 一起做正式合并评审**。
3. **重大设计转向已定案**：`docs/lykoi_embodiment_redesign_v1_2026-08-09.md`——
   Lykoi 改为**通过她自己使用的社交软件（Telegram 起步）与 Kevin 相处**，
   Mac 退化为纯感知器官（app UI 退役），审批从按钮改为**对话式三层门**。
   九条决议已锁定，Kevin 已批准 Telegram 起步与实施顺序。
4. **Mac lane 的完整计划**在 `wo/WO-MAC-M1/plan.md`，含一条关键约束：
   **M1a（独立感知服务）可立刻开工，M1b（退役 app UI）必须等 Telegram 通道上线并稳定**——
   否则 Kevin 与 Lykoi 完全失联。
   **→ M1a 已于 2026-08-09 深夜完成**（Mac 仓库分支 `wo/mac-m1a`@378b9a6 已推 GitHub，
   报告 `mac/docs/WO-MAC-M1A-report.md`）：47 测试全绿、独立运行时端到端冒烟 200、
   互斥实测通过；**TCC spike 结论 = launchd 路线通**（"Lykoi Codesign" 签名的 venv
   python，仅剩系统设置两项授权待 Kevin 点）。服务默认不加载，生产路径仍是 app 内嵌。
   **→ 2026-08-09 23:20 全部闭环**：TCC 两项已授权（probe 复核 true/true）；percept 专用
   token 已发（服务器 `LYKOI_PERCEPTION_TOKEN` + Mac Keychain `percept-token`，实测
   percept=200 / surface=401 / garbage=401——surface token 已不再能打 ingest，信任边界
   收窄生效；app 不受影响，其上行走本地 mock）。仅剩可选项：受限 SSH key、首次
   `service.sh load` 时机（均待 Kevin 拍板，不阻塞任何事）。
5. **Mac 已做过全盘清点与归拢**：`docs/mac_asset_inventory_2026-08-09.md`；散落 17 项
   已归到 `~/Documents/lykoi/archive/`（MANIFEST 可回滚）；`stash@{0}` 是已作废的 D 层
   OCR 聚合器半成品，**不要复活**。

### 进行中的任务

当前没有已派发的执行工单。**干净机器从零重建演练已于 2026-08-09 通过**（`wo/WO-DRILL-CLEANVM-01/`，
ALL GREEN 34/0——环境是生产 VM 上的 privileged LXD 容器 `rehearsal`，非独立 VM；
真 VM 复跑可选、材料现成，等 Kevin 定夺过门口径与容器去留）。
**2026-08-09 晚 Kevin 授权主治理 Agent 直接动手，已完成**：
② **BACKUP-04 已合并生效**（活体 HEAD `74f5907c`→**`94be1f2e`**，`wo/WO-BACKUP-04/`）——
deployment_config 包新增 pip-freeze.txt 与 root-owned.tsv，下次 04:17 cron 起自动携带；
合并后 pytest p0 25 passed、无服务重启。
③ **灾难手册已修订**（audit sink `chattr +a`、persona 0440、governance flags 实况、
bundle `-b main`、pycache 清理、root 属主复刻，均写回 runbook_disaster_recovery.md）。
仍待 Kevin：① 过门口径认定 / 是否真 VM 复跑（30 分钟，命令见 CLEANVM-01 report §5.1）与
容器去留（`lxc stop` 仍卡 2 个 D 态 snapd，无害）；④ **阶段 2 联合设计 v0 已成稿待评审**：
`docs/phase2_joint_design_v0_2026-08-09.md`（数据模型×Gateway×S4 一份设计，含 6 步实施
顺序与 5 个待 Kevin 拍板的开放问题）——v1 冻结前不动手实施。

### 交接期核查（2026-08-09，Claude 回归后对 Codex 工作的独立复核）

Codex 接手期间的四单**全部经独立验证通过**，非采信自述：

| 项 | 独立验证方式 | 结果 |
| --- | --- | --- |
| P3 工作区隔离 | 活体调 `terminal.exec({"command":"pwd"})` 及三类逃逸 | 默认落 `/home/lykoi/workspace/autonomy`；`../..`／`/etc`／代码仓库路径均 `WorkspaceEscape` ✓ |
| SEC-03 CDP 拦截 | 查 `/health` 实际返回 | `browser_request_guard: ready` ✓ |
| GUARD-01 假阳性修复 | 读代码确认 `os.access` 已换成 `st_mode` 位判断（第 365-369 行注释明确写了 identity-independent） | ✓ |
| BACKUP-03 13 项 | 列最近备份集实际文件 | 13 项齐全含新增 `deployment_config` ✓ |
| 完整性 / 启动门 | `pytest tests/test_p0_integrity.py`、`startup_verify`（lykoi 身份） | 25 passed / exit 0 ✓ |
| 遗留清理 | 查 `P`、`\|` | 已删除 ✓ |

**已由继任者补做的两件事**：治理仓库 8 个未推提交已 `git push`；`governance-ops.jsonl` 补录 4 条部署记录（标注 backfilled、ts 为补录时刻）。对应纪律见第四节 5b / 5c。

### 阶段 1 剩余（按建议顺序）

| 优先级 | 项 | 说明 |
| --- | --- | --- |
| 完成 | **CDP 层请求拦截** | **已部署生效**：`wo/WO-FIX-SEC-03/`，生产合并 `b5cf7553`。同一 page target 的 redirect/click/form/JS/subresource 由常驻 Fetch guard 覆盖；health=`ready`。popup/new target、代理 DNS 与断线间隙仍明确列为残余风险 |
| 完成 | `os.access` 假阳性 | **已部署生效**：`wo/WO-FIX-GUARD-01/`，生产合并 `35ef7c86`。staged/live 与 manifest 三方一致，root/`lykoi` 双身份启动门均 OK |
| 3 | S4 Secret 收紧 | 无 vault，密钥明文在进程环境，同 uid 进程读 `/proc/<pid>/environ` 即得（他们自己的 canary 脚本就是这么读的）。工程量最大，**建议与阶段 2 的 Gateway 设计一并规划**——凭证句柄本身就是 Gateway 的一部分，单独做会返工 |
| 进行中 | 全量重建演练 | BACKUP-03 已完成 13 项备份、服务器真实恢复与 Mac 哈希验收；仍未在干净 Ubuntu 24.04 VM 从零启动。下一步只做 clean-VM rehearsal，不碰生产运行状态 |

### 阶段 2（白皮书 36 章留白的兑现）

- **数据模型设计**：`user_id` + 语境作用域 + 感知数据类 + 程序性经验结构**一次性进 Schema**——四者要动同一批表，分开做会返工
- **Delegation Gateway 设计**：从 `kernel/dispatch.py` 的 `DispatchContext`（只有 `origin` + `run_id`，无委托主体/子代理身份/隔离域）扩展。**我们的工单机制已是 Gateway 的活原型**，设计可从跑通的机制泛化，不必纸上发明
- **学习链路修复（P1）**：`autonomy_notes → insights` 晋升 + 血缘表，并解开 `core/shadow.py:263/281` 那两个 `CHECK` 约束

---

## 六、必须知道的几个系统事实

- 服务器是 Proxmox VM（persona 配置 `embodiment = "lapwing-home VM (vmid 110)"`），主机名 `lykoi`
- 模型栈：**deepseek-v4-flash**（主）+ **mimo-v2.5**（视觉），走 api.deepseek.com
- 9 个 `lykoi-*` systemd 服务；四进程主体 = watchdog（root，只用标准库，故意的）+ surface(uvicorn 8080) + core.runtime(unix socket) + cognition.autonomous
- 所有端口绑 loopback：8080 surface / 9222 CDP / 5900 VNC / 6080 noVNC
- cron 两项：`notify_push` 每分钟、`offsite_backup` 每日 04:17
- **代码基线** main@`8a613a1e` = 白皮书审计基线（现 HEAD 已含本轮修复）
- 白皮书正本在本仓库 `governance/docs/`（现行 v1.2）；服务器副本 `lykoi@~/白皮书v1.2.md`；**服务器只保留最新版，更新时旧版直接删**

### 三个结构性缺口（白皮书结论章）

1. 群成员身份解析、用户记忆与语境隔离（**`user_id` 全库出现 0 次**）
2. 专业 Agent 委托与隔离（**Gateway 无挂载点**）
3. 程序性学习、验证与可靠性积累（**被数据库 CHECK 约束显式钉死**）

### 学习链路断裂（最值得记住的一条发现）

自主循环把观察写进 `autonomy_notes`，代码注释写明"晋升由 integrator 定期治理"，但**那段代码不存在，血缘表 `note_insight_links` 在 schema 里也不存在**。这条断链已被基线代码编码为诊断信号 `CV1-LRN-001`（severity high）。白皮书说人格成长是 [PARTIAL]，物理原因就在这里。

---

## 七、和 Kevin 协作的注意事项

- 他要**结论先行**，不要长篇铺垫；要诚实标注不确定和未验证的部分
- 他批准过的事：治理平面独立账户 + 窄口 sudo（**明确否决了 blanket root**，理由是"把不该做变成做不到"）；备份修复；恢复演练；GitHub 治理仓库
- **需要 root 的操作他自己执行**——给他命令时要精确到权限位和顺序，并给回滚点
- Mac 侧有权限分类器会拦某些操作（自我提权类、写权限规则、动她的记忆库）。**被拦了就停下来说明并交回给他**，不要绕
- 他家宽带故障中，MacBook 走手机热点，注意别做大流量操作（备份拉取是 rsync 增量，约 5MB/天，可接受）

---

## 八、接手第一步建议

> ⚠️ 本节写于 2026-08-08：第 3 条的期望值（HEAD/服务数）与第 4 条的"下一步"
> 早已过时，现状一律以第五节 2026-08-31 快照为准；本节保留的是流程骨架。

1. 读白皮书 v1.2 + 协作方案 + 本文件（尤其第四节的教训清单）
2. `ssh lykoi-gov` 确认能连；按第二节的表逐项验证权限边界（应能读代码、读不到 secrets 与 core.sock）
3. 确认活体健康：`ssh lapw1ng.com 'cd ~/projects/lykoi && git log --oneline -1; systemctl is-active lykoi-server lykoi-autonomy lykoi-core lykoi-watchdog; curl -fsS http://127.0.0.1:8080/health'` —— 期望 `74f5907c`、四个 active、health 含 `browser_request_guard=ready`
4. 下一步执行干净 Ubuntu 24.04 VM 从零重建演练；不要直接在生产恢复、不要把 secrets 放进备份。该门通过后再做 S4 Secret + 阶段 2 Delegation Gateway 联合边界设计。除非 Kevin 改变指示，不使用 Opus/Sonnet，主治理 Agent 直接实施
5. 按标准流程收：复核代码 → **自己跑测试**（`git worktree` 到 `/tmp` + 活体 venv，别碰活体检出）→ **必跑 `pytest tests/test_p0_integrity.py`** → 给 Kevin 精确到权限位与顺序的部署命令 + 回滚点

### 一次完整的复核长什么样（照抄这个流程）

以 SEC-02 为例，五步缺一不可：

1. 读 `git show --stat` 与完整 diff，判断改动方向是否符合工单
2. `git worktree add /tmp/xx-test <分支>`（以 lykoi 身份），用 `~/projects/lykoi/.venv/bin/python -m pytest` 跑相关测试
3. **功能性验证**——不止看测试绿，要真的调用它证明目标达成（如直接 `browser.navigate()` 打内网地址看是否 `UrlBlocked`）
4. 反向核对（如遍历六目录确认每个 `.py` 都在 manifest 里）
5. 写 `wo/<WO-ID>/review.md` 归档，记 `governance-ops.jsonl`，给 Kevin 部署命令

**这套流程在 SEC-01 和 SEC-02 各抓出一个会导致三服务全停的缺陷。不要跳步。**

> 一句话原则（白皮书结论章）：**可以重构 Lykoi 的软件身体，但不能未经判断地丢弃她已经形成的经历、关系和身份。**
