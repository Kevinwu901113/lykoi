# LANDING-E · 停机迁移窗记录（2026-09-02 15:09 CST）

第二个停机迁移窗：mind_schema 16→17（WO-MEM-DECAY-01 的 017 迁移件，
`focus_insight_state` 五态→六态重建）+ 产线树重钉 56d7ead → **main@89b04dd**
（首次按 AUDIT-FIX-2026-09-02 口径直接钉 main 提交，不再 cherry-pick 翻位，
m4-switch 退役）。Kevin root 亲手执行，一遍全绿，停机约 5 秒
（15:09:09 Stopping → 15:09:14 assembly up）。

## 执行件

- 脚本走"会话交全文 + Kevin 落盘"通道。本次 Kevin 把全文直接粘进 root
  交互 shell 执行，服务器上无 `/tmp/landing-e-migration017.sh` 文件，窗后
  无法 ssh 钉执行件 sha；以治理草案为准：sha256
  `3450812ef7297c56f24a363d589c052925eb778461119d528919bfd8395f416c`，
  终端输出各段与草案逐段吻合。备注：交互 shell 下 `set -e` 遇 FATAL 会直接
  关掉会话——下次先落盘再 `sudo bash`。
- bundle `/tmp/lykoi-landing-e.bundle` sha256
  `0db847ecd9498ce8051aecc96fd1a3ed54080f68dfbe1d713252a5390ba5b6ce`
  （`^72dfa57 ^56d7ead main`；前置 0db21836 / 72dfa57 在库，verify okay）。
- 017 迁移件 sha256
  `f4b7d8b96f7b20d12630c8a56595ccd2aebe424a0c8f480893d0351e209b0f4f`
  （`sha256sum -c` OK）。

## 顺序（R-01 正序，全部命中）

前验（bundle / persona sha OK、HEAD=56d7ead、bundle verify okay、schema=16、
重建表无 trigger/view 依赖）→ 停（watchdog 最先、备份 timer、service、pgrep
清场）→ root 窗内备份 `/root/backup-pre017-20260902T150911.tar.gz`
（10,363,564 字节，sha256 52bde9d2…；比 D 大是 state/backups 里已有 01:30
的日备份）→ 树落地 89b04dd 净 → 内容断言（版本常量 17 ×1、
INSIGHT_STALE_AFTER_CYCLES=30 ×1、retireStaleInsights 调用位 ×5、schema.ts
六态 ×1、relit ×2、迁移件 sha、init-state 在树、prod.yml 无 `disabled: true`、
personaToml ×2、承袭 deriveEpistemic ×5 / factualEpistemicClause ×3 /
outbound ×1 / LlmFinishError ×5 / emit ×4 / var/state canonical）→ 施加 017
→ chown/chmod → manifest 重签 **106** 文件（D 时 104；+schema.ts、
init-state.ts）+ gate OK → 起新体 + timer 回位 → 记账。

## 017 施加回执

| 检查 | 值 |
|---|---|
| mind_schema | 17 |
| focus_insight_state 行 | 17（active 15 / shadow 2，施加前后一致） |
| check_has_dormant | yes |
| index_present | 1 |
| leftover_temp_table | 0 |
| integrity_check | ok |

## 窗后独立核验（治理侧 ssh，不信自报）

- 产线 HEAD = main = 89b04dd，树净。
- `MAX(version)`=17，台账 17 恰一行；表 DDL 含 dormant；索引在位；无残留
  临时表；history 39 行、cycle 24 未变；integrity ok。
- `lykoi-cordis.service` active（ActiveEnter 15:09:12），
  `production assembly up` 15:09:14 五服务 ok，NRestarts=0；窗后 journal
  21 行零 error/fail。
- watchdog timer active；备份 timer active，下一班 09-03 01:30。
- governance-ops 记账行在（15:09:21）。
- 预算 09-02（UTC 日）177,791 tokens，续跑。

## 意义

- **慢变层第一次有了出口**：dormant 入 CHECK，L4 每一种周期结尾结算
  "≥30 周期未被再触达 → dormant"，装配自然出局，重申即点亮。产线现 15 条
  active 距上次触达 1..21 周期（cycle 24）：预计约 cycle 33 起首批 3 条降档，
  随后两周内再 6 条。
- **首次按"main 即生产装配"口径落地**：钉 main 提交；56d7ead 虽非 main
  祖先，`prod.yml` 非注释内容与 main 逐字同，装配语义零变化。
- 停机迁移窗范本第二次实测，全程约 5 秒停机。

## 遗留

- devstate 副本已施加 017（原件留 `memory.db.pre017`）。
- 首月读数校准 `INSIGHT_STALE_AFTER_CYCLES=30`；观察点：首批
  `"type":"focus_insight_status"` 且 `"to":"dormant"` 事件（精确匹配）。
- 执行件通道：下次先落盘再执行，便于窗后钉 sha。
