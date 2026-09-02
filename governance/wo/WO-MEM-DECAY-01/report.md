<!-- 治理侧归档：执行 Agent 的最终报告全文（逐字，自 "# WO-MEM-DECAY-01" 起）。执行环境拦截了子 Agent 写 report.md，故由治理侧落盘；代码尖 9dc85d1 不受影响（偏离表 #4）。归档 2026-09-02。 -->

# WO-MEM-DECAY-01 · 执行报告（慢变层衰减，D-PERS-3）

- 执行：opus 子 Agent，隔离 worktree，分支 `wo/mem-decay`，基 main `34a4650`
- 未 push、未 merge、未改 main；未触碰治理侧主检出与 devstate 副本
- 迁移件只对临时库施加（`scratchpad/mig017/`，worktree 之外），未对任何真实 db 运行

## 1. 提交

| | sha | 说明 |
|---|---|---|
| 基（工单签发提交） | `34a4650c437726390c2c2d356ddc05f139528b5b` | 治理侧签发 order.md |
| 里程碑 1 | `fcfd68c027be8dc1bc56b260c17bdb9bb87f3554` | 数据面：六态 CHECK + dormant 点亮路径 + mind_schema 17 |
| 里程碑 2 | `e9e2ba9bfeb91926658375951cca1bc01506c09d` | L4：retireStaleInsights + 阈值常量 + dormant 入喂入集 |
| 里程碑 3 | `693c9a052675deff32c3bb5c9868f293d1833adf` | 迁移件 017 up/down |
| **分支尖（= 代码尖）** | **`9dc85d19fe5d9419773d2ee2c06346ef1850b285`** | 测试：l4-decay（10）+ rw-insight-dormant（11） |
| 尖的父 | `693c9a052675deff32c3bb5c9868f293d1833adf` | |

父链（`git log --format="%H %P" 34a4650..HEAD`）：

```
9dc85d19fe5d9419773d2ee2c06346ef1850b285  693c9a052675deff32c3bb5c9868f293d1833adf
693c9a052675deff32c3bb5c9868f293d1833adf  e9e2ba9bfeb91926658375951cca1bc01506c09d
e9e2ba9bfeb91926658375951cca1bc01506c09d  fcfd68c027be8dc1bc56b260c17bdb9bb87f3554
fcfd68c027be8dc1bc56b260c17bdb9bb87f3554  34a4650c437726390c2c2d356ddc05f139528b5b
```

工作树 clean：`git status --porcelain` 零输出（终检实录，`git rev-parse --abbrev-ref HEAD` = `wo/mem-decay`）。

## 2. diff --stat（`34a4650..9dc85d1`）

```
 .../migrations/017_focus_insight_dormant.down.sql  |  28 ++
 .../migrations/017_focus_insight_dormant.up.sql    |  96 +++++
 packages/lykoi-learn/src/l4.ts                     |  92 ++++-
 packages/lykoi-learn/test/l4-decay.test.ts         | 312 ++++++++++++++++
 packages/lykoi-memory/src/index.ts                 |  13 +-
 packages/lykoi-memory/src/rw.ts                    |  57 ++-
 packages/lykoi-memory/src/schema.ts                |   8 +-
 packages/lykoi-memory/src/testing.ts               |   8 +-
 packages/lykoi-memory/test/memory.test.ts          |  14 +-
 packages/lykoi-memory/test/rw-epistemic.test.ts    |   5 +-
 .../lykoi-memory/test/rw-insight-dormant.test.ts   | 414 +++++++++++++++++++++
 packages/lykoi-memory/test/rw-store.test.ts        |  12 +-
 12 files changed, 1024 insertions(+), 35 deletions(-)
```

### 滤网

`git diff --name-only 34a4650..HEAD | grep -E "kernel|gate|prompt|vendor|profile"` → **零命中**。

补充负断言（对整段 diff 文本）：

