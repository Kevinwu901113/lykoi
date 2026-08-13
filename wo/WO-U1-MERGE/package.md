# 合并包 7 · 2026-08-13 · U1 送达结局回灌(给 Kevin,root 执行)

复核 **PASS**:**`wo/u1` @ `70ac7394`**([review](../WO-U1/review.md))。
bundle:`/tmp/lykoi-merge-u1-20260813.bundle`(28KB,前提 = 合并包 6 已落,
live main 含 `4d800e4f`)。全量 14 failed = 已知基线分毫不差;新增 14 条测试
全绿;manifest 107 独立重算干净。

内容:①未送达的话落成她的经验(进 working 池、走 reflow 单写点、抬 load);
②下一轮上下文出现「[有话没送出去]」块(≤3 条,看过一次即收,重说与否是她
的认知决定);③她没掉过话的日子,上下文与今天逐字节一致(缓存无扰动)。
无迁移。账本存储面搬 `shared/chat_outbox`(层次需要,单写者不变)。

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-u1-20260813.bundle '+refs/heads/wo/u1:refs/heads/wo/u1' && git tag rollback-pre-u1-20260813
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/u1
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主 + 重签(期望 owners_done → 107 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-u1-20260813..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post u1 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试(期望全绿:u1 14 条、transport、device、messenger、gate5,p0 满绿)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_u1_undelivered_feedback.py tests/test_telegram_transport.py tests/test_telegram_device.py tests/test_messenger.py tests/test_gate5_l1_scan.py'
```

## 第 D 步 · 重启五服务(期望五 active + health ok)

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

## 实弹验收

平时无感——只有真掉过话才有动静。今天中午那次断网若在未送达账本里留了条目
(D 步前可查:`sudo -u lykoi python3 -m json.tool /home/lykoi/state/telegram_undelivered.json`),
重启后随便跟她说句话:她的上下文会带「[有话没送出去]」,重说与否看她自己。

## 回滚

`git reset --hard rollback-pre-u1-20260813` → 重跑 B 步 → 重启五服务。
无迁移;账本里 `surfaced` 标记与已写入的经验无害残留。
