# LANDING-Q · WO-FIX-TAILBRACE-01 + WO-FIX-UNDELIVERED-BRIDGE-01 + WO-UTTER-01 落地记录（已落，2026-09-05 11:31 CST）

- 状态：**已落，一次通过**。产线树 main@8da87dc（LANDING-P）→ **main@257a72e**；零迁移（mind_schema 仍 18）；manifest 117 重签；宿主未动。
- 稿：`landing-q-threefix.sh`（治理侧 sha256 `c7174ca87b901d5a30f5f278bc12f52f882c54eddb648f4ae47cd71fb0e25f01`；服务器 `/tmp/landing-q-threefix.sh` 同 sha，Kevin 与主治理 Agent 各对一遍）。
- bundle：`/tmp/lykoi-landing-q.bundle`（`8da87dc..main`，sha256 `3c0eeac10fd0c9b3…`，两端一致）。
- 三分支尖（稿内断言为 NEW 的祖先）：`wo/fix-tailbrace-01`@3698def、`wo/fix-undelivered-bridge-01`@5830ca8、`wo/utter-01`@ad41233。Kevin 四个 `--no-ff` 合并（第四个是 `governance/progress-2026-09-05-q`@4111710）得 257a72e，已推远端。
- 执行：Kevin root `sudo bash /tmp/landing-q-threefix.sh`，2026-09-05 11:31 CST。
- 通道事实：bundle 与 root 稿都经 `ssh lykoi-gov 'cat > /tmp/<file>' < 文件`（治理账户）上传，不再必须走聊天正文；服务器端 sha256sum 仍由 Kevin 对。第一次对 sha 时稿不在服务器——主治理 Agent 只发了文件卡没有上传；上传动作必须落实到 ssh 命令。
- 稿内坑（本地演练抓到）：git pathspec `packages/*/src` 对全路径 fnmatch 不中，src 改动计数会得 0 而 FATAL；落地稿的路径过滤改用 `-- packages | { grep '/src/' || true; }`。

## 窗前步骤（已完成）

1. Kevin 合并三分支 + 治理进度分支，推远端（main@257a72e）。
2. 主治理 Agent 出 bundle、验 bundle、上传 bundle 与稿到服务器 `/tmp`。
3. Kevin 两端 sha 对齐后 `sudo bash`。

## 稿内断言（与 P v2 同形，去迁移段）

前验（bundle / persona sha / HEAD ∈ {8da87dc, NEW} / schema = 18 / 宿主 active）→ 停（watchdog 先）→ 备份 ≥ 1 MB →
钉树 + 三分支尖为祖先 + 12 条内容断言 + prompts.ts sha 不变（G-2）+ src 改动恰 7 文件且只在 decide/converse/adapter-telegram +
profile/deploy/依赖/vendor 零变 + 无 019 迁移件 → npm ci 树净 → 库只读复核 → manifest 重签 117 + gate OK → 起 → timer 回位 → 7a 四测试文件 → 记账 `landing-q-threefix`。

## 回执（Kevin 日志读数）

| 项 | 读数 |
|---|---|
| 前验 | bundle sha 对、persona sha 对、HEAD = 8da87dc、schema 18、宿主 active |
| 停 | watchdog timer → lykoi-cordis → backup timer，按序停 |
| 备份 | `/root/backup-pre-threefix-q-20260905T113128.tar.gz`，21,279,297 B，sha256 `56a0342cb3e2f14122108fb75faaa3c6e3fbaa1179c9a7b8fb59633cd002c9d1` |
| 树 | fetch bundle → checkout 257a72e；三分支尖祖先断言过；内容断言全过；`prompts.ts` sha `fa741ce2…` 不变（G-2）；src 改动 7 文件只在 decide / converse / adapter-telegram；profile / deploy / 依赖 / vendor 零变；无 019 迁移件 |
| npm ci | 43 packages，树净 |
| 库 | 只读复核 schema 18 |
| manifest | 117 重签，gate OK |
| 起立 / downtime | active 11:31:31 CST；`deploy_event` ts `2026-09-05T03:31:32.071Z` head `257a72ec…` downtime「5 秒」；watchdog / backup timer 回位；`browser_organ_wired` 在 |
| 7a 单测 | 服务器 **65/65**（387.5 s）= repair 13 + cycle 27 + bridge 4 + split 21（Mac 合并树同读数；稿里预估的 cycle 26 是旧数） |
| 7b NRestarts / autonomy_runs | 0 / 2679 |
| 落地前基线 | `u3_cycle_repaired` 0；`telegram/sent` 16 行皆无 `parts`；`telegram_transport_split` 0；`partial_delivery` 0 |
| 记账 | `governance-ops.jsonl` `{"ts":"2026-09-05T11:38:07+08:00","actor":"root-paste","action":"landing-q-threefix","wo":"WO-FIX-TAILBRACE-01+WO-FIX-UNDELIVERED-BRIDGE-01+WO-UTTER-01",…}` |

## 窗后独立核验（主治理 Agent，治理账户只读，2026-09-05 11:53 CST）

- `/home/lykoi/projects/lykoi-cordis/.git/HEAD` = `257a72ec1f0e09e69fd28f6234ca9266996757e5`。
- `lykoi-cordis` / `lykoi-cordis-watchdog.timer` / `lykoi-cordis-backup.timer` / `lykoi-browser` 四个 active；`NRestarts=0`；`ActiveEnterTimestamp` 2026-09-05 11:31:31 CST；watchdog 5 分钟一拍在走（上一拍 11:52），backup 下一拍 09-06 01:30。
- journal 自 11:31 起 4 行，error / fail / fatal 0（`gate: OK` / `assembly up` 字样不在 journal 里，那是脚本自己的读数行）。
- manifest 117 行；`/tmp` 稿与 bundle 的 sha 前 16 位与治理侧一致。
- 审计尾部见 `deploy_event` head 257a72ec…、downtime「5 秒」。
- 记账行 `landing-q-threefix` 在 `/home/lykoi-gov/reports/governance-ops.jsonl` 末尾。

## 落地后读数（待观察）

- TAILBRACE：出现 `"type":"u3_cycle_repaired"` 时同一 run 不再伴 `u3_cycle_retried`；`added_chars` 分布（预期 1–2）；`finish_reason` 是否 `length`（若多为 length → 候选按 finish_reason 分桶）。
- BRIDGE：下一次 `telegram/send_failed` 后 `telegram_undelivered.json` 只新增一条（`source=telegram_transport.send_message`），不伴 `chat_reply` / `chat_outbox`。
- UTTER：`telegram/sent` 新行全带 `parts`；首次超长回复出现 `telegram_transport_split`，Telegram 端收到整段无截断；`partial_delivery` 预期 0。
- 基线：落地前 `telegram/sent` 16 行皆无 `parts`，落地后新行有 `parts` 即 UTTER 生效的第一个信号。
