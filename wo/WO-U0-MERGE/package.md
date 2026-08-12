# 合并包 6 · 2026-08-13 · U0 传输层加固（给 Kevin，root 执行）

复核 **PASS**:**`wo/u0` @ `4d800e4f`**([review](../WO-U0/review.md),含 1 个
复核者补丁:两处 time.monotonic 补 realtime-allow 标记)。
bundle:`/tmp/lykoi-merge-u0-20260812.bundle`。
全量 18 failed = 14 基线 + 4 条 gate5 扫描门(补丁后四套全绿);
新增 308 行测试;manifest 107/107 独立重算干净。

修复:①sendMessage 网络故障重试(退避 2/5/15/30s,至多 4 次;确定失败/歧义
分类只用于记录,取舍=丢话之害>偶发重复之害);②未送达账本
(`~/state/telegram_undelivered.json`,有界 200 条)——出站消息结局二选一:
有 message_id 或在账本里,无第三种;③chat_reply 送达回执
(`chat_reply_delivered`)/未送达补记;④getUpdates 错误连击聚档+恢复事件
(只动日志不动节奏)。全部收口在传输层,S3/L5/自主发言同惠。

无迁移。合并 → 属主(resources 归 lykoi)→ 重签(107 不变,两条哈希)→
GATE_OK → 测试(telegram/messenger 三件套 + p0)→ 重启五服务。

实弹验收:合并后正常聊几句即可;之后任何一次网络抖动,事件流里应见
`telegram_send_retry`(而不是静默丢件),连续抖动的 getUpdates 噪声降为
首条+每十条+恢复一条。

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-u0-20260812.bundle '+refs/heads/wo/u0:refs/heads/wo/u0' && git tag rollback-pre-u0-20260813
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/u0
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主 + 重签(期望 owners_done → 107 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-u0-20260813..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post u0 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试(期望全绿:transport 21、device 若干、messenger、gate5 3,p0 满绿)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_telegram_transport.py tests/test_telegram_device.py tests/test_messenger.py tests/test_gate5_l1_scan.py'
```

## 第 D 步 · 重启五服务(期望五 active + health ok)

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

## 回滚

`git reset --hard rollback-pre-u0-20260813` → 重跑 B 步 → 重启五服务。
无迁移无状态(未送达账本文件无害残留)。
