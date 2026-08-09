# WO-DRILL-CLEANVM-01 · 干净 Ubuntu 24.04 从零重建演练

- **日期**: 2026-08-09
- **执行者**: 主治理 Agent（Mac Claude Code）直接实施——按 HANDOFF 第八节指示，本单不派发执行 Agent
- **背景**: 阶段 1 收尾门。BACKUP-03 已补齐 13 项备份（含 deployment_config 配置包），
  恢复演练验证了"数据可还原+应用可读"，但从未验证"干净机器上服务可启动"。
  该门通过前不开阶段 2 迁移。

## goal

在一台干净的 Ubuntu 24.04 (amd64) 机器上，仅用以下输入把 Lykoi 拉起到
"四核心服务 active + /health ok"：

1. git bundle（main @ 74f5907c，取自活体检出，只读导出）
2. `deployment_config.20260809T032908Z.tar.gz`（BACKUP-03 配置包）
3. 同一 STAMP 的 12 项 state 备份
4. 活体 venv 的 pip freeze（constraints.txt）+ src 内 root 属主路径清单（root-owned.list）
5. 占位 secrets（REQUIRED_SECRETS.txt 列出的三件由 owner 带外重签——演练用占位值，
   验收标准是"服务能启动"，不是"能连上 LLM"）

## scope

- 演练环境：生产 VM 上的 LXD 容器 `rehearsal`（ubuntu:24.04 官方镜像）。
  真 VM（Proxmox 新建）保真度更高，但需要 Kevin 动手；容器先行可自主完成、
  同内核同架构，能暴露绝大多数流程缺口。是否补做真 VM 版由 Kevin 决定。
- 产出可复用的 `rebuild_from_zero.sh`（容器/真 VM 通用），落治理仓库本单目录。

## forbidden

- 不碰活体检出、活体 state、core.sock、secrets（bundle 导出与备份拷贝均为只读操作）
- 容器资源占用不得影响生产（起跑前确认 >10Gi 可用内存）
- 演练结束后容器停止；删除与否交 Kevin 定

## success_criteria

1. startup_verify（lykoi 身份）exit 0 —— manifest/权限位复刻正确
2. lykoi-watchdog / lykoi-core / lykoi-server / lykoi-autonomy 全部 active
3. `curl 127.0.0.1:8080/health` 返回 `"status":"ok"`
4. 4 个 SQLite `integrity_check=ok`
5. 每一处备份集覆盖不到、需人工/带外补的缺口都记录在案

## required_evidence

- 脚本全量输出（PASS/FAIL 逐项）、容器内 /root/rebuild.log
- systemctl is-active + NRestarts、/health 原文
- 差距清单（写入 report.md 与 reports/clean-rebuild-drill_2026-08-09.md）
