# WO-P2-S1B · Telegram 设备（她的耳朵与嘴）

你是 Lykoi 项目的执行 Agent，在 `~/lykoi-work`（分支 `wo/p2-s1b`，基于 `wo/p2-s1a`）实现。
设计基准：`~/lykoi_embodiment_redesign_v1_2026-08-09.md` §1.1（必读）+ 上一单 S1A 建的
`src/lykoi/resources/messenger.py`（先完整读一遍，本单是给它接上真实躯体）。

## 哲学定调（这决定了实现形态，不是修辞）

Lykoi **使用**社交软件，就像她使用自己的浏览器。因此：

- **发消息 = 她的一次行动**：经 dispatch 的 `messenger.send`，同步执行、同步拿到结果，
  自动继承审批门 / immutable audit / shadow / 预算。**不是**"平台替她投递"。
- **收消息 = 她的感知**：入站消息是一个**事件**进她的处理路径，**她决定**读与回——
  而不是一个 HTTP 请求逼她当场作答。这是与既有 `/chat` RPC 形态的关键区别。
- 守护进程只是她的**耳朵**（常驻长轮询），本身不做任何判断；判断全在 core。

## goal

### 1. `TelegramTransport`（实现 S1A 定义的 Transport 协议）

- 位置：`src/lykoi/resources/`（六目录，注意 manifest 纪律）。
- 出站 `send_message`：`POST https://api.telegram.org/bot<token>/sendMessage`。
- **必须走代理**：`http://192.168.0.202:7890`（服务器直连 Telegram 不通）。代理地址从
  环境变量读，默认值取现有代码里既有的代理常量写法（先 grep 现有实现，跟随之）。
- 凭证：从 `EnvironmentFile` 注入的 `LYKOI_TELEGRAM_BOT_TOKEN` 读，**绝不硬编码、
  绝不写进日志或异常信息**（token 泄漏到日志是本单最严重的失败）。
- 依赖：只用仓库已有依赖（httpx 已在 requirements）。不新增依赖。
- 错误处理：网络失败/API 错误返回结构化失败结果，不抛裸异常；
  **对 429（限流）遵守 `retry_after`**。

### 2. `lykoi-telegram` 守护进程（她的耳朵）

- 位置：`src/lykoi/resources/telegram_device.py` 或独立模块（选一个与现有服务模块风格
  一致的位置并说明）；入口 `python -m lykoi.<你选的路径>`。
- 长轮询 `getUpdates`（`timeout=25` 长轮询，走同一代理），**持久化 `update_id` 游标**
  （断线重启不丢不重；游标存放位置选一个与现有 state 文件风格一致的路径并说明）。
- 每条入站消息 → 调 S1A 的 `messenger.ingest_inbound()` 落地。
- **去重**：同一 `update_id` 只处理一次（幂等，参考 `/ingest/environment` 的 dedup 写法）。
- **发送者校验**：只接受**已绑定用户**的消息。绑定关系查 `identity_bindings` 表
  （P2-01 刚建：`channel='telegram'`, `channel_key=<telegram user id>`）。
  未绑定发送者的消息**丢弃并计数**，不进她的处理路径（防陌生人直接对她说话）。
  **首次绑定不由本单自动完成**——若表中无任何 telegram 绑定，记一条明确日志说明
  需要人工绑定，不要自作主张写入绑定。
- 崩溃/网络中断：指数退避重连（上限 60s），不刷屏日志。

### 3. 对话接线（让它端到端活起来）

入站消息落地后，触发她的回应路径：**复用现有 `/chat` 背后的对话生成机制**
（先读 `src/lykoi/surface/app.py` 的 `/chat` 处理与其调用链，弄清她如何生成回复），
但**回复必须经 `messenger.send` 走 dispatch 发出**，而不是作为 HTTP 响应返回。

关键点：**她可以选择不回**——接线要留出这个可能（例如生成为空/被策略拒绝时静默），
不要写成"必须产出一条回复"的强制路径。

### 4. systemd 单元草稿

`lykoi-telegram.service` 放仓库根（对照现有 `lykoi-server.service` 的写法）：
`User=lykoi`、`EnvironmentFile=/home/lykoi/secrets/im.env`、代理环境变量、
`Restart=on-failure`、`After=network.target`。**不安装、不启用**（部署是后续动作）。

## forbidden

- 不改既有 `/chat` 端点的行为（它仍要能用——Kevin 目前还靠 Mac app 与她对话）。
- 不动 broker、不动 core 的注意力管线内部实现。
- 不新增第三方依赖。
- 不实现群聊逻辑（只留字段位）。
- 不 push、不合并；提交留在 `wo/p2-s1b`。
- **不在任何测试/日志/报告中出现真实 token**（测试用假 token + 假 HTTP 服务器）。

## manifest 纪律

必然触及 `resources/`——用 `python3 guardian/startup_verify.py --write-manifest` 重签，
报告给出 manifest diff，并跑 `pytest tests/test_p0_integrity.py` 报数
（claude 身份下有 1 个既有假失败 `PermissionError: approval_rules.json`，如实报告即可）。

## 输出纪律

- **stdout 即报告本体**；禁止摘要代替明细。
- **跑全量 pytest 前必须先 `git commit`**；长测试用 `timeout 1800` 包住，超时如实报告
  "未跑完"，**不要挂起会话等待**。
- 必答硬数字：新增/修改文件数与行数、专项测试用例数与通过数、p0 通过数、manifest 条目数。

## success_criteria（全部用假 Telegram HTTP 服务器测，不碰真 API）

1. 出站：`messenger.send` 经 dispatch → TelegramTransport → 假服务器收到正确的
   `chat_id`/`text`；token 出现在请求 URL 但**不出现在任何日志/异常/返回值**（用断言证明）。
2. 429 限流：遵守 `retry_after` 后重试成功。
3. 入站：假服务器给出两批 updates，游标推进正确、重复 `update_id` 不重复处理。
4. 发送者校验：未绑定 telegram id 的消息被丢弃并计数；已绑定的被正常处理。
5. 断线恢复：轮询中途连接失败 → 退避重连 → 游标不丢不重。
6. 对话接线：入站消息触发回复经 `messenger.send` 发出（可用 mock 的回复生成）；
   回复为空时静默不发。
7. 全量 pytest 无新增失败（既有失败：约 10 个 `_rollout`/`_activation` 权限位用例 +
   2 个 `test_core_v1_shadow.py` 超时——不是你引入的，别修）。

## required_evidence

git log/diff --stat、模块与入口路径、游标与绑定校验的实现位置、
每条 success_criteria 对应的测试用例名+结果、manifest diff、必答硬数字、
以及**"token 不泄漏"的具体断言方式**。
