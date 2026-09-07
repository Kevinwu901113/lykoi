# WO-UTTERANCES-01 · A4 信封分段与顺序交付

Kevin 已授权整批，原表 A4 明确包含 `utterances[]`。现有 WO-UTTER-01 只落地4096传输拆包，本单补剩余范围，继承 `1bccebe`，分支 `wo/utterances-01`。

- 允许本单改 converse 信封契约及对应 prompt SHA。reply 可以给 utterances 字符串数组；旧 content 单条兼容。显式分段优先，逐条原样保存和发送，不 trim、加分隔字符、符号改写或随机延迟。空数组/空白条目/非字符串拒绝整封，不跳过坏条目。4096仍只在Telegram传输。
- promise_followup 的 content 保留任务语义；若给 utterances 则作为可见消息，不能把任务描述和可见承诺混为一项。
- 复用 evaluateMessage 的候选/溯源/inner 门。分段不得绕过 demote 或 silence；工具信封携带分段不意味着工具可以顺带发话。
- Conversation 保持现有 send 字符串兼容接口，通过锁内回调交给调用方该 run 的确切分段，避免后继 run 覆盖待消费分段。history同时保留分段边界；旧 reply 投影由分段直接拼接，不增字符。
- 确定性 sequencer 串行等待每条完成，第一处失败立即停止，只有全部成功才 delivered。审计只记录数量、序号、长度和类别；不重试已经成功的前缀。每条仍绑定原 turn/run，经原 dispatch/E2。既有待批提示作为独立系统文案发送，不污染模型原文。
- continuation 的输出沿既有 outbox 逐条入队；不造 Task Runtime、调度器或第二份副作用状态表。生产真实模型影子与Telegram实收留落地验收，交付可运行合成测试和prompt变更表，不伪造外网实证。
- 不合并main、不部署。验证：数组精确字节与边界、旧content、坏数组拒绝、demote/silence、同run顺序/部分失败终局、续跑分段、4096组合路径、typecheck/全量与sha。