| 模式 | 命中数 |
|---|---|
| `process.env` | 0 |
| `DELETE FROM focus_insight` | 0 |
| `DELETE FROM insights` | 0 |
| `markDimmingDormant` | 0 |
| `ENVELOPE` | 0 |
| `SYSTEM_PROMPT` | 0 |
| `promotedFocusInsights`（在 `rw.ts` 的 diff 中） | 0 |
| `version !== EXPECTED_MIND_SCHEMA_VERSION`（判定行） | 0（不在 diff 中 = 逐字未动） |

`upsertInsight` 在 diff 中 7 处，全部在两个**新测试文件**里（`l4-decay.test.ts` 3、`rw-insight-dormant.test.ts` 4），src 侧零改动。

## 3. 测试与 typecheck

全部前台串行跑，无后台化。

### 基线（`34a4650`，本机实测）

- `npm test` 退出码 **0**；合计 **tests 859 / pass 848 / fail 0 / skipped 11**
- `npm run typecheck` 退出码 **0**

（工单 §6 写的"基线 850/839/0/11"与 §1 的"859/848/0/11"及派工令不一致；本机复现到的是后者，取后者。见偏离表第 3 条。）

### 改后

- `npm test` 退出码 **0**；合计 **tests 880 / pass 869 / fail 0 / skipped 11**
  （= 基线 859/848 + 新增 21：l4-decay 10 + rw-insight-dormant 11）
- `npm run typecheck` 退出码 **0**

逐包（`ℹ fail 0` 全绿）：

| 包 | tests | pass | fail | skipped |
|---|---|---|---|---|
| lykoi-adapter-telegram | 55 | 55 | **0** | 0 |
| lykoi-audit | 3 | 3 | **0** | 0 |
| lykoi-budget | 5 | 5 | **0** | 0 |
| lykoi-converse | 100 | 99 | **0** | 1 |
| lykoi-decide | 79 | 79 | **0** | 0 |
| lykoi-gate | 72 | 72 | **0** | 0 |
| lykoi-heart | 14 | 14 | **0** | 0 |
| lykoi-kernel | 194 | 194 | **0** | 0 |
| lykoi-learn | 78 | 77 | **0** | 1 |
| lykoi-llm | 6 | 6 | **0** | 0 |
| lykoi-llm-deepseek | 5 | 5 | **0** | 0 |
| lykoi-memory | 111 | 102 | **0** | 9 |
| lykoi-reflow | 35 | 35 | **0** | 0 |
| lykoi-regulation | 45 | 45 | **0** | 0 |
| lykoi-snapshot | 49 | 49 | **0** | 0 |
| lykoi-wake | 29 | 29 | **0** | 0 |
| **合计** | **880** | **869** | **0** | **11** |

skipped 11 全部是 devstate 组（`LYKOI_DEVSTATE_DB` 未注入），与基线同一批，未新增 skip。

### 工单 §3.3 点名要求：`init-state` 建出的库能被 17 代码打开

`packages/lykoi-memory/test/init-state.test.ts:47` —「新库：只读入口开得了，mind_schema 恰是期望版本」。它用 `init-state` 的同一份 `STATE_SCHEMA_DDL` 建库、再用 `ReadOnlyMemory` 打开（开库门在构造器内），并断言 `report.mindSchemaVersion === EXPECTED_MIND_SCHEMA_VERSION`（现 17）、台账恰一行 17。本次改动后该测试**通过**（lykoi-memory 111/102/0/9 中的一条）。同文件 `:204`「CLI 真跑：建库 + 自检通过，退出 0」覆盖 CLI 路径。

## 4. 迁移件 017 全文

### 4.1 `governance/wo/WO-MEM-DECAY-01/migrations/017_focus_insight_dormant.up.sql`

