# 合并包 · 2026-08-10 · 给 Kevin（root 执行）

三条分支已复核完毕、等你合。**建议放在同一次 root 会话里做完**——manifest 重签一次
就够，没必要分三趟。

| 分支 | 内容 | 复核 | 触及 manifest? |
|---|---|---|---|
| `wo/fix-broker-clock` @ `de8d631e` | 3 行注释，修 gate 5 红灯 | ✅（35 passed） | **否**（broker 在锁外） |
| `wo/p2-s2` @ `5ccde196` | messenger 资源 + Telegram 设备 + 审批解释器（s1a→s1b→s2 线性叠加，合它即含全部） | ✅ `wo/WO-P2-S2/review.md` | 是 |
| `wo/l1`（+ 其上的 `wo/l3`） | 档案/原料分离 | ✅（L1 窗口） | 是 |

**顺序建议**：`fix-broker-clock` → `p2-s2` → `l1`(/`l3`)，最后**统一重签一次
manifest**。中间两次合并如果在 `guardian/manifest.sha256` 上冲突，**不要手工合**——
随便取一边，最后那次 `--write-manifest` 会把它整个重算掉。

**L1/L3 的时机由 L1 窗口定**（L3 正在跑）。如果你想一次做完，等它复核完再开这次会话。

---

## 一、合并前必须知道的一件事

**活体现在有一条治理门是红的。** `gate 5 L1 扫描`（她的时钟纪律：所有实时读要么走
`shared.clock`，要么带一条 `# realtime-allow:` 理由）在活体上是 2 failed：

```
src/lykoi/broker/audit.py:19     datetime.now(timezone.utc).isoformat()
src/lykoi/broker/tickets.py:29   time.time() + ttl_s
src/lykoi/broker/tickets.py:40   time.time() > ticket_record.expires_at
```

三处都是 **P2-03A broker** 带进来的，昨晚已经随合并进了活体。
**这是我的复核疏漏**：那次我跑了 broker 自己的 10 个测试，没跑全树的门扫描。

功能风险低（broker 还没部署），但**一条常红的门就不再是门了**——它会淹掉后面所有单的
真信号。`wo/fix-broker-clock` 就是修这个，所以我把它排在最前面。

修法是**加标记，不是改走虚拟时钟**。先例是 `core/runtime.py`：耐久收据时间戳和 socket
deadline 都是这么标的。一次性凭证的 TTL **绝不能**跟着可步进的虚拟时钟走——把时钟往回
步一下，所有未过期的 ticket 就永远不过期了。

## 二、S2 分支的全量 pytest 对照结论

`wo/p2-s2` 全量：**1564 passed / 18 failed / 6 skipped**（22m45s）。18 条全部定性，
**没有一条是 S2 造成的**：

| 条数 | 失败项 | 定性 |
|---|---|---|
| 11 | `test_core_v1_m3_r*` / `deepseek_*_rollout` 的 controller 检查 | **治理账户工作副本的文件权限位伪影**（实测 `0o775`，期望 `0o755`）。活体上这些文件是合并时设好的 644/755，不受影响 |
| 3 | `gate5_l1_scan` ×2、`confab_invariant`、`integration_telemetry`（同一个扫描被三处调用） | **P2-03A broker 带进来的**，见 §一。活体同样红。`wo/fix-broker-clock` 修掉 |
| 2 | `test_core_v1_shadow` | 既有：一条引用了 `redaction._SECRETS`，这个名字在活体 main 上就不存在；另一条是全量并跑时的 epoch 锁超时（资源竞争） |
| 1 | `test_p0_integrity` manifest 哈希不符 | **预期**，root 重签后转绿 |

> 交叉印证：L1 窗口独立跑全量也得到同样的 18 条基线失败（他们的记录在
> `governance-ops.jsonl`），两边互不知情却对上了。

## 三、合并后的验证清单（以 lykoi 身份跑，不要用 root 跑测试）

1. `python3 guardian/startup_verify.py --write-manifest`（**root**），然后
   `chown root:root guardian/manifest.sha256 && chmod 444 guardian/manifest.sha256`
2. `sudo -u lykoi python3 -I -S guardian/startup_verify.py` → 期望 `OK`
3. `pytest tests/test_p0_integrity.py` → 期望 **全绿**（manifest 那条应转绿）
4. `pytest tests/test_gate5_l1_scan.py tests/test_confab_invariant.py` → 期望 **全绿**
   （这是 §一 那条门恢复的判据）
5. `pytest tests/test_p2_s2_approval_interpreter.py tests/test_messenger.py tests/test_telegram_device.py` → 期望全绿
6. 四服务 `systemctl is-active` + `NRestarts` 未增
7. `curl /health` → ok

## 四、合并**不**等于生效（老规矩）

合完之后她仍然不会在 Telegram 上说话。还差上线序列
（`wo/WO-P2-DEPLOY/sequence.md`）的：

1. 活体 memory.db v9→v10 迁移（需停 autonomy；L1 的回填也折进这个停机窗口）
2. 写入第一条身份绑定（tg `2062674220` → `user_001`）
3. `policy_core.AUTONOMOUS_ALLOWED` 加 `messenger.*`（root，且要再重签一次 manifest）
4. 初始预授权 `bootstrap_owner_preauthorization()`
5. 部署 `lykoi-telegram.service`
6. **⚠️ 第 3d 步 S3 接线单**——不接，"发给新收件人"这条审批路一直挂着没人应答
   （详见 `wo/WO-P2-S2/review.md` §四）

## 五、回滚

每条分支合并前打 tag：

```bash
git -C /home/lykoi/projects/lykoi tag rollback-pre-fix-clock   89d0247f
```

（后两条的 tag 在各自合并前打，指向当时的 HEAD。）
回滚 = `git reset --hard <tag>` + 重签 manifest + 重启四服务。
