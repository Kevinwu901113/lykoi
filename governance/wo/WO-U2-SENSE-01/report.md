# WO-U2-SENSE-01 · 执行报告归档（2026-09-01）

> 执行 Agent（opus）一次性全文，治理侧未改动（仅还原会话转录的 HTML
> 实体转义 &gt;/&lt;/&amp;，属序列化伪迹非报告原文）。复核记录见同目录 review.md。

## WO-U2-SENSE-01 执行报告

分支 `wo/u2-sense`，工作区 `/private/tmp/claude-501/-Users-wukevin-lykoi/e0991a0a-2b0d-4614-93b6-0e37476de6d3/scratchpad/wo-u2-sense`，基 `main@1976325`。未 push、未合并。`/Users/wukevin/Documents/lykoi/` 下主检出全程未动（复核时 `git status` 干净、尖仍在 `02a475f`）。

---

### ① 侦查段实证结论：organBlock 在两条生产装配上都活着

工作区是新检出，`var/` 下没有 devstate 样本。**没有走工单允许的降级路径（测试路径+静态核对）**，而是搭了活体探针：直接 boot 两个插件包的**生产 `apply()`**（`lykoi-converse`、`lykoi-wake`），接真 `lykoi-audit` sink，state 用 `lykoi-memory/testing` 的 `createStateFixture` 合成库。计数口径为**逐行 `JSON.parse(line).type === 'organ_inventory_built'` 全等**，不用 substring grep（2026-09-01 教训）。

| 探针 | audit 总行数 | `organ_inventory_built` 精确计数 | 判别特征 |
|---|---|---|---|
| 两插件合并启动 | 15 | **2** | 一条来自 converse、一条来自 wake |
| `RECON_ONLY=converse` | — | **1** | 该行**无** `channel` 字段（converse 内联 `logEvent` = `ctx.audit.record`） |
| `RECON_ONLY=wake` | — | **1** | 该行带 `channel:"telemetry"`（wake 的 `auditLogEvent` 适配器打戳） |

两条都渲染出 `chars: 631`（非空块，不是 null 早退）。归属判别规则的依据在 `packages/lykoi-gate/src/vocabulary.ts` 的双通道声明。

静态生产接线交叉核对（file:line）：

- `packages/lykoi-converse/src/index.ts:238` `new OrganInventoryCache(...)` → 消费点 `packages/lykoi-converse/src/conversation.ts:363`（构造期）与 `:491`（失效重建）
- `packages/lykoi-wake/src/index.ts:423` `new OrganInventoryCache(...)` → 消费点 `packages/lykoi-wake/src/index.ts:503` `organBlock: () => organs.block()` → `packages/lykoi-decide/src/index.ts:499`
- 发射点：`packages/lykoi-decide/src/organs.ts:227`（`organ_inventory_built`）、`:216`（`organ_inventory_bindings_failed`，本单 fail-safe 的先例）

结论：**器官自感知在醒着的她和聊天的她两侧都是活的**，非仅测试路径。

---

### ② 位点测绘：「她选择的动作不被承认/不在位」的全部结构性位点

| # | 位置（file:line，改动前） | 判定内容 | 现行拒绝语义 | 本单是否接线 |
|---|---|---|---|---|
| ① | `packages/lykoi-decide/src/index.ts:856-858` | kind 不在本情境词汇表（wake 18 词 / converse 4 词） | `throw new Error(\`unknown decision kind: ${pyRepr(kind)}\`)`；wake 侧被 SA-170 接住记 failed run，converse 侧 `u3_cycle_failed{reason:'unknown_kind'}` + 沉默收场，**不重试** | ✅ `unknown_kind` |
| ② | `packages/lykoi-decide/src/index.ts:915-918` | kind 合法但不在本拍候选表 | `demote(decision,'kind_not_in_candidates')` → 落 `decision_ungrounded`、换 safeKind（wake=rest / converse=silence）、清空 `grounded_concern_ids` | ✅ `kind_not_in_candidates` |
| ③ | `packages/lykoi-reflow/src/index.ts:392-396` | kind 过了词表与候选表，reflow 里没有执行分支 | `logEvent('unknown_decision_kind')` + `status='failed'` + 零 dispatch + 写 action_result 经验（G-1：永不默默变成通知） | ✅ `no_execution_branch` |
| ④ | `packages/lykoi-converse/src/conversation.ts:1046-1049` | 模型点的工具名不在 `TOOL_TO_ACTION`（10 条） | `logEvent('cycle_unknown_tool',{name})` + 回填 `{success:false,error:"unknown tool '<name>'"}`，周期继续 | ✅ `unknown_action` |
| ⑤ | `packages/lykoi-kernel/src/dispatch.ts:204-206` | `!KNOWN_ACTIONS.has(actionType)` | `throw new Error(\`unknown action ${JSON.stringify(actionType)}\`)` | ❌ 见下 |
| ⑥ | `packages/lykoi-kernel/src/schema-registry.ts:115-120` | `BodySchemaRegistry.register()` 的动作词表校验（GK-11 的「在位」判定） | 抛错（装配期接线错误，非运行期决策） | ❌ 见下 |