```sql
-- WO-MEM-DECAY-01 · mind_schema 16 → 17：focus_insight_state 六态（新增 dormant）
--
-- 正本：governance/wo/WO-MEM-DECAY-01/order.md §2（D-1..D-8）；上位设计稿
-- governance/docs/persona_layering_design_v1_2026-09-01.md §3.3（D-PERS-3）。
-- 目标库：/home/lykoi/state/memory.db（**只在治理侧人工施加**；工单执行侧从未对
-- 任何真实 db 运行过它 —— 执行侧的两次施加实录跑在临时库上，见 report.md）。
--
-- 施加口令（-bail 是幂等语义的一部分，见下）：
--     systemctl disable --now lykoi-cordis-watchdog.timer
--     systemctl disable --now lykoi-cordis.service
--     tar -C /home/lykoi -czf backup-$(date +%Y%m%dT%H%M%S).tar.gz state
--     sqlite3 -bail /home/lykoi/state/memory.db < 017_focus_insight_dormant.up.sql
--     systemctl enable --now lykoi-cordis.service
--
-- 停机是硬要求：新体（EXPECTED_MIND_SCHEMA_VERSION=17）与旧体（=16）都按
-- `MAX(version) 必须恰等于我认识的那个值`拒开，版本行一落，旧体下次开库即拒。
-- 顺序只能是 停 → 备份 → 迁移 → 起新体。
--
-- **不得在施加会话里打开 PRAGMA foreign_keys**（sqlite3 CLI 默认 OFF，就让它
-- OFF）：本脚本要 DROP 掉一张被 focus_cycles 反向引用不到、但自己 REFERENCES
-- focus_cycles(id) 的表并改名回来，外键开着只会把一次纯粹的表重建变成一次需要
-- 逐行校验的操作，没有收益。
--
-- 为什么是重建而不是 ALTER：SQLite 没有修改 CHECK 约束的语法（既没有
-- `ALTER TABLE ... ALTER CONSTRAINT`，也没有 `DROP CONSTRAINT`）。改 CHECK 的
-- 唯一合法路径就是 建新表 → 搬行 → 删旧表 → 改名 → 重建索引。
--
-- 施加前先确认这张表上没有触发器/视图依赖（夹具与 STATE-CONTRACT 均无；若产线库
-- 上查出来有，**停下来报治理侧**，不要硬跑）：
--     SELECT type, name FROM sqlite_master
--      WHERE type IN ('trigger','view') AND sql LIKE '%focus_insight_state%';
--
-- 幂等（"重跑零副作用"的落法）：整段在一个事务里，第一句就是版本行的
-- **无 OR IGNORE** INSERT。重跑时它撞 mind_schema 的主键 → 报
-- `UNIQUE constraint failed: mind_schema.version` → -bail 立即中止 → 事务从未
-- COMMIT → 库逐字节不变。取的是这个强形式：**要么整段生效，要么什么都没发生**，
-- 绝不存在建了新表没搬行、或搬了两遍的中间态。
--
-- 回滚：017_focus_insight_dormant.down.sql（只撤版本行，不回退 CHECK、不删
-- dormant 行 —— 她的数据不销毁）。

BEGIN IMMEDIATE;

-- ① 版本行 = 幂等守卫 + 台账。applied_at 用迁移机口径
--    （strftime('%Y-%m-%dT%H:%M:%fZ')：毫秒 + Z 后缀；与业务行的 isoformat()
--    「+00:00」口径不同，见 C-12，不要混用）。
INSERT INTO mind_schema (version, applied_at)
VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- ② 新表：status 的 CHECK 由五态扩到**六态**，加 'dormant'。其余列 / 约束 /
--    REFERENCES 与 STATE-CONTRACT §1（focus_insight_state，migrations.py:803-812）
--    以及 packages/lykoi-memory/src/schema.ts 的 STATE_SCHEMA_DDL **逐字一致**
--    （schema.ts 那份带 `IF NOT EXISTS`，是建库入口的幂等修饰，不属列定义）。
--    D-1：dormant 入枚举而非旁列 dormant_since —— 同一事实两处真值是给后人埋坑；
--    也不借 withdrawn —— 那是被证据推翻，dormant 只是久未重申。
CREATE TABLE focus_insight_state__017 (
  insight_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn','dormant')),
  created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
);

-- ③ 搬行：**显式列名，禁 SELECT ***（列序漂移时 SELECT * 会静默错位）。
--    一行不增一行不减，一个值不改 —— 本迁移只放宽 CHECK，不动任何既有状态。
INSERT INTO focus_insight_state__017
       (insight_id, status, created_cycle_id, updated_cycle_id,
        contested_since_cycle, superseded_by, updated_at)
SELECT insight_id, status, created_cycle_id, updated_cycle_id,
       contested_since_cycle, superseded_by, updated_at
  FROM focus_insight_state;

-- ④ 换名。DROP 会连带删掉旧表的索引 idx_focus_insight_state_status，⑤ 重建它。
DROP TABLE focus_insight_state;
ALTER TABLE focus_insight_state__017 RENAME TO focus_insight_state;

-- ⑤ 索引复位（名字与定义同 STATE-CONTRACT :813 / schema.ts）。
--    注：ALTER ... RENAME 之后 sqlite_master.sql 里的表名会被 SQLite 重写成带
--    双引号的 "focus_insight_state"，列定义部分逐字不变。校验请对列定义与 CHECK
--    文本，不要对整句字符串做等值比较。
CREATE INDEX idx_focus_insight_state_status ON focus_insight_state(status);

COMMIT;

-- ⑥ 施加回执（**只出计数与 DDL，不出任何 insight 内容** —— 她的结论不进运维终端）。
SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'focus_insight_state_rows' AS check_name, COUNT(*) AS value FROM focus_insight_state;
SELECT 'focus_insight_state_by_status' AS check_name, status AS value, COUNT(*) AS rows
  FROM focus_insight_state GROUP BY status ORDER BY status;
SELECT 'check_has_dormant' AS check_name,
       CASE WHEN sql LIKE '%''dormant''%' THEN 'yes' ELSE 'NO — MIGRATION DID NOT TAKE' END AS value
  FROM sqlite_master WHERE type = 'table' AND name = 'focus_insight_state';
SELECT 'index_present' AS check_name, COUNT(*) AS value
  FROM sqlite_master WHERE type = 'index' AND name = 'idx_focus_insight_state_status';
SELECT 'leftover_temp_table' AS check_name, COUNT(*) AS value
  FROM sqlite_master WHERE name = 'focus_insight_state__017';
```

