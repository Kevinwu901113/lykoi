# WO-FIX-LOOP-01 执行报告

分支：`wo/fix-loop-01`（base `b6fc33e`，本报告提交前 HEAD `354d250`）。
提交序列（5+1，kernel 单独一条）：

```
64fe479 kernel D-1a：替身 handler 打不可枚举标记 + isUnwiredHandler + wiredActionCatalog
ead405d decide D-1c/D-1e/D-2/D-2b：候选看 wired、gap 词表加 not_wired、溯源四路
8e0ddc5 wake D-1b/D-1c 传参/D-3a/D-3b：单份 outboundOrganResources 喂器官清单与 dispatch、候选表看 wiredActions、not_json 有界重试一次、阶段 4b 强制 json_object
662b93e converse D-1b/D-1d/D-2b：单份 outboundOrganResources 喂器官清单与 dispatch、#buildAction 挡未接线动作、tool_call 免溯源门
354d250 snapshot D-4：restart downtime 采集改走 --timestamp=utc + 严格形状解析，撤销 never_stopped
```

## §1 改动清单（文件:行）

源码：

- `packages/lykoi-kernel/src/dispatch.ts:180-234` 新增 `UNWIRED_HANDLER_MARK`（`Symbol.for('lykoi.kernel.unwired_handler')`）、`isUnwiredHandler`、`wiredActionCatalog`；`:539-549` `unwiredResources()` 的每个替身 handler 打标记。
- `packages/lykoi-decide/src/capability-gap.ts:34-42,66-82` `GAP_REASONS` 追加末位 `GAP_NOT_WIRED = 'not_wired'`。
- `packages/lykoi-decide/src/organs.ts:30-44` 文档口径改口（`kernelActionCatalog`→`wiredActionCatalog`，D-5 排除 `registryActionCatalog`）。
- `packages/lykoi-decide/src/index.ts:283-292` `buildCandidates(snap, opts?: {wired?})`；`:624-697` `groundedEntries` 四路溯源（逐字/规范化/片段引用/结构引用）；`:907-913` `EvaluateOptions.groundingExempt?: ReadonlySet<string>`；`:1000-1029` gate 顺序改口，`groundingExempt` 跳过第③关。
- `packages/lykoi-wake/src/index.ts:56-66` 导入 `wiredActionCatalog`/`outboundOrganResources`/`extractJson`；`:140-150` `LlmFn` 加 `responseFormat`；`:163-179` `WakeDeps` 加载点；`:254-286` D-3a 有界重试（`extractJson` 探测非 JSON，恰一次）+ D-3b 阶段 4b 强制 `responseFormat: {type:'json_object'}`；`:455-461` `outboundOrganResources()` 只调一次，同一实例喂 `OrganInventoryCache` 与 `createDispatch`；`buildCandidates` 传 `{wired: wiredCatalog.knownActions}`。
- `packages/lykoi-converse/src/contract.ts:340` `parseEnvelope` 调 `evaluateMessage` 时传 `groundingExempt: new Set([TOOL_CALL])`；`:392` 新增 `CYCLE_TOOL_UNWIRED_EVENT = 'u3_cycle_tool_unwired'`。
- `packages/lykoi-converse/src/conversation.ts:287-293` `ConverseDeps.wiredActions?: ReadonlySet<string>`；`:1070-1082` `#buildAction` 新闸：`wiredActions` 存在且不含该动作 → 落 `u3_cycle_tool_unwired` + `capability_gap{reason: GAP_NOT_WIRED, source:'converse'}` + `{success:false, error:"organ not wired: '<name>'"}`，不进 `dispatchFn`。
- `packages/lykoi-converse/src/index.ts:238-244` `outboundOrganResources()` 只调一次，同一实例喂 `OrganInventoryCache` 与 `createDispatch`；`:433` `wiredActions: new Set(wiredCatalog.knownActions)` 传入 `Conversation`。
- `packages/lykoi-snapshot/src/restart-collect.ts:80-111` 新增 `UTC_TIMESTAMP_RE`；`collectDowntime` 命令加 `--timestamp=utc`，严格正则解析，空串/`n/a`→null 零事件，形状不对→`unparsable_timestamp`；撤销 `never_stopped` 字面量与分支。

