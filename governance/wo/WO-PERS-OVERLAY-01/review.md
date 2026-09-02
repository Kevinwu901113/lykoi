# WO-PERS-OVERLAY-01 · 治理侧复核（2026-09-02）

## 0. 结论

**PASS，建议合并。** 交付 = 分支 `wo/pers-overlay` 尖 `69ee4fc4103e70189ddb3b9f62dc2e60df7c8011`
（父 = 章程修订提交 `23c65a0`；三次提交 3835a15 rw → 9dde0f9 l4 → 69ee4fc converse；工作树 clean）。

- 全量测试治理侧独立复跑：退出码 **0**，902 / 891 过 / 0 失败 / 11 跳过（基线 880/869/0/11，
  **+22 只增不减**：rw 9、l4 9、assemble 4；prompts B 表 13→14 条在同一用例内）；16 包各
  `ℹ fail 0`；`tsc --noEmit` 退出码 0。
- 治理侧 devstate 副本注入复跑（`LYKOI_DEVSTATE_DB`，只读；执行方未触碰该副本）：退出码 0，
  **902 / 902 / 0 / 0**；副本文件 mtime / 大小前后不变。
- 零 schema 变更、零迁移、零 env：`schema.ts` / `EXPECTED_MIND_SCHEMA_VERSION`（17）/ 迁移目录
  未动；`name-only` 过滤网只剩 `prompts.ts`（新增常量）与 `prompts.test.ts`（B 表加一行）。
- 与在途 `wo/fix-loop-01`（尖 64fe479）`git merge-tree` 预演：**无冲突**。
- 偏离：两处，均**接受**（§3）。

## 1. 复核方法

1. 执行方最终消息逐字归档为同目录 `report.md`；停工上报归档为 `deviation_d2_2026-09-02.md`。
2. 在执行方 worktree 里读全量 src diff（11 文件，872+/7−）与全部新测试 diff；核 D-1..D-9 落点。
3. 治理侧自己跑：`npm test`、`npx tsc --noEmit`、devstate 注入 `npm test`（三次退出码均 0）。
4. 只读产线预检（governance 账户，`sqlite3` 只读打开 state 库；见附录 A）。
5. `git merge-tree` 预演与 `wo/fix-loop-01` 的合并。

## 2. D-1..D-9 逐条对照（文件:行 = 分支尖 69ee4fc）

