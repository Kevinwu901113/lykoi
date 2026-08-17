# 合并包 11 · 2026-08-17 · 心智入场(U2:她的记忆、关切、器官、想明白的事进入对话)

复核 **PASS**:**`wo/u2` @ `67adbd11`**([review](../WO-U2/review.md))。
复核方全量:**1899 passed / 5 failed / 6 skipped**(=基线 1855+新增 49,算术闭合),
5 条失败逐条归因零新增(2 条=下述裁决项;2 条=redaction 老基线;1 条=claude 假失败)。
manifest 108 独立重算干净。分支基 `b0a0e593`(=活体 main)。
bundle:`/tmp/lykoi-merge-u2-20260817.bundle`(45KB,
sha256 `5cb46fa1…8ede5228`)。

内容:①CACHE-INVERT 前缀重排(念头/时间/self-state 沉到活窗之后,main 命中率
48%→目标 ≥70%);②器官清单块(代码派生:身份绑定+设备+动作能力;secrets 连
键名都不出现);③L3 检索每轮入场(来话即探针,纯函数零 LLM);④活跃关切块
(稳定段,轮级字段不渲染);⑤转正洞见入场——`promoted_focus_insights()` 第一个
下游消费者,只读 active,shadow/contested 反向用例把门;⑥整合边界刷新(nightly
印记变→重建人格头,计划内全量 miss ≤1 次/天;decide 路径一行未动=usage 对照组);
⑦转录窗 30→8(D2,env 覆盖保留)。无迁移、无新 env、无新 state 路径常量。

## ⚖️ 裁决项(合并前定):s5/s9 封存线断言口径

判据① 重排与两条断言的**位置形式**互斥(注入后不再必有 user 消息)。建议改法:
断言改为「注入是最后一条 system,其后无任何 system」——语义意图不减反增,对
decide 路径与旧断言等价。补丁 `/tmp/wo-u2-reviewer-patch.diff`(--check 已验证)。
**批准 → 执行 A2 步;不批 → 跳过 A2,s5/s9 保持红,治理侧另议 U3 前的处置。**

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-u2-20260817.bundle '+refs/heads/wo/u2:refs/heads/wo/u2' && git tag rollback-pre-u2-20260817
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/u2
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 A2 步 · (仅在批准裁决项后)应用 s5/s9 断言补丁

```bash
cd /home/lykoi/projects/lykoi && git apply --check /tmp/wo-u2-reviewer-patch.diff && git apply /tmp/wo-u2-reviewer-patch.diff && git add tests/test_core_v1_m3_r2c_s5_symmetric_consumer.py tests/test_core_v1_m3_r2c_s9_live_injection.py && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "tests: s5/s9 封存线断言口径变更(注入=最后一条 system)——U2 重排的直接后果,owner 批准 2026-08-17"
```

## 第 B 步 · 属主 + 重签(期望 owners_done → 108 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-u2-20260817..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post u2 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试(批准 A2 后期望全绿;未批 A2 则 s5/s9 各红 1 条属已知)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_u2_mind_entry.py tests/test_core_v1_m3_r2c_s5_symmetric_consumer.py tests/test_core_v1_m3_r2c_s9_live_injection.py tests/test_p0_context.py tests/test_chatloop.py tests/test_persona.py tests/test_l4_focus.py tests/test_l2_intake.py tests/test_l3_relevance.py tests/test_messenger.py tests/test_telegram_device.py tests/test_telegram_transport.py tests/test_gate5_l1_scan.py'
```

## 第 D 步 · 重启五服务(期望五 active + health ok)

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health
```

## 第 E 步 · 验收观察(合并后)

1. **当晚**:给她发一句话,回复正常、语气不漂(尾部强调效应粗检);
   `journalctl -u lykoi-server -n 50` 无新报错。
2. **明晚 nightly 后**:确认整合边界刷新只发生 ≤1 次(server 日志/事件)。
3. **24h 后(治理侧)**:usage 复读——main 命中率目标 **≥70%**(基线 48%),
   completion/次 不显著变;autonomous 应稳在 30% 附近(对照组,漂了=供应商侧
   变化不是我们的刀)。命令与基线表:`docs/usage_baseline_2026-08-13.md`。

回滚:`git reset --hard rollback-pre-u2-20260817` → B 步重签 → D 步重启。