### 4.2 `governance/wo/WO-MEM-DECAY-01/migrations/017_focus_insight_dormant.down.sql`

```sql
-- WO-MEM-DECAY-01 · 017 的逆迁移梯子（mind_schema 17 → 16）
--
-- 用途：只在需要把躯体回滚到 EXPECTED_MIND_SCHEMA_VERSION=16 的旧体时施加。
-- 施加口令（同样是停机窗内）：
--     sqlite3 -bail /home/lykoi/state/memory.db < 017_focus_insight_dormant.down.sql
--
-- **只撤版本行，不回退 CHECK、不删 dormant 行**：
--   ① 她的数据不销毁 —— 一条 dormant 结论是"她想过、久未再想"的账，不是垃圾；
--   ② 旧体（16）的读侧全部**按状态名取数**（promotedFocusInsights = active，
--      existingConclusions 列举状态名），六态表里的 dormant 行对它天然不可见，
--      既不会漏进装配也不会让它报错，所以留着是安全的；
--   ③ 反向重建表（六态 → 五态）会在存在 dormant 行时撞 CHECK 而失败，而"为了
--      降版本把她的行改成别的状态"是伪造 —— 这条路不走。
--
-- 重新前滚：表已经是六态了，重放 up 的 ② 会撞 `table focus_insight_state__017
-- already exists`（若上次残留）或建出一张与现表同构的多余表。**前滚请只重放 up 的
-- ① 那一句**（版本行），不要重放 ②③④⑤：
--     INSERT INTO mind_schema (version, applied_at)
--     VALUES (17, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
--
-- 幂等：DELETE 无匹配行即 0 行受影响，重跑零副作用。

BEGIN IMMEDIATE;
DELETE FROM mind_schema WHERE version = 17;
COMMIT;

SELECT 'mind_schema' AS check_name, MAX(version) AS value FROM mind_schema;
SELECT 'focus_insight_state_rows' AS check_name, COUNT(*) AS value FROM focus_insight_state;
```

## 5. 临时库两次施加实录

