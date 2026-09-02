# 灾难恢复运行手册（Disaster Recovery Runbook）

适用场景：服务器（`/home/lykoi` 所在主机）丢失或损毁，需要用备份把 Lykoi 重新拉起来。

依据：本手册基于 2026-08-07 主治理 Agent 完成的恢复演练（见 WO-FIX-RESTORE-01 工单），
演练验证了备份集完整性、4 个 SQLite 的 `integrity_check`、行数一致性、
persona TOML 内容、以及 `build_persona_prompt()` 功能性调用。演练脚本见
`scripts/restore_drill.sh`。

---

## 1. 前置条件

### 1.1 取哪一份备份

按优先级：

1. **服务器本地**：`/home/lykoi/state/backups/daily/`（如果服务器磁盘还在、只是服务挂了，优先用这份，最新最全）。
2. **Mac 异地副本**：`~/lykoi/backups/server-state/daily/`（服务器彻底丢失时用这份；已验证与服务器逐字节一致 sha256）。

同一时间戳 `<STAMP>`（形如 `20260807T030001Z`）下的一组文件算一份完整备份集，共 12 项。
`daily/` 下每类文件滚动保留最近 7 份，选一个所有项都存在的时间戳。

§2 表里的**第 13 项 `browser-profile.<STAMP>.tar.gz` 是手工项，不在 `daily/` 里**：
日备份 `/usr/local/sbin/lykoi-cordis-backup.sh` 由 `lykoi-cordis-backup.service` 以
`User=lykoi` 运行，而 `/home/lykoi-browser/profile` 是 `700 lykoi-browser` —— 它读不到，
现有定时器不会产出这一项。要这份快照得 root 手工执行 §2 第 13 行的三步
（stop → tar → start）。把它纳入日备份需要一个以 root 身份运行的独立定时器，
留作 M5 后续，不在 WO-M5-ORGAN-BROWSER 范围内。缺它不影响前 12 项的还原。

### 1.2 依赖

在目标机器（新服务器或重建后的原服务器）上需要：

- `sqlite3` CLI（用于 `.backup` 出来的库做 `PRAGMA integrity_check` 与后续读写）
- Python venv：仓库自带 `.venv`，或按 `pyproject.toml` / `requirements` 重建，需能 `import lykoi`
- 系统包：`gzip`、`tar`（解包备份用）、`rsync`/`ssh`（如需要从异地拉备份）
- 以 `lykoi` 用户身份操作应用相关文件；`root:lykoi` 属主的文件（persona TOML、audit log、
  governance flags）需要 root 权限设置属主/权限

---

## 2. 恢复顺序与落点

按依赖顺序执行；每一步的"落点"和"权限"必须对上，否则应用/审计链会读不到或写不进。

