# LANDING-N 落地后读数（2026-09-04）

- 地位：治理内部复评，读数来源为服务器 `/var/log/lykoi-audit/audit.jsonl`（治理账户组读）与 `systemctl status`。
- 窗口：`deploy_event head=e299c1d` 的 ts `2026-09-03T17:28:36Z`（01:28 CST 09-04）至 `2026-09-04T06:53Z`（14:53 CST），13.4 小时，403 条事件。
- 对照窗：落地前 24 小时（`2026-09-02T17:28:36Z`–`2026-09-03T17:28:36Z`），1129 条。
- 事件计数一律精确匹配 `"type":"X"`。
- 进程：`lykoi-cordis.service` active since 01:28:35 CST，窗内无重启（NRestarts 数值不可读：治理账户 sudo 白名单只有 `systemctl status`，无 `show`）。

## 1 · 对话路径：零样本

| 事件 | 前 24 h | 后 13.4 h |
|---|---|---|
| telegram/inbound | 16 | 0 |
| converse/reply | 5 | 0 |
| converse/silence | 6 | 0 |
| u3_cycle_envelope | 28 | 0 |
| u3_cycle_retried | 17 | 0 |
| u3_cycle_failed | 4 | 0 |
| action_result | 29 | 0 |
| turn_failed | 0 | 0 |

最后一条 `telegram/inbound` 是 `2026-09-03T16:44:25Z`（00:44 CST，问 ETH/BTC 价那条），在落地之前。

因此 N 的四项验收读数全部无样本，本次不能判定：research `action_result` 出现 `success:false` 与 `unbacked_claim`；step 0 `elapsed_ms` 对 `prompt_tokens` / `reasoning_len`；step ≥ 1 `first_char:other` 归零；`notify_owner` 参数误用下降。

## 2 · 醒拍路径：THINKPOLICY 的 low 档位已生效

profile `llm-deepseek` 的 `reasoningEffort: low` 作用于全部信封调用，醒拍是窗内唯一有样本的路径。

| 项 | 前 24 h | 后 13.4 h |
|---|---|---|
| autonomy_wake | 47 | 27 |
| autonomy_wake_retried | 6 | 1 |
| autonomy_wake_failed | 1 | 0 |
| 醒拍 budget/charge 条数 | 58 | 30 |
| completionTokens 中位 | 7792 | 2536 |
| completionTokens p90 | 13957 | 4180 |
| completionTokens 最大 | 15588 | 5550 |
| promptTokens 中位 | 3620 | 3253 |
| 决策分布 | rest 26 / contemplate 10 / tend_inner 6 / explore 4 / initiate_chat 1 | rest 20 / contemplate 4 / tend_inner 3 / explore 0 / initiate_chat 0 |

- DeepSeek 的 completionTokens 含推理 token。每拍完成 token 中位数降到落地前的三分之一，p90 降到十分之三。
- 唯一一次重试：`2026-09-03T22:38:02Z` `not_json content_len 0 reasoning_len 1095`，引导重试后该拍 completed（LANDING-K 路径）。
- 后窗 explore / initiate_chat 为 0。后窗全在 01:38–14:38 CST，样本 27 拍，与前窗不同时段，不能据此判定 low 档位压低了外向决策。要看满一天。
- 09-04 UTC 日累计 dayTotalTokens 89638（至 06:38Z，只有醒拍）。

## 3 · 新发现：getUpdates 收到 HTTP 502 时无退避

审计事实：

- 按 UTC 日计，`telegram_transport_api_error` + `telegram_transport_network_error`：08-31 4、09-01 10、09-02 18、09-03 6、09-04 48（至 06:53Z）。
- `2026-09-04T01:17:10.972Z`–`01:17:21.828Z`：38 条 `telegram_transport_api_error {method:getUpdates, status:502}`，相邻间隔约 290 ms（一个经代理的 HTTP 往返）。随后 `01:17:56Z` TimeoutError，`01:18:57Z` `telegram_poll_recovered {streak:2, duration_s:60.3}`。
- 前 24 h 的 `telegram_transport_api_error` 为 0，这是该路径在新体上的首次观察。
- `00:03:22Z`–`00:05:08Z`：TimeoutError 与 TransportError 交替 8 条（同类连击只记首条与每第 10 条，交替即各自 streak 1），`00:05:34Z` recovered 26.1 s。
- 无 update 丢失：失败批不推进 offset，平台侧未 ack。

代码事实（Mac 副本 main@28cf4c0）：

| 位置 | 行为 |
|---|---|
| `packages/lykoi-adapter-telegram/src/transport.ts` `#postApi` | 网络异常：getUpdates 只计 streak 不重试、不 sleep，返回 `ok:false`；HTTP ≥ 400 或 `ok!==true`：记 `telegram_transport_api_error` 后立即返回 `ok:false`。文件头注释：getUpdates 的重连节奏归设备的长轮询循环管。 |
| `src/production.ts` `poll()` | `pollUpdates` 失败一律转成空批返回，不抛。 |
| `src/index.ts` 常驻循环 | 退避 1→60 s 只写在 `catch` 里；`pollOnce` 对空批正常返回，`catch` 不会进入。 |

两层各自把退避交给对方，结果是没有一层退避。网络异常路径受 fetch 超时约束（每次失败至少等一个超时），不成热循环；HTTP 快速失败（502）路径以 HTTP 往返为节拍热循环，直到平台恢复。本次持续 11 秒 38 次；若 Telegram 侧故障更长，请求率约 3.4 次/秒持续整个故障期。

不属特权层（kernel / gate）。候选小单：退避归一处——`poll()` 把 `error` 带回循环让现有退避生效，或 `#postApi` 对 getUpdates 的 api_error 就地 sleep。选哪一处由 Kevin 裁。

## 4 · 既有信号，非新增

- `grounding_concern_out_of_snapshot {concern_id:5, where:assessment}`：前 24 h 15 条，后窗 4 条。
- `suspension_overdue_breakdown {threads:3, thoughts:0}`：09-03 与 09-04 各一条，均在 00:07–00:08Z。

## 5 · 下一步

1. 对话样本：Kevin 向实例发几条需要查资料的消息（天气、价格、时效性问题），落地后读数才有样本。读数项见 §1。
2. 醒拍 low 档位的决策分布看满 24 h 再判。
3. getUpdates 502 退避小单待裁。

## 6 · 记录订正

LANDING-N 的落地时刻是 `2026-09-03T17:28:36Z` = 01:28 CST 09-04（裁合提交 01:38 +0800 相符）。HANDOFF 09-04 条目里「01:28 UTC / 09:28 CST」是时区标错。
