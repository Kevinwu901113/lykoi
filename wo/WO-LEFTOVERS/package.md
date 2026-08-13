# 合并包 9 · 2026-08-13 · 陈年遗留销账批 1(复核者补丁,非工单)

按 Kevin"不新开路线/新开工单,把没做完的补上"的口径,这批不派执行 Agent,
由治理侧直接补,三条全部出自历次复核的「遗留(不阻塞)」标注、至今无人认领:

| 出处 | 条目 | 本包动作 |
|---|---|---|
| WO-P2-01 复核 §五(2026-08-09) | 11 个 rollout 用例硬断言 `0o755`,工作副本 checkout 是 `0o775` → 每次全量都红 | 断言改为"属主可执行 + 任何人不得写"(`in (0o755, 0o775)` 且非 world-writable);git 的 `100755` 与部署 chmod 仍是权威,同函数原有断言未动 |
| WO-S3 复核 §四 | 一条用例物理落在 criterion 6 注释段内、语义属 criterion 7 | criterion 7 标题上移一处 |
| WO-FIX-BACKUP-01 复核 §注记 1 | 备份脚本 `sqlite3 ... 2>/dev/null` 吞掉真实 stderr,失败一律写 "(database locked)"——磁盘满会被带偏排障 | 判定仍只看退出码(语义不变),stderr 留最后一次并贴进 daily.log;实测失败路径现在给出 `Error: cannot open ...` 这类真实原因 |
| **合并包 8 落地当晚事故** | 设备启动没走"从现在起"那一支,从 id≈0 扫完整本账,把 8 月初的陈货投给了 Kevin | 根因是测试卫生:conftest 缺 `LYKOI_TELEGRAM_OUTBOX_CURSOR` 默认值 + device 夹具没 patch 新常量,C 步以 lykoi 身份跑测试时把游标(0)写进了活体。补默认值 + 补 patch + 新增回归守卫(禁止任何状态路径常量指向活体 state) |
| WO-BASE-01 §修正注记 3 的五项"待核实" | 2026-08-09 转入"后续工单范围"后无人做 | 全部核完:**`core/shadow.py` 的 `enabled()` 是全组唯一黑名单判定,配置畸形时 fail-open**(空串/笔误都会打开影子层)→ 改为与同组一致的严格判定;research_browser docstring 承诺的 attachment 注册代码不存在(潜伏缺陷,改注释并写明未来必办);integrator 注释阈值 0.7→0.9。另两项(策略 JSON 校验 / regulation 映射)核下来没问题 |
| WO-DRILL-CLEANVM-01 差距 #1/#3/#4 | 灾难手册未写 bundle 无 HEAD(真 DR 会拿到空工作树)、未写审计正本 `chattr`、persona 权限与 flags 实况写错 | 手册新增 §1.3 两条前置 + §2 第 11 项 0640→**0440** + governance flags 实况补记 |

**收益(硬数字)**:已知基线失败 **14 → 3**(11 条权限位噪音消失,只剩 2 条
shadow + 1 条 p0 approval_rules 权限)。此后每张单的复核不必再为这 11 条重新
归因,gate5 那类真信号也不再被埋。

分支 `wo/fix-outbox-cursor`(7 commits,含销账批 1/2/3 与一处事故修复,基 `wo/rewire-proactive`),
bundle:`/tmp/lykoi-merge-leftovers-20260813.bundle`。
动 tests/、docs/、scripts/ 与 **src 三个文件**(见下表第 5–6 行);
manifest 107 条数不变、三条哈希已同步,独立重算 106/107 干净
(第 107 条 `approval_rules.json` 仅 live 可读,老规矩)。
受影响的 13 个测试文件实跑 **199 passed**(含 S3 wiring 63 与 rebuild_config
的手册断言)。

> 顺序:本包**排在合并包 8(接嘴)之后**——分支就是基于它的。

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && git fetch /tmp/lykoi-merge-leftovers-20260813.bundle '+refs/heads/wo/fix-outbox-cursor:refs/heads/wo/fix-outbox-cursor' && git tag rollback-pre-leftovers01-20260813
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/fix-outbox-cursor
```

## 第 B 步 · 属主 + 统一重签(动了三个受保护源文件)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-leftovers01-20260813..HEAD | xargs -r chown lykoi:lykoi && find tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 验证收益(期望:11 条转绿,全套 199 passed)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_core_v1_m3_r1a1_rollout.py tests/test_core_v1_m3_r1b_bridge_rollout.py tests/test_core_v1_m3_r1b_v2_rollout.py tests/test_core_v1_m3_r1c_decision_activation.py tests/test_core_v1_m3_r1c_decision_code_rollout.py tests/test_core_v1_m3_r2a_code_rollout.py tests/test_core_v1_m3_r2b_execution_activation.py tests/test_core_v1_m3_r2c_r12_code_rollout.py tests/test_core_v1_m3_r2c_r1_permission_evidence_activation.py tests/test_core_v1_m3_r2c_r3_live_replay.py tests/test_deepseek_v4_compat_rollout.py tests/test_p2_s3_approval_wiring.py tests/test_rebuild_config_backup.py'
```

**需要重启五服务**(动了 `core/shadow.py` 与 `resources/research_browser.py`):

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

`shadow.enabled()` 的活体值是 `1`,严格化后行为不变;若某个 drop-in 里写的是
`true`/空串,服务会**拒绝启动并报错**——那正是这次要修的 fail-open,按报错把值
改成 `1` 即可。唯一有运行时影响的是备份脚本——
活体 cron(04:17)直接跑仓内这个文件,下一次日备份的日志行应与今天完全一样
(`... snapshot ok`);只有失败时的措辞会从 "(database locked)" 变成真实原因。

## 回滚

`git reset --hard rollback-pre-leftovers01-20260813`。无状态、无迁移。
