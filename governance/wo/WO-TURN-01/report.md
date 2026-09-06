# WO-TURN-01 · A2 接手与交付报告

状态：接手审查中，尚未合并或部署。最终验证与独立复核完成后更新本行。

## 1. 范围与依据

- 正本是本目录 `order.md`：Kevin 在任务「实现持久化接收与Turn组装」提供的原文，本次从原附件逐字归档。
- 前次任务因额度耗尽中断，留下 `wo/turn-01` 未提交实现。本次先保存原始 tracked diff 和 untracked 文件副本，再接续施工。
- 原施工基线 `c557af20ed90f9e7fa0b37c0d035e8d1b15c6fc2`；本次已快进到 `97431abae6c1271d981e3a2535d6ba860318e8f5`。两者之间只有治理材料和 budget/wake 测试变化，A2 的运行时前提仍成立。
- 本单只实现外部输入的可靠接收、合并与 FIFO 执行。不实现 A3 打断、A4 分段、Task Runtime、人格新层或能力解析器。
- `WO-INGRESS-01` 的 JSON spool 方案与本单作用域重叠，不应再并行实施。后继 `WO-INTERRUPT-01` 必须基于本单最终的 UserTurn/run 分层重评，不能直接套用旧 `seqs/merged/superseded` 假设。
- 本次子 agent 均为 `gpt-5.6-luna` / `max`：分别审查持久化与审计、集成回归、独立验收证据。

## 2. 数据模型与 ID

```text
channel + platform identity
  → inbound_parts.inbound_id
  → user_turns.id（一个 turn 含多个 part，part_order 保序）
  → run_id（一次认知尝试）
  → Kernel 原有 action_id / correlation_id（原语义保留）
```

`inbound_parts` 保存每条原文、原始消息边界、来源时间与接收时间、channel/context/user/owner 盖章及显式回复归属。平台消息与 update 唯一索引阻止重投新增 part；重投保留首次接收的原文。

`user_turns` 状态为 `collecting → queued → running → terminal`，保存窗口时间、提交原因、FIFO 序号、run ID、终局 JSON 和审计投影状态。`parts[]` 是持久正本；Converse 只在最终装配边界用换行投影成既有单字符串输入。

同 channel/context/user 的连续输入按 idle 1500 ms、hard 4000 ms 组装；两值在签名装配配置中可校准，不经环境变量改道。普通回复锚定最后一个 part 的平台消息 ID。

## 3. 接收、执行与恢复

```text
Telegram poll
  → 既有身份/绑定检查
  → 中性 InboundPart
  → SQLite durable accept
  → cursor 持久化
  → ingress.kick

Assembler 到期提交 → FIFO worker → Converse → SQLite terminal → JSONL 投影
```

timer 与正在执行的 cognition 解耦。A 正在执行时 B/C 仍能持久接收，待 A 完成后按 committed FIFO 进入同一 worker。ContinuationRunner 保持原有内部入口，不经过外部输入的 settle window。

恢复类别：

| 崩溃时状态 | 恢复方向 |
|---|---|
| accept 已提交、cursor 未落盘 | 平台重投由唯一索引吸收，不再增加 part |
| collecting | 依据持久时间重建剩余窗口；已过期则提交 |
| queued | 保持 FIFO 待执行 |
| running | 以 failed/interrupted 收束，不自动重跑未知副作用 |
| terminal，审计尚未完成 | 补终局审计投影，不重跑 cognition |
| terminal，审计已完成 | 不重跑、不重复 terminal |

`running` 恢复为失败是崩溃记账，不是 A3 的主动中止或 revision。外部动作与 SQLite 之间没有分布式事务；不得宣称外部动作恰好执行一次。

## 4. 验证与修复

接手时（旧基线）的全量测试：1118 项，1107 通过、0 失败、11 跳过；typecheck 通过。最新基线和审查修复后的读数待回填。

逐项验收证据、修复说明、最终测试与提交清单将在独立复核完成后补齐。

## 5. 部署边界

- schema 18 → 19：本目录 `migrations/019_durable_ingress.up.sql` 与 `down.sql`。
- 没有新增环境变量、外部队列、网络服务或并行认知 worker。
- 新包 `lykoi-ingress` 与受影响包的 package.json、src、profile 均属于 manifest 覆盖面；gate 增加 `inbound/` 对话面词汇登记。
- manifest 是生产部署产物，不入库。本地只验证覆盖面、哈希生成与校验；生产必须由 Kevin 在停机、备份、迁移之后重签。
- down 仅撤 schema 19 台账，保留已接收消息和 turn 表。旧代码不消费这些表；回滚不等于这些待处理消息已交付。再次前滚须核表与索引后补回版本台账，不能盲目重跑建表 SQL。
- 本次没有连接生产、迁移真实 memory.db、签署生产 manifest、重启服务或发送真实用户消息。
