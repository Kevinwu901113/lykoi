# M4 蓝图 · 停机切换（2026-08-31 开工）

Kevin 2026-08-31 指令「开 M4 推。这三个按照现有建议默认值」。本蓝图承接
`docs/m4_handoff.md`（11 硬前置 / 3 决断项 / 验收与回滚），把 M4 切成三波。
基线 = `d3e0edb`（M3-W4 收口，754 测试）。

## 决断项定案（Kevin 2026-08-31 批，治理仓另有 [决策] 存档）

- **GK-8 通知并投递线：维持默认关**。通知保持 pull，不推送。旋钮原位不动。
- **E3 二次计税：维持现状（候选③，收紧）**。W3 落法不动；出现「该说的话被
  自家账本挡住」的真实实例再议。
- **D-01 三个秒数**：profile 位原「只留位不填数」，无先存建议值——以下为
  治理侧建议值，经 Kevin「按现有建议默认值」授权采用（否决窗口：切换窗前）：
  - `interpretTimeoutS: 30` —— 判读是 T=0/400 tokens 小调用（经代理），30s 有界；
    语义=「一次审批问句判读 30s 问不到就算问不到」，配重试最坏 60s。
  - `interpretRetries: 1` —— 与 G-10 信封 not_json 有界重试一次同形，不多不少。
  - `cycleTimeoutS: 180` —— 对话周期含信封调用+工具派发；活体实证存在 89s 的
    合法长答（8-12 查证再回话那次），180s = 两倍余量。D1 的中位 <15s 仍是
    健康指标，不是杀线。

同批定案（切换窗不开新回路，与前置 #3 self-state 同理）：

- **vision 路由位：显式 disabled**。deepseek-chat 无视觉面，M4 不接真模型；
  `visionRoute: disabled` 填显式值而非留空——「忘了填」和「决定不开」必须可区分。
- **前置 #7 生产根路径：确认维持 `/home/lykoi/projects/lykoi-cordis`**。

## W1 · 构建波（本仓，派发执行 Agent）

1. **D-01 接线+填值**：三旋钮从 profile 读入并强制——判读调用超时（AbortSignal
   形态）+ 有界重试 + 周期超时；超时事件入 audit（带 elapsed 元数据，与 G-10
   失败事件同风格）；`cordis.prod.yml` 位填上述值；超时红测（假 LLM 挂起→
   按时切断→事件形状断言）。缺省值（profile 不给时）= 同三值，源码单一出处。
2. **前置 #8 BotApiTransport 真 HTTP**：真 `fetch` 接线、超时、`trust_env=false`
   等价（构造 URL 不读任何代理 env；`LYKOI_TELEGRAM_PROXY` unset 检查已在 GK-6
   门，transport 自身零 env 读取）。纪律不变：重试仅 sendMessage、429 单路
   honour retry_after、token 零外泄（错误对象/日志红测）、未送达经验回灌。
   测试用注入 fetch 双测（真 fetch 仅生产装配面选择）。
3. **GK-9 生产调用点**：`bootstrapOwnerPreauthorization`（kernel approval.ts）
   已在——补生产入口（gate CLI 子命令或独立脚本，root/部署期跑一次）+ 幂等
   （已含授权行时 already 路径不重写）+ 验收断言（跑完后 `messenger.send`
   授权在册，S1B 死锁不可能）。同时验证「确认」路径：活体 `approval_rules.json`
   与新体读者格式兼容性判定（兼容→原样搬为首选；不兼容→重放为唯一路径，
   判定结果写进 W1 报告）。
4. **vision 位落显式 disabled**（见定案）。

纪律：754 基线零回归 + tsc 净；凡涉超时/TTL 断言，播种与读取同钟或全程显式
now（时钟炸弹教训，见 W4 报告）；GK-14 基线冻结不追活体；kernel 触碰仅限
GK-9 入口所需且逐处说明；commit 前缀 `[M4-W1]`；报告一次性输出。

## W2 · 部署材料波（治理侧主笔）

1. **root 供给脚本**固化（前置 #9 全量：audit sink chattr +a / root 属主域 /
   persona TOML root:root 444（内容 sha 必须 = df3bc2f2c15869…dd56，见
   m4_handoff 前置 #5 取证）/ 首次 manifest 签名）。
2. **systemd 单元**：主单元（前置 #11：ExecStartPre 挂门、`Environment=` 仅
   BOT_TOKEN 一条、Restart=always）+ **watchdog root 单元**（前置 #10）。
   新体无 /health 端点——watchdog 探针形态在本波定案（候选：进程存活 +
   audit 心跳行新鲜度；不为切换窗新造 HTTP 面）。
3. **安装 runbook**：git clone 新树到生产根路径、Node ≥24 供给、
   `npm ci --ignore-scripts`、依赖钉版（dist-tag 陷阱，M0-DSH-STUDY）。
4. **R-01 序列脚本**：备份 state → 停旧（确认进程真的没了）→ 起新；回滚反向。
   备份=切换窗第一动作（同时是回滚前提）。
5. **切换窗 root 粘贴稿**（paste-cordis-night.sh 先例）：前验 / 备份 / 停旧 /
   root 供给 / 起新 / 八条验收（m4_handoff §D 逐条）/ 回滚段。测试清单
   ls 对树核实不许凭记忆写（教训 42）；diff 终点钉分支尖不写 HEAD。
6. **追认 7 条呈批稿**（m4_handoff §C）随粘贴稿一并呈 Kevin。

## W3 · 切换窗（Kevin root 执行，治理护航）

八条验收按序，任一不过即回滚（停新起旧，R-01 严格串行）。含 E 步实弹：
普通消息信封回复 + `terminal.exec` 硬门问句引用回复批准全链。
**观察期 48h**：期间旧体保持完整可启动（不动 core）。观察期过后另开
**CORE-RETIRE 收尾窗**：core 退役与旧体 `startup_verify` 解耦同窗做完
（前置 #2 的「同窗」指此窗）——在那之前旧体始终是一条活的回滚路径。

## 定界（不入 M4）

图式注册表生产接线（器官 18→5）、browser/terminal 器官真身
（WO-M5-ORGAN-BROWSER 已立项）、delegation 传输面、`messenger.read` 后端、
建议问答周期驱动——全部 M5（m4_handoff §E）。
