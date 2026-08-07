# 基线审查中期报告：第一轮直接清点（2026-08-07）

主治理 Agent 直接清点产出（只读）。执行 Agent 侧 WO-BASE-01 因代理出口问题未完成，见 §6。

## 1. 关键发现（需决策或行动）

### 1.1 备份缺陷三连（根因确诊，风险活跃）
- **锁冲突→整天丢备份**：`scripts/offsite_backup.sh` 用 `sqlite3 .backup` 时遇 `database is locked` 即中止（`set -e`），留 0 字节残骸，当日 memory 与 salience 均无备份，无重试无告警。失败日：7/28、8/1、**8/6（最近一次）**。
- **异地备份长期全灭**：rsync 目标 `192.168.0.101` 每日 "No route to host"（日志可见的每一天都失败）；仅 git push offsite 成功。她的记忆备份当前**无任何异地副本**。
- **残骸不清理**：清理逻辑只匹配 `*.db.gz`，零字节 `.db` 永久堆积。
- 完好备份验证：最近 3 份 memory .gz 与 5 份 salience .gz 均通过 `gzip -t`。最新可用 memory 备份 = 8/5 数据（2.29MB gz，活体 12MB）。
- 关联线索：`~` 与 server-integration-repo 存在 sqlite-busy-wait 修复痕迹（7/11），说明锁问题早有先例。

### 1.2 执行 Agent 通道被代理出口阻断
无头 `claude -p` 于 19:17 冒烟成功，19:35 起 403。诊断：代理 `192.168.0.202:7890` 出口现为深圳电信（14.216.150.89, CN），Anthropic API 对 CN 出口 403。需在代理侧把 Anthropic 相关域名固定走境外节点。

### 1.3 自主探索的工作目录卫生问题
核心仓库根的未跟踪文件身份确认：`P` = 繁体中文 HTML 存档，`|` = curl cookie 罐（www.uni-lions.com.tw，统一狮棒球队官网，7/29 23:23）。判断为自主网页探索的 curl 参数错位产物。内容无害；问题在于**自主进程以代码仓库为工作目录**。建议：删两文件 + 后续工单将自主行动的 CWD 隔离到工作区。

## 2. 运行资产

- **systemd 系统级服务 9 个**：lykoi-core（描述含 "observation-only M3-R0"）、lykoi-server、lykoi-autonomy、lykoi-watchdog、lykoi-chrome、lykoi-xvfb、lykoi-fluxbox、lykoi-vnc、lykoi-novnc；其中 autonomy/core/server 有 `.d` 覆盖目录。
- 进程运行时长：watchdog 7.5 天、surface 5.9 天、core 5.8 天、autonomy 2 天（各自重启点待核实）。
- 监听端口全部 loopback：8080（surface）、9222（CDP）、5900（VNC）、6080（noVNC）、40565（**归属待核实**）。
- cron：notify_push 每分钟（flock 防重入）；offsite_backup 每日 04:17。
- `~/runtime/governance/`：root 属主只读开关 `narrative_injection.on`、`self_state_injection.on`（防篡改设计）；`~/runtime/persona/lykoi_base.toml`（root:lykoi 只读）。

## 3. 数据资产（~/state，36 项）

- 活体：memory.db 12M、core_facts.db 5.6M、events.jsonl 5.9M、salience_shadow.db（含 wal/shm）、permission_evidence_shadow.db、audit.jsonl、approval_rules.json、chat_outbox/notifications/pending_actions/proactive_chat（均带 .lock）、continuations.json、screenshots/ 5.3M、core_artifacts/ 1.6M。
- 历史 in-place 快照（6 月中）：memory.db.pre_p4 / pre_V3 / pre_V4；另有 `p4_trial_t0.env`（**内容与去留待核实**）、soak_watch.log、restart_marker.json。
- backups/：daily 滚动 7 份（缺 7/28、8/1、8/6）；7 月上旬手工快照 5 份（含 root 属主 memory.pre-merge.db）。

## 4. 归档与遗迹资产

- `~/quarantine/` 约 15MB：7/13–8/1 R1C/R2A/R2B/R2C 部署战役全套遗迹（bundle 10+、root_apply 脚本 8、root 属主执行日志、命令片段、Untitled-1..5、whoami 等）。
- `~/staging-core-v1-m3-r1a1/`：candidate.bundle + apply-v3 日志（7/15）。
- `~` 根散件：core-v1-m3-r1a bundle×2、perception-retry-hotfix.bundle、sqlite-busy-wait bundle×2、p4r_purge_exec_v2.py + runbook、soak_watch.sh、`x`（830B，待核实）、lykoi-core-v1-m3-r1a-apply（60KB）。

## 5. Mac 侧资产

- core-v1-repo @ `codex/core-v1-m3-event-ingress`（8/2，**比服务器 main@8a613a1e 新，未部署工作**）；
- percept-02-mac-repo @ `codex/mac-memory-fuse-20260729`（7/29）；
- server-integration-repo @ `codex/sqlite-busy-timeout-20260711`；
- 三仓库 working tree 全部干净；
- 旧 maceye 采集器：目录在 `~/Desktop/lykoi-mac-eye`，launchd 未加载（休眠），去留待定。

## 6. 待办与阻塞

| 项 | 谁 | 状态 |
| --- | --- | --- |
| 代理规则固定境外节点（Anthropic 域名） | Kevin | **阻塞执行 Agent** |
| 答复 192.168.0.101 是什么设备、是否续用 | Kevin | 决定异地备份修法 |
| 批准备份修复工单（busy timeout+重试+告警+残骸清理） | Kevin | 工单已备好 |
| 代理恢复后重发 WO-BASE-01（代码资产清点） | 主 Agent | 等待 |
| WO-BASE-02..05（架构图/成熟度矩阵/身份连续性清单等） | 主 Agent | 排队 |
| 小项核实：端口 40565、state/p4_trial_t0.env、`~/x`、仓库 P 与 \| 删除 | 主 Agent | 排队 |
