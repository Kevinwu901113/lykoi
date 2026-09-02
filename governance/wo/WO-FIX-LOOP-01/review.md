# WO-FIX-LOOP-01 · 治理复核记录（2026-09-02）

- 执行：sonnet 子 Agent（Mac 隔离 worktree，分支 `wo/fix-loop-01`，基 main@b6fc33e）。
  执行中两次中断（API 429 速率限制；流停滞 600 s 看门狗），均以 SendMessage
  续跑同一 Agent，worktree 已提交内容零丢失。
- 执行尖：`ec6841f`（6 提交：kernel → decide → wake → converse → snapshot → report）。
- 治理复核改口：1 提交（见第 4 项），随后 rebase 到 main@a794e7f（含同日并入的
  WO-PERS-OVERLAY-01），**受审尖 `a6e4432`**（7 提交，父链连续接 a794e7f，
  `git status --porcelain` 零输出，已 `--force-with-lease` 推到 origin）。
- 执行报告：同目录 report.md（自分支逐字归档，数字为改口前、rebase 前）。

## 独立复核项与结果

1. **diff 边界**（a794e7f..a6e4432）：23 文件 +1010/−154；name-only 过
   `gate|prompt|vendor|profile|yml|learn|memory` 滤网**零命中**。src 只触
   kernel/dispatch.ts、decide/{index,capability-gap,organs}.ts、wake/index.ts、
   converse/{index,conversation,contract}.ts、snapshot/restart-collect.ts。
2. **kernel diff 逐行直读（D-1a）**：仅 `markUnwiredHandler`（`Symbol.for`
   不可枚举标记）、`isUnwiredHandler`、`wiredActionCatalog`（保 `KNOWN_ACTION_LIST`
   序，`isHardGated` 同实现）与两段注释改口；替身抛错文案、`_resolve`、
   `_executeDecision`、三道门、immutable 行构造零改动。kernel 单独一提交 ✔。
3. **定案逐条**：
   - D-1b：wake/converse 各只调一次 `outboundOrganResources()`，同一实例喂
     `createDispatch` 与 `OrganInventoryCache` ✔。
   - D-1c：`buildCandidates(snap, {wired})` 放在三分支之后统一 `delete('explore')`
     （含 SA-09 饥饿棘轮）；不传 opts 逐字节不变 ✔。
   - D-1d：`#buildAction` 在词表命中之后、参数解析之前加闸；不进 dispatch；
     未传 `wiredActions` 不触发 ✔。
   - D-1e：`GAP_NOT_WIRED='not_wired'` 入 `GAP_REASONS` 末位，纪律 3 补记 ✔。
   - D-2：四路（逐字 / NFKC+去空白去标点 / 10 码点滑窗片段 / concern_id 结构）
     任一命中；`DECIDE_SYSTEM_PROMPT` sha 不变（报告 §4 对照，治理侧复核
     该字面量在 diff 中零命中）✔。
   - D-2b：`groundingExempt` 只跳第 3 道；converse 传 `{tool_call}`，wake 不传 ✔。
   - D-3a：`extractJson` 探测，恰一次重试，事件 `autonomy_wake_retried`
     {run_id, reason, content_len}；第二次失败走原路 ✔。
   - D-3b：`responseFormat` 由调用点经 `LlmFn.meta` 显式传入，只在阶段 4b；
     整合/专注两处不带 ✔。
   - D-4：`--timestamp=utc` + 严格正则 → ISO Z；`n/a`/空 → null 零事件；
     `never_stopped` 字面量已移除；`negative_interval` 分支保留 ✔。
   - D-5：profile / gate / 信封契约 / `TOOL_TO_ACTION` 未动 ✔；无 env ✔。
4. **治理复核改口（a6e4432，两处偏离定案，治理侧直接修正并加测试对齐）**：
   - D-1d 的 gap `wanted` 执行方记了动作类型（26 字，过 `capabilityToken`
     标签闸只落长度 `unrecognized:len26`），定案写的是工具名；改为 `name`
     （18 字原样落，与位点④同口径），`cycle.test.ts` 对应断言随之改。
   - D-2 的 `grounded_concern_ids` 定案要求去重升序，执行方沿用旧映射；改为
     `Set` 去重 + 数值升序。
5. **独立复跑**：
   | 尖 | tests | pass | fail | skipped | tsc |
   |---|---|---|---|---|---|
   | 基线 main@b6fc33e | 880 | 869 | 0 | 11 | 净 |
   | 执行尖 ec6841f | 907 | 896 | 0 | 11 | 净 |
   | 受审尖 a6e4432（rebase 后） | 929 | 918 | 0 | 11 | 净 |
   本单净增 27 条测试（与 main 上 WO-PERS-OVERLAY-01 的 +22 相加对得上 902→929）。
6. **既有测试改动**：报告 §3 列 16 项，治理侧抽查 4 项（wake SA-170 事件序、
   converse e2e "沉默路"、converse kernel-e2e ②、snapshot `n/a`）——均为定案
   直接后果的改口，无删断言过关；approval-e2e / w3-organs 四处只加
   `registerOrganHandler` 夹具使动作在测试语境"真接线"，断言原样。

## 遗留（不阻塞裁合）

- **GK-14 张力（执行方发现，未修，属信封契约范围 = D-5 排除项）**：
  `cycleRecord` 的 `dispatched` 只看 decision 形状，先于 D-1d 闸；一个指向
  "在表但未接线"动作的 tool_call 会自称 `dispatched` 却永不产生
  `action_dispatch` 行。另立小单改 `dispatched` 语义（或让 D-1d 结果回填信封记录）。
- `docs/m3_schema_registry.md:15-18` 描述的正是本单修掉的 bug 本体，措辞未随改
  （不在交付项字面 grep 内）；随 M5 接 `registryActionCatalog` 时一并改口。
- 活体验证项（落地后首日读数）：器官清单块只剩 5 项；`decision_ungrounded`
  日频显著下降；`autonomy_wake_retried` 出现而 `autonomy_wake_failed{error:''}`
  归零；重启后 `restart_event` 带 downtime 且无 `negative_interval`。

## 结论

**PASS**。待 Kevin 裁合 `wo/fix-loop-01`（a6e4432）入 main；落地 = 拉 main +
重启，零迁移（manifest 钉 src 须 root 重签，约 5 秒停机，同 LANDING-F 口径）。