测试（新增/改动，逐条见 §3）：

- `packages/lykoi-kernel/test/dispatch.test.ts:349-397`（全部新增）
- `packages/lykoi-decide/test/candidates.test.ts:179-221`（全部新增）
- `packages/lykoi-decide/test/capability-gap.test.ts:60-65`（改动 1 处）、`:187-197`（新增）
- `packages/lykoi-decide/test/evaluate.test.ts:267-356`（全部新增）
- `packages/lykoi-wake/test/fixture.ts:125`（类型签名扩宽，非断言改动）
- `packages/lykoi-wake/test/wake.test.ts:58` 附近（改动 1 处）、`:158-181`（改动 1 处）、`:186-227`（新增 2 条）
- `packages/lykoi-wake/test/kernel-e2e.test.ts:58-190`（改动 1 条大测试）
- `packages/lykoi-converse/test/cycle.test.ts:141-224`（新增 2 条、改动 1 条）
- `packages/lykoi-converse/test/e2e.test.ts:268-312`（改动 1 条）
- `packages/lykoi-converse/test/approval-e2e.test.ts:317,372`（各改动 1 条）
- `packages/lykoi-converse/test/kernel-e2e.test.ts:151,218`（各改动 1 条）
- `packages/lykoi-converse/test/w3-organs.test.ts:280,328`（各改动 1 处：加 fixture 前置，断言未变）
- `packages/lykoi-snapshot/test/restart-collect.test.ts:81-182`（改动 4 条、新增 4 条）

`git diff --stat b6fc33e..HEAD`：22 files changed, 867 insertions(+), 152 deletions(-)。

## §2 定案逐条落点

- **D-1a**（kernel 替身打标）→ `dispatch.ts:180-234,539-549`；`isUnwiredHandler`/`wiredActionCatalog` 导出。
- **D-1b**（wake/converse 单份 `outboundOrganResources()` 同喂两处）→ `lykoi-wake/src/index.ts:455-461`、`lykoi-converse/src/index.ts:238-244`。
- **D-1c**（`buildCandidates(snap, {wired})` 摘 explore）→ `lykoi-decide/src/index.ts:283-292`；wake 侧传参 `lykoi-wake/src/index.ts` 461 行下方调用点。
- **D-1d**（converse `#buildAction` 挡未接线动作）→ `conversation.ts:1070-1082`；`ConverseDeps.wiredActions` 声明于 `:287-293`；未传时行为逐字节不变（`cycle.test.ts:173` 用例钉住）。
- **D-1e**（`GAP_NOT_WIRED` 入表）→ `capability-gap.ts:71,73-82`。
- **D-2**（SA-20b 溯源门四路 OR）→ `lykoi-decide/src/index.ts:624-697` `groundedEntries`。
- **D-2b**（`groundingExempt` 跳过第③关，仅限声明的 kind）→ `lykoi-decide/src/index.ts:907-913,1025-1026`；converse 侧传参 `contract.ts:340`（`new Set([TOOL_CALL])`）；wake 侧不传（保持原口径）。
- **D-3a**（wake 有界单次重试）→ `lykoi-wake/src/index.ts:254-286`，用已导出的 `extractJson` 探测非 JSON，仅重试一次，两次皆空则原样归入既有失败路径（新增 `autonomy_wake_retried` 事件先于 `autonomy_wake_failed`）。
- **D-3b**（阶段 4b 强制 `responseFormat: {type:'json_object'}`）→ `lykoi-wake/src/index.ts:272`，只在该调用点生效，其余调用点不受影响（`wake.test.ts` 断言逐条核对）。
- **D-4**（restart downtime 走 `--timestamp=utc` 严格解析）→ `lykoi-snapshot/src/restart-collect.ts:80-111`；`never_stopped` 整条撤销。
- **D-5**（排除项）→ 逐条见 §4；`lykoi-gate`、`profile/cordis.prod.yml`、`DECIDE_SYSTEM_PROMPT`、信封契约（`ENVELOPE_SYSTEM_PROMPT`/`ENVELOPE_RESPONSE_FORMAT`/`TOOL_TO_ACTION`）均未改动；无 `registryActionCatalog`/`BodySchemaRegistry` 接线；无 `research_browser.*` 真 handler；无新环境变量。

