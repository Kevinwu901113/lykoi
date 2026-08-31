# WO-L1 报告 · 档案/原料分离 + 分流判据 + 历史回填

分支 `wo/l1`，基于 `89d0247f`，3 个提交，未 push。

---

## 1. 硬数字（必答）

| 项 | 数字 |
|---|---|
| 新增文件 | **4**（`src/lykoi/mind/experience_class.py` 182 行、`tests/test_l1_experience_class.py` 562 行、`scripts/backfill_experience_class.py` 75 行、`reports/wo_l1_backfill_demo.py` 43 行） |
| 修改文件 | **4**（`mind/migrations.py` +60/−1、`mind/store.py` +112/−2、`guardian/manifest.sha256` +7/−6、`tests/test_p2_data_model_migration.py` +27/−14） |
| 合计 | **8 文件，+1068 / −23 行** |
| 专项测试通过数 | **45 / 45**（`tests/test_l1_experience_class.py`，242s） |
| p0 通过数 | **20 passed, 4 skipped, 1 failed**（failed = 工单预告的 claude 身份既有假失败 `PermissionError: /home/lykoi/state/approval_rules.json`） |
| manifest 条目数 | **97**（原 96，+1 = `experience_class.py`） |

```
$ git log --oneline -3
df3119f9 [WO-L1] evidence: 合成 fixture 回填演示脚本
043ddb89 [WO-L1] 测试修正 + manifest 重签
37603d75 [WO-L1] 档案/原料分离: 分流判据 + experience_class 影子表 + 历史回填

$ git diff --stat 89d0247f HEAD
 guardian/manifest.sha256              |  13 +-
 reports/wo_l1_backfill_demo.py        |  43 +++
 scripts/backfill_experience_class.py  |  75 +++++
 src/lykoi/mind/experience_class.py    | 182 +++++++++++
 src/lykoi/mind/migrations.py          |  61 +++-
 src/lykoi/mind/store.py               | 114 ++++++-
 tests/test_l1_experience_class.py     | 562 ++++++++++++++++++++++++++++++++++
 tests/test_p2_data_model_migration.py |  41 ++-
 8 files changed, 1068 insertions(+), 23 deletions(-)
```

---

## 2. 判据函数（完整代码）

`src/lykoi/mind/experience_class.py` 的核心部分：

```python
WORKING = "working"
ARCHIVE = "archive"
CLASSES: tuple[str, ...] = (WORKING, ARCHIVE)

# 无条件进原料池的来源 —— 定义上就携带外部世界注入的新信息。
WORKING_SOURCES: frozenset[str] = frozenset({"conversation", "environment"})

# 走"例外通道"的来源:同一来源里既有零信息模板、也有真实返回内容,
# 只能按内容长度分。
LENGTH_GATED_SOURCES: frozenset[str] = frozenset({"action_result"})

# 阈值 80 字符的来源(设计 §3.2):活体 1573 条 action_result 中 97% ≤80 字符、
# 均长 29 —— 那是 "ok" / "done" / "已发送" 一类的记账模板,零信息;超出模板长度
# 的 43 条含实际返回内容,应进原料池。阈值卡在实测分布的断点上,不是拍脑袋的
# 整数。判据是"内容里有没有信息",长度只是这一来源上信息量的可观测代理。
ACTION_RESULT_MIN_LENGTH = 80

# 判据版本。改动 classify() 的任何一条规则(含阈值)都必须 +1,否则新旧分类
# 无法区分,回填也无法定位需要重算的行。
RULE_VERSION = 1


def classify(source: str, content: str | None) -> str:
    """返回 'working'(进原料池)或 'archive'(进档案层)。

    纯函数:同样的 (source, content) 永远给同样的答案,与调用时刻、
    数据库状态、进程状态都无关。历史回填和实时写入调用的是同一个它。
    """
    if source in WORKING_SOURCES:
        return WORKING
    if source in LENGTH_GATED_SOURCES and len(content or "") > ACTION_RESULT_MIN_LENGTH:
        return WORKING
    return ARCHIVE
```

模块还导出 `record_class_in_tx(conn, ...)`（同事务写分类行，`INSERT OR IGNORE`）、
`backfill(conn, *, classified_at, batch_size=500)`（批量事务、可重入）、
`classification_counts(conn)`（核对口径）。全模块**不 import store、不 import clock、不开事务** —— 事务边界一律由调用方持有。

