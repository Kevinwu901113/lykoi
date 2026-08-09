# WO-DRILL-CLEANVM-01 · 演练报告

- **日期**: 2026-08-09
- **执行者**: 主治理 Agent 直接实施（未派发执行 Agent，依 HANDOFF 第八节）
- **结论**: **通过（容器保真度内 ALL GREEN：34 PASS / 0 FAIL）**。
  干净 Ubuntu 24.04 (amd64) 机器仅凭 13 项备份 + git bundle + 占位 secrets，
  可在约 25 分钟内重建到"9 服务 active + /health ok + 审计链 append-only 复原"。
- **保真度声明**: 演练环境是生产 VM 上的 **privileged LXD 容器**（ubuntu:24.04 官方镜像），
  不是独立 VM。同架构（x86_64）、同版本 OS、systemd 完整，但共享生产内核。
  正式过门是否需要 Proxmox 真 VM 复跑由 Kevin 定夺——脚本与输入包已可直接复用，
  真 VM 复跑预计 30 分钟内。

## 一、验收标准逐条核对（独立复核，非采信脚本自报）

| 标准 | 结果 | 证据 |
|---|---|---|
| startup_verify（lykoi 身份）exit 0 | ✓ | 脚本第 9 步 OK；core/server/autonomy 的 ExecStartPre 即该脚本，服务能起本身就是证明 |
| 四核心服务 active | ✓ | `systemctl is-active` 4/4 active；20 秒稳定性复测仍 4 active；watchdog/core NRestarts=0 |
| /health status=ok | ✓ | `{"status":"ok","desktop_url":"http://127.0.0.1:6080","browser_request_guard":"ready"}` |
| 4 库 integrity_check=ok | ✓ | memory/core_facts/salience_shadow/permission_evidence_shadow 全 ok；memory.db 20 张表 |
| 差距全记录 | ✓ | 见第三节 |

附加验证：9 服务全 active（含浏览器桌面栈）；Chrome CDP 9222 在线（Chrome 151）；
审计正本 `lsattr` 显示 `-a`（append-only 复原成功）且内容为备份数据；persona TOML 内容正确；
journal 无真实错误（此前"错误增长"是 grep 误匹配常规心跳里的 `skipped_errors":0` 字样）。

## 二、四轮迭代摘要（每轮修掉的根因）

1. **跑 1**: apt 走 NAT 直连代理超时（宿主转发规则不全，ICMP 通 TCP 不通）；
   `/root` 0700 导致 `sudo -u lykoi` 读不到输入。→ 加 LXD proxy device
   （容器内 127.0.0.1:7890 → 宿主代连 192.168.0.202:7890）；clone 改 root 执行后 chown。
2. **跑 2**: `git bundle` 不含 HEAD ref，`git clone` 不带 `-b main` 时工作树为空、
   下游全崩。→ **这是会咬真实灾难恢复的坑**，已固化进脚本。
   （另：SSH 断线杀死附着的 lxc exec——长任务必须服务器侧 nohup 脱管。）
3. **跑 3**: 两个真门槛——①venv 安装期间以 lykoi 生成的 `__pycache__` 触发
   startup_verify 的 protected-pycache 属主检查（规范态是删除全部缓存）；
   ②审计正本要求 `chattr +a`，非特权容器无 CAP_LINUX_IMMUTABLE 设不了。
   → 脚本清缓存；容器转 privileged（已记 governance-ops，真 VM 无此问题）。
4. **跑 4**: **ALL GREEN 34/0**。

## 三、差距清单（备份体系覆盖不到、真实灾难恢复需注意的）

