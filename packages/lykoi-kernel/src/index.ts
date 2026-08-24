/**
 * lykoi-kernel —— 治理特权层骨架（M3-W1；CF-B1：**非插件库模块**，插件 import
 * 它，不入插件树）。
 *
 * 规格正本：治理仓库 wo/WO-M3-SPEC-KERNEL/report.md（SK-01..29 dispatch 主链+
 * 三层门+scoped grants+pending；SK-61..69 委托台账+scope key；SK-47/48 豁免
 * 消费位）+ guardian-live-20260825/（policy core 逐字正本）+ docs/m3_blueprint.md
 * 治理定案 GK-1..14。逐字对拍正本 = lykoi-cordis-refsrc/lykoi/kernel/*。
 *
 * 模块地图：
 *  - dispatch.ts     认知到资源的唯一通路（SK-01..12；审计门 fail closed）
 *  - approval.ts     三层门 check 10 步 + scoped grants + pending（SK-15..29）
 *  - policy-core.ts  不可变治理核 TS 对应物（guardian 逐字；GK-12）
 *  - scope.ts        授权范围键全表（SK-69）
 *  - exemption.ts    E1/E2/E3 豁免（SK-47/48；消费位 = check 第⑨步）
 *  - delegation.ts   委托台账七态 + 审计先行（SK-61..66）
 *  - delegation-resource.ts 资源薄壳（SK-67；传输面 M5）
 *  - notifications.ts 通知文件原语 + GK-1 持久 next_id（队列语义 W3）
 *  - redaction.ts    密文遮蔽（SK-05）
 */
export * from './approval.ts'
export * from './delegation.ts'
export * from './delegation-resource.ts'
export * from './dispatch.ts'
export * from './exemption.ts'
export * from './jsonio.ts'
export * from './notifications.ts'
export * from './policy-core.ts'
export * from './redaction.ts'
export * from './scope.ts'
export * from './telemetry.ts'
