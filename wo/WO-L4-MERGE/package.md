# 合并包 3 · 2026-08-12 · L4 层 2 专注思考（给 Kevin，root 执行）

复核 **PASS**：**`wo/l4` @ `3a29112c`**（[review](../WO-L4/review.md),含 1 个
复核者补丁:test_persona 白名单认可 focus.py 为受治理写者;分支尖已清杂物,
直接合并)。bundle：`/tmp/lykoi-merge-l4-20260812.bundle`。

合并后效果：她有了**回头想**的能力——每晚层 1 消化之后,层 2 挑一个关切,
跨时间调回档案与已消化经验深挖一步,产出带血缘的结论（影子期 2 周期后转正,
今天尚无下游消费者）；反刍防护给"钻牛角尖"装了出口（只建议释放,不执行）。

---

## 第 0 步 · 工作树必须干净

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

**期望**：只输出 `TREE_CLEAN`（上次合并会话已把 manifest 定影,应当是干净的）。
若有输出,**停**,把输出发我。

## 第 A 步 · 合并（root）

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-l4-20260812.bundle '+refs/heads/wo/l4:refs/heads/wo/l4' && git tag rollback-pre-l4-20260812
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/l4
```

**若在 `guardian/manifest.sha256` 报冲突**——不要手工合,取主干侧继续,B 步统一重签：

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主还原 + 统一重签 + 提交（root）

属主口径（教训 31）：guardian 444 root / kernel root:root 644（本单未动 kernel）/
其余归 lykoi（含新文件 `src/lykoi/mind/focus.py`）。

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-l4-20260812..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post l4 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

**期望**：`wrote manifest for 105 files` → 第二次 startup_verify `OK` → `GATE_OK`。

## 第 C 步 · 测试（lykoi 身份）

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_l4_focus.py tests/test_persona.py tests/test_l2_intake.py'
```

**期望：全绿**（test_l4_focus 43 条 + test_persona 10 条,其余按既有基线）。

## 第 D 步 · 重启四服务（root,_V13 随启动自动落库——五张空表+一个计数键,瞬时,无回填）

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog && curl -fsS http://127.0.0.1:8080/health && systemctl show lykoi-autonomy -p NRestarts --value
```

**期望**：四 active + health ok + NRestarts 0。然后把验收读数发我：

```bash
sudo -u lykoi sqlite3 /home/lykoi/state/memory.db "SELECT MAX(version) FROM mind_schema; SELECT name FROM sqlite_master WHERE type='table' AND name IN ('focus_cycles','product_lineage','focus_insight_state','focus_insight_history','concern_focus_state'); SELECT key,value FROM learning_layer_state"
```

**期望**：`13` / 五张表齐 / `l2_intake_watermark_id|5039` + `l4_focus_wakes_since|0`。

之后不用做任何事:层 2 与层 1 同节律,**今晚**她的第一个专注思考周期会自己来
（audit 里出现 `focus_cycle_opened` / `autonomy_focus`）,我明天看台账。

## 回滚

- 合并回滚：`git reset --hard rollback-pre-l4-20260812` → 重跑 B 步重签块 → 重启四服务。
- 只退层 2 行为：`downgrade_v13`（纯删五张影子表+计数键,不碰任何既有行列)
  + 回滚合并;她回到今天的样子。层 2 若已产出 insights 行会留在 insights 表
  （类别 'focus',无下游消费者,无害)。