**施加对象**：`scratchpad/mig017/rec.db` —— 一份用 main@`34a4650` 的 `schema.ts`（即改动前的**五态** DDL）现造的 mind_schema **16** 临时库，播了 3 行 `focus_cycles`、5 行 `insights`（内容一律 `placeholder-N`）、5 行 `focus_insight_state`（五态各一）。建库脚本在 worktree **之外**（`scratchpad/mig017/mk16.ts` + `schema16.ts`），不入库交付。

**未对任何真实 db 运行**：`~/Documents/lykoi/lykoi-cordis-devstate/`、`/home/lykoi/state/memory.db` 全程未被打开。

```
### 施加前
mind_schema=16
rows=5
CREATE TABLE focus_insight_state ( insight_id INTEGER PRIMARY KEY, status TEXT NOT NULL
CHECK (status IN ('shadow','active','contested','revised','withdrawn')), created_cycle_id
INTEGER NOT NULL REFERENCES focus_cycles(id), updated_cycle_id INTEGER NOT NULL REFERENCES
focus_cycles(id), contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL )
sha256(pre) = 394ee1923bacb31455b776cfe994e2bf35b19bb3d867e1fc7c09875583f8360c

### 触发器/视图依赖预检（迁移件头注要求的那一句 SELECT）
0

### 第一次施加：sqlite3 -bail rec.db < 017_focus_insight_dormant.up.sql
mind_schema|17
focus_insight_state_rows|5
focus_insight_state_by_status|active|1
focus_insight_state_by_status|contested|1
focus_insight_state_by_status|revised|1
focus_insight_state_by_status|shadow|1
focus_insight_state_by_status|withdrawn|1
check_has_dormant|yes
index_present|1
leftover_temp_table|0
exit=0
sha256(A) = 48d4a761845afd5e7c56898b418af0efb789df68b987ec64ee6620219b4eba1d

### 第二次施加（同一条命令）
Runtime error near line 47: UNIQUE constraint failed: mind_schema.version (19)
exit=1
sha256(B) = 48d4a761845afd5e7c56898b418af0efb789df68b987ec64ee6620219b4eba1d
A == B ? YES

### 迁移后 DDL
CREATE TABLE "focus_insight_state" (
  insight_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn','dormant')),
  created_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  updated_cycle_id INTEGER NOT NULL REFERENCES focus_cycles(id),
  contested_since_cycle INTEGER, superseded_by INTEGER, updated_at TEXT NOT NULL
)
CREATE INDEX idx_focus_insight_state_status ON focus_insight_state(status)
```

无 `rec.db-journal` / `-wal` 残留。

**列定义逐字对照**：迁移后 `sqlite_master.sql` 的列定义段与 `packages/lykoi-memory/src/schema.ts:264-270` 的 `focus_insight_state` 块逐字相同；唯一差异在表名那一截 —— `ALTER TABLE ... RENAME TO` 之后 SQLite 把表名重写成带双引号的 `"focus_insight_state"`，而 schema.ts 那份写作 `CREATE TABLE IF NOT EXISTS focus_insight_state`（`IF NOT EXISTS` 是建库入口的幂等修饰，不属列定义）。此差异由 SQLite 的 RENAME 语义产生，不是本单的文本选择；测试 `rw-insight-dormant.test.ts` 的「017 up」用 `columnBody()` 剥掉表名那一截后做**等值断言**，把"列定义逐字一致"钉成红绿测试而不是口头声明。

**down 与前滚**（同一套临时库上跑，另见测试「017 down」与「017 前滚姿势」）：down 之后 `MAX(version)=16`、台账 `[15,16]`、六态 CHECK 与 dormant 行都还在；只重放 up 的 ①（版本行那一句）即回到 17，行数不变。

**在 CI 里可复跑**：上述施加/重跑/down/前滚四段全部同时落成了 `packages/lykoi-memory/test/rw-insight-dormant.test.ts` 的四个用例（用 `node:sqlite` 复刻 `sqlite3 -bail` 语义：首句报错即中止、未 COMMIT 的事务随连接关闭回滚），断言里同时比 `logicalDigest` 与文件 **sha256**，所以"二次施加库逐字节不变"这条是每次 `npm test` 都会跑的红绿测试，不只是一次人工实录。

