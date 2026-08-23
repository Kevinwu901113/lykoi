# M1 骨架蓝图 · 2026-08-24

M1 目标（总案 §4）：新体在 state **副本**上能感知、能对话、账本有数。本文是波次划分与
包布局的执行蓝图；行为规格正本在治理仓库 M0 四单报告，此处只引用不复述。

## 参考正本（构建 Agent 必读）

- 治理仓库 `wo/WO-M0-DSH-STUDY/report.md` —— cordis API/loader 语义/复用清单/版本钉法
- 治理仓库 `wo/WO-M0-STATE-CONTRACT/report.md` —— 数据契约（C-01..C-30 / R-01..R-20）
- 治理仓库 `wo/WO-M0-SPEC-CONV/report.md` —— 对话路径 94 条规格（波次 2 起消费）
- 治理仓库 `docs/cordis_full_migration_plan_v1_2026-08-24.md` —— 总案与不变量

## 工程基线（定案）

- Node **24 LTS**（`.nvmrc` + `engines`），ESM-only，TypeScript strict。
- **npm** workspace（lockfileVersion 3），全部 `@deepseek-ai/*` 依赖**显式钉
  `0.1.1-rc.2`**（dist-tag 陷阱：裸装会拿到 0.0.1-rc.1）；cordis 钉 `4.0.1`。
- 安装纪律：`npm ci --ignore-scripts`。
- **不挂**：telemetry-otel 行、client-ui/web/host 全家、llm-pi-ai、web-search。
- **CF-B6**：`dsh-llm-deepseek` 以 vendored 形式进 `packages/lykoi-llm-deepseek`
  （去掉 `resolveUserId`/实例假名头；UA 版本头保留；其余逐字保留并注明 vendor 基版本）。
- 测试：`node --test`（内建 test runner），每包 `npm test` 可独立跑。
- 配置树：`profile/cordis.yml` 直排 entries（M1 不用 bundle 分层；patch 层 M3 引入）。

## 包布局

```
lykoi-cordis/
├── profile/                 cordis.yml + 启动入口（loader+include+timer 拉起插件树）
├── packages/
│   ├── lykoi-audit          治理地基①：append-only 审计 sink（JSONL，单次 write 一整行；
│   │                        契约对齐 R-16；M1 写 dev 路径，M3 接 /var/log 权限模型）
│   ├── lykoi-budget         治理地基②：费用硬顶——route 会计 + run 归因 + 前置闸
│   │                        （每次 LLM 调用必经；超顶拒调并落审计；日/滚动窗口可配）
│   ├── lykoi-heart          心脏：基线心跳只置位不消费 + tick 合并（错过 N 拍=1 次唤醒
│   │                        +计数可观测）+ 显著性唤醒接口位（M2 接 salience）
│   ├── lykoi-llm            薄注册层（复用 dsh-llm 词汇；budget 前置闸挂在这里）
│   ├── lykoi-llm-deepseek   CF-B6 vendored adapter（剥头版）
│   └── lykoi-memory         better-sqlite3 只读接 state 副本（波次 2；契约 C-01..C-30，
│                            M1 全程 `mode=ro`，R-01 硬规则：绝不写真 state）
└── docs/
```

## 波次划分

**波次 1（本波）**：workspace 脚手架 + lockfile 钉版 + `lykoi-audit` + `lykoi-budget`
+ `lykoi-heart`（三包完整含测试）+ `lykoi-llm` 注册层（budget 闸接通，adapter 可先
mock）+ profile 能起：`npm start` 拉起插件树，心跳在跳、每拍过 audit、budget 红测
（超顶拒调）通过。**验收 = 测试全绿 + 一次真实起跑日志。**

**波次 2**：`lykoi-llm-deepseek` vendored 剥头版 + `lykoi-memory` 只读（对 Mac 备份
memory.db 副本实测：37 表读通、mind_schema=15 断言、C-22 双时间戳格式 parse）+
telegram 适配器（S-01..S-11 语义）+ 最小对话环（dev bot 或本地 REPL 通道）。

**波次 3（M2 入口）**：装配器 + 决策信封（S-23..S-53，D-01/D-02 出生规格版）。

## 纪律（构建 Agent 逐字遵守）

1. 语义保真：凡对应 M0 规格条目的实现，代码注释标条目号（如 `// S-42` / `// C-02`）。
2. 不发明：蓝图没写的架构决定不擅自加；拿不准就留 TODO 注释 + 在报告里列出。
3. 不 push：只在工作树写代码，git 提交与推送归治理侧复核后执行。
4. 零外发：除 npm registry 安装外不访问网络；不碰 `/Users/wukevin/Documents/lykoi/`
   下 lykoi-cordis 以外的目录（治理仓库四份报告只读除外）；不碰任何服务器。
5. 秘密纪律：任何 key/token 不进代码不进配置；凭据走 env 引用形态（学 dsh credentials）。
