# WO-M0-STATE-CONTRACT · state/DB 契约文档（只读审查单）

你是 Lykoi 治理平面的执行 Agent。背景：Lykoi 整体移植到 Cordis(TS/Node) 运行时，
**state 不迁移**——新体（Node，better-sqlite3 候选）将原路径原 schema 接管
`/home/lykoi/state/` 的全部数据。本单产出**数据契约文档**：新体读写这些数据时
必须遵守的全部结构与不变量。这是 M1 期 `lykoi-memory` 插件的规格正本。

## 基线与工作区

- 工作区 `~/lykoi-work-m0/` = 活体 HEAD `4463ae8` 的文件树只读副本（无 .git）。
- **零写入、不碰 `/home/lykoi/`、不读 state/secrets、不跑 pytest**。只读代码、报告走 stdout。
- 已知副本缺 5 个 0600 不可读 .py（R2c 影子产物），涉及处标注"按引用侧证据推断"。

## goal

从 `mind/migrations.py`、`mind/store.py`、`memory/store.py` 及各 sidecar/JSON 模块
提取完整数据契约。

## deliverables（报告六节）

1. **memory.db 全表 schema**：当前 mind_schema 版本号；每张表的 CREATE 语句要点
   （列/类型/约束/默认值/索引/触发器——特别是 append-only 触发器逐字），逐表带
   file:line。表清单以 migrations.py 实测为准（不要凭记忆列）。
2. **逐表语义与写者**：每张表一段——它存什么、谁写（进程×函数入口）、谁读、
   单写者档位（严格单写者 / DB 层串行多写者）。可引用格式对照 C-A 前半 §3 矩阵，
   但内容必须本单自证（grep 实测）。
3. **sidecar 数据库**：salience_shadow.db（WAL）/ core_facts.db / percept_buffer.db
   / permission_evidence_shadow.db——schema、写者、以及**移植态判定**：随 core 退役
   冻结的标明冻结语义（参考：core_facts.db 唯一写者是 core/shadow.py，但
   self_state_sources 读侧活得更久）。
4. **JSON/JSONL state 文件全集**：每文件——路径常量与 env 覆盖、形状（键/类型）、
   写者、锁纪律（file_lock+write_json_atomic / 仅 atomic / 无锁）、环形上限、
   损坏时语义（当空/当 0/当首启）。逐文件带 file:line。别漏：approval_rules /
   standing_grants / pending_actions / notifications / chat_outbox / chat_undelivered /
   proactive_chat / messenger_inbound / messenger_outbound / telegram_cursor /
   telegram_outbox.cursor / interactive_activity / clock / continuations /
   events.jsonl / audit.jsonl（权限模型也写清）。
5. **不变量清单（新体必须保真）**：逐条编号 C-01…C-NN——事务纪律（BEGIN IMMEDIATE
   短事务/isolation_level/busy_timeout 值/foreign_keys）、append-only 面、
   单写者面、幂等面（如 upsert_insight 去重键）、时间戳格式（isoformat 细节、
   时区）、id 生成方式（uuid4().hex / 自增）、journal 模式现状（rollback，无 WAL）
   与切 WAL 的影响面评估（哪些读写模式受益/受影响）。
6. **接管风险表**：Node/better-sqlite3 接管时的已知差异点——同步 API vs Python
   异步、busy_timeout 语义、类型亲和（TEXT/INTEGER/NULL 映射）、并发进程混跑期
   （M4 切换窗内新旧体绝不同时写——写明这条为硬规则）。

## success_criteria

六节齐；表清单与 migrations 版本号实测；所有断言带 file:line；[事实]/[推断]/[建议] 标注。

## 纪律（逐字遵守）

- **stdout 即报告本体**，不要聊天式摘要。
- 全程前台串行，禁止后台；完成的定义 = 六节报告打印完毕。
