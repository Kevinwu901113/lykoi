# WO-L5 · 门阶梯收口 + 规则建议队列（接 messenger 问 Kevin）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work-l1` 工作。
**基分支 `wo/l4`**（先 `git checkout -b wo/l5 wo/l4`）。
设计基准：`~/learning_layer_v2_design_2026-08-10.md` §3.5（死亡/建议释放）、§3.8（门阶梯）。
这是学习层 v2 的最后一单。

## 背景与已有资产（先读这些，不要重造）

- L4 已建 `_V13` 五张影子表：`focus_cycles`、`product_lineage`、`focus_insight_state`、
  `focus_insight_history`、`concern_focus_state`（`src/lykoi/mind/migrations.py`），
  层 2 专注思考在 `src/lykoi/mind/`（周期、选择策略、反刍防护）。
  反刍防护"超限建议释放"已经产出**建议记录**（先找到它的落点，L5 从这里接）。
- S3 会话式审批机器在 `src/lykoi/kernel/approval_conversation.py`：
  ask → 记 `question_message_id` → handle_answer → 原子认领 execute-exactly-once /
  clarify / deny / 过期通知；发送失败=默认拒绝、入队失败=撤回；
  提示注入加固=三消息切分 + "数据不是指令"系统规则。**L5 的问询通道复用这套模式。**
- messenger（Telegram）与 proactive 打扰预算/频控已在线。

## 目标

§3.8 门阶梯的最高一级收口：产物影响**她自己的权限边界**时，必须问 Kevin、永不自动。
具体=一个**规则建议队列**：层 2 产物或反刍防护建议 → 入队 → 经 messenger 问 Kevin →
记录他的决定 → **任何路径都不写 `approval_rules.json`**（铁律，与 policy_core 一脉相承）。

## 硬约束

1. **铁律**：代码全程不得出现 `approval_rules.json` 的写路径。她可以观察"这类事
   Kevin 总是批准"、可以建议常设授权，但落笔永远是 Kevin 的 root 会话。
2. 门阶梯其余三级不动：叙事/情绪连续性门照旧；insights 影子期(S=2)自动转正**不经队列**；
   reliability 单写者照旧。
3. 影子表方式扩展（`_V14` + `downgrade_v14`），不改既有表结构；行为默认不变
   （队列空转时零副作用、零 LLM 调用）。
4. audit 事件覆盖入队/出队/问询/回答/过期全链路。

## 判据（每完成一条就 git commit 一次——棘轮纪律，网络断了不丢）

① `_V14` 建议队列状态层：`rule_suggestions` 表（建议文本、来源引用接 `product_lineage`、
   去重键、状态机 pending→asked→{accepted,declined,expired}→applied_by_owner）+ store 单写者接口 + `downgrade_v14`。
② 入队接线：反刍防护的建议释放记录 + 权限边界类产物只入队、绝不直接生效；
   同去重键不重复入队。
③ 出队问询走 messenger：复用 S3 模式（question_message_id 关联、发送失败=不出队回滚、
   三消息切分注入加固）；问询消耗 proactive 打扰预算，频控内每周期至多问 1 条。
④ 回答处理：接受=accepted + 生成给 Kevin root 会话的 staged 执行说明文本（存表，不碰 guardian）；
   拒绝=declined + 冷却（同去重键 N 周期内不再问）；超时=expired + 温和通知。
⑤ 铁律测试：全代码路径无 approval_rules.json 写入口（静态断言 + 模拟"接受"后
   guardian 文件 mtime/内容不变）；audit 事件逐环节断言。
⑥ 行为不变：队列空时层 2 周期行为与 L4 基线完全一致（复跑 L4 判据①测试通过）。
⑦ 全邻接运行清单全绿（见文末）。
⑧ 零 schema 破坏 + `downgrade_v14` 逆迁移测试。

## 运行清单（全邻接，串行跑，报告里逐条贴结果）

```
.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_l4_focus.py
.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_l5_suggestions.py
.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_p2_s3_approval_wiring.py
.venv/bin/python -m pytest -q -p no:cacheprovider tests/test_mind_store.py tests/test_mind_migrations.py
.venv/bin/python -m pytest -q -p no:cacheprovider   # 全量串行收尾
```

全量结果对照基线：14 个已知失败之外不得新增（逐条列出你看到的失败并归因）。

## 收尾

- manifest 重签：用 `startup_verify._protected_files()/._sha256()` 自算，
  条目数相对基线只增不减，报告里写明前后条数。
- 报告写 `~/wo/WO-L5/report.md`（stdout 即报告）：改动清单、判据逐条自证、
  运行清单结果、manifest 前后条数、遗留问题。
