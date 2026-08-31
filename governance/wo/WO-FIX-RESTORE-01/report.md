# WO-FIX-RESTORE-01 执行报告

## 交付物 1：`scripts/restore_drill.sh`（新文件，411 行含空行）

关键设计对照工单要求：

- 参数解析：位置参数 `STAMP`（可省略，省略时从 `memory.*.db.gz` 的最新 mtime 反推）+ `-d WORKDIR`（默认 `/tmp/lykoi-restore-<STAMP>`），并强制 `WORKDIR` 前缀必须是 `/tmp/*`，拒绝任何指向 `/tmp` 之外的隔离目录，防止误传参数写到活体路径。
- 12 项清单（`ITEMS` 数组）与 `offsite_backup.sh` 的命名完全对齐：`memory/core_facts/salience_shadow/permission_evidence_shadow` (`db.gz`)、`events/audit/audit_log` (`jsonl.gz`)、`approval_rules/pending_actions` (`json.gz`)、`core_artifacts` (`tar.gz`)、`lykoi_base_persona` (`toml`)、`governance_flags` (`txt`)。
- 完整性检查先行，缺项列出但**不中止**其余可执行的校验（`INCOMPLETE` 标记与 `FAIL` 标记分离，最终按 2 > 1 > 0 的优先级判定退出码）。
- SQLite 校验只用 `PRAGMA integrity_check` 和 `SELECT count(*)`，逐表列在 `KEY_TABLES` 里（`history insights autonomy_notes autonomy_runs autonomy_state health_metrics`，均已用 Grep 核对确实存在于 `src/lykoi/memory/store.py` 的建表语句中），**没有任何 `SELECT *` 或取内容行的语句**。
- 行数对比：还原库 `restored_count <= live_count` 判为通过（工单原文说明"差值仅来自快照后继续运行"，即活体应 >= 快照），大于则判失败；活体库读不到时降级为 `[INFO]` 不参与 FAIL 判定（对应 claude 账户读不到活体库的已知限制，脚本本身设计上兼容"由 lykoi 账户实跑才能拿到真实活体对比"和"claude 账户语法自检"两种执行者）。
- persona diff：`diff -q` 还原出的 TOML 与 `/home/lykoi/runtime/persona/lykoi_base.toml`，活体不可读时降级为 `[INFO]`。
- 功能性测试：`LYKOI_MEMORY_DB=<还原库> PYTHONPATH=<repo>/src <repo>/.venv/bin/python` 调 `lykoi.memory.persona.build_persona_prompt()`，报告字符数；已用 Grep 确认该函数签名 `build_persona_prompt() -> str` 及其从 `lykoi.memory.store.get_insights` 读取的路径与工单描述一致。
- 全程只 `mkdir -p` 隔离目录、只 `cp`/`gzip -dc`/`tar` 到隔离目录，没有任何 `systemctl`、`sudo`、对 `/home/lykoi/state`（备份目录外）或 `/home/lykoi/runtime` 的写操作。已逐行走查确认。

`bash -n` 结果：

```
SYNTAX_OK
```

## 交付物 2：`docs/runbook_disaster_recovery.md`（新文件）

按工单五节结构撰写：前置（备份来源优先级、依赖清单）→ 恢复顺序表（12 项逐一列落点/属主权限，root 手动操作的三项 persona TOML、audit_log、governance flags 均已标注）→ 无法恢复的四类资产（secrets / systemd 单元 / attention policy+SHA256 / core-v1-m2 env，均说明重建来源而非"尝试恢复")→ 验证清单（跑 `restore_drill.sh`、启动顺序、健康检查、日志核对）→ 已知限制（7 天滚动窗口、JSONL cp 快照末行可能截断、governance_flags 只是存在性快照非可还原资产）。

## 主治理 Agent 实跑时应重点观察的 5 个点

1. **STAMP 自动推断是否选中了真实最新且 12 项齐全的一组** —— 若最新时间戳恰好某项因权限/竞态缺失，脚本会判 `INCOMPLETE`（exit 2）而不是报错中止，需确认这不是误判（比如governance_flags 存在性快照失败等边缘场景）。
2. **`audit` 项**（state 下 0 字节那份）解压后 `gzip -dc` 是否正常产出 0 字节文件而不报错——已知它恒为 0 字节，不应触发 FAIL，但脚本目前把它当普通 db/jsonl 处理，需确认没有把"0 字节"误判为提取失败（当前逻辑只检查 `gzip -dc` 命令退出码，0 字节内容本身不会导致命令失败，理论上没问题，但需实跑确认）。
3. **行数对比中 `restored_count <= live_count` 的假设在 lykoi 账户下是否真的成立** —— 若实跑期间活体正在写入且节奏异常（例如刚做过数据清理导致 live 行数反而更少），会误报 FAIL，需要人工核实语义而非机械信任脚本判定。
4. **`build_persona_prompt()` 功能性测试的 venv 路径** `<repo>/.venv/bin/python` 是否与 lykoi 账户实际使用的 venv 一致——如果 lykoi 的部署用了不同虚拟环境路径，此步会因 `PYTHON_BIN` 不可执行直接判 FAIL，需要确认路径假设正确或按需调整。
5. **`WORKDIR` 强制限定在 `/tmp/*` 的这条防护本身** —— 确认在 lykoi 账户实际运行环境里 `/tmp` 可写且脚本清理/复用逻辑（未做自动清理，故意保留供人工检查）不会因反复执行同一 STAMP 而遇到隔离目录残留导致的旧数据干扰判断，必要时人工 `rm -rf` 旧 workdir 后重跑。

分支 `task/wo-fix-restore-01` 已提交（commit `7df9fde`），未合并至 main。
