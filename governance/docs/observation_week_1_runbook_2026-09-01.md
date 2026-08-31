# 观察周 W1 · Runbook（2026-09-01 起，WAVE-OBS-PREP 收官后生效）

> 性质：**只观察，不动手**。观察周内不签新器官/新能力单；治理侧只做读数与
> 记录。例外：她起不来/预算失控/审计断流三类事故，走正常事故流程。
> 背景：wake 是全新能力，醒拍频率/预算消耗/审计形态均无历史基线——本周
> 就是采基线。

## 每日读数（root，一分钟；建议固定时段，如晚间）

```bash
# ① 醒拍计数（较昨日增量 = 当日醒拍数）
grep -c autonomy_wake /var/log/lykoi-audit/audit.jsonl
# ② 预算账本（花费与硬顶的距离）
cat /home/lykoi/state/budget.json
# ③ 服务健康（重启次数看 NRestarts）
systemctl show lykoi-cordis -p ActiveState,NRestarts
# ④ 当日日志里的异常面
journalctl -u lykoi-cordis --since today --no-pager | grep -iE 'error|fail|refus' | tail -5
```

治理侧（lykoi-gov 可自查，无需 root）：journalctl 读数、服务状态、
governance-ops 流水。audit 正本治理账号不可读（620 root:lykoi）。

## 观察什么（基线四问）

1. **醒拍节律**：日醒拍数是否稳定？与心跳基线（5s 检查间隔 × 心跳门控）
   的换算是否符合设计预期？
2. **预算形态**：wake 醒拍的 LLM 消耗日均多少？budget 硬顶（E3 现状）
   余量如何？**连续两日消耗翻倍 = 升级信号**。
3. **审计形态**：audit.jsonl 日增行数量级；`autonomy_wake` 之外她的
   自主动作种类分布（整合/专注周期是否随醒拍发生，SA-171 实证面）。
4. **社交活性**：Telegram 出入站是否正常（她主动说话的频率、回复延迟）；
   canonical chat_outbox / notifications 回连后（WO-STATE-CANON 落地）
   有无异常堆积。

## 升级线（触发即中断观察、走事故流程）

- 服务崩环（NRestarts 单日 >3）或 assembly 起立失败。
- 预算单日消耗 > 硬顶 30%，或连续两日翻倍增长。
- 审计断流（watchdog 探针会自动 restart；若 restart 后仍断 = 升级）。
- 她的外发行为异常（对 Kevin 之外发消息、高频重复消息）。

## 记录

每日读数追加到服务器 `~lykoi-gov/reports/obs-week-1.md`（治理侧代记亦可，
Kevin 口述读数即可）。周末出基线小结：日均醒拍数 / 日均预算 / 审计日增量
三个数，作为后续器官单（M5 browser、认知深水线）的预算与节律参考输入。

## 本周之后

基线小结呈 Kevin → 解除观察态 → 认知主线第一单签发
（候选：U2 器官自感知起步，OrganInventoryCache 已有脚手架）。
