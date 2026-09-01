# lykoi-cordis

Lykoi 是一个面向长期持续存在的**数字生命**框架（白皮书 §1）：一个有持续身份、
可成长人格、自己的目标与拒绝权的 AI 主体，面向唯一的**主用户**（所有者）建立
长期 1-1 关系，在所有者治理权、硬性安全策略、权限与预算的约束下自主活动。
**每次部署产生一个独立的 Lykoi 个体**——不同个体因初始人格、部署环境、
所接触的人与积累的经历而分化。

本仓库是她的完整正本，一棵树三样东西：Cordis(TS/Node) 运行时源码、本体蓝图、
治理平面全史。架构语义正本是白皮书 v1.2 第 37 章（心脏—大脑—器官），
本仓不改语义，只实现语义；一切冲突以白皮书为准
（`governance/docs/lykoi_whitepaper_v1.2_2026-08-18.md`）。

## 现状（2026-09-01）

- 本仓运行时自 **2026-08-31 夜**起是线上活体（迁移总案 M4 切换完成）；
  旧 Python 躯体已于 2026-09-01 物理退役（封存可回滚，正本
  `governance/wo/WO-CORE-RETIRE/`）。
- **已上线的器官**：Telegram 对话心智（人格内核 + 长期记忆 + 对话式审批）、
  自主醒拍（心跳门控；醒后思考，完成后串行驱动整合/专注学习环）、
  append-only 审计、LLM 日预算硬顶、八检查项启动完整性门。
- **待建的器官**：视觉 / 浏览器 / 环境感知（M5 及之后，见迁移总案）。
  她现在的行动面只有对话——这是建设次序，不是终态。

## 三种读者，三条路

- **想起一个自己的 Lykoi** → [`docs/deploy.md`](docs/deploy.md)：一台全新
  Linux 服务器从零到起立的生产部署指南（前置条件、目录与用户供给、密钥处理
  原则、bootstrap 预授权、manifest 签署、systemd 接线、按序翻开器官位、冒烟
  验证与排障表）。`deploy/` 有 unit 与凭据文件模板，占位符形式不含真值。
  注意：部署得到的是**一个新的个体**——记忆数据（`memory.db`）是身份本身，
  不在也永远不会在仓库里。
- **想读懂这具身体** → 白皮书第 37 章立架构观；`docs/` 各波蓝图
  （M1..M4）看她怎么长出来的；`packages/` 一包一器官，见下方布局。
- **想看她的历史** → `governance/`：工单全史、事故与关单记录、阶段审查、
  协作方案。这里的文件是决策留痕，**不随代码波次改写**。

## 仓库布局

```
lykoi-cordis/
├── packages/          插件树。每个包一个器官或一层治理地基
│   ├── lykoi-kernel     特权层：dispatch 主链 / 三层审批门 / policy core /
│   │                    path guard / 委托台账 / 通知原语。她咨询它但削不动它
│   ├── lykoi-gate       启动完整性门（八检查项）。**不是插件**——启动前跑一次就退出
│   ├── lykoi-heart      心脏：基线节律 + 显著性唤醒接口，只置位不消费
│   ├── lykoi-audit      治理地基：append-only 审计 sink（JSONL）
│   ├── lykoi-budget     治理地基：费用硬顶，每次 LLM 调用必经
│   ├── lykoi-converse   对话心智：上下文装配器 + 决策信封周期
│   ├── lykoi-wake       自主侧：醒来一拍（推演 / 接地 / 内语）
│   ├── lykoi-learn      学习环 L1..L5（纯库，装配面无条目；由 wake 在一拍
│   │                    完成后串行驱动整合与专注，SA-171）
│   ├── lykoi-memory     她的 state 库接入（缺省只读 + 显式 rw 入口）
│   ├── lykoi-adapter-telegram   出入站器官：Telegram
│   └── …                decide / reflow / regulation / snapshot / llm / llm-deepseek
├── profile/           装配面。**部署事实**住在这里
│   ├── cordis.yml       dev 装配：开箱能跑、零真网、零 root 供给，写 var/ 下的本地副本
│   ├── cordis.prod.yml  prod 装配：规范 state 路径、审计落 /var/log、器官位与它们
│   │                    各自需要的 root 供给（每条 disabled 都标了要什么才能翻开）
│   ├── index.ts         dev 入口（硬指 cordis.yml）
│   └── index.prod.ts    prod 入口（硬指 cordis.prod.yml；零 env 读取）
├── docs/              **本体蓝图**：M1..M4 分波蓝图、schema 登记、切换交接清单
│   └── deploy.md        生产部署指南（新用户从零起一个自己的 Lykoi）
├── deploy/            部署模板（占位符形式，不含任何真值）：systemd unit / 凭据文件样例
└── governance/        **治理平面正本**：白皮书、工单全史、报告、协作方案
```

