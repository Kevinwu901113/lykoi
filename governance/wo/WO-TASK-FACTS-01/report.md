# Task 事实修复

前台 Task 摘要只携带旧 goal，缺少最新 requirements 与 scheduledMessage，导致已修改并正确投递的提醒被解释为仍是旧正文。本轮将其改为从现有记录生成的共同 taskFacts 投影；不改写历史 goal，也不维护第二份任务状态。

历史目标与原始请求放入 history；当前要求、待发正文/到期时间、结果与 delivery 分别呈现。snapshot 明确 current/event、要求版本及记录更新时间；createdAt 保留旧任务时间下限。Conversation 每次模型请求与 Wake 工作集使用同一投影；后台屏蔽原始请求正文，检索 Mind 使用最新要求。能力 get/list/create/update/retry 使用同一事实语义，control 保留小型人类回执。

Mind outbox 使用事件快照；新增 sent/failed/unknown 投递状态变化事件，与原状态更新同事务。历史 completion/pending 事件不会被后来 sent 状态改写，重复读取不重发事件。执行状态与投递状态仍独立。

验证：全量测试与 typecheck 通过；完整计数见 review.md。新增合成测试：实际 scheduled Runtime 修改正文保留 dueAt，并分别走 sent/failed/unknown；真实 Conversation 模型输入随状态刷新；真实 Cordis 旧任务无 request 时保留 createdAt 并按最新要求检索。没有调用生产模型，没有新 Telegram 消息。

中间问题保留：首次全量沙箱监听 EPERM；新增测试最初误取最后一条协议消息及类型断言错误；首次独立审查发现 createdAt/请求出处遗漏和旧目标检索，均修正后重新验证。不用中间失败替代最终结果。

生产当前 9bb57eb，修复尚未部署。合并 main 也包含先前已合并 PR13 的 Panel/Workspace/Pi 等补齐，部署包明确包含相应既有 Pi 供给。后续 Telegram 验收使用新任务核对：改正文保留时限、取消另一任务、投递后立即追问，不恢复旧 Q8/青杉47。