| 定案 | 要求 | 落点 | 判定 |
|---|---|---|---|
| D-1 判别式 | 代码按 `concern.kind === 'relationship_thread'` 选类别，不改 FOCUS 提示词 | `l4.ts:97` `RELATIONSHIP_CONCERN_KIND`；`:675` `isRelationship`；`:685` 类别三元 | ✅ FOCUS_SYSTEM_PROMPT sha 不变（prompt.test.ts 绿） |
| D-2（修订版） | 正本 `rw.ts`；`l4.ts` 用 `shared.ts` 副本；boundary 对拍一行；import 面守卫仍绿 | `rw.ts:299` 正本；`shared.ts:122` 副本；`l4.ts:30` 从 `./shared.ts` 导入；`boundary.test.ts:17,114` 对拍；`boundary.test.ts:44-53` 未动；两包 `package.json` 未动 | ✅ |
| D-3 KEY 推导与兜底 | KEY = 关切实体轴 ?? owner；皆 null → 退 focus 类别 + `relationship_overlay_unkeyed`；scope 行 INSERT OR IGNORE，形状 (insights, id, subject, NULL, private, content) | `l4.ts:676-684` 推导；`:698` 写 scope；`:707` unkeyed；`rw.ts:1881` `scopeInsightSubject`（FK 生效，不存在的 user 抛） | ✅ 三分支各有测试（l4 ①③④；rw D-3 三例） |
| D-4 读口两分 | `promotedRelationshipInsights(subject)` = active ∧ relationship ∧ 键相符（inner JOIN）；`promotedFocusInsights()` = active ∧ COALESCE(category,'') <> relationship；`listFocusInsights` 不动 | `rw.ts:2236` / `:2255`；`listFocusInsights` diff 无改动 | ✅ 互斥且并集 = 旧全集（rw "两口互斥" 例）；孤儿状态行（category NULL）留通用层（rw LEFT JOIN 例） |
| D-5 装配 | 转正段之后、人格块之内；subject = `ownerPrimaryUserId()`；null / 空 → 零字节；读失败 → 事件 + 零字节；头部逐字 | `conversation.ts:138` 接口；`:408` 接入；`:454-474` 段函数；`prompts.ts:72` 头部（chars 38，sha `a0553be7…c22e`，B 表第 14 条） | ✅ assemble ⑨ 逐字节、⑩ 空态 `endsWith` 旧形态、失败例、owner 为 null 例 |
| D-6 事件面 | keyed {insight_id, concern_id, cycle_id, subject_user_id} / unkeyed / injected {count, subject_user_id} / read_failed；成功写入或已存在都发 | `l4.ts:700,707`；`conversation.ts:461,471` | ✅ 测试用 `exactEvents`（type 相等 + deepEqual 字段）；⑧ 证明重申两周期各发一次。**"同一事务内写 scope" 未逐字落实，见 §3 偏离 2** |
| D-7 提示词与 Canon 零改动 | 五条 sha 不变；`buildPersonaKernel` / persona TOML 不动 | `prompt.test.ts` / `prompts.test.ts` A 表绿；diff 不含 persona.ts / TOML | ✅ |
| D-8 零 schema | 不动 schema.ts、版本停 17、无迁移件 | diff 不含 schema.ts / migrations | ✅ 增补件由治理侧落档（`WO-M0-STATE-CONTRACT/amendment_017-1_2026-09-02.md`） |
| D-9 FocusSummary | `overlay_subject_user_id: string \| null`，默认 null | `l4.ts:410,438,699` | ✅ l4 "D-9 空转" 例 |

**判据 ①-⑪ 对号**：① l4-overlay ①；② l4 ②；③ l4 ③；④ l4 ④；⑤ l4 ⑤；⑥ l4 ⑥ + rw D-4 例；
⑦ l4 ⑦（`seedCyclesUpTo` 压序号，dormant 后点亮回 active，scope 行数仍 1）；⑧ l4 ⑧ + rw 幂等例；
⑨ assemble ⑨；⑩ assemble ⑩；⑪ prompt.test.ts / prompts.test.ts A 表既有断言绿。

**测试纪律核查**：四个新/改测试文件 `grep 'new Date()\|Date.now()'` 零命中（全部由 `T0` 派生）；
事件断言走 `exactEvents` / `lastEvent` / `eventNames`（名称相等），无子串 grep；
只用合成夹具（`makeStore` / `makeWritableFixture`），未打开 devstate。

## 3. 偏离与裁定

| # | 位置 | 原文 | 实际 | 裁定 |
|---|---|---|---|---|
| 1 | §2 D-2 | l4.ts 从 `'lykoi-memory/rw'` 值导入 | 执行方停工上报（纪律 8）；治理裁**路 B**（rw 正本 + shared 副本 + boundary 对拍），章程同日修订（23c65a0） | 接受；这是治理侧章程错误，非执行偏离。见 `deviation_d2_2026-09-02.md` |
| 2 | §2 D-6 括注 | "同一事务内写 scope" | `applyConclusion` 依次调 `upsertInsight` → `recordFocusInsight` → `scopeInsightSubject`，三者各自 `#tx`，**非同一事务**（执行方未列为偏离） | **接受**。理由：(a) subject 只可能来自 concerns 的 memory_scopes 行（FK 到 users）或 `ownerPrimaryUserId()`，FK 抛错在产品路径不可达；(b) 进程在第二、三写之间崩溃的窗口是微秒级，后果有界——一条 category=relationship 但无键的行，两个读口都不给（rw "两口互斥" 例已把这一形态钉为"坏数据不可见"），L4 状态机照常管它；(c) **自愈**：同一结论再次被 L4 得出时（逐字相同 → 同一 insight_id），`scopeInsightSubject` 会再次被调（⑧ 证明每次 keyed 都调），键即补上。不值得为此改 rw 的事务边界。记入增补件作为已知形态 |
| 3 | §6 报告要求 | 滤网"应只剩 prompts.ts 一条" | 实际两条：prompts.ts + prompts.test.ts（`prompt` 模式同时命中测试文件） | 非偏离，章程措辞不精确 |

