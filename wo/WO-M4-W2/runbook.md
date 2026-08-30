# WO-M4-W2 · 停机切换部署 runbook（治理侧主笔）

状态：材料齐备，待 Kevin 定切换窗时间。
树钉点：lykoi-cordis **m4-switch = `ebaeda839dc17d5db919f9a5e6ce4ec49240fcb2`**
（= main `27f4682a94dd04f0fd6ae29c9e859931e031eba3` + 七个器官位翻开）。
一切标识符按 2026-08-31 对真树与真服务器取证写成（教训 42：不凭记忆写粘贴稿）。

## 1 · 全景

```
窗前（随时可做，不触旧体）      窗内（停机窗，R-01 严格串行）        窗后
────────────────────────      ──────────────────────────────      ─────────────
paste-1-prepare.sh             paste-2-switch.sh                   48h 观察期
  Node24 → /opt                  停旧（watchdog 最先）               │ 旧体保持可启动
  bundle → clone → 钉点          确认进程清 → 备份 state             │ watchdog.timer 在岗
  npm ci --ignore-scripts        GK-9 预授权（dry-run → 实跑）        ▼
  audit sink / persona 权限      门验 gate: OK                      CORE-RETIRE 收尾窗
  凭据文件 / chown / 签名        enable --now 起新                   （另呈批，前置 #2）
  unit 三件（装而不启）          验收八条 / E 步实弹
                                 （任一不过 → 回滚段）
```

## 2 · 材料清单（本目录）

| 文件 | 用途 |
|---|---|
| `paste-1-prepare.sh` | 窗前 root 粘贴稿（幂等，可整稿重跑）。自含 unit 三件与探针的 heredoc |
| `paste-2-switch.sh` | 窗内 root 粘贴稿：停旧→备份→预授权→门验→起新→验收八条；文末回滚段 |
| `units/*` | unit 三件 + watchdog 探针的正本（与 paste-1 heredoc 逐字同源） |
| `approval-briefing.md` | 追认呈批稿（M3 攒批 7 条 + M4 复核决断批）——**窗前 Kevin 过目** |

main 前进后的重钉法：`git checkout m4-switch && git rebase main && git push -f`，
然后把本 runbook 与 paste-1 里的两处 sha 换成新值（只此两处，`grep -rn ebaeda8` 可核）。

## 3 · 关键取证事实（2026-08-31，`ssh lykoi-gov` 只读）

- **网络**：直连 api.telegram.org 超时（curl 000）；经 `http://192.168.0.202:7890`
  1.2s 通（302）→ 代理已入 prod 装配（M4 代理决策）。github.com / registry.npmjs.org /
  nodejs.org 皆直连可达（200）→ npm ci 与 Node 下载不需代理。
- **仓库私有**（匿名 404）→ 树走 **git bundle**（Mac 打包 scp，服务器零 git 凭据），
  bundle sha256 手核，clone 时 git 自校验对象完整性。
- **服务器**：Ubuntu 24.04.4，x86_64，系统 Node **v18.19.1**（新体要 ≥24 → 钉版
  tarball 装 `/opt/node-v24.18.0`，root 属主，不动系统 node）。
- **旧体认知面 5 个 unit**（停序即 paste-2 顺序）：`lykoi-watchdog`（root，看的是
  lykoi-server，**必须最先停**）→ `lykoi-server` → `lykoi-telegram` →
  `lykoi-autonomy` → `lykoi-core`。display 栈（chrome/xvfb/fluxbox/vnc/novnc）
  **刻意不动**：封存的浏览器躯体，退役另批（WO-M5-ORGAN-BROWSER §3.5）。
- **旧 unit 凭据形态**：全走 `EnvironmentFile`（im.env / llm.env / surface.env）——
  新 unit 沿用同形态；`lykoi-telegram` 旧 unit 里设着 `LYKOI_TELEGRAM_PROXY`
  （旧体走 env 代理），新体这条**必须未设**（GK-6），代理改走签名装配面。
- **state**：`/home/lykoi/state` 共 45M；`approval_rules.json` 已在新体规范路径
  （GK-9「原样搬」= **原地接管，零拷贝**）；`salience_shadow.db-wal` 在（旧体在写
  → 备份必须停稳后做）。人格 TOML 已在规范路径，sha =
  `df3bc2f2c15869ad2c8d0de5a701c1acd24a0f62a6bcab73a889b310ef25dd56`
  （活体现况 root:lykoi 440 → 窗前改 root:root 444，内容零改动）。
- **凭据**：deepseek key 的 env 名 = `DEEPSEEK_API_KEY`（vendor 缺省，非 LYKOI_*，
  不触前置 #11「unit 只一条 LYKOI_*」）；llm.env 已存在（旧体在用）。telegram token
  入新文件 `telegram-cordis.env`，**Kevin 手填，治理侧永不经手值**。

## 4 · 需要 Kevin 手做的（仅三样）

1. Mac 上打 bundle + scp（命令在 paste-1 头注），把 bundle sha 填进 paste-1 的
   `BUNDLE_SHA`。
2. `sudoedit /home/lykoi/secrets/telegram-cordis.env` 填
   `LYKOI_TELEGRAM_BOT_TOKEN=<值>`（若 llm.env 缺 `DEEPSEEK_API_KEY=` 行则一并补）。
3. 定窗、跑两份粘贴稿、E 步实弹（手机上：普通消息 / terminal.exec 批准 / 拒绝 /
   unclear 四条链）。

## 5 · 验收与回滚

验收八条 = `m4_handoff.md §D` 逐条，已内嵌 paste-2 第 6 段（可命令核的给了命令）。
回滚 = paste-2 文末 ROLLBACK 段：停新→`mv` 保全现场（零删除）→解 tar→起旧（反序）。
观察期 48h 内旧体保持可启动；CORE-RETIRE 与旧体 startup_verify 解耦**同窗**做，
在观察期后另开收尾窗（前置 #2）。
