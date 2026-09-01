# lykoi-cordis

Lykoi 是一个面向长期持续存在的数字生命框架：有持续身份、可成长人格、自己的
目标与拒绝权的 AI 主体，面向唯一主用户建立长期 1-1 关系，在所有者治理权、
硬性安全策略、权限与预算约束下自主活动。每次部署产生一个独立个体。

本仓库包含 Cordis(TS/Node) 运行时源码、本体蓝图（`docs/`）与治理平面全史
（`governance/`）。架构语义正本：白皮书 v1.2 第 37 章
（`governance/docs/lykoi_whitepaper_v1.2_2026-08-18.md`），冲突以白皮书为准。

## 现状

- 2026-08-31 起为线上活体（M4 切换完成）；旧 Python 躯体 2026-09-01 退役。
- 已上线：Telegram 对话（人格 + 记忆 + 审批）、自主醒拍与学习环、审计、
  预算硬顶、启动完整性门（八检查项）。
- 待建：视觉 / 浏览器 / 环境感知（M5 及之后）。

## 仓库布局

```
lykoi-cordis/
├── packages/          插件树。每个包一个器官或一层治理地基
│   ├── lykoi-kernel     特权层：dispatch 主链 / 三层审批门 / policy core /
│   │                    path guard / 委托台账 / 通知原语
│   ├── lykoi-gate       启动完整性门（八检查项）。不是插件，启动前跑一次就退出
│   ├── lykoi-heart      心脏：基线节律 + 显著性唤醒接口
│   ├── lykoi-audit      append-only 审计 sink（JSONL）
│   ├── lykoi-budget     费用硬顶，每次 LLM 调用必经
│   ├── lykoi-converse   对话心智：上下文装配器 + 决策信封周期
│   ├── lykoi-wake       自主侧：醒来一拍（推演 / 接地 / 内语）
│   ├── lykoi-learn      学习环 L1..L5（纯库，装配面无条目，由 wake 驱动）
│   ├── lykoi-memory     state 库接入（缺省只读 + 显式 rw 入口）
│   ├── lykoi-adapter-telegram   出入站器官：Telegram
│   └── …                decide / reflow / regulation / snapshot / llm / llm-deepseek
├── profile/           装配面
│   ├── cordis.yml       dev 装配：开箱能跑、零真网、零 root 供给
│   ├── cordis.prod.yml  prod 装配：规范 state 路径、器官位及各自的 root 供给条件
│   ├── index.ts         dev 入口（硬指 cordis.yml）
│   └── index.prod.ts    prod 入口（硬指 cordis.prod.yml；零 env 读取）
├── docs/              本体蓝图：M1..M4 分波蓝图、schema 登记、切换交接清单
│   └── deploy.md        生产部署指南
├── deploy/            部署模板（占位符，不含真值）：systemd unit / 凭据文件样例
└── governance/        治理平面正本：白皮书、工单全史、报告、协作方案
```

`profile/*` 与 `packages/{lykoi-kernel,lykoi-gate}/**` 在完整性门的 root 属主域，
其余 `packages/*/src/**` 在 hash-pin 域——改动要 root 重签 manifest，否则启动闸红
（受保护面全表：`packages/lykoi-gate/src/surface.ts`）。

## dev 快速上手

零真网、零 root 供给、不碰任何真 state。

```sh
git clone <本仓库> lykoi-cordis && cd lykoi-cordis

npm ci                       # lockfile 钉版；服务器上用 npm ci --ignore-scripts
npm test                     # 813 项（802 pass / 11 skip / 0 fail）
npm run typecheck            # tsc --noEmit，净

LYKOI_M1_SMOKE=1 npm start   # 一次性验收序列
npm start                    # 常驻，Ctrl-C 停
```

dev 装配把 `var/` 落在仓库根下，首次运行自动建。LLM 走 mock 路由；
`converse` / `memory` / `telegram-transport` / `telegram` 默认 `disabled`。

完整性门（`node packages/lykoi-gate/src/cli.ts`）在开发机上必然红：它核的是
生产机上的 root 属主、规范路径与 manifest 签名，属设计行为。

## 生产部署

从零起一个自己的 Lykoi：[`docs/deploy.md`](docs/deploy.md)。
记忆数据（`memory.db`）是个体身份，不在仓库里；部署产生的是新个体。

## 纪律

1. 本仓库永不存放密钥、Token、活体 state 或记忆备份。凭据只以 env 引用名出现
   （`tokenEnv` / `apiKeyEnv`），值住在 `/home/lykoi/secrets/` 与 systemd
   `EnvironmentFile`。
2. 装配面的改动是治理动作：`profile/*` 改一个字节就要 root 重签 manifest。
3. R-01：绝不允许两个进程同时写同一份 state。
4. 与白皮书冲突时以白皮书为准。

## 血统

旧体 `Kevinwu901113/lykoi`（Python）与独立治理仓 `lykoi-governance` 已归档，
全史存本地 git bundle，本仓库是唯一维护仓库。`/home/lykoi/state/` 由新体原样
接管——换躯体不换记忆。迁移总案：
`governance/docs/cordis_full_migration_plan_v1_2026-08-24.md`。
