# 恢复演练报告（首次）

- **日期**：2026-08-07
- **执行**：主治理 Agent，以 `lykoi` 身份在服务器进行
- **备份集**：`20260807T141309Z`（WO-FIX-BACKUP-02 生效后的完整 12 项）
- **隔离目录**：`/tmp/restore-drill-20260807T141309Z`（**全程未触碰活体状态**）
- **结论**：**通过。备份可还原，且还原产物能被应用代码正常消费。**

这是项目首次恢复演练，对应白皮书 30.2 风险 C3。在此之前"备份可用"只是假设。

## 一、还原完整性

12 项全部成功解压落地：

| 类别 | 项 | 还原后大小 |
| --- | --- | --- |
| SQLite | memory | 12.2 MB |
| SQLite | core_facts | 5.77 MB |
| SQLite | salience_shadow | 262 KB |
| SQLite | permission_evidence_shadow | 28.7 KB |
| JSONL | events | 6.12 MB |
| JSONL | audit_log（/var/log 正本） | 634 KB |
| JSONL | audit（state 份，恒 0 字节） | 0 B |
| 目录 | core_artifacts（tar） | 522 KB |
| 配置 | **lykoi_base_persona.toml** | 2761 B |
| JSON | pending_actions | 1858 B |
| JSON | approval_rules | 263 B |
| 快照 | governance_flags.txt | 307 B |

## 二、SQLite 完整性检查

四个数据库 `PRAGMA integrity_check` **全部 ok**：memory、core_facts、salience_shadow、permission_evidence_shadow。

## 三、一致性对比（还原 vs 活体，仅 COUNT，未读任何内容行）

| 表 | 还原 | 活体 | 判定 |
| --- | --- | --- | --- |
| history | 518 | 518 | 一致 |
| insights | 6 | 6 | 一致 |
| autonomy_notes | 57 | 57 | 一致 |
| autonomy_runs | 1807 | 1808 | 差 1，快照后新增 |
| autonomy_state | 1 | 1 | 一致 |
| health_metrics | 2803 | 2805 | 差 2，快照后新增 |

表总数 20 = 20。差值只出现在持续写入的运行时表上，且方向正确（活体更多）——这正是**一致性时间点快照**应有的表现，不是数据缺失。

## 四、人格文件一致性

`diff -q` 还原件 vs `/home/lykoi/runtime/persona/lykoi_base.toml`：**逐字节一致**。

## 五、功能性还原测试（本次演练最关键的一步）

不止校验字节，而是让**应用代码真的打开还原库**：

    LYKOI_MEMORY_DB=<还原库> PYTHONPATH=src .venv/bin/python
    → lykoi.memory.store.get_insights("persona")     → 1 条
    → lykoi.memory.store.get_insights("preference")  → 5 条
    → lykoi.memory.persona.build_persona_prompt()    → 226 字符

**意义**：从备份产物出发，她的人格提示词可以被完整重建并交付给运行时。这是"备份保住了身份连续性"的直接证据，而非推论。

## 六、异地副本可还原性

Mac 侧拉取副本与服务器逐字节比对（sha256）：memory、core_facts、lykoi_base_persona、audit_log **四项全部一致**。因此服务器侧演练的结论可传递到 Mac 副本——**服务器整机丢失的场景下，Mac 上这份同样可还原**。

## 七、本次演练未覆盖 / 已知限制

1. **未做全量重建演练**：没有在一台干净机器上从零把她跑起来。本次验证的是"数据可还原 + 应用可读"，不是"服务可启动"。
2. **不可从备份恢复的资产**（须靠重建，已写入恢复手册工单）：`/home/lykoi/secrets/*`（密钥，需重新签发）、systemd 单元与 drop-in（部署配置，其中 drop-in 决定了 M3 各开关的启用态）、`/var/lib/lykoi-attention-policy/`（策略 + SHA256 锁定）、`/etc/lykoi-core-v1-m2/*.env`。
3. `governance_flags.txt` 只是存在性记录，治理开关本身（root 属主）需人工按它重建。
4. 7 份滚动 = 最多回溯 7 天；`cp` 快照的 JSONL 末行理论上可能截断。
5. 备份文件权限不统一（0600/0640/0644 混杂，继承自源文件），跨账户取用时需注意。

## 八、后续

- `WO-FIX-RESTORE-01` 已派发：把本次演练固化为可重复执行的 `scripts/restore_drill.sh`，并产出 `docs/runbook_disaster_recovery.md`（含 §七.2 那份"不可从备份恢复"清单的重建来源）。
- 建议演练纳入例行：每月一次，或每次大规模重构前强制一次。
