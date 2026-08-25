# WO-M3-W2 · 审批器官 · 执行报告（治理侧存档）

- 执行：Mac 本地 Agent（首派撞 Fable 5 额度死于阅读阶段、工作树零遗产；原单显式 opus
  重派单次过）；产物 commit：lykoi-cordis `563696c`（基 03ac37e）
- 复核：独立复跑 **564/564 全绿 + tsc 净**（逐包与自报逐位一致：kernel 115=+43、
  converse 67=+13）；golden devstate mtime 全等 1787510320；抽查——sha 21 条为
  `createHash` 实算钉（非硬写字面量）；硬门永不常设授权红测（may_grant=false 三格+
  算不出 key 亦 false）；先发后排四态（deny_by_default 不排队 / retracted 无队列条目）；
  **GK-14 正反双断言**（正=claimed 与 recorded deepEqual 且带空转防护；反=demote 路
  action_dispatch/action_result/approval_question 各 0 行）；折文本 wire 形态删净
  （`conversation.ts:742` 残留经核为 `#summarize` 软窗渲染 S-31 给摘要 LLM 的散文，
  非 wire 帧，**不算出入**）——**PASS**

## 交付

1. **审批对话机**（kernel/approval-conversation.ts，SK-30..35）：四道闸+先发后排，
   四个非 asked 态各有"动作不跑"红测，此路无执行出口；`_send` 漏斗=E1 盖章唯一嘴、
   拒绝永不递归成新问句；`_executeOnce` 原子点在 consumePending、原 origin 重派、
   correlation 全链同一条；回执四分支+取值序+1500 截断显式告知+`_replyRef` 免预算+
   投递失败吞（做完的事不因没说出口回滚）；dead question 最前拦（GK-5 单一文案照抄）；
   审计四事件+六元组恰六字段。
2. **答复解释器**（kernel/approval-interpreter.ts，SK-36..46）：五失败路全 unclear
   永不 approve；三消息防注入逐字；归属信号序七路全支红测；gate 真值表 13 格逐格+
   跑完断言 standingGrants()===[]（gate 纯函数零写）；快通道多条悬置时不启用；
   授权回滚；risk_level 唯一源=isHardGated；execute_once 显式不 grant。
3. **converse 接真**：`cycle_approval_gate_unwired` 退役（反向红测钉不再出现）→
   `_delegated_ask` 四项载荷（DELEGATED_ASK_FIELDS 钉死 message_id/reply_to/context_id
   **不在其中**=E2 分层）、取走即清、一轮一清场；ASK_FALLBACK 迁入并接到"真正问不
   出去"那一支（无 action_id=无把手，**且不编 id**）。
4. **wire 收口**：tool_calls 原生 ToolCallBlock 映射（折文本两形态删净，捕获型 adapter
   反向断言）；审批判读**不新增 route 桶**、改 run 维度 `approval-interpret-<type>`
   （账上可见而路由维度不膨胀）；六元组与三事件落同一 immutable sink（第二个调用方
   非第二个 sink）。
5. **终端硬门实弹**（converse/test/approval-e2e.test.ts）：全链 15 行事件实录；
   问句 reply_to=当轮入站 id、pending_id===action_id、correlation 全链一致、命令
   只跑一次、第二次「执行」→expired 仍一次；反向「不要」→零执行。被打穿的一段
   （kernel dispatch/三层门/对话机/解释器/immutable audit）**零替身**。

## 治理发现（复核增补，重要）

**S-52 json 模式在新体当前不达 wire，且修法在我们自己手里。** 执行方如实上报
dsh-llm `0.1.1-rc.2` 的 `GenerateOptions` 无 response_format 字段（复核实证：恰 12
字段 provider/model/reasoningEffort/messages/system/tools/temperature/maxTokens/
stop/signal/sessionId/purpose，全文件无该键），并刻意不伪造键塞进去（"以为强制了
比知道没强制危险"）——姿态正确。**但复核进一步查明**：CF-B6 vendor 的
`packages/lykoi-llm-deepseek/vendor/index.js:265-266` **自己拼 DeepSeek HTTP
payload**（把 temperature/maxTokens 译成 wire 字段），因此加 response_format 是
**我们自家 vendor 的一处改动**，不必等上游。

风险量级：活体把 json 模式列为 U3 缺陷①的**止血主力**（③契约强化是同向第二层）。
新体现有防线=D-01 有界重试（仅 not_json）+契约强化，**独缺止血主力那层**。
→ **已加派 W3 交付项**：vendor 加 response_format 译码 + options seam 字段 +
adapter 层测试（S-52 钮从 seam 通到 wire）。列 M4 切换前置检查项。

## 新增 TODO（呈 W3/W4/M4）

①SK-77 设备侧承重→W3（接线点已留在"先说话后请示"位，落 `converse/approval_request_pending`
device_side_wired:false，W3 翻 true）；②vision/describeImage→W3；③D-04 横幅 pending
权威源→W3（接 kernel pendingCount()，现恒 0）；④D-01 超时秒数→M4 cordis.yml；
⑤GK-9 bootstrap 预授权=实弹前置条件已证（生产不接线，M4 清单必含，否则 S1B 死锁
让问句自己撞门）；⑥**事件词汇分流→W4**：遥测行与审计行同名不同字段集各出现一行，
完整性门的事件词汇表要不要显式分流由 W4 定。

## 偏离蓝图

零。三项命名形态适配（值一位不差，注释声明）：INTERPRET_VERDICTS 改名（导出面撞
delegation 词汇）、clarify 两骨架与 _AMBIGUOUS_CLARIFY 提名导出（为可执行对拍）、
活体路 B（非委托自问）不迁（依据具身重设计定案 Mac 退化纯感知器官）。
