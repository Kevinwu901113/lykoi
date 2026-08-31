/**
 * lykoi-gate —— 插件树完整性门（M3-W4；SK-70..76 等价重建，CF-B1 形态）。
 *
 * 活体正本：治理仓库 wo/WO-M3-SPEC-KERNEL/guardian-live-20260825/
 * （startup_verify.py / policy_core.py / path_guard.py / audit_sink.py /
 * watchdog.py + manifest.sha256 113 行）。
 *
 * **它不是插件**：不 apply 进 cordis 树，不 export Service。它是启动前跑一次的
 * 独立入口（systemd `ExecStartPre`），跑完就退出。理由与活体同：一个能被自己
 * 看守的对象加载进来的看守，不是看守。
 *
 * 模块地图：
 *  - surface.ts       受保护面（GK-13 重划）+ env 钉面全表（GK-6）
 *  - manifest.ts      **纯函数**清单生成器 + 受保护面唯一出处（签的=验的）
 *  - rules-schema.ts  approval_rules 结构 schema 的**孪生这一份**（SK-72）
 *  - vocabulary.ts    事件词汇分流定案（W2#6）+ D-08/SK-05 口径分界（W3#7）
 *  - verify.ts        八检查项本体（SK-71）
 *  - cli.ts           SK-70 入口：校验 exit 1 / `--write-manifest` root 重签
 *
 * 三件活体模块在新体的落位（报告留痕）：
 *  - `path_guard.py`  → `lykoi-kernel/src/path-guard.ts`（治理核的兄弟，同 root 域）
 *  - `policy_core.py` → `lykoi-kernel/src/policy-core.ts`（W1 已落，W4 补第三旋钮）
 *  - `audit_sink.py`  → `lykoi-audit`（M1 已落；append-only 只以 O_APPEND 打开，
 *    权限模型由本门检查项⑦核）
 *  - `watchdog.py`    → **不迁**：独立 root 监督进程是部署面（systemd）的事，
 *    新体对应物是 unit 的 `Restart=always` + 一个同形态的 root 单元，归 M4 部署
 *    清单（docs/m4_handoff.md 前置 #10），不进插件树也不进本包。
 */
export * from './manifest.ts'
export * from './rules-schema.ts'
export * from './surface.ts'
export * from './verify.ts'
export * from './vocabulary.ts'
export { main as gateMain, repoRootFromHere } from './cli.ts'
