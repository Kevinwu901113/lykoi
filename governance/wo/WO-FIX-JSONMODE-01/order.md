# WO-FIX-JSONMODE-01 · 派工单

- 立单：主治理 Agent，2026-09-03 18:50 CST
- 状态：**执行中**（Kevin 18:49 放行；sonnet 于 wt-fix-jsonmode-01 / wo/fix-jsonmode-01 执行）
- 来源：LANDING-K 验收反例（2026-09-03 18:39 CST）。Kevin 两条 Telegram 各三跳全空 → silence：一条 step 1（关思考），completion 67/62/52 token；一条 step 0（思考 high），reasoning 159/501/1081 递增。两次 `u3_cycle_failed` 都记 content_chars 51、first_char:empty、finish stop —— 一字符一 token 的换行/空格退化态。带引导的重试 prompt 只 34–162 token（前文全命中缓存），引导语确已入上下文仍无效。K 的引导只治「答案吞进 reasoning」与偶发空白（当日救回 4 次），对 json_object 退化态无效。
- 已排除的路：`LYKOI_U3_ENVELOPE_JSON_MODE` 是 GK-6 knob 钉（surface.ts:114），unit 环境覆盖即门 FAIL（18:44 实证，大脑离线约十分钟）。旋钮只能改签名源码 + 重签。
- 基线：main@3cdf1c8（代码树 = 产线钉点 f449fda）；全仓 1015+ / 0 fail，tsc 净（K 复核数）
- 执行：sonnet（一个条件 + 两个事件字段 + 测试）
- 零迁移、零 profile 改动、零新依赖、零 root 落地工作（改 `packages/lykoi-converse/src/**.ts`，manifest 须重签）

## 0 · 一句话

信封跳的 not_json 重试（attempt ≥ 1）不再带 `response_format:{type:'json_object'}`，靠 lykoi-decide 的 `extractJson`（花括号切片容错，contract.ts:classifyFailure 已在用）从正文里抠信封；attempt 0 的请求字节逐字节不变。retried/failed 事件补 `json_mode` 字段，让「哪种模式下空」可读数。不碰温度、不碰 step 0 首答、不碰 wake。

## 1 · 定案

- **D-1** `conversation.ts #completion(step, signal, nudge)`：`nudge` 为 true 时 `responseFormat: null`，否则维持 `envelopeJsonMode() ? ENVELOPE_RESPONSE_FORMAT : null`。attempt 0 请求与现产线逐字节相同（测试钉）。
- **D-2** `u3_cycle_retried` 与 `u3_cycle_failed` 各补一个字段 `json_mode: boolean`，值 = 刚失败的那一次请求是否带了 json_object。事件名不变、不加新事件（词汇表不动）。
- **D-3** 契约层不改：`ENVELOPE_RETRY_MAX = 2`、`JSON_RETRY_NUDGE` 原样。引导语文案已说「以 { 开始、以 } 结束、不要代码块」，与去 json 模式相容；若执行方发现 extractJson 对 ```` ```json ```` 围栏不容错，**只报不改**（fence 形态今天没出现过）。
- **D-4** 测试（`packages/lykoi-converse/test/cycle.test.ts`）：① attempt 0 调用 opts 含 `responseFormat:{type:'json_object'}`；② attempt 1、2 调用 opts 的 `responseFormat` 为 null 且 messages 末尾是引导；③ 重试返回「前缀说明 + JSON 对象」的正文能解析成信封并出 reply；④ retried/failed 事件 `json_mode` 取值正确。
- **D-5** wake 路径（wake/index.ts:280 写死 json_object，单次带引导重试）**不动**——今日 wake 的引导重试成功（10:07Z），样本不够，另单。

## 2 · 不许

- 不改 attempt 0 的任何请求字节；不改 `envelopeJsonMode()` 缺省；不动 `LYKOI_U3_ENVELOPE_JSON_MODE` 钉面。
- 不改温度、maxTokens、思考开关（D-1 of TOOLSTEP-01 原样）。
- 不新增事件名；不动 test/ 之外的 manifest 域外文件；不动 profile/。

## 3 · 交付

- 分支 `wo/fix-jsonmode-01`，工作树 `~/Documents/lykoi/wt-fix-jsonmode-01`，基于 main@3cdf1c8。
- report.md：改动清单、attempt 0 字节不变的证据（测试名）、全仓测试数、tsc。

## 4 · 验收读数（落地后）

- `u3_cycle_retried{json_mode:false}` 之后是否出 `u3_cycle_envelope`（重试成功率）；`u3_cycle_failed{not_json}` 日计相对 K 当日（2 沉默 / 4 条）的变化。
- first_char 分布：去 json 模式后若出现 fence/其它形态，回头看 D-3。
