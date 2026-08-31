# lykoi-governance

> ## 👉 接手工作的 Agent 请先读 [HANDOFF.md](HANDOFF.md)
>
> 里面有：你的角色边界、怎么连服务器、工单机制与派发命令模板、**16 条已踩过的坑**、当前进度与在跑的任务、下一步该做什么。
> 读完再看 [白皮书 v1.1](docs/lykoi_whitepaper_v1.1_2026-08-07.md)（最高层规范）与[协作方案](docs/lykoi_collaboration_plan_v1_2026-08-07.md)（工作制度）。

Lykoi 治理平面工作仓库。所有者：Kevin。协作 Agent：主治理 Agent（Mac Claude Code）、服务器执行 Agent（Claude Code / Codex）。

- `docs/` — 正本文档：技术白皮书（现行 v1.1）、治理平面协作方案。**本仓库为正本，各机器副本以此为准。**
- `wo/` — 工单（`WO-<系列>-<编号>/order.md` + `report.md`）。执行 Agent 从这里取工单、交报告。
- `reports/` — 基线审查等阶段性报告与治理记录。

纪律（详见 docs/ 协作方案）：

1. 本仓库**不存放**任何密钥、Token、活体状态数据或记忆备份。
2. 执行 Agent 自报完成不算完成，以主治理 Agent 复核为准。
3. 与《Lykoi 技术白皮书》冲突时，以白皮书为准。
