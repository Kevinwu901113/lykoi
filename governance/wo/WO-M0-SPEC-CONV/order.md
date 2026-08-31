# WO-M0-SPEC-CONV · 对话路径行为规格提取（只读审查单）

你是 Lykoi 治理平面的执行 Agent。本单是 Cordis 完全移植计划 M0 期的规格提取单：
Lykoi 将整体移植到 Cordis(TS/Node) 运行时，对话路径（入站→信封决策→执行→出站→审批对话）
将在新运行时重写。**你的报告就是新实现的行为规格与验收基准**，语义必须逐条、契约必须逐字。

## 基线与工作区

- 工作区 `~/lykoi-work-m0/` 是活体 HEAD `4463ae8`（tag cordis-night-20260822）的**文件树
  只读副本**（无 .git）。所有行号引用以此副本为准。
- 本单**零代码修改**。你只读代码、只写报告。

## goal

产出对话路径完整行为规格，覆盖八个部分（见 deliverables）。

## scope（审查对象）

- `src/lykoi/cognition/conversation.py`（约 1623 行）、`conversation_cycle.py`（约 614 行）
- `src/lykoi/resources/telegram_device.py`、`telegram_transport.py`、`messenger.py`
- `src/lykoi/kernel/approval_conversation.py`、`approval_interpreter.py`、`policy_exemption.py`（消费面）
- `src/lykoi/surface/app.py`（/chat 入口与 ContextBudgetError）
- `src/lykoi/cognition/prompts.py` 及对话路径引用的全部提示词装配代码
- 相关测试：`tests/test_chatloop*.py`、`test_conversation_inner.py`、`test_approval_delivery.py`、
  `test_chat_reply_to.py`、`test_approval_conversation*.py` 等（以 grep 实测为准，别凭记忆列）

## deliverables（报告八节，编号固定）

1. **入站全链路时序**：telegram getUpdates → inbound 存档 → /chat → conversation 周期，
   文字版时序，每步带 file:line 锚点；入站合并/去重/游标语义。
2. **信封契约逐字**：conversation_cycle 的信封字段全集、kinds、护栏（demote/fail-closed/
   grounded 引用闸）、解析失败的每条路径与终态；`LYKOI_U3_SWITCH_ENABLED` 读者的确切语义
   （开/关两态下每条消息各走什么）；`evaluate_message`/`apply_inner` 在对话侧的参数化差异
   （对照自主侧）。
3. **提示词与装配清单**：对话路径全部 system/模板的位置（file:line 范围）+ 每段 sha256
   （`python3 -c` 或 shasum 算，用于移植时逐字校验）；三段式装配顺序（稳定前缀/历史/易变尾部，
   CACHE-INVERT 结构）与每段的内容来源函数。
4. **审批对话消费面**：审批问句产生 → 设备层 request_approval（reply_to 语义）→ 归属判定
   （引用回复护栏）→ 批准/拒绝落地 → 执行回执回话；E1/E2 豁免的判定点与结构标记；
   HARD_ASK_TYPES 集合现值。
5. **每轮触碰的 state 全表**：写者×文件×触发条件（对照 C-A 前半 §3 的矩阵格式，补对话侧全列）。
6. **U3 两缺陷结构定位**（2026-08-24 首夜实弹实锤，本单最重要的两小节）：
   a. json 空回复：completion 有 tokens 但 content 空时，代码走哪些行、在哪一行决定降级沉默、
      为什么无重试；给出"有界重试一次+失败事件带原始响应元数据"在现结构里的插入点。
   b. tool_call 派发链：信封 kind=tool_call（或等价物）在对话周期里由谁消费、走不走
      kernel.dispatch、audit 为什么零痕迹；对照自主路径同信封的执行链，指出断点的确切位置。
7. **出站链路**：说话动作 → dispatch → messenger/设备出站 → 分段/回执/undelivered/重试；
   打扰预算与 reply_to 不计预算的判定；chat_outbox 与 telegram outbox 游标关系。
8. **行为规格总表**（最终交付物）：新实现必须保真的语义清单，逐条编号（S-01, S-02, …），
   每条=一句话语义 + 代码依据（file:line）+ 标注【必须逐字迁】/【语义等价即可】/【已知缺陷，
   新实现按修正版】三档。预计 40–80 条。缺陷修正版条目（6a/6b 等）单独标 D- 前缀。

## forbidden

- 零写入：不改工作区任何文件（报告走 stdout），不碰 `/home/lykoi/` 下任何东西，不跑任何
  git 写命令，不重启/不 systemctl，不读 secrets/state（`~lykoi/state` 与 `~lykoi/secrets`
  一律不碰——你的对象是代码不是数据）。
- 报告中不得出现任何 token/密钥内容。

## success_criteria

八节齐全；所有断言带 file:line；[事实]/[推断]/[建议] 三档标注贯穿；§8 规格表每条可独立验证。

## required_evidence

关键计数（行数/用例数/字段数/kinds 数）用 grep/wc 实测，不许凭印象写。

## 纪律（逐字遵守）

- **stdout 即报告本体**：你打印的最后内容就是 report.md，不要输出聊天式摘要或"报告已写好"。
- 全程前台串行，**禁止**把任何命令丢后台再声称完成；本单不跑 pytest、不跑任何测试。
- 完成的定义 = 八节报告全部打印完毕。不存在"进行中先交卷"。

## 副本已知缺口（如实告知）

工作副本比活体少 5 个 .py（治理账户 0600 不可读，属 R2c 影子产物）：
`src/lykoi/cognition/permission_evidence_shadow.py`、`tests/test_core_v1_m3_r2c_r1_permission_evidence.py`、
`tests/test_core_v1_m3_r2c_r2_permission_replay.py`、`tests/test_core_v1_m3_r2c_r3_projection_candidate.py`、
`tests/test_salience_shadow_release_audit.py`。活体 tests 共 154 个 .py，副本 150。
涉及这些文件的判断标注"文件不可读，按引用侧证据推断"。
