# 干净机器从零重建演练 · 2026-08-09

**结论：通过（ALL GREEN 34 PASS / 0 FAIL）。** 阶段 1 收尾门达成（容器保真度内）。

干净 Ubuntu 24.04 (amd64) 环境，仅凭 BACKUP-03 的 13 项备份 + git bundle（@74f5907c）+
占位 secrets，约 25 分钟重建到：9 个 lykoi-* 服务全 active、`/health` ok
（含 `browser_request_guard:ready`）、4 库 integrity_check=ok、审计正本 append-only 复原。

- 演练环境：生产 VM 上的 privileged LXD 容器 `rehearsal`（非独立 VM；真 VM 复跑可选，
  脚本与输入包可直接复用，预计 30 分钟）
- 完整报告 / 差距清单（10 项）/ 可复用脚本：`wo/WO-DRILL-CLEANVM-01/`
- 三个会咬真实灾难恢复的新发现：git bundle 克隆必须 `-b main`；venv 后必须清
  `__pycache__` 才能过启动门；审计正本需要 `chattr +a`（复用旧机覆写前还得先 `-a`）
- 两个跟进建议：BACKUP-04（pip freeze + root 属主清单入配置包）；灾难手册按差距 #1/#3/#4 修订