## 4. 产线影响与落地

- **对当前产线为空操作**：state 库 `focus_insight_state` 17 行（active 15 / shadow 2）全部
  category=focus，无 relationship 行 → `promotedFocusInsights` 收窄后返回集不变；
  `promotedRelationshipInsights('user_001')` 返回空 → overlay 段零字节 → 人格块逐字节
  与现在相同。第一条 overlay 行要等 L4 从 `relationship_thread` 关切得出结论并过 3 周期影子期。
- **落地耦合：零迁移** → 合并后服务器树钉 main + 重启 `lykoi-cordis.service` 即生效。
  **落地后更正**：原文"不需要停机窗"不准确——manifest hash-pin 域覆盖 src，本单改了 5 个
  src 文件，须 root 重签 manifest，R-01 要求停 → 备份 → 起串行；实际形态 = E 稿去掉迁移段，
  停机约 5 秒（`LANDING-F-20260902/record.md`）。
- **合并次序**：与 `wo/fix-loop-01`（另一治理会话在途）区段不重叠，merge-tree 无冲突；
  两单谁先合都可。建议本单先合（已复核完），fix-loop 复核完再合；两次落地各一次重启，
  或等两单都合后一次重启（Kevin 定）。
- **旧债（不在本单）**：迁移后新生关切（id 11-15）无 memory_scopes 行，L4 owner 轴只见
  旧关切；relationship_thread 关切目前只有 id 5（released）。本单 KEY 推导的 owner 兜底
  正是为这条债准备的：无实体轴的关切也能键到 owner。
- **首月观察点**：`"type":"relationship_overlay_keyed"` 精确计数；30 天为 0 → D-1 判别式
  回炉（L2/L4 是否真的派生 relationship_thread 关切）。同时看 `relationship_overlay_unkeyed`
  是否出现（应为 0——owner 行在则永不走兜底）。

## 附录 A · 产线只读预检（2026-09-02，governance 账户，`sqlite3` 只读）

| 项 | 值 |
|---|---|
| mind_schema | 17 |
| focus_insight_state 按 status | active 15 / shadow 2（category 全 focus；无 relationship） |
| users owner_primary | user_001，active |
| memory_scopes table_name='insights' | 6 行（迁移前遗留，非本单写者） |
| concerns kind='relationship_thread' | 1 行（id 5，released） |
| `lykoi-cordis.service` | active；journal 近 3h 0 error/fail |
| 产线代码 | main@89b04dd（LANDING-E 15:09 钉），与本单基线代码面相同 |

## 附录 B · 治理侧复跑记录

- `scratchpad/overlay-test.log`：`npm test` 退出码 0，tests 902 / pass 891 / fail 0 / skipped 11 / cancelled 0。
- `scratchpad/overlay-test-devstate.log`：`LYKOI_DEVSTATE_DB=<devstate>/memory.db npm test` 退出码 0，902 / 902 / 0 / 0。
- `npx tsc --noEmit` 退出码 0。
- `git merge-tree $(git merge-base wo/pers-overlay wo/fix-loop-01) wo/pers-overlay wo/fix-loop-01` 退出码 0，无冲突标记。