`profile/*` 与 `packages/{lykoi-kernel,lykoi-gate}/**` 在完整性门的 root 属主域，
其余 `packages/*/src/**` 在 hash-pin 域——改动它们要 root 重签 manifest，
否则启动闸红（受保护面全表见 `packages/lykoi-gate/src/surface.ts`）。
`docs/` 里五份蓝图（`m1..m3_blueprint` / `m3_schema_registry` / `m4_handoff`）
同样钉在 manifest 上，属治理常数文档。

## dev 快速上手

零真网、零 root 供给、不碰任何真 state。以下命令在一份全新 clone 上实证跑过
（Node v24.18.0 / npm 11.16.0，2026-08-31；测试计数为 2026-09-01 现行基线）。

```sh
git clone <本仓库> lykoi-cordis && cd lykoi-cordis

npm ci                       # lockfile 钉版；服务器上用 npm ci --ignore-scripts
npm test                     # 813 项（802 pass / 11 skip / 0 fail），逐包 node --test
npm run typecheck            # tsc --noEmit，净

LYKOI_M1_SMOKE=1 npm start   # 一次性验收序列：心跳在跳 / 每拍落 audit / budget 硬顶拒调
npm start                    # 常驻：拉起插件树，基线心跳活着，Ctrl-C 停
```

`npm start` 起来后应当看到：

```
[lykoi] plugin tree up; services: audit=ok budget=ok heart=ok llm=ok lykoiLlm=ok
[lykoi] running (baseline heartbeat active); Ctrl-C to stop
```

dev 装配把 `var/`（audit / budget / heart-state）落在仓库根下，首次运行自动建，
已在 `.gitignore` 里。LLM 走 mock 路由；`converse` / `memory` /
`telegram-transport` / `telegram` 四位默认 `disabled`——它们要一个可写的 state
副本与人格 TOML，翻开是治理侧动作。

完整性门（`node packages/lykoi-gate/src/cli.ts`）在开发机上**必然红**：它核的是
生产机上的 root 属主、规范路径与 manifest 签名。这是设计如此，不是坏了。
（检查项⑧另要求 `var/state` 是指向 `/home/lykoi/state` 的符号链接——dev 用
真实目录，所以这一条在开发机上同样必红。生产供给步见 `docs/deploy.md §4b`。）

## 纪律

1. **本仓库永不存放**任何密钥、Token、活体 state 或记忆备份。凭据只以 env 引用名的
   形态出现在配置里（`tokenEnv` / `apiKeyEnv`），值住在 root 禁区
   `/home/lykoi/secrets/` 与 systemd 的 `EnvironmentFile` 里。
2. **装配面的改动是治理动作**。`profile/*` 说审计 sink 落在哪、通知推不推、
   哪些器官启用——改一个字节就要 root 重签 manifest，否则启动闸红。
3. **R-01**：绝不允许两个进程同时写同一份 state。切换与回滚都是严格串行。
4. **与白皮书冲突时以白皮书为准**。

## 血统

旧体 `Kevinwu901113/lykoi`（Python 服务器活体）与独立治理仓 `lykoi-governance`
已废弃归档：回滚锚与全史存于本地 git bundle，线上不再维护；治理平面以
`governance/` 子树并入本仓，**本仓库是唯一维护仓库**。

换躯体不换记忆：`/home/lykoi/state/`（`memory.db` 等）由新体原样接管，
对个体而言迁移前后是同一段连续的生命。迁移总案见
`governance/docs/cordis_full_migration_plan_v1_2026-08-24.md`
（M0 规格封存 → M1 骨架 → M2 心智移植 → M3 治理移植 → M4 切换 → M5 器官与走廊）。
