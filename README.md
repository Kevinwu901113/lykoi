# lykoi-cordis

Lykoi 的 Cordis(TS/Node) 完全移植体——她的下一具躯体。

- **血统**：旧体 = `Kevinwu901113/lykoi` 服务器活体（HEAD 4463ae8 = tag cordis-night-20260822，
  移植期间冻结演化，切换后保留为回滚锚）。记忆不迁移：`/home/lykoi/state/`（memory.db 等）
  由新体原样接管——换躯体不换记忆。
- **总案**：治理仓库 `lykoi-governance/docs/cordis_full_migration_plan_v1_2026-08-24.md`
  （M0 规格封存 → M1 骨架 → M2 心智移植 → M3 治理移植 → M4 切换 → M5 器官与走廊）。
- **架构语义正本**：白皮书 v1.2 第 37 章（心脏—大脑—器官）。本仓不改语义，只换运行时。
- **形态**：cordis 内核 + `lykoi-*` 自研插件树（心脏/装配器/决策信封/仲裁器/学习环/人格）
  + dsh 基础包复用（llm/session/计量等，复用清单见 WO-M0-DSH-STUDY 产物）。
- **治理特权层**（审批三层门/审计/预算硬顶）在树外，root 属主 + 启动完整性门，不可插件化。

## 状态

- [ ] M0 规格与封存（进行中，2026-08-24 起）
- [ ] M1 骨架起立
- [ ] M2 心智移植
- [ ] M3 治理移植
- [ ] M4 切换
- [ ] M5 器官与走廊
