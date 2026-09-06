# Lykoi 治理平面协作方案 v1

- **日期**：2026-08-07；执行制度修订：2026-09-06（Kevin 授权落实指令审阅建议）
- **地位**：所有者治理平面的工作制度文档，从属于《Lykoi 技术白皮书》（现行 v1.2）。白皮书与本方案冲突时以白皮书为准。
- **适用范围**：Lykoi 的制作过程（开发、审查、重构、文档），不适用于 Lykoi 本体的运行时行为。
- **正本**：本仓库 `governance/docs/lykoi_collaboration_plan_v1_2026-08-07.md`；按当前 Git 检出定位，不以历史绝对路径选择工作副本。

## 1. 角色与信任域

| 角色 | 载体 | 职责 | 授权边界 |
| --- | --- | --- | --- |
| 所有者 | Kevin | 意图发起、决策、审批合并、管理覆盖 | 全部 |
| 主治理 Agent（下称主 Agent） | Kevin 指定的治理会话 | 方案与工单、隔离实现、协调独立复核、跨机协调、文档维护 | 可在已授权工单的隔离分支直接修改核心代码；实际文件系统与工具权限仍有效；不得修改活体检出 |
| 执行 Agent | 按当前任务安排的本地或远程会话 | 在工单隔离分支实现 | 仅受工单驱动，见 §2；不因模型或执行位置获得额外权限 |
| Lykoi 本体 | 服务器核心进程 | 被制作的主体，**不是本方案的协作方** | 对其运行状态的操作不在本方案授权内，一律按白皮书治理 |

**界定**（Kevin 2026-08-07 确认）：主 Agent 的定位是**协助所有者制作 Lykoi**，不在 Lykoi 的委托体系内。白皮书第 17 章 Delegation Gateway 约束的是 Lykoi 委托的专业 Agent，不直接适用于治理平面；但治理平面**自愿遵守等价纪律**——工单即任务合同（对应白皮书 18 章）、复核即验证平面（19 章）、操作日志即审计——并作为未来 Gateway 机制的先行试点。

## 2. 访问与纪律

### 2.1 账户隔离（2026-08-07 建立）

治理平面使用独立 Unix 账户 `claude`（uid 1001，附属 `lykoi` 组），不再与 Lykoi 本体共用账户。Mac 侧 ssh 别名 `lykoi-gov`，专用密钥 `~/.ssh/lykoi_governance_claude`。

**由权限位强制的边界（实测验证）**：

| 目标 | 权限 | claude 账户 |
| --- | --- | --- |
| `~lykoi/projects/lykoi`（代码） | 0775 lykoi:lykoi | 可读（组写位存在，但纪律上不写，见下） |
| `~lykoi/state/**` | 0750 lykoi:lykoi | 只读 |
| `~lykoi/secrets/**` | 0700 lykoi | **读不到**（系统拒绝，非自觉） |
| `~lykoi/runtime/core-v1/core.sock` | 受限 | **访问不到** |

**窄口 sudo**（`/etc/sudoers.d/claude-governance`，全部只读）：`systemctl status/cat lykoi-*`、`journalctl -u lykoi-*`、`ls /usr/local/sbin/`、读 systemd 单元与 `runtime/governance/*` 开关。越界（如读 secrets）被 sudo 拒绝。**刻意不给**：任意 root shell、写权限、服务重启（保留给 Kevin）。

### 2.2 主 Agent 纪律（权限位之外的自我约束）

- 不向 `core.sock` 发送任何内容；
- 不利用组写位修改活体检出 `~lykoi/projects/lykoi`——代码改动一律在治理平面自己的工作副本进行（见 §4）；
- 不停止、重启核心进程（Kevin 明示授权除外）；
- 服务器写入范围限于 claude 家目录（`~/lykoi-work`、`~/wo`、`~/reports`）及 lykoi 家目录下的文档与工单目录。

### 2.3 执行 Agent 纪律（写入每张工单，作为硬约束）

- 只在工单分支上工作，禁止 push main、禁止改写历史；
- 禁区与主 Agent 相同：`~/state`、`~/secrets`、`core.sock`、进程管理；
- 产出 = 分支提交 + 结构化报告（report.md）；
- **自报完成不算完成**（呼应白皮书 19.2），以独立复核为准；实现者不得自签独立验收。

## 3. 工单机制

沿用 Mac 侧已验证的 WO 惯例（一单一分支、`[WO-XXX-NN]` 提交前缀、验收报告归档），扩展至服务器。

