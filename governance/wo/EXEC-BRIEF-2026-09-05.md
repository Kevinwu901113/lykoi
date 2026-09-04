# EXEC-BRIEF · 执行方入场须知（2026-09-05 批工单共用）

- 地位：`governance/wo/QUEUE-2026-09-05.md` 所列全部工单的共用前置。每张 `order.md` 的 §0 都指向本文；本文与 order 冲突时以 order 为准。
- 读者：执行子 Agent（Claude Code 会话，无本仓库既往上下文）。Kevin 逐单派发；主治理 Agent 复核。
- 依据：`governance/HANDOFF.md` §三（派发模板）、白皮书 v1.2、Kevin 裁定 R-A～R-D（2026-09-04）。

## 1 · 角色与禁区

- 执行方只在**分支**上改代码、跑测试、写 `report.md`，提交到分支。不合并 main，不 push main，不改 `governance/HANDOFF.md`，不动 `governance/docs/`。
- 不触碰产线：不 ssh 服务器，不读写 `/home/lykoi/state`、`memory.db`、`/home/lykoi/secrets`、`/var/log/lykoi-audit`。工单里凡写"Kevin 在服务器跑"的步骤，执行方只交脚本，不代跑。
- 不打印、不入库任何 persona 正文、密钥、bot token、真实 chat id。测试夹具只用仓库里已有的合成值。
- 不新增 `LYKOI_*` 环境变量作为行为旋钮（GK-6 零 env 改道）。状态文件路径可以按 `packages/lykoi-gate/src/surface.ts` `ENV_PINS` 既有体例加钉面行（那是钉死，不是旋钮），加一行必须同步改 `packages/lykoi-gate/test/env-pins.test.ts` 的计数与 path 名单、`profile/cordis.prod.yml:216-231` 的状态路径表注释、`packages/lykoi-adapter-telegram/src/testing.ts` `isolateOutboundState`。
- 不改 `packages/lykoi-kernel/src/policy-core.ts`、`packages/lykoi-gate/src/*` 除非 order 明写。改了 gate 源码或 `profile/*.yml` 或任何 `packages/*/src/*.ts`，都意味着落地时要重签 manifest；执行方在 report 里写一句"本单触及 manifest 域：是/否，触及文件数 N"。

## 2 · 环境与基线

- 仓库：`/Users/wukevin/Documents/lykoi/lykoi-cordis`（npm workspaces，`packages/lykoi-*`）。Node ≥ 24。
- 基线：`main@c557af2`（代码与产线钉点 `main@8da87dc` 相同；c557af2 之后只有治理文档提交）。产线 schema `mind_schema=18`，manifest 117 项。
- 分支名：`wo/<工单小写 id>`，例如 `wo/ingress-01`。从 main 当前 tip 开分支；工单有前置依赖时从前置分支尾开（QUEUE 写明）。
- 命令：
  ```bash
  npm ci
  npm run typecheck
  npm test
  ```
  基线读数（main@8da87dc）：tests 1104 / pass 1093 / fail 0 / skipped 11。跑单包：`node --test packages/<pkg>/test/<file>.test.ts`。
- 测试时钟：夹具日期与真实时钟不一致会出"早绿晚红"（教训：`governance/HANDOFF.md` 教训 31c）；复跑单点失败先查时钟再查回归。

## 3 · 写代码的纪律

- 命名 snake_case（审计字段、文件名、状态键）；代码风格跟随所在文件。
- **审计零正文（D-08 / S-21）**：`audit.record` 与 `logEvent` 的行里只放计数、id、枚举、长度；不放消息文本、回复文本、工具结果。新增审计事件名若属对话面（`converse/`、`u3_cycle_`、`turn/`、`continuation/` 前缀之外的新前缀），必须登记到 `packages/lykoi-gate/src/vocabulary.ts` `CONVERSATION_FACING_PREFIXES`，否则 gate 词汇测试红（教训 D-08）。
- **提示词 sha 纪律（G-2）**：`packages/lykoi-converse/test/prompts.test.ts` 与 `packages/lykoi-decide/test/prompt.test.ts` 用 chars + sha256 钉住每个提示词常量。order 明写"允许改提示词"的工单才可改；改了就在 report 里贴"sha 变更表"（常量名 / 旧 chars+sha / 新 chars+sha / 改动一句话），并更新测试钉面。没写允许的工单改了提示词 = 越界。
- **迁移**：schema 改动走 `governance/wo/<WO>/migrations/NNN_<name>.up.sql` + `.down.sql`，编号接续（当前最后一号 018），`PRAGMA user_version` 同步，`sqlite3 -bail` 可重入（version 已达则跳过）。
- **状态文件**：写盘走 tmp + fsync + rename（参考 `packages/lykoi-adapter-telegram/src/index.ts:213-225` `writeJsonAtomic`）；损坏文件视为空并出一条审计，不抛。
- 不加依赖包。不改 `package.json` 除非 order 明写。

## 4 · 报告（report.md）

每单在 `governance/wo/<WO-ID>/report.md` 写：

1. 分支与提交（sha）、基线 sha。
2. 改动文件清单（路径 + 一句话），是否触及 manifest 域。
3. 每条 D-n 的落实位置（file:line）。
4. 测试读数：`npm test` 四个数；新增测试文件与用例数；未通过项如实贴输出。
5. sha 变更表（若有）。
6. 越界未做项与原因；发现的候选小单（只列，不做）。
7. 给 Kevin 的落地提示：是否需要迁移、是否需要重签 manifest、是否需要服务器只读命令。

文风：事实句，不叙事，不解释设计哲学。表格优先。

## 5 · 提交

```bash
git -c user.name="lykoi-governance" -c user.email="kevin20011113@gmail.com" commit -m "<WO-ID>: <一句话>

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

一单一分支多提交可以；最后一提交是 report.md。不 rebase 已 push 的分支。
