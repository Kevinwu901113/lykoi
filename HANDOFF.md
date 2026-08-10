# 交接文档 · 给下一个治理平面 Agent（Codex / Claude Code / 其他）

- **写于**：2026-08-08 凌晨
- **写作人**：主治理 Agent（Mac Claude Code，Fable 5），因额度将尽而交接
- **读者**：接手 Lykoi 治理平面工作的 Agent
- **先读这三份**：本文件 → `docs/lykoi_whitepaper_v1.1_2026-08-07.md`（最高层规范）→ `docs/lykoi_collaboration_plan_v1_2026-08-07.md`（工作制度）
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
- **本治理仓库**：`~/Documents/lykoi/lykoi-governance/`（GitHub 私有仓 `Kevinwu901113/lykoi-governance`，`gh` 已以 Kevinwu901113 登录）
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

### 关于执行 Agent

1. **工单必须写死"stdout 即报告本体，不要写文件"**，否则它只回一段聊天式摘要。这个失败模式出现过三次。
2. **必须写"禁止用摘要代替明细""宁长勿略"**，并明确列出必须包含的产物数量（例如"6 张 mermaid 图，一张都不能少"）。
3. **它自报完成不算完成。** 已抓到的真实缺陷：把可读的审计正本误判为不可读而降级、漏更新 manifest 里自己的哈希（会导致全线停机）、脚本不幂等、灾难场景下路径解析必失败。**每一条都是"报告说 OK"的情况下查出来的。**
4. **涉及权限的判断必须自己实测**——它对文件权限的推断出过错。
5. **⚠️ 最高频的致命缺陷：改了受 manifest 覆盖的文件却不更新 `guardian/manifest.sha256`。已发生两次**（SEC-01 漏更新 startup_verify.py 自身条目；SEC-02 新增 `resources/url_guard.py` 完全未登记）。两次都会导致三服务全部拒绝启动。
   **凡工单会动 `cognition/mind/memory/shared/surface/resources` 六个目录或 `guardian/` 下任何 .py，工单里必须显式写上"同步更新 manifest（改哈希 + 新增条目）"，复核时必须跑 `pytest tests/test_p0_integrity.py`。** 这一条建议直接写进工单模板。

### 关于治理平面自身的纪律（2026-08-09 新增，两条都因实际缺失而写）

5b. **每次服务器写动作 + 每次生产部署，必须记一条 `~/reports/governance-ops.jsonl`。** Codex 接手期间完成 4 次生产部署但全程零记录，审计链出现空洞，事后只能由继任者从 review 文档重建（已补录并标注 backfilled）。这条日志是治理平面自己的审计——我们要求 Lykoi 可审计，自己不能例外。

5c. **治理仓库的提交必须 `git push`。** 同期 8 个提交只落在本地工作副本，GitHub 上看不到——共享底座的全部意义（跨 Agent 交接、异地留存）在没推之前都不成立。收工前固定检查 `git log origin/main..HEAD` 应为空。

### 关于"代码事实"与"部署事实"

6. **治理工作副本是代码事实源，不是部署事实源。** 执行 Agent 曾据仓内 systemd unit 文件判定 `core/` 包（占全库 40%）是 default-off 死代码、建议删除；我用 `sudo systemctl cat lykoi-*` 查线上 drop-in，发现 M3 开关**几乎全开**——它是运行中的生产路径。**任何"是否启用"的结论都必须查 drop-in。**

### 关于部署

6. **`guardian/` 目录是 `dr-xr-xr-x root:root`，lykoi 完全不能写。** 触及 guardian 的改动**不能用普通 `git merge`**，必须 Kevin 以 root 执行。那 17 个 `/usr/local/sbin/lykoi-*-apply` 控制器就是为此存在的。
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

### 关于无头执行 Agent（2026-08-09 新增，都是本轮实际踩的）

23. **工单里不能有"等待"步骤**。WO-P2-03A 两次在"等全量 pytest 跑完"处直接结束会话
    （报告只有一句"我在等"），代码写完了却**没提交**。要么把长测试拆成独立后续单，
    要么在工单里写死"跑测试用 `timeout N` 且必须先 commit 再等"。最终由复核方代提交。
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

32. **两个时钟一混，测试就是定时炸弹**（2026-08-11，S2 交付里踩的）。
    `test_denials_are_advisory_and_expire` 用冻结时钟算"过期时刻"，但
    `record_denial` 落的是真实时钟——2026-08-10 21:00（北京）之前跑全绿，之后永久红。
    S 窗口复核和 L 窗口全量对照都在绿区跑的，谁都没看出来；Kevin 部署时才炸。
    **复核涉及时间语义的测试时，专门检查：断言里的每一个时间量，锚的是哪只钟。**
    修法是把过期锚在记录自身的时间戳上（`FIX-S2-TEST` `01a8099c`）。

---

## 五、当前进度

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
- 白皮书正本在 Mac `docs/`；服务器副本 `lykoi@~/白皮书v1.1.md`；**服务器只保留最新版，更新时旧版直接删**

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

1. 读白皮书 v1.1 + 协作方案 + 本文件（尤其第四节那 16 条教训）
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
