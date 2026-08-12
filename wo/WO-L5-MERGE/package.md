# 合并包 4 · 2026-08-12 · L5 规则建议队列——学习层 v2 收官（给 Kevin，root 执行）

复核 **PASS**：**`wo/l5` @ `0310741c`**（[review](../WO-L5/review.md),基
`wo/obs-llm`=已在活体 main 内）。bundle：`/tmp/lykoi-merge-l5-20260812.bundle`。

合并后效果：§3.8 门阶梯最高一级收口。她的产物一旦触到**她自己的权限边界**
(以及反刍防护的"建议释放"),只能排进建议队列、经 Telegram 问你;你点头之后
她能做的也只是把"该怎么落笔"写给你看——**她的代码里不存在写审批规则的路径**。
学习层 v2(L1–L5)至此全部在线。

> **重要·你的使用方式变化**:她问你的规则建议,回答**必须用 Telegram 的
> "引用回复"**(长按她那条问题→Reply)。不引用直接发消息会被当成普通聊天
> ——权限边界上的归属只认 reply_to,不做"他大概是在答这个"的模糊匹配。
> 另外说"不"之后同一条建议 30 个周期内不会再来烦你;不理它 7 个周期后自动
> 过期撤回。

---

## 第 0 步 · 树必须干净

```bash
cd /home/lykoi/projects/lykoi && git status --porcelain && echo TREE_CLEAN
```

**期望**：只输出 `TREE_CLEAN`。有别的输出就停,发我。

## 第 A 步 · 取 ref + 回滚 tag + 合并（root）

```bash
cd /home/lykoi/projects/lykoi && chmod u+w guardian && git fetch /tmp/lykoi-merge-l5-20260812.bundle '+refs/heads/wo/l5:refs/heads/wo/l5' && git tag rollback-pre-l5-20260812
```

```bash
cd /home/lykoi/projects/lykoi && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" merge --no-ff --no-edit wo/l5
```

**若 `guardian/manifest.sha256` 报冲突**——取主干侧继续,B 步统一重签:

```bash
cd /home/lykoi/projects/lykoi && git checkout --ours guardian/manifest.sha256 && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit --no-edit
```

## 第 B 步 · 属主还原 + 统一重签 + 提交（root）

属主口径(教训 31):新文件 `src/lykoi/kernel/suggestion_conversation.py` 属
kernel 领地,**保持 root:root**(合并即 root 写入,下面的 chown 明确排除 kernel);
`src/lykoi/mind/suggestions.py` 等其余归 lykoi。

```bash
cd /home/lykoi/projects/lykoi && git diff --name-only rollback-pre-l5-20260812..HEAD | grep -v '^guardian/' | grep -v '^src/lykoi/kernel/' | xargs -r chown lykoi:lykoi && chmod 644 src/lykoi/kernel/suggestion_conversation.py && find src tests -name __pycache__ -type d -exec rm -rf {} + 2>/dev/null; echo owners_done
```

```bash
cd /home/lykoi/projects/lykoi && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256 && chmod 555 guardian && git add guardian/manifest.sha256 && git -c user.name="Kevin" -c user.email="kevin20011113@gmail.com" commit -m "manifest: unified re-sign post l5 merge" && chown -R lykoi:lykoi .git && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

**期望**：`wrote manifest for 107 files` → 第二次 startup_verify `OK` → `GATE_OK`。

## 第 C 步 · 测试（lykoi 身份）

```bash
sudo -u lykoi bash -c 'cd /home/lykoi/projects/lykoi && .venv/bin/python -m pytest -q tests/test_p0_integrity.py tests/test_l5_suggestions.py tests/test_l4_focus.py tests/test_p2_s3_approval_wiring.py'
```

**期望：全绿**(l5_suggestions 30 条、l4_focus 43 条、s3 wiring 29 条,p0 满绿)。

## 第 D 步 · 重启五服务（root,_V14 随启动自动落库——一张空表,瞬时）

telegram 设备代码有改动(答的一腿),所以这次**连 lykoi-telegram 一起重启**:

```bash
systemctl restart lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && sleep 8 && systemctl is-active lykoi-core lykoi-server lykoi-autonomy lykoi-watchdog lykoi-telegram && curl -fsS http://127.0.0.1:8080/health && systemctl show lykoi-autonomy -p NRestarts --value
```

**期望**：五 active + health ok + NRestarts 0。然后把验收读数发我:

```bash
sudo -u lykoi sqlite3 /home/lykoi/state/memory.db "SELECT MAX(version) FROM mind_schema; SELECT name FROM sqlite_master WHERE type='table' AND name='rule_suggestions'; SELECT COUNT(*) FROM rule_suggestions"
```

**期望**：`14` / `rule_suggestions` / `0`(队列空——她还没想到要建议什么)。

## 回滚

- 合并回滚:`git reset --hard rollback-pre-l5-20260812` → 重跑 B 步重签块 → 重启五服务。
- 只退 L5 行为:`downgrade_v14`(纯删一张表,不碰任何既有行列)+ 回滚合并。
  队列里未决/已答的记录随表消失(记录在案的取舍);**没有任何权限需要撤销**——
  她从未有过写审批规则的路径,这正是铁律的副产品。
