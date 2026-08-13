# 合并包 2 · 2026-08-11 · L2 + S3（给 Kevin，root 执行）

两条分支已复核 PASS：**`wo/l2` @ `ebd26d24`**（[review](../WO-L2/review.md)）、
**`wo/s3` @ `ad01041a`**（[review](../WO-S3/review.md)）。
bundle 已备好：`/tmp/lykoi-merge-l2s3-20260811.bundle`（含两 ref，1.8MB，644）。

合并后效果：她的 nightly 消化开始吃感知（水位线之上）、关切带三来源标记；
对话式审批环闭合。**再加第 E 步（可选），她就能在 Telegram 上开口了。**

---

## 第 0 步 · ⚠️ 排雷（必须最先做）

上次会话的 root `--write-manifest`（103 条）与 policy_core 补丁**只落了文件没进 git**，
工作树是脏的——在这一步之前**绝不能**在活体跑 `git reset --hard`。先提交定影：

```bash
cd /home/lykoi/projects/lykoi && git add guardian/manifest.sha256 guardian/policy_core.py && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "guardian: root-signed manifest (103) + policy_core messenger allowlist (2026-08-11 deploy session)"
```

## 第 A 步 · 合并（root）

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-l2s3-20260811.bundle '+refs/heads/wo/*:refs/heads/wo/*' && git tag rollback-pre-l2s3-20260811
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/l2 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/s3
```

**若在 `guardian/manifest.sha256` 报冲突**（两次都可能）——不要手工合，取主干侧继续，
B 步统一重算：

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主还原 + 统一重签 + 提交（root）

属主口径（教训 31）：guardian 444 root / **kernel 一律 root:root 644**（含新文件
`approval_conversation.py`，合并即 root 写入，无需动）/ 其余归 lykoi。

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-l2s3-20260811..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | grep -v '^src/lykoi/core/' | xargs -r chown lykoi:lykoi && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post l2+s3 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

**期望**：`wrote manifest for 104 files` → 第二次 startup_verify `OK` → `GATE_OK`。

## 第 C 步 · 测试（lykoi 身份）

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_l2_intake.py tests/test_p2_s3_approval_wiring.py tests/test_p2_s2_approval_interpreter.py tests/test_confab_invariant.py'
```

**期望：全绿**——p0 应**满绿**（manifest 已提交且一致，历史上那条假失败在活体本就不出现）。

## 第 D 步 · 重启四服务（root，让 L2/S3 代码生效 + v12 水位线落定）

不需要停机窗口——`_V12` 瞬时（写一行水位线，无回填）。

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog && curl -fsS http://127.0.0.1:8080/health && systemctl show lykoi-autonomy -p NRestarts --value
```

**期望**：四 active + health ok。然后把水位线读出来发我：

```bash
sudo -u lykoi sqlite3 /home/lykoi/state/memory.db "SELECT key,value FROM learning_layer_state"
```

## 第 E 步 ·（可选，她开口的时刻）部署 Telegram 设备

S3 已把审批环闭合，现在部署就是完整链路：

```bash
cp /home/lykoi/projects/lykoi/lykoi-telegram.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now lykoi-telegram && sleep 5 && systemctl is-active lykoi-telegram
```

然后**你给 @lykoi_bot 发一句话**。期望：她回复（对所有者免审批）；audit 里出现
`messenger.send`。回复内容与延迟正常后，这条通道就算通了。
M1b（退役 Mac app UI）按老规矩等通道稳定 ≥3 天再议。

## 回滚

- 合并回滚：`git reset --hard rollback-pre-l2s3-20260811`（第 0 步已定影，reset 安全了）
  → 重跑 B 步重签块 → 重启四服务。
- 只退 L2 行为：`downgrade_v12`（删水位线）+ 回滚合并；她回到今天的取料口。
- Telegram：`systemctl disable --now lykoi-telegram`，链路即断，其余不受影响。
