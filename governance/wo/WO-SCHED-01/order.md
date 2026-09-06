# WO-SCHED-01 · 首次派发前的 run revision

Kevin 已授权整批实施。本单继承 A2 `f0c0dae`，分支 `wo/sched-01`；替代旧 WO-INTERRUPT-01 中新建 superseded turn 的方案。

- 相同 channel/context/user 的新 owner 输入 durable accept 后，只有当前 Conversation 尚在未提交认知结果的 LLM 等待、且从未执行工具时可 abort。外部/内部动作或认知结果已开始应用后只 FIFO 排队。
- 新 part 直接附到原 turn；turn_id 不换。每次 run_id 使用递增 r0/r1/r2，最多两次 revision，防止连发饿死。每个 abort 有持久 `converse/run_aborted reason=revision`，原 turn 最终只有一次 turn/terminal。
- 判断可打断 → SQLite 附加 part → abort 是同一同步 JS 调用段，无 await，不容 dispatch 插入其间。记录 revision_pending 支持该提交后的进程崩溃恢复。
- 仍一把 Conversation 锁、一个 FIFO executor。取消不合作的 LLM 也必须释放锁；迟到回包不得修改下一 run 的历史或执行任何工具。费用仍由原调用记账，不能声称已取消网络或获得未回传 usage。
- 不改 kernel/policy、prompt、TurnStatus，不建 Task Runtime 或副作用登记表；spool 独立 schema 1→2 保存 bounded run revision 元数据，mind_schema 18 不动。
- 验收：同 turn 多 run/单 terminal；跨 peer、审批 reply_to、background 不抢占；首次工具前后边界；最多两次；迟到成功/失败无副作用；durable 后 crash 恢复；schema 迁移/版本拒开；全量/typecheck。报告必须区分逻辑取消与供应商真取消。
- 本地交付、分支推送获授权；不合并 main、不部署生产。
