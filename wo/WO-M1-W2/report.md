# WO-M1-W2 · M1 波次 2 构建 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent（2026-08-24 凌晨）；产物 commit：lykoi-cordis `7926f17`（基 4ae553a）
- 复核：治理侧独立复跑 47/47 绿 + tsc 净 + CF-B6 剥头核验（vendor 内 4 处字样命中全为
  删除标记注释，无活代码；lockfile 零 dsh-anonymous-user-id）——**PASS**
- **M1 验收线达成（管线层）**：能感知（memory 只读 API 对 devstate 实测）、能对话
  （fake 入站→盖章→LLM→带 reply_to 回站全链）、账本有数（budget 记账+拒调红测）。

## 交付四件（全部 done）

1. **lykoi-llm-deepseek（CF-B6 剥头版）**：选 vendor 路线（lib 为可读 esbuild 产物
   1817 行，6 个干净改动点全部 `[lykoi CF-B6 edit n/6]` 行内标记+文件头记基版本
   0.1.1-rc.2/原文件 sha256/MIT）。剥 `x-deepseek-harness-user-id` 与 `-session-id`
   两头，**dsh-anonymous-user-id 依赖整体出树**；UA 归因头保留；`x-deepseek-harness-compact`
   判为用途标记非身份头予以保留（治理侧复核采纳）。测试：mock SSE server 断言出站
   harness 头计数=0、缺 key 零字节出站。上游 SSE/[DONE]/重试分类/idle watchdog/
   last-good 降级语义逐字保住。
2. **lykoi-memory（只读 state）**：node:sqlite（DatabaseSync）零原生依赖；只读三重=
   readOnly 连接+`PRAGMA query_only=ON`+服务面零写方法（R-01 绊线测试：方法名不得
   匹配写形状正则）；开库断言 mind_schema==15；busy_timeout=10000（C-01）；C-22 双
   时间戳 parse；API：regulation_field/active concerns/open thoughts/近 N 条 history 与
   experiences/identity_bindings 查询/autonomy_state。对 devstate 副本实测（16 测试，
   env 缺席 skip 不 fail），隐私纪律=行内容零输出。
3. **lykoi-adapter-telegram**：S-01..S-07/S-09/S-11 语义+出站 reply_to 必带+生产骨架
   无 token 拒起；传输接口化（production.ts 骨架不接真网 / testing.ts 内存 fake）；
   D-06 修正版=edited_message 忽略+审计（非新回合）；入站存档环形 200（dev JSON）。
4. **lykoi-converse-min + profile**：全链集成测试事件序列（owner 回合恰 5 audit 行
   `telegram/inbound→converse/received→budget/charge→converse/reply→telegram/sent`，
   runId 贯穿；非 owner 仅 `inbound_dropped_unbound` 1 行零预算；deepseek 路由同构 5 行
   且 usage 真实记账；失败方向=硬顶 0 时 `budget/refusal→converse/turn_failed` 空回合
   游标照推不出站）。memory/telegram/transport 三 entry 入 profile `disabled:true`
   （启用归治理侧）；lykoi-llm-deepseek 未挂 profile（无 key，测试全覆盖）。

## TODO 台账（6 条）

1. production transport 真网接线（重试序列 2/5/15/30、429 retry_after）→ 治理复核后波次
2. 出站未送达账本（两结局语义）→ M3
3. unbound senderId 入 audit 是否收敛为哈希 → M3 治理定敏感度
4. S-08 前两级路由+请示半边 → M3 审批波
5. converse-min 占位提示词 → M2 lykoi-decide
6. usage 缺席保守估算 → M2

## 纪律核验

未 commit/push（治理侧提交）；devstate mtime 未变、无 -wal/-shm；行内容零输出；
零凭据；蓝图明文项零偏离，裁量四处全部留痕并经治理复核采纳。
