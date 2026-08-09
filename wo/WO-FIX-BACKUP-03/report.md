# WO-FIX-BACKUP-03 实现与测试报告

- **实现者**：主治理 Agent（Codex，直接实现；未使用 Opus/Sonnet/执行 Agent）
- **生产基线**：`35ef7c86f469e79e93b9a0642805d71ece8fdeaa`
- **最终候选**：`1e19741fde4e1ed63fe24463658b989e8f194467`
- **候选 bundle**：`/tmp/WO-FIX-BACKUP-03-1e19741.bundle`
- **bundle SHA-256**：`6907d8b1874ea1a654f6a76810b30385ba6793c10b820337ac84371570b85a0b`

## 1. 实现

| 文件 | 改动 |
| --- | --- |
| `scripts/export_rebuild_config.py` | 新增 stdlib-only 导出器：只读明确 allowlist，拒绝 symlink/非普通文件与不安全路径，生成逐文件 SHA/权限 manifest，以 `.part` + 原子替换发布 mode 0640 的 tar.gz |
| `scripts/offsite_backup.sh` | 每次完成 offsite Git push 后生成第 13 项 `deployment_config.<STAMP>.tar.gz`，保留 7 份；失败清理 final/part 并记日志，再由既有 rsync 同步到异地 |
| `scripts/restore_drill.sh` | 完整集从 12 项提升为 13 项；拒绝路径穿越、非普通成员与 secret 成员路径，逐个要求 9 unit、13 drop-in、2 M2 env、policy 与 11 份元数据；验证实际配置/SHA/MANIFEST 三方集合和摘要一致 |
| `docs/runbook_disaster_recovery.md` | 增补第 13 项的 staging-first 恢复顺序、明确 secrets 带外重签与 BACKUP-03 前 12 项备份的限制 |
| `tests/test_rebuild_config_backup.py` | 新增 allowlist、secret 排除、原子输出、symlink、M2/systemd secret-like 值、cron 脱敏、脚本接线及 WORKDIR 逃逸测试 |

独立复核时发现原恢复脚本仅做字符串 `/tmp/*` 判断，会接受 `/tmp/../...` 或指向外部的 symlink。最终候选在任何 `mkdir/rm` 前用 `os.path.realpath()` 规范化并重新要求真实路径位于 `/tmp/`；对应负向测试已加入。该缺陷在候选部署前被抓出，未触碰生产。

## 2. Secret 与恢复边界

- 导出器没有任何 `/home/lykoi/secrets` 读取入口；恢复包只列出需要 owner 带外重签的 `llm.env`、`surface.env`、`backup.env` 名称，不含值。
- 两份 M2 env 必须精确等于 7 个已知非密键及允许值；出现额外键、重复键、非 UTF-8 或异常值即整包拒绝。
- systemd `Environment=` 若内联变量名含 `KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL` 即拒绝；`EnvironmentFile=` 只保存引用路径，不读取目标文件。
- 不归档 raw crontab 命令、Git remote URL 或子命令 stderr；cron 元数据只保存两个已知任务的 schedule、任务名和 canonical script 路径，避免内联 env/URL 泄密。
- `/usr/local/sbin/lykoi-*` 只记录文件名、mode、uid/gid、大小，不读 mode 0500 正文。
- 活体样本包共 36 个普通文件成员：9 unit + 13 drop-in + 2 M2 env + 1 policy + 11 metadata；没有目录、symlink 或 `secrets/` 成员路径。

## 3. 自检、功能与负向测试

- Mac 静态门：`git diff --check`、两份 Python `py_compile`、两份 shell `bash -n` 全部通过。
- 服务器最终候选、标准 `umask 0022`、真实 `lykoi` 身份：**28 passed, 4 skipped**（BACKUP-03 专项 + `tests/test_p0_integrity.py`）。4 个 skip 是隔离 clone 的既有 sealed-host 权限条件，不是失败。
- 使用生产只读配置与 `20260808T201701Z` 的现有 12 项备份，在 `/tmp` 生成第 13 项并完整演练：
  - `13/13` 完整；4 个 SQLite `integrity_check` 全部 OK；关键表行数与活体单调一致；persona 一致；`build_persona_prompt()`=226 chars。
  - 配置包为 `lykoi:lykoi 0640`、20,850 bytes；25 个配置文件、13 个 drop-in、内部 SHA 全通过。
  - 样本包 SHA-256=`aed6cb4204dc40d42f6e9750036b72aee046d138b3abe58d58fcdc46fdc6f78b`。
- 最终候选负向恢复门：
  - 缺第 13 项：exit 2 / `VERDICT: INCOMPLETE`；
  - tar `../escaped` 成员：exit 1 / 未解包到外部；
  - 修改 unit 但不更新 SHA：exit 1；
  - `WORKDIR=/tmp/../var/tmp/...`：exit 2 / 未创建外部目录。
- 最终候选全量回归：**1458 passed, 6 skipped, 4 failed, 1 warning**，耗时 1990.42 秒。4 项逐项分类如下：
  - 两项 `tests/test_core_v1_shadow.py` 仍 monkeypatch 已不存在的 `redaction._SECRETS`，与上一工单记录的未改基线失败完全相同；
  - permission evidence 并发 WAL 初始化的 `database is locked` 与 Core 双进程 writer-lock timeout 在候选单独复跑时都通过；未改 `35ef7c86` 基线也复现 writer-lock timeout，并在第二轮通过。因此二者是 33 分钟高 I/O 下的既有负载抖动，不是本候选新增回归。

候选迭代记录：`feecacc` 的第一次专项测试因测试夹具先 chmod 0444 后再注入攻击样本而 5 pass/1 fail，修正夹具后通过；`a5f42d4` 的一次治理身份全量尝试因已知 `umask 0002` 产生 0775 假权限而中止，随后又因复核发现 WORKDIR 真实路径缺口被整体作废。两者均未部署。

## 4. 生产状态与部署门

截至候选验收，生产仍为 `35ef7c86`、工作树 `## main`，core/server/autonomy/watchdog 全部 active/running、`NRestarts=0`、health=`status:ok` / `browser_request_guard:ready`。所有实现与测试写入仅发生在 Mac `/private/tmp` 或服务器 `/tmp`。

本单不改 guardian、运行时 Python 包、systemd 或 secrets，不需要重启服务。部署后仍必须手动运行一次正式备份，证明服务器真实 13 项恢复演练 PASS，再触发 Mac 拉取并核对同一 STAMP 的 13/13 SHA-256；完成前不能开始干净 VM 重建。