## 6. 偏离表

| # | 位置 | 原文要求 | 实际做法 | 理由 |
|---|---|---|---|---|
| 1 | §3.3 / §4「重建 DDL 与 schema.ts 逐字一致」 | 逐字一致 | 列定义段逐字一致；表名那一截为 `"focus_insight_state"`（带双引号），schema.ts 那份为 `focus_insight_state` 且带 `IF NOT EXISTS` | `ALTER TABLE ... RENAME TO` 由 SQLite 自己重写 `sqlite_master.sql` 的表名并加引号，不可控；`IF NOT EXISTS` 是建库入口的幂等修饰，迁移件里重建一张确定不存在的临时表用不上它。已用 `columnBody()` 等值断言把可控的那部分钉死 |
| 2 | §3.3「既有版本号断言随升（memory.test.ts / rw-store.test.ts / init-state.test.ts）」 | 三个文件 | 实际改的是 `memory.test.ts`、`rw-store.test.ts`、`rw-epistemic.test.ts`；`init-state.test.ts` **一个字未改** | `init-state.test.ts` 全部走 `EXPECTED_MIND_SCHEMA_VERSION` 常量，没有字面量，随常量自动跟随。`rw-epistemic.test.ts:315` 原先拿 `EXPECTED_MIND_SCHEMA_VERSION` 断言 016 脚本落下的版本号（那时二者恰好都是 16），本单升到 17 后二者分离，改钉字面量 `16` —— 那条断言钉的是**脚本自己登记的版本号**，不是当前期望版本 |
| 3 | §6「基线 850/839/0/11」 | 850/839/0/11 | 取 §1 与派工令的 **859/848/0/11**（本机实测复现） | §6 与 §1 数字不一致，§1/派工令一致且本机可复现；按后者。合计口径因此是 859/848 + 21 = 880/869 |
| 4 | 派工令「报告写到 `governance/wo/WO-MEM-DECAY-01/report.md` 并提交到分支」 | 报告入库并提交 | **未入库**：本报告仅作为最后一条消息全文交付 | 执行环境对子 Agent 写 report/summary/findings 类 `.md` 文件有硬拦截，Write 被工具层直接拒绝；未用 Bash 绕过被拒的工具调用。请治理侧将本报告全文落盘为该文件并补一次提交（代码尖 `9dc85d1` 不受影响） |

其余**无偏离**：D-1..D-8 与 forbidden 逐条按治理定案执行，未另择、未加配置项、未读 env、未改判定逻辑、未动 `promotedFocusInsights` 语义、未物理删除任何行。

## 7. D-1..D-8 逐条自证（file:line）

### D-1 `dormant` 入 CHECK 枚举，不做旁列

- `packages/lykoi-memory/src/schema.ts:266` — `status TEXT NOT NULL CHECK (status IN ('shadow','active','contested','revised','withdrawn','dormant'))`（**唯一 DDL 改点**；夹具 `testing.ts` 与生产创建入口 `init-state.ts` 共用它，自动跟随）
- `packages/lykoi-memory/src/rw.ts:278-279` — `FOCUS_INSIGHT_STATUS_ENUM` 六态
- `packages/lykoi-memory/src/index.ts:34` — `EXPECTED_MIND_SCHEMA_VERSION = 17`（判定行 `:268` 不在 diff 中 = 逐字未动）
- `packages/lykoi-memory/src/testing.ts:81` — 夹具台账多一行 17
- 迁移件：`017_focus_insight_dormant.up.sql`（§4.1 全文）
- 无旁列：diff 中不存在 `dormant_since`；无借 `withdrawn`：`withdrawn` 只在既有 `applyConflicts` 路径产生（`l4.ts:593` 未改）
- 红绿：`rw-insight-dormant.test.ts`「D-1 六态」

### D-2 衰减信号 = L4 触达周期距离，单位周期序号