| # | 备份项 | 还原命令要点 | 落点路径 | 属主/权限 |
|---|---|---|---|---|
| 1 | `memory.<STAMP>.db.gz` | `gzip -dc memory.<STAMP>.db.gz > /home/lykoi/state/memory.db` | `/home/lykoi/state/memory.db` | `lykoi:lykoi` 0600（沿用同目录下其它库的权限） |
| 2 | `core_facts.<STAMP>.db.gz` | 同上 | `/home/lykoi/state/core_facts.db` | `lykoi:lykoi` 0600 |
| 3 | `salience_shadow.<STAMP>.db.gz` | 同上 | `/home/lykoi/state/salience_shadow.db` | `lykoi:lykoi` 0600 |
| 4 | `permission_evidence_shadow.<STAMP>.db.gz` | 同上 | `/home/lykoi/state/permission_evidence_shadow.db` | `lykoi:lykoi` 0600 |
| 5 | `events.<STAMP>.jsonl.gz` | `gzip -dc ... > /home/lykoi/state/events.jsonl` | `/home/lykoi/state/events.jsonl` | `lykoi:lykoi` 0600 |
| 6 | `audit.<STAMP>.jsonl.gz` | 同上（这份历来是 0 字节，正本见下一项） | `/home/lykoi/state/audit.jsonl` | `lykoi:lykoi` 0600 |
| 7 | `audit_log.<STAMP>.jsonl.gz` | `gzip -dc ... > /var/log/lykoi-audit/audit.jsonl`。**该文件带 `chattr +a`（append-only），startup_verify 会验**：还原后必须 `chattr +a`；若目标机上已有旧文件，覆写前先 `chattr -a`（2026-08-09 演练实证，容器环境还需 CAP_LINUX_IMMUTABLE） | `/var/log/lykoi-audit/audit.jsonl` | **`root:lykoi` 0660 + `+a` 属性**（需 root；目录本身 `root:lykoi` 0750） |
| 8 | `approval_rules.<STAMP>.json.gz` | `gzip -dc ... > /home/lykoi/state/approval_rules.json` | `/home/lykoi/state/approval_rules.json` | `lykoi:lykoi` 0600 |
| 9 | `pending_actions.<STAMP>.json.gz` | 同上 | `/home/lykoi/state/pending_actions.json` | `lykoi:lykoi` 0600 |
| 10 | `core_artifacts.<STAMP>.tar.gz` | `tar xzf core_artifacts.<STAMP>.tar.gz -C /home/lykoi/state/` | `/home/lykoi/state/core_artifacts/` | `lykoi:lykoi`，目录内原权限随 tar 还原 |
| 11 | `lykoi_base_persona.<STAMP>.toml` | 直接 `cp` | `/home/lykoi/runtime/persona/lykoi_base.toml` | **`root:lykoi` 0440**（需 root；2026-08-09 按活体实测修订，旧版手册误写 0640） |
| 12 | `governance_flags.<STAMP>.txt` | **不是可还原资产**，见下 | `/home/lykoi/runtime/governance/*.on` | 见下 |
| 13 | `browser-profile.<STAMP>.tar.gz`（**手工项，不在 `daily/` 里** —— 日备份以 `User=lykoi` 跑，读不到 700 的 profile；打这份快照要 root 手工执行下面三步） | 打包：`systemctl stop lykoi-browser.service` → `tar -C /home/lykoi-browser -czf browser-profile-$(date +%Y%m%dT%H%M%SZ).tar.gz profile` → `systemctl start lykoi-browser.service`（**保持 enabled，不要 disable** —— LANDING-G 实证 disable 会卸载单元、丢 InactiveEnterTimestamp；运行中的 profile 不是一致快照）。还原：`tar xzf browser-profile.<STAMP>.tar.gz -C /home/lykoi-browser/` 后 `systemctl start`。缺这一项不影响大脑起动，只是她那双手的登录态要重新登一遍 | `/home/lykoi-browser/profile/` | `lykoi-browser:lykoi-browser` 0700（目录内原权限随 tar 还原） |

**关于 `governance_flags.<STAMP>.txt`**：这份文件只是 `ls -la` 存在性快照（因为 lykoi 对
`runtime/governance/` 目录本身无读权限），不含内容，不能直接"还原"出治理开关文件。
恢复时需要人工打开这份 txt，看当时哪些 `*.on` 文件存在（文件名即开关名），
然后由 root 在 `/home/lykoi/runtime/governance/` 下手动重建同名空文件（或按最新治理决策
review 后决定是否要重建全部/部分开关），属主 `root`，不对 `lykoi` 开放写权限。
2026-08-09 时点的实况：目录 `root:root 0755`，2 个开关——`narrative_injection.on 0444`、
`self_state_injection.on 0400`（权限位照快照里的 `ls -la` 逐项复刻，不要一律 0444）。

**关于代码检出与启动门（2026-08-09 从零重建演练新增，三条都会直接卡启动）**：

1. **git bundle 不含 HEAD ref**：从 bundle 克隆必须 `git clone -b main <bundle> <dest>`，
   否则得到空工作树且无报错提示（只有一行 warning），下游步骤全部静默失败。
2. **venv 装完必须清字节码缓存**：`find <repo> -name __pycache__ -prune -exec rm -rf {} +`。
   以 lykoi 身份建 venv/首次 import 会生成 lykoi 属主的 `__pycache__`，startup_verify 的
   protected-pycache 检查会拒绝（缓存的规范态是"不存在"）。
