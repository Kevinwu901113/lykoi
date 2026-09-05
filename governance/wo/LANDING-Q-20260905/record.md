# LANDING-Q · WO-FIX-TAILBRACE-01 + WO-FIX-UNDELIVERED-BRIDGE-01 + WO-UTTER-01 落地记录（稿备好，待跑）

- 状态：**稿备好，待 Kevin 合并三分支 → 主治理 Agent 出 bundle → Kevin root 跑**。
- 稿：`landing-q-threefix.sh`（治理侧 sha256 `c7174ca87b901d5a30f5f278bc12f52f882c54eddb648f4ae47cd71fb0e25f01`；bundle 生成后另记 bundle sha）。
- 产线树：main@8da87dc（LANDING-P）→ bundle 里的 main（合并三分支后取）。零迁移（mind_schema 仍 18）。
- 三分支尖（稿内断言为 NEW 的祖先）：`wo/fix-tailbrace-01`@3698def、`wo/fix-undelivered-bridge-01`@5830ca8、`wo/utter-01`@ad41233。

## 窗前步骤

1. Kevin 在 Mac 主副本合并：`main ← wo/fix-tailbrace-01`、`main ← wo/fix-undelivered-bridge-01`、`main ← wo/utter-01`（utter 含 bridge 代码提交，先 bridge 后 utter 无冲突），推远端。
2. 主治理 Agent：`git bundle create /tmp/lykoi-landing-q.bundle 8da87dc..main`，验 bundle，报 bundle sha 与 NEW sha；上传 bundle 到服务器 `/tmp`（治理账户通道，已验证可放行）。
3. 稿全文走聊天正文交 Kevin，Kevin 落盘 `/tmp/landing-q-threefix.sh`，两端 sha 逐字对，再 `sudo bash`。

## 稿内断言（与 P v2 同形，去迁移段）

前验（bundle / persona sha / HEAD ∈ {8da87dc, NEW} / schema = 18 / 宿主 active）→ 停（watchdog 先）→ 备份 ≥ 1 MB →
钉树 + 三分支尖为祖先 + 12 条内容断言 + prompts.ts sha 不变（G-2）+ src 改动恰 7 文件且只在 decide/converse/adapter-telegram +
profile/deploy/依赖/vendor 零变 + 无 019 迁移件 → npm ci 树净 → 库只读复核 → manifest 重签 117 + gate OK → 起 → timer 回位 → 7a 四测试文件 → 记账 `landing-q-threefix`。

## 回执（待填）

| 项 | 读数 |
|---|---|
| 前验 | |
| 备份 | |
| 树 | |
| npm ci | |
| manifest | 117（预期） |
| 起立 / downtime | |
| 7a 单测 | repair 13 / cycle 26 / bridge 4 / split 21（Mac 读数，服务器待填） |
| 7b NRestarts / autonomy_runs | |
| 记账 | |

## 落地后读数（待）

- TAILBRACE：出现 `"type":"u3_cycle_repaired"` 时同一 run 不再伴 `u3_cycle_retried`；`added_chars` 分布（预期 1–2）；`finish_reason` 是否 `length`（若多为 length → 候选按 finish_reason 分桶）。
- BRIDGE：下一次 `telegram/send_failed` 后 `telegram_undelivered.json` 只新增一条（`source=telegram_transport.send_message`），不伴 `chat_reply` / `chat_outbox`。
- UTTER：`telegram/sent` 新行全带 `parts`；首次超长回复出现 `telegram_transport_split`，Telegram 端收到整段无截断；`partial_delivery` 预期 0。