| # | 差距 | 影响 | 处置 |
|---|---|---|---|
| 1 | git bundle 无 HEAD，克隆必须 `-b main` | 真实 DR 高危（照灾难手册走会得到空工作树） | 已固化进 rebuild_from_zero.sh；建议灾难手册 §2 增补 |
| 2 | `__pycache__` 属主会卡启动门 | 任何"先建 venv 后启动"的重建路径都会踩 | 脚本在权限位复刻步骤统一清除全仓缓存 |
| 3 | 审计正本需 `chattr +a`（灾难手册未提；重建复用旧机时还需先 `chattr -a` 才能覆写） | startup_verify 拒绝启动三服务 | 已固化进脚本两个方向 |
| 4 | 灾难手册 §2 两处与活体不符：persona 应为 root:lykoi **0440**（手册 0640）；governance flags 实为 2 项（narrative_injection.on 0444 + self_state_injection.on **0400**） | 权限位照手册设会与活体漂移 | 脚本按活体实测值；建议手册修订 |
| 5 | secrets 三件（llm/surface/backup.env）占位即可启动服务 | 符合设计（owner 带外重签）；autonomy 起来后 LLM 外呼会失败 | 无需改；REQUIRED_SECRETS.txt 准确 |
| 6 | `/usr/local/sbin` 17 个 apply 控制器内容不在备份内 | **实证运行时非必需**（9 服务全部正常启动）——它们是历史部署工具 | 维持设计不变 |
| 7 | Chrome 装 `current` deb 得 151，生产是 148 | 版本漂移，CDP 协议兼容目前无碍 | 如需钉版本，真实 DR 时按 packages.tsv 指定 |
| 8 | crontab 2 项演练中未安装（避免占位密钥外呼噪音） | 真实 DR 需按 metadata/lykoi.crontab 恢复 | 脚本第 12 步已给命令 |
| 9 | venv 依赖锁定靠"活体 pip freeze"，不在备份集内 | 本次是现场导出的；若服务器全失，只能按 requirements.txt 装最新版 | **建议 BACKUP-04：把 pip freeze 纳入 deployment_config 包**（一行改动） |
| 10 | root-owned.list（src 内 44 个 root 属主路径）同样是现场导出、不在备份内 | 同上；权限位复刻会不完整 | 同上，一并纳入 BACKUP-04 |

## 四、环境搭建的意外与披露

- **LXD snap 是本次意外安装的**：`/usr/sbin/lxc` 是 Ubuntu 的 snap 垫片，勘察时调用
  `lxc list` 即自动触发 `snap install lxd`（5.21.6）。已记 governance-ops 并在此披露；
  回退命令 `snap remove lxd`（会一并删掉演练容器）。
- `lxd init --auto`：dir 存储池 + lxdbr0 (10.20.104.1/24)。lxdbr0 的 DHCP 对容器未生效
  （容器内用静态 IP 解决）；NAT 对 TCP 不通（用 LXD proxy device 绕过）——疑与宿主
  防火墙规则有关，未深究（不动生产网络配置）。
- 容器转 privileged 的理由与风险：仅为复刻 `chattr +a`；输入全部可信、短生命周期，已记日志。
- **收尾状态**：容器内服务已全部停止、容器静默（3 进程 / ~365MB）；但 `lxc stop` 卡在
  容器内 2 个 D 状态 snapd 进程上（特权容器 snap seeding 的已知坑，不可强杀）。
  无资源风险；等它自解或由 Kevin 以 root 查看。**删除容器与否请 Kevin 定**：
  保留可供真 VM 复跑前参照；删除则 `lxc delete rehearsal --force` + 视情况 `snap remove lxd`。

## 五、给 Kevin 的建议（按优先级）

1. **过门认定**：容器演练已验证全部流程与工件。若按字面"VM"过门，建议在 Proxmox 开一台
   一次性 Ubuntu 24.04 VM（2C/4G/20G 足够），把 `/tmp/rebuild-input`（服务器上现成）+
   `rebuild_from_zero.sh` 拷进去，`STAMP=20260809T032908Z PROXY=http://192.168.0.202:7890 WITH_CHROME=1 bash rebuild_from_zero.sh`，预计 30 分钟。我认为容器结果已足以支撑
   "备份体系可完成从零重建"的结论，真 VM 复跑属加固性质。
2. **BACKUP-04（小改）**：把 `pip freeze` 与 root 属主清单纳入 deployment_config 包（差距 #9/#10）。
3. **灾难手册修订**：差距 #1/#3/#4 写回 runbook_disaster_recovery.md。
4. 阶段 2（数据模型 + Delegation Gateway + S4 联合设计）此门后可开。
