# WO-S3 续跑单 2（收尾）· 实现/测试/manifest 全部已提交——只跑测试、出报告

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（分支 `wo/s3`）继续 WO-S3。
上一段因额度撞限中断（已重置）。**已完成的一行都不要重构：**

- `de7982dd`：接线实现全量（`kernel/approval_conversation.py` 问答两腿 + approval
  扩展 + 解释器 prompt 拆分加固 + telegram_device 路由 + transport reply_to 归一）
- `bb5620f4` + `61a5ec3f`：`tests/test_p2_s3_approval_wiring.py`，9 条 success_criteria
- `a91ab0a4`（WIP）：`guardian/manifest.sha256` 重签已做（+9/−3）

## 你要做的

1. 读一遍上述提交确认落盘完整；核一遍 WIP 里的 manifest 重签（自算校验：新增
   `approval_conversation.py` 条目 + 被改文件的哈希，条目数应为 104），没问题就把
   WIP 换成正式提交 `[WO-S3] manifest re-sign (103 -> 104)`；有问题先修再签。
2. 跑测试（`timeout 300 .venv/bin/pytest ...`，被拒就去掉 timeout 前缀）：
   `tests/test_p2_s3_approval_wiring.py` + `tests/test_messenger.py` +
   `tests/test_telegram_device.py` + `tests/test_telegram_transport.py` +
   `tests/test_p2_s2_approval_interpreter.py` + `tests/test_p0_integrity.py`。
   失败就修（只许修 bug 与测试；不许推翻 send→enqueue 原子性等已定设计），修完 commit。
3. **报告（stdout 即本体，宁长勿略）**必含：原单 9 条 success_criteria 逐条的用例名+
   结果；审计事件清单（事件名+字段）；原子性方案落地位置（文件:行）；manifest diff 与
   条目数；硬数字（文件数/行数/各套件通过数/p0 通过数，claude 身份 1 个既有假失败
   如实报）。

## 纪律（不变）

不 push；不跑全量 pytest（复核方统一跑）；不改 `/chat` 行为；不动 policy_core；
不放宽审批语义；每个里程碑立刻 commit。
