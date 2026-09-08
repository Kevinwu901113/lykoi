# WO-SCHED-01 · A3 接续交付

状态：实现及本地验收完成；分支 `wo/sched-01` 继承 A2 `f0c0dae`。未合并 main、未部署，独立治理复核和生产实收仍待交付。

## 结果

同 scope 的新 owner 输入在首个认知结果开始应用前，可以取消当前 LLM 等待。新 part 先持久附到原 turn，再同步 abort；同一个 turn 依次运行 r0/r1/r2，最多两次 revision。每次取消有持久 `converse/run_aborted reason=revision`，最终仍只有一条 `turn/terminal`。超过两次、跨 scope、显式审批回复、background 和已开始应用结果的 run 均走原串行队列。

判断、SQLite 提交、abort 之间没有 await，工具派发不能插入这个间隙。取消信号传到 dsh；即使 LLM 不响应取消，调用方也能释放锁。迟到响应在解析和工具执行之前检查 signal，不能污染后继 run；旧 run 的 finally 也不能封闭新 run 的打断窗口。

可打断区间保守地截止于认知结果开始应用，而非仅在 kernel.dispatch 处截止，因为 inner/progress 也有写入。该边界早于首次 dispatch，不回滚任何已经应用的认知结果；没有新副作用登记表，kernel/policy/prompt 保持原样。

## 持久化与恢复

基础设施 spool schema 从 1 原子升级到 2，增加 revision、revision_pending、bounded aborted_runs_json 和审计投影计数。保留两张原表、原 part 与 turn 身份、原 FIFO 序号；认知库 mind_schema 仍为18。

新 part 提交后若进程崩溃，恢复把原 turn 排回 r1/r2，并补一次 run_aborted。未标 revision_pending 的未知 running run 仍按 A2 interrupted 收束，不自动重做可能已发生的动作。run_aborted 使用 stable event_id，审计 fsync 后才标记投影完成。

## 验证

最终 `npm run typecheck`、`git diff --check` 通过；完整 `npm test` 退出0：**1195 tests / 1184 pass / 0 fail / 11 skipped**。首次全量暴露 RunAbortedError 误插入注释导致六条既有错误回执失败，已修复实际导入并完整重跑，没有沿用失败前的判断。

- 真实 Conversation + handleTurn + ingress/SQLite：同 turn 多 run、唯一 terminal、最多两次、最后 part 回复锚点、首次派发前后、跨 scope/审批/background、迟到成功和失败。
- 冻结 A2 schema1 SQL fixture 验证迁移保留数据、重复启动；durable attach 后崩溃，跨两次启动仍只一条 abort 与 terminal。
- 本机 HTTP SSE 驱动实际 dsh/vendor DeepSeek 接线：首个 chunk 后 abort，客户端返回 aborted，服务端观察连接关闭。使用本地假供应商和合成凭据；没有调用真实供应商，不声称供应商退还 token 或未返回的 usage 可恢复。
- A2 六场景 evidence 脚本改为读取当前基础设施版本，在本分支再跑 PASS，产物为本目录 evidence.json；它覆盖继承的 ingress/manifest 场景，A3 取消证据来自上述新测试。A2 历史 evidence.json 未覆盖。

## 交付面与限制

改动集中在 converse 的 deadline/Conversation/handleTurn、ingress runtime/store/schema、新测试和工单证据。没有新增外部依赖、环境变量或审计正文。manifest 必须在生产装配时重算并签名，本地证据不是生产签名。

部署需停稳单写者并备份 spool、audit、cursor；schema2 不能直接由 A2 schema1 代码打开，回滚必须保留积压并使用兼容读取版本，禁止删库清队列。统一落地步骤留在整批交付；本单没有生产迁移、发消息或重启服务。本地自检不是独立治理复核。
