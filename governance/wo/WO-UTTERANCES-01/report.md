# WO-UTTERANCES-01 · A4 剩余范围交付

状态：实现及本地验收完成，分支 `wo/utterances-01`，基线 `1bccebe`。未合并、未部署；真实模型影子、Telegram 实收与独立治理复核尚未进行。

## 实现

reply 可提供 `utterances: string[]`，显式数组优先于旧 content。旧单条 content 兼容；数组必须非空，所有成员必须为非空白字符串，任何非法成员拒绝整封。仅用 trim 判空，发送字符串本身不 trim。对旧字符串接口的投影使用 join('')，不引入分隔字符。

parseEnvelope 复用 extractJson/evaluateMessage，候选、溯源、inner 护栏不变；降级或 silence/tool_call 不输出分段。promise_followup 的 content 仍是续跑目标，utterances 可另表本轮可见消息。消息历史逐条保存，多条的 history 行增加 utterances 以保留边界。send 的锁内回调把当次分段交给调用方，保留原 Promise<string> 接口，不使用跨 run 的待取分段槽。

sequencer 不并发、不加延迟、不改字。每条沿原 sendReply/dispatch/E2、原 turn/run 和回复锚点；首次失败或抛错就停止尾部，只有全部交付才算 replied。`converse/utterances_delivery` 记录 total/delivered/outcome，零正文。成功前缀不重发，未尝试尾部保留在历史而不自动重跑。既有待批提示改为独立 `[系统]` 消息，模型原文不再被前缀加工。

continuation 将本轮分段依次交给原 postProgress/outbox。这里的 completed 仍表示认知续跑完成并入原出站路径，不冒充 Telegram 已签收。

## 验证

`npm run typecheck`、`git diff --check` 通过；最终完整 `npm test` 退出0：**1203 tests / 1192 pass / 0 fail / 11 skipped**。

新增6个测试：数组/坏数组/旧content/降级/沉默；真实Conversation串行两run的回调与history边界；等待前条及失败截止；真实handleTurn的部分交付失败终局/ID/零正文；真实续跑输出分段；真实BotApiTransport的4096组合拆包。最后一项使用假HTTP seam与合成凭据，没有外网发送。

组合拆包样本：第一条为4095个汉字 + emoji + 尾字 + CRLF，第二条为带首尾空白的独立消息；传输共3包，每包不超过4096 UTF-16单元，所有包直接拼接等于原两条直接拼接，第二条边界保留。4096逻辑留在既有传输层，本单没有再造长度限制。

首次全量仅既有fake的send参数精确断言未纳入新回调；组合测试最初误把BotApiTransport成功返回中省略sent视为失败。均按实际契约修正测试后完整重跑，没有改生产成功语义。

## Prompt SHA 变更

| 常量 | 原 chars / SHA256 | 新 chars / SHA256 |
|---|---|---|
| ENVELOPE_SYSTEM_PROMPT | 1748 / 88587c8e3d923969d16a92e4cb996b6d45d5e2e077ac7af00ff016a39c0be14a | 1788 / dee3cff2ba2e4ff7cbc3e6765b6b62980e13039bef8f84e0535aad131245010c |
| envelopeSystemPrompt() | 2984 / 29f1377755b5890c14ab151f269ecb55a97e749e0fbe401546da30538786988f | 3024 / d3a4d3a8f72520c009f50a65d748329bcfb4e53992e7b219981cb07656e3786c |

只改 reply/promise_followup 两条字段说明，增加分段语义；逆向恢复测试仍证明其余旧契约字节不变。稳定前缀会失效一次。未改 SYSTEM_PROMPT、wake prompt、policy-core、schema、依赖或环境变量。

## 交付

源码改动为 converse/contract.ts、conversation.ts、index.ts、continuation.ts、新sequencer.ts，共5个manifest文件；测试为contract/prompts/outcome/continuation及新utterances.test.ts。本单触及manifest域，需要生产重签。

真实模型影子要检查数组合法率、条数/字节、降级方向与延迟；随后真实Telegram核对数组分段、超长拆包和失败终局。当前产物可用于这些验收，未完成的影子/生产验证不得写成通过。整批交付统一提供落地步骤，旧WO-UTTER-01的4096完成记录仍有效。
