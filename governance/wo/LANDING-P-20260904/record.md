# LANDING-P · WO-OUTCOME-01 + WO-OVERLAY-WAKE-01 + WO-CONTINUATION-01 落地记录

- 执行：Kevin（root），2026-09-04 22:38 CST，v2 一次通过（v1 在前验第一条 FATAL 退出，服务器零改动）
- 稿：`wo/WO-CONTINUATION-01/landing-p-continuation-v2.sh`（sha 7b8ef936…71c3；v1 sha 179f07c4…42b3）；bundle sha 6ef49a7e…2b87
- 产线树：main@3c47c2e → **main@8da87dc**（detached）；**含迁移 018：mind_schema 17 → 18**

## 回执

| 项 | 读数 |
|---|---|
| 前验 | bundle OK、persona OK、HEAD=3c47c2e、NEW=8da87dc（自 bundle 取，c99729a 为祖先）、schema 17、autonomy_runs 2654、宿主 active |
| 停机 | watchdog disable --now；备份 timer stop；大脑 stop（enabled 保持） |
| 备份 | `/root/backup-pre-continuation-20260904T223819.tar.gz` 17,608,659 B，sha c601770d…3536 |
| 树 | 钉 8da87dc，checkout 后净；十条内容断言过；profile/deploy/依赖/vendor 零变化 |
| npm ci | Node 24，43 包；树净无 WARN |
| 迁移 | `sqlite3 -bail` 018 up：`mind_schema|18`、`pending_continuations_rows|0`；索引在；integrity_check ok |
| manifest | 117 条重签（113 + converse/continuation.ts、failure.ts、outcome.ts + decide/overlay.ts）；gate OK |
| 起立 | production assembly up；watchdog/备份 timer 回位；宿主未动仍 active；browser_organ_wired 在 |
| 7a | 服务器 Node 24 四文件单测 20/20（rw-continuations、migration-018、continuation、cheap-tick-continuation），79.4 s |
| 7b | NRestarts 0；autonomy_runs 2654；deploy_event head=8da87dc 14:38:24Z，downtime「7 秒」 |
| 7c | 落地前账：turn/terminal 0、continuation/* 0（预期） |
| 记账 | governance-ops `landing-p-continuation` |

## 说明

- v1 的 `EXPECT_OLD` 误写 main 尖 db151e1；产线钉点是 LANDING-O 的 3c47c2e，3c47c2e..db151e1 只动 governance/。v2 只改 EXPECT_OLD 与回滚注释旧 sha。教训 55。
- 新 sha 不再写死在稿里：从 bundle 的 refs/heads/main 取，并断言工单链尖为祖先。此法可保留。
- 停机窗内四步顺序：停 → 备份 → 钉树 + npm ci → 迁移 → 重签 → 起。迁移由 lykoi 身份施加（库属主）。

## 落地后读数（待）

- 每回合一条 `turn/terminal`，带 `continuation_id`（无 followup 时 null）。
- 她说"稍后做"后同一分钟内出现 `continuation/terminal`；`SELECT state, terminal_reason, COUNT(*) FROM pending_continuations GROUP BY 1,2`。
- wake 装配里关系覆盖层出现（WO-OVERLAY-WAKE-01 report 的读数项）。
- LANDING-N 的对话路径四项读数仍待 Kevin 发几条要查资料的消息。
