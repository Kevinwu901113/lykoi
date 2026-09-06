# CLAUDE.md — 任何 Claude Code 会话的入口（本地 / 云端通用）

本仓库是 Lykoi 的唯一维护仓库：Cordis(TS/Node) 运行时 + 本体蓝图 + `governance/` 治理平面全史。
仓库是什么、目录布局，读 [README.md](README.md)，这里不重复。

## 读物顺序（新会话先读这些，再动手）

1. 本文件
2. `governance/HANDOFF.md` — 先读第一至三节的角色/边界/工单机制、第五节最新进度快照、第八节当前接手流程；第四节按教训索引查本任务相关条目，旧快照仅作历史证据
3. `governance/docs/lykoi_whitepaper_v1.2_2026-08-18.md` — **最高层规范**；按任务读取相关条款，架构重构通读。历史实现快照须与当前代码核对
4. `governance/docs/lykoi_collaboration_plan_v1_2026-08-07.md` — 协作制度正本
5. 手头任务涉及的 `docs/m*_blueprint.md` / `docs/m4_handoff.md` / `governance/wo/<工单>/`
6. 云端（claude.ai/code）会话额外必读：`governance/CLOUD_HANDOFF.md`

当前会话中 Kevin 的明确指令优先于历史用模与派发模板。不要将旧 Python 运行时的命令、服务名、测试计数或已关闭事故的处置步骤复制进新任务。

## 硬规矩（按重要性排）

- **白皮书至上**：与任何旧文档/旧共识冲突时以白皮书 v1.2 为准。状态标记体系
  `[NORMATIVE]/[IMPLEMENTED]/[PARTIAL]/[PLANNED]/[EXPLORATORY]/[OUT OF SCOPE]`——
  **除非标注 [IMPLEMENTED]，设计描述不得被当作已实现能力。**
- **生产环境边界**：Lykoi 活体在 Kevin 家服务器上，服务器操作只属于 Kevin（root）与
  Mac 主治理线（ssh）。**没有服务器通道的会话（云端一律没有）绝不尝试连接服务器，
  更绝不声称做过服务器侧动作**——"假完成"是本项目发生过多次、代价最高的事故类型。
  需要服务器动作时，产出=工单/粘贴稿/文档，写进 `governance/wo/`，由有通道的一方执行。
- **隐私红线**：secrets、token、她的记忆/state 备份、任何真值**永不入库**。
  `deploy/` 模板只允许占位符。发现真值入库属最高优先级事故，立即报告 Kevin。
- **特权层不许随手改**：`packages/lykoi-kernel`（三层审批门/policy core/path guard）与
  `packages/lykoi-gate`（启动完整性门）是治理特权层。改它们必须有工单与治理侧复核，
  禁止在别的任务里顺手动。
- **部署事实住在 `profile/`**：dev/prod 两个写死入口，**零 env 改道**（GK-6）。
  不得新增用环境变量切换装配/行为的暗道。
- **工单纪律**：一单一分支（`wo/<name>`），提交注释带工单前缀；报告**一次性完整输出**
  （分段打印只会留下末段）；自报完成不算完成，以复核为准；**波次完成当日 commit+push**。
- **测试时钟纪律**：时间一律经参数注入（`now` 透传），禁止在被测路径里裸 `new Date()`
  搭配固定夹具日期——同一份代码早绿晚红的定时炸弹已发生过两批（详见
  HANDOFF 教训与 `governance/wo/WO-M3-W4/`）。复跑单点失败先查时钟再查回归。

## 构建与测试

- Node **≥24**（`.nvmrc`），依赖装 `npm ci`。
- `npm test` — workspaces 全量（node --test，glob `.ts`）；`npm run typecheck` — 必须净。
- 改动交付线：全量测试 0 新增失败 + typecheck 净，才允许说"完成"。

## 角色速查

| 角色 | 谁 | 边界 |
| --- | --- | --- |
| 所有者 | Kevin | 决策、审批、一切 root/生产动作 |
| 主治理 Agent | Mac 上的 Claude Code 会话 | 写单、复核、服务器 ssh（lykoi-gov）、文档正本维护 |
| 执行 Agent | 服务器无头 `claude -p` / 云端会话 | 按工单在隔离副本/分支干活，不碰活体 |

云端会话默认是**执行 Agent**定位，除非 Kevin 明示授予治理职责；详见
`governance/CLOUD_HANDOFF.md`。