工单格式借用白皮书 18 章委托任务合同骨架：

```yaml
work_order:
  id: WO-XXX-NN
  goal: <一句话目标>
  context: <仓库、分支、相关文件>
  scope: <允许改动的范围>
  forbidden: <禁区（含 §2.2 全部条目）>
  success_criteria: <逐条可验收>
  required_evidence: <git diff、测试输出、报告>
```

流程：

```
Kevin 意图
→ 主 Agent 写工单（落 ~/workspace/wo/<WO-ID>/order.md）
→ 主 Agent 直接实现或按任务安排执行 Agent 在隔离分支实现
→ 未参与实现的复核方验收（完整 diff、适用检查、验收标准逐条比对）
→ 报告 Kevin
→ 合并（需 Kevin 授权；Kevin 可对单张工单预授权）
```

执行、澄清、阻塞和分阶段完成的现行规则统一见根 `CLAUDE.md`。本次允许主 Agent 隔离实现，不改变合并授权、root/生产归属、特权层工单与独立复核要求。

## 4. 执行 Agent 调用契约

- **工作副本隔离**：实现者在经核验的隔离工作副本和工单分支中干活（历史服务器副本为 `claude` 账户的 `~/lykoi-work`），**不碰活体检出** `~lykoi/projects/lykoi`。分支在工作副本产出，部署到活体是独立的、需 Kevin 点头的步骤。这是 Delegation Gateway 隔离模式的先行演练。
- 历史服务器入口（使用前核验可用工具、通道与配置；不是强制派发要求）：主 Agent 经 ssh 别名 `lykoi-gov` 在 `~/lykoi-work` 以无头模式调用 `claude -p`，工单文本（order.md）作为提示词输入。
- 历史代理条件：2026-08-07 的服务器调用直连返回 403，经局域网代理可用；该配置不适用于所有会话。需要复用时按 [历史执行器配置](archive/agent-dispatch-2026-08-07.md) 核验当前网络和 CLI，不改动未授权的代理设置。
- 产物目录 `~/workspace/wo/<WO-ID>/`：`order.md`（工单）、`report.md`（执行报告）、`run.log`（stdout 存档）。
- 长任务可改用 tmux 交互式运行，主 Agent 定期查看。

**状态**：机制已于 2026-08-07 端到端验证通过（Kevin 重新登录后，带代理无头调用实测正常）。服务器 Claude Code 2.1.206，`~/.local/bin/claude`；代理环境变量大小写各写一份（`http_proxy`/`https_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`）。

## 5. 治理操作日志

- 位置：服务器 `~/reports/governance-ops.jsonl`，JSONL 追加式。
- 每行：`{ts, actor, action, target, result, note}`。
- 规则：主 Agent 的每次服务器**写动作**必记一条；只读探查可按会话汇总记一条；执行 Agent 的工单启停由主 Agent 代记。

## 6. 文档同步纪律

- 白皮书与本方案正本在本仓库 `governance/docs/`；报告归档在 `governance/wo/` 或 `governance/reports/`。工作分支提交并推送，合并另按已有授权执行。
- 服务器文档同步仅在本次任务或既有明确授权范围内进行；先核验实际目标路径。删除服务器旧版本仍须满足既有明确授权，不能仅因本地文档改动自动触发清理。
- 服务器报告按任务需要取回并归档；未同步的服务器副本应明确标注，不影响本地文档实现阶段的如实交付。
- 跨会话记忆仅在用户明确授权时更新，并遵循宿主允许的存储方式；关键项目决策记录在仓库，不能只存在于本机记忆。

## 7. 首个项目：基线审查与资产清点

白皮书第 31 章要求的 Baseline Review and Asset Inventory 是本机制的第一个工单系列。

已完成的前置验证（2026-08-07）：

- 运行代码 = 审计基线：`~/projects/lykoi` main HEAD = `8a613a1e`，与白皮书基线一致；
- 三进程 + Guardian watchdog 在运行；runtime socket、state 布局与白皮书描述相符；
- 待清点线索已记录：仓库根杂散文件（`P`、`|`）、`~/quarantine`、staging 目录、历史 bundle、`白皮书v1.0.md.old` 去留。

后续由主 Agent 拆解为 WO 系列（资产清单、数据流图、信任边界图、模块成熟度矩阵、安全风险清单等，产物对应白皮书 31.3）。

## 附录 A：Kevin 待办

（当前无。2026-08-07 两项初始待办均已完成：服务器 Claude Code 已重新登录、`白皮书v1.0.md.old` 已删除。）