## §3 测试四元组 + 新增/改动测试清单

全量 `npm test`（monorepo 全部 17 个工作区）四元组：

| 包 | tests | pass | fail | skipped |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | 0 | 0 |
| lykoi-audit | 3 | 3 | 0 | 0 |
| lykoi-budget | 5 | 5 | 0 | 0 |
| lykoi-converse | 102 | 101 | 0 | 1（既有，非本单引入） |
| lykoi-decide | 94 | 94 | 0 | 0 |
| lykoi-gate | 72 | 72 | 0 | 0 |
| lykoi-heart | 14 | 14 | 0 | 0 |
| lykoi-kernel | 199 | 199 | 0 | 0 |
| lykoi-learn | 78 | 77 | 0 | 1（既有，非本单引入） |
| lykoi-llm | 6 | 6 | 0 | 0 |
| lykoi-llm-deepseek | 5 | 5 | 0 | 0 |
| lykoi-memory | 111 | 102 | 0 | 9（既有，非本单引入） |
| lykoi-reflow | 35 | 35 | 0 | 0 |
| lykoi-regulation | 45 | 45 | 0 | 0 |
| lykoi-snapshot | 52 | 52 | 0 | 0 |
| lykoi-wake | 31 | 31 | 0 | 0 |

`cancelled` 全部为 0（未在表中单列）。合计 0 fail。`npm run typecheck`：`tsc --noEmit` 退出码 0，无输出。

### 新增测试

- `lykoi-kernel/test/dispatch.test.ts:349-397`：D-1a 四条（替身识别、真 handler 不识别为替身、全替身→`wiredActionCatalog` 为空、混入真 handler 后只列真的且 `isHardGated` 与 `kernelActionCatalog` 逐项相等）。
- `lykoi-decide/test/candidates.test.ts:179-221`：D-1c 五条（不传 `opts.wired` 行为不变；wired 缺 read_text 摘 explore；prefer_rest 饥饿棘轮出口同样被摘；wired 含 read_text 不受影响；force_inner_tending 分支不受影响）。
- `lykoi-decide/test/capability-gap.test.ts:187-197`：D-1e 一条（`GAP_NOT_WIRED` 字面值 + 落盘形状）。
- `lykoi-decide/test/evaluate.test.ts:267-356`：D-2/D-2b 九条（四条路径正反例 + `groundingExempt` 跳③关但不跳②关）。
- `lykoi-wake/test/wake.test.ts:186-227`：D-3a 两条（首包非 JSON 次包合法→重试后 completed；两包皆非 JSON→仍归入既有失败路径，恰重试一次不循环）。
- `lykoi-converse/test/cycle.test.ts:141-196`：D-1d 两条（未接线动作被 `#buildAction` 挡下、`dispatchFn` 从未被调；不传 `wiredActions` 时新闸不触发、旧行为不变）。
- `lykoi-snapshot/test/restart-collect.test.ts:97-108,153-161`：D-4 两条（命令参数里恰有 `--timestamp=utc`；本地时区形状→`unparsable_timestamp` 不当 UTC 硬解）+ 空串→null 零事件一条。

### 改动的既有测试（file:line + 理由）