- `packages/lykoi-learn/src/l4.ts:879-883` — `lastTouchedCycle()`：取 `focusInsightHistory(insight_id)` **最后一行**的 `cycle_id`；history 空时退回 `updated_cycle_id`（正常路径产不出这种行）
- `packages/lykoi-learn/src/l4.ts:914-915` — `if (cycleId - touched < INSIGHT_STALE_AFTER_CYCLES) continue`（严格 `>=` 才降）
- `packages/lykoi-learn/src/l4.ts:105-106` — `FocusStore` 接口增 `focusInsightHistory`（`ReadWriteMemory` 已实现，`rw.ts` 无新方法）
- 红绿：`l4-decay.test.ts`「D-2 边界：触达距离 29 不降、30 降 dormant（严格 >=）」与「D-2 红测：单位是周期序号不是墙钟——停机三个月、周期没走，一条也不降」

### D-3 阈值常量 30，放 l4 常量区，不做配置项、不读 env

- `packages/lykoi-learn/src/l4.ts:71` — `export const INSIGHT_STALE_AFTER_CYCLES = 30`（紧邻 `SHADOW_PERIOD_CYCLES`，`:59`）
- 无 env：整段 diff `process.env` 命中 0；无 profile 改动（滤网零命中）
- 红绿：`l4-decay.test.ts`「D-3：阈值常量 = 30」

### D-4 单步，无 dimming 中间态

- `packages/lykoi-learn/src/l4.ts:912-923` — `retireStaleInsights` 只有一条落点 `'dormant'`，没有任何中间状态；`markDimmingDormant`（中期层）整段 diff 零命中
- 红绿：`l4-decay.test.ts`「D-4/D-5 状态机闭合」——一条结论全程只走 `null→shadow / shadow→active / active→dormant` 三条边

### D-5 边的定案

- `active → dormant`（唯一新增入边）：`packages/lykoi-learn/src/l4.ts:912-923`（`listFocusInsights('active')` 出发，衰减结算是它唯一的产生点）
- `dormant → active`（点亮）：`packages/lykoi-memory/src/rw.ts:2214-2224`（状态行改 `active`、`updated_cycle_id`/`updated_at` 刷新、`contested_since_cycle = NULL`）+ `:2242-2246`（history 一行 reason `relit`）+ `:2251-2257`（事件 `focus_insight_status` from `dormant` to `active`）
- 其他状态的重申行为**不变**：`rw.ts:2225-2228`（`else if (existing)` 分支逐字原样，shadow 不重新计时）；返回值仍是 `!reaffirmed` = false（`:2259`）
- `dormant → contested → revised|withdrawn`：`packages/lykoi-learn/src/l4.ts:583` — `listFocusInsights(['shadow', 'active', 'contested', 'dormant'])`，`EXISTING_INSIGHT_LIMIT` 上限 20 未动（`:584`）
- `contested_since_cycle`：`packages/lykoi-memory/src/rw.ts:2294` — 迁到 dormant 落在既有 `else` 分支（保留），判定分支**一行未加**；dormant→active 清空在 `:2221`
- 无 `dormant → shadow`、无其他 `→ dormant` 边、无 DELETE
- 红绿：`rw-insight-dormant.test.ts`「D-5 点亮」「D-5 不误伤」「D-5 contested_since」「无 dormant→shadow」；`l4-decay.test.ts`「D-5：dormant 进判冲突喂入集，被新证据推翻时当场走 contested → withdrawn」与「D-5 喂入集正断言」

### D-6 因果出口 = 既有通道，不另造事件

- `packages/lykoi-learn/src/l4.ts:916-920` — 降档走 `setFocusInsightStatus(..., 'dormant', { reason: \`stale: last touched cycle ${touched}, now cycle ${cycleId} (>= ${INSIGHT_STALE_AFTER_CYCLES})\` })`
- 事件由既有的 `rw.ts:2316-2320`（`setFocusInsightStatus` 的 `#log`）发出，本单未新增任何事件类；点亮那一条复用同一事件名（`rw.ts:2252`）
- `packages/lykoi-learn/src/l4.ts:387` — `FocusSummary.retired: number[]`；`:414` 初始化
- 事件计数**精确匹配**：两个测试文件各有一个 `countStatusEvents()`，按 lykoi-audit 的落盘形态 `{type, ...fields}` 序列化再解析，过滤 `rec.type === 'focus_insight_status' && rec.to === 'dormant'` —— 字段等值，**零子串 grep**