**⑤⑥ 不接线的测绘理由（这是没有触发停工线的根据）：**

- ⑤ 在生产里**到不了她的选择**。她的动作在到达 `dispatch` 之前必然先过 ①②③④ 四道关：wake 侧 kind 先被词表拦、再被候选表拦、再被 reflow 分支拦，`_resolve` 收到的 `actionType` 是 reflow/converse **内部映射**出来的常量；converse 侧则先过 `TOOL_TO_ACTION`。因此 ⑤ 触发只意味着**内部误路由**（接线 bug），语义上不是「她想要一个不存在的能力」。在这里发 `capability_gap` 会把两种性质完全不同的事混成一条账。
- ⑥ `registryActionCatalog` 今天**零生产消费者**（M5 编排位），`register()` 的校验只在装配期跑。运行期没有任何一条她的选择流经此处。

所以 `not_registered` 这一档**保留在 reason 值域里但不设发射点** —— 词表先立住，等 M5 把注册处接进生产再补发射点，不必到时再改值域。

**结论：接线可以完全在 `lykoi-kernel` / `lykoi-gate` 之外完成，硬性停工线未触发。两个受保护包一行未动。**

---

### ③ diff 摘要

新增 1 个源文件 + 4 个测试文件，改 4 个源文件 + 2 个既有测试文件。

**新增 `packages/lykoi-decide/src/capability-gap.ts`（约 120 行）** —— 事件的唯一出处：

- 常量：`CAPABILITY_GAP_EVENT='capability_gap'`；`GAP_REASONS` 五档 = `unknown_action` / `unknown_kind` / `kind_not_in_candidates` / `no_execution_branch` / `not_registered`；类型 `CapabilityGapReason`、`CapabilityGapSource`（`'wake'|'converse'`）、`CapabilityGapContext`。
- `capabilityToken(wanted)` —— 隐私标签闸（对齐 `kindToken` 先例，D-08/D-01）：`WANTED_TOKEN_MAX=20`，trim 后 ≤20 码点原样，**超过只记 `unrecognized:len<N>`，绝不截断**；`null/undefined→'missing'`、非串→`'nonstring'`、空/纯空白→`'blank'`。
- `emitCapabilityGap(logEvent, {wanted,reason,source,runId})` —— 整体 `try/catch` 吞（**留痕失败不毁一轮**，对齐 `organ_inventory_bindings_failed` 先例）；落 `{wanted, source, run_id, reason}` 四个结构字段，**不落任何用户消息或工具参数**。
- 发射点刻意写**字面量** `logEvent?.('capability_gap', {`，不写 `CAPABILITY_GAP_EVENT`：`lykoi-gate/src/vocabulary.ts` 的 `EMISSION_RE` 只认字符串字面量，用常量这个名字会在完整性门的遥测扫描里隐形。已用测试钉死「常量 === 字面量」不分叉。

**源改动（`git diff --stat`，共 +80/−8）**

```
packages/lykoi-converse/src/contract.ts     |  4 ++++
packages/lykoi-converse/src/conversation.ts | 11 +++++++++++
packages/lykoi-decide/src/index.ts          | 30 +++++++++++++++++++++++++++-
packages/lykoi-decide/test/evaluate.test.ts | 20 ++++++++++++++-----
packagesges/lykoi-reflow/src/index.ts       | 12 +++++++++++-
packages/lykoi-reflow/test/reflow.test.ts   |  8 +++++++-
packages/lykoi-wake/src/index.ts            |  3 +++
```

