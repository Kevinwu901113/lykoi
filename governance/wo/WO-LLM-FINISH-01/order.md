# WO-LLM-FINISH-01 · lykoi-llm 不再吞 finish 失败

- 签发：治理侧，2026-09-01（WO-INC-LLM-ROUTE 关单跟进项）
- 承接：执行 Agent（建议 sonnet；代码小单）
- 基线：main 最新（签发时 595d41c；业务代码等于生产钉 acb814f 的 main 侧）
- 背景（事故实证 2026-09-01）：dsh-llm 把 adapter 失败归一成
  `finish{error}` chunk 不外抛；`lykoi-llm` `call()`
  （packages/lykoi-llm/src/index.ts:99-128）收集 finish 后**静默随返回值
  带出**，调用方拿到空 text 按 0 记账继续跑，报错晚两层——wake 处才以
  `did not return a decision JSON: ''` 炸出，根因（NO_ADAPTER）全程不可见。
  她自 M4 切换起 18 拍全失败无人知晓，即此缺陷的代价。

## goal

模型调用失败在**唯一入口层**（lykoi-llm）就近、带原因地失败，不再靠下游
解码空串间接发现。

## scope

1. `call()` 消费 chunk 流后：若 `finish.reason` 为失败类（以
   `node_modules/@deepseek-ai/dsh-llm` 的 `FinishReason` 实际类型词表为准，
   报告须引用类型定义原文——禁凭记忆写词表），在**完成 charge 之后**抛出
   带类型错误（建议 `LlmFinishError`），携带：reason 全量、route、
   usage（若有）、拼接到的 text 长度。保持既有结构保证：调用发生后必
   charge，charge 先于抛出（对齐现有 hasThrown 路径的次序，index.ts:110-126）。
2. 非失败类 finish（stop 等）行为逐字节不变；空 text + 正常 stop 不在本单
   范围（那是 converse D-01 重试域）。
3. 调用方核对：枚举 `ctx.lykoiLlm.call` 全部调用点，实证新抛错落入各自
   **既有**失败处理路径（wake 失败事件、converse 周期失败），错误信息含
   reason；无新的 unhandled rejection 面。只核对与测试，不重构调用方。
4. 测试：红绿双验——mock adapter 发 `finish{error}` → `call()` reject 且
   reason 保真、budget.charge 仍发生（记账断言）；既有全量不回归。

## forbidden

- 不动 budget/gate 语义与记账口径（usage 缺席按 0 记账的 TODO(M2) 维持，
  不在本单引入估算）。
- 不动 prompt/ENVELOPE、不动 vendor payload 构建、零新依赖。
- 不动 kernel/gate 包（root 域）。

## success_criteria

新增红绿测试点名通过；全量测试对照基线零新增失败（基线数字以执行时
`node --test` 全量为准，报告给出与自查）；`tsc` 净；调用点枚举表（文件:行）
与落点判读。

## required_evidence

报告一次性输出（stdout 即报告本体）：diff 摘要、FinishReason 词表引用、
调用点枚举、全量测试数字、新测试输出。前台串行跑测试，禁后台挂起交卷。