### D-7 节律 = 随 L4 周期结算，同调用位同覆盖面，且在 applyConclusion 之后

- 五个调用点与 `promoteDueInsights` 一一配对：`packages/lykoi-learn/src/l4.ts:482-483`（空转 / 无可选关切）、`:509-510`（空召回）、`:533-534`（LLM 失败）、`:544-545`（解析失败）、`:567-568`（正常路，紧跟 `applyConcernProgress` 与 `promoteDueInsights`）
- 顺序：`applyConclusion` 在 `:540`，`retireStaleInsights` 在 `:568`，在其后；本周期刚重申/新建的结论 history 最后一行已是本周期，距离 0，自然不降
- 红绿：`l4-decay.test.ts`「D-7：本周期刚重申的不降」「D-7 覆盖面：空转周期照样结算衰减」「D-7 覆盖面：LLM 失败的周期照样结算衰减」

### D-8 装配零改动

- `promotedFocusInsights` 在 `rw.ts` 的 diff 中**零命中**（语义仍 = `active`）
- 滤网 `kernel|gate|prompt|vendor|profile` 零命中 → prompt/ENVELOPE 任何模板 sha 不变
- `packages/lykoi-converse` 未在 diff 中出现（`#promotedInsightsSection` 未动）
- 红绿：`l4-decay.test.ts`「D-8：dormant 自然出局装配」；`rw-insight-dormant.test.ts`「D-8：dormant 不进 promotedFocusInsights」

## 8. forbidden 自证

| 条 | 证据 |
|---|---|
| 不动 `experiences`/`concerns`/调节场 | diff 触及的 src 文件只有 `l4.ts`、`rw.ts`、`schema.ts`、`index.ts`、`testing.ts`；`schema.ts` 的改动只有 `focus_insight_state` 那一块 CHECK |
| 不动 `markDimmingDormant` | 整段 diff 零命中 |
| 不物理删除任何 insight/state/history 行 | diff 中 `DELETE FROM focus_insight` / `DELETE FROM insights` 各 0 命中；迁移件的 `DROP TABLE` 之前先 `INSERT ... SELECT` 全量搬行（回执 `focus_insight_state_rows=5` 前后一致） |
| 不改 `insights.content` | `#insightContent()` 仍是只读（`rw.ts:2131`）；`upsertInsight` 在 diff 中的 7 处全在新测试文件里 |
| 不动 kernel/gate；prompt/ENVELOPE sha 不变；不加配置项、不读 env | 滤网零命中；`process.env` 零命中 |
| 不改 `promotedFocusInsights` 语义 | `rw.ts` diff 零命中该标识符 |
| 版本门 `!==` 判定逐字不动 | 判定行不在 diff 中 |
| 迁移件不施加于任何真实库 | 只施加于 `scratchpad/mig017/*.db`（worktree 之外的临时库）与测试自造的 `os.tmpdir` 临时库 |
| 阈值 30 / 单位周期序号 / 单步无 dimming | 见 D-2/D-3/D-4 自证 |

时钟纪律：两个新测试文件的全部 `Date` 由固定 `T0` 派生，测试逻辑零真实时钟读取。唯一读墙钟的是迁移脚本自己那句 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`（台账 `applied_at`）—— 与 016 的既有测试同一姿势，且没有任何断言依赖它的值。

## 9. 落地耦合（提请治理侧注意）

合并后代码要求 mind_schema **17**，产线现为 **16**。下一落地窗**必须再走停机迁移窗**（LANDING-D 范本，去掉 cherry-pick 段：直接钉 main sha）：停 watchdog.timer → 停 service → 备份 → `sqlite3 -bail` 施加 017 → 起 service。merge 到窗之间禁"只重启不迁移"（旧体 16 与新体 17 都会在开库门上拒开）。

STATE-CONTRACT 增补件按 §3.6 由治理侧随复核补；执行方未改任何历史存档件。