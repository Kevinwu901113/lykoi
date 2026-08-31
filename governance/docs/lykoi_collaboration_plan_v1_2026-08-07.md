# Lykoi 治理平面协作方案 v1

- **日期**：2026-08-07
- **地位**：所有者治理平面的工作制度文档，从属于《Lykoi 技术白皮书》（现行 v1.1）。白皮书与本方案冲突时以白皮书为准。
- **适用范围**：Lykoi 的制作过程（开发、审查、重构、文档），不适用于 Lykoi 本体的运行时行为。
- **正本**：Mac `~/Documents/lykoi/docs/lykoi_collaboration_plan_v1_2026-08-07.md`；服务器副本 `~/协作方案v1.md`。

## 1. 角色与信任域

| 角色 | 载体 | 职责 | 授权边界 |
| --- | --- | --- | --- |
| 所有者 | Kevin | 意图发起、决策、审批合并、管理覆盖 | 全部 |
| 主治理 Agent（下称主 Agent） | Mac 端 Claude Code | 协助所有者制作 Lykoi：文档正本维护、方案与工单拆解、复核验收、跨机协调、Mac 侧开发、持久记忆 | Mac 全权限；服务器只读探查 + 文档/工单投放；**不直接修改核心代码** |
| 执行 Agent | 服务器端 Claude Code（无头模式） | 主 Agent 的子 Agent，在核心仓库的工单分支上动手 | 仅受工单驱动，见 §2 |
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
- 写入范围限于 claude 家目录（`~/lykoi-work`、`~/wo`、`~/reports`）及 lykoi 家目录下的文档与工单目录。

### 2.2 执行 Agent 纪律（写入每张工单，作为硬约束）

- 只在工单分支上工作，禁止 push main、禁止改写历史；
- 禁区与主 Agent 相同：`~/state`、`~/secrets`、`core.sock`、进程管理；
- 产出 = 分支提交 + 结构化报告（report.md）；
- **自报完成不算完成**（呼应白皮书 19.2），一切以主 Agent 复核为准。

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
→ 执行 Agent 在分支实现
→ 主 Agent 复核（diff 逐行审、跑测试、验收标准逐条比对）
→ 报告 Kevin
→ 合并（需 Kevin 授权；Kevin 可对单张工单预授权）
```

## 4. 执行 Agent 调用契约

- **工作副本隔离**：执行 Agent 在 `claude` 账户的独立工作副本 `~/lykoi-work` 中干活，**不碰活体检出** `~lykoi/projects/lykoi`。分支在工作副本产出，部署到活体是独立的、需 Kevin 点头的步骤。这是 Delegation Gateway 隔离模式的先行演练。
- 入口：主 Agent 经 ssh 别名 `lykoi-gov` 在 `~/lykoi-work` 以无头模式调用 `claude -p`，工单文本（order.md）作为提示词输入。
- **代理为必需**：服务器直连 Anthropic API 返回 403（区域拦截），经局域网代理 `192.168.0.202:7890` 可用（2026-08-07 实测），无头调用时需带代理环境变量。
- 产物目录 `~/workspace/wo/<WO-ID>/`：`order.md`（工单）、`report.md`（执行报告）、`run.log`（stdout 存档）。
- 长任务可改用 tmux 交互式运行，主 Agent 定期查看。

**状态**：机制已于 2026-08-07 端到端验证通过（Kevin 重新登录后，带代理无头调用实测正常）。服务器 Claude Code 2.1.206，`~/.local/bin/claude`；代理环境变量大小写各写一份（`http_proxy`/`https_proxy`/`HTTP_PROXY`/`HTTPS_PROXY`）。

## 5. 治理操作日志

- 位置：服务器 `~/reports/governance-ops.jsonl`，JSONL 追加式。
- 每行：`{ts, actor, action, target, result, note}`。
- 规则：主 Agent 的每次服务器**写动作**必记一条；只读探查可按会话汇总记一条；执行 Agent 的工单启停由主 Agent 代记。

## 6. 文档同步纪律

- 白皮书正本在 Mac `docs/`，改动即同步服务器 `~/白皮书vX.Y.md`；**服务器只保留最新版**，版本更新时旧版直接删除（Kevin 2026-08-07 定），历史版本以 Mac docs/ 为准；
- 本方案同样双侧同步（Mac 正本 → 服务器 `~/协作方案v1.md`）；
- 服务器 `~/reports/`、`~/workspace/wo/` 的报告按需拉回 Mac `docs/reports/`；
- Mac 侧持久记忆（跨会话）由主 Agent 维护，关键决策同步写入本方案或白皮书。

## 7. 首个项目：基线审查与资产清点

白皮书第 31 章要求的 Baseline Review and Asset Inventory 是本机制的第一个工单系列。

已完成的前置验证（2026-08-07）：

- 运行代码 = 审计基线：`~/projects/lykoi` main HEAD = `8a613a1e`，与白皮书基线一致；
- 三进程 + Guardian watchdog 在运行；runtime socket、state 布局与白皮书描述相符；
- 待清点线索已记录：仓库根杂散文件（`P`、`|`）、`~/quarantine`、staging 目录、历史 bundle、`白皮书v1.0.md.old` 去留。

后续由主 Agent 拆解为 WO 系列（资产清单、数据流图、信任边界图、模块成熟度矩阵、安全风险清单等，产物对应白皮书 31.3）。

## 附录 A：Kevin 待办

（当前无。2026-08-07 两项初始待办均已完成：服务器 Claude Code 已重新登录、`白皮书v1.0.md.old` 已删除。）
