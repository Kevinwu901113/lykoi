# 云端会话交接文档（claude.ai/code）

- **写于**：2026-08-31（Mac 主治理 Agent 起草，Kevin 审定）
- **读者**：在 claude.ai/code 云端环境里打开本仓库的 Claude Code 会话
- **前置读物**：仓库根 `CLAUDE.md` → `governance/HANDOFF.md` →
  白皮书 v1.2 → 协作方案 v1。本文件只讲**云端特有**的边界与工作方式，不重复它们。

---

## 一、你在什么环境里（先认清自己的处境）

你运行在 Anthropic 托管的 Ubuntu 沙箱里，代码来自 GitHub
`Kevinwu901113/lykoi` 默认分支的一份 clone。这意味着三个**硬边界**：

1. **没有服务器通道**。沙箱走安全代理，出站 SSH 被平台禁止。你物理上
   连不上 lapw1ng.com，也读不到活体状态、audit、governance-ops 日志的实时值。
   HANDOFF.md 里所有 `ssh lykoi-gov …` 的段落对你都是**只读知识，不是可用能力**。
2. **没有 Mac 侧记忆**。Mac 主治理 Agent 的本机记忆（用户偏好、跨会话上下文）
   不会同步给你。你对项目的全部认知 = 本仓库内的文件。仓库里没写的，你就不知道，
   不要脑补；拿不准就在产出里显式标注"待核实"。
3. **对话不迁移**。Mac 侧治理会话的历史不会出现在你这里；你的会话可以被
   `claude --teleport <session-id>` 拉回 Mac 终端，反向不行。

由此推出的第一纪律（与 CLAUDE.md 同源，此处重申）：
**绝不声称做过服务器/Mac 侧动作，绝不模拟"我查过活体了"。**
本项目的事故史里，"假完成/无据陈述"出现频率最高、代价最大（EXIT=0 假阳性、
"另一窗口自称跑完了实际没跑"、无据机制猜测等，见 HANDOFF 教训清单）。

## 二、你的角色

默认定位 = **执行 Agent**（协作方案 v1 三角色表的第三行），在云端沙箱这个
天然隔离的工作副本里按工单干活。治理决策权在 Kevin；治理线（签发工单、复核、
落地协调）默认在 Mac 主治理 Agent，除非 Kevin 在会话里明示把某项治理职责交给你。

**你的一切产出必须落在 git 里才算存在。** 会话结束沙箱即回收；没 push 的工作
等于没做。规矩：

- 一律开分支干活（工单单 = `wo/<name>`；杂项 = `cloud/<主题>`），**不直接 push main**。
- 完成即 push + 出 PR（或按工单要求出报告文件），由 Mac 治理线复核合并。
- 报告一次性完整输出，写进 `governance/wo/<WO-ID>/report.md` 随分支提交。

## 三、你能做什么 / 不能做什么

**适合交给云端的活**（都在仓库树内闭环）：

- `packages/` 内的 TS 开发与测试（`npm ci` → `npm test` → `npm run typecheck`）；
- 工单执行：按 `governance/wo/<WO-ID>/order.md` 实现 + 自测 + 报告；
- 只读审计/复核：读 diff、复跑测试、逐条对验收标准，出复核报告草稿；
- 文档维护：蓝图、deploy.md、白皮书批次草稿、工单/粘贴稿**草稿**（执行仍归有通道方）；
- 大扫描类任务：全仓 grep 审计、依赖清点、测试覆盖缺口分析。

**不能做 / 禁止做**：

- 一切服务器动作（连不上，也不许绕道：不得让任何外部服务代为连接）；
- 碰 secrets/真值：不在任何文件、环境变量、日志里写入真实 token/密钥；
- 动 `packages/lykoi-kernel` / `packages/lykoi-gate` 而无工单授权；
- 修改治理决策记录（governance-ops 性质的既往记录、已定案文档的定案内容）；
- 把 [PLANNED]/[EXPLORATORY] 的设计当作已实现能力写进代码注释或报告。

