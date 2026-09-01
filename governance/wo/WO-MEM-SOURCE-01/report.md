# WO-MEM-SOURCE-01 · 执行报告归档（2026-09-01）

> 执行 Agent（opus）一次性报告。治理侧两处处理，均在此声明：① 还原会话
> 转录的 HTML 实体转义（序列化伪迹）；② §四原为迁移脚本全文照录，归档改为
> 要点+指向 migrations/ 文件正本（脚本随分支入库，避免双份漂移；复核已核
> 对文件与报告所录逐字一致）。其余逐字未动。复核记录见同目录 review.md。

## WO-MEM-SOURCE-01 执行报告

分支 `wo/mem-source`，工作树 `/private/tmp/claude-501/-Users-wukevin-lykoi/e0991a0a-2b0d-4614-93b6-0e37476de6d3/scratchpad/wo-mem-source`，base `1eab7e8`。未 push、未合并、未触碰 `/Users/wukevin/Documents/lykoi/`。`npm ci` 已在本树装依赖。

---

### 一 · 侦查段实证（行号均为 base `1eab7e8`）

**1. mind_schema 版本机制**

- `packages/lykoi-memory/src/index.ts:22` — `export const EXPECTED_MIND_SCHEMA_VERSION = 15`
- `packages/lykoi-memory/src/index.ts:205-208` — 只读入口判定：`if (version !== EXPECTED_MIND_SCHEMA_VERSION)` 抛 `mind_schema version X != expected Y; the new body must not read a schema it does not understand`
- `packages/lykoi-memory/src/index.ts:201` — `mind_schema` 表缺席另有一条 `cannot read mind_schema from this database` 分支
- `packages/lykoi-memory/src/rw.ts:346-349` — 读写入口同一道门，文案 `refuse to open for writing (WO-M0-STATE-CONTRACT §1.0)`
- 版本取值口径：`SELECT MAX(version) FROM mind_schema`（WO-M0-STATE-CONTRACT report §1.0，`applied_version()`）；`applied_at` 迁移机口径 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`（migrations.py:1148），与业务行 isoformat `+00:00` 口径不同（C-12）

判定是**严格相等**，双向拒开（低于与高于都拒）。

**2. experiences 现行 DDL**（`packages/lykoi-memory/src/testing.ts:85-106`，`STATE_FIXTURE_DDL`，与 STATE-CONTRACT report §1.2 逐字一致）

- 列：`id, ts, source, content, salience, related_concern_id, integrated, integration_id`
- `source` 八值 CHECK：`conversation, wake_action, action_result, silence, owner_event, system, thought_lapse, environment`
- 索引 `idx_experiences_integrated`
- 两条 append-only 触发器：`experiences_no_delete`（禁删）与 `experiences_immutable_columns`（禁改 id/ts/source/content/salience/related_concern_id，`integrated` 只许 0→1 一次）。**该触发器不列 `epistemic`**，所以回填 UPDATE 合法，触发器文本无须改动（R-06 保持）。

**3. 全部 experiences 写入调用点（file:line + 渠道值）**

| 位置 | 渠道值 | 说明 |
|---|---|---|
| `packages/lykoi-reflow/src/index.ts:282` | `wake_action` | 自主动作落笔 |
| `packages/lykoi-reflow/src/index.ts:419` | `action_result` | 动作结果 |
| `packages/lykoi-reflow/src/index.ts:504` | `silence` | SA-70 contact 超时 |
| `packages/lykoi-reflow/src/index.ts:530` | `silence` | SA-68/69 异常沉默 |
| `packages/lykoi-reflow/src/index.ts:597` | `conversation` | 对话回合回流（入站/她收到的） |
| `packages/lykoi-converse/src/index.ts:253` | `conversation` | 未送达 sink（她自己产出、未送达） |
| `packages/lykoi-memory/src/rw.ts:1112` | `thought_lapse` | `#abandonInTx` 直写 SQL，**绕过 `recordExperience`** |
| `packages/lykoi-memory/src/rw.ts:400` | 参数化 | `recordExperience` 唯一 INSERT |
| （测试夹具）`lykoi-converse/test/fixture.ts:105`、`lykoi-memory/test/rw-triggers.test.ts:60/76/78`、`lykoi-snapshot/test/read.test.ts:60` | — | 非生产写入点 |

补充实证：`owner_event` / `system` / `environment` 三渠道在新体**没有任何生产写入方**（只存在于类型与 CHECK 里，活体 Python 写过；environment 归 M5 感知器官）。写路径实际只覆盖 5 个渠道值 + 1 个直写点。

**4. 迁移机制选择：版本升格 15 → 16（不是裸 ALTER TABLE）**

