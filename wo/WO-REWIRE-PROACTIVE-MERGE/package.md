# 合并包 8 · 2026-08-13 · 接嘴(她的主动发言接到真躯体上)

复核状态:**代码审读通过 + 邻接 116 全绿 + manifest 107 独立重算干净**;
权威全量串行**在跑**,结果落定后本页顶部会补一行结论(见 [review](../WO-REWIRE-PROACTIVE/review.md))。
分支 `wo/rewire-proactive`(4 commits,基 `wo/u1` @ `70ac7394`),
bundle 待复核 PASS 后生成。

内容:①telegram 设备在长轮询间隙消费 `chat_outbox`,只投 `proactive`/`followup`,
`approval_request`(旧 surface 遗物)记 `chat_outbox_skipped` 后跳过;
②游标 `/home/lykoi/state/telegram_outbox.cursor` 设备自持,**初值 = 接上那一刻的
max id**(42 条陈货一条不发),损坏也按"从现在起";投递经既有 transport,
U0 重试 / 未送达账本 / U1 经验回灌全部自动继承;游标推进在结局落定之后;
没有 owner 绑定时**扣住不推**(话还没出过站,绑定补上后仍该说);
③reflow 的假回执"Kevin 打开对话就会看到"改为"已交给投递;送达与否之后会回到
你的经验里",`autonomy.py` 顶部注释同步。无迁移。

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-rewire-20260813.bundle '+refs/heads/wo/rewire-proactive:refs/heads/wo/rewire-proactive' && git tag rollback-pre-rewire-20260813
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/rewire-proactive
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主 + 重签(期望 owners_done → 107 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-rewire-20260813..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post rewire-proactive merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试(期望全绿)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_rewire_proactive.py tests/test_telegram_device.py tests/test_telegram_transport.py tests/test_u1_undelivered_feedback.py tests/test_messenger.py tests/test_gate5_l1_scan.py'
```

## 第 D 步 · 重启五服务(期望五 active + health ok)

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

## 第 E 步 · 顺手销两笔陈年遗留(与本包无关,但都是 root 一行)

```bash
chmod 755 /home/lykoi/projects/lykoi/scripts/patches/*/root_apply.sh 2>/dev/null; ls -la /home/lykoi/state/events.jsonl; ls -la /home/lykoi/projects/lykoi/scripts/patches/*/root_apply.sh | head -3
```

- 前半:`root_apply.sh` 磁盘位 0775→755(WO-FIX-APPROVAL-UX 复核遗留,claude 侧无权限);
- 后半:`events.jsonl` 权限现状核实(WO-FIX-SEC-01 复核 §5 待办第 3 项,至今没人看过)。
  期望 `0600 lykoi:lykoi`;若比这更松,告诉我,我按同一批处理。

## 实弹验收

不用专门做。她下次自主周期若选 `initiate_chat`(日 1 条、冷却 6h、需要关系张力
攒够),消息会**直接出现在 Telegram**;事件流里可查 `chat_outbox_delivered_telegram`。
首次接上时会有一条 `chat_outbox_cursor_initialized`(cursor=42 左右),
证明陈货被正确跳过。

## 回滚

`git reset --hard rollback-pre-rewire-20260813` → 重跑 B 步 → 重启五服务。
无迁移;游标文件 `/home/lykoi/state/telegram_outbox.cursor` 无害残留
(回滚后没有消费者读它)。