- `lykoi-decide/src/index.ts`：`export * from './capability-gap.ts'`；`EvaluateOptions` 新增 `gap?: CapabilityGapContext`（**只进事件、不参与四道关的任何一道**，缺席时事件照发、两栏记 null，刻意不给缺省值——「不知道谁问的」与「wake 问的」必须分得开）；位点① 在 `throw` **之前**插入一行 emit；位点② 把 `return demote(...)` 拆成 `const demoted = demote(...)` → emit → `return demoted`，**gap 排在 `decision_ungrounded` 之后**，于是「第一条事件是 decision_ungrounded」的既有读法不被打断。
- `lykoi-reflow/src/index.ts`：位点③ 在 `unknown_decision_kind` 之后 emit，`source:'wake'` 硬写（`executeAndReflow` 只有自主拍一个调用方，converse 走信封周期）。
- `lykoi-converse/src/conversation.ts`：位点④ 在 `cycle_unknown_tool` 之后 emit；`runId: this.#lastRunId || null`（`#lastRunId` 初值是空串 → 记 `null` 不记 `''`）；`parseEnvelope` 调用补传 `runId`。
- `lykoi-converse/src/contract.ts`：`parseEnvelope` opts 加 `runId?: string|null`，透传 `gap:{source:'converse',runId}`。
- `lykoi-wake/src/index.ts:262`：`evaluateMessage` 调用补 `gap:{source:'wake',runId}`。

**原拒绝语义逐字节不变**（全部经断言核实）：抛错消息文本、降级后的 `kind/demoted/demote_why/original_kind/grounded_concern_ids`、回填的 `{success:false,error:"unknown tool '…'"}`、`failed` 落法与经验文案、原事件名与其全部字段——一个字节没动。

**既有测试的两处改动（唯一的行为可见差异，均为「多了一条事件」）**：`evaluate.test.ts` 红测 6 与 `reflow.test.ts` G-1 都是对**完整事件表**做 `assert.deepEqual`，加法式新事件必然撞上。两处都只是把新事件追加进期望列表，原有两条断言逐字保留（并加了注释说明来源工单）。

**forbidden 清单逐条核对**：prompt/ENVELOPE 未改（converse 的 §3.2 A/B 表 sha 逐字断言、G-10 信封 sha `9d4f169e…/1677` 全部原样通过）；`KNOWN_ACTIONS`、硬门判定、schema-registry 语义未改；未新增她可写的面（gap 是纯出站遥测）；gap 事件只落四个结构字段；未做 `registryActionCatalog` 切换；未做价值阈值/resolution 逻辑。

---

### ④ 测试：基线 / 修改后（前台串行，无后台挂起）

| 包 | 基线 tests/pass/fail/skip | 修改后 | 差异解释 |
|---|---|---|---|
| lykoi-adapter-telegram | 55/55/0/0 | 55/55/0/0 | — |
| lykoi-audit | 3/3/0/0 | 3/3/0/0 | — |
| lykoi-budget | 5/5/0/0 | 5/5/0/0 | — |
| **lykoi-converse** | 94/93/0/1 | **99/98/0/1** | +5：新测试文件 |
| **lykoi-decide** | 69/69/0/0 | **79/79/0/0** | +10：新测试文件（红测 6 为改断言，不计数） |
| lykoi-gate | 72/72/0/0 | 72/72/0/0 | 完整性门未受新遥测事件名影响（只与 `IMMUTABLE_TYPES` 求交） |
| lykoi-heart | 14/14/0/0 | 14/14/0/0 | — |
| lykoi-kernel | 194/194/0/0 | 194/194/0/0 | 受保护面零改动 |
| lykoi-learn | 68/67/0/1 | 68/67/0/1 | — |
| lykoi-llm | 3/3/0/0 | 3/3/0/0 | — |
| lykoi-llm-deepseek | 5/5/0/0 | 5/5/0/0 | — |
| lykoi-memory | 80/71/0/9 | 80/71/0/9 | — |
| **lykoi-reflow** | 31/31/0/0 | **35/35/0/0** | +4：新测试文件（G-1 为改断言，不计数） |
| lykoi-regulation | 45/45/0/0 | 45/45/0/0 | — |
| lykoi-snapshot | 49/49/0/0 | 49/49/0/0 | — |
| **lykoi-wake** | 26/26/0/0 | **29/29/0/0** | +3：新测试文件 |
| **合计** | **813/802/0/11** | **835/824/0/11** | **+22 全绿；fail 恒 0；skip 恒 11（一条未新增、未消失）** |

`npm test` 退出码 0。中途曾出现的 2 条红（红测 6、G-1）已按上文说明修复，来源是加法式事件撞上全量 `deepEqual`，不是语义回归。

**新增测试点名（22 条，全绿）**

