/**
 * lykoi-kernel —— 治理特权层骨架（M3-W1；CF-B1：**非插件库模块**，插件 import
 * 它，不入插件树）。
 *
 * 规格正本：治理仓库 wo/WO-M3-SPEC-KERNEL/report.md（SK-01..29 dispatch 主链+
 * 三层门+scoped grants+pending；SK-30..46 审批器官；SK-61..69 委托台账+scope
 * key；SK-47/48 豁免消费位）+ guardian-live-20260825/（policy core 逐字正本）
 * + docs/m3_blueprint.md 治理定案 GK-1..14。逐字对拍正本 =
 * lykoi-cordis-refsrc/lykoi/kernel/*。
 *
 * 模块地图：
 *  - dispatch.ts     认知到资源的唯一通路（SK-01..12；审计门 fail closed）
 *  - approval.ts     三层门 check 10 步 + scoped grants + pending（SK-15..29）
 *  - approval-conversation.ts 审批对话机：四道闸+先发后排+回执（SK-30..35）
 *  - approval-interpreter.ts  答复解释器：判读/归属/明确度门/六元组（SK-36..46）
 *  - policy-core.ts  不可变治理核 TS 对应物（guardian 逐字；GK-12）
 *  - scope.ts        授权范围键全表（SK-69）
 *  - exemption.ts    E1/E2/E3 豁免（SK-47/48；消费位 = check 第⑨步）
 *  - delegation.ts   委托台账七态 + 审计先行（SK-61..66）
 *  - delegation-resource.ts 资源薄壳（SK-67；传输面 M5）
 *  - notifications.ts 通知队列真身 + GK-1 持久 next_id + GK-8 开关（SK-56..58）
 *  - suggestion-conversation.ts 建议问答机（SK-49..55；GK-3/GK-10）
 *  - interactive-lock.ts 对话优先标记（S-17；单进程形态，DK-11 语义入注释）
 *  - proactive-chat.ts 主动开口预算账本（脑干层事实，红线 #5；快照读面）
 *  - redaction.ts    密文遮蔽（SK-05）
 */
export * from './approval.ts'
export * from './approval-conversation.ts'
export * from './approval-interpreter.ts'
export * from './delegation.ts'
export * from './delegation-resource.ts'
export * from './dispatch.ts'
export * from './exemption.ts'
export * from './interactive-lock.ts'
export * from './jsonio.ts'
export * from './notifications.ts'
export * from './policy-core.ts'
export * from './proactive-chat.ts'
export * from './redaction.ts'
export * from './scope.ts'
export * from './suggestion-conversation.ts'
export * from './telemetry.ts'