1. `lykoi-decide/test/capability-gap.test.ts:60-65`——`GAP_REASONS` 全量快照断言补上末位 `not_wired`（D-1e 扩表，字面量清单必须随表结构更新，前 5 项顺序/值不变）。
2. `lykoi-wake/test/wake.test.ts:65-75`（"端到端一拍"）——`llm.calls[0].meta` 的 `deepEqual` 补上 `responseFormat: {type:'json_object'}`（D-3b 只加字段，不改路由/归因逻辑）。
3. `lykoi-wake/test/wake.test.ts:158-181`（"SA-170：一拍失败被完整接住"）——`log.names()` 从 `['autonomy_wake_failed']` 改为 `['autonomy_wake_retried', 'autonomy_wake_failed']`，并加 `llm.calls.length === 2` 断言（D-3a 有界重试：同一 fake 回复被打两次，恰一次重试后仍归入既有失败路径，原有失败语义不变，只是账前面多一条）。
4. `lykoi-wake/test/kernel-e2e.test.ts:58`（"三路自主动作经真门"）——整条重写：D-1c 生效后 `research_browser.read_text` 未接线，wake 把 `wiredActionCatalog` 喂给 `buildCandidates`，explore 不再候选；模型仍选 explore 时走既有位点②（`kind_not_in_candidates`）降级为 `rest`，安全 completed，不再走到 dispatch 替身、不再"大声失败"。第一拍的 `decision`/`status`/`action_dispatch`/`action_result`/`params` 断言全部随之改写；新增对 `decision_ungrounded`（why=kind_not_in_candidates）与 `capability_gap`（reason=kind_not_in_candidates, source=wake）两条既有安全网事件的断言；`autonomy_runs` 台账断言改为三拍都建 run（含降级拍）但只有两拍落 `action_dispatch`。
5. `lykoi-converse/test/cycle.test.ts:198`（原"D-03"，现"D-03→D-2b改口"）——原场景（tool_call 因理由未接地被降级）被 D-2b 直接废止（converse 对 tool_call 免第③关）；重写为断言工具照常执行到底（`dispatched===1`、无 `u3_cycle_tool_demoted`、首条 `u3_cycle_envelope` 记录 `kind:'tool_call', demoted:false`），验证 D-2b 生效后的新正确行为。
6. `lykoi-converse/test/e2e.test.ts:268`（原"沉默路（红）"，现"沉默路（红→D-1d/D-2b 改口）"）——原场景同样被 D-2b 废止，且目标动作 `research_browser.read_text` 在生产资源里本就未接线（D-1d 命中）；重写为断言：不再有 `decision_ungrounded`/`u3_cycle_tool_demoted`，反复撞 D-1d 闸产生 `u3_cycle_tool_unwired` + `capability_gap{reason:'not_wired', source:'converse'}`，最终以 `u3_cycle_tool_budget_exhausted` 收场，工具全程零真正执行、无外发、无 URL 泄漏。
7. `lykoi-converse/test/approval-e2e.test.ts:317`（"GK-14 正断言"）——`terminal.exec` 在生产资源里本就未接线，D-1d 生效后会先于 kernel 审批门拦下，与本用例意图（验证 kernel 审批门本身）无关；改动仅加 `fakeTerminal()`（`registerOrganHandler('terminal.exec', ...)`）+ `t.after(() => clearOrganHandlers())` 使该动作在测试语境下"真接线"，断言逐字未变。
8. `lykoi-converse/test/approval-e2e.test.ts:372`（"GK-14 反断言"）——原场景（ungrounded 的 `terminal_exec` 触发降级）被 D-2b 废止；且发现一个新的架构张力（见 §5）：一个已接地但未接线的 tool_call 会在 `cycleRecord` 阶段先自称 `dispatched`（该字段只看 decision 形状，不看 D-1d 后续是否放行），随后被 D-1d 拦下、从不产生 `action_dispatch` 行，理论上可违反 GK-14"自称 dispatched ⟹ 有匹配审计行"的不变式。为不在测试里掩盖或曲解这一发现，改用完全不同的场景（词表外工具名 `web_search`，走 `cycle_unknown_tool` 路径，`dispatched` 从不被置真）验证 GK-14 反向不变式，同时把发现写入代码注释与本报告 §5。
9. `lykoi-converse/test/kernel-e2e.test.ts:151`（原①）——`browser.navigate` 未接线，D-1d 会先拦下，与本用例意图（验证 kernel 审批门①）无关；改动仅加 `fakeBrowserNavigate()`（`registerOrganHandler('browser.navigate', ...)`）+ `clearOrganHandlers()`，断言逐字未变。
10. `lykoi-converse/test/kernel-e2e.test.ts:218`（原②"live always_allow 放行也没用"）——原用例的前提（"kernel 用 live 规则放行，未接线替身随后大声失败"）正是 D-1 要消灭的 bug 本体，D-1d 生效后该前提不再成立（未接线动作根本不会问到 kernel）；整条重写为断言新的正确行为：`u3_cycle_tool_budget_exhausted` 出现、从未有 `cycle_approval_gate_unwired`、零 `action_dispatch`/`action_result`、`u3_cycle_tool_unwired`/`capability_gap` 各出现 `MAX_TOOL_STEPS` 次。
11. `lykoi-converse/test/w3-organs.test.ts:280`（"出口判据② 预算边界回归"）——`terminal.exec` 未接线，D-1d 会先拦下导致该用例本要验证的预算边界机制走不到；改动仅加 `fakeTerminal()` + `clearOrganHandlers()`，断言未变。
12. `lykoi-converse/test/w3-organs.test.ts:328`（"④ D-04 横幅接权威源"）——同上原因（需要 `pendingCount()` 真反映一个真实 pending 审批），同样只加 fixture 前置，断言未变。
13. `lykoi-snapshot/test/restart-collect.test.ts:81-95`（四档 downtime 渲染）——D-4 改走 `--timestamp=utc`，输出形状从 ISO 改为 `[Dow ]YYYY-MM-DD HH:MM:SS UTC`，四档用例的输入字面量随形状改写，其中一档钉住"带星期前缀也认得"；期望值（30 秒/15 分钟/3 小时 30 分钟/3 天）不变。
14. `lykoi-snapshot/test/restart-collect.test.ts:143-151`（原"`n/a` → null"）——断言从 `reason === 'never_stopped'` 改为 `assert.deepEqual(ev.rows, [])`（D-4 撤销 `never_stopped`：单元从没停过是"没有这条线索"而非"读取失败"，不再落任何遥测）。
15. `lykoi-snapshot/test/restart-collect.test.ts:163-171`（不可解析时间戳）——输入字面量改为不符合新严格正则的形状（`'Mon 2026-08-25 whenever\n'`，仍不匹配），断言（`unparsable_timestamp`）不变。
16. `lykoi-snapshot/test/restart-collect.test.ts:173-182`（负值区间）与`:194-205`（三条一次采齐）——输入时间戳字面量改写为 `--timestamp=utc` 形状，断言不变。