3. **root 属主复刻**：`src/` 下有 44 个路径必须 root 属主（清单见 deployment_config 包
   `metadata/root-owned.tsv`，BACKUP-04 起随备份携带）；guardian/ 整目录 root:root
   （目录 0555、文件 0444）。venv 依赖版本锁定用同包 `metadata/pip-freeze.txt`
   （`pip install -r requirements.txt -c <freeze>`）。

**可执行形式**：以上全部流程已固化为 `wo/WO-DRILL-CLEANVM-01/rebuild_from_zero.sh`
（干净 Ubuntu 24.04 amd64 通用，容器/VM 均验证过），灾难时优先用它，本手册作为对照与解释。

**执行顺序建议**：先还原 1-4（SQLite，应用启动前必须就绪）→ 5-9（JSONL/JSON 状态文件）→
10（core_artifacts）→ 11-12（需要 root 介入的两项，可与前面并行准备，但 root 操作本身
建议放最后统一做，减少来回切换权限的次数）。

---

## 3. 无法从备份恢复的部分（重要）

以下路径 **不在** `daily/` 备份范围内，恢复流程无法覆盖，必须显式列出并单独处理：

| 路径 | 内容 | 重建来源 |
|---|---|---|
| `/home/lykoi/secrets/*`（含 `backup.env` 等） | API key、SSH 目标、其它密钥 | **不可从备份恢复**，需要重新签发/重新配置。找持有原始凭证的一方（密钥管理系统或最初签发渠道）重新下发，不要尝试从任何快照里"找回"旧密钥。 |
| `/etc/systemd/system/lykoi-*.service` 及其 drop-in | 服务部署配置（启动命令、环境变量引用、依赖关系） | 从本仓库 `deploy.sh` / 部署文档，或运维方保存的 IaC/配置管理仓库重建；若两者都没有，需要凭当前运行经验手写并交叉核对。 |
| `/var/lib/lykoi-attention-policy/` | 注意力策略文件 + 对应 SHA256 校验值 | 从本仓库 `policies/attention/` 下的策略源文件重新生成部署，并重新计算 SHA256（不要从旧备份/日志里的哈希值反推内容）。 |
| `/etc/lykoi-core-v1-m2/*.env` | Core v1 M2 运行环境变量 | 从部署文档 / 运维方配置管理系统重建；必须与本次重建的 secrets、service 配置协同核对，避免环境变量引用了不存在的密钥路径。 |

这四类的共同点：要么是敏感凭证（不应该出现在可读备份里，这是设计使然，不是遗漏），
要么是部署层配置（跟着基础设施走，不跟着应用数据走）。**不要试图绕过这个限制去别处找
这些文件的历史副本**——如果确实需要，走正常的密钥重新签发 / 部署配置重建流程。

---

## 4. 验证清单

恢复完成后，按顺序确认：

