# WO-FIX-RESTORE-01 复核记录

- **复核人**：主治理 Agent（Mac Claude Code）
- **日期**：2026-08-07
- **执行 Agent**：服务器 claude 账户，模型 sonnet
- **结论**：**验收通过**（经两轮补正）；分支已导入活体仓库，**合并待 Kevin 执行**

## 交付物

1. `scripts/restore_drill.sh`（281 行 → 补正后更长）：可重复执行的恢复演练脚本。
2. `docs/runbook_disaster_recovery.md`（118 行）：灾难恢复运行手册。

## 复核发现的两个缺陷（均已补正）

### 缺陷一：路径解析在灾难场景下必然失败

`REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`——在仓库内正确，脚本被拷贝到别处运行时解析为 `/`，功能测试报 `//.venv/bin/python not found` 并使整体 VERDICT=FAIL。

**为什么这是真缺陷而非测试假象**：该脚本的主场景就是灾难恢复——在新机器上用拷贝出来的脚本、指向拷贝来的备份运行，此时它基本不在仓库结构里。**在最需要它的场景下必然失败。**

补正：`LYKOI_REPO` 环境变量 → BASH_SOURCE 推导（校验其下存在 `src/lykoi`）→ 回退 `/home/lykoi/projects/lykoi`；同时新增 `LYKOI_BACKUP_DIR` 覆盖（灾难时备份可能来自 Mac 副本目录）；venv 缺失从 FAIL 降级为 SKIP 并单独汇总（新机器上没建 venv 时，数据完整性结论仍然有效，不该整体判负）。

### 缺陷二：脚本不幂等，第二次运行必假失败

实测：首次 PASS，**同工作目录第二次运行 FAIL**——persona 源文件只读（0640），`cp` 进工作目录得到 0440，二次运行无法覆盖。删目录重跑即 PASS，根因确认。

**为什么必须修**：演练脚本设计上就要反复执行（建议每月 + 每次重构前）。第二次报假失败会摧毁它的可信度；更危险的是真出问题时会被当成"老毛病"忽略。

补正：写入点统一幂等（强制覆盖 + 工作目录产物设为 0644），工作目录默认清空重建并打印提示，提供 `--keep` 保留旧内容对比。

## 实跑验证（主治理 Agent 以 lykoi 身份）

| 轮次 | 结果 |
| --- | --- |
| 初版（从 /tmp 运行） | FAIL（venv 路径） |
| 补正一后 | 功能测试通过（226 字符），但 persona 复制 FAIL（不幂等） |
| 清空工作目录后 | **PASS 全绿** ← 确诊不幂等 |
| 补正二后 · 第 1 次 | **PASS** |
| 补正二后 · 第 2 次（同目录） | **PASS** ← 幂等成立 |

脚本输出：12/12 备份项齐全、四库 integrity ok、六张关键表行数比对、persona 逐字节一致、`build_persona_prompt()` 226 字符。运行耗时亚秒级。

## 附带澄清：表计数口径

我此前用 `.tables | wc -w` 数得 20，脚本报 21。执行 Agent 用合成 fixture 复现并给出结论：`sqlite_master WHERE type='table'` 含 SQLite 内部记账表 `sqlite_sequence`（由 AUTOINCREMENT 列自动创建），而 `.tables` 会过滤 `sqlite_%` 前缀，二者必然差 1。**非表丢失，是口径差异**；脚本现同时输出两个数字并标注口径。

## 部署状态

分支 `task/wo-fix-restore-01`（主体 + 两次补正）已经 bundle 导入活体仓库，未合并。合并命令（Kevin 执行）：

    ssh lapw1ng.com 'cd ~/projects/lykoi && git merge --no-ff task/wo-fix-restore-01 -m "[WO-FIX-RESTORE-01] merge: restore drill script + disaster recovery runbook"'

## 后续建议

1. 演练纳入例行：每月一次 + 每次大规模重构前强制一次。可加 cron（每月 1 日），失败时走与备份相同的告警路径。
2. 手册中"不可从备份恢复"清单（密钥、systemd 单元与 drop-in、注意力策略、M2 env）应在阶段 2 前解决其中的配置类——drop-in 决定 M3 开关启用态，丢失会让她以完全不同的形态启动。
3. 全量重建演练（干净机器上从零启动）仍未做，属阶段 2 迁移前的必做项。
