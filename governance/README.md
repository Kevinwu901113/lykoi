# governance/ — Lykoi 治理平面

> ## 👉 接手工作的 Agent 请先读 [HANDOFF.md](HANDOFF.md)
>
> 里面有：角色边界、怎么连服务器、工单机制与派发命令模板、已踩过的坑（59 条，第四节开头有按主题的索引与固化状态）、当前进度快照、下一步该做什么。
> 读完再看 [白皮书 v1.2](docs/lykoi_whitepaper_v1.2_2026-08-18.md)（最高层规范）与[协作方案](docs/lykoi_collaboration_plan_v1_2026-08-07.md)（工作制度）。
> 云端（claude.ai/code）会话另读 [CLOUD_HANDOFF.md](CLOUD_HANDOFF.md)。

本目录是唯一仓库 `Kevinwu901113/lykoi` 的治理平面子目录（2026-08-31 由原独立仓 `lykoi-governance` 以 subtree 并入，全史保留）。所有者：Kevin。协作 Agent：主治理 Agent（Mac Claude Code）、执行 Agent（服务器无头 `claude -p` / 云端会话）。

- `docs/` — 正本文档：技术白皮书（现行 v1.2；v1.1 归档）、协作方案、各设计稿。**此处为正本，各机器副本以此为准。**
- `wo/` — 工单（`WO-<系列>-<编号>/order.md` + `report.md` + `review.md`）与落地窗记录（`LANDING-*`）。
- `reports/` — 基线审查、演练、灾备手册等阶段性报告。

纪律（详见 docs/ 协作方案与仓库根 `CLAUDE.md`）：

1. 本目录**不存放**任何密钥、Token、活体状态数据或记忆备份。
2. 执行 Agent 自报完成不算完成，以主治理 Agent 复核为准。
3. 与《Lykoi 技术白皮书》冲突时，以白皮书为准。
