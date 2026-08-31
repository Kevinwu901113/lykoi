# WO-FIX-APPROVAL-UX 复核 · 2026-08-12 · PASS(含 1 个复核者补充)

**有效提交:`wo/fix-approval-ux` @ `ed262b80`**(基 `wo/l5` @ 71a72720 = 活体 main 内容)。
执行 Agent 一轮过(28 分钟,opus),四判据 + manifest 一次交齐,报告质量高
(自证到测试行号;两条环境失败主动在干净 worktree 复现定性)。

## 代码审读(src 全量三文件)

- **① 执行结果主动回报**:`granted`/`execute_once` 执行后 `_report_execution`
  引用 Kevin 批准消息回结果(S1A 豁免);已知结果键优先、stderr 拼接、1500 字
  截断且注明;**送达失败只落 telemetry,绝不改写"已执行"的事实**;审计
  `replied` 变真值。✅
- **② 老横幅退役**:`_approval_prompt`(POST 端点横幅)整体删除;撞门改走
  S3 `request_approval`,`asked`/`already_pending` 一律沉默(问句即消息,
  4 连横幅病灶根除);问不出去回一句无端点的人话;没绑 owner = 拒绝而非
  fallback;surface POST 端点本身保留(owner console 兜底)。✅
- **③ 字面快通道**:恰「执行」/「不要」(容标点空白)+ **恰一条悬置**才生效;
  approve 合成 `this_only` → 经既有 gate 落 `execute_once`,标准动作也产不出
  常设授权;多条悬置照走 LLM 归属消歧。她承诺的应答词不再依赖 LLM 可用性。✅
- **④ 应答词表**:`OWNER_ANSWER_WORDS` 只决定**路由**(能否到达判读器),
  永不决定判决;引用落空但词面是应答 → 落到未引用信号(多条悬置=追问,
  过久=stale),保守方向未动。原 chitchat 用例改判是正确的——它原来编码的
  正是本次修的病灶行为。✅

## 测试与全量

- 本单新增 24 条测试全绿(含"发送失败不影响执行结果""同一 pending 不重复
  播报""LLM 抛异常时字面执行仍通过""进得去判读器不等于过得了"等关键钉子)。
- 全量串行 57 分钟:**14 failed / 1790 passed** = 已知基线分毫不差,零新增。
- manifest 独立重算:107/107,mismatch 0(三条源哈希已同步)。

## 复核者补充(ed262b80)

`lykoi-telegram.service` 仓库正本补 `EnvironmentFile=/home/lykoi/secrets/llm.env`
(附事故注释)——Kevin 的热修 drop-in 转正,防未来从仓库重部署单元时丢钥匙。

## 遗留(不阻塞)

- 工作克隆里 `scripts/patches/**/root_apply.sh` 磁盘权限 0775 vs git 100755
  (umask 漂移,claude 无权 chmod)——只影响工作克隆的 rollout 基线测试,
  活体不受影响;下次有权限侧顺手 `chmod 755` 即可。
- "批准/同意"等词表命中后仍需 LLM 判决(仅「执行」「不要」有确定性通道)——
  刻意保守;若 LLM 长期不稳可再议扩大字面集,但那是行为决策,须 Kevin 拍板。
