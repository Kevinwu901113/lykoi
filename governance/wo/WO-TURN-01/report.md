# WO-TURN-01 · A2 接续交付

状态：实现及本地验收完成，未合并 main、未部署；治理复核与生产验收仍待交付阶段执行。

## 基线与提交

- 原施工基线 `c557af2`；接手 HEAD `97431ab`，继承未提交代码。
- 遗留检查点 `d2b6048`；整合当前远端 main `c17e148` 的工单分支提交 `4d20a91`。
- 实现修正提交 `80818d4`；分支 `wo/turn-01`，其后仅补本报告。
- 原始 tracked/untracked 备份保存在本机 `batch-20260906/`。报告中此前关于子 agent 的表述属于前次施工历史；本轮未派子 agent，不把本地自检冒充独立治理复核。

## 数据与 ID 生命周期

```text
platform message/update identity
  → inbound_parts.inbound_id（原文、时间戳、边界、来源、reply_to）
  → user_turns.id（同 channel/context/user/owner scope）
  → run:<turnId>:r0（本单一次 cognition；revision 留 A3）
  → 原有 Kernel action_id / correlation_id
```

SQLite 正本为独立 `inbound-spool.db`，仅两表：`inbound_parts`、`user_turns`。平台消息/update 唯一索引防重投；parts 按 part_order 保序。turn 状态 collecting → queued → running → terminal；终局 payload 先存 SQLite，JSONL 是幂等投影。

`user_version=1` 是新基础设施库版本；`memory.db` 的 mind_schema 仍为 18，本单对当前 main 的 memory 包最终差异为零。构造器拒绝认知库、其它库及未知版本，不静默往已有库加表。新库首启建表，无生产认知迁移；删除了遗留实现未部署的 019 候选。

## 接收、组装与恢复

```text
normalize → SQLite accept commit → markActive（同步）
  → accepted audit → cursor fsync/rename → ingress.kick
  → idle/hard commit → FIFO executor → Converse → SQLite terminal
  → recordOnce + fsync → terminal_audited
```

- 实时输入 idle 1500 ms、hard 4000 ms，值由签名 profile 装配；不同 scope 不合并，owner 身份变化也隔开。
- 启动补收使用零等待 poll；来源时间早于启动的消息标 replay。跨 poll 的 replay 不受普通 hard window 拆分，空批确定收齐后按 scope 提交 restart_replay。replay 标记持久化，补收中重启仍不会一条条执行。
- parts[] 是正本。单条实时投影原样；多 part/replay 在最后认知边界使用 `[来源时间或接收时间]\n原文` 按序投影。原文的空白、CRLF、换行和边界保留，时间戳为元数据，不写回原文。
- 普通回复锚定最后 part 的平台 message ID；审批/建议逐 part 先路由，被消费部分不送 cognition，其余部分合并。只有 ingress 负责该 turn 的唯一 terminal。
- collecting 普通窗口按持久时间恢复；queued FIFO 恢复；running 在崩溃后 failed/interrupted 收束，不冒险重跑未知外部动作；terminal 只补审计、不重新认知。
- markActive 在 durable commit 后、审计 I/O 前执行；审计暂时失败也不会让已收输入对 wake 隐形。
- recordOnce 保留稳定 event_id、跨重启去重。撕裂 JSONL 尾行通过追加换行隔离，不截断历史。终局投影 fsync 后才允许 SQLite 标记已审计。

## 实证与验证

最终 `npm test`：**1187 tests / 1176 pass / 0 fail / 11 skipped**；`npm run typecheck`、`git diff --check` 通过。

第一次沙箱全量的本地 HTTP/Unix socket 测试报 listen EPERM，属于环境限制。获准本地监听后最终完整重跑退出 0。没有跳过新失败或削弱断言。

- ingress：14 用例，包含两次恢复、跨 hard window 跨 poll 合并、不同 peer、库隔离、审计故障通知、FIFO/去重/终局恢复。
- adapter：97 用例，真实 adapter + durable ingress 验证跨 poll 补收与 markActive；A 被阻塞时 B/C 已落盘、游标前进，释放后仍按 A→B/C 串行。
- converse：180 / 179 pass / 1 skipped，审批/建议归属、continuation、Kernel、实例装配及时间戳投影回归通过。
- audit：5 用例，包含跨重启幂等与撕裂尾行恢复。
- `evidence.mjs` 重新运行 PASS；`evidence.json` 是本树新证据。六场景：multipart_idle、hard_max、duplicate_idempotence、blocked_a_fifo、restart_collecting_queued_terminal、manifest_preflight。
- manifest 本地计算/序列化/解析覆盖 **125** 项，含新 ingress 源文件与 package.json；使用临时合成人格文件，未写生产 manifest。

