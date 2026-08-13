# 合并包 10 · 2026-08-13 深夜 · 事故修复 + BASE-01 五项核查产出

**前提**:合并包 8(接嘴)与 9(销账批 1–2)均已在活体。本包是它们之上的增量,
分支 `wo/fix-outbox-cursor`(基 `wo/rewire-proactive`,含已合并那几个 commit,
git 只会带进新的三条),bundle:`/tmp/lykoi-merge-leftovers-20260813.bundle`
(已重新生成,覆盖同名旧文件)。

## 内容(五条)

**① 事故修复:陈货被投给你了,根因是测试卫生。**
合并包 8 落地当晚实测:设备启动**没有** `chat_outbox_cursor_initialized`,
却从 id≈0 一路扫到 42,把 8 月初的 followup 投了出去——工单 §forbidden 第 4 条
(陈货永不投递)被破。device 的逻辑没错,错在两处隔离缺口:
`tests/conftest.py` 的路径默认表缺 `LYKOI_TELEGRAM_OUTBOX_CURSOR`,
`tests/test_telegram_device.py` 有四个用例真跑 `run_forever` 而其夹具没 patch
新增的 `OUTBOX_CURSOR_PATH`。**合并包的 C 步是以 lykoi 身份在活体仓里跑测试**,
于是测试把游标(值 0)写进了活体 `/home/lykoi/state/telegram_outbox.cursor`,
D 步重启的设备读到它,首启那一支根本没机会执行。
修:补 conftest 默认值(带事故注释)+ 补夹具 patch + 新增回归守卫
`test_no_state_path_constant_points_at_the_live_state_dir`(守的是这一类:
凡测试期用到的状态路径常量都不许指着活体 state 目录)。
**活体游标现已是 42,不会再投陈货;本包是防复发。**

**①b 同类缺口另有两个,一并补上,并把守卫升级成守一类。**
审计全仓(101 个 `LYKOI_*` 变量、28 处默认落在 `/home/lykoi/state` 的路径常量)
后发现还漏两条,都不无害:`LYKOI_PROACTIVE_CHAT_LEDGER` 是**她主动开口的预算
账本**(日 1 条/冷却 6h,测试写它 = 篡改她的配额),`LYKOI_TELEGRAM_CURSOR` 是
入站长轮询游标(测试写它 = 让她重放或漏掉你的消息)。守卫因此从"钉四个常量"
改成**静态扫描**:凡这类常量在测试期没被 conftest 改道就失败——以后新增忘补,
在合并前被拦下,而不是等它去写活体。自证不空转:正则命中 28 处,
抽掉一条默认值做变异测试立刻变红。

**② 真缺陷:`core/shadow.py` 的 `enabled()` 在配置畸形时 fail-open。**
它是全组唯一用黑名单判定的开关(`not in {"0","false","off","no"}`):
systemd 里完全合法的 `Environment=LYKOI_CORE_SHADOW_ENABLED=`(空串)或任何
笔误,都会**打开**影子层——而它把守 dispatch 的整条影子记录路径。同组的
attention_candidate / attention_decision / execution_session /
permission_evidence 全是"absent 或恰好 1,其余抛异常"。现在对齐,额外保留
显式 `0` 关闭。**活体当前值是 `1`,行为不变。**

**③ 两处文档失真**:research_browser 的 docstring 声称截图路径由 cognition
注册成不透明 attachment——那段代码不存在(只有 `browser.screenshot` 有)。
今天不可达(无调用方),但该动作在 dispatch 白名单里且自主路径直接 allow,
接上调用方就会把真实路径喂给模型;改成事实并写明未来必办。
integrator 注释的阈值 0.7 → 0.9。

出处:WO-BASE-01 复核 §修正注记 3 的五项"待核实"(2026-08-09 转入"后续工单
范围"后无人做),本次全部核完;另两项(策略 JSON 的 schema 校验、regulation
与关切的映射)核下来没问题,**销账**——其中策略校验那套是全仓最扎实的一处
(root 属主 + 0444 + nlink + O_NOFOLLOW + TOCTOU 比对 + 精确键集 + 拒浮点,
无任何 fail-open 路径)。

**④ 又销两条**(先前被我判为"已降格/不该我做",实则可做):
`cp` 快照的 JSONL **半截末行**——恢复侧 `json.loads` 会炸在最后一行,此前只写进
手册当"已知限制";现在快照落地后检查末字节,不是换行就剪掉那半截并记一行日志
(只对 `ext=jsonl` 生效,json/toml 是原子写不碰;实测有半截→剪掉且完整行一条不丢,
文件完好→原样不动)。以及 `attachments.resolve()` 的**非字符串 id 分支**补上测试
——它正是"模型回传的不是我们发出去的那种 id"时的兜底,此前零覆盖。

## 第 0 步 · 树干净

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-leftovers-20260813.bundle '+refs/heads/wo/fix-outbox-cursor:refs/heads/wo/fix-outbox-cursor' && git tag rollback-pre-fixcursor-20260813 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/fix-outbox-cursor
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主 + 统一重签(期望 owners_done → 107 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-fixcursor-20260813..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post fix-outbox-cursor merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_rewire_proactive.py tests/test_telegram_device.py tests/test_core_v1_shadow.py tests/test_governance_invariants.py'
```

期望:只剩已知基线 3 条(2 条 `test_core_v1_shadow` 的 `redaction._SECRETS`
+ 1 条 p0 的 `approval_rules.json` 权限)。**跑完顺手确认游标没被测试改回去**:

```bash
sudo -u lykoi cat /home/lykoi/state/telegram_outbox.cursor; echo
```

期望仍是 `{"last_outbox_id": 42}`(或更大)。若变成 0,立刻告诉我——说明还有
第三处隔离缺口。

## 第 D 步 · 重启五服务

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

`shadow.enabled()` 严格化后,若哪个 drop-in 里写的是 `true` 或空串,
lykoi-core **会拒绝启动并报错**——那正是本次要修的 fail-open,按报错把值改成
`1` 即可(活体现值就是 `1`,预期无事)。

## 回滚

`git reset --hard rollback-pre-fixcursor-20260813` → 重跑 B 步 → 重启五服务。
无迁移;游标文件保持不变。

## 事后权威全量(2026-08-13 23:00 起,空闲机器,53 分钟)

**3 failed / 1852 passed / 6 skipped**,三条全是已知基线(2 条 `redaction._SECRETS`
+ 1 条治理副本读不到 `approval_rules.json`,活体侧该条为绿)。**对比合并前 14 条:
11 条权限位噪音消失,今晚五批改动零新增失败。**

活体实弹同日收官:B 步 `GATE_OK`(core/kernel 全 root 属主)、C 步 2 failed /
122 passed、五服务 active + health ok、游标稳在 42(测试隔离修复生效)。
陈货统计 29 条已投,其中 **4 条 `proactive`**(id 12/30/31/32)——按
`docs/owner_correction_draft_2026-08-13.md` A 版由 Kevin 向她口头更正。

> 教训 38(HANDOFF):C 步那批 shadow 用例对负载极敏感,治理侧在 Kevin 实弹期间
> 跑任何测试都会把它污染成 7–8 条连锁失败。机器空闲后连测两遍均为 2 failed / 50 passed。