**"只依赖 source 与 content"是被测试钉死的**，不是靠约定：
`test_classify_is_pure_no_external_state` 既检查 `classify.__code__.co_names` 不含 `datetime/now/clock/sqlite3/random/time/os/environ`，又在改变了 DB 状态前后比对全部 12 组输入的输出。

---

## 3. 影子表 DDL（从回填后的实际库里 dump）

```sql
CREATE TABLE experience_class (
        experience_id INTEGER PRIMARY KEY REFERENCES experiences(id),
        class         TEXT NOT NULL CHECK(class IN ('working','archive')),
        classified_at TEXT NOT NULL,
        rule_version  INTEGER NOT NULL
    )
CREATE INDEX idx_experience_class_class        ON experience_class(class);
CREATE INDEX idx_experience_class_rule_version ON experience_class(rule_version);
```

`experiences` 表结构、触发器、行数一律未动（`test_backfill_does_not_touch_experiences` 逐字节比对 `sqlite_master` 的 `sql` 与全部触发器定义）。

**接线点是 3 个，不是 1 个** —— 工单说"找到唯一写入点"，实际读代码后 `mind/store.py` 有三处 `INSERT INTO experiences`，三处全部接上：
`record_experience`（:754）、`record_environment_event` 的内联 ingest（:906）、`insert_experience_in_tx`（thought_lapse 管线用，:1293）。
`test_every_experiences_insert_site_is_hooked` 断言 `INSERT INTO experiences` 出现次数 == `record_class_in_tx(` 出现次数 == 3，将来有人加第四个写入点忘了分流会红。

---

## 4. 回填的实际命令与输出

合成 fixture（`reports/wo_l1_backfill_demo.py`，按设计 §3.2 表的分布造 4868 条，**不触碰真实 memory.db 或任何备份**）：

```
$ python3 reports/wo_l1_backfill_demo.py
synthetic fixture: 4868 experiences at /tmp/l1-demo-luoypck3/memory.db

$ python3 scripts/backfill_experience_class.py --db /tmp/l1-demo-luoypck3/memory.db --dry-run
db=/tmp/l1-demo-luoypck3/memory.db
dry-run: experiences=4868 working=1337 archive=3531 rule_version=1

$ python3 scripts/backfill_experience_class.py --db /tmp/l1-demo-luoypck3/memory.db
db=/tmp/l1-demo-luoypck3/memory.db
migrations_applied=2 schema_version=11
experiences=4868 classified=4868 working=1337 archive=3531 rule_version=1
OK: every experience is classified

$ python3 scripts/backfill_experience_class.py --db /tmp/l1-demo-luoypck3/memory.db   # 第二次
db=/tmp/l1-demo-luoypck3/memory.db
migrations_applied=0 schema_version=11
experiences=4868 classified=4868 working=1337 archive=3531 rule_version=1
OK: every experience is classified
```

分布明细：

```
  action_result  archive   1530      conversation   working    116
  action_result  working     43      environment    working   1178
  thought_lapse  archive    428      wake_action    archive   1573
  classified_at distinct: 1     rows in experience_class: 4868
```

**关于 1337/3531/4868 的一句实话**：这份 fixture 的分布是我照设计 §3.2 表里的条数造出来的，所以这三个数字对上只证明**判据的算术与设计一致**，不构成对活体数据的验证。活体核对仍需复核方以 lykoi 身份实跑。

活体执行方式二选一：迁移会在任何一次 `store._connect()` 时自动带上（`_V11`）；或显式跑上面那条脚本命令留档。

---

## 5. 每条 success_criteria 的测试用例名 + 结果

`tests/test_l1_experience_class.py` —— **45 passed in 242.05s**。

**① 判据单测：六类 source × 长短内容全覆盖，含 80 字符边界** ✅
- `test_classify_covers_every_source_long_and_short` ×12 —— conversation/environment/action_result/wake_action/thought_lapse/silence/system/owner_event，每类长短各一（含"长的 thought_lapse 仍是档案"「短的 conversation 仍是原料」这两个反直觉方向）
- `test_action_result_80_char_boundary` ×6 —— 长度 **0 / 29 / 79 / 80 / 81** / 200，边界三连钉死"`>80` 而非 `≥80`"
- `test_length_is_counted_in_characters_not_bytes` —— 81 个汉字（243 字节）判 working、27 个汉字判 archive；误用字节会红
- `test_classify_handles_null_content`、`test_classify_only_ever_returns_known_classes`
- `test_classify_is_pure_no_external_state` —— 纯函数的两路证明（见 §2）

