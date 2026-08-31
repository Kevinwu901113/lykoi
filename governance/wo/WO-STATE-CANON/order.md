# WO-STATE-CANON · GK-6 state 落点调和：var/state 符号链接定案 + 门检查项

> 签发：2026-09-01（治理侧，观察周前完善波 WAVE-OBS-PREP 第一单）。
> 执行形态：Mac 本地 Opus 子 Agent（工作副本 `~/Documents/lykoi/lykoi-cordis`）。
> 分支 `wo/state-canon`，基 = main `27dd4f3`。

## 背景（切换窗遗留缺口 #2，2026-09-01 治理侧实勘）

`profile/cordis.prod.yml` 尾部「生产 state 路径全表」（GK-6 钉面 canonical）
声称新体逐字沿用 `/home/lykoi/state/` 下的活体身份文件（approval_rules /
standing_grants / pending_actions / notifications / proactive_chat /
chat_outbox / telegram_undelivered / telegram_outbox.cursor / messenger 两件 /
salience_shadow.db），注明「本文件与源码缺省必须与它逐条一致」。但：

- 源码缺省全部是**相对路径** `var/state/…`（如 `packages/lykoi-kernel/src/
  approval.ts:36`）；unit env 面只有凭据（前置 #11）、`profile/index.prod.ts`
  零 env 读取——生产运行时实际落点 = 仓库内 `var/state/`。
- 调和机制显然是 **`var/state` → `/home/lykoi/state` 符号链接**（`var/` 在
  .gitignore；dev 装配用真实目录），但该 symlink **从未进任何部署材料**
  （deploy.md / W2 paste-1 均零提及），服务器上也不存在。
- 实测后果：2026-09-01 01:18（止损重启）服务进程在仓库内 mkdir 了真实目录
  `var/state/` 并写入 `telegram_outbox.cursor`（唯一分叉文件；审批面诸文件
  因懒加载尚未分叉）。她此刻的审批记忆一旦被触发就会在错误落点新开副本。

## 治理定案（随单记录）

- **D-SC-1**：调和走 **symlink**（生产机 `var/state` → `/home/lykoi/state`，
  lykoi 属主）。**不改**源码相对缺省（dev 用真实目录的既有形态维持）、
  **不加** unit env（前置 #11 维持）。落点分叉这一失败模式由完整性门消灭。
- **D-SC-2**（落地侧自留，不在本单）：分叉游标处置——落地稿核
  `var/state/chat_outbox.json` 不存在（今晚零出站）则弃分叉游标、保 canonical
  旧游标；否则停手报治理。
- **D-SC-3**（退役单自留）：旧体 notify_push 轮询器先退役，本单落地在后。

## 判据（每判据一 commit，`[WO-STATE-CANON]` 前缀）

① **门检查项**：`packages/lykoi-gate` verify 面新增「state 落点调和」检查：
   仓库相对 `var/state` 必须**是符号链接且 realpath = `/home/lykoi/state`**；
   为真实目录 → FAIL（含清晰讯息）；**不存在 → 同样 FAIL**（运行时
   writeJsonAtomic 会 mkdir 真实目录，缺失=未来分叉）。
   - 激活条件：只在生产 gate 运行形态（ExecStartPre 的 `cli.ts` 检查路径）
     生效，dev 装配与现有测试不误伤。**先侦查 verify.ts / cli.ts 既有检查项
     的组织结构与生产判定方式，对齐同形接入**，侦查结论写进报告。
   - 测试：三态（正确 symlink → OK / 真实目录 → FAIL / 缺失 → FAIL），
     用临时目录构造，不依赖真实 `/home/lykoi`（symlink 目标可参数化或
     以既有测试对 canonical 常量的注入方式为准——侦查后对齐）。
② **部署材料**：`docs/deploy.md` 与 `governance/wo/WO-M4-W2/paste-1-prepare.sh`
   增 symlink 供给步（树落地后：`sudo -u lykoi ln -sfn /home/lykoi/state
   <REPO>/var/state`，注意先建 `var/` 父目录）；runbook 若有对应步骤面同步。
   prod yml 尾表补一行注释说明调和机制与门检查项（**只加注释，不动实体配置**）。
③ **全量收口**：仓库根 `npm test` + `npx tsc --noEmit` 全绿；基线 800 通过 /
   0 失败 / 11 skipped（27dd4f3 时点）。新数字如实报，失败逐条归因
   （单点无常失败先查真实时钟 vs 夹具日期）。报告写
   `governance/wo/WO-STATE-CANON/report.md` 并入本 commit。

## forbidden

- 不改任何源码相对缺省路径（`var/state/…` 字符串维持——调和靠 symlink 是
  定案本体）。
- 不动 `profile/cordis.prod.yml` 实体配置（只许尾表加注释）。
- 不动 kernel / heart / converse / wake / decide / memory 等邻接包实体代码。
- 不新增依赖、不改 package-lock。
- 不碰 m4-switch 分支；不 push。
- 测试前台串行跑完再交卷；最终输出必须是完成全部判据后的完整报告
  （教训 23/44：禁"稍后接上"、禁后台监听交卷）。

## required_evidence（报告最低集）

- 每判据 commit sha + 关键 diff 摘要。
- 侦查结论：既有检查项结构、生产判定方式、新检查项接入点的选择理由。
- 三态测试的红→绿自证（先证真实目录/缺失会 FAIL，再证 symlink 通过）。
- 全量测试与 typecheck 的原样末尾输出。
