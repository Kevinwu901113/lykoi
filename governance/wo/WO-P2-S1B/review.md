# WO-P2-S1B 复核报告（主治理 Agent）· 2026-08-10

**结论：通过，质量明显高于 sonnet 那几单（Kevin 换 opus 的判断是对的）。**
且它**自己发现并如实标记了一个会卡死通道的问题**，没有 hack 绕过——见 §3。

- 分支 `wo/p2-s1b`，提交 `6807e9a2`（7 文件 +1098 行）

## 一、独立验证

| 检查 | 结果 |
|---|---|
| 专项测试（我自跑 telegram_device + telegram_transport + messenger） | **25 passed** |
| **token 泄漏**（本单最严重失败模式） | 代码显式处理了"httpx 异常把含 token 的完整 URL 带出来"这个坑（模块 docstring 第 13 行写明），`-k 'token or leak or redact'` 专项断言通过 ✓ |
| **发送者绑定门** | `identity_binding_user_id(CHANNEL, sender_id)` 校验；未绑定者丢弃 + 计数 + 日志（`telegram_inbound_dropped_unbound`）✓ |
| **回复经 dispatch 发出**（哲学硬要求） | `dispatch.DispatchContext(origin="interactive")` + `dispatch.Action(...)` ✓ —— 发消息是她的行动，不是守护进程的投递 |
| `/chat` 未被修改 | ✓ 守护进程只是它的又一个 loopback 客户端，Mac app 照常可用 |
| manifest | 4 行改动（`mind/store.py` 重签 + 两个新 resources 条目）✓ |

## 二、架构判断（我认可它的两个选择）

1. **守护进程只当"耳朵"**（长轮询 + 游标 + 去重），出站直接经 dispatch 同步发送——
   与我在工单里的设计一致，理由见工单：Telegram Bot API 无状态，没有长连接可占，
   把出站也塞进守护进程只增加 IPC 复杂度而无收益。
2. **复用 `/chat` 生成回复**：守护进程经 loopback 调 `/chat`（与 Mac app 完全同路径），
   拿到回复后**经 messenger.send 发出**。既没重造对话机器，又保住了"发送是她的行动"。

## 三、⚠️ 它标记的死锁（本单未错，是设计缺环）

`messenger.send` 的默认审批策略是 **"ask"**。于是：

> **她要回复你，得先请求审批；而请求审批要通过发消息。鸡生蛋。**

它把这条标注为"S2（审批解释器）的问题，不是本单该解决的"并停手——**处理正确**。

**解法直接落在 `approval_model_v1` 的 ask-once 模型上，范围键 = 收件人：**

| 情形 | 层级 |
|---|---|
| 回复**已绑定的所有者** | **免询**（初始预授权）——回复不是对世界的动作，是对话 |
| **主动**开口找所有者 | 免询，但受资源层打扰纪律（日 1 条 / 冷却 6h） |
| 发给**新的收件人** | **问一次** → 批准后对该收件人免询（Kevin 原话的场景） |

**因此 `approval_model_v1` 需补一条"初始预授权"**（已补，见该文档 §2b）。
这也说明 Kevin 那条补充不只是省事，**是让通道能工作的必要条件**。

## 四、部署前仍需

- 合并 `wo/p2-s1a` + `wo/p2-s1b`（触及 `resources/`+`mind/`+manifest → 需 root）
- `policy_core` 加 `messenger.*` 到 `AUTONOMOUS_ALLOWED`（root，见 deploy sequence 第 3 步）
- **所有者预授权规则**写入 `approval_rules.json`（否则她连回复都发不出去）
- 活体迁移 + 身份绑定（deploy sequence 第 1/2 步）
- 全量 pytest 由我在部署前统一跑（本单同样没跑完——"等测试"失败模式在 opus 上也复现，
  但它先提交了，损失可控）
