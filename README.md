# Lykoi

Lykoi 是一个面向长期持续运行的个人 AI Agent，核心关注 **持久记忆、自主活动，以及明确的能力与权限边界**。

它不是一个无状态聊天机器人。Lykoi 会持续保存自己的状态，可以在没有新用户消息时自主醒来、思考和整理经验，并在长期运行过程中逐步形成稳定的记忆、关注点和内部状态。

同时，语言模型本身并不直接拥有系统权限。外部动作需要经过确定性的权限、审批、预算和审计机制。

当前运行时基于 **TypeScript、Node.js 和 Cordis** 构建。

## 目前具备的能力

- **持久记忆**：保存对话、经历、思考、关注项、叙事状态及学习结果，并跨重启持续存在。
- **对话循环**：在回复前组装人格、记忆、上下文和当前可用能力。
- **自主唤醒**：系统可以周期性醒来，根据当前状态进行思考、整理和学习，而不依赖用户主动发起消息。
- **学习与整合**：将累积的经历进一步整理成更高层次的内部状态，而不是把每次对话都视为孤立事件。
- **受控动作执行**：语言模型提出的外部动作不会直接执行，而是统一进入 Kernel。
- **权限与审批**：敏感动作可以要求用户审批，也可以通过预先授权的 standing grant 放行。
- **预算控制**：独立记录和限制 LLM 调用消耗。
- **审计记录**：重要决策和动作写入独立审计链路。
- **Telegram 接入**：当前主要交互入口。

## 架构

```text
                         ┌──────────────┐
                         │    Heart     │
                         └──────┬───────┘
                                │ wake
                                ▼
                         ┌──────────────┐
                         │     Wake     │
                         └──────┬───────┘
                                │
                       decide / reflow / learn
                                │
                                ▼
┌──────────┐             ┌──────────────┐             ┌──────────────┐
│ Telegram │ ──────────► │   Converse   │ ──────────► │     LLM      │
└──────────┘             └──────┬───────┘             └──────────────┘
                                │
                                ▼
                              Memory

               Converse / Wake 提出的外部动作
                                │
                                ▼
                             Kernel
                                │
                      审批 / 策略 / Dispatch
                                │
                                ▼
                         外部 Capability

                     Budget · Audit · Regulation
```

Lykoi 的一个核心设计原则是：

> **推理不等于权限。**

LLM 可以负责理解、推理和提出动作，但最终是否允许执行，由确定性的系统组件决定。

## 仓库结构

```text
packages/
├── lykoi-converse          对话循环
├── lykoi-wake              自主唤醒
├── lykoi-memory            持久状态与记忆
├── lykoi-learn             学习与整合
├── lykoi-heart             节律与唤醒信号
├── lykoi-kernel            特权动作与策略层
├── lykoi-gate              启动完整性检查
├── lykoi-budget            LLM 预算控制
├── lykoi-audit             审计事件
├── lykoi-llm               LLM 抽象层
├── lykoi-llm-deepseek      DeepSeek 接入
├── lykoi-adapter-telegram  Telegram 适配器
├── lykoi-decide            决策逻辑
├── lykoi-reflow            状态与推理流
├── lykoi-regulation        行为调节
└── lykoi-snapshot          状态快照

profile/                    运行时装配
docs/                       实现与部署资料
governance/                 设计与治理记录
deploy/                     部署模板
```

## 本地运行

要求：

- Node.js 24+
- npm

```bash
git clone https://github.com/Kevinwu901113/lykoi.git
cd lykoi

npm ci
npm test
npm run typecheck
npm start
```

默认开发配置不会使用生产环境中的真实状态和凭据。

生产部署方式见 [`docs/deploy.md`](docs/deploy.md)。

## 设计原则

Lykoi 当前主要遵循以下约束：

- **推理不等于权限**：LLM 输出本身不能直接获得执行权。
- **记忆与运行时分离**：长期状态独立于程序代码保存。
- **自主不等于无限权限**：自主行为仍然受到策略、权限和预算约束。
- **重要行为应当可审计**：关键动作和治理决策需要留下记录。
- **能力应当显式存在**：系统能够做什么，应通过明确的 capability 暴露，而不是默认拥有宿主机权限。

## 当前状态

Lykoi 当前已经能够长期运行，并具备 Telegram 对话、持久记忆、自主唤醒、学习、受控动作执行、审计和 LLM 预算管理等基础能力。

项目仍在持续开发中。目前浏览器、环境感知和更丰富的外部能力仍未进入稳定运行时。
