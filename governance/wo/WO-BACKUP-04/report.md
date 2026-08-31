# WO-BACKUP-04 · deployment_config 包补全（pip freeze + root 属主清单）

- **日期**: 2026-08-09
- **执行者**: 主治理 Agent 直接实施（Kevin 口头授权"可以你来动手"）
- **动机**: WO-DRILL-CLEANVM-01 差距 #9/#10——演练时依赖版本锁定（pip freeze）与
  src/ 内 root 属主清单只能从活体现场导出；服务器全失时这两样就没有了。
- **改动**: `scripts/export_rebuild_config.py` +37 行——metadata 新增
  `pip-freeze.txt`（repo venv `pip freeze`）与 `root-owned.tsv`（walk src/ 的
  root 属主路径 + 权限位，确定性排序）。`scripts/` 不在 guardian manifest 覆盖内
  （grep 确认 0 条），无需 root 重签。
- **流程**: 在 `~/lykoi-work` 分支 `wo/backup-04` 实现并测试 → bundle 经 /tmp 中转 →
  以 lykoi 身份 `git merge --ff-only` 进活体 main。
- **合并**: 活体 HEAD `74f5907c` → **`94be1f2e`**。
- **验证**（合并后活体实测）:
  - `python3 scripts/export_rebuild_config.py --output /tmp/live-dc-test.tar.gz` → OK，
    包内 `metadata/root-owned.tsv` 45 行（44 路径+表头，与 `find src -user root` 一致）、
    `metadata/pip-freeze.txt` 24 行（与活体 venv freeze 一致）
  - `pytest tests/test_p0_integrity.py` → **25 passed**（manifest 未受影响）
  - 未重启任何服务（改动仅备份导出工具，不在服务路径上）
- **生效**: 下一次 04:17 cron 备份起，deployment_config 包自动携带两份新 metadata。
- **回滚**: `git -C ~/projects/lykoi revert 94be1f2e`（或 reset 回 `74f5907c`），无部署面。