理由（基于上述实证）：门是对单一常量的严格相等判定，其自述目的是"新体不得读它不认识的 schema"。若只 ALTER 不升版本，则会存在两个物理 schema 都自称 15 —— 门会放行一个没有 `epistemic` 列的库，随后在 `recentExperiences`/`INTAKE_CLAUSE` 上崩在 `no such column: epistemic`，正是这道门要防的事。升格保持**判定逻辑逐字节不动**，只改登记的那个数字（= forbidden 第 5 条明确允许的"仅登记一个新版本号"）。另：`docs/deploy.md §13` 实证本仓库**没有生产 DDL 入口**（Python 活体 `migrations.py` 已退役），所以版本台账此后由治理侧人工施加本次交付的脚本推进。

---

### 二 · diff 摘要（`git diff --stat 1eab7e8..HEAD`）

```
 docs/deploy.md                                     |   7 +-
 .../migrations/016_experiences_epistemic.down.sql  |  20 +
 .../migrations/016_experiences_epistemic.up.sql    |  71 ++++
 packages/lykoi-converse/src/index.ts               |   6 +-
 packages/lykoi-learn/src/l1.ts                     |   2 +-
 packages/lykoi-memory/src/index.ts                 |  75 +++-
 packages/lykoi-memory/src/rw.ts                    | 126 ++++++-
 packages/lykoi-memory/src/testing.ts               |  16 +-
 packages/lykoi-memory/test/memory.test.ts          |  17 +-
 packages/lykoi-memory/test/rw-epistemic.test.ts    | 408 +++++++++++++++++++++
 packages/lykoi-memory/test/rw-store.test.ts        |  10 +-
 packages/lykoi-reflow/src/index.ts                 |  27 +-
 12 files changed, 746 insertions(+), 39 deletions(-)
```

kernel / gate / decide / wake / llm / snapshot / regulation / heart / budget / audit / adapter-telegram 一个字节未动；prompt 与 ENVELOPE 模板未动（`lykoi-gate` 72/72、`lykoi-converse` 99 pass 的 sha 钉面全绿）。另已实证 `l2.ts:538-566` 的 `buildPayload` 按显式字段取数，新列不可能漏进整合 prompt。

---

### 三 · 实现要点

**数据轴（`packages/lykoi-memory/src/index.ts`）**
- `EXPECTED_MIND_SCHEMA_VERSION = 16`（index.ts:31），判定代码逐字未动。
- 新增 `EpistemicStance` 六值类型（index.ts:140）、`EPISTEMIC_STANCES`（:144）、`NON_FACTUAL_EPISTEMIC = ['imagined','simulated']`（:153）。
- `factualEpistemicClause(alias)`（index.ts:162）生成 `(alias.epistemic IS NULL OR alias.epistemic NOT IN ('imagined','simulated'))`。`IS NULL OR` 半句是硬要求：SQL 三值逻辑下 `NULL NOT IN (...)` 求值为 NULL 而非真，缺它会把全部未回填旧行一并饿死。
- `ExperienceRow` 增 `epistemic: EpistemicStance | null`（:177）；`recentExperiences` 取列 + 过滤（:343/:355）。

**写路径（`packages/lykoi-memory/src/rw.ts`）**
- `deriveEpistemic(source, direction?)`（rw.ts:111）逐字实现设计稿 §3.1：`wake_action|action_result→executed`、`owner_event→user_reported`、`silence|environment|system→observed`、`thought_lapse→inferred`、`conversation` 按方向劈（`outbound→executed`，缺省/`inbound→user_reported`）；未知渠道抛 `ValueError`。推导**永不**产出 `imagined|simulated`。
- `recordExperience` opts 增 `epistemic?` 与 `conversationDirection?`；`opts.epistemic ?? deriveEpistemic(...)`（rw.ts:468）—— 虚构地位只能由写入方显式声明。
- `#abandonInTx` 直写点补轴 `deriveEpistemic('thought_lapse')`（rw.ts:1210）。
- 遥测载荷**刻意不动**：`mind_experience` 仍是 `{id, source, salience, pending}`（`rw-w4.test.ts:45` 做精确 `deepEqual`，加字段即红），代码里留了注释说明。

**晋升铁律（本波只落"排除"，带标引用归后续工单）** —— 三条事实性供给全部加过滤：
- 快照：`recentExperiences`（只读孪生 index.ts:343 + 读写 rw.ts:949）
- 整合取料/触发闸：`INTAKE_CLAUSE`（rw.ts:259-260），`intakePending` 与 `countIntakePending` 共用
- L3 检索：`relevanceCandidateRows`（rw.ts:1857）

**上游透传**
- `lykoi-reflow` 的 `ReflowStore.recordExperience` 与导出的 `recordExperience` opts 加宽为纯透传（不在此层推导）。
- `lykoi-converse/src/index.ts:253` 未送达 sink 声明 `conversationDirection: 'outbound'`（那是她自己产出的消息）。

