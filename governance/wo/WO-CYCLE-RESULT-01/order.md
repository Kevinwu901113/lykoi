# WO-CYCLE-RESULT-01 · 锁内回合结果快照

整批 A1/B3/A4 复核的必要正确性修复。基线8f3ec5a，分支wo/cycle-result-01。

send在释放认知锁后等待governContext；下一轮可清空或覆盖lastCycleOutcome/followup/delegatedAsk。handleTurn及ContinuationRunner在await send后读取共享字段，会把另一轮结果用于当前终局/承诺。A4只冻结utterances不足以覆盖整份结果。

增加锁内onCycleResult快照（outcome/followup/delegatedAsk/utterances），两条生产调用路径只使用自身快照。保持send字符串返回与旧onUtterances/getter兼容；不增加运行时调度器、锁或副作用表，不修改prompt/schema。测试必须让前轮锁外等待期间后轮完成，验证前轮终局/承诺仍属前轮。全量与typecheck通过后交付；不合并/部署。
