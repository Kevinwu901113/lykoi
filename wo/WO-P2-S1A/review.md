# WO-P2-S1A 复核报告（主治理 Agent）· 2026-08-10

**结论：代码通过，建议合并；但发现一个会让整个设计跑不起来的治理缺口，必须在部署前补上
（补丁需 root，见 §3）。**

- 分支 `wo/p2-s1a`，提交 `95a71ac2`（6 文件 +506 行）

## 一、独立验证

| 检查 | 结果 |
|---|---|
| messenger 专项测试（我自跑） | **15 passed** |
| **治理不变量测试的改动是否削弱防线** | **否**。它按 WO-NIGHT-01/B3 的既有先例扩面（12→13 那次），把两个新动作加进 `KNOWN_ACTIONS` 断言集，**仍然是精确闭集断言**，注释写明扩面理由。这是正确做法 ✓ |
| **dispatch 注册是否留旁路** | **否**。messenger 进的是与 browser/terminal 等同一张 `_RESOURCES` 表，审批门/immutable audit/shadow/预算全部自动继承 ✓ |
| manifest 重签范围 | 11 行改动中，4 条 memory/* 条目只是**位置重排**（哈希未变），真正改动 = dispatch.py 重签 + messenger.py 新增。**未越界** ✓ |
| NullTransport 零网络 | 测试断言覆盖 ✓ |
| 打扰纪律 | 日上限 1 / 冷却 6h，**回复类豁免**，持久化沿用 `shared.proactive_chat` 的既有 ledger 形状 ✓ |

## 二、流程问题（教训 23 再犯）

工单里已明写"跑全量前必须先 commit、不要挂起等待"，它**先提交了**（`95a71ac2`，纪律一半生效），
但报告仍然只有一句"我在等后台测试"。全量结果因此缺失。
**结论：这个失败模式对 sonnet 是顽固的**，后续工单应直接删掉"跑全量 pytest"这一步，
改由复核方（我）在验收时统一跑。已记入 HANDOFF。

## 三、⚠️ 治理缺口（本单未错，但设计因此跑不起来）

`guardian/policy_core.py` 的 `AUTONOMOUS_ALLOWED` 是**自主循环的动作白名单**——
名单外一律 deny。当前名单里**没有 `messenger.*`**，因此：

> **她的自主循环无法主动在 Telegram 上开口。** 而"她主动来找你"正是整个重设计的核心。

这不是 S1A 的失误：`policy_core.py` 是 root 属主、运行时只读、进 manifest 的
（设计使然——她不能自己扩自己的权限），执行 Agent 物理上碰不到。

**先例很清楚**：`autonomy.initiate_chat` 就在名单里，注释写着
"主动开口(对话消息; 日1条/冷却6h 在资源层强制)"——与 messenger.send 的情形完全平行，
且 S1A 已经在资源层实现了同样的速率限制。

**补法**（需 Kevin 以 root 执行，见 `wo/WO-P2-DEPLOY/sequence.md` 第 3 步）：
把 `messenger.send` 与 `messenger.read` 加入 `AUTONOMOUS_ALLOWED`，然后重签 manifest。

## 四、其它待办

- 全量 pytest 由我在 S1B 验收时统一跑（本单未跑完）。
- `ingest_inbound()` 目前只做规范化与落地，**未接注意力管线**——按工单要求，属 S1B/S2。