**夹具（`packages/lykoi-memory/src/testing.ts`）** 描的是**迁移后**物理 schema：`mind_schema` 台账两行（15、16），`experiences` 末列 `epistemic TEXT CHECK (... IS NULL OR ... IN (六值))`，列位与 CHECK 文本与 up 脚本逐字对齐。

---

### 四 · 迁移脚本

交付于 `governance/wo/WO-MEM-SOURCE-01/migrations/`（up/down 两件，均从未对
任何真实 db 施加；全文见文件本体，此处不复述——文件即正本）。要点：

- **up（15→16）**：单事务；第一句为无 OR IGNORE 的版本行 INSERT =幂等守卫
  （重跑撞主键 → `-bail` 中止 → 事务未 COMMIT → 库逐字节不变，"要么整段生效
  要么什么都没发生"）；ALTER 加 `epistemic TEXT CHECK(六值或 NULL)`；存量
  **渠道级**回填（CASE source 映射逐字 §3.1，conversation 一律默认
  user_reported 不猜方向；无任何行会被回填成 imagined/simulated；
  `WHERE epistemic IS NULL` 对已回填行免疫）；施加回执只出计数不出行内容。
  施加口令含停机窗硬顺序：停 watchdog+service → 备份 → 迁移 → 起新体。
- **down（16→15）**：只撤版本行，不删列不清值（她的数据不销毁；旧体按列名
  显式取数，表尾多一个不认识的可空列无害）；重新前滚时只重放 up 的①③两句。

---

### 五 · 全量测试数字（前台串行，无后台挂起）

`npm test` 退出码 **0**（基线亦 0）。

| 包 | 基线 tests/pass/fail/skip | 修改后 tests/pass/fail/skip |
|---|---|---|
| lykoi-adapter-telegram | 55/55/0/0 | 55/55/0/0 |
| lykoi-audit | 3/3/0/0 | 3/3/0/0 |
| lykoi-budget | 5/5/0/0 | 5/5/0/0 |
| lykoi-converse | 100/99/0/1 | 100/99/0/1 |
| lykoi-decide | 79/79/0/0 | 79/79/0/0 |
| lykoi-gate | 72/72/0/0 | 72/72/0/0 |
| lykoi-heart | 14/14/0/0 | 14/14/0/0 |
| lykoi-kernel | 194/194/0/0 | 194/194/0/0 |
| lykoi-learn | 68/67/0/1 | 68/67/0/1 |
| lykoi-llm | 6/6/0/0 | 6/6/0/0 |
| lykoi-llm-deepseek | 5/5/0/0 | 5/5/0/0 |
| **lykoi-memory** | **80/71/0/9** | **91/82/0/9** |
| lykoi-reflow | 35/35/0/0 | 35/35/0/0 |
| lykoi-regulation | 45/45/0/0 | 45/45/0/0 |
| lykoi-snapshot | 49/49/0/0 | 49/49/0/0 |
| lykoi-wake | 29/29/0/0 | 29/29/0/0 |
| **合计** | **839/828/0/11** | **850/839/0/11** |

差异解释：唯一变化在 `lykoi-memory`，+11 tests / +11 pass，全部来自新增文件 `rw-epistemic.test.ts`。skipped 11 无变化（memory 9 条 devstate 组 + converse 1 + learn 1，均因 env 未注入而 skip）。无任何既有用例转红或转 skip。

`npm run typecheck` 退出码 **0**，tsc 零诊断（输出只有 npm 的两行 banner）。

---

### 六 · 新增测试点名清单（`packages/lykoi-memory/test/rw-epistemic.test.ts`，11 条，全绿）

1. `§3.1 映射表逐渠道各一：deriveEpistemic 八渠道 + conversation 按方向劈`
2. `默认推导落库：八渠道各写一条，epistemic 逐条精确匹配映射表`
3. `六值写读回：显式覆盖逐值落库；库层 CHECK 拒非法值`
4. `显式覆盖：contemplate 类产物可标 imagined，渠道轴照旧是 wake_action`
5. `thought_lapse 内部写入点（_abandon_in_tx）也带轴：inferred`
6. `晋升铁律：imagined|simulated 不进快照/整合/检索三条事实性供给（对照组四值全进）`（红/绿 + 对照组同题）
7. `NULL 旧行兼容：016 之前的行读回 null，且三条供给通道照常供给`（含"半句过滤 vs 全句过滤"的三值逻辑证明）
8. `迁移件 016 up：加列 + 渠道级回填 + 登记版本 16（不做内容级重分类）`
9. `迁移件 016 up 重跑：零副作用（版本行撞主键即中止，库逐字节不变）`
10. `迁移件 016 up 回填句自身幂等：不动已有值（含新体写下的 imagined 行）`
11. `迁移件 016 down：只撤版本行，列与值不动；重跑零副作用`