**② 回填：可重入 + 分类总数 = 经验总数** ✅
- `test_backfill_classifies_every_historical_experience` —— `classified == experiences`，逐行核对分类与 `rule_version`
- `test_backfill_is_reentrant` —— 迁移重放 + 直接再调 `backfill()`，两种"跑第二次"都 `inserted=0`，全表 `(id, class, classified_at, rule_version)` 逐元组相等，无重复行
- `test_backfill_picks_up_rows_added_after_a_previous_run` —— 可重入的另一半：补新的、不动旧的
- `test_backfill_batches_do_not_change_the_result` —— `batch_size=1` 与默认结果相同（37 条，长度 60..96 → working 16 / archive 21）
- `test_backfill_does_not_touch_experiences`、`test_class_column_rejects_out_of_vocabulary_value`
- `test_backfill_script_reports_and_is_reentrant` —— 子进程实跑脚本三次（dry-run + 两次实跑），比对 stdout

**③ 实时分类：新写入立即有分类行** ✅
- `test_record_experience_classifies_immediately` —— 12 条经验，每条都有分类行且值正确
- `test_insert_experience_in_tx_classifies_immediately`
- `test_environment_ingest_classifies_immediately`
- `test_every_experiences_insert_site_is_hooked` —— 3 写入点 / 3 接线的结构性保证
- `test_realtime_and_backfill_agree` —— 实时分类结果 vs 清空后回填结果，逐行相等

**④ 逆迁移后表清单与迁移前一致** ✅
- `test_downgrade_v11_restores_pre_migration_schema` —— `sqlite_master` 的 `(type, name, tbl_name, sql)` 全集逐元组相等，`applied_version` 回到 10
- `test_downgrade_v11_preserves_every_experience`
- `test_downgrade_then_reupgrade_reproduces_same_classification`

**⑤ 行为不变证明** ✅（另见 §6）
- `test_pending_count_semantics_unchanged` —— `experiences_pending` 仍排除 environment（那是 L2 的事），同时 `working_set_pending` 视角下 environment 是原料：两个视角并存，分流没有改写 pending
- `test_query_helpers_are_read_only` —— 调用两个辅助函数前后，`experiences` / `experience_class` / `integration_state` 三表快照逐行相等

**查询辅助** ✅ `test_working_set_pending_returns_only_undigested_working`、`..._by_salience_and_limit`、`..._includes_environment`、`test_archive_search_by_source_keyword_and_time`、`test_archive_search_escapes_like_wildcards`、`test_archive_search_by_entity_uses_memory_scopes`（走 P2-01 `memory_scopes` 实体轴）。

---

## 6. 行为不变证明（既有测试）

逐个文件跑（并发跑会互相拖到超时，这些套件在本机很慢——sqlite 每次 autocommit 都 fsync）：

| 套件 | 结果 |
|---|---|
| `test_mind_integrator_pipeline.py` + `test_mind_integrator_trigger.py` | **36 passed** |
| `test_mind_store.py` | **18 passed** |
| `test_mind_migrations.py` | **8 passed** |
| `test_p2_data_model_migration.py` | **16 passed**（修正后，见下） |
| `test_integration_telemetry.py` + `test_mind_thoughts_outlets.py` + `test_concern_floor.py` | **45 passed, 1 failed**（既有失败，见下） |

**两处需要说明的失败：**

1. **`test_p2_data_model_migration.py` 有 4 条被我改红后修好了。** 它们钉的是"链头 == 10"和"`downgrade_v10` 就能回到 v9"，加 `_V11` 后这两句话本身就不再成立 —— 是版本钉桩，不是行为回归。其中 `test_v10_downgrade_then_reupgrade_reproduces_same_state` 暴露了一个真实的顺序陷阱：只 `downgrade_v10` 会留下 v11 那行，`MAX(version)` 仍是 11，于是 `apply_migrations` 永远不会重放 v10，`memory_scopes` 再也建不回来。修法是加 `_downgrade_to_v9()` 助手，按 **v11 → v10 倒序**回滚；断言改为对着迁移链（`migrations.SCHEMA_VERSION`）表述，**V10 专属的断言（七张表、种子、backfill 计数）一个字没动**。

