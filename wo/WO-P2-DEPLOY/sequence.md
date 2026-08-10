# 阶段 2 上线序列（她开口说话之前要做的事）· 2026-08-10

**给 Kevin 的操作清单。** 四步有严格顺序依赖；每步都可独立回滚。
除第 1 步的备份外，其余都需要 root 或所有者身份——这正是"把不该做变成做不到"的边界在起作用。

已就绪的前置：代码 `89d0247f` 已在活体（P2-01 数据模型 + P2-03A broker）；
bot `@lykoi_bot`（id 8677191436）已验证可达；Kevin 的 Telegram 身份已确认
（user id `2062674220`，username `EiAxUME`——他已给 bot 发过 `/start`）。

---

## 第 1 步 · 活体 memory.db 迁移（v9 → v10）

**为什么先做**：`identity_bindings` / `contexts` 表现在还不存在，第 2 步无处可写。
**完整程序见** `wo/WO-P2-MIGRATE/procedure.md`（含新鲜备份、停/起 autonomy、验证、回滚）。
**风险**：低——新表目前无任何代码读取，迁移对她的行为是惰性的；逆迁移已在真实数据副本验证。

## 第 2 步 · 写入第一条真实身份绑定（迁移完成后）

把 Kevin 的 Telegram 身份绑到 `user_001`。以 lykoi 身份执行即可（不需要 root）：

```bash
ssh lapw1ng.com '/home/lykoi/projects/lykoi/.venv/bin/python -c "
import sqlite3, datetime
c = sqlite3.connect(\"/home/lykoi/state/memory.db\", isolation_level=None)
now = datetime.datetime.now(datetime.timezone.utc).isoformat()
c.execute(\"INSERT OR IGNORE INTO identity_bindings(user_id,channel,channel_key,verified_by,created_at) VALUES(?,?,?,?,?)\",
          (\"user_001\",\"telegram\",\"2062674220\",\"owner_manual\",now))
print(c.execute(\"SELECT user_id,channel,channel_key,verified_by FROM identity_bindings\").fetchall())
c.close()"'
```

**期望**：一行 `('user_001', 'telegram', '2062674220', 'owner_manual')`。
这是 Lykoi 历史上第一条非 owner-token 的身份绑定——白皮书 5.5 从纸面落地。

## 第 3 步 · 给她 Telegram 开口的能力（root，且必须重签 manifest）

**为什么需要**：`guardian/policy_core.py` 的 `AUTONOMOUS_ALLOWED` 是自主循环的动作白名单，
名单外一律 deny。不加这两条，**她永远无法主动在 Telegram 上说话**（见 `wo/WO-P2-S1A/review.md` §3）。
先例：`autonomy.initiate_chat` 已在名单内，速率限制由资源层强制——messenger 完全平行。

以 root 执行（先备份原文件，改后必须重签 manifest，否则三服务拒启）：

```bash
cd /home/lykoi/projects/lykoi && cp guardian/policy_core.py /root/policy_core.py.bak && chmod u+w guardian guardian/policy_core.py && python3 - <<'PY'
import re, pathlib
p = pathlib.Path("guardian/policy_core.py")
s = p.read_text()
anchor = '        "autonomy.initiate_chat",  # WO-NIGHT-01/B3: 主动开口(对话消息; 日1条/冷却6h 在资源层强制)\n'
assert anchor in s, "anchor not found - inspect the file manually"
add = ('        # WO-P2-S1A/S1B: 她自己的社交器官。send 的日1条/冷却6h 同样在资源层强制;\n'
       '        # read 无副作用。绑定校验在设备层(只接受 identity_bindings 内的发送者)。\n'
       '        "messenger.send",\n        "messenger.read",\n')
p.write_text(s.replace(anchor, anchor + add))
print("patched")
PY
python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/policy_core.py guardian/manifest.sha256 && chmod 444 guardian/policy_core.py guardian/manifest.sha256 && chmod 555 guardian && sudo -u lykoi python3 -I -S guardian/startup_verify.py && echo GATE_OK
```

**期望**：`patched` → `startup_verify: OK` → `GATE_OK`。
**回滚**：`chmod u+w guardian guardian/policy_core.py && cp /root/policy_core.py.bak guardian/policy_core.py && python3 guardian/startup_verify.py --write-manifest && chown root:root guardian/policy_core.py guardian/manifest.sha256 && chmod 444 guardian/policy_core.py guardian/manifest.sha256 && chmod 555 guardian`

## 第 3b 步 · 合并三个 messenger 分支（root，触及 resources/mind/manifest）

`wo/p2-s1a`（资源层）→ `wo/p2-s1b`（Telegram 设备）→ `wo/p2-s2`（审批解释器）
是线性叠加的（后者基于前者），**合并最后一个即含全部**。
做法同 P2-01：root 执行 merge → 还原非 guardian 文件属主为 `lykoi:lykoi 644` →
guardian/manifest 保持 `root:root 444` → 以 lykoi 身份跑 startup_verify + p0。
（合并前我会先跑一次全量 pytest 并给出对照结论。）

## 第 3c 步 · 初始预授权（否则她连回复都发不出去）

`messenger.send` 默认走审批，会造成死锁：**她要回复你得先请求审批，而请求审批靠发消息**。
S2 实现了初始化函数，部署时调用一次即可（以 lykoi 身份，不需要 root）——
效果：回复/主动找**已绑定所有者**免询；发给**新收件人**仍走"问一次"。
具体命令待 S2 验收后补入本文件。

## 第 4 步 · 部署 Telegram 设备（等 S1B/S2 验收通过后）

- 合并 `wo/p2-s1b`（触及 `resources/` + manifest → 需 root，同 P2-01 的做法）
- 安装 `lykoi-telegram.service`（`EnvironmentFile=/home/lykoi/secrets/im.env` 已就位，
  0600 lykoi:lykoi）
- `systemctl enable --now lykoi-telegram`
- **首次通话验证**：Kevin 给 @lykoi_bot 发一句话 → 她回复 → 检查
  immutable audit 里有对应的 `messenger.send` 动作记录

---

## 完成后她的状态

- 有了第一条真实身份绑定（你在 Telegram 上的身份 = user_001）
- 有了一个她自己的社交账号，能收能发，发消息是她经 dispatch 的一次行动（有审批门、有审计）
- 主动开口受资源层速率限制（日 1 条 / 冷却 6h，回复不受限）
- Mac app 仍照常可用——**M1b（退役 app UI）要等这条通道稳定运行**（建议 ≥3 天 + 审批经
  对话走通 ≥1 次 + 掉线可恢复），别急着拆掉你现在唯一的会面通道。