迁移件类用例的施加对象一律是测试当场造的临时 db（`makePre016Db()`：mind_schema=15 + 016 之前的 experiences DDL + 每渠道一行合成数据），`applyScript()` 复刻 `sqlite3 -bail` 语义（出错即中止并回滚未提交事务）。

同时改写（非新增）：`memory.test.ts` 版本门用例改为 `makeFixture(15)` 期望 `/mind_schema version 15 != expected 16/` + `makeFixture(17)` 双向拒开；`rw-store.test.ts` 写面门同题改版。

---

### 七 · 提交

单个 commit，分支尖：

- **`688e9d76a78f4e8132857ab046f6c9588e239575`**（短 `688e9d7`），标题 `WO-MEM-SOURCE-01：记忆来源 epistemic 第二轴（mind_schema 15 → 16）`
- `git status` 干净，未 push、未合并。

---

### 八 · 偏离与申报（逐条）

1. **STATE-CONTRACT §1.2 未修订**。设计稿把 experiences DDL 正本挂在 WO-M0-STATE-CONTRACT 的 report 里，那是已结工单的存档件，order.md 的 scope 未点名它，故未改。§3.1 映射表的可执行正本此后有两份逐字副本：`deriveEpistemic`（rw.ts:111）与 up 脚本的 CASE。是否补一份 §1.2 增补件请治理侧裁定。
2. **`packages/lykoi-converse/src/index.ts:253` 增了 `conversationDirection: 'outbound'`**。未送达消息是她自己产出的，按 §3.1 必须落 `executed`；不加这个参数会默认落 `user_reported`（错账）。这是 order scope 之外的最小必要改动，明确申报。
3. **`lykoi-reflow` 的 `ReflowStore.recordExperience` 与导出 wrapper 的 opts 加宽**（纯透传，无推导、无默认值），仅为让上述方向参数与显式覆盖能穿过单写者入口。
4. **`countPendingExperiences` 刻意未加过滤**（rw.ts:903）。它是账面口径（Python 逐字对应物），不是供给口径；铁律落在 `INTAKE_CLAUSE` / `recentExperiences` / `relevanceCandidateRows` 三处。代价：虚构行会把这个计数抬高，但它不决定任何一条经验是否进整合。已在代码注释里写明该取舍。`latestExperienceTs` 同理未动（去重标记，不是供给）。
5. **四处一个数字的陈旧引用已同步**（超出 order scope 的文档面改动，逐条申报）：`docs/deploy.md`（原称接管库版本 15 并指向 `EXPECTED_MIND_SCHEMA_VERSION`，现改为"期望 16、接管的 15 库须先在停机窗施加 016，否则新体开库即拒"）、`packages/lykoi-learn/src/l1.ts:29`（15→16）、`packages/lykoi-memory/src/index.ts` 与 `rw.ts` 两处 `#assertSchemaVersion` 的 docstring（写死的 15 改为指向常量）。
6. **`docs/m1_blueprint.md:52` 的 `mind_schema=15 断言` 未改**：那是 M1 波次的历史实测记录，不是现行契约陈述，改它等于改历史。申报待裁。
7. **夹具语义变更**：`STATE_FIXTURE_DDL` 现在描的是**迁移后**物理 schema，`mind_schema` 台账因此有两行（15 与 16）。全新造库者按夹具建库即已是 16，无须再施加 016。
8. **devstate 组的连带后果**：`memory.test.ts` 那 9 条 devstate 用例现在要求副本是 16。若治理侧拿一份未施加 016 的 15 版副本注入 `LYKOI_DEVSTATE_DB`，它们会红在构造器拒开上——这正是版本门的设计意图，但复核时若要跑 devstate 组，请先对副本施加 016。本次运行环境未注入该 env，9 条照旧 skip。
9. **幂等取的是强形式**：SQLite 无条件 DDL，up 脚本重跑会在版本行主键上撞 UNIQUE 并被 `-bail` 中止（库逐字节不变），而不是"跳过已完成的步骤继续"。已在脚本头与用例 9 里写明。
10. **迁移脚本未施加于任何真实 db**：包括 `var/` 下样本；测试只对当场造的临时库施加。
11. **git 身份**：本工作树无 `user.name/user.email` 配置，首次 commit 报 `empty ident name`。以 `git -c user.name="Wu Kevin" -c user.email="wukevin@WudeMacBook-Pro.local"`（与该分支既有 commit 的 author 逐字一致）单次提交，未写任何 git 配置文件。
12. **无停工事项**；forbidden 五条无一触碰（`source` 八值 CHECK 与 `ExperienceSource` 类型未动；无内容级重分类/回填，存量 conversation 一律按渠道默认取 `user_reported` 而非猜方向；kernel/gate 与 prompt/ENVELOPE 未动；"拒开"判定语义逐字未动，只登记了一个新版本号）。
