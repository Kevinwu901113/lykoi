# LANDING-D · 停机迁移窗记录（2026-09-02 00:27–00:28 CST）

首个停机迁移窗：mind_schema 15→16（WO-MEM-SOURCE-01 的 016 迁移件）+
产线树重钉 f1d5896 → **56d7ead**（= main@72dfa57 + 六翻位）。
Kevin root 亲手执行，一遍全绿，停机约 1 分钟。

## 执行件

- 脚本走"会话交全文 + Kevin 落盘"通道（root 稿不经治理侧写盘）。
- 执行件 `/tmp/landing-d-migration016.sh`
  sha256 `3cdd71d83934d77ada0de58151820f51f89745418b6597a55845d0fe2ec59c2a`
  （窗后 ssh 钉档，与治理侧草案逐字节一致）。
- bundle `/tmp/lykoi-migration016.bundle`
  sha256 `7d88f2886b031f543c68615b66c861e2a20164a2642367565fc5cc4d5542c95b`
  （^f1d5896，含 main@72dfa57 + m4-switch@56d7ead，前置 9ec6189）。

## 顺序（R-01 正序，全部命中）

停（watchdog 最先，备份 timer 停防抢跑，pgrep 清场）→ root 窗内备份
`/root/backup-pre016-20260902T002800.tar.gz`（6,841,871 字节，
sha256 e8322678…）→ 树落地 56d7ead 净 → 内容断言（版本常量 16 ×1、
deriveEpistemic ×5、factualEpistemicClause ×3、outbound ×1、迁移件
sha caaaa481… OK、承袭断言 LlmFinishError ×5 / emit ×4 / 翻位 ×6 /
personaToml / var/state）→ 施加 016（`sqlite3 -bail`，前验 schema=15
命中施加支）→ chown/chmod → manifest 重签 104 文件 + gate 试跑 OK →
起新体 + timer 回位 → 记账。

## 016 施加回执

| 检查 | 值 |
|---|---|
| mind_schema | 16 |
| epistemic 分布 | executed 4422 / observed 1195 / inferred 632 / user_reported 212 |
| 合计 | 6461（回填前夜 20:30 备份为 6443，+18 = 傍晚她持续活动） |
| unbackfilled_rows | 0 |
| imagined/simulated | 0（回填永不产出虚构地位，断言命中） |
| integrity_check | ok |

## 窗后独立核验（治理侧 ssh，不信自报）

- 产线 HEAD = 56d7ead；`MAX(version)`=16（以 lykoi 直读）。
- `lykoi-cordis.service` active，`production assembly up` 00:28:03，
  五服务 ok，NRestarts=0；窗后 journal 零 error/fail 行。
- watchdog timer active；备份 timer 回位，下一班 09-02 01:30 不变。
- governance-ops 记账行在（00:28:11）。
- 经验 6461 条、未回填 0（复读一致）。

## 意义

- **她的每条经验自此有认识论地位**（epistemic 第二轴上线，D-PERS-1 落地）；
  imagined/simulated 永不进事实性供给的铁律从这一刻起在产线生效。
- 版本台账推进方式首次实测：仓库无生产 DDL 入口，迁移件由治理侧交付、
  Kevin root 停机窗内施加——本窗即此路径的范本。
- "merge 后禁只重启不迁移"约束解除（schema 与代码已同版）。

## 遗留

- origin `m4-switch` 待推 56d7ead（本地已钉）。
- 备份 timer 首个排班跑后核对（01:30，产物 lykoi-state-20260902.tar.gz）。
- devstate 副本注入 `LYKOI_DEVSTATE_DB` 前须先施加 016（版本门设计使然）。
