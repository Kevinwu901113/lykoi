# LANDING-G · 零迁移落地记录（2026-09-02 20:25 CST）

WO-FIX-LOOP-01（认知回路四处小修）落地：产线树 main@29ffab1 → **main@481e6d2**。
零迁移、零 schema 变更（mind_schema 仍 17）、零装配改动（prod.yml 在两钉点之间零
diff）；本单改了 9 个 src 文件，manifest hash-pin 域覆盖 `packages/*/src/**.ts`，须 root
重签，按 R-01 停 → 备份 → 起串行。Kevin root 亲手执行，一遍全绿，停机约 3 秒
（备份 20:24:58 → assembly up 20:25:01）。F 记录"遗留"里"与 fix-loop-01 合并后需再落
一次"即本次。

## 执行件

- 脚本 `/tmp/landing-g-fixloop.sh`，同 F 通道：治理侧写草案 → 聊天正文交全文 →
  Kevin 从 Mac `scp` 到服务器 /tmp → 校 sha → `sudo bash … | tee /tmp/landing-g-output.txt`。
  治理草案 sha256 `d7df852e1e8068ee069495f0da88343601ece141dc936d1f4c8c6fbdf023bce4`，
  窗后 ssh 钉服务器上该文件 sha 一致。
- 通道事实再次复现：治理账户上传 bundle 到服务器 /tmp 放行，上传 root 执行脚本被
  Mac 分类器拦。Mac 侧固定副本 `~/Documents/lykoi/landing-g-fixloop.sh`（仓外）。
- bundle `/tmp/lykoi-landing-g.bundle` sha256
  `188fdebe3866314aa6dffd4bdbd01ef67eeaddadbbe3ff971c55c46428c1b951`
  （`^29ffab1 main`，66,561 字节；两端 sha 一致，verify okay）。
- 与 F 稿差异四处：钉点与 bundle sha；§4 断言换本单字面量并加"prod.yml 两钉点零 diff"；
  §9 加打本次起立的 restart 线索；记账 action `landing-g-fixloop`。

## 顺序（R-01 正序，全部命中）

前验（bundle / persona sha OK、HEAD=29ffab1、schema=17、状态行 17、autonomy_runs 2553）
→ 停（watchdog 最先、备份 timer、service、pgrep 清场）→ root 窗内备份
`/root/backup-pre-fixloop-20260902T202458.tar.gz`（10,377,383 字节）→ 树落地 481e6d2 净
→ 内容断言（`wiredActionCatalog` ×1、`Symbol.for('lykoi.kernel.unwired_handler')` ×1、
`GAP_NOT_WIRED` ×1、`GROUND_FRAGMENT_CHARS = 10` ×1、wake / converse `catalog:
wiredCatalog` 各 ×1、`'autonomy_wake_retried'` ×1、`responseFormat: json_object` ×1、
`u3_cycle_tool_unwired` ×1、`groundingExempt: new Set([TOOL_CALL])` ×1、
`'--timestamp=utc'` ×1、`never_stopped` ×0、版本常量 17 ×1、无 018 迁移件、prod.yml
两钉点零 diff、无 `disabled: true`、personaToml ×2、var/state canonical）→ 库只读复核
（schema 17、行数 17 不变、integrity ok）→ chown/chmod → manifest 重签 **106** 文件
（本单新增 0 个 src 文件）+ gate OK → 起新体 + timer 回位 → 记账。

## 回执（root 脚本 §5 / §9）

| 检查 | 值 |
|---|---|
| mind_schema | 17（未动） |
| focus_insight_state 行 | 17（active 15 / shadow 2，窗前后一致） |
| autonomy_runs | 2553 |
| max focus_cycle | 24 |
| integrity_check | ok |
| NRestarts | 0 |
| 预算 09-02（UTC 日） | 273,237 tokens，续跑 |

## 窗后独立核验（治理侧 ssh，不信自报）

- `.git/HEAD` = 481e6d25ff9361558eda58ff97388ae70072de1a。
- `lykoi-cordis.service` active（ActiveEnter 20:25:00 CST），watchdog timer active，
  备份 timer active；NRestarts=0。
- 输出留档 `/tmp/landing-g-output.txt`：§0–§10 全部 OK 行齐，`gate: wrote manifest for
  106 files`、`gate: OK`、`production assembly up; services: audit=ok budget=ok heart=ok
  llm=ok lykoiLlm=ok`，零 FATAL。
- manifest 106 行；persona sha 未变（df3bc2f2…dd56）。
- governance-ops 记账行在（20:25:08，action `landing-g-fixloop`）。
- journal 对治理账户不可读（本次改从 tee 留档核验）；state 库同 F，以 root 回执为准。

## 首拍活体读数（落地后 ≈1 拍，12:25Z 起审计事件）

- **D-1 清单只列接通动作**：`organ_inventory_built.chars` 落地前 **703** → 落地后
  **309**（18 项 → 5 项的直接可见证据）。
- **D-4 重启线索**：`restart_event_recorded{code_changed:true, downtime:null}` +
  `deploy_event{head:481e6d2, downtime:null}`，**无** `restart_clue_unreadable`、无
  `negative_interval`（F 时同位置是 `never_stopped` 噪声）。噪声消失如预期，但 downtime
  仍为 null——原因见遗留第一条，是落地脚本的形态问题，不是 D-4 代码问题。
- 首拍 1 次 `autonomy_wake`，无 `autonomy_wake_failed`、无 `decision_ungrounded`；样本
  太小，D-2 / D-3 的日频变化留到次日读。

## 遗留

- **downtime 结构性测不到（新发现）**：落地脚本对 service 用 `systemctl disable --now`
  停、`enable --now` 起；单元被 disable 且 inactive 后 systemd 会把它从内存卸载，
  再 enable 时 `InactiveEnterTimestamp` 为空（窗后 `systemctl show` 实测仍为空）。所以
  F 时的 `never_stopped` 和本次的 `null` 同根：不是"从没停过"，是时间戳随单元卸载丢了。
  **落地稿 H 起改为 `systemctl stop`（保持 enabled，单元留在内存）**，watchdog timer
  照旧最先 disable；D-4 代码不动。
- 次日读数：`decision_ungrounded` 日频（09-01 为 13/47 拍）；`autonomy_wake_retried`
  出现且 `autonomy_wake_failed{error:''}` 归零；`capability_gap{reason:not_wired}` 是否
  出现及其 `wanted` 分布（她想用什么没接线的手——M5 选型的直接输入）。
- GK-14 `dispatched` 张力（信封契约）另立小单；`docs/m3_schema_registry.md:15-18` 措辞
  随 M5 改口。
- 下一单 `WO-M5-ORGAN-BROWSER`。