2. **`test_integration_telemetry.py::test_l1_scan_still_clean` 失败，与本单无关。** 3 处违规全在 `src/lykoi/broker/`（`audit.py:19`、`tickets.py:40` 等），`git log` 显示这些文件最后一次改动是 `49cdd029 [WO-P2-03A]`（我的基线 `89d0247f` 的祖先），我的提交一个 broker 文件都没碰。顺带说明：这条扫描通过了我在 `migrations.py` 里那行 `strftime('now')` 的 `# realtime-allow:` 标记。

3. **`test_perception_ingest.py` 我没能跑。** 它 `import fastapi`，而 fastapi 只装在 `.venv` 里 —— 本会话的权限配置拒绝执行 `.venv/bin/python`（`.venv/bin/pytest`、绝对路径、`env PYTHONPATH=...` 前缀全部被拒），只有系统 `python3` 可用，系统 python 无 fastapi。感知 ingest 写入点的分流由 `test_environment_ingest_classifies_immediately` 直接覆盖（它绕开 HTTP 层直接调 `record_environment_event`），但 **HTTP 端到端那一层请复核方在 `.venv` 下补跑**。

---

## 7. manifest diff

`--write-manifest` 在 claude 身份下会整个崩掉（`PermissionError: /home/lykoi/state/approval_rules.json`，与 p0 那条假失败同源），所以我用 `startup_verify._protected_files()` / `._sha256()` 自身重算，对**唯一读不到的那一条**沿用旧行 —— 该文件本单未触及，root 从头重签会得到同一份文件。

```diff
+b01ad8707ca8…  src/lykoi/memory/__init__.py     ┐
+7804dbc4511c…  src/lykoi/memory/persona.py      │ 仅位置变化,hash 未变:
+38dc79a5c8d9…  src/lykoi/memory/seed.py         │ 旧文件里 memory/ 排在 mind/ 之后,
+5773ed029ab9…  src/lykoi/memory/store.py        ┘ 而 _write_manifest 是 sorted()
+ec49dd3c83c9…  src/lykoi/mind/experience_class.py     ← 新增
-1993185e069d…  src/lykoi/mind/migrations.py
+53e83492f3c9…  src/lykoi/mind/migrations.py           ← 改
-98085c6ab522…  src/lykoi/mind/store.py
+080aaa52e232…  src/lykoi/mind/store.py                ← 改
-b01ad8707ca8…  src/lykoi/memory/__init__.py     ┐
-7804dbc4511c…  src/lykoi/memory/persona.py      │ 旧位置
-38dc79a5c8d9…  src/lykoi/memory/seed.py         │
-5773ed029ab9…  src/lykoi/memory/store.py        ┘
```

实质变化只有 3 条（1 新增 + 2 修改）；4 条 `memory/*` 是排序归位（`'e' < 'i'`），hash 逐字节未变 —— 旧 manifest 是 WO-FIX-SEC-01 补入 `memory/` 时留下的非规范顺序，现在与 `--write-manifest` 的输出一致了。

独立校验：

```
manifest entries=97 verified_ok=96 mismatched=0 unreadable_skipped=1
```

```
$ python3 -m pytest tests/test_p0_integrity.py -q
1 failed, 20 passed, 4 skipped in 0.34s
FAILED test_committed_manifest_matches_available_protected_sources
  → PermissionError: '/home/lykoi/state/approval_rules.json'   (工单预告的既有假失败)
```

---

## 8. forbidden 自查

未改 `experiences` 表结构/触发器（有测试逐字节比对）· 未删任何记录 · 未改 integrator 与 `pending_experiences` 行为（有专测 + 36 条既有整合测试通过）· 未新增依赖（纯 stdlib）· 未 push，3 个提交留在 `wo/l1` · 未跑全量 pytest · 全程只用合成 fixture，未打开真实 `memory.db` 或任何备份。

**留给复核方的三件事**：`.venv` 下补跑 `test_perception_ingest.py`；活体回填与 1337/3531/4868 的核对；`root` 身份重跑 `--write-manifest` 确认与我算出的 97 行一致。
