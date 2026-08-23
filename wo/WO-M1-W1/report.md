# WO-M1-W1 · M1 波次 1 骨架构建 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent（2026-08-24 凌晨；中途撞 session limit 一次，原上下文续跑收口）
- 产物 commit：lykoi-cordis `4ae553a`（基 4d1f8af 蓝图）
- 复核：治理侧独立复跑 `npm test` 14/14 绿 + `tsc --noEmit` 净 + 四包源码逐文件审——**PASS**

## 交付清单（全部 done）

- workspace 脚手架：根 package.json（workspaces+engines>=24）、.nvmrc=24、tsconfig
  （strict/ESM/NodeNext/noEmit+erasableSyntaxOnly，Node 24 原生 type-stripping 直跑 .ts 无构建步）
- 依赖钉版 lockfile（v3，22 个 resolved 全部 registry.npmjs.org）；`npm ci --ignore-scripts`
  复验通过；schemastery 按 dsh-llm 解析钉 `@deepseek-ai/schemastery@3.18.1`
- `packages/lykoi-audit`：append-only 审计 sink。'a' 打开无截断路径、进程内 promise 链串行、
  整行单 buffer 单次 write（R-16）、partial write 检测抛错、dispose 后拒写。测试 3/3
- `packages/lykoi-budget`：UTC 日滚动 per-route+总量双层硬顶；gate 拒调落审计后抛
  BudgetExceeded；账本原子写（tmp+fsync+rename，R-12 手法）；损坏当空仍受当日硬顶保护。
  记账顺序=内存→持久化→audit，失败抛但内存计数保留（宁多算不漏算）；`used >= cap` 即拒。测试 5/5
- `packages/lykoi-heart`：只置位不消费（pending 计数可观测）、claim 合并返回 {beats:N}、
  arouse(reason) 提前拍接口位（M2 接 salience）、定时器经 ctx.effect 可逆；
  **硬依赖 audit（inject）**，每拍落审计行。测试 3/3
- `packages/lykoi-llm` + mock adapter：dsh-llm LlmRuntime 词汇原样；call() 结构保证
  gate(route)→stream→charge(usage)，gate 拒时调用不发生（测试证：adapter 零调用+charge 零发生）；
  调用后成败必记账，原始错误优先抛。runId 必填=run 归因。测试 3/3
- `profile/`：cordis.yml 直排 7 entries + index.ts（loader+include 拉起）；
  `npm start` 首跑证据（var/first-run.log）：五服务 up、连续 3 拍+claim 合并 beats=3、
  audit 6 行、budget 红测 REFUSED（used=68 cap=50）、退出码 0；常驻模式亦验证

## TODO 台账（5 条，M2/M3 认领）

1. audit 行规范信封（actor/decision/evidence）→ M3 治理移植波
2. budget 生产硬顶数值与调整流程 → M3（现为 dev 占位，profile 显式配置）
3. audit 持续写失败时心脏是否停搏（fail-closed 层级）→ M3
4. isolate/权限模型物理遮蔽裸 ctx.llm（唯一入口从纪律升边界）→ M3
5. usage 缺席按 0 记账，是否保守估算 → M2 真实 adapter 波

## 实现事实（接手须知）

- loader@1.0.2 坑：include 的 ctx 链看不到 Loader tree ctx 的 baseUrl，须在根 ctx 先置
  `root.baseUrl`（profile/index.ts 注释指 loader/src/index.ts:80；首跑曾 ERR_INVALID_URL 暴露）
- node --test 目录参数不识别 .ts，须 glob `"test/**/*.test.ts"`
- dsh-llm peerDependencies 自动带入 dsh-brand/attachment/invariants/timeout（库依赖，
  无一挂进插件树，与"不挂"清单不冲突）；loader 可选 peer node-addon-require-builtin
  未装（HMR 才需要），loader 回落动态 import 正常
- mock adapter 固定用量 21+13/次（红测算术确定性，cordis.yml 可配）
- var/（audit.jsonl/budget.json/first-run.log）已入 .gitignore（治理侧定：运行产物不入库）

## 纪律核验

未 commit/push（治理侧复核后提交）；网络仅 npm registry；未触碰仓外路径（四份只读材料除外）；
零凭据入库。蓝图明文项零偏离；蓝图未定处按最小方案落地并全部留痕（上两节）。
