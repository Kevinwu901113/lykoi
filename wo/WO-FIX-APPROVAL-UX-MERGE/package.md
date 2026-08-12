# 合并包 5 · 2026-08-12 · 对话审批四处补漏（给 Kevin，root 执行）

复核 **PASS**:**`wo/fix-approval-ux` @ `ed262b80`**([review](../WO-FIX-APPROVAL-UX/review.md),
含 1 个复核者补充:telegram.service 正本补 llm.env)。
bundle:`/tmp/lykoi-merge-fixux-20260812.bundle`(28KB,644)。
全量 14 failed = 已知基线分毫不差,零新增;新测试 24 条全绿;manifest 107 哈希同步。

修复:①执行成功她**主动引用你的批准回结果**;②POST 横幅绝迹、同一 pending
不重复播报;③「执行/不要」字面快通道(零 LLM 依赖);④"批准/同意"等自然
应答能到达判读器。无迁移。

---

## 第 0 步 · 树干净(期望只输出 TREE_CLEAN)

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

## 第 A 步 · 取 ref + tag + 合并

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-fixux-20260812.bundle '+refs/heads/wo/fix-approval-ux:refs/heads/wo/fix-approval-ux' && git tag rollback-pre-fixux-20260812
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/fix-approval-ux
```

manifest 冲突时才跑(没冲突跳过):

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主还原 + 统一重签(期望 owners_done → 107 files → OK → GATE_OK)

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-fixux-20260812..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && chmod 644 src/lykoi/kernel/approval_conversation.py src/lykoi/kernel/approval_interpreter.py && chown root:root src/lykoi/kernel/approval_conversation.py src/lykoi/kernel/approval_interpreter.py && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post fix-approval-ux merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

## 第 C 步 · 测试(期望全绿:wiring 38 条、interpreter 63 条,p0 满绿)

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_p2_s3_approval_wiring.py tests/test_p2_s2_approval_interpreter.py'
```

## 第 D 步 · 单元文件转正 + 重启五服务

仓库正本已带 llm.env 行,替换部署副本、撤热修 drop-in(消除双份来源):

```bash
cp /home/lykoi/projects/lykoi/lykoi-telegram.service /etc/systemd/system/lykoi-telegram.service && rm -f /etc/systemd/system/lykoi-telegram.service.d/10-llm-env.conf && rmdir /etc/systemd/system/lykoi-telegram.service.d 2>/dev/null; systemctl daemon-reload && systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health && systemctl show lykoi-telegram -p EnvironmentFiles | tr "\\\\" "\n" | grep llm.env
```

**期望**:五 active + health ok + 最后一行含 `llm.env`。

## 第 E 步 · 实弹验收(Telegram,2 分钟)——走完把过程发我

1. 对她说:"帮我看下服务器现在几点"(或任何会碰 terminal.exec 的小事);
2. 期望:**一条**干净问询,无 POST 端点,且不重复;
3. 直接回「执行」(不引用也行——字面快通道;引用更稳);
4. 期望:**她立刻引用你的批准,把命令输出发回来**——全程不用你发第二条;
5. 有兴致再试一次用"同意/批准"回答——应当也走得通(词表 + LLM 判读)。

## 回滚

`git reset --hard rollback-pre-fixux-20260812` → 重跑 B 步 → 重启五服务。
无迁移无状态,回滚即回到今天下午的行为(含四个缺陷)。