以上 16 项覆盖 kernel/decide/wake/converse/snapshot 五个包内所有被本工单触碰到的既有测试；未列出的文件/测试用例均未改动断言（仅可能有导入行变化，如 `dispatch.test.ts` 顶部导入新增 `isUnwiredHandler`/`wiredActionCatalog`，`fixture.ts:125` 的 `LlmCall.meta` 类型加一个可选字段，均非断言改动）。

## §4 sha 对照（改前 `b6fc33e` vs 改后 `HEAD`）

| 项 | 改前 SHA256 | 改后 SHA256 | 是否相同 |
|---|---|---|---|
| `profile/cordis.prod.yml`（整文件） | `64271cf093148d45d2db0088074092b74eedd6ec0052cd3d34c737d073a2f1f8` | 同左 | 相同（diff 0 行） |
| `DECIDE_SYSTEM_PROMPT`（`lykoi-decide/src/index.ts`，字面量文本） | `d54726e3ee182f600f5fc0222db76de940d3a66cddfb63cb8e29ff71b633e74c`（len 1601） | 同左 | 相同 |
| `ENVELOPE_SYSTEM_PROMPT`（`lykoi-converse/src/contract.ts`） | `4f8096ef0d4ec0a5370811a7b99dd23adacdd4ba3809f0044f424ac922eb26bf`（len 1670） | 同左 | 相同 |
| `ENVELOPE_RESPONSE_FORMAT`（字面量 `{type:'json_object'}`） | 同 | 同 | 相同 |
| `TOOL_TO_ACTION`（`lykoi-converse/src/contract.ts`） | `5c7aa25e1ce9e9a0e1c072722d1e8b3671e6b76801578e2f67a52bc2b8846754` | 同左 | 相同 |

