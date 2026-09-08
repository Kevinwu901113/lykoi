# WO-OUTCOME-CONTRACT-02 · A1 正本契约对齐

依据：Kevin在当前任务再次明确要求converse/turn_terminal正本、四态、旧converse/silence仅派生。该要求优先于旧WO-OUTCOME-01的turn/terminal五态。

已明确的施工：新终局只由DurableIngress持久结果投影为converse/turn_terminal；event_id不变，保持幂等，历史日志不改写。converse/silence仅由intentional_silence终局派生，不在技术失败或等审批时先发一条“沉默”。审批/建议消费仍由同一入口落终局，run_aborted保留。

四态具体枚举与consumed归属尚待Kevin答复，不擅自把审批消费说成认知主动沉默或已交付回复。该部分待定期间只施工事件归属与派生路径。

## Kevin授权代定后的决定

四态定为completed / intentional_silence / deferred / failed。completed覆盖答复已送达与审批/建议应答已消费；reason保留approval_answer/suggestion_answer，不把消费记作沉默。四态类型由ingress导出，converse直接引用；旧spool replied/consumed待投影时转completed，未知状态失败关闭为failed/unknown；不重写历史审计。
