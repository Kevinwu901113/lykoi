# WO-OWNER-TASK-FLOW-01 — 定时送达与审批交互结构修复

基线 b2104080，分支 wo/owner-task-flow-01。本轮代码、必要验证与交付材料已完成；尚未合并或部署。生产 Telegram 验收仍须在部署后另做，不能用本机控制端验收替代。本轮没有操作、恢复或重跑已取消的生产 R2 任务。

## 根因与处理

1. **已确定的消息被降成开放任务目标。** 旧实现只保存自然语言目标，到期再次调用模型，模型可以重新寻找聊天记录，也可以改写成功句。现在 `conversation.promise_followup` 可显式登记 `message:{text,delaySeconds}`；宿主按本条来话的真实 `receivedAt` 计算 dueAt，把原文与到期时间保存在同一 Task。现有扫描、run、取消、重启及 delivery 账本继续承重，到期复用现有完成/送达路径，零后台模型或工具调用。普通研究任务继续由 cognition 决策。没有新增计时器、队列、Resolver、自然语言关键词识别或 messenger.read 禁用规则。
2. **审批意图处理与整条消息消费混为一谈。** 设备层现在返回已处理意图的 outcome、executed、replied，原始消息完整进入 Conversation。可信回执元数据与工具观察分别进入上下文：工具观察是数据，不进入 system 权限层。模型可继续回答同条业务问题，不必重复已经执行的审批。纯审批已有回执而模型选择 silence 时，owner turn 仍记 completed，保留一轮一条终局。
3. **机器结果被当成用户文案。** 内核执行回执取消任意对象/数组的 JSON fallback；仍展示明确的文本输出，完整 observation 交回 cognition。`task.control` 返回精简的 id/status/text 回执；`/task` 使用同一状态投影。完整 Task/operation 仍供 machine get/history 与诊断查询使用，未删除事实。
4. **停止工作和恢复执行共用同一审批默认值。** interactive 的 `task.control pause/cancel` 在明确 deny 与 hard floor 之后免去额外询问；resume、approve、自主 origin 和外部操作权限未放宽。取消关闭未执行的 Task approval，也关闭内核对应 pending；后续相同参数的新请求不再被旧的已关闭审批占住。已计算完成但尚未进入传输的结果也能取消；已在途外部操作仍如实保留待核实状态，不宣称撤回成功。

更新现有定时任务时，显式提供的新 message 替换原文与时间；只给新目标时清除旧定时原文并回到普通 cognition，避免静默发送旧内容。暂停保留暂停状态；提前 resume 不能越过 scheduledMessage 的 dueAt。新工具信封保留 task_id、task 与 message，定时正文不经过普通工具参数的 2000 字符降级。

## 验证

- 最终 `npm test`：**1,248 项，1,237 通过，0 失败，11 跳过**；`npm run typecheck` 与 `git diff --check` 通过。
- 定向测试覆盖 receipt 起算、59.999/60 秒边界、重启、提前恢复、精确原文、一次送达、取消、更新、不发送旧文、未进入传输的完成结果取消、审批队列同步关闭、过期/已消费审批不复用。
- 完整审批装配测试仍验证一次授权只执行一次、拒绝不执行；新增混合消息原文保留、观察数据不提升为 system 指令、机器 JSON 不直接倾倒、已有回执的 TurnOutcome、interactive 停止与 deny/hard floor 优先序。
- **真实 deepseek-flash + 临时 Instance + 实际 kernel/Runtime/messenger/BotApiTransport + 本机 HTTP 接收端**：模型自行选择 message 注册，`R2延迟送达成功` 在接收请求后 **75,037 ms** 逐字到达；仅一条，后台模型调用 0、Task 工具操作 0，重复扫描不重发，已耗尽的主动额度账本未变化。
- 真实模型混合拒绝场景：内核实际记 denied；随后同条消息中的周四 15:00、B 室、人数和预算缺失均得到回答；没有 messenger.read dispatch。
- 真实模型自然语言取消：实际执行 task.control 后 status=cancelled、wait=null、delivery=null；没有第二轮审批、没有读取消息、没有内部 JSON。收到的答复明确为“实际取消了”。

本机原始记录保存在 `/Users/wukevin/lykoi/followup-delivery-acceptance/`，不入 Git：
`owner-task-release-tests.log`、`owner-task-typecheck.log`、`owner-task-live.log`、`owner-interactions-live-final.log`。临时实例证据根目录由各 live 日志首行记录。

诊断失败保留：`owner-task-full.log` 的三项失败来自旧“消费整条审批消息”断言，已更新为真实回执后继续 cognition；`owner-interactions-live.log` 在调用模型前因验收脚本重复注册已有 messenger.read 失败；`owner-interactions-live-run.log` 的实际混合答复正确，但 B 室空格导致字面断言错误。只对自由业务答复改用语义匹配；定时成功句始终严格逐字比较，未裁标点、未修改模型输出。最终细化的观察回传及发送前取消另有确定性回归覆盖，不冒称为生产样本。

## 治理复核与落地边界

kernel 变动仅涉及上述回执投影、明确的停止权限以及 pending 生命周期。自复核检查了执行一次、拒绝优先、autonomous 不继承 interactive 停止许可、resume 不免审、外部观察不提升权限和原始 Task 结果可追溯。未修改 gate、生产 profile、权限规则文件或生产状态；治理审阅与合并仍待进行。

新增持久字段为可选 JSON 字段，无 SQL schema 迁移。旧版本不会理解 scheduledMessage 的确定性含义；若回滚，须先在当前版本暂停或取消新增定时原文任务，不能将其自动交给旧版后台推理。已有普通任务保留原运行方式，已取消历史任务不会复活。

合并并由 Kevin 按既有 root 边界部署后，使用一个新的一次性 Telegram 样本复验延迟原文、混合拒绝/提问、自然语言取消；以实际收到的消息和 Task/delivery 状态判定，不以服务 active 代替。