## §5 未做与偏离

1. **GK-14/D-1d 自称落痕新张力（发现，未修）**：`cycleRecord()`（`lykoi-converse/src/contract.ts` 中 `dispatched` 字段计算）仅依据 decision 形状（`kind===tool_call && tool 非空`）判定"自称已派发"，与 D-1d 的 `#buildAction` 未接线闸完全独立、时序上先于该闸。因此一个已通过溯源/候选表、指向"在表但未接线"动作的 tool_call，会先在 `u3_cycle_envelope` 里自称 `dispatched: '<tool_name>'`，随后被 D-1d 拦下、从不产生 `action_dispatch`/`action_result` 审计行——理论上违反 GK-14 的不变式（"自称 dispatched ⟹ audit 有匹配 action_dispatch 行"）。修复需要改动 `cycleRecord` 的 `dispatched` 语义，即触碰信封契约，属于 D-5 明确排除项，故本单不改；已在 `approval-e2e.test.ts:372` 附近落代码注释，本报告一并记录，留待后续单独定案。
2. **docs 改口（deliverable #10）**：`grep -rn "18 个动作\|never_stopped" docs/` 在 `docs/m4_handoff.md`、`docs/deploy.md`（及全部 `docs/`）中零命中——无需改口，结论"无"。附带说明：`docs/m3_blueprint.md:42`、`docs/m4_handoff.md:212`、`docs/m3_schema_registry.md:15,16,18,107` 存在相近但不同的字面表述"18 项"，不匹配交付件给定的字面 grep 目标（"18 个动作"），未触碰；`docs/m3_schema_registry.md:15-18` 实际描述的正是本工单要修的 bug 本体（`kernelActionCatalog` 恒列 18 项、真假接线代码里看不出来），但因不在字面 grep 目标内且改动文档措辞不属于 D-1..D-5 任一定案范围，本单未改。
3. 其余 4 条定案（D-1a/b/c/e、D-2/2b、D-3a/b、D-4）均按序落地，未发现与代码现实冲突之处。

## §6 落地口径

- 拉 main（本分支 rebase/merge 到 main 后）+ 重启 `lykoi-cordis` 服务即可生效，无需任何额外步骤。
- `profile/cordis.prod.yml` 未改动（§4 已 SHA 核对），无新增/变更环境变量，无需改配置、改 systemd unit、改 secrets。
- 零数据迁移：本工单未新增/变更任何持久化表结构或字段语义（`autonomy_runs`/`experiences`/audit 事件表 schema 均未动，`capability_gap.reason` 只是新增一个允许值 `not_wired`，`restart-collect` 的 `deploy_event` 遥测字段形状不变、只是 `downtime` 在"单元从未停过"时不再有一个已撤销的 `never_stopped` 理由可读）。
- `lykoi-gate` 包未触碰，三道 kernel 派发防护未改动。
- 行为变化仅发生在进程重启后的下一次 wake/converse 周期；重启前的历史审计行/经验记录不受影响、无需回填或修正。