`packages/lykoi-decide/test/capability-gap.test.ts`（10）
1. 名字不分叉：导出的常量 === 发射点里的字面量（门的遥测扫描只认字面量）
2. 标签闸（隐私）：≤20 字原样、超过只记长度**不截断**、非串/空/缺席各有档
3. fail-safe：事件写失败不毁一轮（logEvent 抛 → emit 不抛；对齐 bindings_failed 先例）
4. 位点①（kind 词表判定）：未知 kind → capability_gap；**抛错语义逐字节不变**
5. 位点①：kind 非字符串同样留痕（wanted 落 nonstring，原始值不进事件）
6. 位点②（候选过滤）：kind 不在本拍候选表 → 降级照旧 + capability_gap 补一笔
7. gap 情境栏缺席：事件照发，source/run_id 记 null（不编造来源）
8. 对照组 A：合法且在候选表的 kind → **零** capability_gap
9. 对照组 B：reason 未接地的降级 → decision_ungrounded 有，capability_gap **零**
10. 对照组 C：safe_kind（rest）永不降级 → 零事件、零 gap

`packages/lykoi-converse/test/capability-gap.test.ts`（5）
11. 位点④：表外工具名 → capability_gap(unknown_action, converse, run_id) + 原拒绝逐字节不变
12. 位点④隐私：超长工具名只落长度，参数与正文一个字都不进事件
13. 位点①经对话路径：未知 kind → capability_gap(unknown_kind, converse)；沉默收场语义不变
14. 对照组：合法工具名（表内、接地）→ **零** capability_gap —— 派发失败不是能力缺口
15. 对照组：普通 reply 回合 → 零 capability_gap（安静路上不许有噪声）

`packages/lykoi-reflow/test/capability-gap.test.ts`（4）
16. 位点③：kind 有词表位、reflow 无执行分支 → capability_gap(no_execution_branch, wake)
17. 位点③隐私：超长 kind 只落长度（wanted 是标签栏，不是正文栏）
18. 对照组：reflow 有分支的 kind（rest/contemplate/record_note）→ **零** capability_gap
19. 对照组：logEvent 缺席时未知 kind 照样只是 failed —— 留痕缺席不改判

`packages/lykoi-wake/test/capability-gap.test.ts`（3）
20. 端到端：她要一个词表外的动作 → capability_gap 带 source=wake 与本拍 run_id
21. 对照组：正常的 contemplate 一拍（合法 + 在候选表 + 接地）→ **零** capability_gap
22. 对照组：idle（心脏零拍）→ 零 capability_gap（没醒过就没有想要过）

四个位点全部有红绿两侧；每个位点断言用 `events.filter(([n]) => n === 'capability_gap')`（**全等，非子串**）。

---

### ⑤ typecheck

`npx tsc --noEmit` → 退出码 **0**；`npm run typecheck` → 退出码 **0**，零告警。

---

### ⑥ 分支尖 commit

```
473804dfe37de625d051e7c146984f9f68136391
[WO-U2-SENSE-01] capability_gap 一等事件：四个判定点旁路留痕
```

分支 `wo/u2-sense`，无 upstream（未 push），未合并 main。工作树干净。

---

### ⑦ 偏离 / 停工事项

1. **无停工。** 硬性停工线未触发 —— 见 ② 的 ⑤⑥ 测绘理由：接线全部落在 `lykoi-kernel` / `lykoi-gate` 之外，两个受保护包一行未动（`git diff` 可核）。
2. **偏离（往严处）：侦查段没有用工单允许的降级路径。** 工单允许「无 devstate 样本时以测试路径证据 + 静态生产接线交叉核对替代」；我改为搭活体探针跑两个插件的真实 `apply()`，拿到了真实事件计数（合并 2 / 分侧各 1）。静态核对同时也做了。这是更强的证据，不是更弱的。
3. **偏离（须治理知悉）：`not_registered` 只入值域、不设发射点。** 工单要求「在最贴近判定的位点接线」；GK-11 那一处判定（`BodySchemaRegistry`）今天零生产消费者，接线只能得到永不触发的死代码。保留值域是为了 M5 接注册处时不必改值域（改值域会撞既有事件消费者）。若治理认为值域也应等到有发射点再立，我可以删掉这一档。
4. **既有测试断言的两处修改**（`evaluate.test.ts` 红测 6、`reflow.test.ts` G-1）已在 ③ 说明并在代码里加注释标注工单号。这是加法式事件的必然结果，不是掩盖回归 —— 两处原有断言逐字保留，新增的只是「多了一条」。
5. **`var/recon-organ*.ts` 两个探针脚本已删。** 它们在 gitignore 的 `var/` 下，从未进入提交。
6. **发射点用字面量而非常量**是刻意的（门的 `EMISSION_RE` 只认字面量），已用测试钉住不分叉。若日后有人「优化」成常量，测试 1 会红。