三条消息固定时钟 trace：t=0/500/1000 ms 接纳三条，t=2500 ms 提交同一 turn；parts 原文按序，terminal 恰一条，inbound_ids 和 platform_message_ids 可反查三条 constituent。完整逐步库快照见 evidence.json。

独立 evidence 脚本仅驱动真实 ingress/store，不宣称它包含 Telegram 网络；cursor 解耦证据在 adapter.test.ts 的真实 adapter 回归。生产 Telegram 实收和落地后的运行账尚未验证。

## 改动文件

- `governance/wo/WO-TURN-01/evidence.json`
- `governance/wo/WO-TURN-01/evidence.mjs`
- `governance/wo/WO-TURN-01/order.md`
- `governance/wo/WO-TURN-01/report.md`
- `package-lock.json`
- `packages/lykoi-adapter-telegram/package.json`
- `packages/lykoi-adapter-telegram/src/index.ts`
- `packages/lykoi-adapter-telegram/test/adapter.test.ts`
- `packages/lykoi-adapter-telegram/test/bridge.test.ts`
- `packages/lykoi-adapter-telegram/test/split.test.ts`
- `packages/lykoi-audit/src/index.ts`
- `packages/lykoi-audit/test/audit.test.ts`
- `packages/lykoi-converse/package.json`
- `packages/lykoi-converse/src/index.ts`
- `packages/lykoi-converse/test/approval-e2e.test.ts`
- `packages/lykoi-converse/test/continuation.test.ts`
- `packages/lykoi-converse/test/e2e.test.ts`
- `packages/lykoi-converse/test/kernel-e2e.test.ts`
- `packages/lykoi-converse/test/llm-finish.test.ts`
- `packages/lykoi-converse/test/outcome.test.ts`
- `packages/lykoi-converse/test/turn-fixture.ts`
- `packages/lykoi-converse/test/w3-organs.test.ts`
- `packages/lykoi-converse/test/wire.test.ts`
- `packages/lykoi-gate/src/vocabulary.ts`
- `packages/lykoi-ingress/package.json`
- `packages/lykoi-ingress/src/index.ts`
- `packages/lykoi-ingress/src/schema.ts`
- `packages/lykoi-ingress/src/store.ts`
- `packages/lykoi-ingress/src/types.ts`
- `packages/lykoi-ingress/test/infrastructure.test.ts`
- `packages/lykoi-ingress/test/ingress.test.ts`
- `profile/cordis.prod.yml`
- `profile/cordis.yml`
- `profile/package.json`

## 依赖与观测面

新增 workspace 包 `lykoi-ingress`（Cordis、Schema、audit）；adapter/converse/profile 依赖它。无新外部依赖、无环境变量。配置 dbPath/idleWindowMs/hardWindowMs/autoStart；prod dbPath 为 `/home/lykoi/state/inbound-spool.db`，dev 为 `var/inbound-spool.db`。

新事件 inbound/accepted、turn/collecting、turn/committed、turn/queued、turn/part_consumed；沿用 turn/terminal。新增对话域 vocabulary 前缀 inbound/，既有 turn/ 继续覆盖其余事件。只记 ID/数量/哈希/类别，不记消息正文。

## A3 接续与实际边界

- WO-INGRESS-01 的 JSON spool 草案被本 SQLite A2 实现替代，不得另起重复接收队列。
- WO-INTERRUPT-01 草案的 superseded turn/重建新 turn 会与本次要求“每 turn 一个终局、run_aborted reason=revision”冲突。后继按同一 turn 的 run revision 做最小修订，首次 dispatch 后只排队；不照抄六状态草案。
- A2 没有主动 abort/revision、Task Runtime、人格新层或信封 utterances[]，不把它们报告为已完成。
- 已落地的 canonical 事件名 turn/terminal 和 consumed 状态沿用后续正式 A1 order；原始分组文字的 converse/turn_terminal 四态没有在本单反向覆盖生产契约。

## 部署与回滚提示

生产必须停稳单写者后部署；备份既有 cursor 与审计，以及已有的 inbound-spool.db。无需 mind_schema 迁移；先确认 ingress 路径独立、父目录可写、运行账号可读取并追加 audit 文件（recordOnce 恢复需读历史）。新源码、依赖和 profile 需生产 manifest 重签与 gate；重启后核库表、turn/terminal 链及真实多条入站。

回滚代码必须保留 spool 文件：旧体不消费它，不表示积压已交付。禁止删除 spool 来消除排队。整批落地稿会统一给出停机、备份、签名、启动与核验命令；本次没有连接生产、迁移真实库、发送用户消息、签署生产 manifest 或重启服务。
