# P5 合并后真实模型验收

版本：main e25100ba9723f1b1099023fc1ce9c4734c5c2002。模型：deepseek-flash（通过官方 models 接口核实）。结论：REQUEST CHANGES，P5 暂不 CLOSED。

## 通过的范围

合并后 CI 已成功：https://github.com/Kevinwu901113/lykoi/actions/runs/34496638525 。本地专项 33/33 通过，覆盖前三个 blocker、finding 去重、来源权限、请求槽、取消和重放。合并树与先前全量通过版本相同。此次验收脚本类型检查通过。

真实模型在无预设响应的对话中生成了 case-a-timeout-watch 记录；零外部额度的一拍选择 contemplate，把原来的“等更多数据”扩展为待验证判据，revision 1→2。关闭并重建 Runtime/Mind/Task 实例后，记录保持一致。这里验证的是运行时与数据库重开，不冒充 OS 进程崩溃验收。

加入合成反例 B（两次超时但重试成功）、C（没有超时却返回错误数据）后，模型实际调用 evidence.read 读取两条资料，并提出可用性与正确性需要分开判断。简单研究被它直接完成，没有自然产生 Task，这本身不判失败。

另外以已存在的合成自主研究意图作为初态，并在 Wake 只提供任务入口，模型实际创建 task-3a958674-2404-4332-b6b2-b2d906c7695f；Task 读取 B/C，保存带引用的结论，状态 completed、origin=autonomous、delivery=null。属于有研究意图和能力约束的链路验收，不声称无条件自发创建任务。返回结果真实进入 Mind inbox。

## 不通过的范围

1. **记录协议对真实模型不够清楚，认知提交失败。** 反例样本中模型看到 revision=4 却提交 5，Wake 因 revision conflict 失败。Task 回流样本中它看到 revision=2，却提交 3，并把 open 写成 null；当前合同要求 open 为字符串，提交报 invalid mind record。该事务没有吞掉证据，事件仍待处理，但“Task 完成→Mind 理解并确认”这条实际链路没有闭合。不要放松版本冲突保护或直接将整批错误更新当成功；需要让线上的输出协议明确字段和版本语义，并以这些真实失败样本回归。
2. **问题被过早关闭。** 反例后的下一拍将案例 A 标为 resolved，尽管 A 的重试结果和正确性数据仍缺失；正文自己也写着“需以重试成功与否确认”。默认 Mind.view 不展示 resolved 记录，因此未决问题会离开工作集。B/C 支持修订一般判据，不能替 A 补齐事实。需要验证“判据研究完成”和“原问题已解决”的区分。

首个脚本试跑另有固定运行编号重复、对话夹具时钟未替换的问题，已修正后才采用正式样本；首轮出现的零预算工具尝试保留为观察，不单独归为产品阻断。没有为了得到通过而重复采样或删掉失败响应。

## 证据和边界

可复跑入口：profile/test/p5-live.ts；默认执行对话、纯思考、运行时重开和反例场景，--task 执行自主 Task 场景。只需向进程注入 DEEPSEEK_API_KEY；凭据不入文件。脚本记录每次模型输入、输出、usage、Wake 结果、Task 与 Mind 状态，并在任一 Wake 失败时返回非零。每次请求 90 秒超时，每实例 80000 token 预算，不配置 Telegram。

本次共 14 次真实模型调用（包括废弃脚本首轮的 2 次）：适配器报告 inputTokens=25165、outputTokens=13589、cacheReadTokens=16256、reasoningTokens=5041。保留各字段原义，不把 reasoning 或缓存重复相加成“总 token”。原始证据已保存到当前任务的 acceptance/p5-e25100b/；未入 Git。

本次为实现者验收，不宣称独立复核。未做 P4 同预算对照、真实模型并行聊天/取消压力测试、Skill 泛化或 Telegram 实收；无生产部署或真实消息发送。凭据所在临时进程已退出。