1. **跑 `scripts/restore_drill.sh <STAMP>`**（用刚才恢复所用的同一个 `<STAMP>`，或不传参数
   默认取最新一组）。脚本只读 `daily/` 备份 + 只读比对活体，不会碰到刚恢复的正式路径本身，
   但它验证的 SQLite `integrity_check`、行数、persona diff、`build_persona_prompt()` 与你
   刚才手动还原出来的文件应该是同一份数据源，逻辑上等价于对恢复结果的确认。
   退出码 0 才算通过；非 0 要看输出里标 `[FAIL]` 的行逐条排查。标 `[SKIP]` 的行不计入
   VERDICT（例如新机器上还没建 `.venv`，功能性测试会跳过而不是判 FAIL），但脚本末尾
   `SKIPPED (...)` 汇总里列出的项代表覆盖率不完整，事后要补做。

   **环境变量覆盖（灾难场景常用）**：
   - `LYKOI_REPO`：仓库根目录。脚本默认按自身路径的上级目录推导，但灾难恢复时脚本经常是
     单独拷出来运行（不在完整仓库结构里），此时该推导会失败（解析成 `/` 之类），必须显式
     指定，脚本才能找到 `.venv` 和 `src/lykoi` 来跑功能性测试。
   - `LYKOI_BACKUP_DIR`：备份组所在目录，默认 `/home/lykoi/state/backups/daily`。从 Mac
     异地副本或其他路径演练时用它指向实际位置。

   两者的解析结果都会打印在脚本输出开头的 `# repo root:` / `# backup dir:` 里，便于确认。

   **幂等性**：脚本可以在同一个隔离目录反复运行（纳入每月例行 / 每次重构前跑一遍），
   默认每次运行都会清空并重建隔离目录（清空前会打印一行提示），所有写入点写入前先
   `rm -f` 目标、写入后统一 `chmod 0644`，因此备份源文件是只读（如 persona TOML 常见的
   `0640 root:lykoi`）也不会导致第二次运行时复制失败。若需要保留上一轮产物用于对比，
   加 `--keep`（此时脚本不清空目录，但仍会覆盖同名文件，不会因为旧文件只读而报错）。

   **`memory.db table count` 的统计口径**：脚本输出里会给两个数字——原始
   `sqlite_master` 计数（包含 `sqlite_sequence` 等 SQLite 内部记账表）和排除 `sqlite_*`
   前缀后的计数（对应人工用 `sqlite3 <db> .tables | wc -w` 核对时看到的数字）。两者相差 1
   通常就是 `sqlite_sequence`（由某张表的 `AUTOINCREMENT` 列自动创建），不代表表丢失或
   多出；核对表数量时按脚本标注的口径对齐，不要直接比较两个不同来源的裸数字。

   示例：从 Mac 备份副本直接演练（脚本本身也是从副本里拷出来运行，不在仓库结构内）：
   ```
   LYKOI_REPO=/home/lykoi/projects/lykoi \
   LYKOI_BACKUP_DIR=/Volumes/Backup/lykoi-daily \
   bash /Volumes/Backup/lykoi-daily/restore_drill.sh
   ```
2. **启动顺序**：先确认第 3 节里列出的 secrets / systemd 配置 / attention policy / env 文件
   都已就位，再 `systemctl start` 相关 `lykoi-*` 服务；不要在密钥缺失的情况下启动，
   会产生大量鉴权失败噪音。
3. **健康检查端点**：服务起来后调用应用的健康检查接口（参照部署文档里记录的端点），
   确认返回正常。
4. **看日志**：
   - `/var/log/lykoi-audit/audit.jsonl` 新写入的事件时间戳是否连续（确认审计链没有断档，
     或者断档范围符合预期——即宕机期间）。
   - `journalctl -u lykoi-*` 里没有反复重启 / 数据库锁 / 权限拒绝之类的错误。
   - 应用自身日志里 persona 加载、insights 读取是否报错。

---

## 5. 已知限制

- **回溯窗口有限**：每类备份文件本地滚动只保留最近 7 份（`daily/` 下 `.gz`/`.tar.gz` 等
  按 mtime 保留最新 7 个），也就是说本地最多能回溯到 7 天前；异地（Mac）副本保留策略与本地
  同步，不提供更长的历史窗口。如果需要恢复到 7 天以前的状态，本备份体系做不到。
- **JSONL 快照可能截断末行**：`events.jsonl` / `audit.jsonl` / `audit_log.jsonl` 是用
  `cp` 做的时间点快照（非事务性），如果备份脚本运行的瞬间正好有一行还在被写入，
  该文件末行可能是不完整的 JSON。恢复后如果解析 JSONL 遇到最后一行报错，直接丢弃该行
  即可（不影响之前的历史记录），不代表整份备份损坏。
- **`governance_flags.txt` 只是存在性快照**：见第 2 节，不含内容，必须人工重建。
- **恢复脚本本身是只读演练工具**：`scripts/restore_drill.sh` 只解包到 `/tmp` 隔离目录做校验，
  不会帮你把文件写到第 2 节列出的正式落点——正式落点的还原（含 root 操作那两项）仍需人工
  按第 2 节的表逐项执行。