## 四、开机自检（每个新云端会话建议先跑）

```
git log --oneline -5          # 确认自己基于哪个提交
npm ci && npm test && npm run typecheck   # 确认基线绿（当前基线见 HANDOFF 进度节）
```

然后确定"现在项目走到哪了"，按新鲜度取用（几份文档的快照日期可能不一致，
**以日期最新者为准**）：

1. `governance/wo/` 里日期最新的工单目录（order/report 是最接地的状态源）；
2. 本文件第六节快照（写作当日准确）；
3. `governance/HANDOFF.md` 进度节（角色/纪律/教训以它为正本，但其快照
   可能更旧，且其中"逐日进度看服务器 governance-ops.jsonl"对云端不可用）。

## 五、与 Mac / 服务器的交接协议

所有跨环境协作走 git，没有第二条通道：

- **接活**：Mac 治理线把工单写进 `governance/wo/<WO-ID>/order.md` 并 push；
  Kevin 在云端开会话让你执行。
- **交活**：你 push 工单分支（代码 + report.md），在会话里报分支名与尖 commit。
- **需要服务器侧配合**（部署、活体读数、root 动作）：产出=写清楚的申请/粘贴稿
  草稿，放 `governance/wo/<WO-ID>/`，push 后在报告里点名"待有通道方执行"。
- **紧急发现**（安全问题、真值入库、红线冲突）：立即在会话里直接向 Kevin 报告，
  同时在分支里留书面记录。

## 六、状态快照（2026-08-31，仅当日准确，之后以 HANDOFF.md 为准）

- **单仓库化完成**：本仓库是唯一仓库（原 lykoi-cordis 改名 lykoi）；治理仓全史
  已以 subtree 并入 `governance/`；旧仓已删，bundle 存 Mac 归档。
- **移植进度**：M0–M3 全部落库复核 PASS；M4 W1（构建波，含 undici 代理、
  index.prod.ts 双入口、GK-15）+ W2（部署材料八件，`governance/wo/WO-M4-W2/`）
  已落；M4 W3 切换窗 2026-08-31 完成，新体上线。**2026-09-02 起 `main` 的
  `profile/cordis.prod.yml` 即生产装配**（六器官位启用），`m4-switch` 翻位分支废止；
  落地钉 main 提交。
- **旧体**：已退役（WO-CORE-RETIRE，2026-09-01）；封存区可 mv 回滚。
- **M5**：首器官 browser 已立项（`governance/wo/WO-M5-ORGAN-BROWSER/charter.md`，
  Playwright 形态，旧 browser-profile 不迁移）。
- **测试基线**：850 项 / 839 过 / 11 跳过（devstate 夹具缺席）/ 0 失败（2026-09-02；以最新工单报告为准）。CI：`.github/workflows/ci.yml` 跑 typecheck + 全量测试。

## 七、给 Kevin：云端环境一次性配置清单

1. **GitHub 授权**：在 claude.ai/code 给 `Kevinwu901113/lykoi` 装 GitHub App
   （或会话内 `/web-setup` 同步 gh token）。仓库私有，必须授权后云端才 clone 得到。
2. **环境（Environment）设置**：
   - Setup script（首跑缓存）：
     ```bash
     # Ubuntu 24.04 沙箱自带 Node 未必 ≥24，装齐再 npm ci
     curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
     npm ci
     ```
   - 网络访问级别：**Trusted** 足够（npm registry + GitHub 在默认名单内）。
   - 环境变量 / secrets：**一个都不要配**。本仓库 dev profile 零真网零凭据即可
     跑通全量测试；云端永远不需要 DeepSeek key / Telegram token / 服务器凭据。
3. **派发方式**：Mac 终端 `claude --cloud "<任务>"`，或网页/手机 claude.ai/code
   直接开。拉回本地用 `claude --teleport <session-id>`。
4. 本文件与根 `CLAUDE.md` 有实质变更时，视同 HANDOFF.md 的"四处同步"纪律
   （本仓库内只有一处正本，push 即同步）。
