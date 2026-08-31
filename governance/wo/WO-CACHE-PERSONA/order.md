# WO-CACHE-PERSONA · persona 装载走既定缓存面 + path 一致性守卫

> 签发：2026-09-01（治理侧，WAVE-OBS-PREP 第三单，小单）。
> 执行形态：Mac 本地 Opus 子 Agent（工作副本 `~/Documents/lykoi/lykoi-cordis`）。
> 分支 `wo/cache-persona`，基 = main（签单 commit 之后的尖，动手前 `git log -1` 记录实际基）。

## 背景

`packages/lykoi-decide/src/persona-toml.ts:178` 注释明写「不缓存 —— 生产走
getPersona」，但两个生产调用点都直调 `loadPersona`：

- `packages/lykoi-converse/src/index.ts:203`
- `packages/lykoi-wake/src/index.ts:414`

后果一：同进程同文件读+解析两遍（行为无差，规范偏离）。后果二（更要紧）：
`getPersona` 现行「首个调用点 path 生效、后续 path 静默忽略」——若两器官配置
一旦分叉，第二个器官会**拿到错的人格且无声**。SA-156「每进程恰一份内核」
目前靠文件不变这个偶然事实而非机制。

## 治理定案

- **D-CP-1**：converse / wake 生产调用点改 `getPersona(resolve(...))`。
  `loadPersona` 保留原样（fail-fast 各路径的测试练习面，注释已写明）。
- **D-CP-2**：`getPersona` 增 **path 一致性守卫**：首次成功装载记录归一化
  path（resolve 后）；后续调用 path 不同 → 抛 `PersonaConfigError`（启动即
  炸，把「静默错人格」变成 fail-fast）。仅**成功装载**才落缓存与首 path
  （失败不占坑，负例测试不受顺序毒化）。
- **D-CP-3**：如测试需要清缓存，只许**测试专用**导出（命名必须自带
  `ForTest` 类字样），生产代码路径零调用——缓存在生产不可清除是 SA-156
  的一部分。是否需要由侦查决定（见判据②风险注）。

## 判据（每判据一 commit，`[WO-CACHE-PERSONA]` 前缀）

① **decide 守卫**：`persona-toml.ts` 的 `getPersona` 实现 D-CP-2；测试补：
   - 同 path 两调返回**同一对象引用**（缓存实证）；
   - 相对/绝对写法指向同一文件不误炸（resolve 归一化实证）；
   - 不同 path 二调 → `PersonaConfigError`，message 逐字钉（含两个 path，
     人话可排障）；
   - 失败装载不占坑：先用坏 path 调（抛），再用好 path 调（成功）。
② **调用点迁移**：converse / wake 两处 `loadPersona(` → `getPersona(`
   （import 面同步；`loadPersona` 若在该文件再无使用点则从 import 去除）。
   **风险注（侦查后处置）**：若某测试进程以多个**不同**合法 persona path
   经插件链装载（例：负例坏 path 在前属安全——失败不占坑；但两个不同好
   path 会触守卫），按 D-CP-3 加测试专用清缓存并在相应测试 setup 使用；
   若实勘无此形态则不加（不为假想需求开口子）。侦查结论写报告。
③ **全量收口**：`npm test` + `npx tsc --noEmit` 全绿；基线（main 现尖）
   tests 808 / pass 797 / fail 0 / skipped 11。新数字如实报，失败逐条归因。
   报告写 `governance/wo/WO-CACHE-PERSONA/report.md` 并入本 commit。

## forbidden

- 不动 `loadPersona` 行为与签名（含其错误 message——负例钉着逐字）。
- 不动 gate / kernel / adapter / memory / heart 等邻接包。
- 不动 `profile/*.yml`（personaToml 配置面本单零变化）。
- 不新增依赖、不改 package-lock。
- 不碰 m4-switch；不 push。
- 测试前台串行跑完再交卷（教训 23/44）。

## required_evidence

每判据 commit sha + diff 摘要；守卫负例红→绿自证；②的侦查结论
（各测试进程的 persona path 形态清单）；全量测试与 tsc 原样末尾输出。
