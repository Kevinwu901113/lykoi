Baseline suite is still running (chunk 3 of 6 — the `core_v1_*` block is the slow one under CPU contention with the neighbouring executor). I'll pick up as soon as it lands.

Status so far:

- **侦查完成**,基线证据已就位:manifest 从校验器逻辑独立重算 = **112 条,0 差异**;步 0 等价性的"改动前"终态哈希已落 `eq_before.json`;日志速率实测 ~7.3 条/拍(+1 条 llm_call)。
- **待落盘的实现**已写好并通过语法检查(暂存在工单目录,避免污染基线跑):`cognition/heartbeat.py`(影子件,双序列 baseline_only / baseline_plus_salience)+ 5 个新测试文件(判据②③④⑤⑥⑦⑧)。
- 基线分块跑至今:chunk1 `354 passed, 1 skipped`,chunk2 `282 passed`,chunk3 进行中(已见 11 个 F,聚在 `test_core_v1_*` 段——按教训 38 将在全量结束后对该文件单独串行复跑定性)。
